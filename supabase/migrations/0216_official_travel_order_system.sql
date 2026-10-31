-- Migration 0216: Official Travel Order System
-- ============================================================================
-- 1. Creates dedicated public.travel_order_request_details table.
-- 2. Registers 'travel_order' in public.request_types with approval_count = 2.
-- 3. Implements public.submit_travel_order_request with 2 sequential approval steps:
--    - Approval routes configured via approval_level_routes and find_request_approver (matching Apply ESARF & Pre-approved OT).
-- 4. Updates public.get_my_pending_approvals to include travel order details so
--    the request appears on the Approvals screen of the approvers.
-- 5. Updates public.get_my_requests to include travel order details for requesters.
-- 6. Updates public.admin_get_all_requests to include travel order details for admin.
-- 7. Updates public.delete_my_pending_request to clean up travel order details.
-- 8. Restores and enhances public.get_store_approval_route(uuid, uuid) to resolve the
--    approval workflow ladder from approval_level_routes and find_request_approver.
-- 9. Implements public.update_travel_order_request for updating pending travel orders.
-- ============================================================================

-- 1. Create dedicated table public.travel_order_request_details
create table if not exists public.travel_order_request_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.requests(id) on delete cascade,
  destination_stores text[] default '{}',
  destinations text,
  departure_date date not null,
  return_date date not null,
  departure_time time,
  return_time time,
  transport_mode text,
  plate_no text,
  purpose_of_travel text,
  purpose_details text,
  transport_budget numeric(12, 2) not null default 0,
  meal_budget numeric(12, 2) not null default 0,
  emergency_budget numeric(12, 2) not null default 0,
  total_budget numeric(12, 2) not null default 0,
  cost_center_code text,
  charge_to_store text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_order_request_details_dates_check check (return_date >= departure_date)
);

create index if not exists idx_travel_order_request_details_request_id
  on public.travel_order_request_details(request_id);

create index if not exists idx_travel_order_request_details_departure_date
  on public.travel_order_request_details(departure_date);

-- Enable RLS and permissive policies
alter table public.travel_order_request_details enable row level security;

drop policy if exists "Enable read access for authenticated users" on public.travel_order_request_details;
create policy "Enable read access for authenticated users" on public.travel_order_request_details
  for select to authenticated using (true);

drop policy if exists "Enable insert for authenticated users" on public.travel_order_request_details;
create policy "Enable insert for authenticated users" on public.travel_order_request_details
  for insert to authenticated with check (true);

drop policy if exists "Enable update for authenticated users" on public.travel_order_request_details;
create policy "Enable update for authenticated users" on public.travel_order_request_details
  for update to authenticated using (true) with check (true);

drop policy if exists "Enable delete for authenticated users" on public.travel_order_request_details;
create policy "Enable delete for authenticated users" on public.travel_order_request_details
  for delete to authenticated using (true);

grant all on public.travel_order_request_details to authenticated, anon, service_role;

-- Ensure Realtime broadcasts deletions with full record details
alter table public.requests replica identity full;
alter table public.travel_order_request_details replica identity full;


-- 2. Register/update travel_order in request_types
insert into public.request_types (
  code,
  name,
  required_function_id,
  approval_count,
  requires_offset_credit_check,
  affects_offset_balance,
  is_active
)
select1q
  'travel_order',
  'Official Travel Order',
  coalesce(
    (select id from public.functions where code = 'operations' limit 1),
    (select id from public.functions limit 1)
  ),
  2,
  false,
  'none',
  true
on conflict (code) do update
set name = excluded.name,
    approval_count = 2,
    is_active = true;


-- 3. Drop all overloads of submit_travel_order_request to prevent signature ambiguity
do $$
declare
  r record;
begin
  for r in
    select 'public.' || proname || '(' || oidvectortypes(proargtypes) || ')' as func_sig
    from pg_proc
    where proname = 'submit_travel_order_request'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end $$;

-- Implement submit_travel_order_request
drop function if exists public.submit_travel_order_request(
  text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text
);
drop function if exists public.submit_travel_order_request(
  text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text, jsonb
);

create or replace function public.submit_travel_order_request(
  p_destination_stores text[],
  p_departure_date date,
  p_return_date date,
  p_departure_time time default null,
  p_return_time time default null,
  p_transport_mode text default null,
  p_plate_no text default null,
  p_purpose_of_travel text default null,
  p_purpose_details text default null,
  p_transport_budget numeric default 0,
  p_meal_budget numeric default 0,
  p_emergency_budget numeric default 0,
  p_cost_center_code text default null,
  p_charge_to_store text default null,
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
  v_destinations_str text;
  v_total_budget numeric;
  v_reason_summary text;

  v_route record;
  v_used_employee_ids uuid[] := '{}';
  v_step_order int := 0;
  v_step_approver_emp_id uuid;
  v_step_approver_user_id uuid;
  v_step_resolved_level int;
  v_step_approver_name text;
  v_step_approver_pos_name text;
  v_step_approver_emp_no text;
  v_custom_app_elem jsonb;
  v_custom_matched boolean;
  v_step1_emp_id uuid;
  v_step1_user_id uuid;
  v_fallback_lvl int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_return_date < p_departure_date then
    raise exception 'Return date cannot be earlier than departure date.';
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

  select *
  into v_request_type
  from public.request_types
  where code = 'travel_order'
    and is_active = true
  limit 1;

  if v_request_type.id is null then
    raise exception 'Official Travel Order request type is not configured in the system.';
  end if;

  v_destinations_str := array_to_string(p_destination_stores, ', ');
  v_total_budget := coalesce(p_transport_budget, 0) + coalesce(p_meal_budget, 0) + coalesce(p_emergency_budget, 0);

  v_reason_summary := 'Destination: ' || coalesce(nullif(v_destinations_str, ''), 'Not specified')
    || ' | Purpose: ' || coalesce(nullif(trim(p_purpose_of_travel), ''), 'Official Travel')
    || case when nullif(trim(p_purpose_details), '') is not null then ' (' || trim(p_purpose_details) || ')' else '' end
    || case when nullif(trim(p_transport_mode), '') is not null then ' | Transport: ' || trim(p_transport_mode) || case when nullif(trim(p_plate_no), '') is not null then ' [' || trim(p_plate_no) || ']' else '' end else '' end
    || case when v_total_budget > 0 then ' | Budget: PHP ' || to_char(v_total_budget, 'FM999,999,999.00') else '' end;

  -- 1. Insert master request row
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
    coalesce(v_position.authority_level, 1),
    'pending'
  )
  returning id into v_request_id;

  -- 2. Insert dedicated travel order details row
  insert into public.travel_order_request_details (
    request_id,
    destination_stores,
    destinations,
    departure_date,
    return_date,
    departure_time,
    return_time,
    transport_mode,
    plate_no,
    purpose_of_travel,
    purpose_details,
    transport_budget,
    meal_budget,
    emergency_budget,
    total_budget,
    cost_center_code,
    charge_to_store
  )
  values (
    v_request_id,
    coalesce(p_destination_stores, '{}'::text[]),
    v_destinations_str,
    p_departure_date,
    p_return_date,
    p_departure_time,
    p_return_time,
    nullif(trim(p_transport_mode), ''),
    nullif(trim(p_plate_no), ''),
    nullif(trim(p_purpose_of_travel), ''),
    nullif(trim(p_purpose_details), ''),
    coalesce(p_transport_budget, 0),
    coalesce(p_meal_budget, 0),
    coalesce(p_emergency_budget, 0),
    v_total_budget,
    nullif(trim(p_cost_center_code), ''),
    nullif(trim(p_charge_to_store), '')
  );

  -- 3. Build approval routes (following approval routes just like submit_time_request in Apply ESARF & Pre-approved OT)
  for v_route in
    select distinct on (step_order) *
    from public.approval_level_routes
    where requester_level = coalesce(v_position.authority_level, 1)
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
    v_step_approver_name := null;
    v_step_approver_pos_name := null;
    v_step_approver_emp_no := null;

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
      select
        nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), ''),
        p.name,
        e.employee_no
      into
        v_step_approver_name,
        v_step_approver_pos_name,
        v_step_approver_emp_no
      from public.employees e
      left join public.employee_assignments ea on ea.employee_id = e.id and ea.is_primary = true
      left join public.positions p on p.id = ea.position_id
      where e.id = v_step_approver_emp_id
      limit 1;

      insert into public.request_approval_steps (
        request_id,
        step_order,
        required_function_id,
        required_level,
        assigned_approver_employee_id,
        assigned_approver_user_id,
        status,
        approver_name,
        approver_position_name,
        approver_employee_no,
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
        v_step_approver_name,
        v_step_approver_pos_name,
        v_step_approver_emp_no,
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
        select
          nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), ''),
          p.name,
          e.employee_no
        into
          v_step_approver_name,
          v_step_approver_pos_name,
          v_step_approver_emp_no
        from public.employees e
        left join public.employee_assignments ea on ea.employee_id = e.id and ea.is_primary = true
        left join public.positions p on p.id = ea.position_id
        where e.id = v_step_approver_emp_id
        limit 1;

        insert into public.request_approval_steps (
          request_id,
          step_order,
          required_function_id,
          required_level,
          assigned_approver_employee_id,
          assigned_approver_user_id,
          status,
          approver_name,
          approver_position_name,
          approver_employee_no,
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
          v_step_approver_name,
          v_step_approver_pos_name,
          v_step_approver_emp_no,
          false
        );

        v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);
      end if;
    end if;
  end loop;

  -- Fallback if no steps were inserted from approval_level_routes
  if v_step_order = 0 then
    for v_fallback_lvl in select unnest(array[
      greatest(2, coalesce(v_position.authority_level, 1) + 1),
      greatest(5, coalesce(v_position.authority_level, 1) + 2)
    ]) loop
      v_step_order := v_step_order + 1;
      v_step_approver_emp_id := null;
      v_step_approver_user_id := null;
      v_step_resolved_level := null;

      select
        (to_jsonb(fa)->>'approver_employee_id')::uuid,
        coalesce(
          (to_jsonb(fa)->>'approver_user_profile_id')::uuid,
          (to_jsonb(fa)->>'approver_user_id')::uuid,
          (select id from public.user_profiles where employee_id = (to_jsonb(fa)->>'approver_employee_id')::uuid limit 1)
        ),
        coalesce((to_jsonb(fa)->>'resolved_level')::integer, v_fallback_lvl)
      into
        v_step_approver_emp_id,
        v_step_approver_user_id,
        v_step_resolved_level
      from public.find_request_approver(
        v_assignment.id,
        v_assignment.function_id,
        v_fallback_lvl,
        v_profile.employee_id,
        v_used_employee_ids
      ) fa
      limit 1;

      if v_step_approver_emp_id is not null then
        select
          nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), ''),
          p.name,
          e.employee_no
        into
          v_step_approver_name,
          v_step_approver_pos_name,
          v_step_approver_emp_no
        from public.employees e
        left join public.employee_assignments ea on ea.employee_id = e.id and ea.is_primary = true
        left join public.positions p on p.id = ea.position_id
        where e.id = v_step_approver_emp_id
        limit 1;

        insert into public.request_approval_steps (
          request_id,
          step_order,
          required_function_id,
          required_level,
          assigned_approver_employee_id,
          assigned_approver_user_id,
          status,
          approver_name,
          approver_position_name,
          approver_employee_no,
          is_reassigned
        )
        values (
          v_request_id,
          v_step_order,
          v_assignment.function_id,
          coalesce(v_step_resolved_level, v_fallback_lvl),
          v_step_approver_emp_id,
          v_step_approver_user_id,
          case when v_step_order = 1 then 'pending' else 'waiting' end,
          v_step_approver_name,
          v_step_approver_pos_name,
          v_step_approver_emp_no,
          false
        );

        v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);
      end if;
    end loop;
  end if;

  -- 4. Send notification to Step 1 Approver if user account exists
  select assigned_approver_employee_id, assigned_approver_user_id
  into v_step1_emp_id, v_step1_user_id
  from public.request_approval_steps
  where request_id = v_request_id and step_order = 1;

  if v_step1_emp_id is not null then
    insert into public.notifications (
      employee_id,
      user_profile_id,
      title,
      message,
      link_type,
      link_id
    )
    values (
      v_step1_emp_id,
      v_step1_user_id,
      'Official Travel Order Pending Endorsement',
      coalesce(
        (select trim(concat_ws(' ', first_name, last_name)) from public.employees where id = v_profile.employee_id),
        'An employee'
      ) || ' submitted an Official Travel Order.',
      'approval',
      v_request_id
    );
  end if;

  return v_request_id;
end;
$$;

grant execute on function public.submit_travel_order_request(
  text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text, jsonb
) to authenticated, anon, service_role;


-- ============================================================================
-- 4. Update get_my_pending_approvals to include travel order details
-- ============================================================================
drop function if exists public.get_my_pending_approvals();

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
    trd.time_schedule,
    trd.day_off,
    trd.payroll_class,
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
            'step_order', route_step.step_order,
            'required_level', route_step.required_level,
            'position_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, route_step.required_level),
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
  left join public.travel_order_request_details tord on tord.request_id = r.id
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

grant execute on function public.get_my_pending_approvals() to authenticated, anon, service_role;


-- ============================================================================
-- 5. Update get_my_requests to include travel order details
-- ============================================================================
drop function if exists public.get_my_requests();

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
      trd.time_schedule,
      trd.day_off,
      trd.payroll_class,
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
                nullif(trim(ras.approver_name), '')
              ),
              'approver_position_name', coalesce(ap.name, ap_fallback.name, nullif(trim(ras.approver_position_name), '')),
              'approver_employee_no', coalesce(ae.employee_no, nullif(trim(ras.approver_employee_no), ''))
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


-- ============================================================================
-- 6. Update admin_get_all_requests to include travel order details
-- ============================================================================
drop function if exists public.admin_get_all_requests();

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
      trd.time_schedule,
      trd.day_off,
      trd.payroll_class,
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
                nullif(trim(ras.approver_name), '')
              ),
              'approver_position_name', coalesce(ap.name, nullif(trim(ras.approver_position_name), '')),
              'approver_employee_no', coalesce(ae.employee_no, nullif(trim(ras.approver_employee_no), ''))
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


-- ============================================================================
-- 7. Update delete_my_pending_request to clean up travel orders & perks
-- ============================================================================
drop function if exists public.delete_my_pending_request(uuid);
drop function if exists public.delete_my_pending_request(uuid, boolean);

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
  v_offset_tx record;
  v_current_bal numeric;
  v_new_bal numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Your login is not linked to an employee profile.';
  end if;

  if p_is_perk then
    -- Check perk request
    select *
    into v_perk_req
    from public.employee_perk_requests
    where id = p_request_id
      and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id);

    if v_perk_req.id is null then
      raise exception 'Perk request not found.';
    end if;

    if v_perk_req.status not in ('pending', 'submitted', 'waiting', 'pending_verification') then
      raise exception 'Only pending perk requests can be deleted.';
    end if;

    delete from public.employee_perk_requests where id = p_request_id;
    return 'Perk request deleted successfully.';
  else
    select *
    into v_req
    from public.requests
    where id = p_request_id
    for update;

    if v_req.id is null then
      -- Fallback: check if it was actually a perk request
      select *
      into v_perk_req
      from public.employee_perk_requests
      where id = p_request_id
        and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id);

      if v_perk_req.id is not null then
        if v_perk_req.status not in ('pending', 'submitted', 'waiting', 'pending_verification') then
          raise exception 'Only pending perk requests can be deleted.';
        end if;
        delete from public.employee_perk_requests where id = p_request_id;
        return 'Perk request deleted successfully.';
      end if;

      raise exception 'Request not found.';
    end if;

    if v_req.submitted_by_employee_id <> v_profile.employee_id then
      raise exception 'You can only delete your own requests.';
    end if;

    if v_req.status not in ('pending', 'pre_approved', 'needs_admin_review', 'submitted', 'pending_hr', 'waiting') then
      raise exception 'Only pending requests can be deleted.';
    end if;

    -- Block deletion if any step has already been acted upon
    if exists (
      select 1
      from public.request_approval_steps
      where request_id = p_request_id
        and status in ('approved', 'rejected')
    ) then
      raise exception 'This request has already been acted upon by an approver and can no longer be deleted.';
    end if;

    -- Restore offset balance if Use Offset
    for v_offset_tx in
      select *
      from public.offset_transactions
      where request_id = p_request_id
        and transaction_type = 'use'
    loop
      select coalesce(balance_hours, 0)
      into v_current_bal
      from public.offset_balances
      where employee_id = v_req.submitted_by_employee_id
      for update;

      v_new_bal := round(coalesce(v_current_bal, 0) + v_offset_tx.hours, 2);

      update public.offset_balances
      set balance_hours = v_new_bal,
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
        'cancel_refund',
        v_offset_tx.hours,
        v_new_bal,
        now()
      );
    end loop;

    -- Delete details rows (cascade will delete details and approval steps, but explicit is safest)
    delete from public.approval_push_outbox where request_id = p_request_id;
    delete from public.offset_transactions where request_id = p_request_id;
    delete from public.leave_transactions where request_id = p_request_id;
    delete from public.time_request_details where request_id = p_request_id;
    delete from public.leave_request_details where request_id = p_request_id;
    delete from public.travel_order_request_details where request_id = p_request_id;
    delete from public.request_approval_steps where request_id = p_request_id;
    delete from public.requests where id = p_request_id;

    return 'Request deleted successfully.';
  end if;
end;
$$;

grant execute on function public.delete_my_pending_request(uuid, boolean) to authenticated, anon, service_role;

-- ============================================================================
-- 8. Function: public.get_store_approval_route(p_store_id, p_employee_id)
-- Resolves the approval workflow ladder based on public.approval_level_routes
-- and public.find_request_approver for any requester/store.
-- Used by Apply ESARF, Pre-approved OT/Offset, and Official Travel Order screens.
-- ============================================================================
drop function if exists public.get_store_approval_route(uuid, uuid);
drop function if exists public.get_store_approval_route(text, text);
drop function if exists public.get_store_approval_route(uuid);
drop function if exists public.get_store_approval_route(text);
drop function if exists public.get_store_approval_route();

create or replace function public.get_store_approval_route(
  p_store_id text default null,
  p_employee_id text default null
)
returns table (
  step_order int,
  required_level int,
  approver_level int,
  position_level int,
  role_name text,
  approver_employee_id uuid,
  approver_name text,
  approver_position_name text,
  approver_employee_no text,
  status text,
  store_id uuid,
  store_name text,
  is_reassigned boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_duty_store_id uuid;
  v_assignment public.employee_assignments;
  v_position public.positions;
  v_route record;
  v_step_order int := 0;
  v_used_employee_ids uuid[] := '{}';
  v_step_approver_emp_id uuid;
  v_step_resolved_level int;
  v_step_approver_name text;
  v_step_approver_pos_name text;
  v_step_approver_emp_no text;
  v_step_approver_level int;
  v_store public.stores;
  v_fallback_lvl int;
begin
  -- 1. Identify requester employee (supports UUID or employee_no)
  if p_employee_id is not null and trim(p_employee_id) <> '' and trim(p_employee_id) <> 'N/A' then
    if trim(p_employee_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_employee_id := trim(p_employee_id)::uuid;
    else
      select e.id into v_employee_id
      from public.employees e
      where lower(trim(e.employee_no)) = lower(trim(p_employee_id))
      limit 1;
    end if;
  end if;

  if v_employee_id is null and auth.uid() is not null then
    select up.employee_id into v_employee_id
    from public.user_profiles up
    where up.auth_user_id = auth.uid()
    limit 1;
  end if;

  if v_employee_id is null then
    return;
  end if;

  -- 2. Identify requester assignment
  select *
  into v_assignment
  from public.employee_assignments
  where employee_id = v_employee_id
    and is_primary = true
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  order by effective_from desc
  limit 1;

  if v_assignment.id is null then
    select *
    into v_assignment
    from public.employee_assignments
    where employee_id = v_employee_id
    order by is_primary desc, effective_from desc
    limit 1;
  end if;

  if v_assignment.id is null then
    return;
  end if;

  -- Adjust for store if specific duty store is provided (supports UUID or store name)
  if p_store_id is not null and trim(p_store_id) <> '' and trim(p_store_id) <> 'N/A' then
    if trim(p_store_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_duty_store_id := trim(p_store_id)::uuid;
    else
      select s.id into v_duty_store_id
      from public.stores s
      where lower(trim(s.name)) = lower(trim(p_store_id))
      limit 1;
    end if;

    if v_duty_store_id is not null then
      v_assignment.store_id := v_duty_store_id;
      select s.*, cl.area_id as cl_area_id
      into v_store
      from public.stores s
      left join public.clusters cl on cl.id = s.cluster_id
      where s.id = v_duty_store_id;

      if v_store.id is not null then
        v_assignment.cluster_id := v_store.cluster_id;
        v_assignment.area_id := coalesce(v_store.area_id, v_store.cl_area_id);
      end if;
    end if;
  end if;

  select *
  into v_position
  from public.positions
  where id = v_assignment.position_id;

  -- 3. Query approval routes matching employee's requester level and department
  for v_route in
    select distinct on (alr.step_order) alr.*
    from public.approval_level_routes alr
    where alr.requester_level = coalesce(v_position.authority_level, 1)
      and (alr.department_id = v_assignment.department_id or alr.department_id is null)
    order by
      alr.step_order asc,
      case when alr.department_id = v_assignment.department_id then 0 else 1 end
    limit 2
  loop
    v_step_order := v_step_order + 1;
    v_step_approver_emp_id := null;
    v_step_resolved_level := null;

    select
      (to_jsonb(fa)->>'approver_employee_id')::uuid,
      coalesce((to_jsonb(fa)->>'resolved_level')::integer, v_route.approver_level)
    into
      v_step_approver_emp_id,
      v_step_resolved_level
    from public.find_request_approver(
      v_assignment.id,
      v_assignment.function_id,
      v_route.approver_level,
      v_employee_id,
      v_used_employee_ids
    ) fa
    limit 1;

    if v_step_approver_emp_id is not null then
      v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);

      select
        nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), ''),
        e.employee_no,
        p.name,
        coalesce(p.authority_level, v_step_resolved_level)
      into
        v_step_approver_name,
        v_step_approver_emp_no,
        v_step_approver_pos_name,
        v_step_approver_level
      from public.employees e
      left join public.employee_assignments ea on ea.employee_id = e.id and ea.is_primary = true
      left join public.positions p on p.id = ea.position_id
      where e.id = v_step_approver_emp_id
      limit 1;

      step_order := v_step_order;
      required_level := coalesce(v_step_resolved_level, v_route.approver_level);
      approver_level := coalesce(v_step_approver_level, v_step_resolved_level, v_route.approver_level);
      position_level := coalesce(v_step_approver_level, v_step_resolved_level, v_route.approver_level);
      role_name := coalesce(v_step_approver_pos_name, 'Approver');
      approver_employee_id := v_step_approver_emp_id;
      approver_name := coalesce(v_step_approver_name, v_step_approver_pos_name, 'Approver');
      approver_position_name := v_step_approver_pos_name;
      approver_employee_no := v_step_approver_emp_no;
      status := case when v_step_order = 1 then 'Pending to approve' else 'Not yet processed' end;
      store_id := v_assignment.store_id;
      store_name := (select name from public.stores where id = v_assignment.store_id limit 1);
      is_reassigned := false;

      return next;
    else
      -- If no active employee resolved for route step, provide route position title
      select p.name into v_step_approver_pos_name
      from public.positions p
      where p.id = v_route.approver_position_id;

      if v_step_approver_pos_name is null then
        v_step_approver_pos_name := case v_route.approver_level
          when 2 then 'Store Manager / Supervisor'
          when 3 then 'Department Supervisor'
          when 4 then 'Cluster Manager'
          when 5 then 'Area Operations Manager'
          when 7 then 'Operations Head / Director'
          when 8 then 'General Manager'
          else 'Approver'
        end;
      end if;

      step_order := v_step_order;
      required_level := v_route.approver_level;
      approver_level := v_route.approver_level;
      position_level := v_route.approver_level;
      role_name := v_step_approver_pos_name;
      approver_employee_id := null;
      approver_name := v_step_approver_pos_name;
      approver_position_name := v_step_approver_pos_name;
      approver_employee_no := null;
      status := case when v_step_order = 1 then 'Pending to approve' else 'Not yet processed' end;
      store_id := v_assignment.store_id;
      store_name := (select name from public.stores where id = v_assignment.store_id limit 1);
      is_reassigned := false;

      return next;
    end if;
  end loop;

  -- 4. Fallback ladder if no route was defined in approval_level_routes
  if v_step_order = 0 then
    for v_fallback_lvl in select unnest(array[
      greatest(2, coalesce(v_position.authority_level, 1) + 1),
      greatest(5, coalesce(v_position.authority_level, 1) + 2)
    ]) loop
      v_step_order := v_step_order + 1;
      v_step_approver_emp_id := null;
      v_step_resolved_level := null;

      select
        (to_jsonb(fa)->>'approver_employee_id')::uuid,
        coalesce((to_jsonb(fa)->>'resolved_level')::integer, v_fallback_lvl)
      into
        v_step_approver_emp_id,
        v_step_resolved_level
      from public.find_request_approver(
        v_assignment.id,
        v_assignment.function_id,
        v_fallback_lvl,
        v_employee_id,
        v_used_employee_ids
      ) fa
      limit 1;

      if v_step_approver_emp_id is not null then
        v_used_employee_ids := array_append(v_used_employee_ids, v_step_approver_emp_id);

        select
          nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), ''),
          e.employee_no,
          p.name,
          coalesce(p.authority_level, v_step_resolved_level)
        into
          v_step_approver_name,
          v_step_approver_emp_no,
          v_step_approver_pos_name,
          v_step_approver_level
        from public.employees e
        left join public.employee_assignments ea on ea.employee_id = e.id and ea.is_primary = true
        left join public.positions p on p.id = ea.position_id
        where e.id = v_step_approver_emp_id
        limit 1;

        step_order := v_step_order;
        required_level := coalesce(v_step_resolved_level, v_fallback_lvl);
        approver_level := coalesce(v_step_approver_level, v_step_resolved_level, v_fallback_lvl);
        position_level := coalesce(v_step_approver_level, v_step_resolved_level, v_fallback_lvl);
        role_name := coalesce(v_step_approver_pos_name, 'Approver');
        approver_employee_id := v_step_approver_emp_id;
        approver_name := coalesce(v_step_approver_name, v_step_approver_pos_name, 'Approver');
        approver_position_name := v_step_approver_pos_name;
        approver_employee_no := v_step_approver_emp_no;
        status := case when v_step_order = 1 then 'Pending to approve' else 'Not yet processed' end;
        store_id := v_assignment.store_id;
        store_name := (select name from public.stores where id = v_assignment.store_id limit 1);
        is_reassigned := false;

        return next;
      end if;
    end loop;
  end if;

  return;
end;
$$;

grant execute on function public.get_store_approval_route(text, text) to authenticated, anon, service_role;


-- ============================================================================
-- 9. Function: public.update_travel_order_request
-- ============================================================================
drop function if exists public.update_travel_order_request(
  uuid, text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text
);
drop function if exists public.update_travel_order_request(
  uuid, text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text, jsonb
);

create or replace function public.update_travel_order_request(
  p_request_id uuid,
  p_destination_stores text[],
  p_departure_date date,
  p_return_date date,
  p_departure_time time default null,
  p_return_time time default null,
  p_transport_mode text default null,
  p_plate_no text default null,
  p_purpose_of_travel text default null,
  p_purpose_details text default null,
  p_transport_budget numeric default 0,
  p_meal_budget numeric default 0,
  p_emergency_budget numeric default 0,
  p_cost_center_code text default null,
  p_charge_to_store text default null,
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
  v_destinations_str text;
  v_total_budget numeric;
  v_custom_app_elem jsonb;
  v_step_order int;
  v_custom_emp_id uuid;
  v_custom_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_return_date < p_departure_date then
    raise exception 'Return date cannot be earlier than departure date.';
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
    where request_id = p_request_id and status ilike '%approved%'
  ) then
    raise exception 'This travel order has already received an approval in the timeline and can no longer be edited.';
  end if;

  v_destinations_str := array_to_string(p_destination_stores, ', ');
  v_total_budget := coalesce(p_transport_budget, 0) + coalesce(p_meal_budget, 0) + coalesce(p_emergency_budget, 0);

  insert into public.travel_order_request_details (
    request_id,
    destination_stores,
    destinations,
    departure_date,
    return_date,
    departure_time,
    return_time,
    transport_mode,
    plate_no,
    purpose_of_travel,
    purpose_details,
    transport_budget,
    meal_budget,
    emergency_budget,
    total_budget,
    cost_center_code,
    charge_to_store,
    updated_at
  )
  values (
    p_request_id,
    p_destination_stores,
    coalesce(nullif(v_destinations_str, ''), 'Not specified'),
    p_departure_date,
    p_return_date,
    p_departure_time,
    p_return_time,
    p_transport_mode,
    p_plate_no,
    p_purpose_of_travel,
    p_purpose_details,
    coalesce(p_transport_budget, 0),
    coalesce(p_meal_budget, 0),
    coalesce(p_emergency_budget, 0),
    v_total_budget,
    p_cost_center_code,
    p_charge_to_store,
    now()
  )
  on conflict (request_id) do update
  set
    destination_stores = excluded.destination_stores,
    destinations = excluded.destinations,
    departure_date = excluded.departure_date,
    return_date = excluded.return_date,
    departure_time = excluded.departure_time,
    return_time = excluded.return_time,
    transport_mode = excluded.transport_mode,
    plate_no = excluded.plate_no,
    purpose_of_travel = excluded.purpose_of_travel,
    purpose_details = excluded.purpose_details,
    transport_budget = excluded.transport_budget,
    meal_budget = excluded.meal_budget,
    emergency_budget = excluded.emergency_budget,
    total_budget = excluded.total_budget,
    cost_center_code = excluded.cost_center_code,
    charge_to_store = excluded.charge_to_store,
    updated_at = now();

  update public.requests
  set updated_at = now()
  where id = p_request_id;

  if p_custom_approvers is not null and jsonb_typeof(p_custom_approvers) = 'array' then
    for v_custom_app_elem in select * from jsonb_array_elements(p_custom_approvers) loop
      v_step_order := (v_custom_app_elem->>'step_order')::int;
      v_custom_emp_id := (v_custom_app_elem->>'approver_employee_id')::uuid;

      if v_custom_emp_id is not null and v_step_order is not null then
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

  return 'Travel order request updated successfully.';
end;
$$;

grant execute on function public.update_travel_order_request(
  uuid, text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text, jsonb
) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

