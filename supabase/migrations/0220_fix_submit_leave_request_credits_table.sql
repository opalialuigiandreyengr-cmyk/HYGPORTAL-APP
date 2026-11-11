-- Migration 0220: Fix submit_leave_request leave credits and get_available_leave_days
-- ============================================================================
-- 1. Drops any conflicting/overloaded signatures of get_available_leave_days
-- 2. Updates sync_employee_leave_credits so that it NEVER wipes out manually set
--    credits (annual_credit_days > 0) or resets usable balances to 0
-- 3. Restores get_available_leave_days(p_employee_id uuid, p_target_date date)
--    WITHOUT default current_date (to avoid ambiguous overload conflicts)
--    and ensures it accurately returns (annual_credit_days - used_days)
-- 4. Restores get_available_leave_days(p_employee_id uuid) for 1-argument calls
-- 5. Restores any leave balances that were accidentally zeroed out by sync_employee_leave_credits
-- 6. Updates submit_leave_request with safety checks for available leave credits
-- 7. Ensures update_my_pending_request properly updates leave_request_details
-- ============================================================================

-- 1. Drop any conflicting or overloaded versions of get_available_leave_days
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_signature
    from pg_proc
    where proname = 'get_available_leave_days'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_signature || ' cascade';
  end loop;
end;
$$;

-- 2. Update sync_employee_leave_credits to prevent wiping out positive balances
create or replace function public.sync_employee_leave_credits(
  p_employee_id uuid,
  p_target_date date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_date date := coalesce(p_target_date, current_date);
  v_policy record;
  v_lb public.leave_balances;
  v_target_year int := extract(year from v_target_date)::int;
begin
  if p_employee_id is null then
    return;
  end if;

  select * into v_policy
  from public.calculate_policy_leave_credits(p_employee_id, v_target_date)
  limit 1;

  select * into v_lb
  from public.leave_balances
  where employee_id = p_employee_id;

  if v_lb.id is null then
    insert into public.leave_balances (
      employee_id,
      annual_credit_days,
      used_days,
      usable_credit_days,
      allocated_year,
      last_allocated_at,
      updated_at
    )
    values (
      p_employee_id,
      coalesce(v_policy.allocated_days, 0),
      0,
      coalesce(v_policy.usable_days, 0),
      v_target_year,
      now(),
      now()
    )
    on conflict (employee_id) do nothing;
    return;
  end if;

  -- CASE A: Excluded Roles (GM: 20d, Directors: 15d, Head/Managers: 7d)
  if coalesce(v_policy.role_tier, '') = 'excluded' then
    if v_lb.allocated_year is null or v_lb.allocated_year < v_target_year then
      update public.leave_balances
      set annual_credit_days = coalesce(v_policy.allocated_days, 7),
          used_days = 0,
          usable_credit_days = coalesce(v_policy.usable_days, 7),
          allocated_year = v_target_year,
          last_allocated_at = now(),
          updated_at = now()
      where employee_id = p_employee_id;
    else
      update public.leave_balances
      set annual_credit_days = case
            when coalesce(annual_credit_days, 0) < v_policy.allocated_days then v_policy.allocated_days
            else annual_credit_days
          end,
          usable_credit_days = case
            when coalesce(annual_credit_days, 0) < v_policy.allocated_days then v_policy.allocated_days
            else annual_credit_days
          end,
          updated_at = now()
      where employee_id = p_employee_id;
    end if;
    return;
  end if;

  -- CASE B: Standard Ineligible / Non-regular roles under 1 year
  -- IMPORTANT: Never wipe out manual credits granted by Admin!
  if not coalesce(v_policy.is_eligible, false) then
    if coalesce(v_lb.annual_credit_days, 0) <= 0 then
      update public.leave_balances
      set annual_credit_days = 0,
          usable_credit_days = 0,
          allocated_year = v_target_year,
          updated_at = now()
      where employee_id = p_employee_id
        and (annual_credit_days <> 0 or usable_credit_days <> 0 or allocated_year is distinct from v_target_year);
    end if;
    return;
  end if;

  -- CASE C: Standard Eligible Roles (Rollover)
  if v_lb.allocated_year is null or v_lb.allocated_year < v_target_year then
    update public.leave_balances
    set annual_credit_days = coalesce(v_policy.allocated_days, 0),
        used_days = 0,
        usable_credit_days = coalesce(v_policy.usable_days, 0),
        allocated_year = v_target_year,
        last_allocated_at = now(),
        updated_at = now()
    where employee_id = p_employee_id;
    return;
  end if;

  -- CASE D: Standard Eligible Roles (Within same year)
  if v_lb.allocated_year = v_target_year then
    if coalesce(v_lb.annual_credit_days, 0) = 0 and coalesce(v_policy.allocated_days, 0) > 0 then
      update public.leave_balances
      set annual_credit_days = v_policy.allocated_days,
          usable_credit_days = v_policy.usable_days,
          last_allocated_at = now(),
          updated_at = now()
      where employee_id = p_employee_id;
    else
      update public.leave_balances
      set usable_credit_days = greatest(coalesce(usable_credit_days, 0), least(coalesce(v_lb.annual_credit_days, 0), coalesce(v_policy.usable_days, 0))),
          updated_at = now()
      where employee_id = p_employee_id;
    end if;
  end if;
end;
$$;

grant execute on function public.sync_employee_leave_credits(uuid, date) to anon, authenticated, service_role;

-- 3. Re-create 2-parameter get_available_leave_days(uuid, date) WITHOUT default parameter
-- IMPORTANT: Having NO default on p_target_date ensures that calling get_available_leave_days(uuid)
-- does NOT match this function, eliminating the "function is not unique" PostgreSQL error.
create or replace function public.get_available_leave_days(
  p_employee_id uuid,
  p_target_date date
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_date date := coalesce(p_target_date, current_date);
  v_lb public.leave_balances;
begin
  if p_employee_id is null then
    return 0;
  end if;

  -- Ensure balance record exists
  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (p_employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  select * into v_lb
  from public.leave_balances
  where employee_id = p_employee_id;

  -- Sync policy allocation ONLY if employee currently has 0 credits
  if coalesce(v_lb.annual_credit_days, 0) = 0 then
    begin
      perform public.sync_employee_leave_credits(p_employee_id, v_target_date);
      select * into v_lb
      from public.leave_balances
      where employee_id = p_employee_id;
    exception when others then
      null;
    end;
  end if;

  -- The available paid leave days is the actual remaining balance in leave_balances
  -- (annual_credit_days - used_days). This ensures whatever credits the employee has
  -- (whether from policy accrual or granted by an Admin) are fully usable.
  return greatest(0, coalesce(v_lb.annual_credit_days, 0) - coalesce(v_lb.used_days, 0));
end;
$$;

grant execute on function public.get_available_leave_days(uuid, date) to anon, authenticated, service_role;

-- 4. Re-create 1-parameter get_available_leave_days(uuid) for single-argument callers
create or replace function public.get_available_leave_days(p_employee_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select public.get_available_leave_days(p_employee_id, current_date);
$$;

grant execute on function public.get_available_leave_days(uuid) to anon, authenticated, service_role;

-- 5. Restore any leave balances that were accidentally zeroed out by previous sync Case B
update public.leave_balances lb
set annual_credit_days = sub.latest_days,
    usable_credit_days = sub.latest_days,
    updated_at = now()
from (
  select distinct on ((al.metadata->>'employee_id')::uuid)
    (al.metadata->>'employee_id')::uuid as employee_id,
    (al.metadata->>'annual_credit_days')::numeric as latest_days
  from public.audit_logs al
  where al.action = 'set_leave_credits'
    and (al.metadata->>'employee_id') is not null
    and (al.metadata->>'annual_credit_days')::numeric > 0
  order by (al.metadata->>'employee_id')::uuid, al.created_at desc
) sub
where lb.employee_id = sub.employee_id
  and coalesce(lb.annual_credit_days, 0) = 0;

-- 6. Canonical submit_leave_request
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

  v_is_birthday_leave := lower(trim(p_leave_category)) in ('birthday leave', 'birthday leave grant');

  if v_is_birthday_leave then
    select min(effective_from) into v_hire_date
    from public.employee_assignments
    where employee_id = v_profile.employee_id;

    if v_hire_date is null then
      v_has_one_year_service := false;
    else
      v_has_one_year_service := (v_hire_date + interval '1 year') <= p_start_date;
    end if;

    if not v_has_one_year_service then
      raise exception 'Birthday Leave requires at least one (1) year of continuous service.';
    end if;

    if exists (
      select 1
      from public.leave_request_details lrd
      join public.requests r on r.id = lrd.request_id
      where r.submitted_by_employee_id = v_profile.employee_id
        and lower(trim(lrd.leave_category)) = 'birthday leave'
        and extract(year from lrd.start_date) = extract(year from p_start_date)
        and r.status not in ('rejected', 'cancelled', 'deleted')
    ) then
      raise exception 'You have already applied for or used Birthday Leave for this calendar year.';
    end if;
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

  -- Birthday leave auto-approval
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
      v_leave_type,
      trim(p_leave_category),
      p_start_date,
      p_end_date,
      v_paid_days,
      v_unpaid_days,
      trim(p_reason),
      v_total_days
    );

    insert into public.request_approval_steps (
      request_id,
      step_order,
      required_function_id,
      required_level,
      assigned_approver_employee_id,
      assigned_approver_user_id,
      status,
      approved_at,
      approval_comment
    )
    values (
      v_request_id,
      1,
      v_assignment.function_id,
      1,
      null,
      null,
      'approved',
      now(),
      'Auto-approved by HYG Portal System for Birthday Leave'
    );

    return v_request_id;
  end if;

  -- Regular leave request
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

  return v_request_id;
end;
$$;

grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to authenticated, anon, service_role;

-- ============================================================================
-- Also ensure update_my_pending_request supports leave_request_details
-- ============================================================================
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
  p_custom_approvers jsonb default null
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
        reason = coalesce(nullif(trim(p_reason), ''), reason)
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
  uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text, uuid, jsonb
) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

