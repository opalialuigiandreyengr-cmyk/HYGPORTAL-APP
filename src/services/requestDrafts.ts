import { DeviceEventEmitter } from 'react-native';

import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import {
  deleteEsarfDraft,
  draftToMyRequest as esarfDraftToMyRequest,
  ESARF_DRAFTS_UPDATED_EVENT,
  formatDraftTransactionSummary,
  loadEsarfDrafts,
  type EsarfDraft,
} from './esarfDrafts';
import type { MyRequest } from './requests';

export const REQUEST_DRAFTS_UPDATED_EVENT = ESARF_DRAFTS_UPDATED_EVENT;

export type LeaveDraftEntry = {
  id: string;
  leaveType: string;
  leaveCategory: string;
  dateFrom: string;
  dateTo: string;
  paidDays: string;
  unpaidDays: string;
  reason: string;
  workflowSteps?: any[];
};

export type LeaveDraft = {
  id: string;
  kind: 'leave';
  userKey: string;
  schedule: string;
  dayOff: string;
  payrollClass: string;
  isUserCustomSchedule: boolean;
  isUserCustomDayOff: boolean;
  entries: LeaveDraftEntry[];
  savedAt: string;
  updatedAt: string;
};

export type TravelOrderDraft = {
  id: string;
  kind: 'travel_order';
  userKey: string;
  selectedStores: string[];
  departureDate: string;
  returnDate: string;
  departureTime: string;
  returnTime: string;
  transportMode: string;
  plateNo: string;
  purposeOfTravel: string;
  otherPurposeDetails: string;
  transportBudget: string;
  mealBudget: string;
  emergencyBudget: string;
  costCenterCode: string;
  selectedChargeStores: string[];
  savedAt: string;
  updatedAt: string;
};

export type UnifiedRequestDraft =
  | ({ kind: 'esarf' } & EsarfDraft)
  | LeaveDraft
  | TravelOrderDraft;

function getLeaveDraftsKey(userKey: string) {
  return `leave_drafts_v1_${userKey}`;
}

function getTravelDraftsKey(userKey: string) {
  return `travel_drafts_v1_${userKey}`;
}

export function isLeaveDraftRequest(req?: MyRequest | null): boolean {
  if (!req) return false;
  return (
    String(req.request_id || '').startsWith('draft_leave_') ||
    Boolean((req as any).__leaveDraft)
  );
}

export function isTravelDraftRequest(req?: MyRequest | null): boolean {
  if (!req) return false;
  return (
    String(req.request_id || '').startsWith('draft_travel_') ||
    Boolean((req as any).__travelDraft)
  );
}

export async function loadLeaveDrafts(userKey?: string | null): Promise<LeaveDraft[]> {
  if (!userKey) return [];
  try {
    const list = await getCacheJSON<LeaveDraft[]>(getLeaveDraftsKey(userKey));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveLeaveDraft(
  userKey: string,
  input: Omit<LeaveDraft, 'id' | 'kind' | 'userKey' | 'savedAt' | 'updatedAt'> & { id?: string },
): Promise<LeaveDraft> {
  const existing = await loadLeaveDrafts(userKey);
  const now = new Date().toISOString();
  const match = input.id ? existing.find((d) => d.id === input.id) : undefined;

  const saved: LeaveDraft = {
    id: match?.id || input.id || `draft_leave_${Date.now()}`,
    kind: 'leave',
    userKey,
    schedule: input.schedule,
    dayOff: input.dayOff,
    payrollClass: input.payrollClass,
    isUserCustomSchedule: input.isUserCustomSchedule,
    isUserCustomDayOff: input.isUserCustomDayOff,
    entries: input.entries,
    savedAt: match?.savedAt || now,
    updatedAt: now,
  };

  await setCacheJSON(getLeaveDraftsKey(userKey), [
    saved,
    ...existing.filter((d) => d.id !== saved.id),
  ]);
  DeviceEventEmitter.emit(REQUEST_DRAFTS_UPDATED_EVENT);
  return saved;
}

export async function deleteLeaveDraft(userKey?: string | null, draftId?: string | null): Promise<void> {
  if (!userKey || !draftId) return;
  const existing = await loadLeaveDrafts(userKey);
  await setCacheJSON(
    getLeaveDraftsKey(userKey),
    existing.filter((d) => d.id !== draftId),
  );
  DeviceEventEmitter.emit(REQUEST_DRAFTS_UPDATED_EVENT);
}

export async function loadTravelOrderDrafts(userKey?: string | null): Promise<TravelOrderDraft[]> {
  if (!userKey) return [];
  try {
    const list = await getCacheJSON<TravelOrderDraft[]>(getTravelDraftsKey(userKey));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveTravelOrderDraft(
  userKey: string,
  input: Omit<TravelOrderDraft, 'id' | 'kind' | 'userKey' | 'savedAt' | 'updatedAt'> & { id?: string },
): Promise<TravelOrderDraft> {
  const existing = await loadTravelOrderDrafts(userKey);
  const now = new Date().toISOString();
  const match = input.id ? existing.find((d) => d.id === input.id) : undefined;

  const saved: TravelOrderDraft = {
    id: match?.id || input.id || `draft_travel_${Date.now()}`,
    kind: 'travel_order',
    userKey,
    selectedStores: input.selectedStores,
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    departureTime: input.departureTime,
    returnTime: input.returnTime,
    transportMode: input.transportMode,
    plateNo: input.plateNo,
    purposeOfTravel: input.purposeOfTravel,
    otherPurposeDetails: input.otherPurposeDetails,
    transportBudget: input.transportBudget,
    mealBudget: input.mealBudget,
    emergencyBudget: input.emergencyBudget,
    costCenterCode: input.costCenterCode,
    selectedChargeStores: input.selectedChargeStores,
    savedAt: match?.savedAt || now,
    updatedAt: now,
  };

  await setCacheJSON(getTravelDraftsKey(userKey), [
    saved,
    ...existing.filter((d) => d.id !== saved.id),
  ]);
  DeviceEventEmitter.emit(REQUEST_DRAFTS_UPDATED_EVENT);
  return saved;
}

export async function deleteTravelOrderDraft(
  userKey?: string | null,
  draftId?: string | null,
): Promise<void> {
  if (!userKey || !draftId) return;
  const existing = await loadTravelOrderDrafts(userKey);
  await setCacheJSON(
    getTravelDraftsKey(userKey),
    existing.filter((d) => d.id !== draftId),
  );
  DeviceEventEmitter.emit(REQUEST_DRAFTS_UPDATED_EVENT);
}

export async function loadAllRequestDrafts(
  userKey?: string | null,
): Promise<UnifiedRequestDraft[]> {
  if (!userKey) return [];
  const [esarf, leave, travel] = await Promise.all([
    loadEsarfDrafts(userKey),
    loadLeaveDrafts(userKey),
    loadTravelOrderDrafts(userKey),
  ]);

  const combined: UnifiedRequestDraft[] = [
    ...esarf.map((d) => ({ ...d, kind: 'esarf' as const })),
    ...leave,
    ...travel,
  ];

  return combined.sort((a, b) => {
    const ta = Date.parse(b.updatedAt || b.savedAt || '') || 0;
    const tb = Date.parse(a.updatedAt || a.savedAt || '') || 0;
    return ta - tb;
  });
}

export async function deleteUnifiedDraft(
  userKey: string | null | undefined,
  draft: UnifiedRequestDraft,
): Promise<void> {
  if (draft.kind === 'leave') {
    await deleteLeaveDraft(userKey, draft.id);
  } else if (draft.kind === 'travel_order') {
    await deleteTravelOrderDraft(userKey, draft.id);
  } else {
    await deleteEsarfDraft(userKey, draft.id);
  }
}

export function getUnifiedDraftSummary(draft: UnifiedRequestDraft): {
  title: string;
  meta: string;
  reason: string;
  dateStr: string;
  category: 'esarf' | 'leave' | 'travel_order';
} {
  if (draft.kind === 'leave') {
    const first = draft.entries[0];
    const title = first?.leaveCategory || first?.leaveType || 'Leave Draft';
    const dateStr = first?.dateFrom
      ? (first.dateTo && first.dateTo !== first.dateFrom
        ? `${first.dateFrom} to ${first.dateTo}`
        : first.dateFrom)
      : 'No date selected';
    return {
      title,
      meta: `Leave • ${draft.entries.length} ${draft.entries.length === 1 ? 'entry' : 'entries'} • ${dateStr}`,
      reason: first?.reason?.trim() || 'No reason entered yet',
      dateStr: first?.dateFrom || draft.updatedAt.slice(0, 10),
      category: 'leave',
    };
  }

  if (draft.kind === 'travel_order') {
    const dest = draft.selectedStores.length > 0 ? draft.selectedStores.join(', ') : 'Travel Order Draft';
    const dateStr = draft.departureDate
      ? (draft.returnDate && draft.returnDate !== draft.departureDate
        ? `${draft.departureDate} to ${draft.returnDate}`
        : draft.departureDate)
      : 'No date selected';
    return {
      title: `Travel Order • ${dest}`,
      meta: `Travel Order • ${dateStr}`,
      reason: draft.purposeOfTravel || draft.otherPurposeDetails || 'No purpose entered yet',
      dateStr: draft.departureDate || draft.updatedAt.slice(0, 10),
      category: 'travel_order',
    };
  }

  const first = draft.entries[0];
  const dateRange = first?.dateFrom
    ? (first.dateTo && first.dateTo !== first.dateFrom
      ? `${first.dateFrom} to ${first.dateTo}`
      : first.dateFrom)
    : 'No date selected';
  return {
    title: formatDraftTransactionSummary(draft),
    meta: `${draft.mode === 'pre_approved_ot_offset' ? 'Pre-approved OT' : 'ESARF'} • ${draft.entries.length} ${draft.entries.length === 1 ? 'entry' : 'entries'} • ${dateRange}`,
    reason: first?.reason?.trim() || 'No reason entered yet',
    dateStr: first?.dateFrom || draft.updatedAt.slice(0, 10),
    category: 'esarf',
  };
}

export function unifiedDraftToMyRequest(draft: UnifiedRequestDraft): MyRequest {
  if (draft.kind === 'leave') {
    const first = draft.entries[0];
    const req: MyRequest & { __leaveDraft?: LeaveDraft } = {
      request_id: draft.id,
      request_type_code: 'leave',
      request_type_name: 'Leave',
      transaction_type: 'Leave',
      status: 'draft',
      submitted_at: draft.updatedAt || draft.savedAt,
      final_approved_at: null,
      rejected_at: null,
      rejected_reason: null,
      date_from: first?.dateFrom || null,
      date_to: first?.dateTo || first?.dateFrom || null,
      start_date: first?.dateFrom || null,
      end_date: first?.dateTo || first?.dateFrom || null,
      time_from: null,
      time_to: null,
      total_hours: null,
      time_schedule: draft.schedule,
      day_off: draft.dayOff,
      payroll_class: draft.payrollClass,
      leave_type: first?.leaveType || null,
      leave_category: first?.leaveCategory || null,
      total_days: null,
      paid_days: null,
      unpaid_days: null,
      reason: first?.reason || '',
      approval_summary: [],
      __leaveDraft: draft,
    };
    return req;
  }

  if (draft.kind === 'travel_order') {
    const req: MyRequest & { __travelDraft?: TravelOrderDraft } = {
      request_id: draft.id,
      request_type_code: 'travel_order',
      request_type_name: 'Official Travel Order',
      transaction_type: 'Official Travel Order',
      status: 'draft',
      submitted_at: draft.updatedAt || draft.savedAt,
      final_approved_at: null,
      rejected_at: null,
      rejected_reason: null,
      date_from: draft.departureDate || null,
      date_to: draft.returnDate || draft.departureDate || null,
      start_date: null,
      end_date: null,
      time_from: draft.departureTime || null,
      time_to: draft.returnTime || null,
      total_hours: null,
      time_schedule: null,
      day_off: null,
      payroll_class: null,
      leave_type: null,
      leave_category: null,
      total_days: null,
      paid_days: null,
      unpaid_days: null,
      reason: draft.purposeOfTravel || draft.otherPurposeDetails || '',
      approval_summary: [],
      __travelDraft: draft,
    };
    return req;
  }

  return esarfDraftToMyRequest(draft);
}
