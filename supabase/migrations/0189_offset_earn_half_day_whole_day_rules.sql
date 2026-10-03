-- Migration 0189: Offset Earn Half Day and Whole Day Crediting Rules
-- Rules:
-- 1. Minimum offsetable hours is 4.00 hours (half day) and 8.00 hours (whole day).
-- 2. If total hours is below 4 hours, submission fails with 'Minimum Offset Hours Not Met'.
-- 3. If total hours is 4 up to < 8 (e.g. 4, 5, 6, 7), only 4.00 hours will be credited to the offset balance.
-- 4. If total hours is 8 or more (e.g. 8, 9, 10, 11+), only 8.00 hours will be credited to the offset balance.

-- 1. Update public.apply_offset_side_effects to enforce the 4h / 8h crediting rules upon approval
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
  v_credited_hours numeric := 0;
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

  -- For Use Offset: If already deducted on submission, do not deduct again!
  if v_action = 'use' and exists (
    select 1 from public.offset_transactions
    where request_id = p_request_id and transaction_type = 'use'
  ) then
    return;
  end if;

  -- For Earn Offset: If already credited, do not duplicate
  if v_action = 'earn' and exists (
    select 1 from public.offset_transactions
    where request_id = p_request_id and transaction_type = 'earn'
  ) then
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
    -- Legacy fallback for requests submitted prior to submission-deduction migration
    if coalesce(v_current_balance, 0) < v_hours then
      raise exception 'Insufficient offset balance at approval time (available: % hrs, needed: % hrs).',
        coalesce(v_current_balance, 0), v_hours;
    end if;
    v_new_balance := round(coalesce(v_current_balance, 0) - v_hours, 2);
    v_credited_hours := v_hours;
  elsif v_action = 'earn' then
    -- New Crediting Rules:
    -- Under 4 hrs: 0 hrs (minimum offset hours not met)
    -- 4 hrs up to < 8 hrs: 4 hrs credited (half day)
    -- 8 hrs or more: 8 hrs credited (whole day)
    if v_hours >= 8 then
      v_credited_hours := 8;
    elsif v_hours >= 4 then
      v_credited_hours := 4;
    else
      v_credited_hours := 0;
    end if;

    if v_credited_hours <= 0 then
      return;
    end if;

    v_new_balance := round(coalesce(v_current_balance, 0) + v_credited_hours, 2);
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
    case when v_action = 'earn' then v_credited_hours else v_hours end,
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


-- 2. Update public.submit_time_request to enforce 4h minimum and 4h/8h credited hours normalization
create or replace function public.submit_time_request(
  p_request_type_code text,
  p_date_from date,
  p_date_to date,
  p_time_from time,
  p_time_to time,
  p_total_hours numeric,
  p_reason text,
  p_time_schedule text,
  p_day_off text,
  p_payroll_class text,
  p_transaction_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_assignment public.employee_assignments;
  v_position public.positions;
  v_request_type public.request_types;
  v_request_id uuid;
  v_route record;
  v_approver record;
  v_step_order int := 0;
  v_used_employee_ids uuid[] := '{}';
  v_balance numeric;
  v_new_balance numeric;
  v_transaction_type text;
  v_is_use_offset boolean := false;
  v_effective_hours numeric := coalesce(p_total_hours, 0);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_request_type_code not in ('overtime', 'offset_earn', 'use_offset') then
    raise exception 'Unsupported time request type: %', p_request_type_code;
  end if;

  if p_date_to < p_date_from then
    raise exception 'Date To cannot be earlier than Date From.';
  end if;

  if nullif(trim(p_time_schedule), '') is null then
    raise exception 'Time schedule is required.';
  end if;

  if nullif(trim(p_day_off), '') is null then
    raise exception 'Day off is required.';
  end if;

  if nullif(trim(p_payroll_class), '') is null then
    raise exception 'Payroll class is required.';
  end if;

  v_transaction_type := coalesce(
    nullif(trim(p_transaction_type), ''),
    case p_request_type_code
      when 'overtime' then 'OT'
      when 'offset_earn' then 'Offset'
      when 'use_offset' then 'Use Offset'
      else p_request_type_code
    end
  );

  v_is_use_offset := (
    p_request_type_code = 'use_offset'
    or lower(v_transaction_type) like '%use_offset%'
    or lower(v_transaction_type) like '%use offset%'
    or lower(trim(coalesce(p_reason, ''))) like '%(use offset)%'
  );

  -- Offset earn rules: Minimum 4 hours required; 4-7.99h normalized to 4h, 8h+ normalized to 8h
  if (p_request_type_code = 'offset_earn' or lower(v_transaction_type) like '%offset%') and not v_is_use_offset then
    if v_effective_hours < 4 then
      raise exception 'Minimum offsetable hours not met. A minimum of 4.00 hours is required for offset.';
    elsif v_effective_hours >= 8 then
      v_effective_hours := 8;
    else
      v_effective_hours := 4;
    end if;
  end if;

  select *
  into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Your login is not linked to an employee profile.';
  end if;

  select *
  into v_assignment
  from public.employee_assignments
  where employee_id = v_profile.employee_id
    and is_primary = true
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  order by created_at desc
  limit 1;

  if v_assignment.id is null then
    raise exception 'No active employee assignment found.';
  end if;

  select *
  into v_position
  from public.positions
  where id = v_assignment.position_id;

  if v_position.id is null then
    raise exception 'No position found for active assignment.';
  end if;

  if v_is_use_offset then
    select *
    into v_request_type
    from public.request_types
    where code = 'use_offset'
      and is_active = true
    limit 1;
  end if;

  if v_request_type.id is null then
    select *
    into v_request_type
    from public.request_types
    where code = p_request_type_code
      and is_active = true
    limit 1;
  end if;

  if v_request_type.id is null then
    raise exception 'Request type is not configured: %', p_request_type_code;
  end if;

  -- Ensure employee has an offset_balances record
  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_profile.employee_id, 0, now())
  on conflict (employee_id) do nothing;

  -- If Use Offset: Check balance sufficiency and AUTOMATICALLY DEDUCT upon submission
  if v_is_use_offset then
    if coalesce(p_total_hours, 0) <= 0 then
      raise exception 'Total hours must be greater than zero for Use Offset.';
    end if;

    select coalesce(balance_hours, 0)
    into v_balance
    from public.offset_balances
    where employee_id = v_profile.employee_id
    for update;

    if coalesce(v_balance, 0) < p_total_hours then
      raise exception 'Insufficient offset balance (available: % hrs, requested: % hrs).',
        coalesce(v_balance, 0), p_total_hours;
    end if;

    v_new_balance := round(coalesce(v_balance, 0) - p_total_hours, 2);

    update public.offset_balances
    set balance_hours = v_new_balance,
        updated_at = now()
    where employee_id = v_profile.employee_id;
  elsif v_request_type.requires_offset_credit_check then
    select coalesce(balance_hours, 0)
    into v_balance
    from public.offset_balances
    where employee_id = v_profile.employee_id;

    if coalesce(v_balance, 0) < v_effective_hours then
      raise exception 'Insufficient offset balance. Available %, requested %.', coalesce(v_balance, 0), v_effective_hours;
    end if;
  end if;

  insert into public.requests (
    request_type_id,
    submitted_by_employee_id,
    submitted_by_user_id,
    company_id,
    area_id,
    cluster_id,
    store_id,
    requester_position_id,
    requester_level,
    status
  )
  values (
    v_request_type.id,
    v_profile.employee_id,
    v_profile.id,
    v_assignment.company_id,
    v_assignment.area_id,
    v_assignment.cluster_id,
    v_assignment.store_id,
    v_assignment.position_id,
    v_position.authority_level,
    'pending'
  )
  returning id into v_request_id;

  insert into public.time_request_details (
    request_id,
    date_from,
    date_to,
    time_from,
    time_to,
    total_hours,
    reason,
    time_schedule,
    day_off,
    payroll_class,
    transaction_type
  )
  values (
    v_request_id,
    p_date_from,
    p_date_to,
    p_time_from,
    p_time_to,
    v_effective_hours,
    nullif(trim(p_reason), ''),
    trim(p_time_schedule),
    trim(p_day_off),
    trim(p_payroll_class),
    v_transaction_type
  );

  if v_is_use_offset then
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
      v_request_id,
      'use',
      p_total_hours,
      v_new_balance,
      now()
    );
  end if;

  -- Build approval routes
  for v_route in
    select
      sequence_order,
      approver_position_id,
      approver_type,
      specific_approver_id,
      is_mandatory
    from public.approval_routes
    where request_type_id = v_request_type.id
      and is_active = true
    order by sequence_order asc
  loop
    for v_approver in
      select
        ea.id as assignment_id,
        ea.employee_id,
        pos.authority_level
      from public.employee_assignments ea
      join public.positions pos on pos.id = ea.position_id
      where ea.is_primary = true
        and ea.effective_from <= current_date
        and (ea.effective_to is null or ea.effective_to >= current_date)
        and (
          (v_route.approver_type = 'position' and ea.position_id = v_route.approver_position_id)
          or
          (v_route.approver_type = 'store' and ea.store_id = v_assignment.store_id and ea.position_id = v_route.approver_position_id)
          or
          (v_route.approver_type = 'cluster' and ea.cluster_id = v_assignment.cluster_id and ea.position_id = v_route.approver_position_id)
          or
          (v_route.approver_type = 'area' and ea.area_id = v_assignment.area_id and ea.position_id = v_route.approver_position_id)
          or
          (v_route.approver_type = 'specific_user' and ea.employee_id = v_route.specific_approver_id)
        )
        and ea.employee_id <> v_profile.employee_id
        and not (ea.employee_id = any(v_used_employee_ids))
    loop
      v_step_order := v_step_order + 1;
      v_used_employee_ids := array_append(v_used_employee_ids, v_approver.employee_id);

      insert into public.request_approvals (
        request_id,
        step_order,
        approver_employee_id,
        approver_position_id,
        status,
        is_current,
        is_mandatory
      )
      values (
        v_request_id,
        v_step_order,
        v_approver.employee_id,
        v_route.approver_position_id,
        'pending',
        case when v_step_order = 1 then true else false end,
        v_route.is_mandatory
      );
    end loop;
  end loop;

  if v_step_order = 0 then
    for v_approver in
      select
        ea.id as assignment_id,
        ea.employee_id,
        pos.id as position_id,
        pos.authority_level
      from public.employee_assignments ea
      join public.positions pos on pos.id = ea.position_id
      where ea.is_primary = true
        and ea.effective_from <= current_date
        and (ea.effective_to is null or ea.effective_to >= current_date)
        and pos.authority_level > v_position.authority_level
        and ea.employee_id <> v_profile.employee_id
        and (
          (v_assignment.store_id is not null and ea.store_id = v_assignment.store_id)
          or
          (v_assignment.cluster_id is not null and ea.cluster_id = v_assignment.cluster_id)
          or
          (v_assignment.area_id is not null and ea.area_id = v_assignment.area_id)
          or
          (ea.company_id = v_assignment.company_id)
        )
      order by pos.authority_level asc
      limit 1
    loop
      v_step_order := 1;
      insert into public.request_approvals (
        request_id,
        step_order,
        approver_employee_id,
        approver_position_id,
        status,
        is_current,
        is_mandatory
      )
      values (
        v_request_id,
        1,
        v_approver.employee_id,
        v_approver.position_id,
        'pending',
        true,
        true
      );
    end loop;
  end if;

  if v_step_order = 0 then
    raise exception 'No approvers could be determined for this request.';
  end if;

  return v_request_id;
end;
$$;

grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
