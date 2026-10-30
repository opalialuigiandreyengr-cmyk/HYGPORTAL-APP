import { DeviceEventEmitter } from 'react-native';
import { ensureFreshSession, supabase } from '../lib/supabase';
import { getCacheJSON, removeCacheItem, setCacheJSON } from '../lib/localCache';
import { isScheduledOtRequest, hasPhotoProofAttached } from '../utils/scheduledOt';

export type RequestApprovalSummary = {
  step_order: number;
  required_level: number;
  position_level?: number | null;
  approver_level?: number | null;
  level?: number | null;
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
import { invalidateBalanceHistoryCache } from './balanceHistory';
import { isAppOnline } from './network';
import { loadPositionAuthorities } from './positions';
import { enqueueOfflineItem, getOfflineQueue, removeOfflineItem, removeRequestFromLocalCache, type OfflineQueueItem } from './offlineQueue';

let inFlightRequestsPromise: Promise<MyRequest[]> | null = null;
let lastRequestsFetchAt = 0;
const REQUESTS_CACHE_TTL_MS = 60_000; // 60 seconds freshness window

export function invalidateRequestsCache() {
  lastRequestsFetchAt = 0;
  invalidateBalanceHistoryCache();
}

DeviceEventEmitter.addListener('my_requests_updated', () => {
  lastRequestsFetchAt = 0;
  invalidateBalanceHistoryCache();
});

DeviceEventEmitter.addListener('requests_synced_online', async () => {
  try {
    invalidateRequestsCache();
    await removeCacheItem('my_requests_v1').catch(() => {});
    if (isAppOnline()) {
      await loadMyRequests(true).catch(() => {});
    }
  } catch {
    // ignore
  }
});

export async function loadMyRequests(forceRefresh = false): Promise<MyRequest[]> {
  const cacheKey = 'my_requests_v1';
  const cached = await getCacheJSON<MyRequest[]>(cacheKey);

  // When offline, immediately return cached data without attempting any network calls
  if (!isAppOnline()) {
    return cached ?? [];
  }

  // If cache is fresh and not forced, return cached data immediately (0 network calls)
  if (!forceRefresh && cached && cached.length > 0 && Date.now() - lastRequestsFetchAt < REQUESTS_CACHE_TTL_MS) {
    return cached;
  }

  // Deduplicate concurrent requests (e.g. Dashboard + RequestsTab + Realtime trigger)
  if (inFlightRequestsPromise) {
    return inFlightRequestsPromise;
  }

  inFlightRequestsPromise = (async () => {
    try {
      // Ensure session is fresh before fetching requests
      await ensureFreshSession().catch(() => {});
      loadPositionAuthorities().catch(() => {});

    const { data, error } = await supabase.rpc('get_my_requests');

    if (error) {
      if (cached && cached.length) {
        return cached;
      }
      throw error;
    }

    let items = (data ?? []) as MyRequest[];

  // Normalize request status from database
  items = items.map((req) => {
    const rawLower = (req.status || '').toLowerCase().trim();
    const reason = req.reason || '';
    const hasEventOrActivity = /event:/i.test(reason) || /activity:/i.test(reason);
    const cachedItem = cached?.find((c) => c.request_id === req.request_id);
    const wasCachedPreApproved = Boolean(
      cachedItem &&
      ((cachedItem.status || '').toLowerCase().includes('pre-approved') ||
       (cachedItem.status || '').toLowerCase().includes('pre_approved'))
    );

    const isExplicitlyPreApproved =
      rawLower.includes('pre_approved') ||
      rawLower.includes('pre-approved') ||
      /\[PreApproved\]/i.test(reason) ||
      isScheduledOtRequest(req) ||
      (wasCachedPreApproved && !hasPhotoProofAttached(req));

    // If pre-approved from Pre-approved OT/Offset screen, ensure status is marked as pre_approved
    if (isExplicitlyPreApproved && !req.final_approved_at && !rawLower.includes('reject') && !rawLower.includes('validat')) {
      return { ...req, status: 'pre_approved' };
    }

    // If regular ESARF with Event or Activity (from Apply ESARF), it MUST ALWAYS be pending (unless already approved/validated/rejected)
    if (hasEventOrActivity && !req.final_approved_at && !rawLower.includes('reject') && !rawLower.includes('validat')) {
      return { ...req, status: 'pending' };
    }
    // If validated in database, preserve it
    if (rawLower.includes('validat')) {
      return { ...req, status: req.status || 'validated' };
    }
    // If final_approved_at is present and request is not rejected, ensure status is marked as approved
    if (req.final_approved_at && !rawLower.includes('reject') && !rawLower.includes('denied')) {
      return { ...req, status: 'approved' };
    }
    // If all required approval steps are approved
    if (
      (rawLower === 'pending' || rawLower === 'submitted' || !rawLower) &&
      req.approval_summary &&
      req.approval_summary.length > 0
    ) {
      const relevantSteps = req.approval_summary;
      if (
        relevantSteps.length > 0 &&
        relevantSteps.every(
          (s) =>
            (s.status || '').toLowerCase().includes('approved') ||
            (s.status || '').toLowerCase().includes('skipped'),
        )
      ) {
        return { ...req, status: 'approved' };
      }
    }
    return req;
  });

  // If server returns empty list but we have cached requests, verify user session before overwriting
  if (items.length === 0 && cached && cached.length > 0) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      // Unauthenticated or session in transition: retain cached requests to prevent disappearing data
      return cached;
    }
  }

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

    // Preserve any pending offline requests awaiting sync (replace matching server items with offline edits, or prepend new offline items)
    const offlineItems = cached.filter(
      (item) =>
        item.request_id?.startsWith('offline_') ||
        (item.status || '').toLowerCase().includes('offline'),
    );
    const offlineMap = new Map(offlineItems.map((off) => [off.request_id, off]));
    items = items.map((serverItem) => offlineMap.get(serverItem.request_id) || serverItem);
    for (const offItem of offlineItems) {
      if (!items.some((serverItem) => serverItem.request_id === offItem.request_id)) {
        items = [offItem, ...items];
      }
    }

    // Preserve local travel orders until backend official travel order migration is deployed
    const localTravelItems = cached.filter(
      (item) =>
        item.request_id?.startsWith('travel_') ||
        item.request_type_code === 'travel_order',
    );
    for (const travItem of localTravelItems) {
      if (!items.some((serverItem) => serverItem.request_id === travItem.request_id)) {
        items = [travItem, ...items];
      }
    }
  }

    await setCacheJSON(cacheKey, items);
    lastRequestsFetchAt = Date.now();
    return items;
  } catch (err) {
    if (cached && cached.length) {
      return cached;
    }
    return [];
  } finally {
    inFlightRequestsPromise = null;
  }
  })();

  return inFlightRequestsPromise;
}

export async function loadMyRequestsCached() {
  const cacheKey = 'my_requests_v1';
  return (await getCacheJSON<MyRequest[]>(cacheKey)) ?? [];
}

export type SubmitLocalTravelOrderPayload = {
  employeeName?: string | null;
  employeeId?: string | null;
  destinationStores: string[];
  departureDate: string;
  returnDate: string;
  departureTime?: string | null;
  returnTime?: string | null;
  transportMode?: string | null;
  plateNo?: string | null;
  purposeOfTravel?: string | null;
  purposeDetails?: string | null;
  transportBudget?: number;
  mealBudget?: number;
  emergencyBudget?: number;
  costCenterCode?: string | null;
  chargeToStore?: string | null;
  submittedAt?: string;
};

export async function submitLocalTravelOrder(payload: SubmitLocalTravelOrderPayload): Promise<MyRequest> {
  const reqId = `travel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const submittedAt = payload.submittedAt || new Date().toISOString();
  const destinations = payload.destinationStores?.length ? payload.destinationStores.join(', ') : 'Not specified';
  const purpose = payload.purposeOfTravel || 'Official Travel';
  const purposeDetailStr = payload.purposeDetails ? ` (${payload.purposeDetails})` : '';
  const transportStr = payload.transportMode ? ` | Transport: ${payload.transportMode}${payload.plateNo ? ` [${payload.plateNo}]` : ''}` : '';
  const budgetTotal = (payload.transportBudget || 0) + (payload.mealBudget || 0) + (payload.emergencyBudget || 0);
  const budgetStr = budgetTotal > 0 ? ` | Budget: PHP ${budgetTotal.toLocaleString()}` : '';

  const newTravelReq: MyRequest = {
    request_id: reqId,
    request_type_code: 'travel_order',
    request_type_name: 'Official Travel Order',
    status: 'pending',
    submitted_at: submittedAt,
    final_approved_at: null,
    rejected_at: null,
    rejected_reason: null,
    date_from: payload.departureDate,
    date_to: payload.returnDate,
    time_from: payload.departureTime || null,
    time_to: payload.returnTime || null,
    time_schedule: null,
    day_off: null,
    payroll_class: null,
    transaction_type: 'Travel Order',
    total_hours: null,
    leave_type: null,
    leave_category: null,
    start_date: payload.departureDate,
    end_date: payload.returnDate,
    total_days: null,
    paid_days: null,
    unpaid_days: null,
    reason: `Destination: ${destinations} | Purpose: ${purpose}${purposeDetailStr}${transportStr}${budgetStr}`,
    approval_summary: [
      {
        step_order: 1,
        required_level: 2,
        status: 'pending',
        acted_at: null,
        remarks: null,
        skipped_reason: null,
        approver_name: 'Immediate Supervisor / Manager',
        approver_employee_no: null,
      },
    ],
  };

  const cacheKey = 'my_requests_v1';
  const cached = (await getCacheJSON<MyRequest[]>(cacheKey)) || [];
  const updated = [newTravelReq, ...cached.filter((r) => r.request_id !== reqId)];
  await setCacheJSON(cacheKey, updated);
  invalidateRequestsCache();
  DeviceEventEmitter.emit('my_requests_updated');
  return newTravelReq;
}


export type UpdatePendingRequestParams = {
  requestId: string;
  requestTypeCode?: string | null;
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
  storeId?: string | null;
  customApprovers?: { step_order: number; approver_employee_id: string }[] | null;
};

import { checkApproverActiveViewing, type ActiveViewerInfo } from './requestViewerLock';
import { withTimeout } from '../utils/withTimeout';

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

  // Prevent editing if any approval step has already been approved
  const { data: updateApprovedSteps } = await supabase
    .from('request_approval_steps')
    .select('id')
    .eq('request_id', targetId)
    .ilike('status', '%approved%')
    .limit(1);

  if (updateApprovedSteps && updateApprovedSteps.length > 0) {
    throw new Error('This request has already received an approval in the timeline and can no longer be edited.');
  }

  let rpcSuccess = false;
  try {
    const callRpc = (includeTypeCode: boolean) => {
      const payload: Record<string, any> = {
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
      };
      if (includeTypeCode && params.requestTypeCode) {
        payload.p_request_type_code = params.requestTypeCode;
      }
      payload.p_store_id = params.storeId || null;
      payload.p_custom_approvers = params.customApprovers && params.customApprovers.length > 0 ? params.customApprovers : null;
      return supabase.rpc('update_my_pending_request', payload);
    };

    const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('RPC_TIMEOUT') }), 20000),
    );

    let { error } = await Promise.race([callRpc(true), timeoutPromise]);
    if (error && params.requestTypeCode && String(error?.message || error).toLowerCase().includes('schema cache')) {
      const retryResult = await Promise.race([callRpc(false), timeoutPromise]);
      error = retryResult.error;
    }

    if (!error) {
      rpcSuccess = true;
    }
  } catch {
    rpcSuccess = false;
  }

  if (rpcSuccess) {
    try {
      invalidateRequestsCache();
      await removeCacheItem('my_requests_v1');
    } catch {
      // ignore
    }
    return;
  }

  // Fallback: update tables directly or via admin_update_request_data RPC
  let fallbackError: string | null = null;

  // Determine if request_type_id should change based on requestTypeCode or transactionType
  let targetTypeCode: string | null = params.requestTypeCode || null;
  if (!targetTypeCode && params.transactionType) {
    const lowerTrans = params.transactionType.toLowerCase();
    if (lowerTrans.includes('use offset') || lowerTrans.includes('use_offset')) {
      targetTypeCode = 'use_offset';
    } else if (lowerTrans.includes('offset')) {
      targetTypeCode = 'offset_earn';
    }
  }

  let targetTypeId: string | null = null;
  if (targetTypeCode) {
    try {
      const { data: rtData } = await supabase
        .from('request_types')
        .select('id')
        .eq('code', targetTypeCode)
        .maybeSingle<{ id: string }>();
      if (rtData?.id) {
        targetTypeId = rtData.id;
      }
    } catch {
      // ignore
    }
  }

  // Always update main requests table (reason, total_hours, total_days, date_from, date_to, request_type_id, updated_at)
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
      ...(targetTypeId ? { request_type_id: targetTypeId } : {}),
      ...(params.storeId ? { store_id: params.storeId } : {}),
      updated_at: new Date().toISOString(),
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
        ...(params.storeId ? { store_id: params.storeId } : {}),
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
    invalidateRequestsCache();
    await removeCacheItem('my_requests_v1');
  } catch {
    // ignore
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUUID(str?: string | null): boolean {
  return Boolean(str && UUID_REGEX.test(str.trim()));
}

export async function deleteMyPendingRequest(requestId: string, isPerk = false) {
  if (!requestId) {
    throw new Error('Missing Request ID.');
  }

  const performOfflineDeletion = async () => {
    await removeOfflineItem(requestId).catch(() => {});
    await removeRequestFromLocalCache(requestId).catch(() => {});

    // If a valid server online request is deleted while offline, queue a background deletion to sync when back online
    if (isUUID(requestId) && !requestId.startsWith('offline_') && !requestId.includes('local')) {
      await enqueueOfflineItem({
        id: `offline_delete_${requestId}`,
        type: 'delete_request',
        createdAt: new Date().toISOString(),
        payload: {
          requestId,
          isPerk,
        },
        syncAttempts: 0,
      }).catch(() => {});
    }

    invalidateRequestsCache();
    DeviceEventEmitter.emit('my_requests_updated');
  };

  const queue: OfflineQueueItem[] = await getOfflineQueue().catch(() => [] as OfflineQueueItem[]);
  const isQueued = queue.some(
    (q: OfflineQueueItem) =>
      q.id === requestId ||
      (q.type === 'esarf' && q.displayItem?.request_id === requestId) ||
      (q.type === 'leave' && q.displayItems?.some((d: MyRequest) => d.request_id === requestId)),
  );

  // 1. If currently offline, or if this is not a server UUID, or if it is queued offline, handle locally immediately with 0 network calls/timeouts
  if (!isAppOnline() || !isUUID(requestId) || requestId.startsWith('offline_') || requestId.includes('local') || isQueued) {
    await performOfflineDeletion();
    return;
  }

  // Also clean up any pending offline update for this online request
  await removeOfflineItem(requestId).catch(() => {});
  await removeOfflineItem(`offline_update_${requestId}`).catch(() => {});
  await removeOfflineItem(`offline_edit_${requestId}`).catch(() => {});

  try {
    const lockInfo: ActiveViewerInfo = await withTimeout(
      checkApproverActiveViewing(requestId),
      2000,
      'Checking approver review status timed out.',
    ).catch((): ActiveViewerInfo => ({ isLocked: false }));

    if (lockInfo.isLocked) {
      throw new Error(
        `This request is currently being reviewed by your manager/approver (${lockInfo.approverName || 'Manager'}). Deleting is temporarily disabled while they are viewing it to prevent data conflicts.`,
      );
    }

    // Call delete_my_pending_request RPC directly (handles ownership, pending check, timeline check, and related record deletion atomically)
    const { error: rpcErr } = await withTimeout<{ data: any; error: any }>(
      supabase.rpc('delete_my_pending_request', {
        p_request_id: requestId,
        p_is_perk: isPerk,
      }),
      5000,
      'Database delete operation timed out.',
    );

    if (rpcErr) {
      const msg = rpcErr.message || '';
      if (
        msg.toLowerCase().includes('already received an approval') ||
        msg.toLowerCase().includes('cannot be deleted') ||
        msg.toLowerCase().includes('only pending')
      ) {
        throw new Error(msg);
      }

      // Try admin_delete_request fallback
      const { error: adminErr } = await withTimeout<{ data: any; error: any }>(
        supabase.rpc('admin_delete_request', {
          p_request_id: requestId,
          p_is_perk: isPerk,
        }),
        4000,
        'Admin delete fallback timed out.',
      );

      if (adminErr) {
        throw new Error(adminErr.message || rpcErr.message);
      }
    }

    try {
      invalidateRequestsCache();
      await removeRequestFromLocalCache(requestId);
    } catch {
      // ignore
    }
  } catch (err: any) {
    // If it is a business logic error (e.g. active review or already approved), rethrow it
    const msg = (err?.message || '').toLowerCase();
    const isBusinessLogicError =
      msg.includes('currently being reviewed') ||
      msg.includes('timeline and can no longer be deleted') ||
      msg.includes('already received an approval');

    if (isBusinessLogicError) {
      throw err;
    }

    // If it's a network error, timeout, or connection failure, fall back seamlessly to offline deletion!
    const isNetworkError =
      !isAppOnline() ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('abort') ||
      msg.includes('offline');

    if (isNetworkError) {
      console.warn('[requests] Network issue during deletion, falling back to offline queue:', err);
      await performOfflineDeletion();
      return;
    }

    throw err;
  }
}

export type AttachScheduledOtProofParams = {
  requestId: string;
  proofs: {
    uri: string;
    source?: 'photo_proof' | 'gallery' | 'camera';
    name?: string;
    timestamp?: string;
    locationText?: string;
    driveWebViewLink?: string | null;
    photoProofId?: string;
  }[];
};

export async function attachScheduledOtPhotoProof({ requestId, proofs }: AttachScheduledOtProofParams) {
  if (!requestId) {
    throw new Error('Missing Request ID.');
  }
  if (!proofs || proofs.length === 0) {
    throw new Error('Please select at least 1 photo proof to attach.');
  }

  // Format proof tags
  let proofTags = '';
  for (const proof of proofs) {
    const link = proof.driveWebViewLink || (proof.uri?.startsWith('http') ? proof.uri : '');
    if (!link) continue;
    proofTags += ` [Proof: ${link}]`;
    const isGallery = proof.source === 'gallery' || (!proof.timestamp && !proof.locationText && !proof.photoProofId);
    if (isGallery) {
      proofTags += ` [ProofSource: gallery]`;
    } else {
      if (proof.timestamp) proofTags += ` [ProofTime: ${proof.timestamp}]`;
      if (proof.locationText) {
        const cleanLoc = proof.locationText.replace(/[\[\]]/g, '').trim();
        if (cleanLoc) proofTags += ` [ProofLoc: ${cleanLoc}]`;
      }
      if (proof.photoProofId) proofTags += ` [ProofId: ${proof.photoProofId}]`;
    }
  }

  let rpcSuccess = false;
  try {
    const { error: rpcErr } = await supabase.rpc('attach_scheduled_ot_photo_proof', {
      p_request_id: requestId,
      p_proof_tags: proofTags.trim(),
    });
    if (!rpcErr) {
      rpcSuccess = true;
    }
  } catch {
    rpcSuccess = false;
  }

  if (!rpcSuccess) {
    // Fallback: update tables directly
    const { data: timeReq } = await supabase
      .from('time_request_details')
      .select('reason')
      .eq('request_id', requestId)
      .maybeSingle<{ reason: string | null }>();

    const updatedReason = `${(timeReq?.reason || '').trim()} ${proofTags.trim()}`.trim();

    await supabase
      .from('time_request_details')
      .update({ reason: updatedReason })
      .eq('request_id', requestId);

    await supabase
      .from('requests')
      .update({
        status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    // Activate first step in request_approval_steps
    const { data: firstStep } = await supabase
      .from('request_approval_steps')
      .select('id')
      .eq('request_id', requestId)
      .order('step_order', { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (firstStep?.id) {
      await supabase
        .from('request_approval_steps')
        .update({ status: 'pending' })
        .eq('id', firstStep.id)
        .eq('status', 'waiting');
    }
  }

  invalidateRequestsCache();
  await removeCacheItem('my_requests_v1').catch(() => {});
  DeviceEventEmitter.emit('my_requests_updated');
}

