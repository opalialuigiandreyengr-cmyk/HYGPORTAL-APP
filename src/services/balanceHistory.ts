import { ensureFreshSession, supabase } from '../lib/supabase';

export type BalanceHistoryItem = {
  id: string;
  type: 'offset' | 'leave';
  category: 'earn' | 'use' | 'refund' | 'grant' | 'adjustment';
  title: string;
  subtitle?: string;
  amount: number; // e.g. +4 or -2
  unit: 'h' | 'd';
  balanceAfter?: number | null;
  date: string; // ISO string
  status?: string | null;
  requestId?: string | null;
  reason?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

async function resolveEmployeeId(userId?: string, employeeId?: string): Promise<string | undefined> {
  if (employeeId) return employeeId;
  const currentUserId = userId || (await supabase.auth.getSession()).data.session?.user?.id;
  if (!currentUserId) return undefined;
  const { data } = await supabase
    .from('user_profiles')
    .select('employee_id')
    .eq('auth_user_id', currentUserId)
    .maybeSingle<{ employee_id: string | null }>();
  return data?.employee_id ?? undefined;
}

function parseEarnedOffsetHoursFromReason(reason?: string | null, fallbackHours: number = 0): number {
  if (!reason || !reason.includes('[Entry')) {
    return fallbackHours;
  }
  const blocks = reason.split(/(?=\[Entry\s+\d+\])/i);
  let totalEarned = 0;
  let hasValidMatch = false;

  for (const block of blocks) {
    if (!block.trim().startsWith('[Entry')) continue;
    const match = block.match(/\[Entry\s+\d+\]\s*\(([^)]+)\).*?\(([0-9.]+)\s*hrs?\)/i);
    if (match) {
      hasValidMatch = true;
      const entryType = match[1].toLowerCase().trim();
      const hrs = parseFloat(match[2]) || 0;
      const isRejected = block.toLowerCase().includes('[rejected]');

      if (entryType.includes('offset') && !entryType.includes('use') && !isRejected) {
        totalEarned += hrs;
      }
    }
  }

  return hasValidMatch ? Number(totalEarned.toFixed(2)) : fallbackHours;
}

export async function fetchOffsetHistory(userId?: string, employeeId?: string): Promise<BalanceHistoryItem[]> {
  await ensureFreshSession().catch(() => {});
  const empId = await resolveEmployeeId(userId, employeeId);
  if (!empId) return [];

  const itemsMap = new Map<string, BalanceHistoryItem>();

  // 1. Try RPC get_my_offset_history
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_offset_history');
    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      rpcData.forEach((row: any) => {
        const rawAmount = Number(row.hours ?? 0);
        const category = (row.category as BalanceHistoryItem['category']) || (rawAmount < 0 ? 'use' : 'earn');
        let finalAmount = rawAmount;
        if (category === 'earn' && row.reason) {
          finalAmount = parseEarnedOffsetHoursFromReason(row.reason, Math.abs(rawAmount));
        }

        const key = row.request_id ? String(row.request_id) : String(row.id);
        itemsMap.set(key, {
          id: String(row.id ?? Math.random()),
          type: 'offset',
          category,
          title: row.title || (finalAmount < 0 ? 'Offset Deducted' : 'Offset Earned'),
          subtitle: row.subtitle || 'Offset transaction',
          amount: finalAmount,
          unit: 'h',
          balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
          date: row.created_at || new Date().toISOString(),
          status: row.request_status || 'approved',
          requestId: row.request_id || null,
          reason: row.reason || null,
          dateFrom: row.date_from || null,
          dateTo: row.date_to || null,
        });
      });
    }
  } catch {
    // Fall back to direct table queries below
  }

  // 2. Direct table query on offset_transactions
  try {
    const { data: otRows } = await supabase
      .from('offset_transactions')
      .select('id, employee_id, request_id, transaction_type, hours, balance_after, created_at')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false });

    if (otRows && otRows.length > 0) {
      const requestIds = otRows.map((r) => r.request_id).filter(Boolean) as string[];
      let requestMap: Record<string, { status?: string; reason?: string; transaction_type?: string; date_from?: string; date_to?: string }> = {};

      if (requestIds.length > 0) {
        try {
          const [reqRes, timeRes] = await Promise.all([
            supabase.from('requests').select('id, status, rejected_reason').in('id', requestIds),
            supabase.from('time_request_details').select('request_id, reason, transaction_type, date_from, date_to').in('request_id', requestIds),
          ]);
          if (reqRes.data) {
            reqRes.data.forEach((r: any) => {
              requestMap[r.id] = { ...requestMap[r.id], status: r.status, reason: r.rejected_reason };
            });
          }
          if (timeRes.data) {
            timeRes.data.forEach((t: any) => {
              requestMap[t.request_id] = {
                ...requestMap[t.request_id],
                reason: t.reason || requestMap[t.request_id]?.reason,
                transaction_type: t.transaction_type,
                date_from: t.date_from,
                date_to: t.date_to,
              };
            });
          }
        } catch {
          // ignore
        }
      }

      otRows.forEach((row) => {
        const key = row.request_id ? String(row.request_id) : String(row.id);
        if (itemsMap.has(key)) return;

        const reqDetail = row.request_id ? requestMap[row.request_id] : null;
        const txType = (row.transaction_type ?? '').toLowerCase();
        const isUse = txType === 'use';
        const isRefund = txType === 'adjustment' || txType === 'refund';
        const rawHours = Number(row.hours ?? 0);

        let title = 'Offset Earned';
        let category: BalanceHistoryItem['category'] = 'earn';
        let signedHours = Math.abs(rawHours);

        if (isUse) {
          title = 'Offset Deducted';
          category = 'use';
          signedHours = -Math.abs(rawHours);
        } else if (isRefund) {
          title = 'Offset Refunded';
          category = 'refund';
        } else {
          if (reqDetail?.reason) {
            signedHours = parseEarnedOffsetHoursFromReason(reqDetail.reason, Math.abs(rawHours));
          }
        }

        const subtitle =
          reqDetail?.transaction_type ||
          (isUse ? 'Use Offset Request' : isRefund ? 'Credited back upon rejection' : 'ESARF Offset Credit');

        itemsMap.set(key, {
          id: String(row.id ?? Math.random()),
          type: 'offset',
          category,
          title,
          subtitle,
          amount: signedHours,
          unit: 'h',
          balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
          date: row.created_at || new Date().toISOString(),
          status: reqDetail?.status || 'approved',
          requestId: row.request_id || null,
          reason: reqDetail?.reason || null,
          dateFrom: reqDetail?.date_from || null,
          dateTo: reqDetail?.date_to || null,
        });
      });
    }
  } catch {
    // ignore
  }

  // 3. Supplement with time_request_details for any missing offset requests (pending, approved, validated)
  try {
    const { data: timeReqs } = await supabase
      .from('time_request_details')
      .select('request_id, total_hours, transaction_type, reason, date_from, date_to, requests!inner(id, status, submitted_at, submitted_by_employee_id)')
      .eq('requests.submitted_by_employee_id', empId)
      .order('date_from', { ascending: false })
      .limit(50);

    if (timeReqs && timeReqs.length > 0) {
      for (const item of timeReqs) {
        const reqId = String(item.request_id);
        if (itemsMap.has(reqId)) continue;

        const txType = (item.transaction_type ?? '').toLowerCase();
        const reasonStr = (item.reason ?? '').toLowerCase();
        const isOffset = txType.includes('offset') || reasonStr.includes('offset');
        if (!isOffset) continue;

        const isUse = txType.includes('use') || reasonStr.includes('use offset') || reasonStr.includes('use_offset');
        const req = (item as any).requests;
        const rawHours = Number(item.total_hours ?? 0);

        const calculatedEarn = !isUse ? parseEarnedOffsetHoursFromReason(item.reason, rawHours) : rawHours;
        if (calculatedEarn <= 0 && isUse) continue;

        itemsMap.set(reqId, {
          id: reqId,
          type: 'offset',
          category: isUse ? 'use' : 'earn',
          title: isUse ? 'Offset Deducted' : 'Offset Earned',
          subtitle: item.transaction_type || (isUse ? 'Use Offset Request' : 'Offset ESARF'),
          amount: isUse ? -Math.abs(calculatedEarn) : Math.abs(calculatedEarn),
          unit: 'h',
          date: req?.submitted_at || item.date_from || new Date().toISOString(),
          status: req?.status || null,
          requestId: item.request_id,
          reason: item.reason || null,
          dateFrom: item.date_from || null,
          dateTo: item.date_to || null,
        });
      }
    }
  } catch {
    // ignore
  }

  const result = Array.from(itemsMap.values());
  result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return result;
}

export async function fetchLeaveHistory(userId?: string, employeeId?: string): Promise<BalanceHistoryItem[]> {
  await ensureFreshSession().catch(() => {});

  // 1. Try RPC get_my_leave_history first
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_leave_history');
    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      return rpcData.map((row: any) => ({
        id: String(row.id ?? Math.random()),
        type: 'leave',
        category: (row.category as BalanceHistoryItem['category']) || (Number(row.days ?? 0) < 0 ? 'use' : 'grant'),
        title: row.title || (Number(row.days ?? 0) < 0 ? 'Leave Deducted' : 'Leave Credit Grant'),
        subtitle: row.subtitle || 'Leave transaction',
        amount: Number(row.days ?? 0),
        unit: 'd',
        balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
        date: row.created_at || new Date().toISOString(),
        status: row.request_status || null,
        requestId: row.request_id || null,
        reason: row.reason || null,
        dateFrom: row.start_date || null,
        dateTo: row.end_date || null,
      }));
    }
  } catch {
    // Fall back to direct table queries
  }

  // 2. Direct table fallback: query leave_transactions + leave_balances
  const empId = await resolveEmployeeId(userId, employeeId);
  if (!empId) return [];

  const items: BalanceHistoryItem[] = [];

  try {
    // Fetch leave_balances to check annual granted credits
    const { data: balRow } = await supabase
      .from('leave_balances')
      .select('annual_credit_days, used_days, updated_at')
      .eq('employee_id', empId)
      .maybeSingle<{ annual_credit_days: number | null; used_days: number | null; updated_at: string | null }>();

    const annualCredit = Number(balRow?.annual_credit_days ?? 0);
    if (annualCredit > 0) {
      items.push({
        id: `initial_grant_${empId}`,
        type: 'leave',
        category: 'grant',
        title: 'Annual Leave Credits Granted',
        subtitle: 'Annual leave allocation',
        amount: annualCredit,
        unit: 'd',
        balanceAfter: annualCredit,
        date: balRow?.updated_at || new Date().toISOString(),
        status: 'approved',
        reason: 'Annual leave credit entitlement',
      });
    }

    // Query leave_transactions
    const { data: ltRows } = await supabase
      .from('leave_transactions')
      .select('id, employee_id, request_id, transaction_type, days, balance_after, created_at')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false });

    if (ltRows && ltRows.length > 0) {
      const requestIds = ltRows.map((r) => r.request_id).filter(Boolean) as string[];
      let requestMap: Record<string, { status?: string; leave_category?: string; reason?: string; start_date?: string; end_date?: string }> = {};

      if (requestIds.length > 0) {
        try {
          const [reqRes, leaveRes] = await Promise.all([
            supabase.from('requests').select('id, status, rejected_reason').in('id', requestIds),
            supabase.from('leave_request_details').select('request_id, leave_category, leave_type, reason, start_date, end_date').in('request_id', requestIds),
          ]);
          if (reqRes.data) {
            reqRes.data.forEach((r: any) => {
              requestMap[r.id] = { ...requestMap[r.id], status: r.status, reason: r.rejected_reason };
            });
          }
          if (leaveRes.data) {
            leaveRes.data.forEach((l: any) => {
              requestMap[l.request_id] = {
                ...requestMap[l.request_id],
                leave_category: l.leave_category,
                reason: l.reason || requestMap[l.request_id]?.reason,
                start_date: l.start_date,
                end_date: l.end_date,
              };
            });
          }
        } catch {
          // ignore enrichment failure
        }
      }

      ltRows.forEach((row) => {
        const reqDetail = row.request_id ? requestMap[row.request_id] : null;
        const txType = (row.transaction_type ?? '').toLowerCase();
        const isUse = txType === 'use_paid' || txType === 'use';
        const rawDays = Number(row.days ?? 0);
        const signedDays = isUse ? -Math.abs(rawDays) : Math.abs(rawDays);

        items.push({
          id: String(row.id ?? Math.random()),
          type: 'leave',
          category: isUse ? 'use' : 'grant',
          title: reqDetail?.leave_category ? `${reqDetail.leave_category} (Paid)` : isUse ? 'Leave Deducted' : 'Credit Grant',
          subtitle: isUse ? 'Approved paid leave' : 'Credit adjustment',
          amount: signedDays,
          unit: 'd',
          balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
          date: row.created_at || new Date().toISOString(),
          status: reqDetail?.status || 'approved',
          requestId: row.request_id || null,
          reason: reqDetail?.reason || null,
          dateFrom: reqDetail?.start_date || null,
          dateTo: reqDetail?.end_date || null,
        });
      });
    } else {
      // Fallback: Check approved leave requests with paid days
      const { data: leaveReqs } = await supabase
        .from('leave_request_details')
        .select('request_id, paid_days, leave_category, leave_type, reason, start_date, end_date, requests!inner(id, status, submitted_at, submitted_by_employee_id)')
        .eq('requests.submitted_by_employee_id', empId)
        .eq('requests.status', 'approved')
        .gt('paid_days', 0)
        .order('start_date', { ascending: false })
        .limit(20);

      if (leaveReqs && leaveReqs.length > 0) {
        leaveReqs.forEach((item: any) => {
          const days = Number(item.paid_days ?? 0);
          items.push({
            id: String(item.request_id),
            type: 'leave',
            category: 'use',
            title: item.leave_category ? `${item.leave_category} (Paid)` : 'Leave Deducted',
            subtitle: 'Approved paid leave',
            amount: -Math.abs(days),
            unit: 'd',
            date: item.requests?.submitted_at || item.start_date || new Date().toISOString(),
            status: item.requests?.status || 'approved',
            requestId: item.request_id,
            reason: item.reason || null,
            dateFrom: item.start_date || null,
            dateTo: item.end_date || null,
          });
        });
      }
    }

    // Sort all by date descending
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  } catch {
    // ignore
  }

  return items;
}
