import { formatDateInput, stripSecondsFromTimeString } from './dateTime';
import { parseTimeToMinutes } from './requestCalculations';
import type { MyRequest } from '../services/requests';
import type { PendingApproval } from '../services/approvals';

export type ScheduledOtCandidate = {
  transaction?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  reason?: string | null;
  status?: string | null;
  request_type_code?: string | null;
  transaction_type?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  time_from?: string | null;
  time_to?: string | null;
};

/**
 * Checks if a transaction string represents Overtime (OT).
 * Matches "ot", "overtime", "(ot)", etc.
 */
export function isOvertimeTransaction(transactionStr?: string | null): boolean {
  if (!transactionStr || !transactionStr.trim()) return false;
  const raw = transactionStr.toLowerCase();
  const parts = raw.split(/[,/&+]+|\band\b/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  return parts.some((p) => {
    // If it's specifically OT for Offset, leave that to isOffsetTransaction
    if (p.includes('offset')) return false;
    return p === 'ot' || p === 'overtime' || p.includes('overtime') || p.includes('(ot)');
  });
}

/**
 * Checks if a transaction string represents Offset (OT for Offset).
 * Matches "offset", "ot for offset", etc. (excluding pure "use_offset").
 */
export function isOffsetTransaction(transactionStr?: string | null): boolean {
  if (!transactionStr || !transactionStr.trim()) return false;
  const raw = transactionStr.toLowerCase();
  if (raw.includes('use_offset') || raw.includes('use offset')) {
    const withoutUse = raw.replace(/use[_\s]+offset(\s+balance)?/g, '').trim();
    if (!withoutUse) return false;
  }
  const parts = raw.split(/[,/&+]+|\band\b/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  return parts.some((p) => {
    if (p.includes('use_offset') || p.includes('use offset')) return false;
    return (
      p === 'offset' ||
      p === 'offset_earn' ||
      p.includes('ot for offset') ||
      p === 'ot offset' ||
      p.includes('offset')
    );
  });
}

/**
 * Checks if a transaction string represents Overtime (OT) or Offset (OT for Offset)
 * or any combined transaction containing OT or Offset.
 */
export function isScheduledTransaction(transactionStr?: string | null): boolean {
  return isOvertimeTransaction(transactionStr) || isOffsetTransaction(transactionStr);
}

/**
 * Checks if an ESARF entry is scheduled OT or Offset applied ahead of time.
 */
export function isScheduledOtEntry(
  entry?: {
    transaction?: string | null;
    dateFrom?: string | null;
    timeFrom?: string | null;
  } | null,
  nowDate?: Date,
): boolean {
  if (!entry || !entry.transaction || !entry.dateFrom) return false;
  if (!isScheduledTransaction(entry.transaction)) return false;

  const now = nowDate || new Date();
  const todayStr = formatDateInput(now);

  if (entry.dateFrom > todayStr) {
    return true;
  }

  if (entry.dateFrom === todayStr) {
    if (!entry.timeFrom) return false;
    const startMins = parseTimeToMinutes(entry.timeFrom);
    if (startMins === null) return false;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return startMins > nowMins;
  }

  return false;
}

/**
 * Checks if a request object is or was a scheduled OT or Offset request.
 */
export function isScheduledOtRequest(
  request?: ScheduledOtCandidate | MyRequest | PendingApproval | null,
  nowDate?: Date,
): boolean {
  if (!request) return false;

  const rawStatus = (((request as any)?.status || (request as any)?.request_status || '') as string).toLowerCase().trim();
  if (rawStatus.includes('pre_approved') || rawStatus.includes('pre-approved')) {
    return true;
  }

  const trans =
    (request as any).transaction_type ||
    (request as any).transaction ||
    (request as any).request_type_code ||
    '';
  if (!isScheduledTransaction(trans)) return false;

  const dateFrom = (request as any).date_from || (request as any).dateFrom;
  const timeFrom = (request as any).time_from || (request as any).timeFrom;

  return isScheduledOtEntry({ transaction: trans, dateFrom, timeFrom }, nowDate);
}

/**
 * Checks if photo proof has already been attached to the request/entry.
 */
export function hasPhotoProofAttached(
  target?: { reason?: string | null } | null,
): boolean {
  if (!target || !target.reason) return false;
  return /\[Proof:\s*[^\]]+\]/i.test(target.reason);
}

/**
 * Checks if the current time has reached or passed the scheduled OT / Offset date & time.
 * "It should require the user to attach photo proof on the exact or beyond the date the OT / Offset was requested.
 * Meaning, there's no photo proof card on the apply ESARF screen upon the application of the scheduled request.
 * It will appear on the requests tab screen but is disabled and will enable during the schedule it was requested for."
 */
export function isScheduledOtReadyForProof(
  target?: {
    date_from?: string | null;
    time_from?: string | null;
    dateFrom?: string | null;
    timeFrom?: string | null;
  } | null,
  nowDate?: Date,
): boolean {
  if (!target) return false;
  const dateFrom = target.date_from || target.dateFrom;
  const timeFrom = target.time_from || target.timeFrom;
  if (!dateFrom) return true;

  const now = nowDate || new Date();
  const todayStr = formatDateInput(now);

  if (todayStr > dateFrom) {
    return true; // Beyond the date
  }

  if (todayStr === dateFrom) {
    if (!timeFrom) return true; // On the exact date
    const startMins = parseTimeToMinutes(timeFrom);
    if (startMins === null) return true;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return nowMins >= startMins; // Schedule reached
  }

  return false;
}

/**
 * Checks if a request is a scheduled OT or Offset that is still awaiting photo proof.
 * In the new workflow, scheduled OT / Offset requests appear automatically on the
 * approvers' screen without waiting for the date to unlock and requiring photo proof.
 */
export function isScheduledOtAwaitingProof(
  _request?: ScheduledOtCandidate | MyRequest | PendingApproval | null,
): boolean {
  return false;
}

/**
 * Formats a user-friendly schedule countdown or unlock status message.
 */
export function formatScheduledOtStatusMessage(
  target?: {
    date_from?: string | null;
    time_from?: string | null;
    dateFrom?: string | null;
    timeFrom?: string | null;
    transaction?: string | null;
    transaction_type?: string | null;
    request_type_code?: string | null;
  } | null,
): string {
  if (!target) return '';
  const dateFrom = target.date_from || target.dateFrom;
  const timeFrom = target.time_from || target.timeFrom;
  const trans =
    (target as any).transaction ||
    (target as any).transaction_type ||
    (target as any).request_type_code ||
    '';
  const isOffset = isOffsetTransaction(trans);
  const typeLabel = isOffset ? 'offset' : 'overtime';

  const isReady = isScheduledOtReadyForProof(target);
  if (isReady) {
    return `Your ${typeLabel} schedule has arrived. Please attach photo proof to forward this request to your approver.`;
  }

  const dateDisplay = dateFrom || 'the scheduled date';
  const timeDisplay = timeFrom ? ` at ${stripSecondsFromTimeString(timeFrom)}` : '';
  return `Photo proof upload is disabled until ${dateDisplay}${timeDisplay}. Please complete your ${typeLabel} shift before submitting proof.`;
}
