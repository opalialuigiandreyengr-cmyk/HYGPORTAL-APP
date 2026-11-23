-- Migration 0235: RPC to list eligible department/cluster/area employees for manager badge award requisitions
-- Excludes Store Managers and Assistant Store Managers.
-- For Cluster Managers: filters by cluster_id.
-- For Area Managers: filters by area_id.
-- For Department Managers / Directors / Heads: filters by department_id and approval route (department_approval_ladders / request_approval_steps).

drop function if exists public.manager_badge_award_recipients();

create or replace function public.manager_badge_award_recipients()
returns table (
  employee_id uuid,
  employee_no text,
  full_name text,
  department_name text,
  position_name text,
  photo_url text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_manager_employee_id uuid;
  v_manager_company_id uuid;
  v_manager_department_id uuid;
  v_manager_position_id uuid;
  v_manager_cluster_id uuid;
  v_manager_area_id uuid;
  v_manager_pos_name text := '';
  v_manager_dept_name text := '';
  v_manager_authority_level int := 1;
  v_is_excluded_store_role boolean := false;
  v_is_cluster_mgr boolean := false;
  v_is_area_mgr boolean := false;
  v_is_general_mgr boolean := false;
  v_is_eligible boolean := false;
begin
  if auth.uid() is null then
    return;
  end if;

  select up.employee_id into v_manager_employee_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
  limit 1;

  if v_manager_employee_id is null then
    return;
  end if;

  -- Manager's active primary assignment
  select
    ea.company_id,
    ea.department_id,
    ea.position_id,
    coalesce(ea.cluster_id, s.cluster_id),
    coalesce(ea.area_id, s.area_id, cl.area_id),
    lower(trim(coalesce(p.name, ''))),
    lower(trim(coalesce(d.name, ''))),
    coalesce(p.authority_level, 1)
  into
    v_manager_company_id,
    v_manager_department_id,
    v_manager_position_id,
    v_manager_cluster_id,
    v_manager_area_id,
    v_manager_pos_name,
    v_manager_dept_name,
    v_manager_authority_level
  from public.employee_assignments ea
  left join public.stores s on s.id = ea.store_id
  left join public.clusters cl on cl.id = coalesce(ea.cluster_id, s.cluster_id)
  left join public.positions p on p.id = ea.position_id
  left join public.departments d on d.id = ea.department_id
  where ea.employee_id = v_manager_employee_id
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  order by ea.is_primary desc, ea.effective_from desc, ea.created_at desc
  limit 1;

  -- Fallback cluster/area/authority from authority_assignments
  select
    coalesce(v_manager_cluster_id, aa.cluster_id),
    coalesce(v_manager_area_id, aa.area_id),
    greatest(v_manager_authority_level, coalesce(aa.authority_level, 1))
  into
    v_manager_cluster_id,
    v_manager_area_id,
    v_manager_authority_level
  from public.authority_assignments aa
  where aa.employee_id = v_manager_employee_id
    and aa.is_active = true
    and aa.effective_from <= current_date
    and (aa.effective_to is null or aa.effective_to >= current_date)
  order by aa.authority_level desc, aa.created_at desc
  limit 1;

  -- Exclude Store Managers and Assistant Store Managers
  v_is_excluded_store_role := (
    v_manager_pos_name in (
      'store manager', 'store mgr',
      'assistant store manager', 'asst. store manager', 'asst store manager',
      'assistant store mgr', 'asst. store mgr', 'asst store mgr',
      'store assistant manager', 'store asst manager', 'asm'
    )
    or v_manager_pos_name like '%store manager%'
    or v_manager_pos_name like '%store mgr%'
    or v_manager_pos_name like 'asm %'
    or v_manager_pos_name like '% asm'
    or v_manager_pos_name like '%(asm)%'
  );

  if v_is_excluded_store_role then
    return;
  end if;

  v_is_eligible := (
    v_manager_pos_name like '%manager%'
    or v_manager_pos_name like '%mgr%'
    or v_manager_pos_name like '%director%'
    or (v_manager_pos_name like '%head%' and v_manager_pos_name not like '%store head%')
    or v_manager_authority_level >= 3
  );

  if not v_is_eligible then
    return;
  end if;

  v_is_cluster_mgr := (
    v_manager_pos_name like '%cluster%'
    or (v_manager_authority_level = 4 and v_manager_cluster_id is not null)
  );

  v_is_area_mgr := (
    v_manager_pos_name like '%area%'
    or (v_manager_authority_level = 5 and v_manager_area_id is not null)
  );

  v_is_general_mgr := (
    v_manager_pos_name = 'general manager'
    or v_manager_authority_level >= 8
  );

  return query
  select distinct on (e.id)
    e.id as employee_id,
    e.employee_no,
    trim(concat(
      e.first_name,
      ' ',
      coalesce(e.middle_name || ' ', ''),
      e.last_name,
      case when e.suffix is not null and e.suffix <> '' then ' ' || e.suffix else '' end
    )) as full_name,
    coalesce(d.name, 'General') as department_name,
    p.name as position_name,
    e.photo_url
  from public.employees e
  join public.employee_assignments ea on ea.employee_id = e.id
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  left join public.stores s on s.id = ea.store_id
  left join public.clusters cl on cl.id = coalesce(ea.cluster_id, s.cluster_id)
  left join public.departments d on d.id = ea.department_id
  left join public.positions p on p.id = ea.position_id
  where e.id <> v_manager_employee_id
    and lower(coalesce(e.employment_status, 'active')) not in ('resigned', 'terminated', 'separated', 'inactive')
    and (v_manager_company_id is null or ea.company_id = v_manager_company_id)
    and (
      -- 1. General Manager: all active employees in the company
      v_is_general_mgr
      -- 2. Cluster Manager: employees under their cluster
      or (
        v_is_cluster_mgr
        and v_manager_cluster_id is not null
        and coalesce(ea.cluster_id, s.cluster_id) = v_manager_cluster_id
      )
      -- 3. Area Manager: employees under their area
      or (
        v_is_area_mgr
        and v_manager_area_id is not null
        and coalesce(ea.area_id, s.area_id, cl.area_id) = v_manager_area_id
      )
      -- 4. Department Manager / Director / Head: employees in their department OR covered by their approval route
      or (
        not v_is_cluster_mgr
        and not v_is_area_mgr
        and (
          (v_manager_department_id is not null and ea.department_id = v_manager_department_id)
          or (
            v_manager_position_id is not null
            and exists (
              select 1
              from public.department_approval_ladders l
              where l.department_id = ea.department_id
                and l.approver_position_id = v_manager_position_id
            )
            and (v_manager_cluster_id is null or coalesce(ea.cluster_id, s.cluster_id) = v_manager_cluster_id)
            and (v_manager_area_id is null or coalesce(ea.area_id, s.area_id, cl.area_id) = v_manager_area_id)
          )
          or exists (
            select 1
            from public.requests r
            join public.request_approval_steps ras on ras.request_id = r.id
            where r.submitted_by_employee_id = e.id
              and ras.assigned_approver_employee_id = v_manager_employee_id
          )
        )
      )
    )
  order by e.id, ea.is_primary desc, ea.effective_from desc, ea.created_at desc;
end;
$$;

grant execute on function public.manager_badge_award_recipients() to authenticated;
grant execute on function public.manager_badge_award_recipients() to service_role;
