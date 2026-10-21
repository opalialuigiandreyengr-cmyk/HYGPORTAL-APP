-- Migration 0201: Pre-approved scheduled overtime requests
-- 1. Updates submit_time_request to pre-approve overtime requests applied ahead of time (scheduled OT).
--    Scheduled OT requests are marked with status = 'pre_approved' and their approval steps start in 'waiting'
--    status so they do not appear in approvers' queues until the user attaches photo proof.
-- 2. Updates get_my_pending_approvals to ensure pre-approved requests awaiting photo proof are excluded.
-- 3. Adds attach_scheduled_ot_photo_proof RPC to attach photo proof and forward request to approver.
-- 4. Updates update_my_pending_request and delete_my_pending_request to allow 'pre_approved' requests.

-- 1. Alter requests_status_check constraint
alter table public.requests
  drop constraint if exists requests_status_check;

alter table public.requests
  add constraint requests_status_check check (
    status in (
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'needs_admin_review',
      'admin_fallback',
      'pre_approved',
      'validated',
      'submitted',
      'pending_hr',
      'waiting'
    )
  ) not valid;

-- 2. Update public.submit_time_request
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

  -- Determine if OT is applied ahead of time (scheduled OT)
  v_is_scheduled_ot := (
    (p_date_from > current_date or (p_date_from = current_date and p_time_from > localtime))
    and (p_request_type_code = 'overtime' or lower(v_transaction_type) like '%ot%' or lower(v_transaction_type) like '%overtime%')
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
    case when v_is_scheduled_ot then 'Scheduled OT pre-approved' else 'Request submitted' end,
    case
      when v_is_scheduled_ot then 'Your scheduled overtime request is pre-approved. Remember to attach photo proof on your scheduled date from the Requests tab.'
      else 'Your request has been submitted and is pending review.'
    end,
    'time_request',
    v_request_id
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to service_role;


-- 2. Update public.get_my_pending_approvals to exclude 'pre_approved' requests
create or replace function public.get_my_pending_approvals()
returns table (
  request_id uuid,
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
    trd.date_from,
    trd.date_to,
    trd.time_from,
    trd.time_to,
    trd.time_schedule,
    trd.day_off,
    trd.payroll_class,
    trd.transaction_type,
    trd.total_hours,
    lrd.leave_type,
    lrd.leave_category,
    lrd.start_date,
    lrd.end_date,
    lrd.total_days,
    lrd.paid_days,
    lrd.unpaid_days,
    coalesce(trd.reason, lrd.reason) as reason,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'step_order', route_step.step_order,
            'required_level', route_step.required_level,
            'position_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level),
            'approver_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, route_step.required_level),
            'level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, route_step.required_level),
            'status', route_step.status,
            'acted_at', route_step.acted_at,
            'remarks', route_step.remarks,
            'skipped_reason', route_step.skipped_reason,
            'approver_name', coalesce(
              nullif(trim(concat_ws(' ', ae.first_name, ae.middle_name, ae.last_name, ae.suffix)), ''),
              nullif(trim(route_step.approver_name), '')
            ),
            'approver_position_name', coalesce(ap.name, ap_fallback.name, nullif(trim(route_step.approver_position_name), '')),
            'approver_employee_no', coalesce(ae.employee_no, nullif(trim(route_step.approver_employee_no), ''))
          )
          order by route_step.step_order asc
        )
        from public.request_approval_steps route_step
        left join public.employees ae on ae.id = route_step.assigned_approver_employee_id
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
          where lower(trim(p_fb.name)) = lower(trim(route_step.approver_position_name))
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
        where route_step.request_id = r.id
      ),
      '[]'::jsonb
    ) as approval_summary
  from public.request_approval_steps pending_step
  join public.requests r on r.id = pending_step.request_id
  join public.request_types rt on rt.id = r.request_type_id
  join public.employees e on e.id = r.submitted_by_employee_id
  left join public.time_request_details trd on trd.request_id = r.id
  left join public.leave_request_details lrd on lrd.request_id = r.id
  left join lateral (
    select ea.department_id, ea.company_id, ea.position_id
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
  join public.user_profiles up on up.employee_id = pending_step.assigned_approver_employee_id
  where up.auth_user_id = auth.uid()
    and pending_step.status = 'pending'
    and r.status <> 'pre_approved';
$$;

grant execute on function public.get_my_pending_approvals() to authenticated;
grant execute on function public.get_my_pending_approvals() to anon;
grant execute on function public.get_my_pending_approvals() to service_role;


-- 3. Create public.attach_scheduled_ot_photo_proof RPC
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
  v_first_step_id uuid;
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
  set status = 'pending',
      updated_at = now()
  where id = p_request_id;

  -- Activate first approval step in request_approval_steps so it appears in approver queue
  select id into v_first_step_id
  from public.request_approval_steps
  where request_id = p_request_id
  order by step_order asc
  limit 1;

  if v_first_step_id is not null then
    update public.request_approval_steps
    set status = 'pending'
    where id = v_first_step_id
      and status = 'waiting';
  return 'Photo proof attached and request forwarded to approver.';
end;
$$;

grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to authenticated;
grant execute on function public.attach_scheduled_ot_photo_proof(uuid, text) to service_role;


-- 4. Update update_my_pending_request to allow editing pre_approved requests
-- Update status check condition
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
  v_prev_hours_used numeric := 0;
  v_new_hours numeric := 0;
  v_hours_diff numeric := 0;
  v_current_bal numeric := 0;
  v_new_bal numeric := 0;
  v_new_is_use_offset boolean := false;
  v_resolved_trans text := '';
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

    v_resolved_trans := lower(coalesce(p_transaction_type, (select transaction_type from public.time_request_details where request_id = p_request_id), ''));
    v_new_is_use_offset := (
      coalesce(p_request_type_code, '') = 'use_offset'
      or v_resolved_trans like '%use_offset%'
      or v_resolved_trans like '%use offset%'
    );

    v_new_hours := coalesce(p_total_hours, (select total_hours from public.time_request_details where request_id = p_request_id), 0);

    -- Calculate previously deducted hours for this request
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

        if exists (select 1 from public.offset_transactions where request_id = p_request_id and transaction_type = 'use') then
          update public.offset_transactions
          set hours = v_new_hours,
              balance_after = v_new_bal,
              created_at = now()
          where request_id = p_request_id and transaction_type = 'use';
        else
          insert into public.offset_transactions (employee_id, request_id, transaction_type, hours, balance_after, created_at)
          values (v_profile.employee_id, p_request_id, 'use', v_new_hours, v_new_bal, now());
        end if;
      elsif v_hours_diff < 0 then
        select coalesce(balance_hours, 0)
        into v_current_bal
        from public.offset_balances
        where employee_id = v_profile.employee_id
        for update;

        v_new_bal := round(coalesce(v_current_bal, 0) + abs(v_hours_diff), 2);

        update public.offset_balances
        set balance_hours = v_new_bal,
            updated_at = now()
        where employee_id = v_profile.employee_id;

        update public.offset_transactions
        set hours = v_new_hours,
            balance_after = v_new_bal,
            created_at = now()
        where request_id = p_request_id and transaction_type = 'use';
      end if;
    end if;

    update public.time_request_details
    set date_from = coalesce(p_date_from, date_from),
        date_to = coalesce(p_date_to, date_to),
        time_from = coalesce(p_time_from, time_from),
        time_to = coalesce(p_time_to, time_to),
        total_hours = coalesce(p_total_hours, total_hours),
        time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
        day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
        payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class),
        transaction_type = coalesce(nullif(trim(p_transaction_type), ''), transaction_type),
        reason = coalesce(nullif(trim(p_reason), ''), reason)
    where request_id = p_request_id;
  end if;

  -- Update leave_request_details if present
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

  -- Determine request_type_id if type code changed
  if p_request_type_code is not null and p_request_type_code <> '' then
    select id into v_target_type_id
    from public.request_types
    where code = p_request_type_code and is_active = true
    limit 1;
  end if;

  update public.requests
  set request_type_id = coalesce(v_target_type_id, request_type_id),
      updated_at = now()
  where id = p_request_id;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.update_my_pending_request(uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.update_my_pending_request(uuid, date, date, time, time, numeric, text, text, text, text, text, text, date, date, numeric, numeric, numeric, text, text) to service_role;


-- 5. Update delete_my_pending_request to allow 'pre_approved' requests
create or replace function public.delete_my_pending_request(
  p_request_id uuid,
  p_is_perk boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_req public.requests;
  v_perk_req public.employee_perk_requests;
  v_refund_hours numeric := 0;
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

  if p_is_perk then
    select * into v_perk_req
    from public.employee_perk_requests
    where id = p_request_id
      and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id);

    if v_perk_req.id is null then
      raise exception 'Perk request not found.';
    end if;

    if v_perk_req.status not in ('pending', 'submitted', 'waiting', 'pre_approved') then
      raise exception 'Only pending perk requests can be deleted.';
    end if;

    delete from public.employee_perk_requests where id = p_request_id;
    return 'Perk request deleted successfully.';
  else
    select * into v_req
    from public.requests
    where id = p_request_id;

    if v_req.id is null then
      select * into v_perk_req
      from public.employee_perk_requests
      where id = p_request_id
        and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id);

      if v_perk_req.id is not null then
        if v_perk_req.status not in ('pending', 'submitted', 'waiting', 'pre_approved') then
          raise exception 'Only pending perk requests can be deleted.';
        end if;
        delete from public.employee_perk_requests where id = p_request_id;
        return 'Perk request deleted successfully.';
      end if;

      raise exception 'Request not found.';
    end if;

    if v_req.submitted_by_employee_id != v_profile.employee_id then
      raise exception 'You can only delete your own requests.';
    end if;

    if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr', 'waiting', 'pre_approved') then
      raise exception 'Only pending requests can be deleted.';
    end if;

    if exists (
      select 1 from public.request_approval_steps
      where request_id = p_request_id
        and status ilike '%approved%'
    ) then
      raise exception 'This request has already received an approval in the timeline and cannot be deleted.';
    end if;

    -- If Use Offset was deducted, refund hours upon deletion
    select coalesce(sum(hours), 0)
    into v_refund_hours
    from public.offset_transactions
    where request_id = p_request_id
      and transaction_type = 'use';

    if v_refund_hours > 0 then
      update public.offset_balances
      set balance_hours = round(balance_hours + v_refund_hours, 2),
          updated_at = now()
      where employee_id = v_req.submitted_by_employee_id;

      insert into public.offset_transactions (
        employee_id,
        request_id,
        transaction_type,
        hours,
        balance_after,
        created_at
      )
      values (
        v_req.submitted_by_employee_id,
        p_request_id,
        'reimburse',
        v_refund_hours,
        (select balance_hours from public.offset_balances where employee_id = v_req.submitted_by_employee_id),
        now()
      );
    end if;

    delete from public.approval_push_outbox where request_id = p_request_id;
    delete from public.offset_transactions where request_id = p_request_id;
    delete from public.leave_transactions where request_id = p_request_id;
    delete from public.time_request_details where request_id = p_request_id;
    delete from public.leave_request_details where request_id = p_request_id;
    delete from public.request_approval_steps where request_id = p_request_id;
    delete from public.requests where id = p_request_id;

    return 'Request deleted successfully.';
  end if;
end;
$$;

grant execute on function public.delete_my_pending_request(uuid, boolean) to authenticated;
grant execute on function public.delete_my_pending_request(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
