-- Migration 0203: Fix Approver Authority Level in get_my_requests, get_my_pending_approvals, and admin_get_all_requests
-- Ensures that the authority level displayed for each approver accurately reflects their position's authority level
-- (from positions.authority_level / authority_assignments.authority_level), matching the admin side.

-- 1. Update public.get_my_requests()
drop function if exists public.get_my_requests();

create or replace function public.get_my_requests()
returns table (
  request_id uuid,
  request_type_code text,
  request_type_name text,
  status text,
  submitted_at timestamptz,
  final_approved_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  date_from date,
  date_to date,
  time_from time,
  time_to time,
  time_schedule text,
  day_off text,
  payroll_class text,
  transaction_type text,
  total_hours numeric,
  leave_type text,
  leave_category text,
  start_date date,
  end_date date,
  total_days numeric,
  paid_days numeric,
  unpaid_days numeric,
  reason text,
  perk_approval_code text,
  perk_amount numeric,
  perk_discount_amount numeric,
  perk_final_amount numeric,
  perk_benefit text,
  approval_summary jsonb
)
language sql
security definer
set search_path = public
as $$
  select * from (
    select
      r.id as request_id,
      rt.code as request_type_code,
      rt.name as request_type_name,
      r.status,
      r.submitted_at,
      r.final_approved_at,
      r.rejected_at,
      r.rejected_reason,
      trd.date_from,
      trd.date_to,
      trd.time_from,
      trd.time_to,
      trd.time_schedule,
      trd.day_off,
      trd.payroll_class,
      trd.transaction_type,
      trd.total_hours,
      lrd.leave_type,
      lrd.leave_category,
      lrd.start_date,
      lrd.end_date,
      lrd.total_days,
      lrd.paid_days,
      lrd.unpaid_days,
      coalesce(trd.reason, lrd.reason) as reason,
      null::text as perk_approval_code,
      null::numeric as perk_amount,
      null::numeric as perk_discount_amount,
      null::numeric as perk_final_amount,
      null::text as perk_benefit,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'step_order', ras.step_order,
              'required_level', ras.required_level,
              'position_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level),
              'approver_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, ras.required_level),
              'level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, ras.required_level),
              'status', ras.status,
              'acted_at', ras.acted_at,
              'remarks', ras.remarks,
              'skipped_reason', ras.skipped_reason,
              'approver_name', coalesce(
                nullif(trim(concat_ws(' ', ae.first_name, ae.middle_name, ae.last_name, ae.suffix)), ''),
                nullif(trim(ras.approver_name), '')
              ),
              'approver_position_name', coalesce(ap.name, ap_fallback.name, nullif(trim(ras.approver_position_name), '')),
              'approver_employee_no', coalesce(ae.employee_no, nullif(trim(ras.approver_employee_no), ''))
            )
            order by ras.step_order asc
          )
          from public.request_approval_steps ras
          left join public.employees ae on ae.id = ras.assigned_approver_employee_id
          left join lateral (
            select ea.position_id, ea.function_id
            from public.employee_assignments ea
            where ea.employee_id = ae.id
            order by
              case when ea.is_primary = true then 0 else 1 end,
              case when ea.effective_to is null or ea.effective_to >= current_date then 0 else 1 end,
              case when ea.effective_from <= current_date then 0 else 1 end,
              ea.effective_from desc,
              ea.created_at desc
            limit 1
          ) aa on true
          left join public.positions ap on ap.id = aa.position_id
          left join lateral (
            select p_fb.authority_level, p_fb.name
            from public.positions p_fb
            where lower(trim(p_fb.name)) = lower(trim(ras.approver_position_name))
            order by case when p_fb.is_active = true then 0 else 1 end
            limit 1
          ) ap_fallback on true
          left join lateral (
            select auth_as.authority_level
            from public.authority_assignments auth_as
            where auth_as.employee_id = ae.id
              and auth_as.is_active = true
              and (auth_as.effective_to is null or auth_as.effective_to >= current_date)
            order by
              case when auth_as.function_id = aa.function_id then 0 else 1 end,
              auth_as.created_at desc
            limit 1
          ) aa_auth on true
          where ras.request_id = r.id
        ),
        '[]'::jsonb
      ) as approval_summary
    from public.requests r
    join public.request_types rt on rt.id = r.request_type_id
    left join public.time_request_details trd on trd.request_id = r.id
    left join public.leave_request_details lrd on lrd.request_id = r.id
    join public.user_profiles up on up.employee_id = r.submitted_by_employee_id
    where up.auth_user_id = auth.uid()
  ) q
  order by submitted_at desc;
$$;

grant execute on function public.get_my_requests() to authenticated;
grant execute on function public.get_my_requests() to anon;
grant execute on function public.get_my_requests() to service_role;


-- 2. Update public.get_my_pending_approvals()
drop function if exists public.get_my_pending_approvals();

create or replace function public.get_my_pending_approvals()
returns table (
  request_id uuid,
  step_id uuid,
  pending_step_id uuid,
  request_type_code text,
  request_type_name text,
  status text,
  submitted_at timestamptz,
  requester_name text,
  requester_employee_no text,
  requester_photo_url text,
  department_name text,
  position_name text,
  company_name text,
  date_from date,
  date_to date,
  time_from time,
  time_to time,
  time_schedule text,
  day_off text,
  payroll_class text,
  transaction_type text,
  total_hours numeric,
  leave_type text,
  leave_category text,
  start_date date,
  end_date date,
  total_days numeric,
  paid_days numeric,
  unpaid_days numeric,
  reason text,
  approval_summary jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    r.id as request_id,
    pending_step.id as step_id,
    pending_step.id as pending_step_id,
    rt.code as request_type_code,
    rt.name as request_type_name,
    r.status,
    r.submitted_at,
    nullif(trim(concat_ws(' ', e.first_name, e.middle_name, e.last_name, e.suffix)), '') as requester_name,
    e.employee_no as requester_employee_no,
    e.photo_url as requester_photo_url,
    d.name as department_name,
    p.name as position_name,
    c.name as company_name,
    trd.date_from,
    trd.date_to,
    trd.time_from,
    trd.time_to,
    trd.time_schedule,
    trd.day_off,
    trd.payroll_class,
    trd.transaction_type,
    trd.total_hours,
    lrd.leave_type,
    lrd.leave_category,
    lrd.start_date,
    lrd.end_date,
    lrd.total_days,
    lrd.paid_days,
    lrd.unpaid_days,
    coalesce(trd.reason, lrd.reason) as reason,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'step_order', route_step.step_order,
            'required_level', route_step.required_level,
            'position_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level),
            'approver_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, route_step.required_level),
            'level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, route_step.required_level),
            'status', route_step.status,
            'acted_at', route_step.acted_at,
            'remarks', route_step.remarks,
            'skipped_reason', route_step.skipped_reason,
            'approver_name', coalesce(
              nullif(trim(concat_ws(' ', ae.first_name, ae.middle_name, ae.last_name, ae.suffix)), ''),
              nullif(trim(route_step.approver_name), '')
            ),
            'approver_position_name', coalesce(ap.name, ap_fallback.name, nullif(trim(route_step.approver_position_name), '')),
            'approver_employee_no', coalesce(ae.employee_no, nullif(trim(route_step.approver_employee_no), ''))
          )
          order by route_step.step_order asc
        )
        from public.request_approval_steps route_step
        left join public.employees ae on ae.id = route_step.assigned_approver_employee_id
        left join lateral (
          select ea.position_id, ea.function_id
          from public.employee_assignments ea
          where ea.employee_id = ae.id
          order by
            case when ea.is_primary = true then 0 else 1 end,
            case when ea.effective_to is null or ea.effective_to >= current_date then 0 else 1 end,
            case when ea.effective_from <= current_date then 0 else 1 end,
            ea.effective_from desc,
            ea.created_at desc
          limit 1
        ) aa on true
        left join public.positions ap on ap.id = aa.position_id
        left join lateral (
          select p_fb.authority_level, p_fb.name
          from public.positions p_fb
          where lower(trim(p_fb.name)) = lower(trim(route_step.approver_position_name))
          order by case when p_fb.is_active = true then 0 else 1 end
          limit 1
        ) ap_fallback on true
        left join lateral (
          select auth_as.authority_level
          from public.authority_assignments auth_as
          where auth_as.employee_id = ae.id
            and auth_as.is_active = true
            and (auth_as.effective_to is null or auth_as.effective_to >= current_date)
          order by
            case when auth_as.function_id = aa.function_id then 0 else 1 end,
            auth_as.created_at desc
          limit 1
        ) aa_auth on true
        where route_step.request_id = r.id
      ),
      '[]'::jsonb
    ) as approval_summary
  from public.request_approval_steps pending_step
  join public.requests r on r.id = pending_step.request_id
  join public.request_types rt on rt.id = r.request_type_id
  join public.employees e on e.id = r.submitted_by_employee_id
  left join public.time_request_details trd on trd.request_id = r.id
  left join public.leave_request_details lrd on lrd.request_id = r.id
  left join lateral (
    select ea.department_id, ea.company_id, ea.position_id
    from public.employee_assignments ea
    where ea.employee_id = e.id
      and ea.is_primary = true
      and ea.effective_from <= current_date
      and (ea.effective_to is null or ea.effective_to >= current_date)
    order by ea.effective_from desc, ea.created_at desc
    limit 1
  ) ea on true
  left join public.departments d on d.id = ea.department_id
  left join public.positions p on p.id = ea.position_id
  left join public.companies c on c.id = ea.company_id
  join public.user_profiles up on up.employee_id = pending_step.assigned_approver_employee_id
  where up.auth_user_id = auth.uid()
    and pending_step.status = 'pending'
    and r.status <> 'pre_approved';
$$;

grant execute on function public.get_my_pending_approvals() to authenticated;
grant execute on function public.get_my_pending_approvals() to anon;
grant execute on function public.get_my_pending_approvals() to service_role;

notify pgrst, 'reload schema';
