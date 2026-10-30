-- Migration 0214: Approver Reassignment Support
-- ============================================================================
-- 1. Drops legacy / Duty Store functions (get_portal_stores, get_store_approval_route).
-- 2. Ensures `is_reassigned` column exists on public.request_approval_steps.
-- 3. Provides public.get_approver_candidates(p_search, p_min_authority_level)
--    excluding Level 1 employees (only authority_level >= 2) with accurate
--    authority level resolution from authority_assignments or positions.
-- 4. Updates public.submit_time_request to support p_custom_approvers (jsonb),
--    dropping all ambiguous function overloads to prevent PostgreSQL ambiguity errors.
-- 5. Updates public.update_my_pending_request to support p_custom_approvers (jsonb).
-- ============================================================================

-- Clean up any Duty Store functions if they were created
drop function if exists public.get_portal_stores();
drop function if exists public.get_store_approval_route(uuid, uuid);

-- Ensure is_reassigned column exists on request_approval_steps
alter table public.request_approval_steps
  add column if not exists is_reassigned boolean default false;

-- ============================================================================
-- 1. Function: public.get_approver_candidates(text, int)
-- ============================================================================
drop function if exists public.get_approver_candidates(text);
drop function if exists public.get_approver_candidates(text, int);

create or replace function public.get_approver_candidates(
  p_search text default null,
  p_min_authority_level int default 2
)
returns table (
  employee_id uuid,
  full_name text,
  employee_no text,
  position_name text,
  department_name text,
  store_name text,
  company_name text,
  authority_level int,
  photo_url text
)
language sql
security definer
set search_path = public
as $$
  select
    e.id as employee_id,
    trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)) as full_name,
    e.employee_no,
    p.name as position_name,
    d.name as department_name,
    coalesce(store_agg.assigned_store_names, s.name) as store_name,
    c.name as company_name,
    coalesce(aa_auth.authority_level, p.authority_level, 1) as authority_level,
    e.photo_url
  from public.employees e
  left join lateral (
    select ea.position_id, ea.department_id, ea.store_id, ea.company_id, ea.function_id
    from public.employee_assignments ea
    where ea.employee_id = e.id
    order by
      case when ea.is_primary = true then 0 else 1 end,
      case when ea.effective_to is null or ea.effective_to >= current_date then 0 else 1 end,
      ea.created_at desc
    limit 1
  ) ea_curr on true
  left join public.positions p on p.id = ea_curr.position_id
  left join lateral (
    select auth_as.authority_level
    from public.authority_assignments auth_as
    where auth_as.employee_id = e.id
      and auth_as.is_active = true
      and (auth_as.effective_to is null or auth_as.effective_to >= current_date)
    order by
      case when auth_as.function_id = ea_curr.function_id then 0 else 1 end,
      auth_as.created_at desc
    limit 1
  ) aa_auth on true
  left join public.departments d on d.id = ea_curr.department_id
  left join public.stores s on s.id = ea_curr.store_id
  left join public.companies c on c.id = ea_curr.company_id
  left join lateral (
    select string_agg(st.name, ', ' order by st.name) as assigned_store_names
    from public.employee_store_assignments esa
    join public.stores st on st.id = esa.store_id
    where esa.employee_id = e.id
  ) store_agg on true
  where lower(trim(coalesce(e.employment_status, 'active'))) not in ('banned', 'inactive', 'terminated', 'resigned')
    and coalesce(aa_auth.authority_level, p.authority_level, 0) >= coalesce(p_min_authority_level, 2)
    and (
      p_search is null
      or trim(p_search) = ''
      or lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)) like '%' || lower(trim(p_search)) || '%'
      or lower(coalesce(e.employee_no, '')) like '%' || lower(trim(p_search)) || '%'
      or lower(coalesce(p.name, '')) like '%' || lower(trim(p_search)) || '%'
      or lower(coalesce(d.name, '')) like '%' || lower(trim(p_search)) || '%'
      or lower(coalesce(s.name, '')) like '%' || lower(trim(p_search)) || '%'
      or lower(coalesce(store_agg.assigned_store_names, '')) like '%' || lower(trim(p_search)) || '%'
    )
  order by full_name asc;
$$;

grant execute on function public.get_approver_candidates(text, int) to authenticated, anon, service_role;

-- ============================================================================
-- 2. Drop ambiguous overloads of submit_time_request & update_my_pending_request
-- ============================================================================
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'submit_time_request'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;

  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'update_my_pending_request'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end $$;

-- ============================================================================
-- 3. Function: public.submit_time_request
-- ============================================================================
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
  p_is_pre_approved boolean default false
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

  -- Pre-approved status is STRICTLY for requests applied from the Pre-approved OT/Offset screen
  -- (signaled by p_is_pre_approved = true, p_transaction_type = 'scheduled_ot', or [PreApproved] in reason).
  -- Regular ESARF requests applied in Apply ESARF screen (even with events/activities or OT/OB)
  -- MUST ALWAYS start with status 'pending'.
  v_is_scheduled_ot := (
    coalesce(p_is_pre_approved, false) = true
    or lower(coalesce(p_transaction_type, '')) like '%scheduled_ot%'
    or coalesce(p_reason, '') like '%[PreApproved]%'
  ) and not v_is_use_offset;

  v_transaction_type := coalesce(nullif(trim(p_transaction_type), ''), case when p_request_type_code = 'offset_earn' then 'Offset' else 'OT' end);
  -- Clean any scheduled_ot tokens so transaction_type remains strictly 'OT' or 'Offset'
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

  if v_is_scheduled_ot then
    v_effective_hours := 0;
  else
    v_effective_hours := p_total_hours;
  end if;

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
    transaction_type
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
  text, date, date, time, time, numeric, text, text, text, text, text, uuid, jsonb, boolean
) to authenticated, anon, service_role;

-- ============================================================================
-- 4. Function: public.update_my_pending_request
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

-- ============================================================================
-- 5. Fix existing regular ESARF requests incorrectly marked as 'pre_approved'
-- ============================================================================
-- Only OT/Offset applied in the Pre-approved OT/Offset screen should be 'pre_approved'.
-- Any request applied with events/activities or non-scheduled transactions must be 'pending'.
update public.requests r
set status = 'pending'
from public.time_request_details trd
where r.id = trd.request_id
  and r.status = 'pre_approved'
  and trd.reason not like '%[PreApproved]%'
  and (
    trd.reason like '%Event:%'
    or trd.reason like '%Activity:%'
    or trd.date_from <= current_date
    or lower(coalesce(trd.transaction_type, '')) like '%ob%'
    or lower(coalesce(trd.transaction_type, '')) like '%fio%'
    or lower(coalesce(trd.transaction_type, '')) like '%ut%'
    or lower(coalesce(trd.transaction_type, '')) like '%cs%'
  );

update public.request_approval_steps ras
set status = 'pending'
from public.requests r
where ras.request_id = r.id
  and r.status = 'pending'
  and ras.step_order = 1
  and ras.status = 'waiting';

-- ============================================================================
-- 6. Clean up 'scheduled_ot' tags and ensure pre-approved requests are 'pre_approved'
-- ============================================================================
update public.time_request_details
set transaction_type = 'OT'
where transaction_type = 'scheduled_ot';
update public.time_request_details
set transaction_type = trim(both ', ' from replace(replace(transaction_type, 'scheduled_ot,', ''), ', scheduled_ot', ''))
where transaction_type like '%scheduled_ot%';

update public.time_request_details
set transaction_type = 'OT'
where transaction_type is null or trim(transaction_type) = '';

-- Ensure requests applied from Pre-approved OT/Offset screen are set to 'pre_approved'
update public.requests r
set status = 'pre_approved'
from public.time_request_details trd
where trd.request_id = r.id
  and r.status = 'pending'
  and (
    trd.reason like '%[PreApproved]%'
    or lower(coalesce(trd.transaction_type, '')) like '%scheduled_ot%'
  );

-- Ensure step 1 is pending for approvers on pre-approved requests
update public.request_approval_steps ras
set status = 'pending'
from public.requests r
where ras.request_id = r.id
  and r.status = 'pre_approved'
  and ras.step_order = 1
  and ras.status = 'waiting';



