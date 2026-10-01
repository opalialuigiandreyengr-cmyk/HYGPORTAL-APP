-- Migration 0185: Automatically deduct offset balance upon submission of Use Offset requests
-- and credit back the deducted hours to offset balance upon request rejection or cancellation.

-- 1. Create or replace submit_time_request to deduct offset balance immediately on submission
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
    p_total_hours,
    nullif(trim(p_reason), ''),
    trim(p_time_schedule),
    trim(p_day_off),
    trim(p_payroll_class),
    v_transaction_type
  );

  -- Record offset deduction transaction if Use Offset
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

  for v_route in
    select distinct on (step_order) *
    from public.approval_level_routes
    where requester_level = v_position.authority_level
      and (department_id = v_assignment.department_id or department_id is null)
    order by
      step_order asc,
      case when department_id = v_assignment.department_id then 0 else 1 end
    limit v_request_type.approval_count
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

    if v_approver.approver_employee_id is not null then
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
        v_approver.resolved_level,
        v_approver.approver_employee_id,
        v_approver.approver_user_profile_id,
        case when v_step_order = 1 then 'pending' else 'waiting' end
      );

      v_used_employee_ids := array_append(v_used_employee_ids, v_approver.approver_employee_id);
    end if;
  end loop;

  if v_step_order = 0 then
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
    'Request submitted',
    case
      when v_is_use_offset then 'Your Use Offset request was submitted. ' || p_total_hours || ' hr(s) deducted from offset balance.'
      else 'Your ' || v_transaction_type || ' request was submitted.'
    end,
    'request',
    v_request_id
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.submit_time_request(text, date, date, time, time, numeric, text, text, text, text, text) to service_role;


-- 2. Create public.apply_request_rejection_side_effects to credit back deducted hours when rejected
create or replace function public.apply_request_rejection_side_effects(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
  v_request_type public.request_types;
  v_time public.time_request_details;
  v_hours_to_refund numeric := 0;
  v_current_balance numeric := 0;
  v_new_balance numeric := 0;
  v_is_use_offset boolean := false;
  v_already_refunded boolean := false;
begin
  select * into v_request
  from public.requests
  where id = p_request_id;

  if v_request.id is null or v_request.status <> 'rejected' then
    return;
  end if;

  select * into v_request_type
  from public.request_types
  where id = v_request.request_type_id;

  select * into v_time
  from public.time_request_details
  where request_id = p_request_id;

  -- Determine if this is a Use Offset request
  v_is_use_offset := (
    coalesce(v_request_type.code, '') = 'use_offset'
    or coalesce(v_request_type.affects_offset_balance, '') = 'use'
    or lower(trim(coalesce(v_time.transaction_type, ''))) like '%use_offset%'
    or lower(trim(coalesce(v_time.transaction_type, ''))) like '%use offset%'
    or lower(trim(coalesce(v_time.reason, ''))) like '%(use offset)%'
    or exists (
      select 1 from public.offset_transactions
      where request_id = p_request_id and transaction_type = 'use'
    )
  );

  if not v_is_use_offset then
    return;
  end if;

  -- Idempotency check: has this request already been credited back?
  select exists (
    select 1
    from public.offset_transactions
    where request_id = p_request_id
      and transaction_type = 'adjustment'
  ) into v_already_refunded;

  if v_already_refunded then
    return;
  end if;

  -- Calculate how many hours were actually deducted on submission
  select coalesce(sum(hours), 0)
  into v_hours_to_refund
  from public.offset_transactions
  where request_id = p_request_id
    and transaction_type = 'use';

  -- If hours were never deducted for this request, do not credit back
  if v_hours_to_refund <= 0 then
    return;
  end if;

  -- Ensure offset_balances record exists
  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_request.submitted_by_employee_id, 0, now())
  on conflict (employee_id) do nothing;

  -- Lock and credit back hours
  select coalesce(balance_hours, 0)
  into v_current_balance
  from public.offset_balances
  where employee_id = v_request.submitted_by_employee_id
  for update;

  v_new_balance := round(coalesce(v_current_balance, 0) + v_hours_to_refund, 2);

  update public.offset_balances
  set balance_hours = v_new_balance,
      updated_at = now()
  where employee_id = v_request.submitted_by_employee_id;

  -- Record adjustment in offset_transactions
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
    'adjustment',
    v_hours_to_refund,
    v_new_balance,
    now()
  );

  -- Send notification to requester
  insert into public.notifications (
    employee_id,
    user_profile_id,
    title,
    message,
    link_type,
    link_id
  )
  values (
    v_request.submitted_by_employee_id,
    v_request.submitted_by_user_id,
    'Offset balance credited back',
    'Your Use Offset request was rejected. ' || v_hours_to_refund || ' hr(s) have been credited back to your offset balance.',
    'request',
    p_request_id
  );
end;
$$;

grant execute on function public.apply_request_rejection_side_effects(uuid) to authenticated;
grant execute on function public.apply_request_rejection_side_effects(uuid) to service_role;


-- 3. Update public.apply_offset_side_effects upon approval (idempotency: skip if already deducted)
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


-- 4. Unified trigger on public.requests to guarantee side effects run on both approval AND rejection
create or replace function public.handle_request_status_side_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and (old.status is null or old.status <> 'approved') then
    perform public.apply_offset_side_effects(new.id);
    perform public.apply_leave_side_effects(new.id);
  elsif new.status = 'rejected' and (old.status is null or old.status <> 'rejected') then
    perform public.apply_request_rejection_side_effects(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_approval_side_effects on public.requests;
drop trigger if exists trg_request_status_side_effects on public.requests;
create trigger trg_request_status_side_effects
  after update of status on public.requests
  for each row
  execute function public.handle_request_status_side_effects();


-- 5. Update decide_approval_step to explicitly trigger rejection side effects
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
  v_next_step_id uuid;
  v_request_type_code text;
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


-- 6. Update admin_update_request_status to trigger rejection side effects
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


-- 7. Update delete_my_pending_request to restore deducted offset balance before deletion
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

    if v_perk_req.status not in ('pending', 'submitted', 'waiting') then
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
        if v_perk_req.status not in ('pending', 'submitted', 'waiting') then
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

    if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr', 'waiting') then
      raise exception 'Only pending requests can be deleted.';
    end if;

    -- If this was a pending Use Offset request that deducted balance, refund the hours before deleting
    select coalesce(sum(hours), 0)
    into v_refund_hours
    from public.offset_transactions
    where request_id = p_request_id
      and transaction_type = 'use';

    if v_refund_hours > 0 and not exists (
      select 1 from public.offset_transactions where request_id = p_request_id and transaction_type = 'adjustment'
    ) then
      update public.offset_balances
      set balance_hours = round(balance_hours + v_refund_hours, 2),
          updated_at = now()
      where employee_id = v_req.submitted_by_employee_id;
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


-- 8. Update admin_delete_request to restore deducted offset balance before deletion
create or replace function public.admin_delete_request(
  p_request_id uuid,
  p_is_perk boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.requests;
  v_refund_hours numeric := 0;
begin
  if p_is_perk then
    delete from public.employee_perk_requests where id = p_request_id;
  else
    select * into v_req
    from public.requests
    where id = p_request_id;

    if v_req.id is not null and v_req.status not in ('approved') then
      select coalesce(sum(hours), 0)
      into v_refund_hours
      from public.offset_transactions
      where request_id = p_request_id
        and transaction_type = 'use';

      if v_refund_hours > 0 and not exists (
        select 1 from public.offset_transactions where request_id = p_request_id and transaction_type = 'adjustment'
      ) then
        update public.offset_balances
        set balance_hours = round(balance_hours + v_refund_hours, 2),
            updated_at = now()
        where employee_id = v_req.submitted_by_employee_id;
      end if;
    end if;

    delete from public.approval_push_outbox where request_id = p_request_id;
    delete from public.offset_transactions where request_id = p_request_id;
    delete from public.leave_transactions where request_id = p_request_id;
    delete from public.time_request_details where request_id = p_request_id;
    delete from public.leave_request_details where request_id = p_request_id;
    delete from public.request_approval_steps where request_id = p_request_id;
    delete from public.requests where id = p_request_id;
  end if;

  return 'Request deleted successfully.';
end;
$$;

grant execute on function public.admin_delete_request(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_request(uuid, boolean) to anon;
grant execute on function public.admin_delete_request(uuid, boolean) to service_role;


-- 9. Update update_my_pending_request to handle offset balance adjustments on edit
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

  if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr') then
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
        -- Needs more hours deducted
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

        -- Update or insert offset_transactions
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
        -- Partial refund
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
    else
      -- Request changed away from Use Offset: refund any previously deducted hours
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

    if v_new_is_use_offset then
      select id into v_target_type_id from public.request_types where code = 'use_offset' limit 1;
      if v_target_type_id is not null then
        update public.requests set request_type_id = v_target_type_id where id = p_request_id;
      end if;
    elsif coalesce(p_request_type_code, '') = 'offset_earn' or v_resolved_trans like '%offset%' then
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


-- 10. Backfill: For any currently pending Use Offset request submitted before this migration,
-- deduct the offset balance now so that it is properly tracked and deducted upon submission.
do $$
declare
  v_rec record;
  v_cur_bal numeric;
  v_deduct numeric;
  v_new_bal numeric;
begin
  for v_rec in
    select
      r.id as request_id,
      r.submitted_by_employee_id,
      coalesce(trd.total_hours, 0) as total_hours
    from public.requests r
    join public.time_request_details trd on trd.request_id = r.id
    left join public.request_types rt on rt.id = r.request_type_id
    where r.status in ('pending', 'needs_admin_review', 'submitted', 'pending_hr')
      and (
        coalesce(rt.code, '') = 'use_offset'
        or lower(coalesce(trd.transaction_type, '')) like '%use_offset%'
        or lower(coalesce(trd.transaction_type, '')) like '%use offset%'
        or lower(coalesce(trd.reason, '')) like '%(use offset)%'
      )
      and coalesce(trd.total_hours, 0) > 0
      and not exists (
        select 1 from public.offset_transactions ot
        where ot.request_id = r.id and ot.transaction_type = 'use'
      )
  loop
    select coalesce(balance_hours, 0)
    into v_cur_bal
    from public.offset_balances
    where employee_id = v_rec.submitted_by_employee_id
    for update;

    v_deduct := v_rec.total_hours;
    v_new_bal := round(greatest(0, coalesce(v_cur_bal, 0) - v_deduct), 2);

    update public.offset_balances
    set balance_hours = v_new_bal,
        updated_at = now()
    where employee_id = v_rec.submitted_by_employee_id;

    insert into public.offset_transactions (
      employee_id,
      request_id,
      transaction_type,
      hours,
      balance_after,
      created_at
    )
    values (
      v_rec.submitted_by_employee_id,
      v_rec.request_id,
      'use',
      v_deduct,
      v_new_bal,
      now()
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
