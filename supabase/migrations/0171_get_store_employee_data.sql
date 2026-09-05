-- Migration 0171: Create RPC for getting store employee directory as JSON
-- This provides a structured employee catalog for store and external systems,
-- structured similarly to the store inventory data endpoint.

create or replace function public.get_store_employee_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with latest_assignments as (
    select distinct on (ea.employee_id)
      ea.employee_id,
      ea.company_id,
      ea.area_id,
      ea.cluster_id,
      ea.store_id,
      ea.department_id,
      ea.position_id,
      ea.function_id,
      ea.effective_from,
      ea.effective_to
    from public.employee_assignments ea
    order by ea.employee_id, ea.is_primary desc, ea.effective_from desc, ea.created_at desc
  ),
  employee_records as (
    select
      e.id,
      coalesce(e.employee_no, '') as employee_no,
      trim(concat_ws(' ', e.first_name, nullif(e.middle_name, ''), e.last_name, nullif(e.suffix, ''))) as name,
      e.first_name,
      coalesce(e.middle_name, '') as middle_name,
      e.last_name,
      coalesce(e.suffix, '') as suffix,
      coalesce(e.email, '') as email,
      coalesce(e.phone, '') as phone,
      coalesce(e.photo_url, '') as photo_url,
      coalesce(e.employment_status, 'Active') as employment_status,
      e.birth_date,
      coalesce(e.gender, '') as gender,
      coalesce(e.civil_status, '') as civil_status,
      coalesce(c.name, '') as company_name,
      coalesce(d.name, '') as department_name,
      coalesce(p.name, '') as position_name,
      coalesce(s.name, '') as store_name,
      coalesce(cl.name, '') as cluster_name,
      coalesce(a.name, '') as area_name,
      coalesce(epd.employee_type, '') as employee_type,
      coalesce(epd.payroll_class, '') as payroll_class,
      coalesce(epd.time_schedule, '') as time_schedule,
      coalesce(epd.day_off, '') as day_off,
      coalesce(epd.emergency_contact, '') as emergency_contact,
      coalesce(epd.emergency_contact_no, '') as emergency_contact_no
    from public.employees e
    left join latest_assignments la on la.employee_id = e.id
    left join public.companies c on c.id = la.company_id
    left join public.departments d on d.id = la.department_id
    left join public.positions p on p.id = la.position_id
    left join public.stores s on s.id = la.store_id
    left join public.clusters cl on cl.id = la.cluster_id
    left join public.areas a on a.id = la.area_id
    left join public.employee_profile_details epd on epd.employee_id = e.id
    where e.employment_status is null or lower(e.employment_status) not in ('resigned', 'terminated')
    order by e.last_name asc, e.first_name asc
  )
  select jsonb_build_object(
    'status', 'success',
    'count', count(*),
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'employees', coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  )
  into v_result
  from employee_records r;

  return v_result;
end;
$$;

-- Grant execution to anon and authenticated roles
grant execute on function public.get_store_employee_data() to anon, authenticated, service_role;
