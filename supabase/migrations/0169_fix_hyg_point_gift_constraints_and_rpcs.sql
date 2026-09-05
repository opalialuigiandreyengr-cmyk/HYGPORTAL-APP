-- Migration 0169: Fix HYG point gift constraints and safe idempotent gift RPCs
-- Eliminates "there is no unique or exclusion constraint matching the ON CONFLICT specification" errors

-- 1. Create performance indexes for fast account and transaction lookups
create index if not exists idx_user_hyg_point_accounts_auth_user_id
  on public.user_hyg_point_accounts (auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_user_hyg_point_accounts_employee_id
  on public.user_hyg_point_accounts (employee_id)
  where employee_id is not null;

create index if not exists idx_user_hyg_point_tx_auth_source
  on public.user_hyg_point_transactions (auth_user_id, source)
  where auth_user_id is not null;

create index if not exists idx_user_hyg_point_tx_emp_source
  on public.user_hyg_point_transactions (employee_id, source)
  where employee_id is not null;

-- 2. Drop existing functions first (avoids ERROR 42P13: cannot change return type of existing function)
drop function if exists public.ensure_my_launch_hyg_points_gift();
drop function if exists public.ensure_my_profile_completion_hyg_points_gift();
drop function if exists public.claim_my_hyg_points(uuid);
drop function if exists public.claim_my_hyg_points(text);

-- 3. Safe idempotent launch gift RPC
create or replace function public.ensure_my_launch_hyg_points_gift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile public.user_profiles;
  v_account_id uuid;
  v_existing_tx_id uuid;
  v_notification_id uuid;
  v_tx_id uuid;
begin
  if v_auth_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile
  from public.user_profiles
  where auth_user_id = v_auth_id
  limit 1;

  if v_profile.id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'profile_not_found');
  end if;

  -- Check if user already has a launch gift transaction
  select id into v_existing_tx_id
  from public.user_hyg_point_transactions
  where (auth_user_id = v_auth_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id))
    and source = 'launch_phase_1_profile_creation'
  limit 1;

  if v_existing_tx_id is not null then
    return jsonb_build_object('status', 'already_granted', 'transaction_id', v_existing_tx_id);
  end if;

  -- Find or create point account
  select id into v_account_id
  from public.user_hyg_point_accounts
  where auth_user_id = v_auth_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id)
  order by updated_at desc
  limit 1;

  if v_account_id is null then
    insert into public.user_hyg_point_accounts (
      user_profile_id,
      auth_user_id,
      employee_id,
      balance,
      created_at,
      updated_at
    ) values (
      v_profile.id,
      v_auth_id,
      v_profile.employee_id,
      0,
      now(),
      now()
    )
    returning id into v_account_id;
  end if;

  -- Create notification for the launch gift
  insert into public.notifications (
    recipient_user_id,
    recipient_employee_id,
    title,
    body,
    link_type,
    created_at
  ) values (
    v_auth_id,
    v_profile.employee_id,
    'Welcome Gift: 100 HYG Points! 🎉',
    'Thank you for joining HYG Portal. Claim your 100 HYG Points launch gift now!',
    'points_gift',
    now()
  )
  returning id into v_notification_id;

  -- Insert the launch gift transaction (released, waiting for claim)
  insert into public.user_hyg_point_transactions (
    account_id,
    user_profile_id,
    auth_user_id,
    employee_id,
    source,
    points,
    status,
    release_at,
    notification_id,
    note,
    created_at
  ) values (
    v_account_id,
    v_profile.id,
    v_auth_id,
    v_profile.employee_id,
    'launch_phase_1_profile_creation',
    100,
    'released',
    now(),
    v_notification_id,
    'Phase 1 launch appreciation gift for employee profile creation.',
    now()
  )
  returning id into v_tx_id;

  -- Link transaction back to notification if applicable
  update public.notifications
  set link_id = v_tx_id
  where id = v_notification_id;

  return jsonb_build_object('status', 'granted', 'transaction_id', v_tx_id, 'points', 100);
end;
$$;

-- 3. Safe idempotent profile completion gift RPC
create or replace function public.ensure_my_profile_completion_hyg_points_gift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile public.user_profiles;
  v_emp public.employees;
  v_account_id uuid;
  v_existing_tx_id uuid;
  v_notification_id uuid;
  v_tx_id uuid;
begin
  if v_auth_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile
  from public.user_profiles
  where auth_user_id = v_auth_id
  limit 1;

  if v_profile.id is null or v_profile.employee_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'profile_not_linked');
  end if;

  -- Check if already granted
  select id into v_existing_tx_id
  from public.user_hyg_point_transactions
  where (auth_user_id = v_auth_id or employee_id = v_profile.employee_id)
    and source = 'profile_completion_100_percent'
  limit 1;

  if v_existing_tx_id is not null then
    return jsonb_build_object('status', 'already_granted', 'transaction_id', v_existing_tx_id);
  end if;

  -- Check employee profile completeness
  select * into v_emp
  from public.employees
  where id = v_profile.employee_id
  limit 1;

  if v_emp.id is null or coalesce(trim(v_emp.first_name), '') = '' or coalesce(trim(v_emp.last_name), '') = '' then
    return jsonb_build_object('status', 'skipped', 'reason', 'profile_incomplete');
  end if;

  -- Find or create point account
  select id into v_account_id
  from public.user_hyg_point_accounts
  where auth_user_id = v_auth_id or employee_id = v_profile.employee_id
  order by updated_at desc
  limit 1;

  if v_account_id is null then
    insert into public.user_hyg_point_accounts (
      user_profile_id,
      auth_user_id,
      employee_id,
      balance,
      created_at,
      updated_at
    ) values (
      v_profile.id,
      v_auth_id,
      v_profile.employee_id,
      0,
      now(),
      now()
    )
    returning id into v_account_id;
  end if;

  -- Create notification for profile completion gift
  insert into public.notifications (
    recipient_user_id,
    recipient_employee_id,
    title,
    body,
    link_type,
    created_at
  ) values (
    v_auth_id,
    v_profile.employee_id,
    'Profile Completed: 100 HYG Points! 🌟',
    'Your profile is 100% complete! Claim your 100 HYG Points reward now.',
    'points_gift',
    now()
  )
  returning id into v_notification_id;

  -- Insert transaction
  insert into public.user_hyg_point_transactions (
    account_id,
    user_profile_id,
    auth_user_id,
    employee_id,
    source,
    points,
    status,
    release_at,
    notification_id,
    note,
    created_at
  ) values (
    v_account_id,
    v_profile.id,
    v_auth_id,
    v_profile.employee_id,
    'profile_completion_100_percent',
    100,
    'released',
    now(),
    v_notification_id,
    '100% employee profile completion reward.',
    now()
  )
  returning id into v_tx_id;

  update public.notifications
  set link_id = v_tx_id
  where id = v_notification_id;

  return jsonb_build_object('status', 'granted', 'transaction_id', v_tx_id, 'points', 100);
end;
$$;

-- 4. Claim HYG points RPC
create or replace function public.claim_my_hyg_points(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile public.user_profiles;
  v_tx public.user_hyg_point_transactions;
  v_account_id uuid;
  v_new_balance numeric;
begin
  if v_auth_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile
  from public.user_profiles
  where auth_user_id = v_auth_id
  limit 1;

  select * into v_tx
  from public.user_hyg_point_transactions
  where id = p_transaction_id
  for update;

  if v_tx.id is null then
    raise exception 'Reward transaction was not found.';
  end if;

  -- Check ownership
  if v_tx.auth_user_id <> v_auth_id and (v_profile.employee_id is null or v_tx.employee_id <> v_profile.employee_id) then
    raise exception 'You can only claim your own rewards.';
  end if;

  if v_tx.status = 'claimed' then
    return jsonb_build_object('status', 'already_claimed', 'points', v_tx.points);
  end if;

  if v_tx.status <> 'released' then
    raise exception 'This reward is not available for claiming (status: %).', v_tx.status;
  end if;

  -- Ensure account exists
  select id into v_account_id
  from public.user_hyg_point_accounts
  where auth_user_id = v_auth_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id)
  order by updated_at desc
  limit 1;

  if v_account_id is null then
    insert into public.user_hyg_point_accounts (
      user_profile_id,
      auth_user_id,
      employee_id,
      balance,
      created_at,
      updated_at
    ) values (
      v_profile.id,
      v_auth_id,
      v_profile.employee_id,
      coalesce(v_tx.points, 0),
      now(),
      now()
    )
    returning id, balance into v_account_id, v_new_balance;
  else
    update public.user_hyg_point_accounts
    set balance = coalesce(balance, 0) + coalesce(v_tx.points, 0),
        updated_at = now()
    where id = v_account_id
    returning balance into v_new_balance;
  end if;

  -- Mark transaction claimed
  update public.user_hyg_point_transactions
  set status = 'claimed',
      received_at = now(),
      account_id = v_account_id
  where id = v_tx.id;

  -- Update notification if linked
  if v_tx.notification_id is not null then
    update public.notifications
    set read_at = coalesce(read_at, now())
    where id = v_tx.notification_id;
  end if;

  return jsonb_build_object(
    'status', 'claimed',
    'transaction_id', v_tx.id,
    'points', v_tx.points,
    'points_claimed', v_tx.points,
    'balance', v_new_balance,
    'new_balance', v_new_balance,
    'received_at', now()
  );
end;
$$;

-- 5. Grant execute permissions to authenticated users
grant execute on function public.ensure_my_launch_hyg_points_gift() to authenticated;
grant execute on function public.ensure_my_profile_completion_hyg_points_gift() to authenticated;
grant execute on function public.claim_my_hyg_points(uuid) to authenticated;

