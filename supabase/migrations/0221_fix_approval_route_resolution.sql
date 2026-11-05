-- ============================================================================
-- Migration 0221: Fix Approval Route Resolution and Ambiguous Function Overload
--
-- Description:
-- 1. Drops ambiguous overload public.get_store_approval_route(uuid, uuid).
--    Having both (text, text) and (uuid, uuid) caused PostgREST RPC resolution
--    to fail with PGRST204 when p_store_id was passed as null.
-- 2. Updates public.get_store_approval_route(text, text) as the single authoritative
--    RPC for retrieving approval timeline steps for any employee and store:
--    - Accurately resolves cluster_id and area_id from store when store_id is present.
--    - Follows public.approval_level_routes and public.find_request_approver.
--    - Provides accurate role placeholders when specific individual approver is not yet assigned.
-- 3. Updates public.find_request_approver with strict scoping so approvers for
--    Level 4 (Cluster Manager) and Level 5 (Area Manager) strictly match the
--    requester's cluster and area, preventing Alfred Omlang and Ivy Venigas from
--    being erroneously assigned to other clusters, areas, or non-operations departments.
-- ============================================================================

-- 1. Drop all ambiguous overloads of get_store_approval_route
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'get_store_approval_route'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end $$;

-- ============================================================================
-- 2. Update public.find_request_approver with Strict Cluster & Area Scoping
-- ============================================================================
create or replace function public.find_request_approver(
  p_assignment_id uuid,
  p_required_function_id uuid,
  p_starting_level int,
  p_requester_employee_id uuid,
  p_used_employee_ids uuid[] default '{}'
)
returns table (
  approver_employee_id uuid,
  approver_user_profile_id uuid,
  resolved_level int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.employee_assignments;
  v_requester_level int;
  v_search_start_level int;
  v_level int;
  v_authority public.authority_assignments;
  v_required_position_id uuid;
  v_has_configured_ladder boolean := false;
  v_authority_store_id uuid;
  v_authority_cluster_id uuid;
  v_authority_area_id uuid;
begin
  select *
  into v_assignment
  from public.employee_assignments
  where id = p_assignment_id;

  if v_assignment.id is null then
    return;
  end if;

  -- 1. Resolve store, cluster, and area for the requester assignment
  if v_assignment.store_id is not null then
    select
      coalesce(v_assignment.area_id, s.area_id, cl.area_id),
      coalesce(v_assignment.cluster_id, s.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null and v_assignment.area_id is null then
    select coalesce(cl.area_id, v_assignment.area_id)
    into v_assignment.area_id
    from public.clusters cl
    where cl.id = v_assignment.cluster_id;
  end if;

  -- Fallback to authority assignment if area_id or cluster_id is still null
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

  select p.authority_level
  into v_requester_level
  from public.positions p
  where p.id = v_assignment.position_id
  limit 1;

  v_search_start_level := greatest(
    coalesce(p_starting_level, 1),
    coalesce(v_requester_level, 0) + 1
  );

  for v_level in v_search_start_level..8 loop
    v_required_position_id := null;
    v_has_configured_ladder := false;

    select l.approver_position_id, true
    into v_required_position_id, v_has_configured_ladder
    from public.department_approval_ladders l
    where l.department_id = v_assignment.department_id
      and l.authority_level = v_level
    limit 1;

    for v_authority in
      select aa.*
      from public.authority_assignments aa
      where aa.authority_level = v_level
        and (
          v_has_configured_ladder
          or v_level >= 7
          or aa.function_id = p_required_function_id
        )
        and (
          v_required_position_id is null
          or exists (
            select 1
            from public.employee_assignments ea
            where ea.employee_id = aa.employee_id
              and ea.position_id = v_required_position_id
              and ea.is_primary = true
              and ea.effective_from <= current_date
              and (ea.effective_to is null or ea.effective_to >= current_date)
          )
        )
        and aa.is_active = true
        and aa.effective_from <= current_date
        and (aa.effective_to is null or aa.effective_to >= current_date)
        and aa.employee_id <> p_requester_employee_id
        and not (aa.employee_id = any(p_used_employee_ids))
        and exists (
          select 1 from public.employees e
          left join public.user_profiles up on up.employee_id = e.id
          left join auth.users au on au.id = up.auth_user_id
          where e.id = aa.employee_id
            and lower(trim(coalesce(e.employment_status, 'active'))) not in ('banned', 'inactive', 'terminated', 'resigned')
            and coalesce(up.is_active, true) = true
            and (au.banned_until is null or au.banned_until <= now())
        )
      order by
        case when exists (
          select 1 from public.employee_assignments ea_d
          where ea_d.employee_id = aa.employee_id
            and ea_d.is_primary = true
            and ea_d.department_id = v_assignment.department_id
        ) then 0 else 1 end,
        case when exists (
          select 1 from public.employee_assignments ea_c
          where ea_c.employee_id = aa.employee_id
            and ea_c.is_primary = true
            and ea_c.company_id = v_assignment.company_id
        ) then 0 else 1 end,
        aa.created_at asc
    loop
      v_authority_store_id := v_authority.store_id;
      v_authority_cluster_id := v_authority.cluster_id;
      v_authority_area_id := v_authority.area_id;

      select
        coalesce(ea.store_id, v_authority_store_id),
        coalesce(ea.cluster_id, s.cluster_id, v_authority_cluster_id),
        coalesce(ea.area_id, s.area_id, cl.area_id, v_authority_area_id)
      into v_authority_store_id, v_authority_cluster_id, v_authority_area_id
      from public.employee_assignments ea
      left join public.stores s on s.id = ea.store_id
      left join public.clusters cl on cl.id = coalesce(ea.cluster_id, s.cluster_id)
      where ea.employee_id = v_authority.employee_id
        and ea.is_primary = true
        and ea.effective_from <= current_date
        and (ea.effective_to is null or ea.effective_to >= current_date)
      order by ea.created_at desc
      limit 1;

      v_authority.store_id := v_authority_store_id;
      v_authority.cluster_id := v_authority_cluster_id;
      v_authority.area_id := v_authority_area_id;

      -- Check level-specific matching:
      -- Level 2: Store supervisor / manager
      -- Level 4: Cluster manager (strictly matches cluster if requester is clustered)
      -- Level 5: Area manager (strictly matches area if requester has area)
      if (
        v_has_configured_ladder
        and (
          (
            v_level = 2 and (
              (
                v_authority.store_id is null
                and not exists (
                  select 1 from public.employee_store_assignments esa
                  where esa.employee_id = v_authority.employee_id
                )
              )
              or (
                v_assignment.store_id is not null
                and (
                  v_authority.store_id = v_assignment.store_id
                  or exists (
                    select 1 from public.employee_store_assignments esa
                    where esa.employee_id = v_authority.employee_id
                      and esa.store_id = v_assignment.store_id
                  )
                )
              )
            )
          )
          or (
            v_level = 4 and (
              (v_assignment.cluster_id is not null and v_authority.cluster_id = v_assignment.cluster_id)
              or (v_assignment.cluster_id is null and v_authority.cluster_id is null)
            )
          )
          or (
            v_level = 5 and (
              (v_assignment.area_id is not null and v_authority.area_id = v_assignment.area_id)
              or (v_assignment.area_id is null and v_authority.area_id is null)
            )
          )
          or v_level not in (2, 4, 5)
        )
      )
        or (
          not v_has_configured_ladder
          and (
            v_level >= 7
            or public.scope_matches_assignment(v_level, v_assignment, v_authority)
          )
        ) then
        approver_employee_id := v_authority.employee_id;
        select up.id
        into approver_user_profile_id
        from public.user_profiles up
        where up.employee_id = v_authority.employee_id
        limit 1;
        resolved_level := v_level;
        return next;
        return;
      end if;
    end loop;

    -- Fallback: check matching position in employee_assignments if not found in authority_assignments
    if v_required_position_id is not null then
      select ea.employee_id, up.id
      into approver_employee_id, approver_user_profile_id
      from public.employee_assignments ea
      left join public.stores s on s.id = ea.store_id
      left join public.clusters cl on cl.id = coalesce(ea.cluster_id, s.cluster_id)
      left join public.user_profiles up on up.employee_id = ea.employee_id
      where ea.position_id = v_required_position_id
        and ea.employee_id <> p_requester_employee_id
        and not (ea.employee_id = any(p_used_employee_ids))
        and ea.is_primary = true
        and ea.effective_from <= current_date
        and (ea.effective_to is null or ea.effective_to >= current_date)
        and (
          (
            v_level = 2 and (
              (
                ea.store_id is null
                and not exists (
                  select 1 from public.employee_store_assignments esa
                  where esa.employee_id = ea.employee_id
                )
              )
              or (
                v_assignment.store_id is not null
                and (
                  ea.store_id = v_assignment.store_id
                  or exists (
                    select 1 from public.employee_store_assignments esa
                    where esa.employee_id = ea.employee_id
                      and esa.store_id = v_assignment.store_id
                  )
                )
              )
            )
          )
          or (
            v_level = 4 and (
              (v_assignment.cluster_id is not null and coalesce(ea.cluster_id, s.cluster_id) = v_assignment.cluster_id)
              or (v_assignment.cluster_id is null and coalesce(ea.cluster_id, s.cluster_id) is null)
            )
          )
          or (
            v_level = 5 and (
              (v_assignment.area_id is not null and coalesce(ea.area_id, s.area_id, cl.area_id) = v_assignment.area_id)
              or (v_assignment.area_id is null and coalesce(ea.area_id, s.area_id, cl.area_id) is null)
            )
          )
          or v_level not in (2, 4, 5)
        )
      order by
        case when ea.department_id = v_assignment.department_id then 0 else 1 end,
        case when ea.company_id = v_assignment.company_id then 0 else 1 end,
        ea.created_at asc
      limit 1;

      if approver_employee_id is not null then
        resolved_level := v_level;
        return next;
        return;
      end if;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.find_request_approver(uuid, uuid, int, uuid, uuid[]) to authenticated, anon, service_role;

-- ============================================================================
-- 3. Function: public.get_store_approval_route(text, text)
-- Single definitive RPC signature to prevent PostgREST ambiguity errors
-- ============================================================================
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
  v_fallback_lvl int;
begin
  -- 1. Identify requester employee (supports UUID, employee_no, or auth.uid())
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
      select s.cluster_id, coalesce(s.area_id, cl.area_id, v_assignment.area_id)
      into v_assignment.cluster_id, v_assignment.area_id
      from public.stores s
      left join public.clusters cl on cl.id = s.cluster_id
      where s.id = v_duty_store_id;
    end if;
  end if;

  -- Resolve cluster and area for employee assignment from stores if not yet set
  if v_assignment.store_id is not null and (v_assignment.area_id is null or v_assignment.cluster_id is null) then
    select
      coalesce(v_assignment.area_id, s.area_id, cl.area_id),
      coalesce(v_assignment.cluster_id, s.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null and v_assignment.area_id is null then
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
      else
        v_step_approver_pos_name := case v_fallback_lvl
          when 2 then 'Store Manager / Supervisor'
          when 3 then 'Department Supervisor'
          when 4 then 'Cluster Manager'
          when 5 then 'Area Operations Manager'
          when 7 then 'Operations Head / Director'
          when 8 then 'General Manager'
          else 'Approver'
        end;

        step_order := v_step_order;
        required_level := v_fallback_lvl;
        approver_level := v_fallback_lvl;
        position_level := v_fallback_lvl;
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
  end if;

  return;
end;
$$;

grant execute on function public.get_store_approval_route(text, text) to authenticated, anon, service_role;

