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

export async function loadDashboardSummary() {
  const cacheKey = 'dashboard_summary_v1';
  const [{ data, error }, hygPointsBalance, myRequests] = await Promise.all([
    supabase.rpc('get_my_dashboard_summary'),
    loadHygPointsBalance(),
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

async function loadHygPointsBalance() {
  const { data, error } = await supabase
    .from('user_hyg_point_accounts')
    .select('balance')
    .maybeSingle<{ balance: number | string | null }>();

  if (error) {
    return 0;
  }

  return Number(data?.balance ?? 0);
}
