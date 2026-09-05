import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

import { loadMyRequestsCached, type MyRequest } from './requests';

export type DashboardSummary = {
  pending_requests: number;
  pending_approvals: number;
  offset_balance: number;
  leave_credit_remaining: number;
  hyg_points_balance: number;
};

export async function loadDashboardSummary(userId?: string, employeeId?: string) {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  const cacheKey = currentUserId ? `dashboard_summary_v2_${currentUserId}` : 'dashboard_summary_v2';
  const [{ data, error }, hygPointsBalance, myRequests] = await Promise.all([
    supabase.rpc('get_my_dashboard_summary'),
    loadHygPointsBalance(currentUserId, employeeId),
    loadMyRequestsCached(),
  ]);

  if (error) {
    const cached = await getCacheJSON<DashboardSummary>(cacheKey);
    if (cached) {
      return { ...cached, hyg_points_balance: hygPointsBalance };
    }
    throw error;
  }

  const first = Array.isArray(data) ? data[0] : data;
  const rawRemaining = Number(first?.leave_credit_remaining ?? 7);

  // Birthday Leave is a company gift and must NOT deduct from standard leave credits.
  const birthdayLeaveCount = myRequests.filter(
    (req) =>
      req.leave_category === 'Birthday Leave' ||
      req.leave_category === 'Birthday Leave Grant' ||
      req.reason?.toLowerCase().includes('birthday leave'),
  ).length;

  let effectiveRemaining = rawRemaining;
  if (birthdayLeaveCount > 0 && rawRemaining < 7) {
    effectiveRemaining = Math.min(7, rawRemaining + birthdayLeaveCount);
  }

  const summary = {
    pending_requests: Number(first?.pending_requests ?? 0),
    pending_approvals: Number(first?.pending_approvals ?? 0),
    offset_balance: Number(first?.offset_balance ?? 0),
    leave_credit_remaining: effectiveRemaining,
    hyg_points_balance: hygPointsBalance,
  } satisfies DashboardSummary;

  await setCacheJSON(cacheKey, summary);
  return summary;
}

export async function loadHygPointsBalance(userId?: string, employeeId?: string): Promise<number> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return 0;
  }

  let empId = employeeId;
  if (!empId) {
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('employee_id')
      .eq('auth_user_id', currentUserId)
      .maybeSingle<{ employee_id: string | null }>();
    empId = userProfile?.employee_id ?? undefined;
  }

  let query = supabase
    .from('user_hyg_point_accounts')
    .select('balance');

  if (empId) {
    query = query.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${empId}`);
  } else {
    query = query.eq('auth_user_id', currentUserId);
  }

  const { data, error } = await query.order('updated_at', { ascending: false }).limit(1);

  if (error || !data || data.length === 0) {
    return 0;
  }

  return Number(data[0].balance ?? 0);
}
