-- Migration 0232: Pre-Approved OT Single Approver Workflow
-- ============================================================================
-- 1. Pre-approved OT requests strictly have ONE approver (the first approver).
-- 2. Users do NOT attach photo proofs on Pre-approved OT.
-- 3. Status of Pre-approved OT requests remains 'pre_approved' (displays as "PRE-APPROVED")
--    even after the 1st approver approves (with final_approved_at recorded).
-- 4. Removes (deletes) any 2nd+ approver step on Pre-approved OT requests so no 2nd
--    approver appears as "Cancelled".
-- 5. Aligns get_my_requests, get_my_pending_approvals, admin_get_all_requests,
--    admin_update_request_status, apply_offset_side_effects, and get_my_dashboard_summary
--    so the Requests tab, Approvals screen, and Admin side match.
-- ============================================================================

-- 1. Update public.decide_approval_step
create or replace function public.decide_approval_step(
  p_step_id uuid,
  p_decision text,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_step public.request_approval_steps;
  v_req public.requests;
  v_time_req public.time_request_details;
  v_next_step_id uuid;
  v_request_type_code text;
  v_is_pre_approved boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  if p_decision = 'rejected' and nullif(trim(coalesce(p_remarks, '')), '') is null then
    raise exception 'A rejection reason is required.';
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
  into v_step
  from public.request_approval_steps
  where id = p_step_id
  for update;

  if v_step.id is null then
    raise exception 'Approval step was not found.';
  end if;

  if v_step.assigned_approver_employee_id <> v_profile.employee_id then
    raise exception 'This approval is not assigned to your employee profile.';
  end if;

  if v_step.status <> 'pending' then
    raise exception 'This approval step is not pending.';
  end if;

  select * into v_req
  from public.requests
  where id = v_step.request_id;

  select * into v_time_req
  from public.time_request_details
  where request_id = v_step.request_id;

  select rt.code
  into v_request_type_code
  from public.requests r
  join public.request_types rt on rt.id = r.request_type_id
  where r.id = v_step.request_id
  limit 1;

  update public.request_approval_steps
  set status = p_decision,
      remarks = nullif(trim(coalesce(p_remarks, '')), ''),
      acted_at = now()
  where id = p_step_id;

  -- Check if this is a pre-approved request (single approver flow)
  v_is_pre_approved := (
    v_req.status = 'pre_approved'
    or coalesce(v_time_req.reason, '') like '%[PreApproved]%'
    or coalesce(v_time_req.transaction_type, '') like '%scheduled_ot%'
  );

  if p_decision = 'rejected' then
    update public.requests
    set status = 'rejected',
        rejected_at = now(),
        rejected_reason = nullif(trim(coalesce(p_remarks, '')), ''),
        updated_at = now()
    where id = v_step.request_id;

    if v_is_pre_approved then
      delete from public.request_approval_steps
      where request_id = v_step.request_id
        and step_order > 1;
    else
      update public.request_approval_steps
      set status = 'cancelled'
      where request_id = v_step.request_id
        and status = 'waiting';
    end if;

    perform public.apply_request_rejection_side_effects(v_step.request_id);

    return v_step.request_id;
  end if;

  if v_request_type_code = 'leave' then
    update public.request_approval_steps
    set status = 'cancelled'
    where request_id = v_step.request_id
      and id <> p_step_id
      and status in ('waiting', 'pending', 'admin_fallback');

    update public.requests
    set status = 'approved',
        final_approved_at = now(),
        updated_at = now()
    where id = v_step.request_id;

    perform public.apply_leave_side_effects(v_step.request_id);
    return v_step.request_id;
  end if;

  -- Auto-approve Level 8 if Level 7 approves on a request requiring Level 7 and Level 8
  if p_decision = 'approved' and v_step.required_level = 7 then
    update public.request_approval_steps
    set status = 'approved',
        acted_at = now(),
        remarks = coalesce(nullif(trim(p_remarks), ''), 'Auto-approved via Level 7 approval')
    where request_id = v_step.request_id
      and required_level = 8
      and status in ('waiting', 'pending');
  end if;

  if v_is_pre_approved then
    -- Pre-approved OT strictly has only 1 approver (Step 1).
    -- Remove any 2nd+ approver step so it never appears as cancelled.
    delete from public.request_approval_steps
    where request_id = v_step.request_id
      and id <> p_step_id;

    -- Keep status as 'pre_approved' while recording final_approved_at
    update public.requests
    set status = 'pre_approved',
        final_approved_at = now(),
        updated_at = now()
    where id = v_step.request_id;

    perform public.apply_offset_side_effects(v_step.request_id);
    perform public.apply_leave_side_effects(v_step.request_id);

    return v_step.request_id;
  end if;

  -- Standard multi-step workflow for regular requests
  select id
  into v_next_step_id
  from public.request_approval_steps
  where request_id = v_step.request_id
    and status = 'waiting'
  order by step_order asc
  limit 1;

  if v_next_step_id is not null then
    update public.request_approval_steps
    set status = 'pending'
    where id = v_next_step_id;
  else
    update public.requests
    set status = 'approved',
        final_approved_at = now(),
        updated_at = now()
    where id = v_step.request_id;

    perform public.apply_offset_side_effects(v_step.request_id);
    perform public.apply_leave_side_effects(v_step.request_id);
  end if;

  return v_step.request_id;
end;
$$;

grant execute on function public.decide_approval_step(uuid, text, text) to authenticated;
grant execute on function public.decide_approval_step(uuid, text, text) to service_role;


-- 2. Update public.submit_time_request to generate only 1 step for Pre-approved OT
create or replace function public.submit_time_request(
  p_request_type_code text,
  p_date_from date,
  p_date_to date,
  p_time_from time,
  p_time_to time,
  p_total_hours numeric,
  p_reason text,
  p_time_schedule text default null,
  p_day_off text default null,
  p_payroll_class text default null,
  p_transaction_type text default null,
  p_store_id uuid default null,
  p_custom_approvers jsonb default null,
  p_is_pre_approved boolean default false,
  p_break_from time default null,
  p_break_to time default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_assignment public.employee_assignments;
  v_request_type public.request_types;
  v_position public.positions;
  v_request_id uuid;
  v_route record;
  v_used_employee_ids uuid[] := '{}';
  v_step_order int := 0;
  v_step_approver_emp_id uuid;
  v_step_approver_user_id uuid;
  v_step_resolved_level int;
  v_balance numeric(10, 2);
  v_new_balance numeric(10, 2);
  v_is_use_offset boolean := false;
  v_is_scheduled_ot boolean := false;
  v_trans_lower text;
  v_effective_hours numeric;
  v_initial_status text;
  v_transaction_type text;
  v_custom_app_elem jsonb;
  v_custom_matched boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.employee_id is null then
    raise exception 'User profile not found.';
  end if;

  v_trans_lower := lower(coalesce(p_transaction_type, ''));
  v_is_use_offset := v_trans_lower like '%use_offset%' or v_trans_lower like '%offset_leave%' or lower(coalesce(p_request_type_code, '')) = 'use_offset';

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
    select *
    into v_request_type
    from public.request_types
    where code = p_request_type_code
    limit 1;
  end if;

  if v_request_type.id is null and v_is_use_offset then
    select *
    into v_request_type
    from public.request_types
    where code in ('time', 'esarf', 'offset')
      and is_active = true
    order by case when code = 'time' then 1 else 2 end
    limit 1;
  end if;

  if v_request_type.id is null then
    raise exception 'Request type % not found.', p_request_type_code;
  end if;

  select *
  into v_assignment
  from public.employee_assignments ea
  where ea.employee_id = v_profile.employee_id
    and ea.is_primary = true
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  order by ea.created_at desc
  limit 1;

  if v_assignment.id is null then
    select *
    into v_assignment
    from public.employee_assignments ea
    where ea.employee_id = v_profile.employee_id
    order by ea.created_at desc
    limit 1;
  end if;

  if v_assignment.id is null then
    raise exception 'Active employee assignment not found.';
  end if;

  select *
  into v_position
  from public.positions
  where id = v_assignment.position_id;

  v_is_scheduled_ot := (
    coalesce(p_is_pre_approved, false) = true
    or lower(coalesce(p_transaction_type, '')) like '%scheduled_ot%'
    or coalesce(p_reason, '') like '%[PreApproved]%'
  ) and not v_is_use_offset;

  v_transaction_type := coalesce(nullif(trim(p_transaction_type), ''), case when p_request_type_code = 'offset_earn' then 'Offset' else 'OT' end);
  v_transaction_type := trim(both ', ' from replace(replace(v_transaction_type, 'scheduled_ot,', ''), ', scheduled_ot', ''));
  v_transaction_type := replace(v_transaction_type, 'scheduled_ot', '');
  v_transaction_type := nullif(trim(v_transaction_type), '');
  v_transaction_type := coalesce(v_transaction_type, case when p_request_type_code = 'offset_earn' then 'Offset' else 'OT' end);

  -- Both regular requests and Pre-approved OT start in 'pending' status until the 1st approver acts
  v_initial_status := 'pending';

  -- Ensure employee has an offset_balances record
  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_profile.employee_id, 0, now())
  on conflict (employee_id) do nothing;

  -- Deduct offset immediately on submission if Use Offset
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
  end if;

  v_effective_hours := coalesce(p_total_hours, 0);

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
    coalesce(p_store_id, v_assignment.store_id),
    v_assignment.position_id,
    coalesce(v_position.authority_level, 1),
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
    transaction_type,
    break_from,
    break_to
  )
  values (
    v_request_id,
    p_date_from,
    p_date_to,
    p_time_from,
    p_time_to,
    v_effective_hours,
    case
      when v_is_scheduled_ot and coalesce(p_reason, '') not like '%[PreApproved]%'
      then trim(coalesce(p_reason, '')) || ' [PreApproved]'
      else p_reason
    end,
    p_time_schedule,
    p_day_off,
    p_payroll_class,
    v_transaction_type,
    p_break_from,
    p_break_to
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
  -- For Pre-approved OT (v_is_scheduled_ot), strictly limit to 1 approver (first approver)
  for v_route in
    select distinct on (step_order) *
    from public.approval_level_routes
    where requester_level = v_position.authority_level
      and (department_id = v_assignment.department_id or department_id is null)
    order by
      step_order asc,
      case when department_id = v_assignment.department_id then 0 else 1 end
    limit case when v_is_scheduled_ot then 1 else coalesce(v_request_type.approval_count, 2) end
  loop
    v_step_order := v_step_order + 1;
    v_custom_matched := false;
    v_step_approver_emp_id := null;
    v_step_approver_user_id := null;
    v_step_resolved_level := null;

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

    if v_custom_matched and v_step_approver_emp_id is not null then
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
        coalesce(v_step_resolved_level, v_route.approver_level),
        v_step_approver_emp_id,
        v_step_approver_user_id,
        case when v_step_order = 1 then 'pending' else 'waiting' end,
        true
      );
      v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);
    else
      -- Standard approver resolution
      select
        (to_jsonb(fa)->>'approver_employee_id')::uuid,
        coalesce(
          (to_jsonb(fa)->>'approver_user_profile_id')::uuid,
          (to_jsonb(fa)->>'approver_user_id')::uuid,
          (select id from public.user_profiles where employee_id = (to_jsonb(fa)->>'approver_employee_id')::uuid limit 1)
        ),
        coalesce((to_jsonb(fa)->>'resolved_level')::integer, v_route.approver_level)
      into
        v_step_approver_emp_id,
        v_step_approver_user_id,
        v_step_resolved_level
      from public.find_request_approver(
        v_assignment.id,
        v_assignment.function_id,
        v_route.approver_level,
        v_profile.employee_id,
        v_used_employee_ids
      ) fa
      limit 1;

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
          coalesce(v_step_resolved_level, v_route.approver_level),
          v_step_approver_emp_id,
          v_step_approver_user_id,
          case when v_step_order = 1 then 'pending' else 'waiting' end,
          false
        );

        v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);
      end if;
    end if;
  end loop;

  -- Fallback if no steps were inserted
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
      2,
      null,
      'admin_fallback'
    );
  end if;

  return v_request_id;
end;
$$;

grant execute on function public.submit_time_request(
  text, date, date, time, time, numeric, text, text, text, text, text, uuid, jsonb, boolean, time, time
) to authenticated, anon, service_role;


-- 3. Update public.get_my_pending_approvals
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
          and (
            not (
              r.status = 'pre_approved'
              or coalesce(trd.reason, '') like '%[PreApproved]%'
              or coalesce(trd.transaction_type, '') like '%scheduled_ot%'
            )
            or ras.step_order = 1
          )
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
    and (r.status <> 'pre_approved' or r.final_approved_at is null)
    and (
      -- If not pre-approved, show normally
      not (
        r.status = 'pre_approved'
        or coalesce(trd.reason, '') ilike '%[PreApproved]%'
        or coalesce(trd.reason, '') ilike '%[Pre-Approved]%'
        or coalesce(trd.transaction_type, '') ilike '%scheduled_ot%'
        or coalesce(trd.transaction_type, '') ilike '%for pre-approval%'
      )
      -- Pre-approved OT strictly has only 1 approver (step 1) and must never appear to step 2+ or once step 1 is approved
      or (
        pending_step.step_order = 1
        and r.final_approved_at is null
        and not exists (
          select 1 from public.request_approval_steps s1
          where s1.request_id = r.id
            and s1.step_order = 1
            and s1.status = 'approved'
        )
      )
    )
  order by r.submitted_at desc;
$$;

grant execute on function public.get_my_pending_approvals() to authenticated, anon, service_role;


-- 4. Update public.update_my_pending_request
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

  if v_req.final_approved_at is not null or exists (
    select 1 from public.request_approval_steps
    where request_id = p_request_id and status = 'approved'
  ) then
    raise exception 'Approved requests cannot be edited.';
  end if;

  if coalesce(v_req.reason, '') like '%[REJECTED]%' or lower(coalesce(v_req.status, '')) like '%partial%' then
    raise exception 'Partially approved requests cannot be edited.';
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

        if v_current_bal < v_hours_diff then
          raise exception 'Insufficient offset balance (available: % hrs, additional required: % hrs).',
            v_current_bal, v_hours_diff;
        end if;

        v_new_bal := round(v_current_bal - v_hours_diff, 2);

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
        select coalesce(balance_hours, 0)
        into v_current_bal
        from public.offset_balances
        where employee_id = v_profile.employee_id
        for update;

        v_new_bal := round(v_current_bal + abs(v_hours_diff), 2);

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
          'adjust',
          abs(v_hours_diff),
          v_new_bal,
          now()
        );
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
      transaction_type = coalesce(nullif(trim(p_transaction_type), ''), transaction_type),
      break_from = p_break_from,
      break_to = p_break_to
    where request_id = p_request_id;
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
      reason = coalesce(nullif(trim(p_reason), ''), reason),
      time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
      day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
      payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class)
    where request_id = p_request_id;
  end if;

  -- If custom approvers were specified, persist reassignments to request_approval_steps
  if p_custom_approvers is not null and jsonb_typeof(p_custom_approvers) = 'array' then
    for v_custom_app_elem in select * from jsonb_array_elements(p_custom_approvers) loop
      v_step_order := (v_custom_app_elem->>'step_order')::int;
      v_custom_emp_id := nullif(trim(v_custom_app_elem->>'approver_employee_id'), '')::uuid;

      if v_step_order is not null and v_custom_emp_id is not null then
        select up.id into v_custom_user_id
        from public.user_profiles up
        where up.employee_id = v_custom_emp_id
        limit 1;

        update public.request_approval_steps
        set
          assigned_approver_employee_id = v_custom_emp_id,
          assigned_approver_user_id = v_custom_user_id,
          is_reassigned = true,
          required_level = coalesce((v_custom_app_elem->>'approver_level')::int, required_level)
        where request_id = p_request_id
          and step_order = v_step_order
          and status in ('pending', 'waiting');
      end if;
    end loop;
  end if;

  update public.requests
  set updated_at = now(),
      store_id = coalesce(p_store_id, store_id)
  where id = p_request_id;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.update_my_pending_request to authenticated;
grant execute on function public.update_my_pending_request to service_role;


-- 5. Stub for attach_scheduled_ot_photo_proof (for backwards compatibility)
create or replace function public.attach_scheduled_ot_photo_proof(
  p_request_id uuid,
  p_proof_tags text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'Photo proof is not required for pre-approved OT.';
end;
$$;

grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to authenticated, anon, service_role;


-- 6. Update public.apply_offset_side_effects so finalized Pre-approved OT/Offset
--    (status = 'pre_approved' and final_approved_at is not null) still credits offset balance
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

  -- Only apply offset effects once request is approved or pre-approved & finalized by 1st approver
  if v_request.status <> 'approved'
     and not (v_request.status = 'pre_approved' and v_request.final_approved_at is not null) then
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
    if coalesce(v_current_balance, 0) < v_hours then
      raise exception 'Insufficient offset balance at approval time (available: % hrs, needed: % hrs).',
        coalesce(v_current_balance, 0), v_hours;
    end if;
    v_new_balance := round(coalesce(v_current_balance, 0) - v_hours, 2);
    v_credited_hours := v_hours;
  elsif v_action = 'earn' then
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


-- 7. Update public.get_my_requests:
--    Keep status as 'pre_approved' and strictly return Step 1 only for Pre-approved OT
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
      case
        when r.status in ('rejected', 'cancelled', 'validated') then r.status
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%')
             and (r.final_approved_at is not null or coalesce(s1_app.is_approved, false)) then 'pre_approved'
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%') then 'pending'
        else r.status
      end as status,
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
      case
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%')
             and r.status not in ('rejected', 'cancelled', 'validated')
             and r.final_approved_at is null
             and not coalesce(s1_app.is_approved, false)
             and lower(coalesce(trd.transaction_type, '')) not like '%for pre-approval%'
        then coalesce(nullif(trim(trd.transaction_type), ''), 'OT') || ' for Pre-Approval'
        else coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end)
      end as transaction_type,
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
            and (
              not (
                r.status = 'pre_approved'
                or coalesce(trd.reason, '') like '%[PreApproved]%'
                or coalesce(trd.transaction_type, '') like '%scheduled_ot%'
              )
              or ras.step_order = 1
            )
        ),
        '[]'::jsonb
      ) as approval_summary
    from public.requests r
    join public.request_types rt on rt.id = r.request_type_id
    left join public.time_request_details trd on trd.request_id = r.id
    left join public.leave_request_details lrd on lrd.request_id = r.id
    left join public.travel_order_request_details tord on tord.request_id = r.id
    left join lateral (
      select true as is_approved
      from public.request_approval_steps s1
      where s1.request_id = r.id
        and s1.step_order = 1
        and s1.status = 'approved'
      limit 1
    ) s1_app on true
    join public.user_profiles up on up.employee_id = r.submitted_by_employee_id
    where up.auth_user_id = auth.uid()
  ) q
  order by submitted_at desc;
$$;

grant execute on function public.get_my_requests() to authenticated, anon, service_role;


-- 8. Update public.admin_get_all_requests (Admin Side):
--    Matches Requests tab: status stays 'pre_approved' and approval_summary strictly returns Step 1 only
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
      case
        when r.status in ('rejected', 'cancelled', 'validated') then r.status
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%')
             and (r.final_approved_at is not null or coalesce(s1_app.is_approved, false)) then 'pre_approved'
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%') then 'pending'
        else r.status
      end as status,
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
      case
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%')
             and r.status not in ('rejected', 'cancelled', 'validated')
             and r.final_approved_at is null
             and not coalesce(s1_app.is_approved, false)
             and lower(coalesce(trd.transaction_type, '')) not like '%for pre-approval%'
        then coalesce(nullif(trim(trd.transaction_type), ''), 'OT') || ' for Pre-Approval'
        else coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end)
      end as transaction_type,
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
            and (
              not (
                r.status = 'pre_approved'
                or coalesce(trd.reason, '') like '%[PreApproved]%'
                or coalesce(trd.transaction_type, '') like '%scheduled_ot%'
              )
              or ras.step_order = 1
            )
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
      select true as is_approved
      from public.request_approval_steps s1
      where s1.request_id = r.id
        and s1.step_order = 1
        and s1.status = 'approved'
      limit 1
    ) s1_app on true
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


-- 9. Update public.admin_update_request_status (Admin Side):
--    Keep status as 'pre_approved' when approving Pre-approved OT and remove any 2nd+ step
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
declare
  v_is_pre_approved boolean := false;
  v_effective_status text := p_new_status;
begin
  if p_is_perk then
    update public.employee_perk_requests
    set status = p_new_status,
        approved_at = case when p_new_status = 'approved' then now() else approved_at end
    where id = p_request_id;
  else
    select (
      r.status = 'pre_approved'
      or coalesce(trd.reason, '') like '%[PreApproved]%'
      or coalesce(trd.transaction_type, '') like '%scheduled_ot%'
    )
    into v_is_pre_approved
    from public.requests r
    left join public.time_request_details trd on trd.request_id = r.id
    where r.id = p_request_id;

    -- Keep Pre-approved OT status as 'pre_approved' when approved (unless validated or rejected)
    if coalesce(v_is_pre_approved, false) and p_new_status = 'approved' then
      v_effective_status := 'pre_approved';
    end if;

    update public.requests
    set status = v_effective_status,
        final_approved_at = case when p_new_status in ('approved', 'pre_approved') then coalesce(final_approved_at, now()) else final_approved_at end,
        rejected_at       = case when p_new_status = 'rejected' then now() else rejected_at end,
        updated_at        = now()
    where id = p_request_id;

    if coalesce(v_is_pre_approved, false) then
      -- Remove any 2nd+ approver step so it never appears as cancelled
      delete from public.request_approval_steps
      where request_id = p_request_id
        and step_order > 1;
    end if;

    -- Also update any pending approval steps to match the new status
    if p_new_status in ('approved', 'rejected') then
      update public.request_approval_steps
      set status = p_new_status,
          acted_at = now()
      where request_id = p_request_id
        and status not in ('approved', 'rejected', 'skipped');
    end if;

    -- Trigger side effects on approval or rejection
    if p_new_status = 'approved' then
      perform public.apply_offset_side_effects(p_request_id);
      perform public.apply_leave_side_effects(p_request_id);
    elsif p_new_status = 'rejected' then
      perform public.apply_request_rejection_side_effects(p_request_id);
    end if;
  end if;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.admin_update_request_status(uuid, boolean, text) to authenticated;
grant execute on function public.admin_update_request_status(uuid, boolean, text) to service_role;


-- 10. Update public.get_my_dashboard_summary:
--     Exclude already-finalized Pre-approved OT requests (final_approved_at is not null) from pending count
create or replace function public.get_my_dashboard_summary()
returns table (
  pending_requests bigint,
  pending_approvals bigint,
  offset_balance numeric,
  leave_credit_remaining numeric,
  annual_credit_days numeric,
  used_days numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_pending_requests bigint := 0;
  v_pending_approvals bigint := 0;
  v_offset_balance numeric := 0;
  v_leave_credit_remaining numeric := 0;
  v_annual_credit_days numeric := 0;
  v_used_days numeric := 0;
begin
  select employee_id into v_employee_id
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_employee_id is not null then
    select count(*) into v_pending_requests
    from public.requests r
    where r.submitted_by_employee_id = v_employee_id
      and r.status in ('pending', 'pre_approved', 'submitted', 'waiting')
      and r.final_approved_at is null;

    select count(*) into v_pending_approvals
    from public.request_approval_steps s
    join public.requests r on r.id = s.request_id
    left join public.time_request_details trd on trd.request_id = r.id
    where s.assigned_approver_employee_id = v_employee_id
      and s.status = 'pending'
      and r.status in ('pending', 'pre_approved', 'submitted', 'waiting')
      and (r.status <> 'pre_approved' or r.final_approved_at is null)
      and (
        not (
          r.status = 'pre_approved'
          or coalesce(trd.reason, '') ilike '%[PreApproved]%'
          or coalesce(trd.reason, '') ilike '%[Pre-Approved]%'
          or coalesce(trd.transaction_type, '') ilike '%scheduled_ot%'
          or coalesce(trd.transaction_type, '') ilike '%for pre-approval%'
        )
        or (
          s.step_order = 1
          and r.final_approved_at is null
          and not exists (
            select 1 from public.request_approval_steps s1
            where s1.request_id = r.id
              and s1.step_order = 1
              and s1.status = 'approved'
          )
        )
      );

    select coalesce(ob.balance_hours, 0) into v_offset_balance
    from public.offset_balances ob
    where ob.employee_id = v_employee_id
    limit 1;

    select
      coalesce(lb.annual_credit_days, 0),
      coalesce(lb.used_days, 0),
      coalesce(greatest(0, lb.annual_credit_days - coalesce(lb.used_days, 0)), 0)
    into
      v_annual_credit_days,
      v_used_days,
      v_leave_credit_remaining
    from public.leave_balances lb
    where lb.employee_id = v_employee_id
    limit 1;
  end if;

  return query
  select
    v_pending_requests,
    v_pending_approvals,
    v_offset_balance,
    v_leave_credit_remaining,
    v_annual_credit_days,
    v_used_days;
end;
$$;

grant execute on function public.get_my_dashboard_summary() to authenticated, anon, service_role;


-- 11. DATA MIGRATION:
--     1) Ensure all Pre-approved OT requests carry [PreApproved] in time_request_details.reason
--     2) Finalize those whose 1st approver already approved (status = 'pre_approved', set final_approved_at, apply offset side effects)
--     3) Keep pending Pre-approved OT requests (1st approver not yet approved) in status = 'pending'
--     4) DELETE all 2nd+ approver rows (step_order > 1) for Pre-approved OT so no cancelled 2nd approver remains
do $$
declare
  r record;
begin
  -- 1. Guarantee [PreApproved] tag on time_request_details.reason so pending requests never lose their Pre-approved identity
  update public.time_request_details trd
  set reason = trim(coalesce(trd.reason, '')) || ' [PreApproved]'
  from public.requests req
  where trd.request_id = req.id
    and (
      req.status = 'pre_approved'
      or coalesce(trd.reason, '') ilike '%[Pre-Approved]%'
      or coalesce(trd.transaction_type, '') ilike '%scheduled_ot%'
      or coalesce(trd.transaction_type, '') ilike '%for pre-approval%'
    )
    and coalesce(trd.reason, '') not ilike '%[PreApproved]%';

  -- 2 & 3. Set status = 'pre_approved' (finalized) if Step 1 approved, or 'pending' if still awaiting Step 1
  for r in
    select req.id,
           exists (
             select 1 from public.request_approval_steps ras
             where ras.request_id = req.id
               and ras.step_order = 1
               and ras.status = 'approved'
           ) as step1_approved
    from public.requests req
    left join public.time_request_details trd on trd.request_id = req.id
    where (
      req.status = 'pre_approved'
      or coalesce(trd.reason, '') ilike '%[PreApproved]%'
      or coalesce(trd.reason, '') ilike '%[Pre-Approved]%'
      or coalesce(trd.transaction_type, '') ilike '%scheduled_ot%'
      or coalesce(trd.transaction_type, '') ilike '%for pre-approval%'
    )
    and req.status not in ('rejected', 'cancelled', 'validated')
  loop
    if r.step1_approved then
      update public.requests
      set status = 'pre_approved',
          final_approved_at = coalesce(final_approved_at, (
            select acted_at from public.request_approval_steps
            where request_id = r.id and step_order = 1 and status = 'approved'
            limit 1
          ), now()),
          updated_at = now()
      where id = r.id;

      perform public.apply_offset_side_effects(r.id);
    else
      update public.requests
      set status = 'pending',
          final_approved_at = null,
          updated_at = now()
      where id = r.id
        and (status <> 'pending' or final_approved_at is not null);
    end if;
  end loop;

  -- 4. Completely REMOVE (delete) all 2nd+ approver steps (step_order > 1) on Pre-approved OT requests
  --    so they never appear on the 2nd approver's Approvals screen (Pending or Approved) or as 'cancelled'
  delete from public.request_approval_steps
  where step_order > 1
    and request_id in (
      select req.id
      from public.requests req
      left join public.time_request_details trd on trd.request_id = req.id
      where (
        req.status = 'pre_approved'
        or coalesce(trd.reason, '') ilike '%[PreApproved]%'
        or coalesce(trd.reason, '') ilike '%[Pre-Approved]%'
        or coalesce(trd.transaction_type, '') ilike '%scheduled_ot%'
        or coalesce(trd.transaction_type, '') ilike '%for pre-approval%'
      )
    );
end;
$$;

notify pgrst, 'reload schema';
