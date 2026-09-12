-- Migration 0172: Fix registration points trigger, safe idempotence, and notification schema

-- 1. Ensure user_hyg_point_accounts and user_hyg_point_transactions have performance indexes
create index if not exists idx_user_hyg_point_accounts_auth_user_id
  on public.user_hyg_point_accounts (auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_user_hyg_point_accounts_employee_id
  on public.user_hyg_point_accounts (employee_id)
  where employee_id is not null;

create index if not exists idx_user_hyg_point_tx_profile_source
  on public.user_hyg_point_transactions (user_profile_id, source)
  where user_profile_id is not null;

create index if not exists idx_user_hyg_point_tx_auth_source
  on public.user_hyg_point_transactions (auth_user_id, source)
  where auth_user_id is not null;

create index if not exists idx_user_hyg_point_tx_emp_source
  on public.user_hyg_point_transactions (employee_id, source)
  where employee_id is not null;

-- 2. Restore/create notification helper for unclaimed points gifts
-- Uses the correct public.notifications columns: (employee_id, user_profile_id, title, message, link_type, link_id, is_read)
create or replace function public.restore_unclaimed_hyg_points_notification(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction public.user_hyg_point_transactions;
  v_existing_notification_id uuid;
  v_notification_id uuid;
  v_title text;
  v_message text;
begin
  select *
  into v_transaction
  from public.user_hyg_point_transactions t
  where t.id = p_transaction_id
    and t.status = 'released'
    and t.source in ('launch_phase_1_profile_creation', 'profile_completion_100_percent');

  if v_transaction.id is null then
    return null;
  end if;

  select n.id
  into v_existing_notification_id
  from public.notifications n
  where n.id = v_transaction.notification_id
     or (
       n.link_type = 'hyg_points_claim'
       and n.link_id = v_transaction.id
     )
  order by n.created_at desc
  limit 1;

  if v_existing_notification_id is not null then
    update public.user_hyg_point_transactions
    set notification_id = v_existing_notification_id,
        notification_deleted_at = null
    where id = v_transaction.id;

    return v_existing_notification_id;
  end if;

  v_title := case
    when v_transaction.source = 'profile_completion_100_percent'
      then '100 HYG Points Profile Completion Gift'
    else '100 HYG Points Gift'
  end;

  v_message := case
    when v_transaction.source = 'profile_completion_100_percent'
      then 'You received 100 HYG Points for successfully completing 100% of your employee profile. Claim your gift to add it to your HYG Points balance.'
    else 'You received 100 HYG Points as a token of appreciation for your active participation in the Phase 1 launch: Employee Profile Creation. Claim your gift to add it to your HYG Points balance.'
  end;

  insert into public.notifications (
    employee_id,
    user_profile_id,
    title,
    message,
    link_type,
    link_id,
    is_read,
    created_at
  )
  values (
    v_transaction.employee_id,
    v_transaction.user_profile_id,
    v_title,
    v_message,
    'hyg_points_claim',
    v_transaction.id,
    false,
    now()
  )
  returning id into v_notification_id;

  update public.user_hyg_point_transactions
  set notification_id = v_notification_id,
      notification_deleted_at = null
  where id = v_transaction.id;

  return v_notification_id;
end;
$$;

-- 3. Safe ensure_launch_hyg_points_gift
create or replace function public.ensure_launch_hyg_points_gift(p_user_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_account_id uuid;
  v_transaction_id uuid;
begin
  select *
  into v_profile
  from public.user_profiles up
  where up.id = p_user_profile_id
    and up.auth_user_id is not null
    and up.employee_id is not null
    and up.is_active = true;

  if v_profile.id is null then
    return null;
  end if;

  -- 1) Find or create point account safely
  select id into v_account_id
  from public.user_hyg_point_accounts
  where user_profile_id = v_profile.id
  limit 1;

  if v_account_id is null then
    select id into v_account_id
    from public.user_hyg_point_accounts
    where auth_user_id = v_profile.auth_user_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id)
    order by updated_at desc
    limit 1;
  end if;

  if v_account_id is null then
    insert into public.user_hyg_point_accounts (
      user_profile_id,
      auth_user_id,
      employee_id,
      balance,
      created_at,
      updated_at
    )
    values (
      v_profile.id,
      v_profile.auth_user_id,
      v_profile.employee_id,
      0,
      now(),
      now()
    )
    returning id into v_account_id;
  else
    update public.user_hyg_point_accounts
    set user_profile_id = coalesce(user_profile_id, v_profile.id),
        auth_user_id = coalesce(auth_user_id, v_profile.auth_user_id),
        employee_id = coalesce(employee_id, v_profile.employee_id),
        updated_at = now()
    where id = v_account_id;
  end if;

  -- 2) Check if launch gift transaction already exists
  select id into v_transaction_id
  from public.user_hyg_point_transactions
  where (user_profile_id = v_profile.id or auth_user_id = v_profile.auth_user_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id))
    and source = 'launch_phase_1_profile_creation'
  limit 1;

  if v_transaction_id is not null then
    update public.user_hyg_point_transactions
    set account_id = coalesce(account_id, v_account_id),
        user_profile_id = coalesce(user_profile_id, v_profile.id),
        auth_user_id = coalesce(auth_user_id, v_profile.auth_user_id),
        employee_id = coalesce(employee_id, v_profile.employee_id)
    where id = v_transaction_id;
  else
    insert into public.user_hyg_point_transactions (
      account_id,
      user_profile_id,
      auth_user_id,
      employee_id,
      source,
      points,
      status,
      release_at,
      note,
      created_at
    )
    values (
      v_account_id,
      v_profile.id,
      v_profile.auth_user_id,
      v_profile.employee_id,
      'launch_phase_1_profile_creation',
      100,
      'released',
      now(),
      'Phase 1 launch appreciation gift for employee profile creation.',
      now()
    )
    returning id into v_transaction_id;
  end if;

  -- 3) Ensure notification is created and linked
  perform public.restore_unclaimed_hyg_points_notification(v_transaction_id);

  return v_transaction_id;
end;
$$;

-- 4. Update the trigger function award_launch_hyg_points_after_user_profile() with exception handling
create or replace function public.award_launch_hyg_points_after_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.ensure_launch_hyg_points_gift(new.id);
  exception when others then
    -- Log warning, but NEVER fail the user profile insert transaction
    raise warning 'Failed to award launch points for user profile %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Recreate trigger cleanly
drop trigger if exists trg_award_launch_hyg_points_after_user_profile on public.user_profiles;
create trigger trg_award_launch_hyg_points_after_user_profile
after insert on public.user_profiles
for each row
execute function public.award_launch_hyg_points_after_user_profile();

-- 5. Safe ensure_profile_completion_hyg_points_gift
create or replace function public.ensure_profile_completion_hyg_points_gift(p_user_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_account_id uuid;
  v_transaction_id uuid;
begin
  if not public.is_employee_profile_100_percent_complete(p_user_profile_id) then
    return null;
  end if;

  select *
  into v_profile
  from public.user_profiles up
  where up.id = p_user_profile_id
    and up.auth_user_id is not null
    and up.employee_id is not null
    and up.is_active = true;

  if v_profile.id is null then
    return null;
  end if;

  -- Find or create account safely
  select id into v_account_id
  from public.user_hyg_point_accounts
  where user_profile_id = v_profile.id
  limit 1;

  if v_account_id is null then
    select id into v_account_id
    from public.user_hyg_point_accounts
    where auth_user_id = v_profile.auth_user_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id)
    order by updated_at desc
    limit 1;
  end if;

  if v_account_id is null then
    insert into public.user_hyg_point_accounts (
      user_profile_id,
      auth_user_id,
      employee_id,
      balance,
      created_at,
      updated_at
    )
    values (
      v_profile.id,
      v_profile.auth_user_id,
      v_profile.employee_id,
      0,
      now(),
      now()
    )
    returning id into v_account_id;
  else
    update public.user_hyg_point_accounts
    set user_profile_id = coalesce(user_profile_id, v_profile.id),
        auth_user_id = coalesce(auth_user_id, v_profile.auth_user_id),
        employee_id = coalesce(employee_id, v_profile.employee_id),
        updated_at = now()
    where id = v_account_id;
  end if;

  -- Check if profile completion transaction already exists
  select id into v_transaction_id
  from public.user_hyg_point_transactions
  where (user_profile_id = v_profile.id or auth_user_id = v_profile.auth_user_id or (v_profile.employee_id is not null and employee_id = v_profile.employee_id))
    and source = 'profile_completion_100_percent'
  limit 1;

  if v_transaction_id is not null then
    update public.user_hyg_point_transactions
    set account_id = coalesce(account_id, v_account_id),
        user_profile_id = coalesce(user_profile_id, v_profile.id),
        auth_user_id = coalesce(auth_user_id, v_profile.auth_user_id),
        employee_id = coalesce(employee_id, v_profile.employee_id)
    where id = v_transaction_id;
  else
    insert into public.user_hyg_point_transactions (
      account_id,
      user_profile_id,
      auth_user_id,
      employee_id,
      source,
      points,
      status,
      release_at,
      note,
      created_at
    )
    values (
      v_account_id,
      v_profile.id,
      v_profile.auth_user_id,
      v_profile.employee_id,
      'profile_completion_100_percent',
      100,
      'released',
      now(),
      '100% employee profile completion reward.',
      now()
    )
    returning id into v_transaction_id;
  end if;

  -- Ensure notification is created and linked
  perform public.restore_unclaimed_hyg_points_notification(v_transaction_id);

  return v_transaction_id;
end;
$$;

-- 6. Safe link_employee_login_account (idempotent, supports re-linking if needed)
create or replace function public.link_employee_login_account(
  p_employee_id uuid,
  p_auth_user_id uuid,
  p_username text,
  p_terms_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_username text := nullif(lower(trim(p_username)), '');
  v_employment_status text;
  v_existing_profile public.user_profiles;
begin
  if p_employee_id is null or p_auth_user_id is null then
    raise exception 'Employee and login account are required.';
  end if;

  select lower(trim(coalesce(e.employment_status, '')))
  into v_employment_status
  from public.employees e
  where e.id = p_employee_id;

  if v_employment_status is distinct from 'active' then
    raise exception 'Your employee profile must be activated by HR before registering an account.';
  end if;

  if v_username is null then
    raise exception 'Username is required.';
  end if;

  if p_terms_accepted is not true then
    raise exception 'Terms and conditions must be accepted.';
  end if;

  -- Check if this employee already has a profile
  select * into v_existing_profile
  from public.user_profiles
  where employee_id = p_employee_id
  limit 1;

  if v_existing_profile.id is not null then
    -- If already linked to the same auth user, update username and return successfully (idempotent)
    if v_existing_profile.auth_user_id = p_auth_user_id then
      update public.user_profiles
      set username = v_username,
          is_active = true
      where id = v_existing_profile.id;
      return v_existing_profile.id;
    else
      raise exception 'This employee profile already has a registered login account.';
    end if;
  end if;

  -- Check if this auth user is already linked to another employee
  if exists (select 1 from public.user_profiles where auth_user_id = p_auth_user_id and employee_id is distinct from p_employee_id) then
    raise exception 'This login account is already linked to another employee profile.';
  end if;

  -- Check if username taken by another user
  if exists (select 1 from public.user_profiles where lower(username) = v_username and id is distinct from v_existing_profile.id) then
    raise exception 'This username is already taken.';
  end if;

  insert into public.user_profiles (auth_user_id, employee_id, username, app_role, is_active)
  values (p_auth_user_id, p_employee_id, v_username, 'employee', true)
  returning id into v_profile_id;

  return v_profile_id;
end;
$$;

-- 7. Safe ensure_my_launch_hyg_points_gift and ensure_my_profile_completion_hyg_points_gift
create or replace function public.ensure_my_launch_hyg_points_gift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile public.user_profiles;
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

  v_tx_id := public.ensure_launch_hyg_points_gift(v_profile.id);

  if v_tx_id is null then
    return jsonb_build_object('status', 'skipped');
  end if;

  return jsonb_build_object('status', 'granted', 'transaction_id', v_tx_id, 'points', 100);
end;
$$;

create or replace function public.ensure_my_profile_completion_hyg_points_gift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile public.user_profiles;
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

  v_tx_id := public.ensure_profile_completion_hyg_points_gift(v_profile.id);

  if v_tx_id is null then
    return jsonb_build_object('status', 'skipped');
  end if;

  return jsonb_build_object('status', 'granted', 'transaction_id', v_tx_id, 'points', 100);
end;
$$;

-- 8. Claim HYG points RPC
-- Correctly updates public.notifications using is_read = true (NOT read_at, which does not exist as a table column)
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

  -- Update notification if linked: use is_read = true
  if v_tx.notification_id is not null then
    update public.notifications
    set is_read = true
    where id = v_tx.notification_id;
  end if;

  -- Also update any notification with link_id = this transaction
  update public.notifications
  set is_read = true
  where link_type = 'hyg_points_claim'
    and link_id = v_tx.id;

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

-- 9. Refresh get_my_notifications to ensure robust matching on link_id / action_id
create or replace function public.get_my_notifications()
returns table (
  id uuid,
  title text,
  body text,
  created_at timestamptz,
  read_at timestamptz,
  action_type text,
  action_label text,
  action_status text,
  action_id uuid,
  points numeric,
  release_at timestamptz,
  received_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    n.id,
    n.title,
    n.message as body,
    n.created_at,
    case when n.is_read then n.created_at else null end as read_at,
    case
      when n.link_type = 'hyg_points_claim' then 'hyg_points_claim'
      when n.link_type = 'approval' then 'approval'
      else n.link_type
    end as action_type,
    case
      when n.link_type = 'hyg_points_claim' and hpt.status = 'released' then 'Claim'
      when n.link_type = 'hyg_points_claim' and hpt.status = 'claimed' then 'Claimed'
      else null
    end as action_label,
    hpt.status as action_status,
    coalesce(hpt.id, n.link_id) as action_id,
    hpt.points,
    hpt.release_at,
    hpt.received_at
  from public.notifications n
  join public.user_profiles up
    on up.auth_user_id = auth.uid()
   and (up.id = n.user_profile_id or up.employee_id = n.employee_id)
  left join public.user_hyg_point_transactions hpt
    on n.link_type = 'hyg_points_claim'
   and hpt.id = n.link_id
  order by n.created_at desc
  limit 100;
$$;

-- 10. Backfill launch gifts and notifications for all active employee user profiles
do $$
declare
  r record;
begin
  for r in (
    select id
    from public.user_profiles
    where is_active = true and employee_id is not null
  ) loop
    begin
      perform public.ensure_launch_hyg_points_gift(r.id);
    exception when others then
      -- ignore individual errors
    end;
  end loop;
end;
$$;

-- 11. Grant permissions
grant execute on function public.link_employee_login_account(uuid, uuid, text, boolean) to anon, authenticated;
grant execute on function public.ensure_launch_hyg_points_gift(uuid) to authenticated;
grant execute on function public.ensure_profile_completion_hyg_points_gift(uuid) to authenticated;
grant execute on function public.ensure_my_launch_hyg_points_gift() to authenticated;
grant execute on function public.ensure_my_profile_completion_hyg_points_gift() to authenticated;
grant execute on function public.claim_my_hyg_points(uuid) to authenticated;
grant execute on function public.restore_unclaimed_hyg_points_notification(uuid) to authenticated;
grant execute on function public.get_my_notifications() to authenticated;

notify pgrst, 'reload schema';
