create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.web_push_subscriptions enable row level security;

drop policy if exists "Users can view own web push subscriptions" on public.web_push_subscriptions;
create policy "Users can view own web push subscriptions"
  on public.web_push_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own web push subscriptions" on public.web_push_subscriptions;
create policy "Users can insert own web push subscriptions"
  on public.web_push_subscriptions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own web push subscriptions" on public.web_push_subscriptions;
create policy "Users can update own web push subscriptions"
  on public.web_push_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own web push subscriptions" on public.web_push_subscriptions;
create policy "Users can delete own web push subscriptions"
  on public.web_push_subscriptions
  for delete
  using (auth.uid() = user_id);

create index if not exists web_push_subscriptions_user_id_idx
  on public.web_push_subscriptions(user_id);
