import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';


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
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  const cacheKey = currentUserId ? `dashboard_summary_v2_${currentUserId}` : 'dashboard_summary_v2';

  let empId = employeeId;
  if (!empId && currentUserId) {
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('employee_id')
      .eq('auth_user_id', currentUserId)
      .maybeSingle<{ employee_id: string | null }>();
    empId = userProfile?.employee_id ?? undefined;
  }

  const [rpcResult, hygPointsBalance, leaveBalanceRow] = await Promise.all([
    supabase.rpc('get_my_dashboard_summary'),
    loadHygPointsBalance(currentUserId, empId),
    empId
      ? supabase
          .from('leave_balances')
          .select('annual_credit_days, used_days')
          .eq('employee_id', empId)
          .maybeSingle<{ annual_credit_days: number | null; used_days: number | null }>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const { data, error } = rpcResult;

  if (error && !leaveBalanceRow.data) {
    const cached = await getCacheJSON<DashboardSummary>(cacheKey);
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

  const summary = {
    pending_requests: Number(first?.pending_requests ?? 0),
    pending_approvals: Number(first?.pending_approvals ?? 0),
    offset_balance: Number(first?.offset_balance ?? 0),
    leave_credit_remaining: leaveCreditRemaining,
    annual_credit_days: annualCreditDays,
    leave_used_days: leaveUsedDays,
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
