-- ============================================================================
-- Migration 0229: Enable Assistant Store Managers Approver Access & Assignment
--
-- Description:
-- 1. Cleans up obsolete overloads of submit_time_request (< 16 parameters)
--    to eliminate the ambiguous candidate function error in PostgREST.
-- 2. Updates public.positions table so Assistant Store Manager positions have
--    authority_level = 2, granting them approver privileges.
-- 3. Updates public.get_approver_candidates to include Assistant Store Managers.
-- 4. Updates public.find_request_approver so that when resolving Level 2 approvers
--    for a store:
--    - Store Managers are prioritized if assigned to the store.
--    - If no Store Manager is assigned to the store, the Assistant Store Manager
--      assigned to that store is selected as the Level 2 approver.
-- ============================================================================

-- 0. Drop obsolete overloads of submit_time_request, update_my_pending_request, and get_store_approval_route
--    to eliminate ambiguous candidate function errors (PostgreSQL error 42725 in PostgREST).
do $$
declare
  r record;
begin
  -- Drop submit_time_request overloads with fewer than 16 arguments
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'submit_time_request'
      and pronamespace = 'public'::regnamespace
      and pronargs < 16
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;

  -- Drop update_my_pending_request overloads with fewer than 23 arguments
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'update_my_pending_request'
      and pronamespace = 'public'::regnamespace
      and pronargs < 23
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;

  -- Drop legacy get_store_approval_route(uuid, uuid) if present to leave only (text, text)
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'get_store_approval_route'
      and pronamespace = 'public'::regnamespace
      and proargtypes = '2950 2950'::oidvector -- uuid, uuid
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end;
$$;

-- 1. Update public.positions authority_level for Assistant Store Managers
update public.positions
set authority_level = 2
where coalesce(authority_level, 1) < 2
  and (
    lower(trim(name)) in (
      'assistant store manager',
      'asst. store manager',
      'asst store manager',
      'assistant store mgr',
      'asst. store mgr',
      'asst store mgr',
      'store assistant manager',
      'store asst manager',
      'asm'
    )
    or (
      (lower(trim(name)) like '%assistant%' or lower(trim(name)) like '%asst%')
      and (lower(trim(name)) like '%store%' or lower(trim(name)) like '%branch%')
      and (lower(trim(name)) like '%manager%' or lower(trim(name)) like '%mgr%')
    )
  );

-- 2. Update public.get_approver_candidates
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
    coalesce(
      aa_auth.authority_level,
      p.authority_level,
      case
        when lower(trim(coalesce(p.name, ''))) in (
          'assistant store manager', 'asst. store manager', 'asst store manager',
          'assistant store mgr', 'asst. store mgr', 'asst store mgr',
          'store assistant manager', 'store asst manager', 'asm'
        ) or (
          (lower(trim(coalesce(p.name, ''))) like '%assistant%' or lower(trim(coalesce(p.name, ''))) like '%asst%')
          and (lower(trim(coalesce(p.name, ''))) like '%store%' or lower(trim(coalesce(p.name, ''))) like '%branch%')
          and (lower(trim(coalesce(p.name, ''))) like '%manager%' or lower(trim(coalesce(p.name, ''))) like '%mgr%')
        ) then 2
        else 1
      end
    ) as authority_level,
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
    and (
      coalesce(aa_auth.authority_level, p.authority_level, 0) >= coalesce(p_min_authority_level, 2)
      or (
        coalesce(p_min_authority_level, 2) <= 2
        and (
          lower(trim(coalesce(p.name, ''))) in (
            'assistant store manager', 'asst. store manager', 'asst store manager',
            'assistant store mgr', 'asst. store mgr', 'asst store mgr',
            'store assistant manager', 'store asst manager', 'asm'
          ) or (
            (lower(trim(coalesce(p.name, ''))) like '%assistant%' or lower(trim(coalesce(p.name, ''))) like '%asst%')
            and (lower(trim(coalesce(p.name, ''))) like '%store%' or lower(trim(coalesce(p.name, ''))) like '%branch%')
            and (lower(trim(coalesce(p.name, ''))) like '%manager%' or lower(trim(coalesce(p.name, ''))) like '%mgr%')
          )
        )
      )
    )
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

-- 3. Update public.find_request_approver to assign Assistant Store Managers when no Store Manager is assigned
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
              and (
                ea.position_id = v_required_position_id
                or (
                  v_level = 2
                  and exists (
                    select 1 from public.positions pos
                    where pos.id = ea.position_id
                      and (
                        lower(trim(pos.name)) in (
                          'assistant store manager', 'asst. store manager', 'asst store manager',
                          'assistant store mgr', 'asst. store mgr', 'asst store mgr',
                          'store assistant manager', 'store asst manager', 'asm'
                        )
                        or (
                          (lower(trim(pos.name)) like '%assistant%' or lower(trim(pos.name)) like '%asst%')
                          and (lower(trim(pos.name)) like '%store%' or lower(trim(pos.name)) like '%branch%')
                          and (lower(trim(pos.name)) like '%manager%' or lower(trim(pos.name)) like '%mgr%')
                        )
                      )
                  )
                )
              )
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
        -- At Level 2: Prioritize Store Manager first; if no Store Manager assigned, select Assistant Store Manager
        case when v_level = 2 and exists (
          select 1 from public.employee_assignments ea_sm
          join public.positions pos_sm on pos_sm.id = ea_sm.position_id
          where ea_sm.employee_id = aa.employee_id
            and ea_sm.is_primary = true
            and lower(trim(pos_sm.name)) like '%store manager%'
            and lower(trim(pos_sm.name)) not like '%assistant%'
            and lower(trim(pos_sm.name)) not like '%asst%'
        ) then 0 else 1 end,
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
      -- Level 2: Store supervisor / manager / assistant store manager
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
      where (
        ea.position_id = v_required_position_id
        or (
          v_level = 2
          and exists (
            select 1 from public.positions pos
            where pos.id = ea.position_id
              and (
                lower(trim(pos.name)) in (
                  'assistant store manager', 'asst. store manager', 'asst store manager',
                  'assistant store mgr', 'asst. store mgr', 'asst store mgr',
                  'store assistant manager', 'store asst manager', 'asm'
                )
                or (
                  (lower(trim(pos.name)) like '%assistant%' or lower(trim(pos.name)) like '%asst%')
                  and (lower(trim(pos.name)) like '%store%' or lower(trim(pos.name)) like '%branch%')
                  and (lower(trim(pos.name)) like '%manager%' or lower(trim(pos.name)) like '%mgr%')
                )
              )
          )
        )
      )
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
        -- Prefer Store Manager first, fallback to Assistant Store Manager if no Store Manager assigned
        case when v_level = 2 and exists (
          select 1 from public.positions pos_sm
          where pos_sm.id = ea.position_id
            and lower(trim(pos_sm.name)) like '%store manager%'
            and lower(trim(pos_sm.name)) not like '%assistant%'
            and lower(trim(pos_sm.name)) not like '%asst%'
        ) then 0 else 1 end,
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

    -- Additional Level 2 check: If still no approver found for store, look for Assistant Store Manager in that store
    if v_level = 2 and approver_employee_id is null and v_assignment.store_id is not null then
      select ea.employee_id, up.id
      into approver_employee_id, approver_user_profile_id
      from public.employee_assignments ea
      join public.positions pos on pos.id = ea.position_id
      left join public.user_profiles up on up.employee_id = ea.employee_id
      left join public.employees e on e.id = ea.employee_id
      left join auth.users au on au.id = up.auth_user_id
      where (
        lower(trim(pos.name)) in (
          'assistant store manager', 'asst. store manager', 'asst store manager',
          'assistant store mgr', 'asst. store mgr', 'asst store mgr',
          'store assistant manager', 'store asst manager', 'asm'
        )
        or (
          (lower(trim(pos.name)) like '%assistant%' or lower(trim(pos.name)) like '%asst%')
          and (lower(trim(pos.name)) like '%store%' or lower(trim(pos.name)) like '%branch%')
          and (lower(trim(pos.name)) like '%manager%' or lower(trim(pos.name)) like '%mgr%')
        )
      )
        and ea.employee_id <> p_requester_employee_id
        and not (ea.employee_id = any(p_used_employee_ids))
        and ea.is_primary = true
        and ea.effective_from <= current_date
        and (ea.effective_to is null or ea.effective_to >= current_date)
        and (
          ea.store_id = v_assignment.store_id
          or exists (
            select 1 from public.employee_store_assignments esa
            where esa.employee_id = ea.employee_id
              and esa.store_id = v_assignment.store_id
          )
        )
        and lower(trim(coalesce(e.employment_status, 'active'))) not in ('banned', 'inactive', 'terminated', 'resigned')
        and coalesce(up.is_active, true) = true
        and (au.banned_until is null or au.banned_until <= now())
      order by
        case when ea.department_id = v_assignment.department_id then 0 else 1 end,
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

notify pgrst, 'reload schema';

