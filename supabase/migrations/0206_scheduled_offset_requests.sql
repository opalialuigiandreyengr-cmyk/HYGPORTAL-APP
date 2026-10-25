-- Migration 0206: Allow scheduled Offset (OT for Offset) and combined Offset requests in advance with pre-approval workflow
-- 1. Updates submit_time_request so that requests for Offset / OT for Offset (or combined with Offset)
--    applied ahead of time are classified as scheduled requests and assigned initial status 'pre_approved'.
-- 2. Sets the initial approval steps to 'waiting' awaiting employee's photo proof upon scheduled shift completion.
-- 3. Emits customized pre-approval notification message for scheduled Offset vs scheduled Overtime.

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
  v_is_scheduled_ot boolean := false;
  v_initial_status text := 'pending';
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

  -- Determine if OT or Offset is applied ahead of time (scheduled OT / Offset / combo)
  v_is_scheduled_ot := (
    (p_date_from > current_date or (p_date_from = current_date and p_time_from > localtime))
    and (
      p_request_type_code in ('overtime', 'offset_earn')
      or lower(v_transaction_type) like '%ot%'
      or lower(v_transaction_type) like '%overtime%'
      or lower(v_transaction_type) like '%offset%'
    )
    and not v_is_use_offset
  );

  if v_is_scheduled_ot then
    v_initial_status := 'pre_approved';
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

    if coalesce(v_balance, 0) < p_total_hours then
      raise exception 'Insufficient offset balance. Available %, requested %.', coalesce(v_balance, 0), p_total_hours;
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
    v_initial_status
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

  -- Build approval routes using approval_level_routes and find_request_approver
  for v_route in
    select distinct on (step_order) *
    from public.approval_level_routes
    where requester_level = v_position.authority_level
      and (department_id = v_assignment.department_id or department_id is null)
    order by
      step_order asc,
      case when department_id = v_assignment.department_id then 0 else 1 end
    limit coalesce(v_request_type.approval_count, 1)
  loop
    select *
    into v_approver
    from public.find_request_approver(
      v_assignment.id,
      v_assignment.function_id,
      v_route.approver_level,
      v_profile.employee_id,
      v_used_employee_ids
    )
    limit 1;

    if coalesce((to_jsonb(v_approver)->>'approver_employee_id'), '') <> '' then
      v_step_order := v_step_order + 1;

      insert into public.request_approval_steps (
        request_id,
        step_order,
        required_function_id,
        required_level,
        assigned_approver_employee_id,
        assigned_approver_user_id,
        status
      )
      values (
        v_request_id,
        v_step_order,
        v_assignment.function_id,
        coalesce((to_jsonb(v_approver)->>'resolved_level')::integer, v_route.approver_level),
        (to_jsonb(v_approver)->>'approver_employee_id')::uuid,
        coalesce(
          (to_jsonb(v_approver)->>'approver_user_profile_id')::uuid,
          (to_jsonb(v_approver)->>'approver_user_id')::uuid,
          (select id from public.user_profiles where employee_id = (to_jsonb(v_approver)->>'approver_employee_id')::uuid limit 1)
        ),
        case when v_is_scheduled_ot then 'waiting' when v_step_order = 1 then 'pending' else 'waiting' end
      );

      v_used_employee_ids := array_append(v_used_employee_ids, (to_jsonb(v_approver)->>'approver_employee_id')::uuid);
    end if;
  end loop;

  if v_step_order = 0 then
    insert into public.request_approval_steps (
      request_id,
      step_order,
      required_function_id,
      required_level,
      status,
      skipped_reason
    )
    values (
      v_request_id,
      1,
      v_assignment.function_id,
      v_position.authority_level,
      'admin_fallback',
      'No approval route configured or matching approver found.'
    );

    update public.requests
    set status = 'needs_admin_review'
    where id = v_request_id;
  end if;

  insert into public.notifications (
    employee_id,
    user_profile_id,
    title,
    message,
    link_type,
    link_id
  )
  values (
    v_profile.employee_id,
    v_profile.id,
    case
      when v_is_scheduled_ot and (p_request_type_code = 'offset_earn' or lower(v_transaction_type) like '%offset%')
        then 'Scheduled Offset pre-approved'
      when v_is_scheduled_ot
        then 'Scheduled OT pre-approved'
      else 'Request submitted'
    end,
    case
      when v_is_scheduled_ot and (p_request_type_code = 'offset_earn' or lower(v_transaction_type) like '%offset%')
        then 'Your scheduled offset request is pre-approved. Remember to attach photo proof on your scheduled date from the Requests tab.'
      when v_is_scheduled_ot
        then 'Your scheduled overtime request is pre-approved. Remember to attach photo proof on your scheduled date from the Requests tab.'
      when v_is_use_offset
        then 'Your Use Offset request was submitted. ' || p_total_hours || ' hr(s) deducted from offset balance.'
      else 'Your ' || v_transaction_type || ' request was submitted.'
    end,
    'request',
    v_request_id
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to anon;
grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to service_role;
