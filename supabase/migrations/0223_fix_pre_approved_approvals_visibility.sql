-- Migration 0223: Fix Pre-approved OT/Offset Visibility on Approvals Screen
-- ============================================================================
-- Problem:
-- Pre-approved OT and Offset requests do not appear on the approver's Approvals screen.
--
-- Root Cause:
-- In migration 0210, `get_my_pending_approvals()` was updated to include pre-approved
-- requests by removing `and r.status <> 'pre_approved'`.
-- However, in migration 0216 (official travel order system), `get_my_pending_approvals()`
-- was replaced with a version copied from migration 0205, which accidentally re-introduced:
--     `and r.status <> 'pre_approved';`
-- This filter caused PostgreSQL to exclude all requests having status = 'pre_approved',
-- even though step 1 was in 'pending' status assigned to the approver.
--
-- Fix:
-- 1. Recreate `public.get_my_pending_approvals()` without `and r.status <> 'pre_approved'`.
--    Instead, exclude only terminal/non-actionable states (`cancelled`, `rejected`, `approved`).
-- 2. Also enhance the approver user profile match to support both employee_id and user_id.
-- 3. Backfill any legacy pre-approved requests whose step 1 is still in 'waiting'.
-- ============================================================================

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
    coalesce(trd.date_from, tord.departure_date) as date_from,
    coalesce(trd.date_to, tord.return_date) as date_to,
    coalesce(trd.time_from, tord.departure_time) as time_from,
    coalesce(trd.time_to, tord.return_time) as time_to,
    trd.time_schedule,
    trd.day_off,
    trd.payroll_class,
    coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end) as transaction_type,
    trd.total_hours,
    lrd.leave_type,
    lrd.leave_category,
    coalesce(lrd.start_date, tord.departure_date) as start_date,
    coalesce(lrd.end_date, tord.return_date) as end_date,
    lrd.total_days,
    lrd.paid_days,
    lrd.unpaid_days,
    coalesce(
      trd.reason,
      lrd.reason,
      case when tord.id is not null then
        'Destination: ' || coalesce(nullif(tord.destinations, ''), 'Not specified')
        || ' | Purpose: ' || coalesce(nullif(trim(tord.purpose_of_travel), ''), 'Official Travel')
        || case when nullif(trim(tord.purpose_details), '') is not null then ' (' || trim(tord.purpose_details) || ')' else '' end
        || case when nullif(trim(tord.transport_mode), '') is not null then ' | Transport: ' || trim(tord.transport_mode) || case when nullif(trim(tord.plate_no), '') is not null then ' [' || trim(tord.plate_no) || ']' else '' end else '' end
        || case when coalesce(tord.total_budget, 0) > 0 then ' | Budget: PHP ' || to_char(tord.total_budget, 'FM999,999,999.00') else '' end
      else null end
    ) as reason,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'step_order', route_step.step_order,
            'required_level', route_step.required_level,
            'position_level', coalesce(ap.authority_level, ap_fallback.authority_level, aa_auth.authority_level, route_step.required_level),
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
  left join public.travel_order_request_details tord on tord.request_id = r.id
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
  join public.user_profiles up on (
    up.employee_id = pending_step.assigned_approver_employee_id
    or (pending_step.assigned_approver_employee_id is null and up.id = pending_step.assigned_approver_user_id)
  )
  where up.auth_user_id = auth.uid()
    and pending_step.status = 'pending'
    and r.status not in ('cancelled', 'rejected', 'approved');
$$;

grant execute on function public.get_my_pending_approvals() to authenticated, anon, service_role;

-- 2. Backfill: Ensure step 1 is pending for any pre-approved requests currently waiting
update public.request_approval_steps ras
set status = 'pending'
from public.requests r
where ras.request_id = r.id
  and ras.step_order = 1
  and ras.status = 'waiting'
  and r.status in ('pre_approved', 'pending', 'submitted')
  and not exists (
    select 1 from public.request_approval_steps other_step
    where other_step.request_id = r.id and other_step.status in ('approved', 'rejected')
  );

notify pgrst, 'reload schema';

