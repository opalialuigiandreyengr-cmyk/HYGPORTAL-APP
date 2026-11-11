-- Migration 0228: Fix Birthday Leave hire date resolution and auto-approval approval steps
-- ============================================================================
-- 1. Fixes runtime error "column e.hire_date does not exist" in submit_leave_request.
--    The employees table does not have a hire_date column. Hire date is determined
--    from the earliest effective_from in public.employee_assignments for that employee.
-- 2. Restores proper auto-approval step recording for 1-day Birthday Leave Grants:
--    Records acted_at, remarks, approver_name ('HYG Portal System'),
--    approver_position_name ('Automated HR Perk System'), and approver_employee_no ('SYS-001')
--    on public.request_approval_steps.
-- 3. Ensures notifications are sent upon Birthday Leave auto-approval.
-- 4. Ensures case-insensitive category matching for 'Birthday Leave' and 'Birthday Leave Grant'.
-- 5. Updates apply_leave_side_effects to exempt 1 day for Birthday Leave case-insensitively.
-- ============================================================================

-- Step 1: Ensure columns exist on request_approval_steps
alter table public.request_approval_steps add column if not exists approver_name text;
alter table public.request_approval_steps add column if not exists approver_position_name text;
alter table public.request_approval_steps add column if not exists approver_employee_no text;

-- Step 2: Update apply_leave_side_effects
create or replace function public.apply_leave_side_effects(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
  v_request_type public.request_types;
  v_leave public.leave_request_details;
  v_current_available numeric;
  v_new_used numeric;
  v_balance_after numeric;
  v_days_to_deduct numeric;
begin
  select * into v_request
  from public.requests
  where id = p_request_id;

  if v_request.id is null then
    return;
  end if;

  select * into v_request_type
  from public.request_types
  where id = v_request.request_type_id;

  if v_request_type.code <> 'leave' then
    return;
  end if;

  select * into v_leave
  from public.leave_request_details
  where request_id = p_request_id;

  if v_leave.id is null or coalesce(v_leave.paid_days, 0) <= 0 then
    return;
  end if;

  -- If Birthday Leave, 1 day is granted with pay by the system without deducting leave credits
  if lower(trim(coalesce(v_leave.leave_category, ''))) in ('birthday leave', 'birthday leave grant') then
    v_days_to_deduct := greatest(0, coalesce(v_leave.paid_days, 0) - 1);
  else
    v_days_to_deduct := coalesce(v_leave.paid_days, 0);
  end if;

  -- If no credits need to be deducted (e.g. 1-day birthday leave or unpaid days only), return
  if v_days_to_deduct <= 0 then
    return;
  end if;

  if exists (
    select 1
    from public.leave_transactions
    where request_id = p_request_id
      and transaction_type = 'use_paid'
  ) then
    return;
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_request.submitted_by_employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  select coalesce(annual_credit_days - used_days, 0)
  into v_current_available
  from public.leave_balances
  where employee_id = v_request.submitted_by_employee_id
  for update;

  if v_current_available < v_days_to_deduct then
    raise exception 'Insufficient paid leave credits at approval time.';
  end if;

  update public.leave_balances
  set used_days = used_days + v_days_to_deduct,
      updated_at = now()
  where employee_id = v_request.submitted_by_employee_id
  returning used_days, annual_credit_days - used_days
  into v_new_used, v_balance_after;

  insert into public.leave_transactions (
    employee_id,
    request_id,
    transaction_type,
    days,
    balance_after
  )
  values (
    v_request.submitted_by_employee_id,
    p_request_id,
    'use_paid',
    v_days_to_deduct,
    v_balance_after
  );
end;
$$;

grant execute on function public.apply_leave_side_effects(uuid) to authenticated, anon, service_role;

-- Step 3: Canonical submit_leave_request
create or replace function public.submit_leave_request(
  p_leave_type text,
  p_leave_category text,
  p_start_date date,
  p_end_date date,
  p_paid_days numeric,
  p_unpaid_days numeric,
  p_reason text
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
  v_total_days numeric;
  v_leave_type text;
  v_paid_days numeric;
  v_unpaid_days numeric;
  v_available_days numeric;
  v_is_birthday_leave boolean;
  v_credits_to_check numeric;
  v_hire_date date;
  v_has_one_year_service boolean;
  v_day_off text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be earlier than start date.';
  end if;

  v_leave_type := trim(coalesce(p_leave_type, ''));
  if v_leave_type not in ('With Pay', 'Without Pay', 'Both') then
    raise exception 'Leave type must be With Pay, Without Pay, or Both.';
  end if;

  if nullif(trim(p_leave_category), '') is null then
    raise exception 'Leave category is required.';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Reason is required.';
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

  -- Resolve cluster and area for employee assignment
  if v_assignment.store_id is not null then
    select coalesce(s.area_id, cl.area_id, v_assignment.area_id), coalesce(s.cluster_id, v_assignment.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null then
    select coalesce(cl.area_id, v_assignment.area_id)
    into v_assignment.area_id
    from public.clusters cl
    where cl.id = v_assignment.cluster_id;
  end if;

  if v_assignment.area_id is null then
    select aa.area_id
    into v_assignment.area_id
    from public.authority_assignments aa
    where aa.employee_id = v_assignment.employee_id
      and aa.area_id is not null
      and aa.is_active = true
      and aa.effective_from <= current_date
      and (aa.effective_to is null or aa.effective_to >= current_date)
    order by aa.created_at desc
    limit 1;
  end if;

  if v_assignment.cluster_id is null then
    select aa.cluster_id
    into v_assignment.cluster_id
    from public.authority_assignments aa
    where aa.employee_id = v_assignment.employee_id
      and aa.cluster_id is not null
      and aa.is_active = true
      and aa.effective_from <= current_date
      and (aa.effective_to is null or aa.effective_to >= current_date)
    order by aa.created_at desc
    limit 1;
  end if;

  select *
  into v_position
  from public.positions
  where id = v_assignment.position_id;

  if v_position.id is null then
    raise exception 'No position found for active assignment.';
  end if;

  select *
  into v_request_type
  from public.request_types
  where code = 'leave'
    and is_active = true;

  if v_request_type.id is null then
    raise exception 'Leave request type is not configured.';
  end if;

  -- Determine employee hire date from earliest assignment
  select min(effective_from)
  into v_hire_date
  from public.employee_assignments
  where employee_id = v_profile.employee_id;

  if v_hire_date is null then
    v_hire_date := v_assignment.effective_from;
  end if;

  -- Check Day-off exclusions
  select coalesce(epd.day_off, '')
  into v_day_off
  from public.employee_profile_details epd
  where epd.employee_id = v_profile.employee_id
  limit 1;

  if nullif(trim(v_day_off), '') is not null and upper(trim(v_day_off)) not in ('NO DAY OFF', 'NO_DAY_OFF', 'NONE') then
    select count(*)
    into v_total_days
    from generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval) as s(d)
    where not (
      (upper(v_day_off) ~* '\y(SUN|SUNDAY)\y' and extract(dow from s.d) = 0)
      or (upper(v_day_off) ~* '\y(MON|MONDAY)\y' and extract(dow from s.d) = 1)
      or (upper(v_day_off) ~* '\y(TUE|TUES|TUESDAY)\y' and extract(dow from s.d) = 2)
      or (upper(v_day_off) ~* '\y(WED|WEDNESDAY)\y' and extract(dow from s.d) = 3)
      or (upper(v_day_off) ~* '\y(THU|THUR|THURS|THURSDAY)\y' and extract(dow from s.d) = 4)
      or (upper(v_day_off) ~* '\y(FRI|FRIDAY)\y' and extract(dow from s.d) = 5)
      or (upper(v_day_off) ~* '\y(SAT|SATURDAY)\y' and extract(dow from s.d) = 6)
    );
  else
    v_total_days := (p_end_date - p_start_date) + 1;
  end if;

  v_is_birthday_leave := lower(trim(p_leave_category)) in ('birthday leave', 'birthday leave grant');

  if v_is_birthday_leave then
    v_has_one_year_service := (
      v_hire_date is not null
      and (
        current_date >= (v_hire_date + interval '1 year')
        or (v_hire_date + interval '1 year') <= p_start_date
      )
    );

    if not v_has_one_year_service then
      -- Employees below 1 year of service can only apply for Birthday Leave WITHOUT PAY
      if v_leave_type not in ('Without Pay') or coalesce(p_paid_days, 0) > 0 then
        raise exception 'Birthday Leave with pay is only available to employees who have completed at least 1 year of service from their hire date. You may apply for Birthday Leave without pay.';
      end if;
      v_leave_type := 'Without Pay';
      v_paid_days := 0;
      v_unpaid_days := v_total_days;
    else
      -- Employees with >= 1 year of service receive 1 free paid day grant
      if v_total_days = 1 then
        v_leave_type := 'With Pay';
        v_paid_days := 1;
        v_unpaid_days := 0;
      elsif v_leave_type = 'Without Pay' then
        v_paid_days := 1;
        v_unpaid_days := greatest(0, v_total_days - 1);
        v_leave_type := case when v_total_days = 1 then 'With Pay' else 'Both' end;
      elsif v_leave_type = 'With Pay' then
        v_paid_days := v_total_days;
        v_unpaid_days := 0;
      else
        v_paid_days := coalesce(p_paid_days, 0);
        v_unpaid_days := coalesce(p_unpaid_days, 0);
      end if;
    end if;

    -- ENFORCE: Check if an active/approved/pending birthday leave was already filed in the calendar year
    if exists (
      select 1
      from public.leave_request_details lrd
      join public.requests r on r.id = lrd.request_id
      where r.submitted_by_employee_id = v_profile.employee_id
        and lower(trim(lrd.leave_category)) in ('birthday leave', 'birthday leave grant')
        and extract(year from lrd.start_date) = extract(year from p_start_date)
        and r.status not in ('rejected', 'cancelled', 'deleted')
    ) then
      raise exception 'You have already applied for or used Birthday Leave for this calendar year.';
    end if;
  else
    if coalesce(p_paid_days, 0) + coalesce(p_unpaid_days, 0) = v_total_days then
      v_paid_days := coalesce(p_paid_days, 0);
      v_unpaid_days := coalesce(p_unpaid_days, 0);
    else
      if v_leave_type = 'With Pay' then
        v_paid_days := v_total_days;
        v_unpaid_days := 0;
      elsif v_leave_type = 'Without Pay' then
        v_paid_days := 0;
        v_unpaid_days := v_total_days;
      else
        v_paid_days := coalesce(p_paid_days, 0);
        v_unpaid_days := coalesce(p_unpaid_days, 0);
      end if;
    end if;
  end if;

  if v_paid_days < 0 or v_unpaid_days < 0 then
    raise exception 'Leave days cannot be negative.';
  end if;

  if round((v_paid_days + v_unpaid_days)::numeric, 2) <> round(v_total_days::numeric, 2) then
    raise exception 'Paid and unpaid leave days must equal total leave days.';
  end if;

  -- Ensure leave_balances record exists
  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_profile.employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  v_available_days := public.get_available_leave_days(v_profile.employee_id, p_start_date);

  -- Safety fallback: ensure v_available_days matches actual leave_balances
  if coalesce(v_available_days, 0) = 0 then
    select greatest(0, coalesce(annual_credit_days, 0) - coalesce(used_days, 0))
    into v_available_days
    from public.leave_balances
    where employee_id = v_profile.employee_id;
  end if;
  v_available_days := coalesce(v_available_days, 0);

  -- For Birthday Leave with >= 1 year of service, 1 day is granted with pay (0 credits deducted from annual leave)
  if v_is_birthday_leave and v_has_one_year_service then
    v_credits_to_check := greatest(0, v_paid_days - 1);
  else
    v_credits_to_check := v_paid_days;
  end if;

  -- Only check against available leave credits if deduction > 0
  if v_credits_to_check > 0 and v_credits_to_check > v_available_days then
    raise exception 'Insufficient paid leave credits. Available paid leave: % day(s).', v_available_days;
  end if;

  -- CASE 1: Single-day Birthday Leave for employees with >= 1 year service is AUTO-APPROVED by the HYG Portal System
  if v_is_birthday_leave and v_total_days = 1 and v_has_one_year_service then
    insert into public.requests (
      request_type_id,
      submitted_by_employee_id,
      submitted_by_user_id,
      company_id,
      department_id,
      area_id,
      cluster_id,
      store_id,
      requester_position_id,
      requester_level,
      status,
      final_approved_at
    )
    values (
      v_request_type.id,
      v_profile.employee_id,
      v_profile.id,
      v_assignment.company_id,
      v_assignment.department_id,
      v_assignment.area_id,
      v_assignment.cluster_id,
      v_assignment.store_id,
      v_assignment.position_id,
      v_position.authority_level,
      'approved',
      now()
    )
    returning id into v_request_id;

    insert into public.leave_request_details (
      request_id,
      leave_type,
      leave_category,
      start_date,
      end_date,
      paid_days,
      unpaid_days,
      reason,
      total_days
    )
    values (
      v_request_id,
      'With Pay',
      trim(p_leave_category),
      p_start_date,
      p_end_date,
      1,
      0,
      trim(p_reason),
      1
    );

    insert into public.request_approval_steps (
      request_id,
      step_order,
      required_function_id,
      required_level,
      status,
      acted_at,
      remarks,
      approver_name,
      approver_position_name,
      approver_employee_no
    )
    values (
      v_request_id,
      1,
      v_assignment.function_id,
      1,
      'approved',
      now(),
      'System auto-approved Birthday Leave Grant',
      'HYG Portal System',
      'Automated HR Perk System',
      'SYS-001'
    );

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
      'Birthday Leave Approved',
      'Your 1-day Birthday Leave was auto-approved with pay by HYG Portal System.',
      'request',
      v_request_id
    );

    return v_request_id;
  end if;

  -- CASE 2: Multi-day Birthday Leave or Standard Leave (Requires Approver Review)
  insert into public.requests (
    request_type_id,
    submitted_by_employee_id,
    submitted_by_user_id,
    company_id,
    department_id,
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
    v_assignment.department_id,
    v_assignment.area_id,
    v_assignment.cluster_id,
    v_assignment.store_id,
    v_assignment.position_id,
    v_position.authority_level,
    'pending'
  )
  returning id into v_request_id;

  insert into public.leave_request_details (
    request_id,
    leave_type,
    leave_category,
    start_date,
    end_date,
    paid_days,
    unpaid_days,
    reason,
    total_days
  )
  values (
    v_request_id,
    v_leave_type,
    trim(p_leave_category),
    p_start_date,
    p_end_date,
    v_paid_days,
    v_unpaid_days,
    trim(p_reason),
    v_total_days
  );

  -- Build approval routes
  for v_route in
    select distinct on (step_order) *
    from public.approval_level_routes
    where requester_level = v_position.authority_level
      and (department_id = v_assignment.department_id or department_id is null)
    order by
      step_order asc,
      case when department_id = v_assignment.department_id then 0 else 1 end
    limit coalesce(v_request_type.approval_count, 2)
  loop
    v_step_order := v_step_order + 1;

    select *
    into v_approver
    from public.find_request_approver(
      v_assignment.id,
      v_assignment.function_id,
      v_route.approver_level,
      v_profile.employee_id,
      v_used_employee_ids
    );

    if v_approver.approver_employee_id is not null then
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
        coalesce(v_approver.resolved_level, v_route.approver_level),
        v_approver.approver_employee_id,
        v_approver.approver_user_profile_id,
        case when v_step_order = 1 then 'pending' else 'waiting' end
      );

      v_used_employee_ids := array_append(v_used_employee_ids, v_approver.approver_employee_id);
    end if;
  end loop;

  if v_step_order = 0 then
    insert into public.request_approval_steps (
      request_id,
      step_order,
      required_function_id,
      required_level,
      assigned_approver_employee_id,
      status
    )
    values (
      v_request_id,
      1,
      v_assignment.function_id,
      greatest(2, coalesce(v_position.authority_level, 1) + 1),
      null,
      'admin_fallback'
    );
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
    'Leave submitted',
    case
      when v_is_birthday_leave then 'Your multi-day Birthday Leave request was submitted for approval.'
      else 'Your leave request was submitted.'
    end,
    'request',
    v_request_id
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

