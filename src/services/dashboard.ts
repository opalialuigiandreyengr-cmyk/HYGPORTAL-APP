import { ensureFreshSession, supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { loadMyRequestsCached } from './requests';


export type DashboardSummary = {
  pending_requests: number;
  pending_approvals: number;
  offset_balance: number;
  leave_credit_remaining: number;
  annual_credit_days: number;
  leave_used_days: number;
  hyg_points_balance: number;
};

export async function loadDashboardSummary(userId?: string, employeeId?: string) {
  await ensureFreshSession().catch(() => {});
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  const cacheKey = currentUserId ? `dashboard_summary_v2_${currentUserId}` : 'dashboard_summary_v2';

  const cached = await getCacheJSON<DashboardSummary>(cacheKey);

  if (!currentUserId && cached) {
    return cached;
  }

  let empId = employeeId;
  let rpcResult: any = { data: null, error: null };
  let hygPointsBalance = cached?.hyg_points_balance ?? 0;
  let leaveBalanceRow: any = { data: null, error: null };
  let offsetBalanceRow: any = { data: null, error: null };
  let requestsCountRow: any = { data: null, count: null, error: null };

  try {
    if (!empId && currentUserId) {
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('employee_id')
        .eq('auth_user_id', currentUserId)
        .maybeSingle<{ employee_id: string | null }>();
      empId = userProfile?.employee_id ?? undefined;
    }

    const [rpcRes, pointsBal, leaveBal, offsetBal, reqCountRes] = await Promise.all([
      supabase.rpc('get_my_dashboard_summary'),
      loadHygPointsBalance(currentUserId, empId),
      empId
        ? supabase
            .from('leave_balances')
            .select('annual_credit_days, used_days')
            .eq('employee_id', empId)
            .maybeSingle<{ annual_credit_days: number | null; used_days: number | null }>()
        : Promise.resolve({ data: null, error: null }),
      empId
        ? supabase
            .from('offset_balances')
            .select('balance_hours')
            .eq('employee_id', empId)
            .maybeSingle<{ balance_hours: number | null }>()
        : Promise.resolve({ data: null, error: null }),
      empId
        ? supabase
            .from('requests')
            .select('id', { count: 'exact', head: true })
            .eq('submitted_by_employee_id', empId)
            .in('status', ['pending', 'pre_approved', 'submitted', 'waiting'])
        : Promise.resolve({ data: null, count: null, error: null }),
    ]);

    rpcResult = rpcRes;
    hygPointsBalance = pointsBal;
    leaveBalanceRow = leaveBal;
    offsetBalanceRow = offsetBal;
    requestsCountRow = reqCountRes;
  } catch (netErr) {
    console.log('[Dashboard] Network fetch failed (offline), returning cached summary:', netErr);
    if (cached) {
      return cached;
    }
  }

  const { data, error } = rpcResult;

  if (error && !leaveBalanceRow.data && !offsetBalanceRow.data) {
    if (cached) {
      return { ...cached, hyg_points_balance: hygPointsBalance };
    }
    throw error;
  }

  const first = Array.isArray(data) ? data[0] : data;

  // Exact real-time leave balance from leave_balances table (matching admin desktop)
  let annualCreditDays = 0;
  let leaveUsedDays = 0;
  let leaveCreditRemaining = 0;

  if (leaveBalanceRow.data) {
    annualCreditDays = Number(leaveBalanceRow.data.annual_credit_days ?? 0);
    leaveUsedDays = Number(leaveBalanceRow.data.used_days ?? 0);
    leaveCreditRemaining = Math.max(0, annualCreditDays - leaveUsedDays);
  } else if (first?.leave_credit_remaining !== undefined && first?.leave_credit_remaining !== null) {
    leaveCreditRemaining = Math.max(0, Number(first.leave_credit_remaining));
    annualCreditDays = leaveCreditRemaining;
    leaveUsedDays = Math.max(0, annualCreditDays - leaveCreditRemaining);
  }

  // Exact real-time offset balance from offset_balances table
  let offsetBalance = 0;
  if (
    offsetBalanceRow.data &&
    offsetBalanceRow.data.balance_hours !== null &&
    offsetBalanceRow.data.balance_hours !== undefined
  ) {
    offsetBalance = Number(offsetBalanceRow.data.balance_hours);
  } else {
    offsetBalance = Number(first?.offset_balance ?? 0);
  }

  // Real-time pending & pre-approved requests count
  let pendingRequests = 0;
  const cachedRequests = await loadMyRequestsCached().catch(() => []);
  const offlinePendingCount = cachedRequests.filter(
    (r) =>
      r.request_id?.startsWith('offline_') ||
      (r.status || '').toLowerCase().includes('offline'),
  ).length;

  const cachedPendingAndPreApproved = cachedRequests.filter((r) => {
    const s = (r.status || '').toLowerCase().trim();
    if (s === 'approved' || s === 'validated' || s.includes('reject') || s.includes('denied') || s === 'cancelled') {
      return false;
    }
    if (r.final_approved_at && !s.includes('reject') && !s.includes('denied')) {
      return false;
    }
    return (
      s === 'pending' ||
      s.includes('pre_approved') ||
      s.includes('pre-approved') ||
      s.includes('offline') ||
      s === 'submitted' ||
      s === 'waiting'
    );
  }).length;

  if (requestsCountRow?.count !== null && requestsCountRow?.count !== undefined && !requestsCountRow?.error) {
    pendingRequests = Math.max(Number(requestsCountRow.count) + offlinePendingCount, cachedPendingAndPreApproved);
  } else if (first?.pending_requests !== undefined && first?.pending_requests !== null) {
    pendingRequests = Math.max(Number(first.pending_requests) + offlinePendingCount, cachedPendingAndPreApproved);
  } else {
    pendingRequests = cachedPendingAndPreApproved;
  }

  const summary = {
    pending_requests: pendingRequests,
    pending_approvals: Number(first?.pending_approvals ?? 0),
    offset_balance: offsetBalance,
    leave_credit_remaining: leaveCreditRemaining,
    annual_credit_days: annualCreditDays,
    leave_used_days: leaveUsedDays,
    hyg_points_balance: hygPointsBalance,
  } satisfies DashboardSummary;

  // Guard: if all values are 0, check if this is due to an unauthenticated/expired session wiping data
  if (
    cached &&
    (cached.annual_credit_days > 0 || cached.leave_credit_remaining > 0 || cached.pending_requests > 0 || cached.pending_approvals > 0) &&
    summary.annual_credit_days === 0 &&
    summary.leave_credit_remaining === 0 &&
    summary.pending_requests === 0 &&
    summary.pending_approvals === 0
  ) {
    const { data: checkSession } = await supabase.auth.getSession();
    if (!checkSession.session?.user) {
      // Session in transition or expired: retain valid cache
      return cached;
    }
  }

  await setCacheJSON(cacheKey, summary);
  return summary;
}

export async function loadHygPointsBalance(userId?: string, employeeId?: string): Promise<number> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return 0;
  }

  const pointsCacheKey = `hyg_points_balance_v1_${currentUserId}`;

  try {
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
      const cached = await getCacheJSON<number>(pointsCacheKey);
      return cached ?? 0;
    }

    const bal = Number(data[0].balance ?? 0);
    await setCacheJSON(pointsCacheKey, bal);
    return bal;
  } catch {
    const cached = await getCacheJSON<number>(pointsCacheKey);
    return cached ?? 0;
  }
}
