-- Migration 0181: Credit total hours to offset balance when ESARF request with Offset transaction type is approved
-- Ensures that editing/updating an ESARF request or adding offset as a transaction type credits the total hours
-- to the employee's offset balance upon approval (via manager approval, auto-approval, or admin desktop approval).

-- 1. Create or replace public.apply_offset_side_effects
create or replace function public.apply_offset_side_effects(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
  v_request_type public.request_types;
  v_time public.time_request_details;
  v_current_balance numeric;
  v_new_balance numeric;
  v_action text := 'none'; -- 'earn', 'use', or 'none'
  v_hours numeric := 0;
  v_txn_type text := '';
  v_reason_text text := '';
begin
  select * into v_request
  from public.requests
  where id = p_request_id;

  if v_request.id is null then
    return;
  end if;

  -- Only apply offset effects once request is approved
  if v_request.status <> 'approved' then
    return;
  end if;

  -- Idempotency check: if this request already has an offset transaction recorded, do not duplicate
  if exists (
    select 1
    from public.offset_transactions
    where request_id = p_request_id
  ) then
    return;
  end if;

  select * into v_request_type
  from public.request_types
  where id = v_request.request_type_id;

  select * into v_time
  from public.time_request_details
  where request_id = p_request_id;

  if v_time.id is null then
    return;
  end if;

  v_txn_type := lower(trim(coalesce(v_time.transaction_type, '')));
  v_reason_text := lower(trim(coalesce(v_time.reason, '')));

  -- Determine action: 'use' vs 'earn'
  if coalesce(v_request_type.code, '') = 'use_offset'
     or coalesce(v_request_type.affects_offset_balance, '') = 'use'
     or v_txn_type like '%use_offset%'
     or v_txn_type like '%use offset%'
     or v_reason_text like '%(use offset)%' then
    v_action := 'use';
  elsif coalesce(v_request_type.code, '') = 'offset_earn'
     or coalesce(v_request_type.affects_offset_balance, '') = 'earn'
     or v_txn_type like '%offset%'
     or v_reason_text like '%(offset)%' then
    v_action := 'earn';
  end if;

  if v_action = 'none' then
    return;
  end if;

  v_hours := coalesce(v_time.total_hours, 0);
  if v_hours <= 0 then
    return;
  end if;

  -- Ensure offset_balances record exists for employee
  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_request.submitted_by_employee_id, 0, now())
  on conflict (employee_id) do nothing;

  select coalesce(balance_hours, 0)
  into v_current_balance
  from public.offset_balances
  where employee_id = v_request.submitted_by_employee_id
  for update;

  if v_action = 'use' then
    if coalesce(v_current_balance, 0) < v_hours then
      raise exception 'Insufficient offset balance at approval time (available: % hrs, needed: % hrs).',
        coalesce(v_current_balance, 0), v_hours;
    end if;
    v_new_balance := round(coalesce(v_current_balance, 0) - v_hours, 2);
  elsif v_action = 'earn' then
    v_new_balance := round(coalesce(v_current_balance, 0) + v_hours, 2);
  end if;

  update public.offset_balances
  set balance_hours = v_new_balance,
      updated_at = now()
  where employee_id = v_request.submitted_by_employee_id;

  insert into public.offset_transactions (
    employee_id,
    request_id,
    transaction_type,
    hours,
    balance_after,
    created_at
  )
  values (
    v_request.submitted_by_employee_id,
    p_request_id,
    v_action,
    v_hours,
    v_new_balance,
    now()
  );

  -- Sync request_type_id on requests table if it wasn't already set to offset
  if v_action = 'earn' and coalesce(v_request_type.code, '') <> 'offset_earn' then
    update public.requests
    set request_type_id = coalesce(
      (select id from public.request_types where code = 'offset_earn' limit 1),
      request_type_id
    )
    where id = p_request_id;
  elsif v_action = 'use' and coalesce(v_request_type.code, '') <> 'use_offset' then
    update public.requests
    set request_type_id = coalesce(
      (select id from public.request_types where code = 'use_offset' limit 1),
      request_type_id
    )
    where id = p_request_id;
  end if;
end;
$$;

grant execute on function public.apply_offset_side_effects(uuid) to authenticated;
grant execute on function public.apply_offset_side_effects(uuid) to service_role;


-- 2. Drop all previous overloads of update_my_pending_request to eliminate function ambiguity
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_signature
    from pg_proc
    where proname = 'update_my_pending_request'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_signature || ' cascade;';
  end loop;
end;
$$;

-- Create public.update_my_pending_request with p_request_type_code
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

  -- Prevent editing if any approval step has already been approved
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

    -- Update request_type_id if transaction type or request_type_code indicates offset
    if coalesce(p_request_type_code, '') = 'use_offset'
       or lower(coalesce(p_transaction_type, '')) like '%use_offset%'
       or lower(coalesce(p_transaction_type, '')) like '%use offset%' then
      select id into v_target_type_id from public.request_types where code = 'use_offset' limit 1;
      if v_target_type_id is not null then
        update public.requests set request_type_id = v_target_type_id where id = p_request_id;
      end if;
    elsif coalesce(p_request_type_code, '') = 'offset_earn'
       or lower(coalesce(p_transaction_type, '')) like '%offset%' then
      select id into v_target_type_id from public.request_types where code = 'offset_earn' limit 1;
      if v_target_type_id is not null then
        update public.requests set request_type_id = v_target_type_id where id = p_request_id;
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
  uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text
) to authenticated;

grant execute on function public.update_my_pending_request(
  uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text
) to service_role;


-- 3. Update public.admin_update_request_status to trigger side effects upon approval
create or replace function public.admin_update_request_status(
  p_request_id uuid,
  p_is_perk boolean default false,
  p_new_status text default ''
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_is_perk then
    update public.employee_perk_requests
    set status = p_new_status,
        approved_at = case when p_new_status = 'approved' then now() else approved_at end
    where id = p_request_id;
  else
    update public.requests
    set status = p_new_status,
        final_approved_at = case when p_new_status = 'approved' then now() else final_approved_at end,
        rejected_at      = case when p_new_status = 'rejected' then now() else rejected_at end
    where id = p_request_id;

    -- Also update any pending approval steps to match the new status
    if p_new_status in ('approved', 'rejected') then
      update public.request_approval_steps
      set status = p_new_status,
          acted_at = now()
      where request_id = p_request_id
        and status not in ('approved', 'rejected', 'skipped');
    end if;

    -- Trigger side effects on approval
    if p_new_status = 'approved' then
      perform public.apply_offset_side_effects(p_request_id);
      perform public.apply_leave_side_effects(p_request_id);
    end if;
  end if;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.admin_update_request_status(uuid, boolean, text) to authenticated;
grant execute on function public.admin_update_request_status(uuid, boolean, text) to service_role;


-- 4. Trigger on public.requests to guarantee side effects run whenever status becomes 'approved'
create or replace function public.handle_request_approval_side_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and (old.status is null or old.status <> 'approved') then
    perform public.apply_offset_side_effects(new.id);
    perform public.apply_leave_side_effects(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_approval_side_effects on public.requests;
create trigger trg_request_approval_side_effects
  after update of status on public.requests
  for each row
  execute function public.handle_request_approval_side_effects();


-- 5. Backfill: Credit offset balance for any already-approved ESARF requests with Offset transaction type that were missed
do $$
declare
  v_rec record;
begin
  for v_rec in
    select r.id
    from public.requests r
    join public.time_request_details trd on trd.request_id = r.id
    where r.status = 'approved'
      and (
        lower(coalesce(trd.transaction_type, '')) like '%offset%'
        or lower(coalesce(trd.reason, '')) like '%(offset)%'
      )
      and lower(coalesce(trd.transaction_type, '')) not like '%use%offset%'
      and not exists (
        select 1 from public.offset_transactions ot where ot.request_id = r.id
      )
  loop
    perform public.apply_offset_side_effects(v_rec.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
