-- Migration 0187: Restrict auto-approved Birthday Leave grant to employees with >= 1 year of service from date hired.
-- Employees with < 1 year of service can apply manually for Birthday Leave without pay.

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
  v_total_days numeric;
  v_leave_type text;
  v_paid_days numeric;
  v_unpaid_days numeric;
  v_available_days numeric;
  v_is_birthday_leave boolean;
  v_credits_to_check numeric;
  v_hire_date date;
  v_has_one_year_service boolean;
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

  v_total_days := (p_end_date - p_start_date) + 1;
  v_is_birthday_leave := trim(p_leave_category) in ('Birthday Leave', 'Birthday Leave Grant');

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

  -- Determine employee hire date and service completion (at least 1 full year)
  select coalesce(min(effective_from), v_assignment.effective_from)
  into v_hire_date
  from public.employee_assignments
  where employee_id = v_profile.employee_id;

  v_has_one_year_service := (v_hire_date is not null and current_date >= (v_hire_date + interval '1 year'));

  -- Handle Birthday Leave vs Standard Leave days breakdown
  if v_is_birthday_leave then
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
  elsif v_leave_type = 'With Pay' then
    v_paid_days := v_total_days;
    v_unpaid_days := 0;
  elsif v_leave_type = 'Without Pay' then
    v_paid_days := 0;
    v_unpaid_days := v_total_days;
  else
    v_paid_days := coalesce(p_paid_days, 0);
    v_unpaid_days := coalesce(p_unpaid_days, 0);
  end if;

  if v_paid_days < 0 or v_unpaid_days < 0 then
    raise exception 'Leave days cannot be negative.';
  end if;

  if round((v_paid_days + v_unpaid_days)::numeric, 2) <> round(v_total_days::numeric, 2) then
    raise exception 'Paid and unpaid leave days must equal total leave days.';
  end if;

  -- ENFORCE: Check if an active/approved/pending birthday leave was already filed in the current calendar year
  if v_is_birthday_leave then
    if exists (
      select 1
      from public.requests r
      join public.leave_request_details lrd on lrd.request_id = r.id
      where r.submitted_by_employee_id = v_profile.employee_id
        and r.status not in ('rejected', 'cancelled')
        and trim(coalesce(lrd.leave_category, '')) in ('Birthday Leave', 'Birthday Leave Grant')
        and (
          extract(year from lrd.start_date) = extract(year from p_start_date)
          or extract(year from r.created_at) = extract(year from current_date)
        )
    ) then
      raise exception 'You have already applied for your Birthday Leave for this year.';
    end if;
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_profile.employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  v_available_days := public.get_available_leave_days(v_profile.employee_id);

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

  -- CASE 1: Single-day Birthday Leave for employees with >= 1 year service is AUTO-APPROVED by the HYG Portal System
  if v_is_birthday_leave and v_total_days = 1 and v_has_one_year_service then
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
      status,
      final_approved_at
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
      total_days,
      paid_days,
      unpaid_days,
      reason
    )
    values (
      v_request_id,
      'With Pay',
      trim(p_leave_category),
      p_start_date,
      p_end_date,
      1,
      1,
      0,
      trim(p_reason)
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

  -- CASE 2: Multi-day Birthday Leave, Birthday Leave Without Pay (< 1 year), or Standard Leave (Requires Approver Review)
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

  insert into public.leave_request_details (
    request_id,
    leave_type,
    leave_category,
    start_date,
    end_date,
    total_days,
    paid_days,
    unpaid_days,
    reason
  )
  values (
    v_request_id,
    v_leave_type,
    trim(p_leave_category),
    p_start_date,
    p_end_date,
    v_total_days,
    v_paid_days,
    v_unpaid_days,
    trim(p_reason)
  );

  select *
  into v_route
  from public.approval_level_routes
  where requester_level = v_position.authority_level
    and (department_id = v_assignment.department_id or department_id is null)
  order by
    case when department_id = v_assignment.department_id then 0 else 1 end,
    step_order asc
  limit 1;

  if v_route.approver_level is null then
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
      'No approval route configured.'
    );

    update public.requests
    set status = 'needs_admin_review'
    where id = v_request_id;
  else
    select *
    into v_approver
    from public.find_request_approver(
      v_assignment.id,
      v_assignment.function_id,
      v_route.approver_level,
      v_profile.employee_id,
      '{}'
    )
    limit 1;

    if coalesce(to_jsonb(v_approver)->>'approver_employee_id', '') = '' then
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
        v_route.approver_level,
        'admin_fallback',
        'No matching approver found.'
      );

      update public.requests
      set status = 'needs_admin_review'
      where id = v_request_id;
    else
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
        1,
        v_assignment.function_id,
        coalesce((to_jsonb(v_approver)->>'resolved_level')::integer, v_route.approver_level),
        (to_jsonb(v_approver)->>'approver_employee_id')::uuid,
        coalesce(
          (to_jsonb(v_approver)->>'approver_user_profile_id')::uuid,
          (to_jsonb(v_approver)->>'approver_user_id')::uuid,
          (select id from public.user_profiles where employee_id = (to_jsonb(v_approver)->>'approver_employee_id')::uuid limit 1)
        ),
        'pending'
      );
    end if;
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
      when v_is_birthday_leave and not v_has_one_year_service then 'Your Birthday Leave request (without pay) was submitted for approval.'
      when v_is_birthday_leave then 'Your multi-day Birthday Leave request was submitted for approval.'
      else 'Your leave request was submitted.'
    end,
    'request',
    v_request_id
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to authenticated;
grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to anon;
grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to service_role;

notify pgrst, 'reload schema';
