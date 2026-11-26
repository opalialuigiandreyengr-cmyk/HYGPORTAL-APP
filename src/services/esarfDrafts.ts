import { DeviceEventEmitter } from 'react-native';

import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import type { MyRequest } from './requests';

export const ESARF_DRAFTS_UPDATED_EVENT = 'esarf_drafts_updated';

export type EsarfDraftEntry = {
  id: string;
  transaction: string;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  breakFrom?: string;
  breakTo?: string;
  reason: string;
  actualHours?: string;
  eventName?: string;
  proof?: any;
  proofs?: any[];
  workflowSteps?: any[];
};

export type EsarfDraft = {
  id: string;
  userKey: string;
  mode: 'esarf' | 'pre_approved_ot_offset';
  schedule: string;
  dayOff: string;
  payrollClass: string;
  isUserCustomSchedule: boolean;
  isUserCustomDayOff: boolean;
  entries: EsarfDraftEntry[];
  savedAt: string;
  updatedAt: string;
};

function getDraftsCacheKey(userKey: string) {
  return `esarf_drafts_v1_${userKey}`;
}

export function isEsarfDraftRequest(req?: MyRequest | null): boolean {
  if (!req) return false;
  return (
    String(req.status || '').toLowerCase() === 'draft' ||
    String(req.request_id || '').startsWith('draft_esarf_') ||
    Boolean((req as any).__esarfDraft)
  );
}

export async function loadEsarfDrafts(userKey?: string | null): Promise<EsarfDraft[]> {
  if (!userKey) return [];
  try {
    const list = await getCacheJSON<EsarfDraft[]>(getDraftsCacheKey(userKey));
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => {
      const ta = Date.parse(b.updatedAt || b.savedAt || '') || 0;
      const tb = Date.parse(a.updatedAt || a.savedAt || '') || 0;
      return ta - tb;
    });
  } catch {
    return [];
  }
}

export async function saveEsarfDraft(
  userKey: string,
  draftInput: Omit<EsarfDraft, 'id' | 'userKey' | 'savedAt' | 'updatedAt'> & { id?: string },
): Promise<EsarfDraft> {
  const existing = await loadEsarfDrafts(userKey);
  const now = new Date().toISOString();
  const existingMatch = draftInput.id ? existing.find((d) => d.id === draftInput.id) : undefined;

  const savedDraft: EsarfDraft = {
    id: existingMatch?.id || draftInput.id || `draft_esarf_${Date.now()}`,
    userKey,
    mode: draftInput.mode,
    schedule: draftInput.schedule,
    dayOff: draftInput.dayOff,
    payrollClass: draftInput.payrollClass,
    isUserCustomSchedule: draftInput.isUserCustomSchedule,
    isUserCustomDayOff: draftInput.isUserCustomDayOff,
    entries: draftInput.entries,
    savedAt: existingMatch?.savedAt || now,
    updatedAt: now,
  };

  const next = [savedDraft, ...existing.filter((d) => d.id !== savedDraft.id)];
  await setCacheJSON(getDraftsCacheKey(userKey), next);
  DeviceEventEmitter.emit(ESARF_DRAFTS_UPDATED_EVENT);
  return savedDraft;
}

export async function deleteEsarfDraft(userKey?: string | null, draftId?: string | null): Promise<void> {
  if (!userKey || !draftId) return;
  const existing = await loadEsarfDrafts(userKey);
  const next = existing.filter((d) => d.id !== draftId);
  await setCacheJSON(getDraftsCacheKey(userKey), next);
  DeviceEventEmitter.emit(ESARF_DRAFTS_UPDATED_EVENT);
}

export function formatDraftTransactionSummary(draft: EsarfDraft): string {
  const labels: Record<string, string> = {
    ot: 'Overtime (OT)',
    ut: 'Undertime (UT)',
    fio: 'Failure to In/Out (FIO)',
    ob: 'Official Business (OB)',
    offset_earn: 'OT for Offset',
    use_offset: 'Use Offset Balance',
  };
  const keys = Array.from(
    new Set(
      draft.entries
        .flatMap((e) => (e.transaction || '').split(','))
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (keys.length === 0) {
    return draft.mode === 'pre_approved_ot_offset' ? 'Pre-approved OT Draft' : 'ESARF Draft';
  }
  return keys.map((k) => labels[k] || k.toUpperCase()).join(', ');
}

export function draftToMyRequest(draft: EsarfDraft): MyRequest {
  const first = draft.entries[0];
  const last = draft.entries[draft.entries.length - 1];
  const transSummary = formatDraftTransactionSummary(draft);

  const req: MyRequest & { __esarfDraft?: EsarfDraft } = {
    request_id: draft.id,
    request_type_code: draft.mode === 'pre_approved_ot_offset' ? 'overtime' : 'overtime',
    request_type_name: transSummary,
    transaction_type: transSummary,
    status: 'draft',
    submitted_at: draft.updatedAt || draft.savedAt,
    final_approved_at: null,
    rejected_at: null,
    rejected_reason: null,
    date_from: first?.dateFrom || null,
    date_to: last?.dateTo || first?.dateTo || first?.dateFrom || null,
    start_date: null,
    end_date: null,
    time_from: first?.timeFrom || null,
    time_to: first?.timeTo || null,
    total_hours: null,
    time_schedule: draft.schedule,
    day_off: draft.dayOff,
    payroll_class: draft.payrollClass,
    leave_type: null,
    leave_category: null,
    total_days: null,
    paid_days: null,
    unpaid_days: null,
    reason: first?.reason || '',
    approval_summary: [],
    __esarfDraft: draft,
  };

  return req;
}
