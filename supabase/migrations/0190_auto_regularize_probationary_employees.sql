-- Migration 0190: Auto-regularize probationary employees upon reaching 6 months of service
-- 1. Trigger to automatically coerce/change employee_type from 'Probationary' to 'Regular'
--    when the employee has reached 6 months or more from their date hired.
-- 2. Update hr_employee_profile_detail to ensure employee_type is auto-updated to 'Regular'
--    when profile details are loaded on the admin side.
-- 3. Immediate update of existing probationary employees who have reached 6 months.

-- 1. Function and trigger for employee_profile_details
create or replace function public.trg_auto_promote_probationary_to_regular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hire_date date;
begin
  if lower(trim(coalesce(new.employee_type, ''))) = 'probationary' then
    select coalesce(min(effective_from), current_date)
    into v_hire_date
    from public.employee_assignments
    where employee_id = new.employee_id;

    if v_hire_date is not null and current_date >= (v_hire_date + interval '6 months') then
      new.employee_type := 'Regular';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_promote_probationary_to_regular on public.employee_profile_details;
create trigger trg_auto_promote_probationary_to_regular
before insert or update on public.employee_profile_details
for each row
execute function public.trg_auto_promote_probationary_to_regular();

-- 2. Function and trigger for employee_assignments (when hire date is inserted/updated)
create or replace function public.trg_auto_promote_probationary_on_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.effective_from is not null and current_date >= (new.effective_from + interval '6 months') then
    update public.employee_profile_details
    set employee_type = 'Regular',
        updated_at = now()
    where employee_id = new.employee_id
      and lower(trim(coalesce(employee_type, ''))) = 'probationary';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_promote_probationary_on_assignment_change on public.employee_assignments;
create trigger trg_auto_promote_probationary_on_assignment_change
after insert or update on public.employee_assignments
for each row
execute function public.trg_auto_promote_probationary_on_assignment_change();

-- 3. Update hr_employee_profile_detail RPC to auto-regularize in admin profile view
drop function if exists public.hr_employee_profile_detail(text, text, uuid);

create or replace function public.hr_employee_profile_detail(
  p_username text default null,
  p_password text default null,
  p_employee_id uuid default null
)
returns table (
  employee_id uuid,
  employee_no text,
  first_name text,
  middle_name text,
  last_name text,
  suffix text,
  birth_date date,
  gender text,
  civil_status text,
  email text,
  phone text,
  company_name text,
  department_name text,
  position_name text,
  hired_date date,
  employee_type text,
  employment_status text,
  time_schedule text,
  day_off_day text,
  payroll_class text,
  religion text,
  height text,
  weight text,
  other_phone text,
  social_media_type text,
  social_media_detail text,
  zip_code text,
  present_address text,
  permanent_address text,
  tin text,
  sss text,
  pagibig text,
  philhealth text,
  bank_type text,
  account_no text,
  emergency_contact text,
  emergency_contact_no text,
  reason_of_inactivity text,
  date_inactive text,
  elementary_school text,
  elementary_year text,
  secondary_school text,
  secondary_year text,
  college_school text,
  college_year text,
  college_course text,
  year_graduated text,
  father_name text,
  father_occupation text,
  mother_maiden_name text,
  mother_occupation text,
  number_of_siblings text,
  birth_order text,
  spouse_name text,
  spouse_occupation text,
  spouse_contact text,
  children_names text,
  children_count text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_hr_staff()
    or (
      lower(trim(coalesce(p_username, ''))) = 'hyg_hr'
      and coalesce(p_password, '') = 'hyg_hr2026'
    )
  ) then
    raise exception 'HR access is required.';
  end if;

  if p_employee_id is null then
    raise exception 'Employee id is required.';
  end if;

  -- Auto-update employee_profile_details if reached 6 months
  update public.employee_profile_details epd_up
  set employee_type = 'Regular',
      updated_at = now()
  from public.employee_assignments ea_up
  where epd_up.employee_id = ea_up.employee_id
    and ea_up.employee_id = p_employee_id
    and ea_up.is_primary = true
    and lower(trim(coalesce(epd_up.employee_type, ''))) = 'probationary'
    and ea_up.effective_from is not null
    and current_date >= (ea_up.effective_from + interval '6 months');

  return query
  select
    e.id,
    e.employee_no,
    e.first_name,
    e.middle_name,
    e.last_name,
    e.suffix,
    e.birth_date,
    e.gender,
    e.civil_status,
    e.email,
    e.phone,
    c.name,
    d.name,
    p.name,
    ea.effective_from,
    case
      when lower(trim(coalesce(epd.employee_type, ''))) = 'probationary'
       and ea.effective_from is not null
       and current_date >= (ea.effective_from + interval '6 months')
      then 'Regular'
      else coalesce(epd.employee_type, 'Regular')
    end as employee_type,
    e.employment_status,
    epd.time_schedule,
    epd.day_off,
    epd.payroll_class,
    epd.religion,
    epd.height,
    epd.weight,
    epd.other_phone,
    epd.social_media_type,
    epd.social_media_detail,
    epd.zip_code,
    epd.present_address,
    epd.permanent_address,
    epd.tin,
    epd.sss,
    epd.pagibig,
    epd.philhealth,
    epd.bank_type,
    epd.account_no,
    epd.emergency_contact,
    epd.emergency_contact_no,
    epd.reason_of_inactivity,
    epd.date_inactive,
    epd.elementary_school,
    epd.elementary_year,
    epd.secondary_school,
    epd.secondary_year,
    epd.college_school,
    epd.college_year,
    epd.college_course,
    epd.year_graduated,
    epd.father_name,
    epd.father_occupation,
    epd.mother_maiden_name,
    epd.mother_occupation,
    epd.number_of_siblings,
    epd.birth_order,
    epd.spouse_name,
    epd.spouse_occupation,
    epd.spouse_contact,
    epd.children_names,
    epd.children_count
  from public.employees e
  left join public.employee_profile_details epd on epd.employee_id = e.id
  left join lateral (
    select *
    from public.employee_assignments current_ea
    where current_ea.employee_id = e.id
      and current_ea.is_primary = true
    order by
      case
        when current_ea.effective_to is null or current_ea.effective_to >= current_date then 0
        else 1
      end,
      current_ea.effective_from desc,
      current_ea.created_at desc
    limit 1
  ) ea on true
  left join public.companies c on c.id = ea.company_id
  left join public.departments d on d.id = ea.department_id
  left join public.positions p on p.id = ea.position_id
  where e.id = p_employee_id;
end;
$$;

grant execute on function public.hr_employee_profile_detail(text, text, uuid) to anon, authenticated;

-- 4. Immediate one-time update for all current probationary employees with >= 6 months service
update public.employee_profile_details epd
set employee_type = 'Regular',
    updated_at = now()
from public.employee_assignments ea
where epd.employee_id = ea.employee_id
  and ea.is_primary = true
  and lower(trim(coalesce(epd.employee_type, ''))) = 'probationary'
  and ea.effective_from is not null
  and current_date >= (ea.effective_from + interval '6 months');
