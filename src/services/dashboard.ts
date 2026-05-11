import { supabase } from '../lib/supabase';

export type DashboardSummary = {
  pending_requests: number;
  pending_approvals: number;
  offset_balance: number;
  leave_credit_remaining: number;
};

export async function loadDashboardSummary() {
  const { data, error } = await supabase.rpc('get_my_dashboard_summary');

  if (error) {
    throw error;
  }

  const first = Array.isArray(data) ? data[0] : data;

  return {
    pending_requests: Number(first?.pending_requests ?? 0),
    pending_approvals: Number(first?.pending_approvals ?? 0),
    offset_balance: Number(first?.offset_balance ?? 0),
    leave_credit_remaining: Number(first?.leave_credit_remaining ?? 7),
  } satisfies DashboardSummary;
}
