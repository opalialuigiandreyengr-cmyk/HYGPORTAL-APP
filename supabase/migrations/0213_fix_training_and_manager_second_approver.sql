-- Migration 0213: Fix Training Department and Manager Second Approver Route
-- 1. Updates hr_admin_set_department_approval_ladder & admin_set_department_approval_ladder
--    to ensure that if a department ladder only has 1 level above a requester (e.g. for department managers),
--    Step 2 automatically falls back to Level 8 (General Manager) instead of leaving Step 2 empty.
-- 2. Synchronizes approval_level_routes for all departments with the Level 8 fallback.
-- 3. Backfills Step 2 (General Manager Queben Johnson D. Coquilla) for Edjelyn May Gruy Tumandao's
--    requests that only received Step 1, restoring the request status to pending.

-- ============================================================================
-- 1. Update hr_admin_set_department_approval_ladder with Step 2 Fallback
-- ============================================================================
drop function if exists public.hr_admin_set_department_approval_ladder(text, text, uuid, int[], jsonb);
drop function if exists public.hr_admin_set_department_approval_ladder(text, text, uuid, int[]);

create or replace function public.hr_admin_set_department_approval_ladder(
  p_username text,
  p_password text,
  p_department_id uuid,
  p_levels int[],
  p_roles jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level int;
  v_role_id uuid;
  v_requester_level int;
  v_step_one_level int;
  v_step_two_level int;
  v_step_one_position_id uuid;
  v_step_two_position_id uuid;
begin
  if not public.hr_admin_has_access(p_username, p_password) then
    raise exception 'Admin access is required.';
  end if;

  if p_department_id is null then
    raise exception 'Department is required.';
  end if;

  delete from public.department_approval_ladders
  where department_id = p_department_id;

  for v_level in
    select distinct level_value
    from unnest(coalesce(p_levels, '{}'::int[])) as level_value
    where level_value between 2 and 8
    order by level_value
  loop
    v_role_id := nullif(p_roles ->> v_level::text, '')::uuid;

    if v_role_id is not null and not exists (
      select 1
      from public.positions p
      join public.department_positions dp on dp.position_id = p.id
      where p.id = v_role_id
        and p.is_active = true
        and p.authority_level = v_level
        and dp.department_id = p_department_id
    ) then
      raise exception 'Selected role must be active, assigned to this department, and assigned to Level %.', v_level;
    end if;

    insert into public.department_approval_ladders (
      department_id,
      authority_level,
      approver_position_id
    )
    values (p_department_id, v_level, v_role_id)
    on conflict (department_id, authority_level) do update
    set approver_position_id = excluded.approver_position_id;
  end loop;

  delete from public.approval_level_routes
  where department_id = p_department_id;

  for v_requester_level in 1..8 loop
    select authority_level, approver_position_id
    into v_step_one_level, v_step_one_position_id
    from public.department_approval_ladders
    where department_id = p_department_id
      and authority_level > v_requester_level
    order by authority_level
    limit 1;

    select authority_level, approver_position_id
    into v_step_two_level, v_step_two_position_id
    from public.department_approval_ladders
    where department_id = p_department_id
      and authority_level > coalesce(v_step_one_level, v_requester_level)
    order by authority_level
    limit 1;

    -- If Step 1 exists and is below Level 8, but Step 2 is missing (e.g. for department managers
    -- whose department ladder only had 1 level above them), fall back Step 2 to Level 8 (General Manager)
    if v_step_two_level is null and v_step_one_level is not null and v_step_one_level < 8 then
      select authority_level, approver_position_id
      into v_step_two_level, v_step_two_position_id
      from public.department_approval_ladders
      where authority_level = 8 and approver_position_id is not null
      limit 1;

      if v_step_two_level is null then
        v_step_two_level := 8;
        select p.id into v_step_two_position_id
        from public.positions p
        where p.authority_level = 8 and p.is_active = true
        limit 1;
      end if;
    end if;

    if v_step_one_level is not null then
      insert into public.approval_level_routes (
        department_id,
        requester_level,
        step_order,
        approver_level,
        approver_position_id
      )
      values (
        p_department_id,
        v_requester_level,
        1,
        v_step_one_level,
        v_step_one_position_id
      );
    end if;

    if v_step_two_level is not null then
      insert into public.approval_level_routes (
        department_id,
        requester_level,
        step_order,
        approver_level,
        approver_position_id
      )
      values (
        p_department_id,
        v_requester_level,
        2,
        v_step_two_level,
        v_step_two_position_id
      );
    end if;
  end loop;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'hr_admin_set_department_approval_ladder',
    'department',
    p_department_id,
    jsonb_build_object('levels', p_levels, 'roles', p_roles)
  );

  return 'Department approval ladder updated successfully.';
end;
$$;

grant execute on function public.hr_admin_set_department_approval_ladder(text, text, uuid, int[], jsonb) to anon, authenticated;

-- ============================================================================
-- 2. Update admin_set_department_approval_ladder with Step 2 Fallback
-- ============================================================================
drop function if exists public.admin_set_department_approval_ladder(uuid, int[], jsonb);
drop function if exists public.admin_set_department_approval_ladder(uuid, int[]);

create or replace function public.admin_set_department_approval_ladder(
  p_department_id uuid,
  p_levels int[],
  p_roles jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_level int;
  v_role_id uuid;
  v_requester_level int;
  v_step_one_level int;
  v_step_two_level int;
  v_step_one_position_id uuid;
  v_step_two_position_id uuid;
begin
  select *
  into v_admin
  from public.admin_desktop_login_check()
  limit 1;

  if v_admin.app_role not in ('admin', 'super_admin') then
    raise exception 'Admin access is required.';
  end if;

  if p_department_id is null then
    raise exception 'Department is required.';
  end if;

  delete from public.department_approval_ladders
  where department_id = p_department_id;

  for v_level in
    select distinct level_value
    from unnest(coalesce(p_levels, '{}'::int[])) as level_value
    where level_value between 2 and 8
    order by level_value
  loop
    v_role_id := nullif(p_roles ->> v_level::text, '')::uuid;

    if v_role_id is not null and not exists (
      select 1
      from public.positions p
      join public.department_positions dp on dp.position_id = p.id
      where p.id = v_role_id
        and p.is_active = true
        and p.authority_level = v_level
        and dp.department_id = p_department_id
    ) then
      raise exception 'Selected role must be active, assigned to this department, and assigned to Level %.', v_level;
    end if;

    insert into public.department_approval_ladders (
      department_id,
      authority_level,
      approver_position_id
    )
    values (p_department_id, v_level, v_role_id)
    on conflict (department_id, authority_level) do update
    set approver_position_id = excluded.approver_position_id;
  end loop;

  delete from public.approval_level_routes
  where department_id = p_department_id;

  for v_requester_level in 1..8 loop
    select authority_level, approver_position_id
    into v_step_one_level, v_step_one_position_id
    from public.department_approval_ladders
    where department_id = p_department_id
      and authority_level > v_requester_level
    order by authority_level
    limit 1;

    select authority_level, approver_position_id
    into v_step_two_level, v_step_two_position_id
    from public.department_approval_ladders
    where department_id = p_department_id
      and authority_level > coalesce(v_step_one_level, v_requester_level)
    order by authority_level
    limit 1;

    -- Automatic Step 2 fallback to Level 8
    if v_step_two_level is null and v_step_one_level is not null and v_step_one_level < 8 then
      select authority_level, approver_position_id
      into v_step_two_level, v_step_two_position_id
      from public.department_approval_ladders
      where authority_level = 8 and approver_position_id is not null
      limit 1;

      if v_step_two_level is null then
        v_step_two_level := 8;
        select p.id into v_step_two_position_id
        from public.positions p
        where p.authority_level = 8 and p.is_active = true
        limit 1;
      end if;
    end if;

    if v_step_one_level is not null then
      insert into public.approval_level_routes (
        department_id,
        requester_level,
        step_order,
        approver_level,
        approver_position_id
      )
      values (
        p_department_id,
        v_requester_level,
        1,
        v_step_one_level,
        v_step_one_position_id
      );
    end if;

    if v_step_two_level is not null then
      insert into public.approval_level_routes (
        department_id,
        requester_level,
        step_order,
        approver_level,
        approver_position_id
      )
      values (
        p_department_id,
        v_requester_level,
        2,
        v_step_two_level,
        v_step_two_position_id
      );
    end if;
  end loop;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'admin_set_department_approval_ladder',
    'department',
    p_department_id,
    jsonb_build_object('levels', p_levels, 'roles', p_roles)
  );

  return 'Department approval ladder updated successfully.';
end;
$$;

grant execute on function public.admin_set_department_approval_ladder(uuid, int[], jsonb) to authenticated;

-- ============================================================================
-- 3. Synchronize existing department routes so managers have Step 2
-- ============================================================================
do $$
declare
  v_dept record;
  v_requester_level int;
  v_step_one_level int;
  v_step_two_level int;
  v_step_one_position_id uuid;
  v_step_two_position_id uuid;
begin
  for v_dept in select distinct department_id from public.department_approval_ladders loop
    delete from public.approval_level_routes
    where department_id = v_dept.department_id;

    for v_requester_level in 1..8 loop
      select authority_level, approver_position_id
      into v_step_one_level, v_step_one_position_id
      from public.department_approval_ladders
      where department_id = v_dept.department_id
        and authority_level > v_requester_level
      order by authority_level
      limit 1;

      select authority_level, approver_position_id
      into v_step_two_level, v_step_two_position_id
      from public.department_approval_ladders
      where department_id = v_dept.department_id
        and authority_level > coalesce(v_step_one_level, v_requester_level)
      order by authority_level
      limit 1;

      -- Automatic Step 2 fallback to Level 8
      if v_step_two_level is null and v_step_one_level is not null and v_step_one_level < 8 then
        select authority_level, approver_position_id
        into v_step_two_level, v_step_two_position_id
        from public.department_approval_ladders
        where authority_level = 8 and approver_position_id is not null
        limit 1;

        if v_step_two_level is null then
          v_step_two_level := 8;
          select p.id into v_step_two_position_id
          from public.positions p
          where p.authority_level = 8 and p.is_active = true
          limit 1;
        end if;
      end if;

      if v_step_one_level is not null then
        insert into public.approval_level_routes (
          department_id,
          requester_level,
          step_order,
          approver_level,
          approver_position_id
        )
        values (
          v_dept.department_id,
          v_requester_level,
          1,
          v_step_one_level,
          v_step_one_position_id
        );
      end if;

      if v_step_two_level is not null then
        insert into public.approval_level_routes (
          department_id,
          requester_level,
          step_order,
          approver_level,
          approver_position_id
        )
        values (
          v_dept.department_id,
          v_requester_level,
          2,
          v_step_two_level,
          v_step_two_position_id
        );
      end if;
    end loop;
  end loop;
end;
$$;

-- ============================================================================
-- 4. Backfill Step 2 for Edjelyn May Gruy Tumandao's requests & update status
-- ============================================================================
do $$
declare
  v_req record;
  v_assign public.employee_assignments;
  v_step1 record;
  v_queben_emp_id uuid := 'f3a007f7-1bfa-4de0-9486-05d744698091';
  v_queben_profile_id uuid;
begin
  select id into v_queben_profile_id
  from public.user_profiles
  where employee_id = v_queben_emp_id
  limit 1;

  for v_req in
    select r.id, r.submitted_by_employee_id, r.department_id, r.status
    from public.requests r
    where r.id in (
      '5620a94c-08e1-440e-80af-e5a990232588', -- Use Offset
      '7afea52f-4bba-48fd-8765-324dff945441', -- OB
      'b1d673cc-e836-4994-82b5-8a7673bdbdc6'  -- FIO
    )
  loop
    select * into v_assign
    from public.employee_assignments ea
    where ea.employee_id = v_req.submitted_by_employee_id
      and ea.is_primary = true
    order by ea.created_at desc
    limit 1;

    select * into v_step1
    from public.request_approval_steps
    where request_id = v_req.id and step_order = 1;

    -- Insert Step 2 (General Manager Queben Johnson D. Coquilla)
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
      v_req.id,
      2,
      coalesce(v_assign.function_id, v_step1.required_function_id),
      8,
      v_queben_emp_id,
      v_queben_profile_id,
      case when v_step1.status = 'approved' then 'pending' else 'waiting' end
    )
    on conflict (request_id, step_order) do update
    set assigned_approver_employee_id = excluded.assigned_approver_employee_id,
        assigned_approver_user_id = excluded.assigned_approver_user_id,
        required_level = excluded.required_level,
        status = excluded.status;

    -- If Step 1 was approved, this request is now pending Step 2 approval from Queben
    if v_step1.status = 'approved' then
      update public.requests
      set status = 'pending',
          final_approved_at = null,
          updated_at = now()
      where id = v_req.id;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
