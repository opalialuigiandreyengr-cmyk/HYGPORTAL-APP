-- Migration 0186: Add balance history RPCs and ensure RLS policies for offset and leave transactions

-- 1. Ensure created_at exists on public.leave_transactions
alter table if exists public.leave_transactions
  add column if not exists created_at timestamptz default now();

-- 2. Ensure RLS policies on public.offset_transactions and public.leave_transactions
alter table if exists public.offset_transactions enable row level security;

drop policy if exists "Users can view own offset transactions" on public.offset_transactions;
create policy "Users can view own offset transactions"
  on public.offset_transactions
  for select
  using (
    employee_id in (
      select employee_id from public.user_profiles where auth_user_id = auth.uid()
    )
  );

alter table if exists public.leave_transactions enable row level security;

drop policy if exists "Users can view own leave transactions" on public.leave_transactions;
create policy "Users can view own leave transactions"
  on public.leave_transactions
  for select
  using (
    employee_id in (
      select employee_id from public.user_profiles where auth_user_id = auth.uid()
    )
  );

-- 3. RPC function: public.get_my_offset_history
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
      when ot.transaction_type = 'use' then 'use'
      when ot.transaction_type = 'earn' then 'earn'
      when ot.transaction_type = 'adjustment' then 'refund'
      else 'adjustment'
    end as category,
    case
      when ot.transaction_type = 'use' then 'Offset Deducted'
      when ot.transaction_type = 'earn' then 'Offset Earned'
      when ot.transaction_type = 'adjustment' then 'Offset Refunded'
      else 'Balance Adjustment'
    end as title,
    coalesce(
      case
        when trd.transaction_type is not null and trd.transaction_type <> '' then trd.transaction_type
        when ot.transaction_type = 'use' then 'Use Offset Request'
        when ot.transaction_type = 'earn' then 'ESARF Offset Credit'
        when ot.transaction_type = 'adjustment' then 'Credited back (Rejected request)'
        else 'Offset Adjustment'
      end,
      'Offset Transaction'
    ) as subtitle,
    case
      when ot.transaction_type = 'use' then -abs(coalesce(ot.hours, 0))
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

-- 4. RPC function: public.get_my_leave_history
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
    -- 1. Recorded leave transactions (e.g. use_paid for approved leaves)
    select
      lt.id::text,
      lt.transaction_type,
      case
        when lt.transaction_type = 'use_paid' then 'use'
        when lt.transaction_type in ('grant', 'credit', 'annual_credit') then 'grant'
        when lt.transaction_type = 'reimburse' then 'refund'
        else 'adjustment'
      end as category,
      case
        when lrd.leave_category is not null and lrd.leave_category <> '' then lrd.leave_category || ' (Paid)'
        when lt.transaction_type = 'use_paid' then 'Leave Deducted'
        when lt.transaction_type in ('grant', 'credit') then 'Leave Credit Grant'
        when lt.transaction_type = 'reimburse' then 'Credit Reimbursement'
        else 'Credit Adjustment'
      end as title,
      coalesce(
        case
          when lt.transaction_type = 'use_paid' then 'Approved paid leave'
          when lt.transaction_type in ('grant', 'credit') then 'Annual credit allocation'
          when lt.transaction_type = 'reimburse' then 'Credits reimbursed'
          else 'Balance adjustment'
        end,
        'Leave Transaction'
      ) as subtitle,
      case
        when lt.transaction_type = 'use_paid' then -abs(coalesce(lt.days, 0))
        else abs(coalesce(lt.days, 0))
      end as days,
      lt.balance_after,
      coalesce(lt.created_at, r.submitted_at, now()) as created_at,
      lt.request_id,
      r.status as request_status,
      coalesce(lrd.reason, r.rejected_reason) as reason,
      lrd.start_date,
      lrd.end_date
    from public.leave_transactions lt
    left join public.requests r on r.id = lt.request_id
    left join public.leave_request_details lrd on lrd.request_id = lt.request_id
    where lt.employee_id = v_employee_id

    union all

    -- 2. Audit log entries for leave credits (set, reimburse, deduct)
    select
      al.id::text,
      al.action as transaction_type,
      case
        when al.action = 'set_leave_credits' then 'grant'
        when al.action = 'reimburse_leave_credits' then 'refund'
        when al.action = 'deduct_leave_credits' then 'adjustment'
        else 'adjustment'
      end as category,
      case
        when al.action = 'set_leave_credits' then 'Annual Leave Credit Set'
        when al.action = 'reimburse_leave_credits' then 'Credit Reimbursed'
        when al.action = 'deduct_leave_credits' then 'Credit Deducted'
        else 'Credit Adjustment'
      end as title,
      coalesce(al.metadata->>'reason', 'Admin balance adjustment') as subtitle,
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

    union all

    -- 3. Initial Annual Leave Credit Allocation from leave_balances if not already represented in audit logs
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
  )
  select *
  from tx_items
  order by created_at desc;
end;
$$;

grant execute on function public.get_my_leave_history() to authenticated;
grant execute on function public.get_my_leave_history() to anon;
grant execute on function public.get_my_leave_history() to service_role;

notify pgrst, 'reload schema';
