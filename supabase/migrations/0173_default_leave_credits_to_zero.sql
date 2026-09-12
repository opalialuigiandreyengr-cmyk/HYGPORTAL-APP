-- Migration 0173: Default leave credits allocation to 0 for new employees and future initializations.
-- Super Admin rules allocate annual leave credits upon reaching 1 year / 365 days of service.
-- Existing records in public.leave_balances are strictly preserved and unaffected.

-- 1. Alter table column default to 0 (applies to future inserts)
alter table if exists public.leave_balances
  alter column annual_credit_days set default 0;

-- 2. Update get_available_leave_days to coalesce missing balances to 0 instead of 7
create or replace function public.get_available_leave_days(p_employee_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce((
      select annual_credit_days - used_days
      from public.leave_balances
      where employee_id = p_employee_id
    ), 0)
  );
$$;

grant execute on function public.get_available_leave_days(uuid) to authenticated;

-- 3. Update admin_create_unlinked_user to initialize new employee balance with 0 credits
create or replace function public.admin_create_unlinked_user(
  p_username text,
  p_email text,
  p_password text,
  p_app_role text default 'employee',
  p_employee_id uuid default null,
  p_company_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_admin record;
  v_username text := nullif(lower(trim(coalesce(p_username, ''))), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_password text := coalesce(p_password, '');
  v_role text := lower(trim(coalesce(p_app_role, 'employee')));
  v_auth_user_id uuid := gen_random_uuid();
  v_profile_id uuid;
begin
  select *
  into v_admin
  from public.admin_desktop_login_check()
  limit 1;

  if v_admin.app_role not in ('admin', 'super_admin') then
    raise exception 'Admin access is required.';
  end if;

  if v_username is null then
    raise exception 'Username is required.';
  end if;

  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  if length(v_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  if v_role not in ('employee', 'hr', 'admin', 'super_admin') then
    raise exception 'Role must be employee, hr, admin, or super_admin.';
  end if;

  if v_role = 'super_admin' and v_admin.app_role <> 'super_admin' then
    raise exception 'Only a super admin can create a super admin.';
  end if;

  if exists (select 1 from public.user_profiles where lower(username) = v_username) then
    raise exception 'This username is already taken.';
  end if;

  if exists (select 1 from auth.users where lower(email::text) = v_email) then
    raise exception 'This email is already registered.';
  end if;

  if p_employee_id is not null then
    if not exists (select 1 from public.employees where id = p_employee_id) then
      raise exception 'Selected employee was not found.';
    end if;
    if exists (select 1 from public.user_profiles where employee_id = p_employee_id) then
      raise exception 'This employee is already linked to another user.';
    end if;
  end if;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_auth_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf', 10)),
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('email_verified', true),
    now(),
    now()
  );

  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_auth_user_id::text,
    v_auth_user_id,
    jsonb_build_object(
      'sub', v_auth_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.user_profiles (
    auth_user_id,
    employee_id,
    username,
    app_role,
    is_active
  )
  values (
    v_auth_user_id,
    p_employee_id,
    v_username,
    v_role,
    true
  )
  returning id into v_profile_id;

  if p_employee_id is not null then
    insert into public.leave_balances (employee_id, annual_credit_days, used_days)
    values (p_employee_id, 0, 0)
    on conflict (employee_id) do nothing;
  end if;

  -- Insert company assignments if company ids are provided
  if p_company_ids is not null then
    declare
      c_id uuid;
    begin
      foreach c_id in array p_company_ids loop
        insert into public.hr_company_assignments (user_profile_id, company_id)
        values (v_profile_id, c_id)
        on conflict (user_profile_id, company_id) do nothing;
      end loop;
    end;
  end if;

  return v_profile_id;
end;
$$;

grant execute on function public.admin_create_unlinked_user(text, text, text, text, uuid, uuid[]) to authenticated;

-- 4. Update admin_get_registered_users to coalesce missing balance to 0 instead of 7
create or replace function public.admin_get_registered_users()
returns table (
  user_profile_id uuid,
  auth_user_id uuid,
  username text,
  email text,
  app_role text,
  is_active boolean,
  is_banned boolean,
  employee_id uuid,
  employee_no text,
  full_name text,
  photo_url text,
  employment_status text,
  leave_credit_days numeric,
  leave_used_days numeric,
  leave_remaining_days numeric,
  offset_balance_hours numeric,
  registered_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
begin
  select *
  into v_profile
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
    and up.app_role in ('admin', 'super_admin')
    and up.is_active = true;

  if v_profile.id is null then
    raise exception 'Admin access is required.';
  end if;

  return query
  select
    up.id as user_profile_id,
    au.id as auth_user_id,
    up.username,
    au.email::text as email,
    up.app_role,
    up.is_active,
    coalesce(au.banned_until > now(), false) as is_banned,
    e.id as employee_id,
    e.employee_no,
    nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), '') as full_name,
    e.photo_url,
    e.employment_status,
    coalesce(lb.annual_credit_days, case when e.id is null then null else 0 end) as leave_credit_days,
    coalesce(lb.used_days, case when e.id is null then null else 0 end) as leave_used_days,
    case
      when e.id is null then null
      else coalesce(lb.annual_credit_days, 0) - coalesce(lb.used_days, 0)
    end as leave_remaining_days,
    coalesce(ob.balance_hours, case when e.id is null then null else 0 end) as offset_balance_hours,
    up.created_at as registered_at,
    au.email_confirmed_at,
    au.last_sign_in_at
  from public.user_profiles up
  join auth.users au on au.id = up.auth_user_id
  left join public.employees e on e.id = up.employee_id
  left join public.leave_balances lb on lb.employee_id = e.id
  left join public.offset_balances ob on ob.employee_id = e.id
  order by up.created_at desc, up.username nulls last;
end;
$$;

grant execute on function public.admin_get_registered_users() to authenticated;

-- 5. Update admin_set_employee_leave_credits to default new record to 0
create or replace function public.admin_set_employee_leave_credits(
  p_user_profile_id uuid,
  p_annual_credit_days numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
  v_profile public.user_profiles;
  v_used_days numeric;
begin
  select *
  into v_actor
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
    and up.app_role in ('admin', 'super_admin')
    and up.is_active = true;

  if v_actor.id is null then
    raise exception 'Admin access is required.';
  end if;

  if p_annual_credit_days is null or p_annual_credit_days < 0 then
    raise exception 'Leave credits must be zero or higher.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null then
    raise exception 'User was not found.';
  end if;

  if v_profile.employee_id is null then
    raise exception 'Leave credits can only be allocated to linked employees.';
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_profile.employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  select used_days
  into v_used_days
  from public.leave_balances
  where employee_id = v_profile.employee_id;

  if p_annual_credit_days < coalesce(v_used_days, 0) then
    raise exception 'Annual leave credits cannot be lower than used leave days (%).', v_used_days;
  end if;

  update public.leave_balances
  set annual_credit_days = round(p_annual_credit_days, 2),
      updated_at = now()
  where employee_id = v_profile.employee_id;

  insert into public.audit_logs (
    actor_user_profile_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor.id,
    'set_leave_credits',
    'user_profile',
    v_profile.id,
    jsonb_build_object(
      'employee_id', v_profile.employee_id,
      'annual_credit_days', round(p_annual_credit_days, 2)
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_set_employee_leave_credits(uuid, numeric) to authenticated;

-- 6. Update admin_deduct_employee_leave_credits to default to 0
create or replace function public.admin_deduct_employee_leave_credits(
  p_user_profile_id uuid,
  p_deduct_days numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
  v_profile public.user_profiles;
  v_used_days numeric;
  v_current_annual numeric;
  v_new_used numeric;
begin
  select *
  into v_actor
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
    and up.app_role in ('admin', 'super_admin')
    and up.is_active = true;

  if v_actor.id is null then
    raise exception 'Admin access is required.';
  end if;

  if p_deduct_days is null or p_deduct_days <= 0 then
    raise exception 'Deduction days must be greater than zero.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Reason is required for leave credit deduction.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null then
    raise exception 'User was not found.';
  end if;

  if v_profile.employee_id is null then
    raise exception 'Leave credits can only be deducted from linked employees.';
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_profile.employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  select coalesce(lb.annual_credit_days, 0), coalesce(lb.used_days, 0)
  into v_current_annual, v_used_days
  from public.leave_balances lb
  where lb.employee_id = v_profile.employee_id;

  v_new_used := round(v_used_days + p_deduct_days, 2);

  if v_new_used > v_current_annual then
    raise exception 'Deduction exceeds available credits. Remaining: % day(s).', v_current_annual - v_used_days;
  end if;

  update public.leave_balances
  set used_days = v_new_used,
      updated_at = now()
  where employee_id = v_profile.employee_id;

  insert into public.audit_logs (
    actor_user_profile_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor.id,
    'deduct_leave_credits',
    'user_profile',
    v_profile.id,
    jsonb_build_object(
      'employee_id', v_profile.employee_id,
      'deduct_days', p_deduct_days,
      'reason', trim(p_reason),
      'annual_credit_days', v_current_annual,
      'old_used_days', v_used_days,
      'new_used_days', v_new_used
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_deduct_employee_leave_credits(uuid, numeric, text) to authenticated;

-- 7. Update admin_reimburse_employee_leave_credits to default to 0
create or replace function public.admin_reimburse_employee_leave_credits(
  p_user_profile_id uuid,
  p_reimburse_days numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
  v_profile public.user_profiles;
  v_used_days numeric;
  v_current_annual numeric;
  v_new_used numeric;
  v_new_annual numeric;
begin
  select *
  into v_actor
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
    and up.app_role in ('admin', 'super_admin')
    and up.is_active = true;

  if v_actor.id is null then
    raise exception 'Admin access is required.';
  end if;

  if p_reimburse_days is null or p_reimburse_days <= 0 then
    raise exception 'Reimbursement days must be greater than zero.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Reason is required for leave credit reimbursement.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null then
    raise exception 'User was not found.';
  end if;

  if v_profile.employee_id is null then
    raise exception 'Leave credits can only be reimbursed for linked employees.';
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_profile.employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  select coalesce(lb.annual_credit_days, 0), coalesce(lb.used_days, 0)
  into v_current_annual, v_used_days
  from public.leave_balances lb
  where lb.employee_id = v_profile.employee_id;

  if v_used_days >= p_reimburse_days then
    v_new_used := round(v_used_days - p_reimburse_days, 2);
    v_new_annual := v_current_annual;
  else
    v_new_used := 0;
    v_new_annual := round(v_current_annual + (p_reimburse_days - v_used_days), 2);
  end if;

  update public.leave_balances
  set annual_credit_days = v_new_annual,
      used_days = v_new_used,
      updated_at = now()
  where employee_id = v_profile.employee_id;

  insert into public.audit_logs (
    actor_user_profile_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor.id,
    'reimburse_leave_credits',
    'user_profile',
    v_profile.id,
    jsonb_build_object(
      'employee_id', v_profile.employee_id,
      'reimburse_days', p_reimburse_days,
      'reason', trim(p_reason),
      'old_annual_credit_days', v_current_annual,
      'new_annual_credit_days', v_new_annual,
      'old_used_days', v_used_days,
      'new_used_days', v_new_used
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_reimburse_employee_leave_credits(uuid, numeric, text) to authenticated;

-- 8. Update admin_validate_leave_request to default to 0
create or replace function public.admin_validate_leave_request(
  p_request_id uuid,
  p_paid_days numeric,
  p_unpaid_days numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id uuid;
  v_old_paid numeric;
  v_diff numeric;
  v_new_type text;
begin
  select r.submitted_by_employee_id, coalesce(lrd.paid_days, 0)
  into v_emp_id, v_old_paid
  from public.requests r
  join public.leave_request_details lrd on lrd.request_id = r.id
  where r.id = p_request_id;

  if v_emp_id is null then
    raise exception 'Leave request not found.';
  end if;

  if p_paid_days > 0 and p_unpaid_days > 0 then
    v_new_type := 'With and Without Pay';
  elsif p_paid_days > 0 then
    v_new_type := 'With Pay';
  else
    v_new_type := 'Without Pay';
  end if;

  update public.leave_request_details
  set paid_days = p_paid_days,
      unpaid_days = p_unpaid_days,
      leave_type = v_new_type,
      total_days = (p_paid_days + p_unpaid_days)
  where request_id = p_request_id;

  update public.requests
  set status = 'validated',
      updated_at = now()
  where id = p_request_id;

  v_diff := p_paid_days - v_old_paid;
  if v_diff <> 0 then
    insert into public.leave_balances (employee_id, annual_credit_days, used_days)
    values (v_emp_id, 0, 0)
    on conflict (employee_id) do nothing;

    update public.leave_balances
    set used_days = greatest(0, used_days + v_diff),
        updated_at = now()
    where employee_id = v_emp_id;
  end if;

  return 'Leave request validated successfully.';
end;
$$;

grant execute on function public.admin_validate_leave_request(uuid, numeric, numeric) to authenticated;
grant execute on function public.admin_validate_leave_request(uuid, numeric, numeric) to anon;
grant execute on function public.admin_validate_leave_request(uuid, numeric, numeric) to service_role;

-- 9. Update apply_leave_side_effects to default to 0
create or replace function public.apply_leave_side_effects(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
  v_request_type public.request_types;
  v_leave public.leave_request_details;
  v_current_available numeric;
  v_new_used numeric;
  v_balance_after numeric;
begin
  select * into v_request
  from public.requests
  where id = p_request_id;

  select * into v_request_type
  from public.request_types
  where id = v_request.request_type_id;

  if v_request_type.code <> 'leave' then
    return;
  end if;

  select * into v_leave
  from public.leave_request_details
  where request_id = p_request_id;

  if coalesce(v_leave.paid_days, 0) <= 0 then
    return;
  end if;

  if exists (
    select 1
    from public.leave_transactions
    where request_id = p_request_id
      and transaction_type = 'use_paid'
  ) then
    return;
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_request.submitted_by_employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  select coalesce(annual_credit_days - used_days, 0)
  into v_current_available
  from public.leave_balances
  where employee_id = v_request.submitted_by_employee_id
  for update;

  if v_current_available < v_leave.paid_days then
    raise exception 'Insufficient paid leave credits at approval time.';
  end if;

  update public.leave_balances
  set used_days = used_days + v_leave.paid_days,
      updated_at = now()
  where employee_id = v_request.submitted_by_employee_id
  returning used_days, annual_credit_days - used_days
  into v_new_used, v_balance_after;

  insert into public.leave_transactions (
    employee_id,
    request_id,
    transaction_type,
    days,
    balance_after
  )
  values (
    v_request.submitted_by_employee_id,
    p_request_id,
    'use_paid',
    v_leave.paid_days,
    v_balance_after
  );
end;
$$;

grant execute on function public.apply_leave_side_effects(uuid) to authenticated;

-- 10. Update submit_leave_request to default to 0
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
  v_total_days numeric;
  v_leave_type text;
  v_paid_days numeric;
  v_unpaid_days numeric;
  v_available_days numeric;
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

  v_total_days := (p_end_date - p_start_date) + 1;

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

  if v_paid_days < 0 or v_unpaid_days < 0 then
    raise exception 'Leave days cannot be negative.';
  end if;

  if round((v_paid_days + v_unpaid_days)::numeric, 2) <> round(v_total_days::numeric, 2) then
    raise exception 'Paid and unpaid leave days must equal total leave days.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Your login is not linked to an employee profile.';
  end if;

  insert into public.leave_balances (employee_id, annual_credit_days, used_days)
  values (v_profile.employee_id, 0, 0)
  on conflict (employee_id) do nothing;

  v_available_days := public.get_available_leave_days(v_profile.employee_id);
  if v_paid_days > v_available_days then
    raise exception 'Insufficient paid leave credits. Available paid leave: % day(s).', v_available_days;
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

  insert into public.requests (
    request_type_id,
    submitted_by_employee_id,
    submitted_by_user_id,
    company_id,
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
    total_days,
    paid_days,
    unpaid_days,
    reason
  )
  values (
    v_request_id,
    v_leave_type,
    trim(p_leave_category),
    p_start_date,
    p_end_date,
    v_total_days,
    v_paid_days,
    v_unpaid_days,
    trim(p_reason)
  );

  select *
  into v_route
  from public.approval_level_routes
  where requester_level = v_position.authority_level
    and (department_id = v_assignment.department_id or department_id is null)
  order by
    case when department_id = v_assignment.department_id then 0 else 1 end,
    step_order asc
  limit 1;

  if v_route.approver_level is null then
    insert into public.request_approval_steps (
      request_id,
      step_order,
      required_function_id,
      required_level,
      status,
      skipped_reason
    )
    values (
      v_request_id,
      1,
      v_assignment.function_id,
      v_position.authority_level,
      'admin_fallback',
      'No approval route configured.'
    );

    update public.requests
    set status = 'needs_admin_review'
    where id = v_request_id;
  else
    select *
    into v_approver
    from public.find_request_approver(
      v_assignment.id,
      v_assignment.function_id,
      v_route.approver_level,
      v_profile.employee_id,
      '{}'
    )
    limit 1;

    if v_approver.approver_employee_id is null then
      insert into public.request_approval_steps (
        request_id,
        step_order,
        required_function_id,
        required_level,
        status,
        skipped_reason
      )
      values (
        v_request_id,
        1,
        v_assignment.function_id,
        v_route.approver_level,
        'admin_fallback',
        'No matching approver found.'
      );

      update public.requests
      set status = 'needs_admin_review'
      where id = v_request_id;
    else
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
        1,
        v_assignment.function_id,
        v_approver.resolved_level,
        v_approver.approver_employee_id,
        v_approver.approver_user_profile_id,
        'pending'
      );
    end if;
  end if;

  insert into public.notifications (
    employee_id,
    user_profile_id,
    title,
    message,
    link_type,
    link_id
  )
  values (
    v_profile.employee_id,
    v_profile.id,
    'Leave submitted',
    'Your leave request was submitted.',
    'request',
    v_request_id
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_leave_request(text, text, date, date, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
