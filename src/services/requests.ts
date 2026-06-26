import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

export type RequestApprovalSummary = {
  step_order: number;
  required_level: number;
  status: string;
  acted_at: string | null;
  remarks: string | null;
  skipped_reason: string | null;
  approver_name: string | null;
  approver_position_name?: string | null;
  approver_employee_no: string | null;
};

export type MyRequest = {
  request_id: string;
  request_type_code: string;
  request_type_name: string;
  status: string;
  submitted_at: string;
  final_approved_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  date_from: string | null;
  date_to: string | null;
  time_from: string | null;
  time_to: string | null;
  time_schedule?: string | null;
  day_off?: string | null;
  payroll_class?: string | null;
  transaction_type?: string | null;
  total_hours: number | null;
  leave_type: string | null;
  leave_category: string | null;
  start_date: string | null;
  end_date: string | null;
  total_days: number | null;
  paid_days: number | null;
  unpaid_days: number | null;
  reason: string | null;
  perk_approval_code?: string | null;
  perk_amount?: number | null;
  perk_discount_amount?: number | null;
  perk_final_amount?: number | null;
  perk_benefit?: string | null;
  approval_summary: RequestApprovalSummary[];
};

export async function loadMyRequests() {
  const cacheKey = 'my_requests_v1';
  const { data, error } = await supabase.rpc('get_my_requests');

  if (error) {
    const cached = await getCacheJSON<MyRequest[]>(cacheKey);
    if (cached) {
      return cached;
    }
    throw error;
  }

  const items = (data ?? []) as MyRequest[];
  await setCacheJSON(cacheKey, items);
  return items;
}

export async function loadMyRequestsCached() {
  const cacheKey = 'my_requests_v1';
  return (await getCacheJSON<MyRequest[]>(cacheKey)) ?? [];
}
