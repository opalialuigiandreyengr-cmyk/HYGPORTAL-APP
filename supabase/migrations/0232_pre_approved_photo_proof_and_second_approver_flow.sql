-- Migration 0232: Pre-Approved OT/Offset Photo Proof and Second Approver Routing Flow
-- ============================================================================
-- 1. decide_approval_step:
--    When Approver 1 approves a pre-approved request (status = 'pre_approved' or [PreApproved] in reason):
--    - If photo proof has NOT been attached yet, do NOT promote Step 2 to 'pending' yet.
--      Step 2 remains in 'waiting' status awaiting the employee's photo proof.
--    - If photo proof has ALREADY been attached, promote Step 2 to 'pending' immediately.
--
-- 2. attach_scheduled_ot_photo_proof:
--    When employee attaches photo proof to a pre-approved request:
--    - Appends proof tags to reason in time_request_details.
--    - If Step 1 is already 'approved', immediately promotes Step 2 from 'waiting' to 'pending'
--      so it now appears on the 2nd approver's Approvals screen.
--
-- 3. update_my_pending_request:
--    When an employee updates a pre-approved request with reason containing [Proof: ...]:
--    - If Step 1 is already 'approved' and Step 2 is 'waiting', promote Step 2 to 'pending'.
--
-- 4. get_my_pending_approvals:
--    Strict visibility filter for pre-approved requests:
--    - Step 1 is immediately visible to Approver 1.
--    - Step 2+ is ONLY visible to Approver 2 once:
--      (a) Step 1 is approved, AND
--      (b) Photo proof has been attached ([Proof: ...] in reason).
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
  v_has_proof boolean := false;
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

  if p_decision = 'rejected' then
    update public.requests
    set status = 'rejected',
        rejected_at = now(),
        rejected_reason = nullif(trim(coalesce(p_remarks, '')), ''),
        updated_at = now()
    where id = v_step.request_id;

    update public.request_approval_steps
    set status = 'cancelled'
    where request_id = v_step.request_id
      and status = 'waiting';

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

  -- Check if this is a pre-approved request
  v_is_pre_approved := (
    v_req.status = 'pre_approved'
    or coalesce(v_time_req.reason, '') like '%[PreApproved]%'
    or coalesce(v_time_req.transaction_type, '') like '%scheduled_ot%'
  );
  v_has_proof := (coalesce(v_time_req.reason, '') like '%[Proof:%');

  select id
  into v_next_step_id
  from public.request_approval_steps
  where request_id = v_step.request_id
    and status = 'waiting'
  order by step_order asc
  limit 1;

  if v_next_step_id is not null then
    -- For pre-approved requests:
    -- If photo proof has NOT been attached yet, do NOT promote Step 2 to pending!
    -- Step 2 remains in 'waiting' status until the requester attaches photo proof.
    if v_is_pre_approved and not v_has_proof then
      -- Step 2 remains 'waiting'
      null;
    else
      update public.request_approval_steps
      set status = 'pending'
      where id = v_next_step_id;
    end if;
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


-- 2. Update public.attach_scheduled_ot_photo_proof
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
  v_step1_approved boolean := false;
  v_next_step_id uuid;
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

  -- Append proof tags to reason
  v_new_reason := trim(coalesce(v_time_req.reason, '')) || ' ' || trim(coalesce(p_proof_tags, ''));

  update public.time_request_details
  set reason = trim(v_new_reason)
  where request_id = p_request_id;

  update public.requests
  set updated_at = now()
  where id = p_request_id;

  -- Check if Step 1 is already approved
  select exists (
    select 1 from public.request_approval_steps
    where request_id = p_request_id
      and step_order = 1
      and status = 'approved'
  ) into v_step1_approved;

  if v_step1_approved then
    -- Step 1 was already approved! Now promote next waiting step (Step 2) to 'pending'
    select id into v_next_step_id
    from public.request_approval_steps
    where request_id = p_request_id
      and status = 'waiting'
    order by step_order asc
    limit 1;

    if v_next_step_id is not null then
      update public.request_approval_steps
      set status = 'pending'
      where id = v_next_step_id;
    end if;
  end if;

  return 'Photo proof attached successfully.';
end;
$$;

grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to authenticated;
grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to service_role;


-- 3. Update public.get_my_pending_approvals to enforce photo proof & step 1 approval for step 2+
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
    and (
      -- If not a pre-approved request or if it's the first step (step 1), show normally to approver
      not (
        r.status = 'pre_approved'
        or coalesce(trd.reason, '') like '%[PreApproved]%'
        or coalesce(trd.transaction_type, '') like '%scheduled_ot%'
      )
      or pending_step.step_order = 1
      or (
        -- For Step 2+ on pre-approved requests:
        -- MUST have attached photo proof AND Step 1 must be approved!
        coalesce(trd.reason, '') like '%[Proof:%'
        and exists (
          select 1 from public.request_approval_steps s1
          where s1.request_id = r.id
            and s1.step_order < pending_step.step_order
            and s1.status = 'approved'
        )
      )
    )
  order by r.submitted_at desc;
$$;

grant execute on function public.get_my_pending_approvals() to authenticated, anon, service_role;

-- 4. Update update_my_pending_request to promote step 2 if proof attached on approved step 1
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
  v_is_pre_approved boolean := false;
  v_step1_approved boolean := false;
  v_next_waiting_id uuid;
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

    -- If this is a pre-approved request and photo proof was attached in p_reason
    v_is_pre_approved := (
      v_req.status = 'pre_approved'
      or coalesce(p_reason, '') like '%[PreApproved]%'
      or coalesce(p_transaction_type, '') like '%scheduled_ot%'
    );

    if v_is_pre_approved and coalesce(p_reason, '') like '%[Proof:%' then
      -- Check if Step 1 is approved
      select exists (
        select 1 from public.request_approval_steps
        where request_id = p_request_id
          and step_order = 1
          and status = 'approved'
      ) into v_step1_approved;

      if v_step1_approved then
        select id into v_next_waiting_id
        from public.request_approval_steps
        where request_id = p_request_id
          and status = 'waiting'
        order by step_order asc
        limit 1;

        if v_next_waiting_id is not null then
          update public.request_approval_steps
          set status = 'pending'
          where id = v_next_waiting_id;
        end if;
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

notify pgrst, 'reload schema';
