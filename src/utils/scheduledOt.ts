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
    timeTo?: string | null;
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
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (entry.timeTo) {
      const endMins = parseTimeToMinutes(entry.timeTo);
      if (endMins !== null) {
        return endMins > nowMins;
      }
    }
    if (entry.timeFrom) {
      const startMins = parseTimeToMinutes(entry.timeFrom);
      if (startMins !== null) {
        return startMins > nowMins;
      }
    }
    return true;
  }

  return false;
}

/**
 * Checks if a request object is or was a scheduled OT or Offset request.
 * ONLY requests applied from the Pre-approved OT screen are pre-approved.
 * Regular ESARF requests applied in Apply ESARF (even with an event or activity)
 * are NEVER pre-approved and always remain pending.
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

  const reason = (request as any).reason || '';
  // Explicitly tagged pre-approved requests from Pre-approved OT screen
  if (/\[PreApproved\]/i.test(reason)) {
    return true;
  }

  const trans =
    (request as any).transaction_type ||
    (request as any).transaction ||
    (request as any).request_type_code ||
    '';
  if (String(trans).toLowerCase().includes('scheduled_ot')) {
    return true;
  }

  // Requests with an event or activity from regular Apply ESARF are never pre-approved
  if (/event:/i.test(reason) || /activity:/i.test(reason)) {
    return false;
  }

  return false;
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
 * Checks if the 1st approver has approved a request.
 */
export function isFirstApproverApproved(
  request?: ScheduledOtCandidate | MyRequest | PendingApproval | null,
): boolean {
  if (!request) return false;
  const summary = (request as any).approval_summary;
  if (Array.isArray(summary) && summary.length > 0) {
    const step1 = summary.find((s: any) => Number(s.step_order) === 1);
    if (step1) {
      return String(step1.status || '').toLowerCase() === 'approved';
    }
  }
  return false;
}

/**
 * Backward compatibility helpers (photo proof flow for pre-approved OT has been undone).
 * Pre-approved OT now has strictly one approver and does not require photo proof.
 */
export function isScheduledOtReadyForProof(
  _target?: any,
  _nowDate?: Date,
): boolean {
  return true;
}

export function isScheduledOtAwaitingProof(
  _request?: ScheduledOtCandidate | MyRequest | PendingApproval | null,
): boolean {
  return false;
}

export function formatScheduledOtStatusMessage(
  _target?: any,
): string {
  return '';
}
