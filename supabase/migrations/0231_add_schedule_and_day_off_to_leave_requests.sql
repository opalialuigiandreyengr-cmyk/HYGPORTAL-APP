-- Migration 0231: Add schedule, day off, and payroll class to leave requests
-- ============================================================================
-- 1. Adds time_schedule, day_off, and payroll_class columns to leave_request_details
-- 2. Updates submit_leave_request to accept and persist schedule, day off, and payroll class
-- 3. Updates update_my_pending_request to update schedule, day off, and payroll class for leave requests
-- 4. Updates get_my_requests, get_my_pending_approvals, and admin_get_all_requests
--    to return schedule, day off, and payroll class for both ESARF and Leave requests
-- ============================================================================

-- Step 1: Ensure columns exist on leave_request_details
alter table public.leave_request_details add column if not exists time_schedule text;
alter table public.leave_request_details add column if not exists day_off text;
alter table public.leave_request_details add column if not exists payroll_class text;

-- Step 2: Drop obsolete overloads of submit_leave_request to prevent ambiguity
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'submit_leave_request'
      and pronamespace = 'public'::regnamespace
      and pronargs < 10
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end;
$$;

-- Step 3: Canonical submit_leave_request with schedule, day-off, payroll class, and custom approvers
create or replace function public.submit_leave_request(
  p_leave_type text,
  p_leave_category text,
  p_start_date date,
  p_end_date date,
  p_paid_days numeric,
  p_unpaid_days numeric,
  p_reason text,
  p_time_schedule text default null,
  p_day_off text default null,
  p_payroll_class text default null,
  p_custom_approvers jsonb default null
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
  v_custom_app_elem jsonb;
  v_custom_matched boolean := false;
  v_step_approver_emp_id uuid;
  v_step_approver_user_id uuid;
  v_step_resolved_level int;
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

  -- Check Day-off exclusions (coalescing parameter with profile details)
  v_day_off := coalesce(nullif(trim(p_day_off), ''), (
    select epd.day_off
    from public.employee_profile_details epd
    where epd.employee_id = v_profile.employee_id
    limit 1
  ), '');

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
      total_days,
      time_schedule,
      day_off,
      payroll_class
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
      1,
      nullif(trim(p_time_schedule), ''),
      nullif(trim(p_day_off), ''),
      nullif(trim(p_payroll_class), '')
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
    total_days,
    time_schedule,
    day_off,
    payroll_class
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
    v_total_days,
    nullif(trim(p_time_schedule), ''),
    nullif(trim(p_day_off), ''),
    nullif(trim(p_payroll_class), '')
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

    v_step_approver_emp_id := v_approver.approver_employee_id;
    v_step_approver_user_id := v_approver.approver_user_profile_id;
    v_step_resolved_level := coalesce(v_approver.resolved_level, v_route.approver_level);
    v_custom_matched := false;

    -- Check if custom/reassigned approver was provided for this step
    if p_custom_approvers is not null and jsonb_typeof(p_custom_approvers) = 'array' then
      for v_custom_app_elem in select * from jsonb_array_elements(p_custom_approvers) loop
        if (v_custom_app_elem->>'step_order')::int = v_step_order
           and nullif(trim(v_custom_app_elem->>'approver_employee_id'), '') is not null then
          v_step_approver_emp_id := (v_custom_app_elem->>'approver_employee_id')::uuid;
          select up.id into v_step_approver_user_id
          from public.user_profiles up
          where up.employee_id = v_step_approver_emp_id
          limit 1;
          v_step_resolved_level := coalesce((v_custom_app_elem->>'approver_level')::int, v_route.approver_level);
          v_custom_matched := true;
          exit;
        end if;
      end loop;
    end if;

    if v_step_approver_emp_id is not null then
      insert into public.request_approval_steps (
        request_id,
        step_order,
        required_function_id,
        required_level,
        assigned_approver_employee_id,
        assigned_approver_user_id,
        status,
        is_reassigned
      )
      values (
        v_request_id,
        v_step_order,
        v_assignment.function_id,
        v_step_resolved_level,
        v_step_approver_emp_id,
        v_step_approver_user_id,
        case when v_step_order = 1 then 'pending' else 'waiting' end,
        v_custom_matched
      );

      v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);
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

grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text, text, text, text, jsonb) to authenticated, anon, service_role;

-- Step 4: Update update_my_pending_request to persist schedule, day off, and payroll class for Leave
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
        and (submitted_by_employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id)
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

  -- Update leave_request_details if present (Leave)
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
        reason = coalesce(nullif(trim(p_reason), ''), reason),
        time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
        day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
        payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class)
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

-- Step 5: Update get_my_requests to coalesce schedule, day off, and payroll class from leave_request_details
create or replace function public.get_my_requests()
returns table (
  request_id uuid,
  request_type_code text,
  request_type_name text,
  status text,
  submitted_at timestamptz,
  final_approved_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  date_from date,
  date_to date,
  time_from time,
  time_to time,
  time_schedule text,
  day_off text,
  payroll_class text,
  transaction_type text,
  total_hours numeric,
  leave_type text,
  leave_category text,
  start_date date,
  end_date date,
  total_days numeric,
  paid_days numeric,
  unpaid_days numeric,
  reason text,
  perk_approval_code text,
  perk_amount numeric,
  perk_discount_amount numeric,
  perk_final_amount numeric,
  perk_benefit text,
  approval_summary jsonb
)
language sql
security definer
set search_path = public
as $$
  select * from (
    select
      r.id as request_id,
      rt.code as request_type_code,
      rt.name as request_type_name,
      r.status,
      r.submitted_at,
      r.final_approved_at,
      r.rejected_at,
      r.rejected_reason,
      coalesce(trd.date_from, tord.departure_date) as date_from,
      coalesce(trd.date_to, tord.return_date) as date_to,
      coalesce(trd.time_from, tord.departure_time) as time_from,
      coalesce(trd.time_to, tord.return_time) as time_to,
      coalesce(trd.time_schedule, lrd.time_schedule) as time_schedule,
      coalesce(trd.day_off, lrd.day_off) as day_off,
      coalesce(trd.payroll_class, lrd.payroll_class) as payroll_class,
      coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end) as transaction_type,
      trd.total_hours,
      lrd.leave_type,
      lrd.leave_category,
      coalesce(lrd.start_date, tord.departure_date) as start_date,
      coalesce(lrd.end_date, tord.return_date) as end_date,
      lrd.total_days,
      lrd.paid_days,
      lrd.unpaid_days,
      coalesce(
        trd.reason,
        lrd.reason,
        case when tord.id is not null then
          'Destination: ' || coalesce(nullif(tord.destinations, ''), 'Not specified')
          || ' | Purpose: ' || coalesce(nullif(trim(tord.purpose_of_travel), ''), 'Official Travel')
          || case when nullif(trim(tord.purpose_details), '') is not null then ' (' || trim(tord.purpose_details) || ')' else '' end
          || case when nullif(trim(tord.transport_mode), '') is not null then ' | Transport: ' || trim(tord.transport_mode) || case when nullif(trim(tord.plate_no), '') is not null then ' [' || trim(tord.plate_no) || ']' else '' end else '' end
          || case when coalesce(tord.total_budget, 0) > 0 then ' | Budget: PHP ' || to_char(tord.total_budget, 'FM999,999,999.00') else '' end
        else null end
      ) as reason,
      null::text as perk_approval_code,
      null::numeric as perk_amount,
      null::numeric as perk_discount_amount,
      null::numeric as perk_final_amount,
      null::text as perk_benefit,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'step_order', ras.step_order,
              'required_level', ras.required_level,
              'position_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, ras.required_level),
              'approver_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, ras.required_level),
              'level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, ras.required_level),
              'status', ras.status,
              'acted_at', ras.acted_at,
              'remarks', ras.remarks,
              'skipped_reason', ras.skipped_reason,
              'approver_name', coalesce(
                nullif(trim(concat_ws(' ', ae.first_name, ae.middle_name, ae.last_name, ae.suffix)), ''),
                nullif(trim(ras.approver_name), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'HYG Portal System' else null end
              ),
              'approver_position_name', coalesce(ap.name, ap_fallback.name, nullif(trim(ras.approver_position_name), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'Automated HR Perk System' else null end
              ),
              'approver_employee_no', coalesce(ae.employee_no, nullif(trim(ras.approver_employee_no), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'SYS-001' else null end
              )
            )
            order by ras.step_order asc
          )
          from public.request_approval_steps ras
          left join public.employees ae on ae.id = ras.assigned_approver_employee_id
          left join lateral (
            select ea.position_id, ea.function_id
            from public.employee_assignments ea
            where ea.employee_id = ae.id
            order by
              case when ea.is_primary = true then 0 else 1 end,
              case when ea.effective_to is null or ea.effective_to >= current_date then 0 else 1 end,
              case when ea.effective_from <= current_date then 0 else 1 end,
              ea.effective_from desc,
              ea.created_at desc
            limit 1
          ) aa on true
          left join public.positions ap on ap.id = aa.position_id
          left join lateral (
            select p_fb.authority_level, p_fb.name
            from public.positions p_fb
            where lower(trim(p_fb.name)) = lower(trim(ras.approver_position_name))
            order by case when p_fb.is_active = true then 0 else 1 end
            limit 1
          ) ap_fallback on true
          left join lateral (
            select auth_as.authority_level
            from public.authority_assignments auth_as
            where auth_as.employee_id = ae.id
              and auth_as.is_active = true
              and (auth_as.effective_to is null or auth_as.effective_to >= current_date)
            order by
              case when auth_as.function_id = aa.function_id then 0 else 1 end,
              auth_as.created_at desc
            limit 1
          ) aa_auth on true
          where ras.request_id = r.id
        ),
        '[]'::jsonb
      ) as approval_summary
    from public.requests r
    join public.request_types rt on rt.id = r.request_type_id
    left join public.time_request_details trd on trd.request_id = r.id
    left join public.leave_request_details lrd on lrd.request_id = r.id
    left join public.travel_order_request_details tord on tord.request_id = r.id
    join public.user_profiles up on up.employee_id = r.submitted_by_employee_id
    where up.auth_user_id = auth.uid()
  ) q
  order by submitted_at desc;
$$;

grant execute on function public.get_my_requests() to authenticated, anon, service_role;

-- Step 6: Update get_my_pending_approvals to coalesce schedule, day off, and payroll class from leave_request_details
create or replace function public.get_my_pending_approvals()
returns table (
  request_id uuid,
  step_id uuid,
  pending_step_id uuid,
  request_type_code text,
  request_type_name text,
  status text,
  submitted_at timestamptz,
  requester_name text,
  requester_employee_no text,
  requester_photo_url text,
  department_name text,
  position_name text,
  company_name text,
  date_from date,
  date_to date,
  time_from time,
  time_to time,
  time_schedule text,
  day_off text,
  payroll_class text,
  transaction_type text,
  total_hours numeric,
  leave_type text,
  leave_category text,
  start_date date,
  end_date date,
  total_days numeric,
  paid_days numeric,
  unpaid_days numeric,
  reason text,
  approval_summary jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    r.id as request_id,
    pending_step.id as step_id,
    pending_step.id as pending_step_id,
    rt.code as request_type_code,
    rt.name as request_type_name,
    r.status,
    r.submitted_at,
    nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), '') as requester_name,
    e.employee_no as requester_employee_no,
    e.photo_url as requester_photo_url,
    d.name as department_name,
    p.name as position_name,
    c.name as company_name,
    coalesce(trd.date_from, tord.departure_date) as date_from,
    coalesce(trd.date_to, tord.return_date) as date_to,
    coalesce(trd.time_from, tord.departure_time) as time_from,
    coalesce(trd.time_to, tord.return_time) as time_to,
    coalesce(trd.time_schedule, lrd.time_schedule) as time_schedule,
    coalesce(trd.day_off, lrd.day_off) as day_off,
    coalesce(trd.payroll_class, lrd.payroll_class) as payroll_class,
    coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end) as transaction_type,
    trd.total_hours,
    lrd.leave_type,
    lrd.leave_category,
    coalesce(lrd.start_date, tord.departure_date) as start_date,
    coalesce(lrd.end_date, tord.return_date) as end_date,
    lrd.total_days,
    lrd.paid_days,
    lrd.unpaid_days,
    coalesce(
      trd.reason,
      lrd.reason,
      case when tord.id is not null then
        'Destination: ' || coalesce(nullif(tord.destinations, ''), 'Not specified')
        || ' | Purpose: ' || coalesce(nullif(trim(tord.purpose_of_travel), ''), 'Official Travel')
        || case when nullif(trim(tord.purpose_details), '') is not null then ' (' || trim(tord.purpose_details) || ')' else '' end
        || case when nullif(trim(tord.transport_mode), '') is not null then ' | Transport: ' || trim(tord.transport_mode) || case when nullif(trim(tord.plate_no), '') is not null then ' [' || trim(tord.plate_no) || ']' else '' end else '' end
        || case when coalesce(tord.total_budget, 0) > 0 then ' | Budget: PHP ' || to_char(tord.total_budget, 'FM999,999,999.00') else '' end
      else null end
    ) as reason,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'step_order', ras.step_order,
            'required_level', ras.required_level,
            'status', ras.status,
            'acted_at', ras.acted_at,
            'skipped_reason', ras.skipped_reason,
            'remarks', ras.remarks,
            'approver_name', coalesce(
              ras.approver_name,
              nullif(trim(concat_ws(' ', app_emp.first_name, app_emp.middle_name, app_emp.last_name, app_emp.suffix)), ''),
              case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'HYG Portal System' else null end
            ),
            'approver_position_name', coalesce(
              ras.approver_position_name,
              case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'Automated HR Perk System' else null end
            ),
            'approver_employee_no', coalesce(
              ras.approver_employee_no,
              app_emp.employee_no,
              case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'SYS-001' else null end
            )
          ) order by ras.step_order
        )
        from public.request_approval_steps ras
        left join public.employees app_emp on app_emp.id = ras.assigned_approver_employee_id
        where ras.request_id = r.id
      ),
      '[]'::jsonb
    ) as approval_summary
  from public.requests r
  join public.request_types rt on rt.id = r.request_type_id
  join public.employees e on e.id = r.submitted_by_employee_id
  left join public.departments d on d.id = r.department_id
  left join public.positions p on p.id = r.requester_position_id
  left join public.companies c on c.id = r.company_id
  left join public.time_request_details trd on trd.request_id = r.id
  left join public.leave_request_details lrd on lrd.request_id = r.id
  left join public.travel_order_request_details tord on tord.request_id = r.id
  join lateral (
    select ras.id, ras.step_order
    from public.request_approval_steps ras
    join public.user_profiles up on up.auth_user_id = auth.uid()
    where ras.request_id = r.id
      and ras.status = 'pending'
      and (
        ras.assigned_approver_user_id = up.id
        or ras.assigned_approver_employee_id = up.employee_id
        or (
          ras.status = 'admin_fallback'
          and up.app_role in ('admin', 'superadmin', 'hr_manager', 'hr_staff')
        )
      )
    order by ras.step_order asc
    limit 1
  ) pending_step on true
  where r.status in ('pending', 'pre_approved', 'needs_admin_review')
  order by r.submitted_at desc;
$$;

grant execute on function public.get_my_pending_approvals() to authenticated, anon, service_role;

-- Step 7: Update admin_get_all_requests to coalesce schedule, day off, and payroll class from leave_request_details
create or replace function public.admin_get_all_requests()
returns table (
  request_id uuid,
  request_type_code text,
  request_type_name text,
  status text,
  submitted_at timestamptz,
  final_approved_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  employee_id uuid,
  employee_no text,
  employee_name text,
  employee_photo text,
  department_name text,
  position_name text,
  company_name text,
  store_name text,
  date_from date,
  date_to date,
  time_from time,
  time_to time,
  time_schedule text,
  day_off text,
  payroll_class text,
  transaction_type text,
  total_hours numeric,
  leave_type text,
  leave_category text,
  start_date date,
  end_date date,
  total_days numeric,
  paid_days numeric,
  unpaid_days numeric,
  reason text,
  perk_approval_code text,
  perk_amount numeric,
  perk_discount_amount numeric,
  perk_final_amount numeric,
  perk_benefit text,
  perk_product_name text,
  perk_quantity int,
  approval_summary jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_role text;
  v_user_profile_id uuid;
begin
  select app_role, id
  into v_user_role, v_user_profile_id
  from public.user_profiles
  where auth_user_id = auth.uid()
    and is_active = true;

  return query
  with all_requests_raw as (
    -- ESARF time + leave + travel order requests
    select
      r.id as request_id,
      rt.code as request_type_code,
      rt.name as request_type_name,
      r.status,
      r.submitted_at,
      r.final_approved_at,
      r.rejected_at,
      r.rejected_reason,
      e.id as employee_id,
      e.employee_no,
      nullif(trim(
        concat_ws(' ',
          e.first_name,
          case when nullif(trim(e.middle_name), '') is not null
               then left(trim(e.middle_name), 1) || '.'
               else null end,
          e.last_name,
          nullif(trim(e.suffix), '')
        )
      ), '') as employee_name,
      e.photo_url as employee_photo,
      d.name as department_name,
      p.name as position_name,
      c.name as company_name,
      s.name as store_name,
      coalesce(trd.date_from, tord.departure_date) as date_from,
      coalesce(trd.date_to, tord.return_date) as date_to,
      coalesce(trd.time_from, tord.departure_time) as time_from,
      coalesce(trd.time_to, tord.return_time) as time_to,
      coalesce(trd.time_schedule, lrd.time_schedule) as time_schedule,
      coalesce(trd.day_off, lrd.day_off) as day_off,
      coalesce(trd.payroll_class, lrd.payroll_class) as payroll_class,
      coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end) as transaction_type,
      trd.total_hours,
      lrd.leave_type,
      lrd.leave_category,
      coalesce(lrd.start_date, tord.departure_date) as start_date,
      coalesce(lrd.end_date, tord.return_date) as end_date,
      lrd.total_days,
      lrd.paid_days,
      lrd.unpaid_days,
      coalesce(
        trd.reason,
        lrd.reason,
        case when tord.id is not null then
          'Destination: ' || coalesce(nullif(tord.destinations, ''), 'Not specified')
          || ' | Purpose: ' || coalesce(nullif(trim(tord.purpose_of_travel), ''), 'Official Travel')
          || case when nullif(trim(tord.purpose_details), '') is not null then ' (' || trim(tord.purpose_details) || ')' else '' end
          || case when nullif(trim(tord.transport_mode), '') is not null then ' | Transport: ' || trim(tord.transport_mode) || case when nullif(trim(tord.plate_no), '') is not null then ' [' || trim(tord.plate_no) || ']' else '' end else '' end
          || case when coalesce(tord.total_budget, 0) > 0 then ' | Budget: PHP ' || to_char(tord.total_budget, 'FM999,999,999.00') else '' end
        else null end
      ) as reason,
      null::text as perk_approval_code,
      null::numeric as perk_amount,
      null::numeric as perk_discount_amount,
      null::numeric as perk_final_amount,
      null::text as perk_benefit,
      null::text as perk_product_name,
      null::int as perk_quantity,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'step_id', ras.id,
              'step_order', ras.step_order,
              'required_level', coalesce(alr.approver_level, ras.required_level),
              'level', coalesce(alr.approver_level, ras.required_level),
              'approver_level', coalesce(alr.approver_level, ras.required_level),
              'status', ras.status,
              'acted_at', ras.acted_at,
              'approved_at', case when ras.status = 'approved' then ras.acted_at else null end,
              'remarks', ras.remarks,
              'skipped_reason', ras.skipped_reason,
              'approver_name', coalesce(
                nullif(trim(
                  concat_ws(' ',
                    ae.first_name,
                    case when nullif(trim(ae.middle_name), '') is not null
                         then left(trim(ae.middle_name), 1) || '.'
                         else null end,
                    ae.last_name,
                    nullif(trim(ae.suffix), '')
                  )
                ), ''),
                nullif(trim(ras.approver_name), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'HYG Portal System' else null end
              ),
              'approver_position_name', coalesce(ap.name, nullif(trim(ras.approver_position_name), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'Automated HR Perk System' else null end
              ),
              'approver_employee_no', coalesce(ae.employee_no, nullif(trim(ras.approver_employee_no), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'SYS-001' else null end
              )
            )
            order by ras.step_order asc
          )
          from public.request_approval_steps ras
          left join public.employees ae on ae.id = ras.assigned_approver_employee_id
          left join lateral (
            select ea.position_id
            from public.employee_assignments ea
            where ea.employee_id = ae.id
              and ea.is_primary = true
              and ea.effective_from <= current_date
              and (ea.effective_to is null or ea.effective_to >= current_date)
            order by ea.effective_from desc, ea.created_at desc
            limit 1
          ) aa on true
          left join public.positions ap on ap.id = aa.position_id
          left join lateral (
            select alr.approver_level
            from public.approval_level_routes alr
            where alr.requester_level = r.requester_level
              and alr.step_order = ras.step_order
              and (alr.department_id = ea.department_id or alr.department_id is null)
            order by case when alr.department_id = ea.department_id then 0 else 1 end
            limit 1
          ) alr on true
          where ras.request_id = r.id
        ),
        '[]'::jsonb
      ) as approval_summary,
      ea.company_id as _filter_cid
    from public.requests r
    join public.request_types rt on rt.id = r.request_type_id
    join public.employees e on e.id = r.submitted_by_employee_id
    left join public.time_request_details trd on trd.request_id = r.id
    left join public.leave_request_details lrd on lrd.request_id = r.id
    left join public.travel_order_request_details tord on tord.request_id = r.id
    left join lateral (
      select ea.department_id, ea.company_id, ea.store_id, ea.position_id
      from public.employee_assignments ea
      where ea.employee_id = e.id
        and ea.is_primary = true
        and ea.effective_from <= current_date
        and (ea.effective_to is null or ea.effective_to >= current_date)
      order by ea.effective_from desc, ea.created_at desc
      limit 1
    ) ea on true
    left join public.departments d on d.id = ea.department_id
    left join public.positions p on p.id = ea.position_id
    left join public.companies c on c.id = ea.company_id
    left join public.stores s on s.id = ea.store_id

    union all

    -- Perk requests (discount / charge)
    select
      pr.id as request_id,
      pr.form_type as request_type_code,
      pr.request_label as request_type_name,
      case when pr.status = 'pending_verification' then 'pending' else pr.status end as status,
      pr.created_at as submitted_at,
      pr.approved_at as final_approved_at,
      null::timestamptz as rejected_at,
      null::text as rejected_reason,
      coalesce(e.id, pr.submitted_by_employee_id, up.employee_id) as employee_id,
      coalesce(e.employee_no, '—') as employee_no,
      coalesce(
        nullif(trim(
          concat_ws(' ',
            e.first_name,
            case when nullif(trim(e.middle_name), '') is not null
                 then left(trim(e.middle_name), 1) || '.'
                 else null end,
            e.last_name,
            nullif(trim(e.suffix), '')
          )
        ), ''),
        up.username,
        pr.email,
        'Employee'
      ) as employee_name,
      e.photo_url as employee_photo,
      coalesce(d.name, '—') as department_name,
      coalesce(p.name, '—') as position_name,
      coalesce(c.name, '—') as company_name,
      coalesce(s.name, '—') as store_name,
      pr.transaction_date as date_from,
      pr.transaction_date as date_to,
      null::time as time_from,
      null::time as time_to,
      null::text as time_schedule,
      null::text as day_off,
      null::text as payroll_class,
      pr.request_label as transaction_type,
      null::numeric as total_hours,
      null::text as leave_type,
      null::text as leave_category,
      null::date as start_date,
      null::date as end_date,
      null::numeric as total_days,
      null::numeric as paid_days,
      null::numeric as unpaid_days,
      pr.product_name as reason,
      pr.approval_code as perk_approval_code,
      pr.amount as perk_amount,
      round(pr.amount - pr.final_amount, 2) as perk_discount_amount,
      pr.final_amount as perk_final_amount,
      case
        when pr.discount_applies then '15% shared cash/credit discount'
        else 'Employee charge'
      end as perk_benefit,
      pr.product_name as perk_product_name,
      pr.quantity as perk_quantity,
      jsonb_build_array(jsonb_build_object(
        'step_order', 1,
        'required_level', 1,
        'position_level', null,
        'level', 1,
        'approver_level', 1,
        'status', pr.status,
        'acted_at', pr.approved_at,
        'approved_at', pr.approved_at,
        'remarks', null,
        'skipped_reason', null,
        'approver_name', 'Email code verified',
        'approver_position_name', null,
        'approver_employee_no', null
      )) as approval_summary,
      ea.company_id as _filter_cid
    from public.employee_perk_requests pr
    left join public.user_profiles up on up.id = pr.submitted_by_user_id
    left join public.employees e on e.id = coalesce(pr.submitted_by_employee_id, up.employee_id)
    left join lateral (
      select ea.department_id, ea.company_id, ea.store_id, ea.position_id
      from public.employee_assignments ea
      where ea.employee_id = coalesce(e.id, pr.submitted_by_employee_id, up.employee_id)
      order by
        case when ea.is_primary = true then 0 else 1 end,
        case when ea.effective_to is null or ea.effective_to >= current_date then 0 else 1 end,
        ea.effective_from desc,
        ea.created_at desc
      limit 1
    ) ea on true
    left join public.departments d on d.id = ea.department_id
    left join public.positions p on p.id = ea.position_id
    left join public.companies c on c.id = ea.company_id
    left join public.stores s on s.id = ea.store_id
  )
  select
    ar.request_id, ar.request_type_code, ar.request_type_name, ar.status,
    ar.submitted_at, ar.final_approved_at, ar.rejected_at, ar.rejected_reason,
    ar.employee_id, ar.employee_no, ar.employee_name, ar.employee_photo,
    ar.department_name, ar.position_name, ar.company_name, ar.store_name,
    ar.date_from, ar.date_to, ar.time_from, ar.time_to,
    ar.time_schedule, ar.day_off, ar.payroll_class, ar.transaction_type, ar.total_hours,
    ar.leave_type, ar.leave_category, ar.start_date, ar.end_date,
    ar.total_days, ar.paid_days, ar.unpaid_days, ar.reason,
    ar.perk_approval_code, ar.perk_amount, ar.perk_discount_amount, ar.perk_final_amount,
    ar.perk_benefit, ar.perk_product_name, ar.perk_quantity,
    ar.approval_summary
  from all_requests_raw ar
  where (
    v_user_role is null
    or v_user_role <> 'hr'
    or not exists (
      select 1
      from public.hr_company_assignments
      where user_profile_id = v_user_profile_id
    )
    or ar._filter_cid in (
      select company_id
      from public.hr_company_assignments
      where user_profile_id = v_user_profile_id
    )
    or ar._filter_cid is null
  )
  order by ar.submitted_at desc nulls last;
end;
$$;

grant execute on function public.admin_get_all_requests() to authenticated, anon, service_role;

notify pgrst, 'reload schema';
