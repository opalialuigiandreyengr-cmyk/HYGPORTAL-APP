-- Migration 0180: Fix OB to OB/Offset edit request_type_id mapping and backfill offset balances for affected employees

-- 1. Create or replace public.update_my_pending_request to update request_type_id when transaction_type is updated to include offset
create or replace function public.update_my_pending_request(
  p_request_id uuid,
  -- ESARF fields
  p_date_from date default null,
  p_date_to date default null,
  p_time_from time default null,
  p_time_to time default null,
  p_total_hours numeric default null,
  p_time_schedule text default null,
  p_day_off text default null,
  p_payroll_class text default null,
  p_transaction_type text default null,
  -- Leave fields
  p_leave_type text default null,
  p_leave_category text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_total_days numeric default null,
  p_paid_days numeric default null,
  p_unpaid_days numeric default null,
  -- Shared
  p_reason text default null
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
  v_effective_date_from date;
  v_effective_date_to date;
  v_new_transaction_type text;
  v_target_code text;
  v_target_type_id uuid;
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
    -- Check if it's a perk request
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

  if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr') then
    raise exception 'Only pending requests can be edited.';
  end if;

  -- Update time_request_details if present (ESARF)
  if exists (select 1 from public.time_request_details where request_id = p_request_id) then
    select
      coalesce(p_date_from, date_from),
      coalesce(p_date_to, date_to, p_date_from, date_from)
    into v_effective_date_from, v_effective_date_to
    from public.time_request_details
    where request_id = p_request_id;

    if v_effective_date_to < v_effective_date_from then
      raise exception 'Date To cannot be earlier than Date From.';
    end if;

    -- Enforce single day or 2 consecutive days only for single-entry ESARF requests.
    if v_effective_date_to > v_effective_date_from + 1
       and coalesce(nullif(trim(p_reason), ''), (select reason from public.time_request_details where request_id = p_request_id), '') not like '%[Entry %' then
      raise exception 'ESARF date range can only be for a single day or two consecutive days.';
    end if;

    update public.time_request_details
    set
      date_from = coalesce(p_date_from, date_from),
      date_to = coalesce(p_date_to, date_to),
      time_from = coalesce(p_time_from, time_from),
      time_to = coalesce(p_time_to, time_to),
      total_hours = coalesce(p_total_hours, total_hours),
      reason = coalesce(nullif(trim(p_reason), ''), reason),
      time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
      day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
      payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class),
      transaction_type = coalesce(nullif(trim(p_transaction_type), ''), transaction_type)
    where request_id = p_request_id;

    -- Resolve updated transaction_type and update requests.request_type_id
    select transaction_type into v_new_transaction_type
    from public.time_request_details
    where request_id = p_request_id;

    if v_new_transaction_type is not null then
      if ilike(v_new_transaction_type, '%use offset%') or ilike(v_new_transaction_type, '%use_offset%') then
        v_target_code := 'use_offset';
      elsif ilike(v_new_transaction_type, '%offset%') then
        v_target_code := 'offset_earn';
      else
        v_target_code := 'overtime';
      end if;

      select id into v_target_type_id
      from public.request_types
      where code = v_target_code and is_active = true
      limit 1;

      if v_target_type_id is not null and (v_req.request_type_id is null or v_req.request_type_id != v_target_type_id) then
        update public.requests
        set request_type_id = v_target_type_id,
            updated_at = now()
        where id = p_request_id;
      end if;
    end if;
  end if;

  -- Update leave_request_details if present (Leave)
  if exists (select 1 from public.leave_request_details where request_id = p_request_id) then
    if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
      raise exception 'Date To cannot be earlier than Date From.';
    end if;

    update public.leave_request_details
    set
      leave_type = coalesce(nullif(trim(p_leave_type), ''), leave_type),
      leave_category = coalesce(nullif(trim(p_leave_category), ''), leave_category),
      start_date = coalesce(p_start_date, start_date),
      end_date = coalesce(p_end_date, end_date),
      total_days = coalesce(p_total_days, total_days),
      paid_days = coalesce(p_paid_days, paid_days),
      unpaid_days = coalesce(p_unpaid_days, unpaid_days),
      reason = coalesce(nullif(trim(p_reason), ''), reason)
    where request_id = p_request_id;
  end if;

  -- Update main request timestamp
  update public.requests
  set updated_at = now()
  where id = p_request_id;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.update_my_pending_request(
  uuid,
  date, date, time, time, numeric, text, text, text, text,
  text, text, date, date, numeric, numeric, numeric,
  text
) to authenticated;


-- 2. Data backfill: Fix requests table request_type_id and sync offset_balances for affected employees
do $$
declare
  r_rec record;
  v_offset_earn_type_id uuid;
begin
  select id into v_offset_earn_type_id
  from public.request_types
  where code = 'offset_earn'
  limit 1;

  if v_offset_earn_type_id is null then
    return;
  end if;

  -- Find requests where transaction_type contains offset (and not use offset) but request_type_id was not offset_earn
  for r_rec in (
    select
      r.id as request_id,
      r.submitted_by_employee_id,
      r.status,
      r.final_approved_at,
      r.request_type_id,
      coalesce(t.total_hours, r.total_hours, 0) as total_hours,
      t.transaction_type
    from public.requests r
    join public.time_request_details t on t.request_id = r.id
    where (t.transaction_type ilike '%offset%' and t.transaction_type not ilike '%use offset%' and t.transaction_type not ilike '%use_offset%')
  ) loop
    if r_rec.request_type_id != v_offset_earn_type_id then
      -- Update request_type_id to offset_earn
      update public.requests
      set request_type_id = v_offset_earn_type_id,
          updated_at = now()
      where id = r_rec.request_id;

      -- If the request is already approved, add total_hours to employee's offset_balances
      if (r_rec.status = 'approved' or r_rec.final_approved_at is not null) and coalesce(r_rec.total_hours, 0) > 0 then
        insert into public.offset_balances (employee_id, balance_hours, updated_at)
        values (r_rec.submitted_by_employee_id, r_rec.total_hours, now())
        on conflict (employee_id) do update
        set balance_hours = public.offset_balances.balance_hours + excluded.balance_hours,
            updated_at = now();
      end if;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
