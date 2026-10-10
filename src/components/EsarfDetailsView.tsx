import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Image, Modal, Linking, ActivityIndicator, Platform } from 'react-native';
import { CalendarDays, Camera, Check, Clock3, Edit3, ExternalLink, Eye, FileText, Image as ImageIcon, MapPin, Users, X } from 'lucide-react-native';
import { colors, radius, fontWeights, spacing } from '../theme';
import { computeWorkedMinutes, computeOffsetOvertimeHours } from '../utils/requestCalculations';
import { parseEsarfDateRangeStringToYMD } from '../utils/dateTime';
import { fetchPhotoProofDetails, type PhotoProofItem } from '../services/photoProof';

export function formatEsarfDateRange(dateFromStr?: string | null, dateToStr?: string | null): string {
  if (!dateFromStr) return 'mm/dd-dd/yyyy';

  const fromParts = dateFromStr.split('-').map(Number);
  if (fromParts.length !== 3 || fromParts.some(Number.isNaN)) return 'mm/dd-dd/yyyy';

  const [y1, m1, d1] = fromParts;
  const m1Str = String(m1).padStart(2, '0');
  const d1Str = String(d1).padStart(2, '0');
  const y1Short = String(y1).slice(-2);

  const actualDateTo = dateToStr || dateFromStr;
  const toParts = actualDateTo.split('-').map(Number);

  if (toParts.length !== 3 || toParts.some(Number.isNaN)) {
    return `${m1Str}/${d1Str}-${d1Str}/${y1Short}`;
  }

  const [y2, m2, d2] = toParts;
  const m2Str = String(m2).padStart(2, '0');
  const d2Str = String(d2).padStart(2, '0');
  const y2Short = String(y2).slice(-2);

  if (y1 === y2 && m1 === m2) {
    return `${m1Str}/${d1Str}-${d2Str}/${y1Short}`;
  }

  if (y1 === y2) {
    return `${m1Str}/${d1Str}-${m2Str}/${d2Str}/${y1Short}`;
  }

  return `${m1Str}/${d1Str}/${y1Short}-${m2Str}/${d2Str}/${y2Short}`;
}

export type ParsedEsarfEntry = {
  index: number;
  transactionLabel: string;
  dateStr: string;
  timeFromStr: string;
  timeToStr: string;
  totalHours: string;
  actualHours?: string;
  reason: string;
  isRejected?: boolean;
  proofUrl?: string;
  proofTime?: string;
  proofLocation?: string;
  proofId?: string;
};

export function extractDriveFileId(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  const lh3Match = trimmed.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i);
  if (lh3Match && lh3Match[1]) return lh3Match[1];

  const fileDMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (fileDMatch && fileDMatch[1]) return fileDMatch[1];

  const queryMatch =
    trimmed.match(/drive\.google\.com\/(?:open|uc)\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (queryMatch && queryMatch[1]) return queryMatch[1];

  if (/^[a-zA-Z0-9_-]{25,50}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function getDirectProofImageUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('file://')) {
    return trimmed;
  }

  const driveId = extractDriveFileId(trimmed);
  if (driveId) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w1000`;
  }

  return trimmed;
}

export function getExternalProofWebUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  const driveId = extractDriveFileId(trimmed);
  if (driveId) {
    return `https://drive.google.com/file/d/${driveId}/view`;
  }
  return trimmed;
}

export async function fetchProofImageAsBlobOrDataUri(url: string): Promise<string> {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('file://')) {
    return trimmed;
  }

  try {
    const res = await fetch(trimmed, {
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      return URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn('[ProofImage] Blob fetch failed, using direct url fallback:', err);
  }
  return trimmed;
}

export function isOffsetEarnTransaction(label?: string | null): boolean {
  if (!label) return false;
  const l = label.trim().toLowerCase();
  const withoutUseOffset = l.replace(/use[_\s-]?offset/gi, '');
  return withoutUseOffset.includes('offset');
}

export function parseTimeStringToMinutes(t?: string | null): number | null {
  if (!t || t === '--:--' || t === '--') return null;
  const clean = t.trim();
  // 12-hour format: e.g. "09:00 AM", "9:00AM", "05:00 PM", "5:00:00 PM", "9:00 am"
  const ampmMatch = clean.toUpperCase().replace(/\s+/g, ' ').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2]);
    const ampm = ampmMatch[4];
    if (Number.isNaN(hour) || Number.isNaN(min) || hour < 1 || hour > 12 || min < 0 || min > 59) {
      return null;
    }
    if (hour === 12) hour = 0;
    if (ampm === 'PM') hour += 12;
    return hour * 60 + min;
  }
  // 24-hour format: e.g. "09:00", "09:00:00", "17:00", "17:00:00"
  const parts = clean.split(':').map(Number);
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    const h = parts[0];
    const m = parts[1];
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return h * 60 + m;
    }
  }
  return null;
}

export function computeActualWorkedHours(
  timeFromStr?: string | null,
  timeToStr?: string | null,
  options?: { dateFrom?: string | null; timeSchedule?: string | null; dayOff?: string | null },
): number | null {
  return computeOffsetOvertimeHours({
    timeFrom: timeFromStr,
    timeTo: timeToStr,
    dateFrom: options?.dateFrom,
    timeSchedule: options?.timeSchedule,
    dayOff: options?.dayOff,
  });
}

function formatDisplayHours(hours?: string | null): string {
  if (!hours) return '0.00';
  const num = Number(hours);
  return Number.isFinite(num) ? num.toFixed(2) : hours;
}

export function formatUnifiedRequestCode(
  item: {
    request_type_code?: string | null;
    submitted_at?: string | null;
    date_from?: string | null;
    start_date?: string | null;
    created_at?: string | null;
  },
  sequence: number,
): string {
  const typeCode = item.request_type_code?.toLowerCase() || '';
  let prefix = 'ESARF';
  if (typeCode === 'leave') {
    prefix = 'LEAVE';
  } else if (typeCode === 'discount' || typeCode === 'charge') {
    prefix = 'PERK';
  }

  const dateVal = item.submitted_at || item.date_from || item.start_date || item.created_at;
  const year = dateVal ? new Date(dateVal).getFullYear() : new Date().getFullYear();
  const validYear = Number.isNaN(year) ? new Date().getFullYear() : year;
  const seqStr = String(sequence || 1).padStart(3, '0');

  return `${prefix}-${validYear}-${seqStr}`;
}

function normalizeTransactionToken(token: string): string {
  const cleaned = token.trim();
  const lower = cleaned.toLowerCase();

  if (lower.includes('official business') || lower === 'ob') return 'OB';
  if (lower.includes('undertime') || lower === 'ut') return 'UT';
  if (lower.includes('overtime') || lower === 'ot') return 'OT';
  if (lower.includes('failure to punch') || lower === 'fio') return 'FIO';
  if (lower === 'use_offset' || lower === 'use offset') return 'Use Offset';
  if (lower.includes('offset')) return 'Offset';

  return cleaned;
}

export function formatUnifiedRequestType(
  item: {
    request_type_code?: string | null;
    request_type_name?: string | null;
    transaction_type?: string | null;
    leave_type?: string | null;
    reason?: string | null;
    date_from?: string | null;
    date_to?: string | null;
    time_from?: string | null;
    time_to?: string | null;
    total_hours?: number | null;
  },
): string {
  if (item.request_type_code === 'leave') {
    return item.leave_type ? `${item.leave_type} Leave` : 'Leave Request';
  }
  if (item.request_type_code === 'discount') return 'Employee Discount';
  if (item.request_type_code === 'charge') return 'Employee Charge';

  const rawTokens: string[] = [];

  if (item.transaction_type && item.transaction_type.trim()) {
    const parts = item.transaction_type.split(/[,/]+/).map((s) => s.trim()).filter(Boolean);
    rawTokens.push(...parts);
  } else {
    const parsed = parseEsarfEntries(item);
    if (parsed.length > 0) {
      parsed.forEach((e) => {
        if (e.transactionLabel && e.transactionLabel !== 'ESARF Request') {
          const parts = e.transactionLabel.split(/[,/]+/).map((s) => s.trim()).filter(Boolean);
          rawTokens.push(...parts);
        }
      });
    }
  }

  const normalizedTokens = rawTokens
    .map(normalizeTransactionToken)
    .filter((token) => Boolean(token) && token !== 'ESARF Request');

  const uniqueTokens = Array.from(new Set(normalizedTokens));
  if (uniqueTokens.length > 0) {
    return uniqueTokens.join(' / ');
  }

  if (item.request_type_code === 'overtime') return 'OT';
  if (item.request_type_code === 'offset_earn') return 'Offset';
  if (item.request_type_code === 'use_offset') return 'Use Offset';
  return item.request_type_name || 'ESARF Request';
}

export function parseEsarfEntries(item: {
  date_from?: string | null;
  date_to?: string | null;
  time_from?: string | null;
  time_to?: string | null;
  total_hours?: number | null;
  transaction_type?: string | null;
  reason?: string | null;
  time_schedule?: string | null;
  day_off?: string | null;
}): ParsedEsarfEntry[] {
  const rawReason = item.reason || '';

  if (rawReason.includes('[Entry ')) {
    const blocks = rawReason.split(/\[Entry\s+/).filter((b) => b.trim().length > 0);
    const parsedEntries: ParsedEsarfEntry[] = [];

    blocks.forEach((block, idx) => {
      const fullText = `[Entry ${block.trim()}`;
      const match = fullText.match(/^\[Entry\s+(\d+)\]\s*\(([^)]+)\)\s*(.*?)\s*\(([^)]+)\):\s*([\s\S]*)$/);

      if (match) {
        const entryNum = parseInt(match[1], 10) || idx + 1;
        let transactionLabel = match[2].trim();
        if (blocks.length === 1 && item.transaction_type && item.transaction_type.trim()) {
          transactionLabel = formatUnifiedRequestType(item);
        } else {
          const tokens = transactionLabel.split(/[,/]+/).map((s) => normalizeTransactionToken(s)).filter(Boolean);
          if (tokens.length > 0) {
            transactionLabel = Array.from(new Set(tokens)).join(' / ');
          }
        }
        const dateTimeChunk = match[3].trim();
        const hoursStr = match[4].replace(/hrs?/i, '').trim();
        const rawReasonText = match[5].trim();
        const isEntryRejected = fullText.includes('[REJECTED]') || fullText.toLowerCase().includes('status: rejected');

        const actualMatch = rawReasonText.match(/\[Actual:\s*([\d.]+)\s*hrs?\]/i);
        let actualHoursStr: string | undefined = actualMatch ? actualMatch[1] : undefined;

        const proofMatch = rawReasonText.match(/\[Proof:\s*([^\]]+)\]/i);
        let proofUrl: string | undefined = proofMatch ? proofMatch[1].trim() : undefined;
        const proofTimeMatch = rawReasonText.match(/\[ProofTime:\s*([^\]]+)\]/i);
        let proofTime: string | undefined = proofTimeMatch ? proofTimeMatch[1].trim() : undefined;
        const proofLocMatch = rawReasonText.match(/\[ProofLoc:\s*([^\]]+)\]/i);
        let proofLocation: string | undefined = proofLocMatch ? proofLocMatch[1].trim() : undefined;
        const proofIdMatch = rawReasonText.match(/\[ProofId:\s*([^\]]+)\]/i);
        let proofId: string | undefined = proofIdMatch ? proofIdMatch[1].trim() : undefined;

        let cleanReasonText = rawReasonText
          .replace(/\[Actual:\s*[\d.]+\s*hrs?\]\s*/gi, '')
          .replace(/\[Proof:\s*[^\]]+\]\s*/gi, '')
          .replace(/\[ProofTime:\s*[^\]]+\]\s*/gi, '')
          .replace(/\[ProofLoc:\s*[^\]]+\]\s*/gi, '')
          .replace(/\[ProofId:\s*[^\]]+\]\s*/gi, '')
          .trim();

        let dateStr = '';
        let timeFromStr = '';
        let timeToStr = '';

        const chunkParts = dateTimeChunk.split(/\s+/);
        if (chunkParts.length >= 3) {
          dateStr = chunkParts[0];
          const timeRest = chunkParts.slice(1).join(' ');
          const timeSplit = timeRest.split(/\s*-\s*/);
          if (timeSplit.length >= 2) {
            timeFromStr = timeSplit[0].trim();
            timeToStr = timeSplit[1].trim();
          } else {
            timeFromStr = timeRest;
          }
        } else if (chunkParts.length === 2) {
          dateStr = chunkParts[0];
          timeFromStr = chunkParts[1];
        } else {
          dateStr = dateTimeChunk;
        }

        const isEntryOffset =
          isOffsetEarnTransaction(transactionLabel) ||
          isOffsetEarnTransaction(match[2]);

        if (isEntryOffset) {
          let resolvedDate = item.date_from;
          if (dateStr && dateStr !== '--') {
            const parsedRange = parseEsarfDateRangeStringToYMD(dateStr);
            if (parsedRange?.dateFrom) {
              resolvedDate = parsedRange.dateFrom;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              resolvedDate = dateStr;
            }
          }

          const computedOt = computeOffsetOvertimeHours({
            timeFrom: timeFromStr,
            timeTo: timeToStr,
            dateFrom: resolvedDate,
            timeSchedule: item.time_schedule,
            dayOff: item.day_off,
          });

          if (actualMatch) {
            actualHoursStr = actualMatch[1];
          } else if (computedOt !== null && computedOt > 0) {
            actualHoursStr = computedOt.toFixed(2);
          }
        }

        parsedEntries.push({
          index: entryNum,
          transactionLabel,
          dateStr: dateStr || '--',
          timeFromStr: timeFromStr || '--',
          timeToStr: timeToStr || '--',
          totalHours: hoursStr || '0',
          actualHours: actualHoursStr,
          reason: cleanReasonText || 'No reason provided.',
          isRejected: isEntryRejected,
          proofUrl,
          proofTime,
          proofLocation,
          proofId,
        });
      }
    });

    if (parsedEntries.length > 0) {
      return parsedEntries;
    }
  }

  // Fallback for single entry or legacy format
  const dateStr = formatEsarfDateRange(item.date_from, item.date_to);
  const formatTime = (t?: string | null) => {
    if (!t) return '--:--';
    const parts = t.split(':');
    if (parts.length < 2) return t;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    if (parts.length >= 3 && parts[2]) {
      return `${String(h).padStart(2, '0')}:${m}:${parts[2]} ${ampm}`;
    }
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  };

  const actualMatch = rawReason.match(/\[Actual:\s*([\d.]+)\s*hrs?\]/i);
  let actualHoursStr: string | undefined = actualMatch ? actualMatch[1] : undefined;
  const proofMatch = rawReason.match(/\[Proof:\s*([^\]]+)\]/i);
  let proofUrl: string | undefined = proofMatch ? proofMatch[1].trim() : undefined;
  const proofTimeMatch = rawReason.match(/\[ProofTime:\s*([^\]]+)\]/i);
  let proofTime: string | undefined = proofTimeMatch ? proofTimeMatch[1].trim() : undefined;
  const proofLocMatch = rawReason.match(/\[ProofLoc:\s*([^\]]+)\]/i);
  let proofLocation: string | undefined = proofLocMatch ? proofLocMatch[1].trim() : undefined;
  const proofIdMatch = rawReason.match(/\[ProofId:\s*([^\]]+)\]/i);
  let proofId: string | undefined = proofIdMatch ? proofIdMatch[1].trim() : undefined;

  const cleanReason = rawReason
    .replace(/\[Actual:\s*[\d.]+\s*hrs?\]\s*/gi, '')
    .replace(/\[Proof:\s*[^\]]+\]\s*/gi, '')
    .replace(/\[ProofTime:\s*[^\]]+\]\s*/gi, '')
    .replace(/\[ProofLoc:\s*[^\]]+\]\s*/gi, '')
    .replace(/\[ProofId:\s*[^\]]+\]\s*/gi, '')
    .trim();

  const timeFromStr = formatTime(item.time_from);
  const timeToStr = formatTime(item.time_to);
  const totalHours = item.total_hours !== null && item.total_hours !== undefined ? String(item.total_hours) : '0';
  const transactionLabel = formatUnifiedRequestType(item);

  const isOffset =
    isOffsetEarnTransaction(transactionLabel) ||
    isOffsetEarnTransaction(item.transaction_type) ||
    (item as any).request_type_code === 'offset_earn';

  if (isOffset) {
    const computedOt = computeOffsetOvertimeHours({
      timeFrom: item.time_from || timeFromStr,
      timeTo: item.time_to || timeToStr,
      dateFrom: item.date_from,
      timeSchedule: item.time_schedule,
      dayOff: item.day_off,
    });

    if (actualMatch) {
      actualHoursStr = actualMatch[1];
    } else if (computedOt !== null && computedOt > 0) {
      actualHoursStr = computedOt.toFixed(2);
    }
  }

  return [
    {
      index: 1,
      transactionLabel,
      dateStr,
      timeFromStr,
      timeToStr,
      totalHours,
      actualHours: actualHoursStr,
      reason: cleanReason || 'No reason provided.',
      isRejected: rawReason.includes('[REJECTED]'),
      proofUrl,
      proofTime,
      proofLocation,
      proofId,
    },
  ];
}

export function isOtOrOffsetTransaction(label?: string | null): boolean {
  if (!label) return false;
  const l = label.trim().toLowerCase();

  // Check if it has OT (Overtime)
  const hasOt = l.includes('overtime') || /\b(ot)\b/i.test(l);

  // Check if it has Offset Earn (and not only "Use Offset")
  const labelWithoutUseOffset = l.replace(/use[_\s-]?offset/gi, '');
  const hasOffsetEarn = labelWithoutUseOffset.includes('offset');

  // Must have OT or Offset (alone or in combination with OB/FIO)
  return hasOt || hasOffsetEarn;
}

export function isRequestEditable(
  item: { request_type_code?: string | null; transaction_type?: string | null } | null,
  entries: ParsedEsarfEntry[],
): boolean {
  if (!item) return false;
  const rtc = item.request_type_code?.toLowerCase();
  if (rtc === 'leave') {
    return false;
  }

  if (entries.length === 0) {
    return isOtOrOffsetTransaction(item.transaction_type);
  }

  // Editable if at least one entry has OT or Offset (alone or combined with OB/FIO, e.g. OB/FIO/OT, OB/FIO/Offset).
  // If the request is only OB, FIO, UT, and use offset (no OT or Offset), it will return false.
  return entries.some((e) => isOtOrOffsetTransaction(e.transactionLabel));
}

export const isOvertimeOrOffset = isOtOrOffsetTransaction;

export function computeEffectiveTotalHours(
  entries: ParsedEsarfEntry[],
  rejectedIndices: number[],
  adjustedHoursMap: Record<number, string>,
  originalTotalHours: number | null,
): number {
  if (entries.length === 0) {
    return originalTotalHours ?? 0;
  }

  const activeEntries = entries.filter((e) => !rejectedIndices.includes(e.index));
  if (activeEntries.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const entry of activeEntries) {
    const rawVal =
      adjustedHoursMap[entry.index] !== undefined && adjustedHoursMap[entry.index].trim() !== ''
        ? adjustedHoursMap[entry.index]
        : entry.totalHours;
    const hrs = parseFloat(rawVal) || 0;
    sum += hrs;
  }

  return Math.round(sum * 100) / 100;
}

export function buildUpdatedReasonText(
  currentReason: string | null,
  entries: ParsedEsarfEntry[],
  adjustedHoursMap: Record<number, string>,
  rejectedIndices: number[],
): string {
  let text = currentReason || '';
  if (!text) return text;

  if (text.includes('[Entry ')) {
    entries.forEach((entry) => {
      const idx = entry.index;
      const isRejected = rejectedIndices.includes(idx);
      const hasAdjustedHours =
        adjustedHoursMap[idx] !== undefined && adjustedHoursMap[idx].trim() !== '';

      if (hasAdjustedHours) {
        const newHrs = parseFloat(adjustedHoursMap[idx]) || 0;
        const newHrsFormatted = Number.isInteger(newHrs) ? newHrs.toFixed(2) : String(newHrs);
        const entryRegex = new RegExp(`(\\[Entry\\s+${idx}\\][^\n]*?\\()([0-9.]+\\s*hrs?\\))`, 'i');
        if (text.match(entryRegex)) {
          text = text.replace(entryRegex, `$1${newHrsFormatted} hrs)`);
        }
      }

      if (isRejected && !text.match(new RegExp(`\\[Entry\\s+${idx}\\][^\n]*\\[REJECTED\\]`, 'i'))) {
        const regex = new RegExp(`(\\[Entry\\s+${idx}\\][^\n]*)`, 'gi');
        if (text.match(regex)) {
          text = text.replace(regex, `$1 [REJECTED]`);
        } else {
          text = `${text}\n[Entry ${idx}] [REJECTED]`;
        }
      }
    });
    return text;
  }

  return text;
}

export type TimelineStep = {
  title: string;
  subtitle: string;
  date?: string;
  time?: string;
  tone?: 'warning' | 'success' | 'danger' | 'muted' | string;
};

export function HorizontalApprovalTimeline({ steps }: { steps: TimelineStep[] }) {
  const approvalSteps = (steps || []).filter(
    (s) =>
      s.title.toLowerCase() !== 'submitted' &&
      !s.subtitle.toLowerCase().includes('submitted'),
  );

  if (approvalSteps.length === 0) return null;

  return (
    <View style={styles.timelineSubPanel}>
      <View style={styles.timelineHeaderRow}>
        <Users size={14} color="#64748b" strokeWidth={2.2} />
        <Text style={styles.timelineHeaderTitle}>Approval Timeline</Text>
      </View>

      <View style={styles.stepperContainer}>
        {approvalSteps.length > 1 ? <View style={styles.stepperLineTrack} /> : null}

        <View style={styles.stepperColumnsRow}>
          {approvalSteps.map((step, idx) => {
            const isGreen = step.tone === 'approved' || step.tone === 'success';
            const isYellow = step.tone === 'pending' || step.tone === 'warning';
            const isRed = step.tone === 'rejected' || step.tone === 'danger';
            const dotColor = isGreen ? '#22c55e' : isYellow ? '#eab308' : isRed ? '#ef4444' : '#cbd5e1';

            return (
              <View key={idx} style={styles.stepperColumn}>
                <View style={[styles.stepperDot, { backgroundColor: dotColor }]} />
                <Text style={styles.stepTitleText} numberOfLines={2}>
                  {step.title}
                </Text>
                <Text style={styles.stepSubtitleText} numberOfLines={1}>
                  {step.subtitle}
                </Text>
                {step.date ? (
                  <Text style={styles.stepDateText} numberOfLines={1}>
                    {step.date}
                  </Text>
                ) : null}
                {step.time ? (
                  <Text style={styles.stepTimeText} numberOfLines={1}>
                    {step.time}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export function EsarfRequestInfoPanel({
  transactionType,
  timeSchedule,
  dayOff,
  payrollClass,
}: {
  transactionType?: string | null;
  timeSchedule?: string | null;
  dayOff?: string | null;
  payrollClass?: string | null;
}) {
  return (
    <View style={styles.requestInfoSection}>
      <View style={styles.requestInfoHeaderRow}>
        <FileText size={16} color="#0f172a" strokeWidth={2.2} />
        <Text style={styles.requestInfoTitle}>Request Information</Text>
      </View>

      <View style={styles.infoPanelBox}>
        {transactionType ? (
          <>
            <View style={styles.infoRow}>
              <View style={styles.infoLeft}>
                <FileText size={16} color="#64748b" strokeWidth={2} />
                <Text style={styles.infoLabel}>Transaction Type</Text>
              </View>
              <Text style={styles.infoValue}>{transactionType}</Text>
            </View>
            <View style={styles.infoDivider} />
          </>
        ) : null}

        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Clock3 size={16} color="#64748b" strokeWidth={2} />
            <Text style={styles.infoLabel}>Time Schedule</Text>
          </View>
          <Text style={styles.infoValue}>{timeSchedule || 'N/A'}</Text>
        </View>

        <View style={styles.infoDivider} />

        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <CalendarDays size={16} color="#64748b" strokeWidth={2} />
            <Text style={styles.infoLabel}>Day Off</Text>
          </View>
          <Text style={styles.infoValue}>{dayOff || 'N/A'}</Text>
        </View>

        <View style={styles.infoDivider} />

        <View style={styles.infoRow}>
          <View style={styles.infoLeft}>
            <Users size={16} color="#64748b" strokeWidth={2} />
            <Text style={styles.infoLabel}>Payroll Class</Text>
          </View>
          <Text style={styles.infoValue}>{payrollClass || 'N/A'}</Text>
        </View>
      </View>
    </View>
  );
}

export function EsarfCardView({
  entry,
  timelineRows,
  showCheckbox,
  isSelected,
  isRejected,
  onToggleSelect,
  onToggleReject,
  hideTimeline,
  isDisabled,
  isEditableHours,
  adjustedHours,
  onHoursChange,
}: {
  entry: ParsedEsarfEntry;
  timelineRows?: TimelineStep[];
  showCheckbox?: boolean;
  isSelected?: boolean;
  isRejected?: boolean;
  onToggleSelect?: () => void;
  onToggleReject?: () => void;
  hideTimeline?: boolean;
  isDisabled?: boolean;
  isEditableHours?: boolean;
  adjustedHours?: string;
  onHoursChange?: (val: string) => void;
}) {
  const [previewProofUrl, setPreviewProofUrl] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [isHoursInputFocused, setIsHoursInputFocused] = useState(false);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [resolvedThumbUri, setResolvedThumbUri] = useState<string>('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(false);
  const [modalFallbackAttempted, setModalFallbackAttempted] = useState(false);
  const [modalImageUri, setModalImageUri] = useState<string>('');
  const [proofDetails, setProofDetails] = useState<PhotoProofItem | null>(null);

  const effectiveProofUrl =
    (proofDetails?.driveFileId ? `https://lh3.googleusercontent.com/d/${proofDetails.driveFileId}=w1000` : null) ||
    (proofDetails?.photoUri && proofDetails.photoUri.startsWith('http') ? proofDetails.photoUri : null) ||
    proofDetails?.driveWebViewLink ||
    (entry.proofUrl && entry.proofUrl.startsWith('http') ? entry.proofUrl : null) ||
    entry.proofUrl ||
    '';

  const effectiveExternalUrl =
    proofDetails?.driveWebViewLink ||
    (proofDetails?.driveFileId ? `https://drive.google.com/file/d/${proofDetails.driveFileId}/view` : null) ||
    (previewProofUrl ? getExternalProofWebUrl(previewProofUrl) : '') ||
    (entry.proofUrl ? getExternalProofWebUrl(entry.proofUrl) : '');

  const directThumbUrl = effectiveProofUrl ? getDirectProofImageUrl(effectiveProofUrl) : '';

  useEffect(() => {
    let active = true;
    if (!entry.proofUrl && !entry.proofId && !entry.proofTime) {
      setProofDetails(null);
      return;
    }

    fetchPhotoProofDetails(entry.proofUrl, {
      timestamp: entry.proofTime,
      locationText: entry.proofLocation,
      proofId: entry.proofId,
      fallbackDateStr: entry.dateStr,
      fallbackTimeStr: entry.timeFromStr,
    }).then((details) => {
      if (active && details) {
        setProofDetails(details);
      }
    });

    return () => {
      active = false;
    };
  }, [entry.proofUrl, entry.proofTime, entry.proofLocation, entry.proofId, entry.dateStr, entry.timeFromStr]);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    const sourceUrl = effectiveProofUrl || entry.proofUrl;
    if (!sourceUrl) {
      setResolvedThumbUri('');
      return;
    }

    const direct = getDirectProofImageUrl(sourceUrl);
    setThumbLoading(true);
    setThumbError(false);

    if (Platform.OS === 'web' && typeof fetch !== 'undefined') {
      fetchProofImageAsBlobOrDataUri(direct)
        .then((resolved) => {
          if (active) {
            if (resolved.startsWith('blob:')) {
              createdUrl = resolved;
            }
            setResolvedThumbUri(resolved);
            setThumbLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            setResolvedThumbUri(direct);
            setThumbLoading(false);
          }
        });
    } else {
      setResolvedThumbUri(direct);
      setThumbLoading(false);
    }

    return () => {
      active = false;
      if (createdUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [entry.proofUrl, effectiveProofUrl]);

  const openProofModal = (rawUrl?: string) => {
    const targetUrl =
      (proofDetails?.driveFileId ? `https://lh3.googleusercontent.com/d/${proofDetails.driveFileId}=w1000` : null) ||
      (proofDetails?.photoUri && proofDetails.photoUri.startsWith('http') ? proofDetails.photoUri : null) ||
      proofDetails?.driveWebViewLink ||
      rawUrl ||
      effectiveProofUrl ||
      '';
    const direct = getDirectProofImageUrl(targetUrl);
    setModalImageUri(direct);
    setModalLoading(true);
    setModalError(false);
    setModalFallbackAttempted(false);
    setPreviewProofUrl(targetUrl);

    if (Platform.OS === 'web' && typeof fetch !== 'undefined') {
      fetchProofImageAsBlobOrDataUri(direct)
        .then((resolved) => {
          setModalImageUri(resolved);
          setModalLoading(false);
        })
        .catch(() => {
          // let fallback direct URL attempt
        });
    }
  };

  const handleModalImageError = () => {
    const driveId =
      extractDriveFileId(previewProofUrl) ||
      extractDriveFileId(proofDetails?.driveFileId) ||
      extractDriveFileId(proofDetails?.driveWebViewLink) ||
      extractDriveFileId(proofDetails?.photoUri) ||
      extractDriveFileId(entry.proofUrl);

    if (!modalFallbackAttempted && driveId) {
      setModalFallbackAttempted(true);
      const fallbackUrl = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
      setModalImageUri(fallbackUrl);
      if (Platform.OS === 'web' && typeof fetch !== 'undefined') {
        fetchProofImageAsBlobOrDataUri(fallbackUrl)
          .then((resolved) => {
            setModalImageUri(resolved);
            setModalLoading(false);
          })
          .catch(() => {
            setModalLoading(false);
            setModalError(true);
          });
      }
    } else if (
      proofDetails?.photoUri &&
      proofDetails.photoUri.startsWith('http') &&
      proofDetails.photoUri !== modalImageUri &&
      !modalFallbackAttempted
    ) {
      setModalFallbackAttempted(true);
      setModalImageUri(proofDetails.photoUri);
      setModalLoading(false);
    } else {
      setModalLoading(false);
      setModalError(true);
    }
  };

  const isEntryRejected = isRejected ?? entry.isRejected ?? false;
  const isLocked = isDisabled || entry.isRejected;
  const isUseOffset =
    entry.transactionLabel?.toLowerCase().includes('use offset') ||
    entry.transactionLabel?.toLowerCase().includes('use_offset');

  const adjustedTimelineRows = React.useMemo(() => {
    if (!timelineRows) return undefined;

    let rows = timelineRows;
    if (isUseOffset) {
      rows = rows.filter((s) => {
        const isSub = s.title.toLowerCase() === 'submitted' || s.subtitle.toLowerCase().includes('submitted');
        if (isSub) return true;
        return !s.title.toLowerCase().includes('level 2') && !s.subtitle.toLowerCase().includes('l2');
      });
      const nonSubmitted = rows.filter((s) => s.title.toLowerCase() !== 'submitted' && !s.subtitle.toLowerCase().includes('submitted'));
      if (nonSubmitted.length > 1) {
        const firstApprover = nonSubmitted[0];
        const submittedStep = rows.find((s) => s.title.toLowerCase() === 'submitted' || s.subtitle.toLowerCase().includes('submitted'));
        rows = submittedStep ? [submittedStep, firstApprover] : [firstApprover];
      }
    }

    if (!isEntryRejected) return rows;

    const hasPending = rows.some((s) => s.subtitle.toLowerCase().includes('pending'));
    if (hasPending) {
      return rows.map((step) => {
        if (step.subtitle.toLowerCase().includes('pending')) {
          const levelMatch = step.subtitle.match(/L\d+/);
          const levelPrefix = levelMatch ? `${levelMatch[0]} • ` : '';
          return {
            ...step,
            subtitle: `${levelPrefix}Rejected`,
            tone: 'danger',
          };
        }
        return step;
      });
    }

    let lastApproverIndex = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const s = rows[i];
      if (s.title.toLowerCase() !== 'submitted' && !s.subtitle.toLowerCase().includes('submitted')) {
        lastApproverIndex = i;
        break;
      }
    }

    return rows.map((step, idx) => {
      if (idx === lastApproverIndex) {
        const levelMatch = step.subtitle.match(/L\d+/);
        const levelPrefix = levelMatch ? `${levelMatch[0]} • ` : '';
        return {
          ...step,
          subtitle: `${levelPrefix}Rejected`,
          tone: 'danger',
        };
      }
      return step;
    });
  }, [timelineRows, isEntryRejected, isUseOffset]);

  return (
    <View style={[styles.entryCard, isEntryRejected && styles.entryCardRejected]}>
      {/* Card Header: Yellow Square Badge + Transaction Label + Actions */}
      <View style={styles.entryCardHeader}>
        <View style={styles.headerLeft}>
          <View style={[styles.badgeSquare, isEntryRejected && styles.badgeSquareRejected]}>
            <Text style={styles.badgeText}>{entry.index}</Text>
          </View>
          <Text style={[styles.transactionLabel, isEntryRejected && styles.dashedText]}>
            {entry.transactionLabel}
          </Text>
          {isEntryRejected ? (
            <View style={styles.rejectedBadge}>
              <Text style={styles.rejectedBadgeText}>REJECTED</Text>
            </View>
          ) : null}
        </View>

        {showCheckbox ? (
          <View style={styles.headerActionsRight}>
            {onToggleReject ? (
              <Pressable
                disabled={isLocked}
                style={[
                  styles.entryActionBtn,
                  styles.entryRejectActionBtn,
                  isEntryRejected && styles.entryRejectActionActive,
                  isLocked && { opacity: 0.4 },
                ]}
                onPress={onToggleReject}
                hitSlop={8}
              >
                <X size={13} color={isEntryRejected ? '#ffffff' : '#dc2626'} strokeWidth={2.5} />
              </Pressable>
            ) : null}
            <Pressable
              disabled={isLocked}
              style={[
                styles.cardCheckbox,
                isSelected && styles.cardCheckboxSelected,
                isLocked && { opacity: 0.4 },
              ]}
              onPress={onToggleSelect}
              hitSlop={8}
            >
              {isSelected ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />

      {/* 2-Row Details Grid */}
      <View style={styles.gridRow}>
        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Date From-To</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.dateStr}</Text>
        </View>

        <View style={styles.gridCol}>
          <View style={styles.gridLabelRow}>
            <Text style={styles.gridLabel}>Total Hrs.</Text>
            {isEditableHours && !isEntryRejected && !isDisabled ? (
              <View style={styles.adjustablePill}>
                <Edit3 size={10} color="#854d0e" strokeWidth={2.4} />
                <Text style={styles.adjustablePillText}>Editable</Text>
              </View>
            ) : null}
          </View>

          {isEditableHours && !isEntryRejected && !isDisabled ? (
            <View>
              <View style={styles.editableHoursRow}>
                <Pressable
                  style={[
                    styles.hoursInputShell,
                    isHoursInputFocused && styles.hoursInputShellFocused,
                  ]}
                  onPress={() => inputRef.current?.focus()}
                >
                  <TextInput
                    ref={inputRef}
                    style={styles.hoursInputField}
                    value={
                      adjustedHours !== undefined
                        ? adjustedHours
                        : entry.totalHours != null
                        ? String(entry.totalHours)
                        : ''
                    }
                    onChangeText={onHoursChange}
                    onFocus={() => setIsHoursInputFocused(true)}
                    onBlur={() => setIsHoursInputFocused(false)}
                    keyboardType="decimal-pad"
                    selectTextOnFocus={false}
                    placeholder="0.00"
                    placeholderTextColor="#94a3b8"
                  />
                  <Text style={styles.hoursUnitText}>hrs</Text>
                </Pressable>
                {entry.actualHours ? (
                  <View style={styles.actualHoursBadge}>
                    <Text style={styles.actualHoursBadgeText}>
                      Actual: {formatDisplayHours(entry.actualHours)}h
                    </Text>
                  </View>
                ) : null}
              </View>
              {adjustedHours !== undefined && adjustedHours !== entry.totalHours ? (
                <Text style={styles.originalHoursNote}>
                  Orig: {entry.totalHours} hrs
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.totalHoursValueRow}>
              <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>
                {adjustedHours !== undefined ? adjustedHours : entry.totalHours}
              </Text>
              {entry.actualHours ? (
                <View style={styles.actualHoursBadge}>
                  <Text style={styles.actualHoursBadgeText}>
                    Actual: {formatDisplayHours(entry.actualHours)}h
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <View style={styles.gridRow}>
        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Time From</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.timeFromStr}</Text>
        </View>

        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Time To</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.timeToStr}</Text>
        </View>
      </View>

      {/* Reason Box */}
      <View style={styles.reasonSection}>
        <Text style={styles.reasonLabel}>Reason</Text>
        <View style={[styles.reasonBox, isEntryRejected && styles.reasonBoxRejected]}>
          <Text style={[styles.reasonText, isEntryRejected && styles.dashedText]}>{entry.reason}</Text>
        </View>
      </View>

      {/* Attached Photo Proof */}
      {entry.proofUrl || entry.proofId || proofDetails ? (
        <View style={styles.proofAttachmentSection}>
          <Text style={styles.proofAttachmentLabel}>Attached Photo Proof</Text>
          <Pressable
            style={styles.proofAttachmentCard}
            onPress={() => openProofModal(effectiveProofUrl || entry.proofUrl!)}
          >
            <View style={styles.proofThumbWrap}>
              {thumbLoading ? (
                <View style={styles.proofThumbOverlay}>
                  <ActivityIndicator size="small" color="#2563eb" />
                </View>
              ) : null}
              {thumbError ? (
                <View style={styles.proofThumbOverlay}>
                  <ImageIcon size={18} color="#94a3b8" />
                </View>
              ) : Platform.OS === 'web' ? (
                React.createElement('img', {
                  src: resolvedThumbUri || directThumbUrl,
                  referrerPolicy: 'no-referrer',
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: thumbLoading ? 'none' : 'block',
                  },
                  onLoad: () => setThumbLoading(false),
                  onError: () => {
                    setThumbLoading(false);
                    setThumbError(true);
                  },
                })
              ) : (
                <Image
                  source={{ uri: resolvedThumbUri || directThumbUrl }}
                  style={styles.proofThumbImage}
                  resizeMode="cover"
                  onLoadStart={() => setThumbLoading(true)}
                  onLoadEnd={() => setThumbLoading(false)}
                  onError={() => {
                    setThumbLoading(false);
                    setThumbError(true);
                  }}
                />
              )}
            </View>
            <View style={styles.proofInfoWrap}>
              <View style={styles.proofBadgeRow}>
                <Camera size={13} color="#2563eb" strokeWidth={2.2} />
                <Text style={styles.proofBadgeText}>
                  {proofDetails?.dateFormatted && proofDetails?.timeDigits
                    ? `${proofDetails.dateFormatted} • ${proofDetails.timeDigits} ${proofDetails.timePeriod}`
                    : 'Photo Proof Attached'}
                </Text>
              </View>
              {proofDetails?.locationText ? (
                <View style={styles.proofCardLocationRow}>
                  <MapPin size={11} color="#64748b" strokeWidth={2} />
                  <Text style={styles.proofCardLocationText} numberOfLines={1}>
                    {proofDetails.locationText}
                  </Text>
                </View>
              ) : (
                <Text style={styles.proofActionHint}>Tap to view proof with details</Text>
              )}
            </View>
            <Eye size={18} color="#64748b" strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}

      {/* Proof Preview Modal */}
      {previewProofUrl ? (
        <Modal
          visible={Boolean(previewProofUrl)}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewProofUrl(null)}
        >
          <View style={styles.proofModalBackdrop}>
            <View style={styles.proofModalCard}>
              <View style={styles.proofModalHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Camera size={16} color="#0284c7" strokeWidth={2.2} />
                    <Text style={styles.proofModalTitle}>Attached Proof (Request #{entry.index})</Text>
                  </View>
                  {proofDetails ? (
                    <Text style={styles.proofModalSubtitle} numberOfLines={1}>
                      {proofDetails.dateFormatted} • {proofDetails.timeDigits} {proofDetails.timePeriod}
                      {proofDetails.employeeName ? ` • ${proofDetails.employeeName}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setPreviewProofUrl(null)}
                  style={styles.proofModalCloseBtn}
                  hitSlop={8}
                  accessibilityLabel="Close proof preview"
                >
                  <X size={20} color="#64748b" strokeWidth={2.4} />
                </Pressable>
              </View>

              <View style={styles.proofModalBody}>
                {modalLoading ? (
                  <View style={styles.proofModalLoaderWrap}>
                    <ActivityIndicator size="large" color="#38bdf8" />
                    <Text style={styles.proofModalLoaderText}>Loading proof image...</Text>
                  </View>
                ) : null}

                {modalError ? (
                  <View style={styles.proofModalErrorWrap}>
                    <ImageIcon size={44} color="#64748b" strokeWidth={1.8} />
                    <Text style={styles.proofModalErrorTitle}>Preview Unavailable</Text>
                    <Text style={styles.proofModalErrorSubtitle}>
                      The photo proof could not be rendered directly. Tap below to view in your browser.
                    </Text>
                  </View>
                ) : Platform.OS === 'web' ? (
                  React.createElement('img', {
                    src: modalImageUri || getDirectProofImageUrl(previewProofUrl),
                    referrerPolicy: 'no-referrer',
                    style: {
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: modalLoading ? 'none' : 'block',
                    },
                    onLoad: () => setModalLoading(false),
                    onError: handleModalImageError,
                  })
                ) : (
                  <Image
                    source={{ uri: modalImageUri || getDirectProofImageUrl(previewProofUrl) }}
                    style={styles.proofModalImage}
                    resizeMode="contain"
                    onLoadStart={() => setModalLoading(true)}
                    onLoadEnd={() => setModalLoading(false)}
                    onError={handleModalImageError}
                  />
                )}

                {/* Watermark Overlay (Bottom-Left) */}
                {!modalLoading && !modalError && proofDetails ? (
                  <>
                    <View style={styles.proofWatermarkGradient} pointerEvents="none" />
                    <View style={styles.proofWatermarkContainer} pointerEvents="none">
                      <View style={styles.proofWatermarkTimeRow}>
                        <Text style={styles.proofWatermarkTime}>
                          {proofDetails.timeDigits}
                          <Text style={styles.proofWatermarkPeriod}> {proofDetails.timePeriod}</Text>
                        </Text>
                        <View style={styles.proofWatermarkDivider} />
                        <View style={styles.proofWatermarkDateCol}>
                          <Text style={styles.proofWatermarkDate}>{proofDetails.dateFormatted}</Text>
                          <Text style={styles.proofWatermarkDay}>{proofDetails.dayFormatted}</Text>
                        </View>
                      </View>
                      {proofDetails.locationText ? (
                        <View style={styles.proofWatermarkLocationRow}>
                          <Text style={styles.proofWatermarkLocation} numberOfLines={3}>
                            {proofDetails.locationText}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </View>

              <View style={styles.proofModalFooter}>
                {effectiveExternalUrl.startsWith('http') ? (
                  <Pressable
                    style={styles.proofModalExternalBtn}
                    onPress={() => Linking.openURL(effectiveExternalUrl)}
                  >
                    <ExternalLink size={14} color="#ffffff" strokeWidth={2.2} />
                    <Text style={styles.proofModalExternalText}>Open External Link</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.proofModalCloseFooterBtn}
                  onPress={() => setPreviewProofUrl(null)}
                >
                  <Text style={styles.proofModalCloseFooterText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Horizontal Approval Timeline */}
      {!hideTimeline && adjustedTimelineRows && adjustedTimelineRows.length > 0 ? (
        <HorizontalApprovalTimeline steps={adjustedTimelineRows} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  requestInfoSection: {
    marginHorizontal: spacing.md,
    marginTop: 12,
    marginBottom: 12,
  },
  requestInfoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  requestInfoTitle: {
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  infoPanelBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: fontWeights.bold,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
  },
  entryCard: {
    marginHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    padding: 11,
    marginBottom: 10,
  },
  entryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  cardCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCheckboxSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
  },
  badgeSquare: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#eab308',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  transactionLabel: {
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 8,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 8,
  },
  gridCol: {
    flex: 1,
    minWidth: 0,
  },
  gridLabel: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#94a3b8',
    marginBottom: 3,
  },
  gridLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  adjustablePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef9c3',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  adjustablePillText: {
    fontSize: 9,
    fontWeight: fontWeights.bold,
    color: '#854d0e',
  },
  hoursInputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 34,
    width: 96,
    minWidth: 92,
    maxWidth: 110,
    overflow: 'hidden',
  },
  hoursInputShellFocused: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  hoursInputField: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    height: '100%',
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    paddingVertical: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'android'
      ? {
          includeFontPadding: false,
          textAlignVertical: 'center' as const,
        }
      : {}),
    ...(Platform.OS === 'web'
      ? ({
          outlineStyle: 'none',
          outlineWidth: 0,
          outline: 'none',
          boxShadow: 'none',
        } as any)
      : {}),
  },
  hoursUnitText: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#64748b',
    marginLeft: 3,
  },
  originalHoursNote: {
    fontSize: 10,
    color: '#854d0e',
    fontWeight: fontWeights.semibold,
    marginTop: 2,
  },
  totalHoursValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  editableHoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  actualHoursBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignSelf: 'center',
  },
  actualHoursBadgeText: {
    fontSize: 10,
    fontWeight: fontWeights.heavy,
    color: '#1d4ed8',
  },
  gridValue: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  reasonSection: {
    marginTop: 2,
  },
  reasonLabel: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#94a3b8',
    marginBottom: 4,
  },
  reasonBox: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
  },
  reasonText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  timelineSubPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginTop: 10,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  timelineHeaderTitle: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#334155',
  },
  stepperContainer: {
    marginTop: 4,
    paddingVertical: 2,
    position: 'relative',
  },
  stepperLineTrack: {
    position: 'absolute',
    top: 5,
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: '#e2e8f0',
    zIndex: 0,
  },
  stepperColumnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  stepperColumn: {
    flex: 1,
    alignItems: 'flex-start',
    paddingRight: 4,
  },
  stepperDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 6,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  stepTitleText: {
    fontSize: 11,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  stepSubtitleText: {
    fontSize: 10,
    color: '#64748b',
  },
  stepDateText: {
    fontSize: 9,
    color: '#94a3b8',
    marginTop: 2,
  },
  stepTimeText: {
    fontSize: 9,
    color: '#94a3b8',
  },
  entryCardRejected: {
    opacity: 0.65,
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
  },
  badgeSquareRejected: {
    backgroundColor: '#94a3b8',
  },
  dashedText: {
    textDecorationLine: 'line-through',
    color: '#64748b',
  },
  rejectedBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  rejectedBadgeText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    color: '#dc2626',
  },
  headerActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  entryActionBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryRejectActionBtn: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  entryRejectActionActive: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  reasonBoxRejected: {
    backgroundColor: '#f1f5f9',
  },
  proofAttachmentSection: {
    marginTop: 10,
  },
  proofAttachmentLabel: {
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    color: '#64748b',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  proofAttachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  proofThumbWrap: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofThumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  proofThumbImage: {
    width: '100%',
    height: '100%',
  },
  proofInfoWrap: {
    flex: 1,
  },
  proofBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proofBadgeText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#1e293b',
  },
  proofCardLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  proofCardLocationText: {
    fontSize: 11,
    color: '#64748b',
    flex: 1,
  },
  proofActionHint: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  proofModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  proofModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    maxHeight: '92%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  proofModalHeader: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  proofModalTitle: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  proofModalSubtitle: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
    fontWeight: fontWeights.medium,
  },
  proofModalCloseBtn: {
    padding: 4,
  },
  proofModalBody: {
    width: '100%',
    height: 400,
    backgroundColor: '#020617',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  proofWatermarkGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    zIndex: 3,
  },
  proofWatermarkContainer: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    zIndex: 4,
  },
  proofWatermarkTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  proofWatermarkTime: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '300',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  proofWatermarkPeriod: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
    color: '#facc15',
  },
  proofWatermarkDivider: {
    width: 2,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    marginHorizontal: 6,
  },
  proofWatermarkDateCol: {
    justifyContent: 'center',
  },
  proofWatermarkDate: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: fontWeights.semibold,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  proofWatermarkDay: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  proofWatermarkLocationRow: {
    marginTop: 4,
    flexDirection: 'row',
  },
  proofWatermarkLocation: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  proofModalLoaderWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    zIndex: 2,
  },
  proofModalLoaderText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: fontWeights.medium,
  },
  proofModalErrorWrap: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  proofModalErrorTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  proofModalErrorSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },
  proofModalImage: {
    width: '100%',
    height: 400,
    backgroundColor: '#020617',
  },
  proofModalFooter: {
    backgroundColor: '#ffffff',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  proofModalExternalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  proofModalExternalText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.semibold,
  },
  proofModalCloseFooterBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofModalCloseFooterText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: fontWeights.semibold,
  },
});
