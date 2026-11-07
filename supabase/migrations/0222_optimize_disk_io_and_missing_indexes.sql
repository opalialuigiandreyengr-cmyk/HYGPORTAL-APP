-- ============================================================================
-- Migration 0222: Optimize Disk IO, Missing Foreign Key Indexes & Query Performance
--
-- Problem:
-- Supabase project reports: "Your project is about to deplete its Disk IO Budget"
-- Root cause:
-- 1. High-frequency queries (admin_get_all_requests, get_my_requests, get_my_dashboard_summary,
--    and table queries from client apps) lacked indexes on foreign keys, join conditions,
--    and filter columns.
-- 2. PostgreSQL was performing full sequential table scans (Seq Scan) across large tables
--    (requests, request_approval_steps, time_request_details, employee_assignments, etc.),
--    saturating AWS EBS Disk IOPS and throughput budget.
--
-- Solution:
-- Add targeted B-Tree indexes on foreign keys, composite filters, and sorting columns.
-- ============================================================================

-- 1. Requests Table Indexes
create index if not exists idx_requests_submitted_by_emp_status
  on public.requests (submitted_by_employee_id, status);

create index if not exists idx_requests_status
  on public.requests (status);

create index if not exists idx_requests_submitted_at_desc
  on public.requests (submitted_at desc);

create index if not exists idx_requests_request_type_id
  on public.requests (request_type_id);

create index if not exists idx_requests_final_approved_at
  on public.requests (final_approved_at)
  where final_approved_at is not null;

-- 2. Request Approval Steps Table Indexes
create index if not exists idx_request_approval_steps_req_step
  on public.request_approval_steps (request_id, step_order);

create index if not exists idx_request_approval_steps_assigned_approver_status
  on public.request_approval_steps (assigned_approver_employee_id, status);

create index if not exists idx_request_approval_steps_assigned_user
  on public.request_approval_steps (assigned_approver_user_id);

create index if not exists idx_request_approval_steps_status
  on public.request_approval_steps (status);

-- 3. Detail Tables Indexes (Foreign Key: request_id)
create index if not exists idx_time_request_details_request_id
  on public.time_request_details (request_id);

create index if not exists idx_leave_request_details_request_id
  on public.leave_request_details (request_id);

create index if not exists idx_travel_order_request_details_request_id
  on public.travel_order_request_details (request_id);

-- 4. Employee Assignments Indexes (High-frequency joins across all queries)
create index if not exists idx_employee_assignments_emp_primary
  on public.employee_assignments (employee_id, is_primary);

create index if not exists idx_employee_assignments_store_id
  on public.employee_assignments (store_id);

create index if not exists idx_employee_assignments_dept_id
  on public.employee_assignments (department_id);

create index if not exists idx_employee_assignments_pos_id
  on public.employee_assignments (position_id);

create index if not exists idx_employee_assignments_comp_id
  on public.employee_assignments (company_id);

create index if not exists idx_employee_assignments_effective
  on public.employee_assignments (effective_from, effective_to);

-- 5. User Profiles Indexes
create index if not exists idx_user_profiles_auth_user_id
  on public.user_profiles (auth_user_id);

create index if not exists idx_user_profiles_employee_id
  on public.user_profiles (employee_id);

create index if not exists idx_user_profiles_auth_active_role
  on public.user_profiles (auth_user_id, is_active, app_role);

-- 6. Employees Table Indexes
create index if not exists idx_employees_employee_no
  on public.employees (employee_no);

create index if not exists idx_employees_employment_status
  on public.employees (employment_status);

-- 7. Notifications Table Indexes
create index if not exists idx_notifications_user_profile_unread
  on public.notifications (user_profile_id, is_read, created_at desc);

create index if not exists idx_notifications_emp_unread
  on public.notifications (employee_id, is_read, created_at desc);

create index if not exists idx_notifications_created_at_desc
  on public.notifications (created_at desc);

-- 8. Approval Level Routes & Stores
create index if not exists idx_approval_level_routes_dept_req
  on public.approval_level_routes (department_id, requester_level, step_order);

create index if not exists idx_stores_cluster_area
  on public.stores (cluster_id, area_id);

create index if not exists idx_stores_company_id
  on public.stores (company_id);

-- 9. Employee Perk Requests
create index if not exists idx_employee_perk_requests_emp_status
  on public.employee_perk_requests (submitted_by_employee_id, status);

-- 10. Optimized get_my_dashboard_summary returning all dashboard metrics in a single indexed query
drop function if exists public.get_my_dashboard_summary();

create or replace function public.get_my_dashboard_summary()
returns table (
  pending_requests bigint,
  pending_approvals bigint,
  offset_balance numeric,
  leave_credit_remaining numeric,
  annual_credit_days numeric,
  used_days numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_pending_requests bigint := 0;
  v_pending_approvals bigint := 0;
  v_offset_balance numeric := 0;
  v_leave_credit_remaining numeric := 0;
  v_annual_credit_days numeric := 0;
  v_used_days numeric := 0;
begin
  select employee_id into v_employee_id
  from public.user_profiles
  where auth_user_id = auth.uid()
  limit 1;

  if v_employee_id is not null then
    -- Uses idx_requests_submitted_by_emp_status
    select count(*) into v_pending_requests
    from public.requests r
    where r.submitted_by_employee_id = v_employee_id
      and r.status in ('pending', 'pre_approved', 'submitted', 'waiting');

    -- Uses idx_request_approval_steps_assigned_approver_status
    select count(*) into v_pending_approvals
    from public.request_approval_steps s
    join public.requests r on r.id = s.request_id
    where s.assigned_approver_employee_id = v_employee_id
      and s.status = 'pending'
      and r.status in ('pending', 'pre_approved', 'submitted', 'waiting');

    -- Uses unique employee_id on offset_balances
    select coalesce(ob.balance_hours, 0) into v_offset_balance
    from public.offset_balances ob
    where ob.employee_id = v_employee_id
    limit 1;

    -- Uses unique employee_id on leave_balances
    select
      coalesce(lb.annual_credit_days, 0),
      coalesce(lb.used_days, 0),
      coalesce(greatest(0, lb.annual_credit_days - coalesce(lb.used_days, 0)), 0)
    into
      v_annual_credit_days,
      v_used_days,
      v_leave_credit_remaining
    from public.leave_balances lb
    where lb.employee_id = v_employee_id
    limit 1;
  end if;

  return query
  select
    v_pending_requests,
    v_pending_approvals,
    v_offset_balance,
    v_leave_credit_remaining,
    v_annual_credit_days,
    v_used_days;
end;
$$;

grant execute on function public.get_my_dashboard_summary() to authenticated, anon, service_role;

-- Update statistics for the query planner to immediately utilize new indexes
analyze public.requests;
analyze public.request_approval_steps;
analyze public.time_request_details;
analyze public.leave_request_details;
analyze public.travel_order_request_details;
analyze public.employee_assignments;
analyze public.user_profiles;
analyze public.employees;
analyze public.leave_balances;
analyze public.offset_balances;
analyze public.notifications;
analyze public.stores;
