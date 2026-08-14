import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CalendarDays, Check, Clock3, FileText, Users, X } from 'lucide-react-native';
import { colors, radius, fontWeights, spacing } from '../theme';
import { formatEsarfDateRange } from '../screens/ApplyEsarfScreen';

export type ParsedEsarfEntry = {
  index: number;
  transactionLabel: string;
  dateStr: string;
  timeFromStr: string;
  timeToStr: string;
  totalHours: string;
  reason: string;
  isRejected?: boolean;
};

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
  }

  const parsed = parseEsarfEntries(item);
  if (parsed.length > 0) {
    parsed.forEach((e) => {
      if (e.transactionLabel && e.transactionLabel !== 'ESARF Request') {
        const parts = e.transactionLabel.split(/[,/]+/).map((s) => s.trim()).filter(Boolean);
        rawTokens.push(...parts);
      }
    });
  }

  const normalizedTokens = rawTokens
    .map(normalizeTransactionToken)
    .filter((token) => Boolean(token) && token !== 'ESARF Request');

  const uniqueTokens = Array.from(new Set(normalizedTokens));
  if (uniqueTokens.length > 0) {
    return uniqueTokens.join(' / ');
  }

  if (item.request_type_code === 'overtime') return 'Overtime (OT)';
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
        const transactionLabel = match[2].trim();
        const dateTimeChunk = match[3].trim();
        const hoursStr = match[4].replace(/hrs?/i, '').trim();
        const reasonText = match[5].trim();
        const isEntryRejected = fullText.includes('[REJECTED]') || fullText.toLowerCase().includes('status: rejected');

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

        parsedEntries.push({
          index: entryNum,
          transactionLabel,
          dateStr: dateStr || '--',
          timeFromStr: timeFromStr || '--',
          timeToStr: timeToStr || '--',
          totalHours: hoursStr || '0',
          reason: reasonText || 'No reason provided.',
          isRejected: isEntryRejected,
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
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  };

  const timeFromStr = formatTime(item.time_from);
  const timeToStr = formatTime(item.time_to);
  const totalHours = item.total_hours !== null && item.total_hours !== undefined ? String(item.total_hours) : '0';
  const transactionLabel = item.transaction_type || 'ESARF Request';

  return [
    {
      index: 1,
      transactionLabel,
      dateStr,
      timeFromStr,
      timeToStr,
      totalHours,
      reason: rawReason.trim() || 'No reason provided.',
      isRejected: rawReason.includes('[REJECTED]'),
    },
  ];
}

export type TimelineStep = {
  title: string;
  subtitle: string;
  date?: string;
  time?: string;
  tone?: string;
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
        <View style={styles.stepperLineTrack} />

        <View style={styles.stepperColumnsRow}>
          {approvalSteps.map((step, idx) => {
            const isGreen = step.tone === 'approved' || step.tone === 'success';
            const isYellow = step.tone === 'pending' || step.tone === 'warning';
            const isRed = step.tone === 'rejected' || step.tone === 'danger';
            const dotColor = isGreen ? '#22c55e' : isYellow ? '#eab308' : isRed ? '#ef4444' : '#cbd5e1';

            return (
              <View key={idx} style={styles.stepperColumn}>
                <View style={[styles.stepperDot, { backgroundColor: dotColor }]} />
                <Text style={styles.stepTitleText} numberOfLines={1}>
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
  timeSchedule,
  dayOff,
  payrollClass,
}: {
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
}) {
  const isEntryRejected = isRejected ?? entry.isRejected ?? false;
  const isLocked = isDisabled || entry.isRejected;

  const adjustedTimelineRows = React.useMemo(() => {
    if (!timelineRows) return undefined;
    if (!isEntryRejected) return timelineRows;

    return timelineRows.map((step) => {
      const isApprovedStep =
        step.tone === 'approved' ||
        step.tone === 'success' ||
        step.title.toLowerCase().includes('approved') ||
        step.subtitle.toLowerCase().includes('approved');

      if (isApprovedStep) {
        return {
          ...step,
          subtitle: 'Rejected',
          tone: 'rejected',
        };
      }
      return step;
    });
  }, [timelineRows, isEntryRejected]);

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

      {/* 4 Column Grid */}
      <View style={styles.gridRow}>
        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Date From-To</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.dateStr}</Text>
        </View>

        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Time From</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.timeFromStr}</Text>
        </View>

        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Time To</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.timeToStr}</Text>
        </View>

        <View style={styles.gridCol}>
          <Text style={styles.gridLabel}>Total Hrs.</Text>
          <Text style={[styles.gridValue, isEntryRejected && styles.dashedText]}>{entry.totalHours}</Text>
        </View>
      </View>

      {/* Reason Box */}
      <View style={styles.reasonSection}>
        <Text style={styles.reasonLabel}>Reason</Text>
        <View style={[styles.reasonBox, isEntryRejected && styles.reasonBoxRejected]}>
          <Text style={[styles.reasonText, isEntryRejected && styles.dashedText]}>{entry.reason}</Text>
        </View>
      </View>

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
    marginBottom: 8,
  },
  gridCol: {
    flex: 1,
  },
  gridLabel: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#94a3b8',
    marginBottom: 3,
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
});
