-- Migration 0227: Allow Maintenance Manager to access My Team and manage Maintenance Department schedules
-- ============================================================================
-- 1. Updates manager_my_team_directory to return all employees under Maintenance
--    Department when accessed by a Maintenance Manager.
-- 2. Updates manager_my_team_schedules to return schedules for Maintenance employees.
-- 3. Ensures manager_save_team_schedules and manager_delete_team_schedule support Maintenance Manager.
-- 4. Fixes ambiguous column reference errors by qualifying table references and adding #variable_conflict use_column.
-- ============================================================================

-- Drop existing overloads if any to prevent ambiguity
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname in ('manager_my_team_directory', 'manager_my_team_schedules', 'manager_save_team_schedules', 'manager_delete_team_schedule', 'employee_my_flexible_schedule')
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end;
$$;

-- 1. Directory of team members
create or replace function public.manager_my_team_directory()
returns table (
  employee_id uuid,
  employee_no text,
  full_name text,
  photo_url text,
  employment_status text,
  department_name text,
  position_name text,
  time_schedule text,
  day_off text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_manager_employee_id uuid;
  v_manager_store_id uuid;
  v_manager_department_id uuid;
  v_manager_dept_name text;
  v_manager_pos_name text;
  v_is_maintenance_mgr boolean := false;
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

  -- Get manager's assignment, department, and position
  select
    ea.store_id,
    ea.department_id,
    lower(trim(coalesce(d.name, ''))),
    lower(trim(coalesce(p.name, '')))
  into
    v_manager_store_id,
    v_manager_department_id,
    v_manager_dept_name,
    v_manager_pos_name
  from public.employee_assignments ea
  left join public.departments d on d.id = ea.department_id
  left join public.positions p on p.id = ea.position_id
  where ea.employee_id = v_manager_employee_id
    and ea.is_primary = true
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  order by ea.created_at desc
  limit 1;

  -- Determine if manager is Maintenance Manager
  v_is_maintenance_mgr := (
    v_manager_pos_name = 'maintenance manager'
    or v_manager_pos_name like '%maintenance manager%'
    or (v_manager_dept_name = 'maintenance' and v_manager_pos_name like '%manager%')
  );

  return query
  select distinct on (e.id)
    e.id as employee_id,
    e.employee_no,
    trim(concat(e.first_name, ' ', coalesce(e.middle_name || ' ', ''), e.last_name, case when e.suffix is not null and e.suffix <> '' then ' ' || e.suffix else '' end)) as full_name,
    e.photo_url,
    coalesce(e.employment_status, 'Active') as employment_status,
    d.name as department_name,
    p.name as position_name,
    epd.time_schedule,
    epd.day_off
  from public.employees e
  join public.employee_assignments ea on ea.employee_id = e.id
    and ea.is_primary = true
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  left join public.departments d on d.id = ea.department_id
  left join public.positions p on p.id = ea.position_id
  left join public.employee_profile_details epd on epd.employee_id = e.id
  where (
    -- If Maintenance Manager: return all active employees under Maintenance department
    (v_is_maintenance_mgr and (
      ea.department_id = v_manager_department_id
      or lower(trim(coalesce(d.name, ''))) = 'maintenance'
      or lower(trim(coalesce(d.name, ''))) like '%maintenance%'
    ))
    -- Otherwise if Store Manager: return all active employees in the manager's store
    or (not v_is_maintenance_mgr and v_manager_store_id is not null and ea.store_id = v_manager_store_id)
  )
  and e.id <> v_manager_employee_id
  and lower(coalesce(e.employment_status, 'active')) not in ('resigned', 'terminated', 'separated')
  order by e.id, e.first_name asc, e.last_name asc;
end;
$$;

-- 2. Team schedules
create or replace function public.manager_my_team_schedules()
returns table (
  id uuid,
  schedule_date date,
  employee_id uuid,
  employee_name text,
  from_time text,
  to_time text,
  is_day_off boolean,
  notes text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_manager_employee_id uuid;
  v_manager_store_id uuid;
  v_manager_department_id uuid;
  v_manager_dept_name text;
  v_manager_pos_name text;
  v_is_maintenance_mgr boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  select up.employee_id into v_manager_employee_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
  limit 1;

  if v_manager_employee_id is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  -- Get manager's assignment, department, and position
  select
    ea.store_id,
    ea.department_id,
    lower(trim(coalesce(d.name, ''))),
    lower(trim(coalesce(p.name, '')))
  into
    v_manager_store_id,
    v_manager_department_id,
    v_manager_dept_name,
    v_manager_pos_name
  from public.employee_assignments ea
  left join public.departments d on d.id = ea.department_id
  left join public.positions p on p.id = ea.position_id
  where ea.employee_id = v_manager_employee_id
    and ea.is_primary = true
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  order by ea.created_at desc
  limit 1;

  v_is_maintenance_mgr := (
    v_manager_pos_name = 'maintenance manager'
    or v_manager_pos_name like '%maintenance manager%'
    or (v_manager_dept_name = 'maintenance' and v_manager_pos_name like '%manager%')
  );

  return query
  select
    mts.id,
    mts.schedule_date,
    mts.employee_id,
    trim(concat(e.first_name, ' ', coalesce(e.middle_name || ' ', ''), e.last_name, case when e.suffix is not null and e.suffix <> '' then ' ' || e.suffix else '' end)) as employee_name,
    to_char(mts.from_time, 'HH24:MI') as from_time,
    to_char(mts.to_time, 'HH24:MI') as to_time,
    mts.is_day_off,
    mts.notes
  from public.manager_team_schedules mts
  join public.employees e on e.id = mts.employee_id
  join public.employee_assignments ea on ea.employee_id = e.id
    and ea.is_primary = true
    and ea.effective_from <= current_date
    and (ea.effective_to is null or ea.effective_to >= current_date)
  left join public.departments d on d.id = ea.department_id
  where (
    -- If Maintenance Manager: schedules for all employees under Maintenance or created by manager
    (v_is_maintenance_mgr and (
      ea.department_id = v_manager_department_id
      or lower(trim(coalesce(d.name, ''))) = 'maintenance'
      or lower(trim(coalesce(d.name, ''))) like '%maintenance%'
      or mts.created_by_employee_id = v_manager_employee_id
    ))
    -- If Store Manager: schedules for employees in their store or created by manager
    or (not v_is_maintenance_mgr and (
      (v_manager_store_id is not null and ea.store_id = v_manager_store_id)
      or mts.created_by_employee_id = v_manager_employee_id
    ))
  )
  order by mts.schedule_date asc, e.first_name asc, e.last_name asc;
end;
$$;

-- 3. Save schedules (accepts text[] or uuid[] via text[] input)
create or replace function public.manager_save_team_schedules(
  p_employee_ids text[],
  p_schedule_date date,
  p_from_time text,
  p_to_time text,
  p_is_day_off boolean,
  p_notes text
)
returns table (
  id uuid,
  schedule_date date,
  employee_id uuid,
  employee_name text,
  from_time text,
  to_time text,
  is_day_off boolean,
  notes text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_manager_employee_id uuid;
  v_emp_text text;
  v_emp_id uuid;
  v_parsed_from time;
  v_parsed_to time;
begin
  if auth.uid() is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  select up.employee_id into v_manager_employee_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
  limit 1;

  if v_manager_employee_id is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  if coalesce(p_is_day_off, false) then
    v_parsed_from := null;
    v_parsed_to := null;
  else
    v_parsed_from := nullif(trim(p_from_time), '')::time;
    v_parsed_to := nullif(trim(p_to_time), '')::time;
  end if;

  if p_employee_ids is not null then
    foreach v_emp_text in array p_employee_ids loop
      begin
        v_emp_id := v_emp_text::uuid;
      exception when others then
        continue;
      end;

      -- Explicitly alias table to avoid ambiguous column reference with RETURNS TABLE columns
      delete from public.manager_team_schedules mts
      where mts.employee_id = v_emp_id
        and mts.schedule_date = p_schedule_date;

      -- Insert updated schedule
      insert into public.manager_team_schedules (
        employee_id,
        schedule_date,
        from_time,
        to_time,
        is_day_off,
        notes,
        created_by_employee_id,
        created_at,
        updated_at
      )
      values (
        v_emp_id,
        p_schedule_date,
        v_parsed_from,
        v_parsed_to,
        coalesce(p_is_day_off, false),
        nullif(trim(p_notes), ''),
        v_manager_employee_id,
        now(),
        now()
      );
    end loop;
  end if;

  return query
  select
    s.id,
    s.schedule_date,
    s.employee_id,
    s.employee_name,
    s.from_time,
    s.to_time,
    s.is_day_off,
    s.notes
  from public.manager_my_team_schedules() s;
end;
$$;

-- 4. Delete schedule
create or replace function public.manager_delete_team_schedule(
  p_schedule_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  delete from public.manager_team_schedules mts
  where mts.id = p_schedule_id;
end;
$$;

-- 5. Flexible schedule lookup for individual employee
create or replace function public.employee_my_flexible_schedule(
  p_schedule_date date
)
returns table (
  id uuid,
  schedule_date date,
  from_time text,
  to_time text,
  is_day_off boolean,
  notes text,
  previous_from_time text,
  previous_to_time text,
  previous_day_off_date text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_employee_id uuid;
  v_base_schedule text;
  v_base_day_off text;
begin
  if auth.uid() is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  select up.employee_id into v_employee_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
  limit 1;

  if v_employee_id is null then
    raise exception 'Your login is not linked to an active employee profile.';
  end if;

  -- Get base profile schedule
  select epd.time_schedule, epd.day_off
  into v_base_schedule, v_base_day_off
  from public.employee_profile_details epd
  where epd.employee_id = v_employee_id
  limit 1;

  return query
  select
    mts.id,
    mts.schedule_date,
    to_char(mts.from_time, 'HH24:MI') as from_time,
    to_char(mts.to_time, 'HH24:MI') as to_time,
    mts.is_day_off,
    mts.notes,
    v_base_schedule as previous_from_time,
    null::text as previous_to_time,
    v_base_day_off as previous_day_off_date
  from public.manager_team_schedules mts
  where mts.employee_id = v_employee_id
    and mts.schedule_date = p_schedule_date
  order by mts.created_at desc
  limit 1;
end;
$$;

-- 6. Grant execute permissions
grant execute on function public.manager_my_team_directory() to authenticated;
grant execute on function public.manager_my_team_schedules() to authenticated;
grant execute on function public.manager_save_team_schedules(text[], date, text, text, boolean, text) to authenticated;
grant execute on function public.manager_delete_team_schedule(uuid) to authenticated;
grant execute on function public.employee_my_flexible_schedule(date) to authenticated;

notify pgrst, 'reload schema';
