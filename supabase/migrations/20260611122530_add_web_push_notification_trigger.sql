create or replace function public.notify_web_push_subscribers()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_auth_user_id uuid;
begin
  select up.auth_user_id
    into target_auth_user_id
  from public.user_profiles up
  where up.auth_user_id is not null
    and (up.id = new.user_profile_id or up.employee_id = new.employee_id)
  order by case when up.id = new.user_profile_id then 0 else 1 end
  limit 1;

  if target_auth_user_id is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://dkabosehgvldiwtdmvxh.supabase.co/functions/v1/send-web-push',
    body := jsonb_build_object(
      'userId', target_auth_user_id,
      'title', coalesce(new.title, 'HYG Portal'),
      'body', coalesce(new.message, 'You have a new HYG Portal alert.'),
      'url', '/'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-push-secret', 'a21HvRUpnT7CucC7Vfp6lwZtsjdsA9CpWGlZr5GXvzE='
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists notifications_web_push_insert on public.notifications;
create trigger notifications_web_push_insert
  after insert on public.notifications
  for each row
  execute function public.notify_web_push_subscribers();
