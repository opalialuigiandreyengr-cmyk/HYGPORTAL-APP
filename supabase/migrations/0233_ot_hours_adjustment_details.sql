-- ============================================================================
-- Migration 0233: OT Total Hours Adjustment Tracking (Original Hours + Reason)
-- ============================================================================
-- 1. Adds original_total_hours, hours_adjustment_reason, hours_adjusted_at,
--    and hours_adjusted_by columns to public.time_request_details.
-- 2. Adds SECURITY DEFINER RPC public.approver_adjust_time_request_hours so
--    assigned approvers (and admins) can reliably update total_hours, preserve
--    the original total hours before editing, and record the adjustment reason.
-- 3. Updates public.admin_get_all_requests to expose original_total_hours and
--    hours_adjustment_reason (coalesced from columns or [OrigHours]/[AdjustmentReason]
--    tags in reason) so the Admin side and Approved Requests tab receive full details.
-- ============================================================================

-- 1. Add tracking columns to time_request_details
alter table public.time_request_details
  add column if not exists original_total_hours numeric(10, 2),
  add column if not exists hours_adjustment_reason text,
  add column if not exists hours_adjusted_at timestamptz,
  add column if not exists hours_adjusted_by uuid;


-- 2. Approver RPC to adjust OT/Offset total hours & record adjustment reason
create or replace function public.approver_adjust_time_request_hours(
  p_request_id uuid,
  p_total_hours numeric,
  p_original_total_hours numeric default null,
  p_adjustment_reason text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_employee_id uuid;
  v_caller_role text;
  v_is_authorized boolean := false;
begin
  select up.employee_id, up.app_role
  into v_caller_employee_id, v_caller_role
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
    and up.is_active = true
  limit 1;

  if v_caller_role in ('admin', 'super_admin', 'hr', 'hr_admin') then
    v_is_authorized := true;
  elsif v_caller_employee_id is not null and exists (
    select 1
    from public.request_approval_steps ras
    where ras.request_id = p_request_id
      and ras.assigned_approver_employee_id = v_caller_employee_id
  ) then
    v_is_authorized := true;
  end if;

  if not v_is_authorized then
    raise exception 'You are not authorized to adjust hours for this request.';
  end if;

  if p_total_hours is null or p_total_hours < 0 then
    raise exception 'Adjusted total hours must be a valid non-negative number.';
  end if;

  update public.time_request_details
  set
    original_total_hours = coalesce(original_total_hours, p_original_total_hours, total_hours),
    total_hours = round(p_total_hours::numeric, 2),
    hours_adjustment_reason = coalesce(nullif(trim(p_adjustment_reason), ''), hours_adjustment_reason),
    hours_adjusted_at = now(),
    hours_adjusted_by = coalesce(v_caller_employee_id, hours_adjusted_by),
    reason = case
      when p_reason is not null and trim(p_reason) <> '' then p_reason
      else reason
    end
  where request_id = p_request_id;
end;
$$;

grant execute on function public.approver_adjust_time_request_hours(uuid, numeric, numeric, text, text) to authenticated, service_role;


-- 3. Update public.admin_get_all_requests to expose original_total_hours and hours_adjustment_reason
drop function if exists public.admin_get_all_requests();

create or replace function public.admin_get_all_requests()
returns table (
  request_id uuid,
  request_type_code text,
  request_type_name text,
  status text,
  submitted_at timestamptz,
  final_approved_at timestamptz,
  rejected_at timestamptz,
  rejected_reason text,
  employee_id uuid,
  employee_no text,
  employee_name text,
  employee_photo text,
  department_name text,
  position_name text,
  company_name text,
  store_name text,
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
  perk_product_name text,
  perk_quantity int,
  approval_summary jsonb,
  original_total_hours numeric,
  hours_adjustment_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_role text;
  v_user_profile_id uuid;
begin
  select app_role, id
  into v_user_role, v_user_profile_id
  from public.user_profiles
  where auth_user_id = auth.uid()
    and is_active = true;

  return query
  with all_requests_raw as (
    -- ESARF time + leave + travel order requests
    select
      r.id as request_id,
      rt.code as request_type_code,
      rt.name as request_type_name,
      case
        when r.status in ('rejected', 'cancelled', 'validated') then r.status
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%')
             and (r.final_approved_at is not null or coalesce(s1_app.is_approved, false)) then 'pre_approved'
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%') then 'pending'
        else r.status
      end as status,
      r.submitted_at,
      r.final_approved_at,
      r.rejected_at,
      r.rejected_reason,
      e.id as employee_id,
      e.employee_no,
      nullif(trim(
        concat_ws(' ',
          e.first_name,
          case when nullif(trim(e.middle_name), '') is not null
               then left(trim(e.middle_name), 1) || '.'
               else null end,
          e.last_name,
          nullif(trim(e.suffix), '')
        )
      ), '') as employee_name,
      e.photo_url as employee_photo,
      d.name as department_name,
      p.name as position_name,
      c.name as company_name,
      s.name as store_name,
      coalesce(trd.date_from, tord.departure_date) as date_from,
      coalesce(trd.date_to, tord.return_date) as date_to,
      coalesce(trd.time_from, tord.departure_time) as time_from,
      coalesce(trd.time_to, tord.return_time) as time_to,
      coalesce(trd.time_schedule, lrd.time_schedule) as time_schedule,
      coalesce(trd.day_off, lrd.day_off) as day_off,
      coalesce(trd.payroll_class, lrd.payroll_class) as payroll_class,
      case
        when (r.status = 'pre_approved' or coalesce(trd.reason, '') like '%[PreApproved]%' or coalesce(trd.transaction_type, '') like '%scheduled_ot%')
             and r.status not in ('rejected', 'cancelled', 'validated')
             and r.final_approved_at is null
             and not coalesce(s1_app.is_approved, false)
             and lower(coalesce(trd.transaction_type, '')) not like '%for pre-approval%'
        then coalesce(nullif(trim(trd.transaction_type), ''), 'OT') || ' for Pre-Approval'
        else coalesce(trd.transaction_type, case when tord.id is not null then 'Travel Order' else null end)
      end as transaction_type,
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
      null::text as perk_approval_code,
      null::numeric as perk_amount,
      null::numeric as perk_discount_amount,
      null::numeric as perk_final_amount,
      null::text as perk_benefit,
      null::text as perk_product_name,
      null::int as perk_quantity,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'step_id', ras.id,
              'step_order', ras.step_order,
              'required_level', coalesce(alr.approver_level, ras.required_level),
              'level', coalesce(alr.approver_level, ras.required_level),
              'approver_level', coalesce(alr.approver_level, ras.required_level),
              'status', ras.status,
              'acted_at', ras.acted_at,
              'approved_at', case when ras.status = 'approved' then ras.acted_at else null end,
              'remarks', ras.remarks,
              'skipped_reason', ras.skipped_reason,
              'approver_name', coalesce(
                nullif(trim(
                  concat_ws(' ',
                    ae.first_name,
                    case when nullif(trim(ae.middle_name), '') is not null
                         then left(trim(ae.middle_name), 1) || '.'
                         else null end,
                    ae.last_name,
                    nullif(trim(ae.suffix), '')
                  )
                ), ''),
                nullif(trim(ras.approver_name), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'HYG Portal System' else null end
              ),
              'approver_position_name', coalesce(ap.name, nullif(trim(ras.approver_position_name), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'Automated HR Perk System' else null end
              ),
              'approver_employee_no', coalesce(ae.employee_no, nullif(trim(ras.approver_employee_no), ''),
                case when ras.status = 'approved' and ras.remarks like '%System auto-approved%' then 'SYS-001' else null end
              )
            )
            order by ras.step_order asc
          )
          from public.request_approval_steps ras
          left join public.employees ae on ae.id = ras.assigned_approver_employee_id
          left join lateral (
            select ea.position_id
            from public.employee_assignments ea
            where ea.employee_id = ae.id
              and ea.is_primary = true
              and ea.effective_from <= current_date
              and (ea.effective_to is null or ea.effective_to >= current_date)
            order by ea.effective_from desc, ea.created_at desc
            limit 1
          ) aa on true
          left join public.positions ap on ap.id = aa.position_id
          left join lateral (
            select alr.approver_level
            from public.approval_level_routes alr
            where alr.requester_level = r.requester_level
              and alr.step_order = ras.step_order
              and (alr.department_id = ea.department_id or alr.department_id is null)
            order by case when alr.department_id = ea.department_id then 0 else 1 end
            limit 1
          ) alr on true
          where ras.request_id = r.id
            and (
              not (
                r.status = 'pre_approved'
                or coalesce(trd.reason, '') like '%[PreApproved]%'
                or coalesce(trd.transaction_type, '') like '%scheduled_ot%'
              )
              or ras.step_order = 1
            )
        ),
        '[]'::jsonb
      ) as approval_summary,
      coalesce(
        trd.original_total_hours,
        nullif(substring(coalesce(trd.reason, '') from '\[(?:OrigHours|OriginalHours):\s*([0-9]+(?:\.[0-9]+)?)\s*hrs?\]'), '')::numeric
      ) as original_total_hours,
      coalesce(
        nullif(trim(trd.hours_adjustment_reason), ''),
        nullif(trim(substring(coalesce(trd.reason, '') from '\[(?:AdjustmentReason|AdjReason):\s*([^\]]+)\]')), '')
      ) as hours_adjustment_reason,
      ea.company_id as _filter_cid
    from public.requests r
    join public.request_types rt on rt.id = r.request_type_id
    join public.employees e on e.id = r.submitted_by_employee_id
    left join public.time_request_details trd on trd.request_id = r.id
    left join public.leave_request_details lrd on lrd.request_id = r.id
    left join public.travel_order_request_details tord on tord.request_id = r.id
    left join lateral (
      select true as is_approved
      from public.request_approval_steps s1
      where s1.request_id = r.id
        and s1.step_order = 1
        and s1.status = 'approved'
      limit 1
    ) s1_app on true
    left join lateral (
      select ea.department_id, ea.company_id, ea.store_id, ea.position_id
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
    left join public.stores s on s.id = ea.store_id

    union all

    -- Perk requests (discount / charge)
    select
      pr.id as request_id,
      pr.form_type as request_type_code,
      pr.request_label as request_type_name,
      case when pr.status = 'pending_verification' then 'pending' else pr.status end as status,
      pr.created_at as submitted_at,
      pr.approved_at as final_approved_at,
      null::timestamptz as rejected_at,
      null::text as rejected_reason,
      coalesce(e.id, pr.submitted_by_employee_id, up.employee_id) as employee_id,
      coalesce(e.employee_no, '—') as employee_no,
      coalesce(
        nullif(trim(
          concat_ws(' ',
            e.first_name,
            case when nullif(trim(e.middle_name), '') is not null
                 then left(trim(e.middle_name), 1) || '.'
                 else null end,
            e.last_name,
            nullif(trim(e.suffix), '')
          )
        ), ''),
        up.username,
        pr.email,
        'Employee'
      ) as employee_name,
      e.photo_url as employee_photo,
      coalesce(d.name, '—') as department_name,
      coalesce(p.name, '—') as position_name,
      coalesce(c.name, '—') as company_name,
      coalesce(s.name, '—') as store_name,
      pr.transaction_date as date_from,
      pr.transaction_date as date_to,
      null::time as time_from,
      null::time as time_to,
      null::text as time_schedule,
      null::text as day_off,
      null::text as payroll_class,
      pr.request_label as transaction_type,
      null::numeric as total_hours,
      null::text as leave_type,
      null::text as leave_category,
      null::date as start_date,
      null::date as end_date,
      null::numeric as total_days,
      null::numeric as paid_days,
      null::numeric as unpaid_days,
      pr.product_name as reason,
      pr.approval_code as perk_approval_code,
      pr.amount as perk_amount,
      round(pr.amount - pr.final_amount, 2) as perk_discount_amount,
      pr.final_amount as perk_final_amount,
      case
        when pr.discount_applies then '15% shared cash/credit discount'
        else 'Employee charge'
      end as perk_benefit,
      pr.product_name as perk_product_name,
      pr.quantity as perk_quantity,
      jsonb_build_array(jsonb_build_object(
        'step_order', 1,
        'required_level', 1,
        'position_level', null,
        'level', 1,
        'approver_level', 1,
        'status', pr.status,
        'acted_at', pr.approved_at,
        'approved_at', pr.approved_at,
        'remarks', null,
        'skipped_reason', null,
        'approver_name', 'Email code verified',
        'approver_position_name', null,
        'approver_employee_no', null
      )) as approval_summary,
      null::numeric as original_total_hours,
      null::text as hours_adjustment_reason,
      ea.company_id as _filter_cid
    from public.employee_perk_requests pr
    left join public.user_profiles up on up.id = pr.submitted_by_user_id
    left join public.employees e on e.id = coalesce(pr.submitted_by_employee_id, up.employee_id)
    left join lateral (
      select ea.department_id, ea.company_id, ea.store_id, ea.position_id
      from public.employee_assignments ea
      where ea.employee_id = coalesce(e.id, pr.submitted_by_employee_id, up.employee_id)
      order by
        case when ea.is_primary = true then 0 else 1 end,
        case when ea.effective_to is null or ea.effective_to >= current_date then 0 else 1 end,
        ea.effective_from desc,
        ea.created_at desc
      limit 1
    ) ea on true
    left join public.departments d on d.id = ea.department_id
    left join public.positions p on p.id = ea.position_id
    left join public.companies c on c.id = ea.company_id
    left join public.stores s on s.id = ea.store_id
  )
  select
    ar.request_id, ar.request_type_code, ar.request_type_name, ar.status,
    ar.submitted_at, ar.final_approved_at, ar.rejected_at, ar.rejected_reason,
    ar.employee_id, ar.employee_no, ar.employee_name, ar.employee_photo,
    ar.department_name, ar.position_name, ar.company_name, ar.store_name,
    ar.date_from, ar.date_to, ar.time_from, ar.time_to,
    ar.time_schedule, ar.day_off, ar.payroll_class, ar.transaction_type, ar.total_hours,
    ar.leave_type, ar.leave_category, ar.start_date, ar.end_date,
    ar.total_days, ar.paid_days, ar.unpaid_days, ar.reason,
    ar.perk_approval_code, ar.perk_amount, ar.perk_discount_amount, ar.perk_final_amount,
    ar.perk_benefit, ar.perk_product_name, ar.perk_quantity,
    ar.approval_summary,
    ar.original_total_hours, ar.hours_adjustment_reason
  from all_requests_raw ar
  where (
    v_user_role is null
    or v_user_role <> 'hr'
    or not exists (
      select 1
      from public.hr_company_assignments
      where user_profile_id = v_user_profile_id
    )
    or ar._filter_cid in (
      select company_id
      from public.hr_company_assignments
      where user_profile_id = v_user_profile_id
    )
    or ar._filter_cid is null
  )
  order by ar.submitted_at desc nulls last;
end;
$$;

grant execute on function public.admin_get_all_requests() to authenticated, anon, service_role;
