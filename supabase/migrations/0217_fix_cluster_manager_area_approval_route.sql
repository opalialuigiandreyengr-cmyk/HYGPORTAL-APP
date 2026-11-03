-- ============================================================================
-- Migration 0217: Fix Cluster Manager Area Approval Route for ESARF and Requests
--
-- Description:
-- 1. For Operations department, Cluster Managers (Level 4) have an approval route:
--    - Step 1: Area Manager (Level 5)
--    - Step 2: Operations Director (Level 7)
-- 2. Cluster Managers oversee a cluster of stores and therefore have store_id = NULL
--    in public.employee_assignments.
-- 3. When store_id was NULL, find_request_approver, get_store_approval_route,
--    and submit_time_request previously failed to resolve area_id from the cluster_id.
--    Because area_id remained NULL, Level 5 approvers (Ivy Rizabal Venigas for Area 1
--    and Mark Sanita Delute for Area 2) failed the area matching condition:
--      (v_authority.area_id is null or (v_assignment.area_id is not null and v_authority.area_id = v_assignment.area_id))
--    This caused Level 5 to find no approver, skipping Area Manager entirely and
--    prematurely advancing to Level 7 (Operations Director) for Step 1, and Level 8
--    (General Manager) for Step 2.
-- 4. This migration:
--    a) Backfills public.employee_assignments.area_id from clusters and authority_assignments.
--    b) Adds a trigger to automatically keep area_id in sync when cluster_id or store_id is set.
--    c) Fixes public.find_request_approver to resolve area_id from cluster_id and authority_assignments.
--    d) Fixes public.get_store_approval_route (fixing the v_store record field bug and resolving area from cluster).
--    e) Updates public.submit_time_request, public.submit_travel_order_request, and public.submit_leave_request
--       to populate area_id before creating requests and resolving approval steps.
-- ============================================================================

-- ============================================================================
-- 1. Data Backfill & Sync for Clusters and Employee Assignments
-- ============================================================================

-- Ensure CLUSTER 1 | 7/11 is correctly linked to AREA 1
update public.clusters
set area_id = '8e318eb4-c7f9-4732-8938-7d9f60c53900'
where id = '781d4a50-fcf9-42e6-adcf-d911affdebfb'
  and area_id <> '8e318eb4-c7f9-4732-8938-7d9f60c53900';

-- Backfill employee_assignments.area_id from authority_assignments where active
update public.employee_assignments ea
set area_id = aa.area_id
from public.authority_assignments aa
where ea.employee_id = aa.employee_id
  and aa.area_id is not null
  and aa.is_active = true
  and ea.area_id is null;

-- Backfill employee_assignments.area_id from clusters
update public.employee_assignments ea
set area_id = cl.area_id
from public.clusters cl
where ea.cluster_id = cl.id
  and ea.area_id is null
  and cl.area_id is not null;

-- Backfill employee_assignments.area_id and cluster_id from stores
update public.employee_assignments ea
set area_id = coalesce(s.area_id, cl.area_id),
    cluster_id = coalesce(ea.cluster_id, s.cluster_id)
from public.stores s
left join public.clusters cl on cl.id = s.cluster_id
where ea.store_id = s.id
  and (ea.area_id is null or ea.cluster_id is null)
  and coalesce(s.area_id, cl.area_id) is not null;

-- Create trigger function to keep area_id synced with cluster/store on future assignment inserts/updates
create or replace function public.trg_fn_sync_employee_assignment_area()
returns trigger
language plpgsql
as $$
begin
  if new.store_id is not null then
    select coalesce(s.area_id, cl.area_id, new.area_id), coalesce(new.cluster_id, s.cluster_id)
    into new.area_id, new.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = new.store_id;
  elsif new.cluster_id is not null and new.area_id is null then
    select cl.area_id
    into new.area_id
    from public.clusters cl
    where cl.id = new.cluster_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_employee_assignment_area on public.employee_assignments;
create trigger trg_sync_employee_assignment_area
before insert or update of store_id, cluster_id, area_id on public.employee_assignments
for each row
execute function public.trg_fn_sync_employee_assignment_area();


-- ============================================================================
-- 2. Update public.find_request_approver
-- ============================================================================
drop function if exists public.find_request_approver(uuid, uuid, int, uuid, uuid[]);

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
      coalesce(s.area_id, cl.area_id, v_assignment.area_id),
      coalesce(s.cluster_id, v_assignment.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null then
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
              v_authority.cluster_id is null
              or (
                v_assignment.cluster_id is not null
                and v_authority.cluster_id = v_assignment.cluster_id
              )
            )
          )
          or (
            v_level = 5 and (
              v_authority.area_id is null
              or (
                v_assignment.area_id is not null
                and v_authority.area_id = v_assignment.area_id
              )
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
              coalesce(ea.cluster_id, s.cluster_id) is null
              or (
                v_assignment.cluster_id is not null
                and coalesce(ea.cluster_id, s.cluster_id) = v_assignment.cluster_id
              )
            )
          )
          or (
            v_level = 5 and (
              coalesce(ea.area_id, s.area_id, cl.area_id) is null
              or (
                v_assignment.area_id is not null
                and coalesce(ea.area_id, s.area_id, cl.area_id) = v_assignment.area_id
              )
            )
          )
          or v_level not in (2, 4, 5)
        )
        and exists (
          select 1 from public.employees e
          left join public.user_profiles up2 on up2.employee_id = e.id
          left join auth.users au on au.id = up2.auth_user_id
          where e.id = ea.employee_id
            and lower(trim(coalesce(e.employment_status, 'active'))) not in ('banned', 'inactive', 'terminated', 'resigned')
            and coalesce(up2.is_active, true) = true
            and (au.banned_until is null or au.banned_until <= now())
        )
      order by
        case when ea.department_id = v_assignment.department_id then 0 else 1 end,
        case when ea.company_id = v_assignment.company_id then 0 else 1 end,
        case when ea.store_id = v_assignment.store_id then 0 else 1 end,
        ea.created_at asc
      limit 1;

      if approver_employee_id is not null then
        resolved_level := v_level;
        return next;
        return;
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function public.find_request_approver(uuid, uuid, int, uuid, uuid[]) to authenticated, anon, service_role;


-- ============================================================================
-- 3. Update public.get_store_approval_route
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
      select s.cluster_id, coalesce(s.area_id, cl.area_id, v_assignment.area_id)
      into v_assignment.cluster_id, v_assignment.area_id
      from public.stores s
      left join public.clusters cl on cl.id = s.cluster_id
      where s.id = v_duty_store_id;
    end if;
  end if;

  -- Resolve cluster and area for employee assignment
  if v_assignment.store_id is not null and v_assignment.area_id is null then
    select coalesce(s.area_id, cl.area_id, v_assignment.area_id), coalesce(s.cluster_id, v_assignment.cluster_id)
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
      end if;
    end loop;
  end if;

  return;
end;
$$;

grant execute on function public.get_store_approval_route(text, text) to authenticated, anon, service_role;

create or replace function public.get_store_approval_route(
  p_store_id uuid,
  p_employee_id uuid default null
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
begin
  return query select * from public.get_store_approval_route(p_store_id::text, p_employee_id::text);
end;
$$;

grant execute on function public.get_store_approval_route(uuid, uuid) to authenticated, anon, service_role;


-- ============================================================================
-- 4. Update public.submit_time_request (ESARF & Pre-Approved OT/Offset)
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

  -- Resolve cluster and area for employee assignment
  if p_store_id is not null then
    v_assignment.store_id := p_store_id;
    select coalesce(s.area_id, cl.area_id, v_assignment.area_id), coalesce(s.cluster_id, v_assignment.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = p_store_id;
  elsif v_assignment.store_id is not null then
    select coalesce(s.area_id, cl.area_id, v_assignment.area_id), coalesce(s.cluster_id, v_assignment.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null then
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

  -- Pre-approved status is STRICTLY for requests applied from the Pre-approved OT/Offset screen
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
-- 5. Update public.submit_travel_order_request
-- ============================================================================
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
  v_route record;
  v_step_order int := 0;
  v_used_employee_ids uuid[] := '{}';
  v_step_approver_emp_id uuid;
  v_step_approver_user_id uuid;
  v_step_resolved_level int;
  v_step_approver_name text;
  v_step_approver_pos_name text;
  v_step_approver_emp_no text;
  v_destinations_str text;
  v_total_budget numeric;
  v_reason_summary text;
  v_custom_app_elem jsonb;
  v_custom_matched boolean;
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

  -- Resolve cluster and area for employee assignment
  if v_assignment.store_id is not null then
    select coalesce(s.area_id, cl.area_id, v_assignment.area_id), coalesce(s.cluster_id, v_assignment.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null then
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

  -- 3. Build approval routes
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
        e.employee_no,
        p.name
      into
        v_step_approver_name,
        v_step_approver_emp_no,
        v_step_approver_pos_name
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
        select
          nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), ''),
          e.employee_no,
          p.name
        into
          v_step_approver_name,
          v_step_approver_emp_no,
          v_step_approver_pos_name
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

  -- 4. Fallback if no steps were inserted
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
      greatest(2, coalesce(v_position.authority_level, 1) + 1),
      null,
      'admin_fallback'
    );
  end if;

  return v_request_id;
end;
$$;

grant execute on function public.submit_travel_order_request(
  text[], date, date, time, time, text, text, text, text, numeric, numeric, numeric, text, text, jsonb
) to authenticated, anon, service_role;


-- ============================================================================
-- 6. Update public.submit_leave_request
-- ============================================================================
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
  v_step_order int := 0;
  v_used_employee_ids uuid[] := '{}';
  v_total_days numeric;
  v_leave_type text;
  v_paid_days numeric;
  v_unpaid_days numeric;
  v_available_days numeric;
  v_is_birthday_leave boolean;
  v_credits_to_check numeric;
  v_hire_date date;
  v_has_one_year_service boolean;
  v_day_off text;
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

  select *
  into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Your login is not linked to an employee profile.';
  end if;

  select coalesce(epd.day_off, '')
  into v_day_off
  from public.employee_profile_details epd
  where epd.employee_id = v_profile.employee_id
  limit 1;

  if nullif(trim(v_day_off), '') is not null and upper(trim(v_day_off)) not in ('NO DAY OFF', 'NO_DAY_OFF', 'NONE') then
    select count(*)
    into v_total_days
    from generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval) as s(d)
    where not (
      (upper(v_day_off) ~* '\y(SUN|SUNDAY)\y' and extract(dow from s.d) = 0)
      or (upper(v_day_off) ~* '\y(MON|MONDAY)\y' and extract(dow from s.d) = 1)
      or (upper(v_day_off) ~* '\y(TUE|TUES|TUESDAY)\y' and extract(dow from s.d) = 2)
      or (upper(v_day_off) ~* '\y(WED|WEDNESDAY)\y' and extract(dow from s.d) = 3)
      or (upper(v_day_off) ~* '\y(THU|THUR|THURS|THURSDAY)\y' and extract(dow from s.d) = 4)
      or (upper(v_day_off) ~* '\y(FRI|FRIDAY)\y' and extract(dow from s.d) = 5)
      or (upper(v_day_off) ~* '\y(SAT|SATURDAY)\y' and extract(dow from s.d) = 6)
    );
  else
    v_total_days := (p_end_date - p_start_date) + 1;
  end if;

  if coalesce(p_paid_days, 0) + coalesce(p_unpaid_days, 0) = v_total_days then
    v_paid_days := coalesce(p_paid_days, 0);
    v_unpaid_days := coalesce(p_unpaid_days, 0);
  else
    if v_leave_type = 'With Pay' then
      v_paid_days := v_total_days;
      v_unpaid_days := 0;
    elsif v_leave_type = 'Without Pay' then
      v_paid_days := 0;
      v_unpaid_days := v_total_days;
    else
      v_paid_days := coalesce(p_paid_days, 0);
      v_unpaid_days := coalesce(p_unpaid_days, 0);
    end if;
  end if;

  v_is_birthday_leave := lower(trim(p_leave_category)) = 'birthday leave';

  if v_is_birthday_leave then
    select e.hire_date into v_hire_date
    from public.employees e
    where e.id = v_profile.employee_id;

    if v_hire_date is null then
      v_has_one_year_service := false;
    else
      v_has_one_year_service := (v_hire_date + interval '1 year') <= p_start_date;
    end if;

    if not v_has_one_year_service then
      raise exception 'Birthday Leave requires at least one (1) year of continuous service.';
    end if;

    if exists (
      select 1
      from public.leave_request_details lrd
      join public.requests r on r.id = lrd.request_id
      where r.submitted_by_employee_id = v_profile.employee_id
        and lower(trim(lrd.leave_category)) = 'birthday leave'
        and extract(year from lrd.start_date) = extract(year from p_start_date)
        and r.status not in ('rejected', 'cancelled', 'deleted')
    ) then
      raise exception 'You have already applied for or used Birthday Leave for this calendar year.';
    end if;
  end if;

  if v_paid_days > 0 and not v_is_birthday_leave then
    select coalesce(lc.available_days, 0)
    into v_available_days
    from public.leave_credits lc
    where lc.employee_id = v_profile.employee_id
    limit 1;

    v_credits_to_check := coalesce(v_available_days, 0);

    if v_credits_to_check < v_paid_days then
      raise exception 'Insufficient leave credits. Available: %, Requested Paid Days: %',
        v_credits_to_check, v_paid_days;
    end if;
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

  -- Resolve cluster and area for employee assignment
  if v_assignment.store_id is not null then
    select coalesce(s.area_id, cl.area_id, v_assignment.area_id), coalesce(s.cluster_id, v_assignment.cluster_id)
    into v_assignment.area_id, v_assignment.cluster_id
    from public.stores s
    left join public.clusters cl on cl.id = s.cluster_id
    where s.id = v_assignment.store_id;
  elsif v_assignment.cluster_id is not null then
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

  -- Birthday leave auto-approval
  if v_is_birthday_leave and v_total_days = 1 and v_has_one_year_service then
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
      status,
      final_approved_at
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
      paid_days,
      unpaid_days,
      reason,
      total_days
    )
    values (
      v_request_id,
      v_leave_type,
      trim(p_leave_category),
      p_start_date,
      p_end_date,
      v_paid_days,
      v_unpaid_days,
      trim(p_reason),
      v_total_days
    );

    insert into public.request_approval_steps (
      request_id,
      step_order,
      required_function_id,
      required_level,
      assigned_approver_employee_id,
      assigned_approver_user_id,
      status,
      approved_at,
      approval_comment
    )
    values (
      v_request_id,
      1,
      v_assignment.function_id,
      1,
      null,
      null,
      'approved',
      now(),
      'Auto-approved by HYG Portal System for Birthday Leave'
    );

    return v_request_id;
  end if;

  -- Regular leave request
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
    paid_days,
    unpaid_days,
    reason,
    total_days
  )
  values (
    v_request_id,
    v_leave_type,
    trim(p_leave_category),
    p_start_date,
    p_end_date,
    v_paid_days,
    v_unpaid_days,
    trim(p_reason),
    v_total_days
  );

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

    select *
    into v_approver
    from public.find_request_approver(
      v_assignment.id,
      v_assignment.function_id,
      v_route.approver_level,
      v_profile.employee_id,
      v_used_employee_ids
    );

    if v_approver.approver_employee_id is not null then
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
        coalesce(v_approver.resolved_level, v_route.approver_level),
        v_approver.approver_employee_id,
        v_approver.approver_user_profile_id,
        case when v_step_order = 1 then 'pending' else 'waiting' end
      );

      v_used_employee_ids := array_append(v_used_employee_ids, v_approver.approver_employee_id);
    end if;
  end loop;

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
      greatest(2, coalesce(v_position.authority_level, 1) + 1),
      null,
      'admin_fallback'
    );
  end if;

  return v_request_id;
end;
$$;

grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to authenticated, anon, service_role;

notify pgrst, 'reload schema';
