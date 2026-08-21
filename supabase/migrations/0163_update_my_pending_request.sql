create or replace function public.update_my_pending_request(
  p_request_id uuid,
  -- ESARF fields
  p_date_from date default null,
  p_date_to date default null,
  p_time_from time default null,
  p_time_to time default null,
  p_total_hours numeric default null,
  p_time_schedule text default null,
  p_day_off text default null,
  p_payroll_class text default null,
  p_transaction_type text default null,
  -- Leave fields
  p_leave_type text default null,
  p_leave_category text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_total_days numeric default null,
  p_paid_days numeric default null,
  p_unpaid_days numeric default null,
  -- Shared
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_req public.requests;
  v_is_perk boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.employee_id is null then
    raise exception 'User profile not found.';
  end if;

  select * into v_req
  from public.requests
  where id = p_request_id;

  if v_req.id is null then
    -- Check if it's a perk request
    select exists (
      select 1 from public.employee_perk_requests
      where id = p_request_id
        and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id)
    ) into v_is_perk;

    if v_is_perk then
      update public.employee_perk_requests
      set reason = coalesce(nullif(trim(p_reason), ''), reason)
      where id = p_request_id and status = 'pending';
      return 'Request updated successfully.';
    end if;

    raise exception 'Request not found.';
  end if;

  if v_req.submitted_by_employee_id != v_profile.employee_id then
    raise exception 'You can only edit your own requests.';
  end if;

  if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr') then
    raise exception 'Only pending requests can be edited.';
  end if;

  -- Update time_request_details if present (ESARF)
  if exists (select 1 from public.time_request_details where request_id = p_request_id) then
    if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
      raise exception 'Date To cannot be earlier than Date From.';
    end if;

    update public.time_request_details
    set
      date_from = coalesce(p_date_from, date_from),
      date_to = coalesce(p_date_to, date_to),
      time_from = coalesce(p_time_from, time_from),
      time_to = coalesce(p_time_to, time_to),
      total_hours = coalesce(p_total_hours, total_hours),
      reason = coalesce(nullif(trim(p_reason), ''), reason),
      time_schedule = coalesce(nullif(trim(p_time_schedule), ''), time_schedule),
      day_off = coalesce(nullif(trim(p_day_off), ''), day_off),
      payroll_class = coalesce(nullif(trim(p_payroll_class), ''), payroll_class),
      transaction_type = coalesce(nullif(trim(p_transaction_type), ''), transaction_type)
    where request_id = p_request_id;
  end if;

  -- Update leave_request_details if present (Leave)
  if exists (select 1 from public.leave_request_details where request_id = p_request_id) then
    if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
      raise exception 'Date To cannot be earlier than Date From.';
    end if;

    update public.leave_request_details
    set
      leave_type = coalesce(nullif(trim(p_leave_type), ''), leave_type),
      leave_category = coalesce(nullif(trim(p_leave_category), ''), leave_category),
      start_date = coalesce(p_start_date, start_date),
      end_date = coalesce(p_end_date, end_date),
      total_days = coalesce(p_total_days, total_days),
      paid_days = coalesce(p_paid_days, paid_days),
      unpaid_days = coalesce(p_unpaid_days, unpaid_days),
      reason = coalesce(nullif(trim(p_reason), ''), reason)
    where request_id = p_request_id;
  end if;

  -- Update main request timestamp
  update public.requests
  set updated_at = now()
  where id = p_request_id;

  return 'Request updated successfully.';
end;
$$;

grant execute on function public.update_my_pending_request(
  uuid,
  date, date, time, time, numeric, text, text, text, text,
  text, text, date, date, numeric, numeric, numeric,
  text
) to authenticated;

notify pgrst, 'reload schema';
