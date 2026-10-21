-- Migration 0204: Fix requests_status_check constraint to permit 'pre_approved' for scheduled OT
-- 1. Updates requests_status_check on public.requests to allow 'pre_approved' (and 'admin_fallback').
-- 2. Corrects public.attach_scheduled_ot_photo_proof to remove reference to non-existent 'reason' column on public.requests.
-- 3. Corrects public.update_my_pending_request to remove reference to non-existent 'reason' column on public.requests.

-- 1. Alter requests_status_check constraint
alter table public.requests
  drop constraint if exists requests_status_check;

alter table public.requests
  add constraint requests_status_check check (
    status in (
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'needs_admin_review',
      'admin_fallback',
      'pre_approved',
      'validated',
      'submitted',
      'pending_hr',
      'waiting'
    )
  ) not valid;

-- 2. Fix public.attach_scheduled_ot_photo_proof RPC
create or replace function public.attach_scheduled_ot_photo_proof(
  p_request_id uuid,
  p_proof_tags text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_req public.requests;
  v_time_req public.time_request_details;
  v_new_reason text;
  v_first_step_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.employee_id is null then
    raise exception 'Employee profile not found.';
  end if;

  select * into v_req
  from public.requests
  where id = p_request_id;

  if v_req.id is null then
    raise exception 'Request not found.';
  end if;

  if v_req.submitted_by_employee_id <> v_profile.employee_id then
    raise exception 'You can only attach photo proof to your own requests.';
  end if;

  select * into v_time_req
  from public.time_request_details
  where request_id = p_request_id;

  -- Append proof tags to reason on time_request_details
  v_new_reason := trim(coalesce(v_time_req.reason, '')) || ' ' || trim(coalesce(p_proof_tags, ''));

  update public.time_request_details
  set reason = trim(v_new_reason)
  where request_id = p_request_id;

  -- Advance request status to 'pending' so it proceeds normally through approval
  update public.requests
  set status = 'pending',
      updated_at = now()
  where id = p_request_id;

  -- Activate first approval step in request_approval_steps so it appears in approver queue
  select id into v_first_step_id
  from public.request_approval_steps
  where request_id = p_request_id
  order by step_order asc
  limit 1;

  if v_first_step_id is not null then
    update public.request_approval_steps
    set status = 'pending',
        remarks = null
    where id = v_first_step_id;
  end if;

  return 'Photo proof attached successfully. Request has been forwarded to your approver.';
end;
$$;

grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to authenticated;
grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to anon;
grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to service_role;

-- 3. Fix public.update_my_pending_request to remove nonexistent reason column on public.requests
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
  p_request_type_code text default null
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
  v_target_type_id uuid;
  v_prev_hours_used numeric := 0;
  v_new_hours numeric := 0;
  v_hours_diff numeric := 0;
  v_current_bal numeric := 0;
  v_new_bal numeric := 0;
  v_new_is_use_offset boolean := false;
  v_resolved_trans text := '';
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

  if exists (
    select 1 from public.request_approval_steps
    where request_id = p_request_id
      and status ilike '%approved%'
  ) then
    raise exception 'This request has already received an approval in the timeline and cannot be edited.';
  end if;

  -- Update time_request_details if present (ESARF)
  if exists (select 1 from public.time_request_details where request_id = p_request_id) then
    if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
      raise exception 'Date To cannot be earlier than Date From.';
    end if;

    v_resolved_trans := lower(coalesce(p_transaction_type, (select transaction_type from public.time_request_details where request_id = p_request_id), ''));
    v_new_is_use_offset := (
      coalesce(p_request_type_code, '') = 'use_offset'
      or v_resolved_trans like '%use_offset%'
      or v_resolved_trans like '%use offset%'
    );

    v_new_hours := coalesce(p_total_hours, (select total_hours from public.time_request_details where request_id = p_request_id), 0);

    -- Calculate previously deducted hours for this request
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

        if exists (select 1 from public.offset_transactions where request_id = p_request_id and transaction_type = 'use') then
          update public.offset_transactions
          set hours = v_new_hours,
              balance_after = v_new_bal,
              created_at = now()
          where request_id = p_request_id and transaction_type = 'use';
        else
          insert into public.offset_transactions (employee_id, request_id, transaction_type, hours, balance_after, created_at)
          values (v_profile.employee_id, p_request_id, 'use', v_new_hours, v_new_bal, now());
        end if;
      elsif v_hours_diff < 0 then
        select coalesce(balance_hours, 0)
        into v_current_bal
        from public.offset_balances
        where employee_id = v_profile.employee_id
        for update;

        v_new_bal := round(coalesce(v_current_bal, 0) + abs(v_hours_diff), 2);

        update public.offset_balances
        set balance_hours = v_new_bal,
            updated_at = now()
        where employee_id = v_profile.employee_id;

        update public.offset_transactions
        set hours = v_new_hours,
            balance_after = v_new_bal,
            created_at = now()
        where request_id = p_request_id and transaction_type = 'use';
      end if;
    end if;

    update public.time_request_details
    set date_from = coalesce(p_date_from, date_from),
        date_to = coalesce(p_date_to, date_to),
        time_from = coalesce(p_time_from, time_from),
        time_to = coalesce(p_time_to, time_to),
        total_hours = coalesce(p_total_hours, total_hours),
        time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
        day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
        payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class),
        transaction_type = coalesce(nullif(trim(p_transaction_type), ''), transaction_type),
        reason = coalesce(nullif(trim(p_reason), ''), reason)
    where request_id = p_request_id;
  end if;

  -- Update leave_request_details if present
  if exists (select 1 from public.leave_request_details where request_id = p_request_id) then
    if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
      raise exception 'End Date cannot be earlier than Start Date.';
    end if;

    update public.leave_request_details
    set leave_type = coalesce(nullif(trim(p_leave_type), ''), leave_type),
        leave_category = coalesce(nullif(trim(p_leave_category), ''), leave_category),
        start_date = coalesce(p_start_date, start_date),
        end_date = coalesce(p_end_date, end_date),
        total_days = coalesce(p_total_days, total_days),
        paid_days = coalesce(p_paid_days, paid_days),
        unpaid_days = coalesce(p_unpaid_days, unpaid_days),
        reason = coalesce(nullif(trim(p_reason), ''), reason)
    where request_id = p_request_id;
  end if;

  -- Determine request_type_id if type code changed
  if p_request_type_code is not null and p_request_type_code <> '' then
    select id into v_target_type_id
    from public.request_types
    where code = p_request_type_code and is_active = true
    limit 1;
  end if;

  -- Update main request table (requests does not have a reason column; reason lives on detail tables)
  update public.requests
  set request_type_id = coalesce(v_target_type_id, request_type_id),
      updated_at = now()
  where id = p_request_id;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.update_my_pending_request(
  uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text
) to authenticated;
grant execute on function public.update_my_pending_request(
  uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text
) to service_role;

notify pgrst, 'reload schema';
