-- Migration 0191: Auto-promote trainee employees to probationary upon reaching 1 month of service
-- 1. Update public.trg_auto_promote_probationary_to_regular on employee_profile_details:
--    - When employee_type is 'Trainee' and date hired is >= 1 month, auto-promote to 'Probationary'
--      (or 'Regular' if already >= 6 months).
--    - When employee_type is 'Probationary' and date hired is >= 6 months, auto-promote to 'Regular'.
-- 2. Update public.trg_auto_promote_probationary_on_assignment_change on employee_assignments:
--    - When effective_from is inserted or updated:
--      * If >= 6 months: promote 'Probationary' and 'Trainee' to 'Regular'.
--      * If >= 1 month: promote 'Trainee' to 'Probationary'.
-- 3. Update public.hr_employee_profile_detail RPC:
--    - Auto-update employee_profile_details when HR loads employee details:
--      * 'Trainee' with >= 1 month -> 'Probationary' (or 'Regular' if >= 6 months).
--      * 'Probationary' with >= 6 months -> 'Regular'.
-- 4. Immediate one-time update for all existing Trainee employees who have reached 1 month of service.

-- 1. Function and trigger for employee_profile_details
create or replace function public.trg_auto_promote_probationary_to_regular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hire_date date;
  v_emp_type text;
begin
  v_emp_type := lower(trim(coalesce(new.employee_type, '')));

  if v_emp_type in ('probationary', 'trainee') then
    select coalesce(min(effective_from), current_date)
    into v_hire_date
    from public.employee_assignments
    where employee_id = new.employee_id;

    if v_hire_date is not null then
      if current_date >= (v_hire_date + interval '6 months') then
        new.employee_type := 'Regular';
      elsif v_emp_type = 'trainee' and current_date >= (v_hire_date + interval '1 month') then
        new.employee_type := 'Probationary';
      end if;
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

-- 2. Function and trigger for employee_assignments
create or replace function public.trg_auto_promote_probationary_on_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.effective_from is not null then
    if current_date >= (new.effective_from + interval '6 months') then
      update public.employee_profile_details
      set employee_type = 'Regular',
          updated_at = now()
      where employee_id = new.employee_id
        and lower(trim(coalesce(employee_type, ''))) in ('probationary', 'trainee');
    elsif current_date >= (new.effective_from + interval '1 month') then
      update public.employee_profile_details
      set employee_type = 'Probationary',
          updated_at = now()
      where employee_id = new.employee_id
        and lower(trim(coalesce(employee_type, ''))) = 'trainee';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_promote_probationary_on_assignment_change on public.employee_assignments;
create trigger trg_auto_promote_probationary_on_assignment_change
after insert or update on public.employee_assignments
for each row
execute function public.trg_auto_promote_probationary_on_assignment_change();

-- 3. Update hr_employee_profile_detail RPC to auto-promote in admin profile view
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

  -- Auto-update employee_profile_details if reached 6 months (Regular) or 1 month (Probationary)
  update public.employee_profile_details epd_up
  set employee_type = case
        when current_date >= (ea_up.effective_from + interval '6 months') then 'Regular'
        when lower(trim(coalesce(epd_up.employee_type, ''))) = 'trainee'
         and current_date >= (ea_up.effective_from + interval '1 month') then 'Probationary'
        else epd_up.employee_type
      end,
      updated_at = now()
  from public.employee_assignments ea_up
  where epd_up.employee_id = ea_up.employee_id
    and ea_up.employee_id = p_employee_id
    and ea_up.is_primary = true
    and ea_up.effective_from is not null
    and (
      (lower(trim(coalesce(epd_up.employee_type, ''))) in ('probationary', 'trainee')
       and current_date >= (ea_up.effective_from + interval '6 months'))
      or
      (lower(trim(coalesce(epd_up.employee_type, ''))) = 'trainee'
       and current_date >= (ea_up.effective_from + interval '1 month'))
    );

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
      when lower(trim(coalesce(epd.employee_type, ''))) in ('probationary', 'trainee')
       and ea.effective_from is not null
       and current_date >= (ea.effective_from + interval '6 months')
      then 'Regular'
      when lower(trim(coalesce(epd.employee_type, ''))) = 'trainee'
       and ea.effective_from is not null
       and current_date >= (ea.effective_from + interval '1 month')
      then 'Probationary'
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

-- 4. Immediate one-time update for all current trainee employees with >= 1 month service
update public.employee_profile_details epd
set employee_type = case
      when current_date >= (ea.effective_from + interval '6 months') then 'Regular'
      else 'Probationary'
    end,
    updated_at = now()
from public.employee_assignments ea
where epd.employee_id = ea.employee_id
  and ea.is_primary = true
  and lower(trim(coalesce(epd.employee_type, ''))) = 'trainee'
  and ea.effective_from is not null
  and current_date >= (ea.effective_from + interval '1 month');
