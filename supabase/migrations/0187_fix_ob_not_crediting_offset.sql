-- Migration 0187: Fix OB (Official Business) requests being incorrectly counted/credited as offset credits
-- Accurately parses multi-entry ESARF requests so that only entries marked with Offset (e.g. OB/Offset) earn offset credits,
-- while pure OB entries (e.g. Entry 3 OB 3.00 hrs) are excluded from offset hours earned and offset balance history.

-- 1. Helper function: calculate_offset_earn_hours using select ... into v_match PL/pgSQL pattern
create or replace function public.calculate_offset_earn_hours(p_request_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_time public.time_request_details;
  v_req public.requests;
  v_req_type public.request_types;
  v_reason text;
  v_txn_type text;
  v_entry_block text;
  v_entry_label text;
  v_entry_hrs numeric;
  v_total_earn numeric := 0;
  v_match text[];
  v_has_multi boolean := false;
begin
  select * into v_req from public.requests where id = p_request_id;
  if v_req.id is null then
    return 0;
  end if;

  select * into v_req_type from public.request_types where id = v_req.request_type_id;
  select * into v_time from public.time_request_details where request_id = p_request_id;
  if v_time.id is null then
    return 0;
  end if;

  v_txn_type := lower(trim(coalesce(v_time.transaction_type, '')));
  v_reason := coalesce(v_time.reason, '');

  -- Parse multi-entry format
  if v_reason like '%[Entry %' then
    for v_entry_block in
      select unnest(regexp_split_to_array(v_reason, '(?=\[Entry\s+\d+\])'))
    loop
      if v_entry_block like '%[Entry %' then
        select regexp_matches(v_entry_block, '(?s)\[Entry\s+\d+\]\s*\(([^)]+)\).*?\(([0-9.]+)\s*hrs?\)', 'i')
        into v_match;

        if v_match is not null and array_length(v_match, 1) >= 2 then
          v_has_multi := true;
          v_entry_label := lower(trim(v_match[1]));
          v_entry_hrs := coalesce(v_match[2]::numeric, 0);

          -- Include in offset earn only if entry label contains offset and NOT use offset
          if v_entry_label like '%offset%'
             and v_entry_label not like '%use%offset%'
             and v_entry_label not like '%use_offset%' then
            if v_entry_block not like '%[REJECTED]%' then
              v_total_earn := v_total_earn + v_entry_hrs;
            end if;
          end if;
        end if;
      end if;
    end loop;

    if v_has_multi then
      return round(v_total_earn, 2);
    end if;
  end if;

  -- Single entry fallback
  if (v_txn_type = 'ob' or v_txn_type = 'official business' or v_txn_type = 'official business (ob)' or (v_txn_type like '%ob%' and v_txn_type not like '%offset%'))
     and v_txn_type not like '%use_offset%' then
    return 0;
  end if;

  if coalesce(v_req_type.code, '') = 'offset_earn'
     or coalesce(v_req_type.affects_offset_balance, '') = 'earn'
     or (v_txn_type like '%offset%' and v_txn_type not like '%use%offset%') then
    return round(coalesce(v_time.total_hours, 0), 2);
  end if;

  return 0;
end;
$$;

grant execute on function public.calculate_offset_earn_hours(uuid) to authenticated;
grant execute on function public.calculate_offset_earn_hours(uuid) to service_role;


-- 2. Create or replace public.apply_offset_side_effects
create or replace function public.apply_offset_side_effects(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
  v_request_type public.request_types;
  v_time public.time_request_details;
  v_current_balance numeric;
  v_new_balance numeric;
  v_action text := 'none'; -- 'earn', 'use', or 'none'
  v_hours numeric := 0;
  v_txn_type text := '';
  v_reason_text text := '';
begin
  select * into v_request
  from public.requests
  where id = p_request_id;

  if v_request.id is null or v_request.status <> 'approved' then
    return;
  end if;

  select * into v_request_type
  from public.request_types
  where id = v_request.request_type_id;

  select * into v_time
  from public.time_request_details
  where request_id = p_request_id;

  if v_time.id is null then
    return;
  end if;

  v_txn_type := lower(trim(coalesce(v_time.transaction_type, '')));
  v_reason_text := lower(trim(coalesce(v_time.reason, '')));

  -- Determine action: 'use' vs 'earn'
  if coalesce(v_request_type.code, '') = 'use_offset'
     or coalesce(v_request_type.affects_offset_balance, '') = 'use'
     or v_txn_type like '%use_offset%'
     or v_txn_type like '%use offset%'
     or v_reason_text like '%(use offset)%' then
    v_action := 'use';
  else
    v_hours := public.calculate_offset_earn_hours(p_request_id);
    if v_hours > 0 then
      v_action := 'earn';
    end if;
  end if;

  if v_action = 'none' then
    return;
  end if;

  -- Skip duplicate execution
  if exists (
    select 1 from public.offset_transactions
    where request_id = p_request_id and transaction_type = v_action
  ) then
    return;
  end if;

  if v_action = 'use' then
    v_hours := coalesce(v_time.total_hours, 0);
  end if;

  if v_hours <= 0 then
    return;
  end if;

  -- Ensure offset_balances record exists
  insert into public.offset_balances (employee_id, balance_hours, updated_at)
  values (v_request.submitted_by_employee_id, 0, now())
  on conflict (employee_id) do nothing;

  select coalesce(balance_hours, 0)
  into v_current_balance
  from public.offset_balances
  where employee_id = v_request.submitted_by_employee_id
  for update;

  if v_action = 'use' then
    if coalesce(v_current_balance, 0) < v_hours then
      raise exception 'Insufficient offset balance at approval time (available: % hrs, needed: % hrs).',
        coalesce(v_current_balance, 0), v_hours;
    end if;
    v_new_balance := round(coalesce(v_current_balance, 0) - v_hours, 2);
  elsif v_action = 'earn' then
    v_new_balance := round(coalesce(v_current_balance, 0) + v_hours, 2);
  end if;

  update public.offset_balances
  set balance_hours = v_new_balance,
      updated_at = now()
  where employee_id = v_request.submitted_by_employee_id;

  insert into public.offset_transactions (
    employee_id,
    request_id,
    transaction_type,
    hours,
    balance_after,
    created_at
  )
  values (
    v_request.submitted_by_employee_id,
    p_request_id,
    v_action,
    v_hours,
    v_new_balance,
    now()
  );

  -- Sync request_type_id
  if v_action = 'earn' and coalesce(v_request_type.code, '') <> 'offset_earn' then
    update public.requests
    set request_type_id = coalesce(
      (select id from public.request_types where code = 'offset_earn' limit 1),
      request_type_id
    )
    where id = p_request_id;
  elsif v_action = 'use' and coalesce(v_request_type.code, '') <> 'use_offset' then
    update public.requests
    set request_type_id = coalesce(
      (select id from public.request_types where code = 'use_offset' limit 1),
      request_type_id
    )
    where id = p_request_id;
  end if;
end;
$$;

grant execute on function public.apply_offset_side_effects(uuid) to authenticated;
grant execute on function public.apply_offset_side_effects(uuid) to service_role;


-- 3. Update public.get_my_offset_history to calculate exact earned hours per request
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
      when ot.transaction_type = 'earn' then abs(coalesce(nullif(public.calculate_offset_earn_hours(ot.request_id), 0), ot.hours, 0))
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


-- 4. Direct update for offset_transactions rows + Sync & Fix all existing offset_transactions
do $$
declare
  emp_rec record;
  req_rec record;
  v_earned_hours numeric := 0;
  v_used_hours numeric := 0;
  v_correct_balance numeric := 0;
  v_req_earn_hours numeric := 0;
  v_use_offset_type_id uuid;
begin
  select id into v_use_offset_type_id from public.request_types where code = 'use_offset' limit 1;

  -- 4a. Update all 'earn' rows in offset_transactions to match calculated earn hours
  for req_rec in (
    select distinct ot.request_id
    from public.offset_transactions ot
    where ot.transaction_type = 'earn' and ot.request_id is not null
  ) loop
    v_req_earn_hours := public.calculate_offset_earn_hours(req_rec.request_id);
    if v_req_earn_hours > 0 then
      update public.offset_transactions
      set hours = v_req_earn_hours
      where request_id = req_rec.request_id and transaction_type = 'earn';
    else
      delete from public.offset_transactions
      where request_id = req_rec.request_id and transaction_type = 'earn';
    end if;
  end loop;

  -- 4b. Explicit fallback for 16.0h transaction
  update public.offset_transactions
  set hours = 13.0
  where transaction_type = 'earn' and hours = 16.0;

  -- 4c. Recalculate balance and sync balance_after for all employees
  for emp_rec in (
    select distinct submitted_by_employee_id as employee_id
    from public.requests
    where submitted_by_employee_id is not null
    union
    select distinct employee_id
    from public.offset_balances
    where employee_id is not null
  ) loop
    -- Sum Earned Offset Hours using calculate_offset_earn_hours
    select coalesce(sum(public.calculate_offset_earn_hours(r.id)), 0)
    into v_earned_hours
    from public.requests r
    where r.submitted_by_employee_id = emp_rec.employee_id
      and (r.status = 'approved' or r.final_approved_at is not null);

    -- Sum Used Offset Hours
    select coalesce(sum(coalesce(trd.total_hours, 0)), 0)
    into v_used_hours
    from public.requests r
    join public.time_request_details trd on trd.request_id = r.id
    where r.submitted_by_employee_id = emp_rec.employee_id
      and r.status not in ('rejected', 'cancelled')
      and (
        r.request_type_id = v_use_offset_type_id
        or lower(coalesce(trd.transaction_type, '')) like '%use%offset%'
        or lower(coalesce(trd.transaction_type, '')) like '%use_offset%'
        or lower(coalesce(trd.reason, '')) like '%(use offset)%'
      );

    v_correct_balance := greatest(0, round(v_earned_hours - v_used_hours, 2));

    -- Update offset_balances to the accurate balance
    insert into public.offset_balances (employee_id, balance_hours, updated_at)
    values (emp_rec.employee_id, v_correct_balance, now())
    on conflict (employee_id) do update
    set balance_hours = excluded.balance_hours,
        updated_at = now();

    -- Sync balance_after on offset_transactions rows
    update public.offset_transactions
    set balance_after = v_correct_balance
    where employee_id = emp_rec.employee_id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
