-- Migration 0225: Add break_from and break_to to update_my_pending_request
-- ============================================================================
-- 1. Updates public.update_my_pending_request to accept optional p_break_from and p_break_to
-- 2. Updates public.time_request_details with break_from and break_to when editing
-- ============================================================================

-- Drop ambiguous overloads of update_my_pending_request
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'update_my_pending_request'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end;
$$;

create or replace function public.update_my_pending_request(
  p_request_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_time_from time default null,
  p_time_to time default null,
  p_total_hours numeric default null,
  p_time_schedule text default null,
  p_day_off text default null,
  p_payroll_class text default null,
  p_transaction_type text default null,
  p_leave_type text default null,
  p_leave_category text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_total_days numeric default null,
  p_paid_days numeric default null,
  p_unpaid_days numeric default null,
  p_reason text default null,
  p_request_type_code text default null,
  p_store_id uuid default null,
  p_custom_approvers jsonb default null,
  p_break_from time default null,
  p_break_to time default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_req public.requests;
  v_is_perk boolean := false;
  v_custom_app_elem jsonb;
  v_step_order int;
  v_custom_emp_id uuid;
  v_custom_user_id uuid;
  v_resolved_trans text;
  v_new_is_use_offset boolean := false;
  v_new_hours numeric := 0;
  v_prev_hours_used numeric := 0;
  v_hours_diff numeric := 0;
  v_current_bal numeric;
  v_new_bal numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.employee_id is null then
    raise exception 'User profile not found.';
  end if;

  select * into v_req
  from public.requests
  where id = p_request_id;

  if v_req.id is null then
    select exists (
      select 1 from public.employee_perk_requests
      where id = p_request_id
        and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id)
    ) into v_is_perk;

    if v_is_perk then
      update public.employee_perk_requests
      set reason = coalesce(nullif(trim(p_reason), ''), reason)
      where id = p_request_id and status = 'pending';
      return 'Request updated successfully.';
    end if;

    raise exception 'Request not found.';
  end if;

  if v_req.submitted_by_employee_id != v_profile.employee_id then
    raise exception 'You can only edit your own requests.';
  end if;

  if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr', 'pre_approved') then
    raise exception 'Only pending requests can be edited.';
  end if;

  -- Update time_request_details if present (ESARF)
  if exists (select 1 from public.time_request_details where request_id = p_request_id) then
    if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
      raise exception 'Date To cannot be earlier than Date From.';
    end if;

    -- Handle offset balance adjustments when editing Use Offset requests
    v_resolved_trans := lower(coalesce(p_transaction_type, (select transaction_type from public.time_request_details where request_id = p_request_id), ''));
    v_new_is_use_offset := (
      coalesce(p_request_type_code, '') = 'use_offset'
      or v_resolved_trans like '%use_offset%'
      or v_resolved_trans like '%use offset%'
    );

    v_new_hours := coalesce(p_total_hours, (select total_hours from public.time_request_details where request_id = p_request_id), 0);

    select coalesce(sum(hours), 0)
    into v_prev_hours_used
    from public.offset_transactions
    where request_id = p_request_id
      and transaction_type = 'use';

    if v_new_is_use_offset then
      v_hours_diff := v_new_hours - v_prev_hours_used;

      if v_hours_diff > 0 then
        select coalesce(balance_hours, 0)
        into v_current_bal
        from public.offset_balances
        where employee_id = v_profile.employee_id
        for update;

        if coalesce(v_current_bal, 0) < v_hours_diff then
          raise exception 'Insufficient offset balance to update request (available: % hrs, needed: % hrs).',
            coalesce(v_current_bal, 0), v_hours_diff;
        end if;

        v_new_bal := round(coalesce(v_current_bal, 0) - v_hours_diff, 2);

        update public.offset_balances
        set balance_hours = v_new_bal,
            updated_at = now()
        where employee_id = v_profile.employee_id;

        insert into public.offset_transactions (
          employee_id,
          request_id,
          transaction_type,
          hours,
          balance_after,
          created_at
        )
        values (
          v_profile.employee_id,
          p_request_id,
          'use',
          v_hours_diff,
          v_new_bal,
          now()
        );
      elsif v_hours_diff < 0 then
        update public.offset_balances
        set balance_hours = round(balance_hours + abs(v_hours_diff), 2),
            updated_at = now()
        where employee_id = v_profile.employee_id;

        update public.offset_transactions
        set hours = v_new_hours,
            balance_after = round(balance_after + abs(v_hours_diff), 2),
            created_at = now()
        where request_id = p_request_id and transaction_type = 'use';
      end if;
    else
      if v_prev_hours_used > 0 then
        update public.offset_balances
        set balance_hours = round(balance_hours + v_prev_hours_used, 2),
            updated_at = now()
        where employee_id = v_profile.employee_id;

        delete from public.offset_transactions
        where request_id = p_request_id and transaction_type = 'use';
      end if;
    end if;

    update public.time_request_details
    set
      date_from = coalesce(p_date_from, date_from),
      date_to = coalesce(p_date_to, date_to),
      time_from = coalesce(p_time_from, time_from),
      time_to = coalesce(p_time_to, time_to),
      break_from = case
        when p_break_from is not null then p_break_from
        when p_reason is not null and p_reason not like '%[Break:%' then null
        else break_from
      end,
      break_to = case
        when p_break_to is not null then p_break_to
        when p_reason is not null and p_reason not like '%[Break:%' then null
        else break_to
      end,
      total_hours = coalesce(p_total_hours, total_hours),
      reason = coalesce(nullif(trim(p_reason), ''), reason),
      time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
      day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
      payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class),
      transaction_type = coalesce(nullif(trim(p_transaction_type), ''), transaction_type)
    where request_id = p_request_id;
  end if;

  -- Update custom approvers if provided
  if p_custom_approvers is not null and jsonb_typeof(p_custom_approvers) = 'array' then
    for v_custom_app_elem in select * from jsonb_array_elements(p_custom_approvers) loop
      v_step_order := (v_custom_app_elem->>'step_order')::int;
      v_custom_emp_id := nullif(trim(v_custom_app_elem->>'approver_employee_id'), '')::uuid;

      if v_custom_emp_id is not null then
        select up.id into v_custom_user_id
        from public.user_profiles up
        where up.employee_id = v_custom_emp_id
        limit 1;

        update public.request_approval_steps
        set assigned_approver_employee_id = v_custom_emp_id,
            assigned_approver_user_id = v_custom_user_id,
            is_reassigned = true
        where request_id = p_request_id
          and step_order = v_step_order;
      end if;
    end loop;
  end if;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.update_my_pending_request(
  uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text, uuid, jsonb, time, time
) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

