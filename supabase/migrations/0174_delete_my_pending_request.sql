-- Migration 0174: Allow employees to delete their own pending requests (ESARF, Leave, and Perks)

create or replace function public.delete_my_pending_request(
  p_request_id uuid,
  p_is_perk boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_req public.requests;
  v_perk_req public.employee_perk_requests;
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

  if p_is_perk then
    -- Check perk request
    select * into v_perk_req
    from public.employee_perk_requests
    where id = p_request_id
      and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id);

    if v_perk_req.id is null then
      raise exception 'Perk request not found.';
    end if;

    if v_perk_req.status not in ('pending', 'submitted', 'waiting') then
      raise exception 'Only pending perk requests can be deleted.';
    end if;

    delete from public.employee_perk_requests where id = p_request_id;
    return 'Perk request deleted successfully.';
  else
    -- Check main requests table (ESARF / Leave)
    select * into v_req
    from public.requests
    where id = p_request_id;

    if v_req.id is null then
      -- Fallback: check if it was actually a perk request
      select * into v_perk_req
      from public.employee_perk_requests
      where id = p_request_id
        and (employee_id = v_profile.employee_id or submitted_by_user_id = v_profile.id);

      if v_perk_req.id is not null then
        if v_perk_req.status not in ('pending', 'submitted', 'waiting') then
          raise exception 'Only pending perk requests can be deleted.';
        end if;
        delete from public.employee_perk_requests where id = p_request_id;
        return 'Perk request deleted successfully.';
      end if;

      raise exception 'Request not found.';
    end if;

    if v_req.submitted_by_employee_id != v_profile.employee_id then
      raise exception 'You can only delete your own requests.';
    end if;

    if v_req.status not in ('pending', 'needs_admin_review', 'submitted', 'pending_hr', 'waiting') then
      raise exception 'Only pending requests can be deleted.';
    end if;

    delete from public.approval_push_outbox where request_id = p_request_id;
    delete from public.offset_transactions where request_id = p_request_id;
    delete from public.leave_transactions where request_id = p_request_id;
    delete from public.time_request_details where request_id = p_request_id;
    delete from public.leave_request_details where request_id = p_request_id;
    delete from public.request_approval_steps where request_id = p_request_id;
    delete from public.requests where id = p_request_id;

    return 'Request deleted successfully.';
  end if;
end;
$$;

grant execute on function public.delete_my_pending_request(uuid, boolean) to authenticated;
grant execute on function public.delete_my_pending_request(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
