-- Migration 0224: Add break_from and break_to to time_request_details and submit_time_request
-- ============================================================================
-- 1. Adds break_from and break_to columns to public.time_request_details
-- 2. Updates submit_time_request to accept optional p_break_from and p_break_to
-- ============================================================================

alter table public.time_request_details
  add column if not exists break_from time,
  add column if not exists break_to time;

-- Drop obsolete overloads of submit_time_request before creating new signature
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'submit_time_request'
      and pronamespace = 'public'::regnamespace
      and pronargs < 16
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end;
$$;

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

  if v_is_scheduled_ot then
    v_initial_status := 'pre_approved';
  else
    v_initial_status := 'pending';
  end if;

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
    p_reason,
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

notify pgrst, 'reload schema';

