-- Migration 0188: Fix offset balance and leave credits transaction history for admin adjustments
-- Ensures manual deductions made by admin appear correctly as deductions (negative amount, 'use' category, 'Admin deduction' subtitle)
-- rather than as 'Offset Refunded'. Also provides database RPCs for admin offset and leave adjustments with audit logging.

-- 1. Redefine public.get_my_offset_history()
create or replace function public.get_my_offset_history()
returns table (
  id text,
  transaction_type text,
  category text,
  title text,
  subtitle text,
  hours numeric,
  balance_after numeric,
  created_at timestamptz,
  request_id uuid,
  request_status text,
  reason text,
  date_from date,
  date_to date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select employee_id into v_employee_id
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_employee_id is null then
    return;
  end if;

  return query
  select
    ot.id::text,
    ot.transaction_type,
    case
      -- Offset Deductions: use, deduct, deduction, or any negative hours
      when ot.transaction_type in ('use', 'deduct', 'deduction') or coalesce(ot.hours, 0) < 0 then 'use'
      -- Earned Offset from Approved Request
      when ot.transaction_type in ('earn', 'credit') then 'earn'
      -- Request Refunds: adjustments/refunds tied to a request
      when ot.request_id is not null and ot.transaction_type in ('adjustment', 'refund') then 'refund'
      -- Admin additions
      when ot.request_id is null and (ot.transaction_type in ('earn', 'add', 'credit') or coalesce(ot.hours, 0) > 0) then 'earn'
      else 'adjustment'
    end as category,
    case
      when ot.transaction_type in ('use', 'deduct', 'deduction') or coalesce(ot.hours, 0) < 0 then 'Offset Deducted'
      when ot.transaction_type in ('earn', 'credit') then 'Offset Earned'
      when ot.request_id is not null and ot.transaction_type in ('adjustment', 'refund') then 'Offset Refunded'
      when ot.request_id is null and (ot.transaction_type in ('earn', 'add', 'credit') or coalesce(ot.hours, 0) > 0) then 'Offset Added'
      else 'Balance Adjustment'
    end as title,
    coalesce(
      case
        when trd.transaction_type is not null and trd.transaction_type <> '' then trd.transaction_type
        when ot.transaction_type = 'use' then 'Use Offset Request'
        when ot.transaction_type in ('earn', 'credit') then 'ESARF Offset Credit'
        when ot.request_id is not null and ot.transaction_type in ('adjustment', 'refund') then 'Credited back (Rejected request)'
        when ot.request_id is null and (ot.transaction_type in ('deduct', 'deduction') or coalesce(ot.hours, 0) < 0) then 'Admin deduction'
        when ot.request_id is null and (ot.transaction_type in ('earn', 'add', 'credit') or coalesce(ot.hours, 0) > 0) then 'Admin credit adjustment'
        else 'Offset Adjustment'
      end,
      'Offset Transaction'
    ) as subtitle,
    case
      when ot.transaction_type in ('use', 'deduct', 'deduction') or coalesce(ot.hours, 0) < 0 then -abs(coalesce(ot.hours, 0))
      else abs(coalesce(ot.hours, 0))
    end as hours,
    ot.balance_after,
    ot.created_at,
    ot.request_id,
    r.status as request_status,
    coalesce(trd.reason, r.rejected_reason) as reason,
    trd.date_from,
    trd.date_to
  from public.offset_transactions ot
  left join public.requests r on r.id = ot.request_id
  left join public.time_request_details trd on trd.request_id = ot.request_id
  where ot.employee_id = v_employee_id
  order by ot.created_at desc, ot.id desc;
end;
$$;

grant execute on function public.get_my_offset_history() to authenticated;
grant execute on function public.get_my_offset_history() to anon;
grant execute on function public.get_my_offset_history() to service_role;

-- 2. Redefine public.get_my_leave_history()
create or replace function public.get_my_leave_history()
returns table (
  id text,
  transaction_type text,
  category text,
  title text,
  subtitle text,
  days numeric,
  balance_after numeric,
  created_at timestamptz,
  request_id uuid,
  request_status text,
  reason text,
  start_date date,
  end_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_profile_id uuid;
  v_annual_credit numeric;
  v_balance_updated timestamptz;
begin
  if auth.uid() is null then
    return;
  end if;

  select employee_id, id into v_employee_id, v_profile_id
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_employee_id is null then
    return;
  end if;

  select coalesce(annual_credit_days, 0), updated_at
  into v_annual_credit, v_balance_updated
  from public.leave_balances
  where employee_id = v_employee_id;

  return query
  with tx_items as (
    -- 1. Recorded leave transactions (use_paid for approved leaves, or admin deductions/reimbursements)
    select
      lt.id::text,
      lt.transaction_type,
      case
        when lt.transaction_type in ('use_paid', 'use', 'deduct', 'deduction') or coalesce(lt.days, 0) < 0 then 'use'
        when lt.transaction_type in ('grant', 'credit', 'annual_credit', 'set_credits') then 'grant'
        when lt.transaction_type in ('reimburse', 'refund') then 'refund'
        else 'adjustment'
      end as category,
      case
        when lrd.leave_category is not null and lrd.leave_category <> '' then lrd.leave_category || ' (Paid)'
        when lt.transaction_type in ('deduct', 'deduction') or (lt.request_id is null and coalesce(lt.days, 0) < 0) then 'Leave Deducted'
        when lt.transaction_type = 'use_paid' then 'Leave Deducted'
        when lt.transaction_type in ('grant', 'credit', 'annual_credit', 'set_credits') then 'Annual Leave Credits Granted'
        when lt.transaction_type in ('reimburse', 'refund') then 'Credit Reimbursed'
        else 'Credit Adjustment'
      end as title,
      coalesce(
        case
          when lt.request_id is null and (lt.transaction_type in ('deduct', 'deduction') or coalesce(lt.days, 0) < 0) then 'Admin deduction'
          when lt.request_id is null and lt.transaction_type in ('reimburse', 'refund') then 'Admin reimbursement'
          when lt.request_id is null and lt.transaction_type in ('grant', 'credit', 'set_credits') then 'Admin credit allocation'
          when lt.transaction_type = 'use_paid' then 'Approved paid leave'
          when lt.transaction_type in ('grant', 'credit', 'annual_credit') then 'Annual credit allocation'
          when lt.transaction_type = 'reimburse' then 'Credits reimbursed'
          else 'Balance adjustment'
        end,
        'Leave Transaction'
      ) as subtitle,
      case
        when lt.transaction_type in ('use_paid', 'use', 'deduct', 'deduction') or coalesce(lt.days, 0) < 0 then -abs(coalesce(lt.days, 0))
        else abs(coalesce(lt.days, 0))
      end as days,
      lt.balance_after,
      coalesce(lt.created_at, r.submitted_at, now()) as created_at,
      lt.request_id,
      coalesce(r.status, 'approved') as request_status,
      coalesce(lrd.reason, r.rejected_reason) as reason,
      lrd.start_date,
      lrd.end_date
    from public.leave_transactions lt
    left join public.requests r on r.id = lt.request_id
    left join public.leave_request_details lrd on lrd.request_id = lt.request_id
    where lt.employee_id = v_employee_id

    union all

    -- 2. Audit log entries for leave credits (set, reimburse, deduct) that are not already in leave_transactions
    select
      al.id::text,
      al.action as transaction_type,
      case
        when al.action = 'set_leave_credits' then 'grant'
        when al.action = 'reimburse_leave_credits' then 'refund'
        when al.action = 'deduct_leave_credits' then 'use'
        else 'adjustment'
      end as category,
      case
        when al.action = 'set_leave_credits' then 'Annual Leave Credit Set'
        when al.action = 'reimburse_leave_credits' then 'Credit Reimbursed'
        when al.action = 'deduct_leave_credits' then 'Leave Deducted'
        else 'Credit Adjustment'
      end as title,
      coalesce(al.metadata->>'reason', 'Admin deduction') as subtitle,
      case
        when al.action = 'set_leave_credits' then coalesce((al.metadata->>'annual_credit_days')::numeric, 0)
        when al.action = 'reimburse_leave_credits' then coalesce((al.metadata->>'reimburse_days')::numeric, 0)
        when al.action = 'deduct_leave_credits' then -abs(coalesce((al.metadata->>'deduct_days')::numeric, 0))
        else 0
      end as days,
      null::numeric as balance_after,
      al.created_at,
      null::uuid as request_id,
      'approved' as request_status,
      al.metadata->>'reason' as reason,
      null::date as start_date,
      null::date as end_date
    from public.audit_logs al
    where (
      (al.entity_type = 'user_profile' and al.entity_id = v_profile_id)
      or (al.metadata->>'employee_id' = v_employee_id::text)
    )
    and al.action in ('set_leave_credits', 'reimburse_leave_credits', 'deduct_leave_credits')
    and not exists (
      select 1 from public.leave_transactions lt2
      where lt2.employee_id = v_employee_id
        and lt2.request_id is null
        and abs(extract(epoch from (lt2.created_at - al.created_at))) < 10
    )

    union all

    -- 3. Initial Annual Leave Credit Allocation from leave_balances if not already represented
    select
      ('initial_grant_' || v_employee_id::text) as id,
      'annual_credit' as transaction_type,
      'grant' as category,
      'Annual Leave Credits Granted' as title,
      'Annual leave allocation' as subtitle,
      v_annual_credit as days,
      v_annual_credit as balance_after,
      coalesce(v_balance_updated, now()) as created_at,
      null::uuid as request_id,
      'approved' as request_status,
      'Annual leave credit entitlement' as reason,
      null::date as start_date,
      null::date as end_date
    where v_annual_credit > 0
      and not exists (
        select 1 from public.audit_logs al2
        where (
          (al2.entity_type = 'user_profile' and al2.entity_id = v_profile_id)
          or (al2.metadata->>'employee_id' = v_employee_id::text)
        )
        and al2.action = 'set_leave_credits'
      )
      and not exists (
        select 1 from public.leave_transactions lt3
        where lt3.employee_id = v_employee_id
          and lt3.transaction_type in ('grant', 'set_credits', 'annual_credit')
      )
  )
  select *
  from tx_items
  order by created_at desc;
end;
$$;

grant execute on function public.get_my_leave_history() to authenticated;
grant execute on function public.get_my_leave_history() to anon;
grant execute on function public.get_my_leave_history() to service_role;

-- 3. Admin Offset RPCs
create or replace function public.admin_deduct_employee_offset_balance(
  p_user_profile_id uuid,
  p_deduct_hours numeric,
  p_reason text default 'Admin deduction'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
  v_profile public.user_profiles;
  v_current_bal numeric;
  v_new_bal numeric;
begin
  select * into v_actor
  from public.user_profiles
  where auth_user_id = auth.uid()
    and app_role in ('admin', 'super_admin')
    and is_active = true;

  if v_actor.id is null then
    raise exception 'Admin access is required.';
  end if;

  if p_deduct_hours is null or p_deduct_hours <= 0 then
    raise exception 'Deduction hours must be greater than zero.';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Target employee not found.';
  end if;

  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_profile.employee_id, 0, now())
  on conflict (employee_id) do nothing;

  select coalesce(balance_hours, 0)
  into v_current_bal
  from public.offset_balances
  where employee_id = v_profile.employee_id
  for update;

  v_new_bal := greatest(0, round(v_current_bal - p_deduct_hours, 2));

  update public.offset_balances
  set balance_hours = v_new_bal,
      updated_at = now()
  where employee_id = v_profile.employee_id;

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
    null,
    'deduct',
    -p_deduct_hours,
    v_new_bal,
    now()
  );

  insert into public.audit_logs (
    actor_user_profile_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor.id,
    'deduct_offset_balance',
    'user_profile',
    v_profile.id,
    jsonb_build_object(
      'employee_id', v_profile.employee_id,
      'deduct_hours', p_deduct_hours,
      'old_balance', v_current_bal,
      'new_balance', v_new_bal,
      'reason', coalesce(trim(p_reason), 'Admin deduction')
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_deduct_employee_offset_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_deduct_employee_offset_balance(uuid, numeric, text) to service_role;

create or replace function public.admin_add_employee_offset_balance(
  p_user_profile_id uuid,
  p_add_hours numeric,
  p_reason text default 'Admin addition'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
  v_profile public.user_profiles;
  v_current_bal numeric;
  v_new_bal numeric;
begin
  select * into v_actor
  from public.user_profiles
  where auth_user_id = auth.uid()
    and app_role in ('admin', 'super_admin')
    and is_active = true;

  if v_actor.id is null then
    raise exception 'Admin access is required.';
  end if;

  if p_add_hours is null or p_add_hours <= 0 then
    raise exception 'Added hours must be greater than zero.';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Target employee not found.';
  end if;

  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_profile.employee_id, 0, now())
  on conflict (employee_id) do nothing;

  select coalesce(balance_hours, 0)
  into v_current_bal
  from public.offset_balances
  where employee_id = v_profile.employee_id
  for update;

  v_new_bal := round(v_current_bal + p_add_hours, 2);

  update public.offset_balances
  set balance_hours = v_new_bal,
      updated_at = now()
  where employee_id = v_profile.employee_id;

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
    null,
    'earn',
    p_add_hours,
    v_new_bal,
    now()
  );

  insert into public.audit_logs (
    actor_user_profile_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor.id,
    'add_offset_balance',
    'user_profile',
    v_profile.id,
    jsonb_build_object(
      'employee_id', v_profile.employee_id,
      'add_hours', p_add_hours,
      'old_balance', v_current_bal,
      'new_balance', v_new_bal,
      'reason', coalesce(trim(p_reason), 'Admin addition')
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_add_employee_offset_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_add_employee_offset_balance(uuid, numeric, text) to service_role;

create or replace function public.admin_set_employee_offset_balance(
  p_user_profile_id uuid,
  p_balance_hours numeric,
  p_reason text default 'Admin set balance'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
  v_profile public.user_profiles;
  v_current_bal numeric;
  v_diff numeric;
begin
  select * into v_actor
  from public.user_profiles
  where auth_user_id = auth.uid()
    and app_role in ('admin', 'super_admin')
    and is_active = true;

  if v_actor.id is null then
    raise exception 'Admin access is required.';
  end if;

  if p_balance_hours is null or p_balance_hours < 0 then
    raise exception 'Offset balance cannot be negative.';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Target employee not found.';
  end if;

  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_profile.employee_id, 0, now())
  on conflict (employee_id) do nothing;

  select coalesce(balance_hours, 0)
  into v_current_bal
  from public.offset_balances
  where employee_id = v_profile.employee_id
  for update;

  v_diff := round(p_balance_hours - v_current_bal, 2);

  update public.offset_balances
  set balance_hours = round(p_balance_hours, 2),
      updated_at = now()
  where employee_id = v_profile.employee_id;

  if v_diff <> 0 then
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
      null,
      case when v_diff < 0 then 'deduct' else 'earn' end,
      v_diff,
      round(p_balance_hours, 2),
      now()
    );
  end if;

  insert into public.audit_logs (
    actor_user_profile_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_actor.id,
    'set_offset_balance',
    'user_profile',
    v_profile.id,
    jsonb_build_object(
      'employee_id', v_profile.employee_id,
      'old_balance', v_current_bal,
      'new_balance', round(p_balance_hours, 2),
      'diff_hours', v_diff,
      'reason', coalesce(trim(p_reason), 'Admin set balance')
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_set_employee_offset_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_set_employee_offset_balance(uuid, numeric, text) to service_role;

-- 4. Update Admin Leave RPCs to support defaults and write to leave_transactions
create or replace function public.admin_deduct_employee_leave_credits(
  p_user_profile_id uuid,
  p_deduct_days numeric,
  p_reason text default 'Admin deduction'
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

  insert into public.leave_transactions (
    employee_id,
    request_id,
    transaction_type,
    days,
    balance_after,
    created_at
  )
  values (
    v_profile.employee_id,
    null,
    'deduct',
    -p_deduct_days,
    v_current_annual - v_new_used,
    now()
  );

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
      'reason', coalesce(trim(p_reason), 'Admin deduction'),
      'annual_credit_days', v_current_annual,
      'old_used_days', v_used_days,
      'new_used_days', v_new_used
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_deduct_employee_leave_credits(uuid, numeric, text) to authenticated;
grant execute on function public.admin_deduct_employee_leave_credits(uuid, numeric, text) to service_role;

create or replace function public.admin_reimburse_employee_leave_credits(
  p_user_profile_id uuid,
  p_reimburse_days numeric,
  p_reason text default 'Admin reimbursement'
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

  insert into public.leave_transactions (
    employee_id,
    request_id,
    transaction_type,
    days,
    balance_after,
    created_at
  )
  values (
    v_profile.employee_id,
    null,
    'reimburse',
    p_reimburse_days,
    v_new_annual - v_new_used,
    now()
  );

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
      'reason', coalesce(trim(p_reason), 'Admin reimbursement'),
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
grant execute on function public.admin_reimburse_employee_leave_credits(uuid, numeric, text) to service_role;

create or replace function public.admin_set_employee_leave_credits(
  p_user_profile_id uuid,
  p_annual_credit_days numeric,
  p_reason text default 'Admin set credits'
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
    raise exception 'Annual leave credits cannot be negative.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where id = p_user_profile_id;

  if v_profile.id is null then
    raise exception 'User was not found.';
  end if;

  if v_profile.employee_id is null then
    raise exception 'Leave credits can only be configured for linked employees.';
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

  insert into public.leave_transactions (
    employee_id,
    request_id,
    transaction_type,
    days,
    balance_after,
    created_at
  )
  values (
    v_profile.employee_id,
    null,
    'set_credits',
    round(p_annual_credit_days, 2),
    round(p_annual_credit_days, 2) - coalesce(v_used_days, 0),
    now()
  );

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
      'annual_credit_days', round(p_annual_credit_days, 2),
      'reason', coalesce(trim(p_reason), 'Admin set credits')
    )
  );

  return v_profile.id;
end;
$$;

grant execute on function public.admin_set_employee_leave_credits(uuid, numeric, text) to authenticated;
grant execute on function public.admin_set_employee_leave_credits(uuid, numeric, text) to service_role;

-- 5. Safe insertion of missing offset_transactions rows for approved offset requests
-- IMPORTANT: This ONLY inserts records into public.offset_transactions and strictly NEVER modifies public.offset_balances.
insert into public.offset_transactions (
  employee_id,
  request_id,
  transaction_type,
  hours,
  balance_after,
  created_at
)
select
  r.submitted_by_employee_id,
  r.id,
  'earn',
  abs(coalesce(trd.total_hours, 0)),
  ob.balance_hours,
  coalesce(r.updated_at, r.submitted_at, now())
from public.requests r
join public.time_request_details trd on trd.request_id = r.id
left join public.request_types rt on rt.id = r.request_type_id
left join public.offset_balances ob on ob.employee_id = r.submitted_by_employee_id
where r.status = 'approved'
  and (
    coalesce(rt.code, '') = 'offset_earn'
    or coalesce(rt.affects_offset_balance, '') = 'earn'
    or lower(coalesce(trd.transaction_type, '')) like '%offset%'
    or lower(coalesce(trd.reason, '')) like '%(offset)%'
  )
  and coalesce(rt.code, '') <> 'use_offset'
  and coalesce(rt.affects_offset_balance, '') <> 'use'
  and lower(coalesce(trd.transaction_type, '')) not like '%use%offset%'
  and lower(coalesce(trd.reason, '')) not like '%(use offset)%'
  and coalesce(trd.total_hours, 0) > 0
  and not exists (
    select 1
    from public.offset_transactions ot
    where ot.request_id = r.id
      and ot.transaction_type in ('earn', 'credit')
  );

notify pgrst, 'reload schema';
