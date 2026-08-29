import { supabase } from '../lib/supabase';
import { getCacheJSON, removeCacheItem, setCacheJSON } from '../lib/localCache';

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

import { isAutoApprovedBirthdayGrant } from './birthdayLeave';

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

  let items = (data ?? []) as MyRequest[];
  const cached = await getCacheJSON<MyRequest[]>(cacheKey);

  // Preserve any locally auto-approved Birthday Leave grants that aren't returned by RPC yet
  if (cached && cached.length) {
    const localBdayGrants = cached.filter(
      (item) => isAutoApprovedBirthdayGrant(item) && item.status === 'approved',
    );
    for (const bdayItem of localBdayGrants) {
      const existsInServer = items.some(
        (serverItem) =>
          serverItem.request_id === bdayItem.request_id ||
          (isAutoApprovedBirthdayGrant(serverItem) &&
            serverItem.start_date &&
            bdayItem.start_date &&
            new Date(serverItem.start_date).getFullYear() === new Date(bdayItem.start_date).getFullYear()),
      );
      if (!existsInServer) {
        items = [bdayItem, ...items];
      }
    }
  }

  await setCacheJSON(cacheKey, items);
  return items;
}

export async function loadMyRequestsCached() {
  const cacheKey = 'my_requests_v1';
  return (await getCacheJSON<MyRequest[]>(cacheKey)) ?? [];
}

export type UpdatePendingRequestParams = {
  requestId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  totalHours?: number | null;
  timeSchedule?: string | null;
  dayOff?: string | null;
  payrollClass?: string | null;
  transactionType?: string | null;
  leaveType?: string | null;
  leaveCategory?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalDays?: number | null;
  paidDays?: number | null;
  unpaidDays?: number | null;
  reason?: string | null;
};

import { checkApproverActiveViewing } from './requestViewerLock';

export async function updateMyPendingRequest(params: UpdatePendingRequestParams) {
  const targetId = params.requestId;
  if (!targetId) {
    throw new Error('Missing Request ID.');
  }

  // Active Viewing Lock Pre-check
  const lockInfo = await checkApproverActiveViewing(targetId);
  if (lockInfo.isLocked) {
    throw new Error(
      `This request is currently being reviewed by your manager/approver (${lockInfo.approverName || 'Manager'}). Editing is temporarily disabled while they are viewing it to prevent data conflicts. Please try again in a few moments.`,
    );
  }

  let rpcSuccess = false;
  try {
    const rpcPromise = supabase.rpc('update_my_pending_request', {
      p_request_id: targetId,
      p_date_from: params.dateFrom || null,
      p_date_to: params.dateTo || null,
      p_time_from: params.timeFrom || null,
      p_time_to: params.timeTo || null,
      p_total_hours: params.totalHours ?? null,
      p_time_schedule: params.timeSchedule || null,
      p_day_off: params.dayOff || null,
      p_payroll_class: params.payrollClass || null,
      p_transaction_type: params.transactionType || null,
      p_leave_type: params.leaveType || null,
      p_leave_category: params.leaveCategory || null,
      p_start_date: params.startDate || null,
      p_end_date: params.endDate || null,
      p_total_days: params.totalDays ?? null,
      p_paid_days: params.paidDays ?? null,
      p_unpaid_days: params.unpaidDays ?? null,
      p_reason: params.reason || null,
    });

    const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('RPC_TIMEOUT') }), 2000),
    );

    const { error } = await Promise.race([rpcPromise, timeoutPromise]);
    if (!error) {
      rpcSuccess = true;
    }
  } catch {
    rpcSuccess = false;
  }

  if (rpcSuccess) {
    try {
      await removeCacheItem('my_requests_v1');
    } catch {
      // ignore
    }
    return;
  }

  // Fallback: update tables directly or via admin_update_request_data RPC
  let fallbackError: string | null = null;

  // Always update main requests table (reason, total_hours, total_days, date_from, date_to)
  const { error: mainReqErr } = await supabase
    .from('requests')
    .update({
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.totalHours !== undefined && params.totalHours !== null ? { total_hours: params.totalHours } : {}),
      ...(params.totalDays !== undefined && params.totalDays !== null ? { total_days: params.totalDays } : {}),
      ...(params.dateFrom ? { date_from: params.dateFrom } : {}),
      ...(params.dateTo ? { date_to: params.dateTo } : {}),
      ...(params.startDate ? { date_from: params.startDate } : {}),
      ...(params.endDate ? { date_to: params.endDate } : {}),
    })
    .eq('id', targetId);

  if (mainReqErr) {
    fallbackError = mainReqErr.message;
  }

  // Try updating time_request_details directly for ESARF
  if (params.dateFrom || params.timeFrom || params.transactionType || params.timeSchedule) {
    const { error: timeErr } = await supabase
      .from('time_request_details')
      .update({
        ...(params.dateFrom ? { date_from: params.dateFrom } : {}),
        ...(params.dateTo ? { date_to: params.dateTo } : {}),
        ...(params.timeFrom ? { time_from: params.timeFrom } : {}),
        ...(params.timeTo ? { time_to: params.timeTo } : {}),
        ...(params.totalHours !== undefined && params.totalHours !== null ? { total_hours: params.totalHours } : {}),
        ...(params.timeSchedule ? { time_schedule: params.timeSchedule } : {}),
        ...(params.dayOff ? { day_off: params.dayOff } : {}),
        ...(params.payrollClass ? { payroll_class: params.payrollClass } : {}),
        ...(params.transactionType ? { transaction_type: params.transactionType } : {}),
        ...(params.reason ? { reason: params.reason } : {}),
      })
      .eq('request_id', targetId);

    if (timeErr) {
      fallbackError = timeErr.message;
    }
  }

  // Try updating leave_request_details directly for Leave
  if (params.leaveType || params.startDate) {
    const { error: leaveErr } = await supabase
      .from('leave_request_details')
      .update({
        ...(params.leaveType ? { leave_type: params.leaveType } : {}),
        ...(params.leaveCategory ? { leave_category: params.leaveCategory } : {}),
        ...(params.startDate ? { start_date: params.startDate } : {}),
        ...(params.endDate ? { end_date: params.endDate } : {}),
        ...(params.totalDays !== undefined && params.totalDays !== null ? { total_days: params.totalDays } : {}),
        ...(params.paidDays !== undefined && params.paidDays !== null ? { paid_days: params.paidDays } : {}),
        ...(params.unpaidDays !== undefined && params.unpaidDays !== null ? { unpaid_days: params.unpaidDays } : {}),
        ...(params.reason ? { reason: params.reason } : {}),
      })
      .eq('request_id', targetId);

    if (leaveErr) {
      fallbackError = leaveErr.message;
    }
  }

  // Fallback to admin_update_request_data RPC if table update failed or was blocked by RLS
  if (fallbackError) {
    const { error: adminErr } = await supabase.rpc('admin_update_request_data', {
      p_request_id: targetId,
      p_is_perk: false,
      p_date_from: params.dateFrom || null,
      p_date_to: params.dateTo || null,
      p_time_from: params.timeFrom || null,
      p_time_to: params.timeTo || null,
      p_total_hours: params.totalHours ?? null,
      p_leave_type: params.leaveType || null,
      p_leave_category: params.leaveCategory || null,
      p_start_date: params.startDate || null,
      p_end_date: params.endDate || null,
      p_total_days: params.totalDays ?? null,
      p_reason: params.reason || null,
    });

    if (adminErr) {
      throw new Error(fallbackError || adminErr.message);
    }
  }

  try {
    await removeCacheItem('my_requests_v1');
  } catch {
    // ignore
  }
}
