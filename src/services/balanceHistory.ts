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
  expiresAt?: string | null;
  remainingAmount?: number | null;
  remainingDays?: number | null;
  expiryProgress?: number | null;
};

const OFFSET_VALIDITY_DAYS = 90;

function addOffsetExpiryAndFifo(items: BalanceHistoryItem[]): BalanceHistoryItem[] {
  const now = Date.now();
  const lots = items
    .filter((item) => item.type === 'offset' && item.amount > 0 && item.category !== 'use')
    .map((item) => {
      const earnedAt = new Date(item.date).getTime();
      const expiresAt = new Date(earnedAt + OFFSET_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
      return {
        item,
        earnedAt,
        expiresAt,
        remaining: item.amount,
      };
    })
    .sort((a, b) => a.earnedAt - b.earnedAt || a.item.id.localeCompare(b.item.id));

  // Consume the oldest valid credit first (FIFO). Expired lots are not available
  // for newer deductions, but remain visible in history with zero balance.
  [...items]
    .filter((item) => item.category === 'use' && item.amount < 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((deduction) => {
      let remainingToConsume = Math.abs(deduction.amount);
      const usedAt = new Date(deduction.date).getTime();

      for (const lot of lots) {
        if (remainingToConsume <= 0) break;
        if (lot.remaining <= 0 || lot.expiresAt.getTime() <= usedAt || lot.earnedAt > usedAt) continue;

        const consumed = Math.min(lot.remaining, remainingToConsume);
        lot.remaining -= consumed;
        remainingToConsume -= consumed;
      }
    });

  const lotById = new Map(lots.map((lot) => [lot.item.id, lot]));
  return items.map((item) => {
    const lot = lotById.get(item.id);
    if (!lot) return item;

    const expiresAtMs = lot.expiresAt.getTime();
    const remainingDays = Math.max(0, Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000)));
    const elapsedProgress = Math.min(
      1,
      Math.max(0, (now - lot.earnedAt) / (OFFSET_VALIDITY_DAYS * 24 * 60 * 60 * 1000)),
    );

    return {
      ...item,
      expiresAt: lot.expiresAt.toISOString(),
      remainingAmount: Number(Math.max(0, lot.remaining).toFixed(2)),
      remainingDays,
      expiryProgress: elapsedProgress,
    };
  });
}

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

  // 1. Try RPC get_my_offset_history first
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_offset_history');
    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      // Check for unlinked rows (no request_id) which could be admin adjustments
      const unlinkedIds = rpcData.filter((r: any) => !r.request_id).map((r: any) => String(r.id));
      let rawHoursMap: Record<string, { hours: number; txType: string }> = {};

      if (unlinkedIds.length > 0) {
        try {
          const { data: rawRows } = await supabase
            .from('offset_transactions')
            .select('id, hours, transaction_type')
            .in('id', unlinkedIds);
          if (rawRows) {
            rawRows.forEach((rr: any) => {
              rawHoursMap[String(rr.id)] = {
                hours: Number(rr.hours ?? 0),
                txType: (rr.transaction_type ?? '').toLowerCase(),
              };
            });
          }
        } catch {
          // ignore enrichment failure
        }
      }

      rpcData.forEach((row: any) => {
        const rawInfo = rawHoursMap[String(row.id)];
        const rawHours = rawInfo !== undefined ? rawInfo.hours : Number(row.hours ?? 0);
        const txType = (rawInfo?.txType || row.transaction_type || '').toLowerCase();
        const hasRequestId = Boolean(row.request_id);

        let category: BalanceHistoryItem['category'] = (row.category as BalanceHistoryItem['category']) || 'adjustment';
        let title = row.title || 'Offset Transaction';
        let subtitle = row.subtitle || 'Offset transaction';
        let amount = Number(row.hours ?? 0);

        if (!hasRequestId) {
          // Admin adjustment: determine if deduction or credit
          if (rawHours < 0 || txType === 'deduct' || txType === 'deduction' || title.toLowerCase().includes('deduct')) {
            category = 'use';
            title = 'Offset Deducted';
            subtitle = 'Admin deduction';
            amount = -Math.abs(rawHours);
          } else {
            category = 'earn';
            title = 'Offset Added';
            subtitle = 'Admin credit adjustment';
            amount = Math.abs(rawHours);
          }
        } else {
          // Request-linked transaction
          if (category === 'use' || txType === 'use' || amount < 0) {
            category = 'use';
            title = 'Offset Deducted';
            subtitle = subtitle || 'Use Offset Request';
            amount = -Math.abs(amount);
          } else if (category === 'refund' || txType === 'adjustment' || txType === 'refund') {
            category = 'refund';
            title = 'Offset Refunded';
            subtitle = subtitle || 'Credited back (Rejected request)';
            amount = Math.abs(amount);
          } else {
            category = 'earn';
            title = 'Offset Earned';
            subtitle = subtitle || 'ESARF Offset Credit';
            amount = Math.abs(amount);
            if (row.reason) {
              amount = parseEarnedOffsetHoursFromReason(row.reason, amount);
            }
          }
        }

        const key = row.request_id ? String(row.request_id) : String(row.id);
        itemsMap.set(key, {
          id: String(row.id ?? Math.random()),
          type: 'offset',
          category,
          title,
          subtitle,
          amount,
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
        const hasRequestId = Boolean(row.request_id);
        const rawHours = Number(row.hours ?? 0);

        let title = 'Offset Earned';
        let subtitle = 'Offset transaction';
        let category: BalanceHistoryItem['category'] = 'earn';
        let signedHours = rawHours;

        if (!hasRequestId) {
          // Admin adjustment
          if (rawHours < 0 || txType === 'deduct' || txType === 'deduction') {
            title = 'Offset Deducted';
            subtitle = 'Admin deduction';
            category = 'use';
            signedHours = -Math.abs(rawHours);
          } else {
            title = 'Offset Added';
            subtitle = 'Admin credit adjustment';
            category = 'earn';
            signedHours = Math.abs(rawHours);
          }
        } else {
          // Request-linked transaction
          const isUse = txType === 'use' || (txType.includes('use') && rawHours < 0);
          const isRefund = txType === 'adjustment' || txType === 'refund';
          if (isUse) {
            title = 'Offset Deducted';
            subtitle = reqDetail?.transaction_type || 'Use Offset Request';
            category = 'use';
            signedHours = -Math.abs(rawHours);
          } else if (isRefund) {
            title = 'Offset Refunded';
            subtitle = 'Credited back upon rejection';
            category = 'refund';
            signedHours = Math.abs(rawHours);
          } else {
            title = 'Offset Earned';
            subtitle = reqDetail?.transaction_type || 'ESARF Offset Credit';
            category = 'earn';
            signedHours = Math.abs(rawHours);
            if (reqDetail?.reason) {
              signedHours = parseEarnedOffsetHoursFromReason(reqDetail.reason, Math.abs(rawHours));
            }
          }
        }

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
  return addOffsetExpiryAndFifo(result);
}

export async function fetchLeaveHistory(userId?: string, employeeId?: string): Promise<BalanceHistoryItem[]> {
  await ensureFreshSession().catch(() => {});

  // 1. Try RPC get_my_leave_history first
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_leave_history');
    if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
      return rpcData.map((row: any) => {
        const rawDays = Number(row.days ?? 0);
        const txType = (row.transaction_type ?? '').toLowerCase();
        const titleLower = (row.title ?? '').toLowerCase();
        const hasRequestId = Boolean(row.request_id);

        const isDeduction =
          rawDays < 0 ||
          row.category === 'use' ||
          titleLower.includes('deduct') ||
          txType === 'deduct' ||
          txType === 'deduction' ||
          txType === 'use_paid';

        const isReimburse =
          row.category === 'refund' ||
          txType === 'reimburse' ||
          titleLower.includes('reimburse');

        const isGrant =
          row.category === 'grant' ||
          ['grant', 'credit', 'set_credits', 'annual_credit'].includes(txType) ||
          titleLower.includes('grant') ||
          titleLower.includes('allocation');

        let category: BalanceHistoryItem['category'] = isDeduction ? 'use' : isReimburse ? 'refund' : isGrant ? 'grant' : 'adjustment';
        let title = row.title;
        let subtitle = row.subtitle;

        if (isDeduction) {
          category = 'use';
          title = title || 'Leave Deducted';
          subtitle = subtitle || (!hasRequestId ? 'Admin deduction' : 'Approved paid leave');
        } else if (isReimburse) {
          category = 'refund';
          title = title || 'Credit Reimbursed';
          subtitle = subtitle || (!hasRequestId ? 'Admin reimbursement' : 'Credits reimbursed');
        } else if (isGrant) {
          category = 'grant';
          title = title || 'Annual Leave Credits Granted';
          subtitle = subtitle || 'Annual leave allocation';
        }

        return {
          id: String(row.id ?? Math.random()),
          type: 'leave',
          category,
          title,
          subtitle,
          amount: isDeduction ? -Math.abs(rawDays) : Math.abs(rawDays),
          unit: 'd',
          balanceAfter: row.balance_after !== null && row.balance_after !== undefined ? Number(row.balance_after) : null,
          date: row.created_at || new Date().toISOString(),
          status: row.request_status || null,
          requestId: row.request_id || null,
          reason: row.reason || null,
          dateFrom: row.start_date || null,
          dateTo: row.end_date || null,
        };
      });
    }
  } catch {
    // Fall back to direct table queries
  }

  // 2. Direct table fallback: query leave_transactions + leave_balances + audit_logs
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
        const hasRequestId = Boolean(row.request_id);
        const rawDays = Number(row.days ?? 0);

        const isDeduction =
          rawDays < 0 ||
          txType === 'use_paid' ||
          txType === 'use' ||
          txType === 'deduct' ||
          txType === 'deduction';

        const isReimburse = txType === 'reimburse' || txType === 'refund';

        let category: BalanceHistoryItem['category'] = isDeduction ? 'use' : isReimburse ? 'refund' : 'grant';
        let title = 'Leave Transaction';
        let subtitle = 'Leave transaction';
        let signedDays = isDeduction ? -Math.abs(rawDays) : Math.abs(rawDays);

        if (isDeduction) {
          title = reqDetail?.leave_category ? `${reqDetail.leave_category} (Paid)` : 'Leave Deducted';
          subtitle = reqDetail?.leave_category ? 'Approved paid leave' : (hasRequestId ? 'Approved paid leave' : 'Admin deduction');
        } else if (isReimburse) {
          title = 'Credit Reimbursed';
          subtitle = hasRequestId ? 'Credits reimbursed' : 'Admin reimbursement';
        } else {
          title = 'Annual Leave Credits Granted';
          subtitle = hasRequestId ? 'Leave credit entitlement' : 'Admin credit allocation';
        }

        items.push({
          id: String(row.id ?? Math.random()),
          type: 'leave',
          category,
          title,
          subtitle,
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

    // Also check audit_logs for any admin leave actions
    try {
      const { data: auditRows } = await supabase
        .from('audit_logs')
        .select('id, action, metadata, created_at')
        .in('action', ['deduct_leave_credits', 'reimburse_leave_credits', 'set_leave_credits'])
        .contains('metadata', { employee_id: empId })
        .order('created_at', { ascending: false });

      if (auditRows && auditRows.length > 0) {
        auditRows.forEach((al: any) => {
          const alTime = new Date(al.created_at).getTime();
          const alreadyExists = items.some(
            (it) => Math.abs(new Date(it.date).getTime() - alTime) < 5000
          );
          if (alreadyExists) return;

          const meta = al.metadata || {};
          if (al.action === 'deduct_leave_credits') {
            const deductDays = Number(meta.deduct_days ?? 0);
            if (deductDays > 0) {
              items.push({
                id: String(al.id),
                type: 'leave',
                category: 'use',
                title: 'Leave Deducted',
                subtitle: meta.reason || 'Admin deduction',
                amount: -Math.abs(deductDays),
                unit: 'd',
                date: al.created_at,
                status: 'approved',
                reason: meta.reason || null,
              });
            }
          } else if (al.action === 'reimburse_leave_credits') {
            const reimburseDays = Number(meta.reimburse_days ?? 0);
            if (reimburseDays > 0) {
              items.push({
                id: String(al.id),
                type: 'leave',
                category: 'refund',
                title: 'Credit Reimbursed',
                subtitle: meta.reason || 'Admin reimbursement',
                amount: Math.abs(reimburseDays),
                unit: 'd',
                date: al.created_at,
                status: 'approved',
                reason: meta.reason || null,
              });
            }
          }
        });
      }
    } catch {
      // ignore
    }

    // Sort all by date descending
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  } catch {
    // ignore
  }

  return items;
}
