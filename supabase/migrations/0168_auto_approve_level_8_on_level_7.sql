-- Auto-approve Level 8 approval step when Level 7 approver approves a request
-- that requires both Level 7 and Level 8 approvals.

create or replace function public.decide_approval_step(
  p_step_id uuid,
  p_decision text,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles;
  v_step public.request_approval_steps;
  v_next_step_id uuid;
  v_request_type_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  if p_decision = 'rejected' and nullif(trim(coalesce(p_remarks, '')), '') is null then
    raise exception 'A rejection reason is required.';
  end if;

  select *
  into v_profile
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_profile.id is null or v_profile.employee_id is null then
    raise exception 'Your login is not linked to an employee profile.';
  end if;

  select *
  into v_step
  from public.request_approval_steps
  where id = p_step_id
  for update;

  if v_step.id is null then
    raise exception 'Approval step was not found.';
  end if;

  if v_step.assigned_approver_employee_id <> v_profile.employee_id then
    raise exception 'This approval is not assigned to your employee profile.';
  end if;

  if v_step.status <> 'pending' then
    raise exception 'This approval step is not pending.';
  end if;

  select rt.code
  into v_request_type_code
  from public.requests r
  join public.request_types rt on rt.id = r.request_type_id
  where r.id = v_step.request_id
  limit 1;

  update public.request_approval_steps
  set status = p_decision,
      remarks = nullif(trim(coalesce(p_remarks, '')), ''),
      acted_at = now()
  where id = p_step_id;

  if p_decision = 'rejected' then
    update public.requests
    set status = 'rejected',
        rejected_at = now(),
        rejected_reason = nullif(trim(coalesce(p_remarks, '')), ''),
        updated_at = now()
    where id = v_step.request_id;

    update public.request_approval_steps
    set status = 'cancelled'
    where request_id = v_step.request_id
      and status = 'waiting';

    return v_step.request_id;
  end if;

  if v_request_type_code = 'leave' then
    update public.request_approval_steps
    set status = 'cancelled'
    where request_id = v_step.request_id
      and id <> p_step_id
      and status in ('waiting', 'pending', 'admin_fallback');

    update public.requests
    set status = 'approved',
        final_approved_at = now(),
        updated_at = now()
    where id = v_step.request_id;

    perform public.apply_leave_side_effects(v_step.request_id);
    return v_step.request_id;
  end if;

  -- Auto-approve Level 8 if Level 7 approves on a request requiring Level 7 and Level 8
  if p_decision = 'approved' and v_step.required_level = 7 then
    update public.request_approval_steps
    set status = 'approved',
        acted_at = now(),
        remarks = coalesce(nullif(trim(p_remarks), ''), 'Auto-approved via Level 7 approval')
    where request_id = v_step.request_id
      and required_level = 8
      and status in ('waiting', 'pending');
  end if;

  select id
  into v_next_step_id
  from public.request_approval_steps
  where request_id = v_step.request_id
    and status = 'waiting'
  order by step_order asc
  limit 1;

  if v_next_step_id is not null then
    update public.request_approval_steps
    set status = 'pending'
    where id = v_next_step_id;
  else
    update public.requests
    set status = 'approved',
        final_approved_at = now(),
        updated_at = now()
    where id = v_step.request_id;

    perform public.apply_offset_side_effects(v_step.request_id);
    perform public.apply_leave_side_effects(v_step.request_id);
  end if;

  return v_step.request_id;
end;
$$;

-- Backfill: auto-approve Level 8 for any pending requests where Level 7 was already approved
do $$
declare
  v_rec record;
begin
  for v_rec in
    select r.id as request_id, l8.id as step_id, l7.remarks as l7_remarks
    from public.requests r
    join public.request_approval_steps l7
      on l7.request_id = r.id
     and l7.required_level = 7
     and l7.status = 'approved'
    join public.request_approval_steps l8
      on l8.request_id = r.id
     and l8.required_level = 8
     and l8.status in ('waiting', 'pending')
    where r.status = 'pending'
  loop
    update public.request_approval_steps
    set status = 'approved',
        acted_at = now(),
        remarks = coalesce(nullif(trim(v_rec.l7_remarks), ''), 'Auto-approved via Level 7 approval')
    where id = v_rec.step_id;

    if not exists (
      select 1 from public.request_approval_steps
      where request_id = v_rec.request_id and status = 'waiting'
    ) then
      update public.requests
      set status = 'approved',
          final_approved_at = now(),
          updated_at = now()
      where id = v_rec.request_id;

      perform public.apply_offset_side_effects(v_rec.request_id);
      perform public.apply_leave_side_effects(v_rec.request_id);
    end if;
  end loop;
end;
$$;

grant execute on function public.decide_approval_step(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
