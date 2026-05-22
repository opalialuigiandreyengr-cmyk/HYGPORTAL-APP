import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CalendarDays, CheckCircle, Clock3, Eye, FileText, RefreshCcw, Search, Users, X, XCircle } from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { decideApprovalStep, loadPendingApprovals, type PendingApproval } from '../services/approvals';
import type { ProfileLoadResult } from '../types/domain';

type CategoryFilter = 'all' | 'esarf' | 'leave';

const pageSize = 10;
const categoryTabs: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'esarf', label: 'ESARF' },
  { key: 'leave', label: 'Leave' },
];

export function NotificationsScreen({
  profileResult,
  onCountChange,
}: {
  profileResult?: ProfileLoadResult | null;
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedApproval, setSelectedApproval] = useState<{ item: PendingApproval; sequence: number } | null>(null);
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading...');
    try {
      const approvals = await loadPendingApprovals();
      setItems(approvals);
      onCountChange?.(approvals.filter(isApprovalCountItem).length);
      setStatus(approvals.length ? '' : 'No pending approvals.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load approvals.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, query]);

  async function decide(item: PendingApproval, decision: 'approved' | 'rejected') {
    setStatus('Processing approval...');
    try {
      await decideApprovalStep(
        item.step_id,
        decision,
        decision === 'rejected' ? 'Rejected from mobile.' : 'Approved from mobile.',
      );
      setSelectedApproval(null);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update approval.');
    }
  }

  const categoryCounts = useMemo(() => {
    return items.reduce(
      (totals, item) => {
        totals.all += 1;
        totals[approvalCategory(item)] += 1;
        return totals;
      },
      { all: 0, esarf: 0, leave: 0 },
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== 'all' && approvalCategory(item) !== activeCategory) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        item.request_id,
        item.request_type_code,
        item.request_type_name,
        item.requester_name,
        item.requester_employee_no,
        item.leave_type,
        item.leave_category,
        item.reason,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [activeCategory, items, query]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [currentPage, filteredItems]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar name={profile?.fullName} photoUrl={profile?.photoUrl} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.filterPanel}>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Search size={16} color={colors.muted} strokeWidth={2.4} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search approvals..."
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                returnKeyType="search"
              />
            </View>
            <Pressable disabled={isLoading} style={styles.refreshButton} onPress={refresh}>
              <RefreshCcw size={15} color={colors.text} strokeWidth={2.6} />
              <Text style={styles.refreshButtonText}>{isLoading ? 'Sync' : 'Refresh'}</Text>
            </Pressable>
          </View>

          <View style={styles.categoryRow}>
            {categoryTabs.map((tab) => {
              const active = activeCategory === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.categoryChip, active ? styles.categoryChipActive : null]}
                  onPress={() => setActiveCategory(tab.key)}
                >
                  <View style={styles.categoryChipContent}>
                    <Text style={[styles.categoryChipText, active ? styles.categoryChipTextActive : null]}>
                      {tab.label}
                    </Text>
                    <View style={[styles.categoryCountBadge, active ? styles.categoryCountBadgeActive : null]}>
                      <Text style={[styles.categoryCountText, active ? styles.categoryCountTextActive : null]}>
                        {categoryCounts[tab.key]}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.pendingBand}>
          <Text style={styles.pendingBandLabel}>Pending approvals</Text>
          <Text style={styles.pendingBandCount}>{filteredItems.length}</Text>
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {paginatedItems.map((item, index) => {
          const sequence = (currentPage - 1) * pageSize + index + 1;
          return (
            <ApprovalCard
              key={item.step_id}
              item={item}
              sequence={sequence}
              onView={() => setSelectedApproval({ item, sequence })}
            />
          );
        })}

        {filteredItems.length > pageSize ? (
          <View style={styles.paginationBar}>
            <Pressable
              disabled={currentPage <= 1}
              style={[styles.paginationButton, currentPage <= 1 ? styles.paginationButtonDisabled : null]}
              onPress={() => setPage((value) => Math.max(1, value - 1))}
            >
              <Text style={styles.paginationButtonText}>Previous</Text>
            </Pressable>
            <View style={styles.paginationCenter}>
              <Text style={styles.paginationText}>Page {currentPage} of {pageCount}</Text>
              <Text style={styles.paginationMeta}>
                {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredItems.length)} of {filteredItems.length}
              </Text>
            </View>
            <Pressable
              disabled={currentPage >= pageCount}
              style={[styles.paginationButton, currentPage >= pageCount ? styles.paginationButtonDisabled : null]}
              onPress={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              <Text style={styles.paginationButtonText}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <ApprovalDetailsSheet
        approval={selectedApproval}
        onClose={() => setSelectedApproval(null)}
        onApprove={(item) => decide(item, 'approved')}
        onReject={(item) => decide(item, 'rejected')}
      />
    </View>
  );
}

function ApprovalCard({
  item,
  sequence,
  onView,
}: {
  item: PendingApproval;
  sequence: number;
  onView: () => void;
}) {
  const requestDate = getApprovalDate(item);

  return (
    <View style={styles.cardOuter}>
      <View style={styles.cardAccent} />
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Avatar name={item.requester_name} size={35} textSize={13} />
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <View style={styles.cardTitleBlock}>
              <Text style={styles.cardCode} numberOfLines={1}>{formatApprovalCode(item, sequence)}</Text>
              <Text style={styles.cardName} numberOfLines={1}>{formatPersonNameWithMiddleInitial(item.requester_name)}</Text>
              <Text style={styles.cardDept}>{item.requester_employee_no || 'No employee no.'}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.statusPill} numberOfLines={1}>PENDING</Text>
              <View style={styles.metaLine}>
                <CalendarDays size={14} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>{formatCompactDate(requestDate)}</Text>
              </View>
              <View style={styles.metaLine}>
                <Clock3 size={14} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {formatSheetTime(item.submitted_at)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.cardBottomRow}>
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{formatApprovalType(item)}</Text>
            </View>
            <Pressable style={styles.viewButton} onPress={onView}>
              <Eye size={15} color={colors.text} strokeWidth={2.3} />
              <Text style={styles.viewText}>View</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function ApprovalDetailsSheet({
  approval,
  onClose,
  onApprove,
  onReject,
}: {
  approval: { item: PendingApproval; sequence: number } | null;
  onClose: () => void;
  onApprove: (item: PendingApproval) => void;
  onReject: (item: PendingApproval) => void;
}) {
  if (!approval) return null;

  const { item, sequence } = approval;
  const isLeave = item.request_type_code === 'leave';

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.detailsSheet}>
          <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.requestSummaryHeader}>
              <View style={styles.requestSummaryText}>
                <Text style={styles.sheetTitle}>{formatApprovalType(item)}</Text>
                <View style={styles.sheetCodeRow}>
                  <Text style={styles.sheetCode}>{formatApprovalDocumentCode(item, sequence)}</Text>
                  <Text style={styles.sheetStatusPill}>PENDING</Text>
                </View>
              </View>
              <Pressable style={styles.sheetIconClose} onPress={onClose}>
                <X size={18} color={colors.text} strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.sheetHeader}>
              <View style={styles.sheetProfileRow}>
                <Avatar name={item.requester_name} size={34} textSize={13} />
                <View style={styles.sheetProfileText}>
                  <Text style={styles.sheetName} numberOfLines={1}>{formatPersonNameWithMiddleInitial(item.requester_name)}</Text>
                  <Text style={styles.sheetDept} numberOfLines={1}>{item.requester_employee_no || 'No employee no.'}</Text>
                </View>
              </View>
              <View style={styles.submittedBlock}>
                <Text style={styles.submittedLabel}>Submitted on</Text>
                <Text style={styles.submittedDate}>{formatSheetDate(item.submitted_at)}</Text>
                <Text style={styles.submittedTime}>{formatSheetTime(item.submitted_at)}</Text>
              </View>
            </View>

            <SectionTitle icon="file" title="Request Information" />
            <View style={styles.detailsList}>
              <DetailRow icon="file" label="Transaction Type" value={formatApprovalType(item)} />
              <DetailRow icon="users" label="Approver Step" value={`Step ${item.step_order}`} />
              {isLeave ? (
                <>
                  <DetailRow icon="file" label="Leave Type" value={item.leave_type || 'N/A'} />
                  <DetailRow icon="calendar" label="Leave Category" value={item.leave_category || 'N/A'} />
                </>
              ) : (
                <DetailRow icon="clock" label="Total Hours" value={formatHours(item.total_hours)} />
              )}
            </View>

            <View style={styles.rangePanel}>
              <View style={styles.panelTitleRow}>
                <CalendarDays size={15} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.panelTitle}>Date & Time Range</Text>
              </View>
              <View style={styles.rangeGrid}>
                <DetailItem label="Date From" value={formatSheetDate(isLeave ? item.start_date : item.date_from)} />
                <DetailItem label="Date To" value={formatSheetDate(isLeave ? item.end_date : item.date_to)} />
                {isLeave ? (
                  <DetailItem label="Total Days" value={`${item.total_days ?? 0}d`} />
                ) : (
                  <>
                    <DetailItem label="Time From" value={formatSheetTime(item.time_from)} />
                    <DetailItem label="Time To" value={formatSheetTime(item.time_to)} />
                  </>
                )}
              </View>
            </View>

            <View style={styles.reasonBlock}>
              <View style={styles.panelTitleRow}>
                <FileText size={15} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.panelTitle}>Reason / Details</Text>
              </View>
              <Text style={styles.reasonText}>{item.reason || 'No reason provided.'}</Text>
            </View>

            <View style={styles.timelineHeader}>
              <Users size={15} color={colors.muted} strokeWidth={2.2} />
              <Text style={styles.panelTitle}>Approval Timeline</Text>
            </View>
            <View style={styles.timelineBlock}>
              <TimelineItem
                title={`Step ${item.step_order}`}
                subtitle="Pending to approve"
                date={formatSheetDate(item.submitted_at)}
                time={formatSheetTime(item.submitted_at)}
                tone="warning"
                isLast
              />
            </View>
          </ScrollView>

          <View style={styles.sheetFooter}>
            <Pressable style={styles.sheetRejectButton} onPress={() => onReject(item)}>
              <XCircle size={16} color={colors.semantic.danger} strokeWidth={2.5} />
              <Text style={styles.sheetRejectText}>Reject</Text>
            </Pressable>
            <Pressable style={styles.sheetApproveButton} onPress={() => onApprove(item)}>
              <CheckCircle size={16} color={colors.surface} strokeWidth={2.5} />
              <Text style={styles.sheetApproveText}>Approve</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SectionTitle({ icon, title }: { icon: 'file' | 'clock' | 'calendar' | 'users'; title: string }) {
  const Icon = getDetailIcon(icon);
  return (
    <View style={styles.sectionTitleRow}>
      <Icon size={15} color={colors.muted} strokeWidth={2.2} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: 'file' | 'clock' | 'calendar' | 'users'; label: string; value: string }) {
  const Icon = getDetailIcon(icon);
  return (
    <View style={styles.detailRow}>
      <Icon size={14} color={colors.muted} strokeWidth={2.2} />
      <Text style={styles.detailRowLabel}>{label}</Text>
      <Text style={styles.detailRowValue}>{value}</Text>
    </View>
  );
}

function TimelineItem({
  title,
  subtitle,
  date,
  time,
  tone,
  isLast,
}: {
  title: string;
  subtitle: string;
  date?: string;
  time?: string;
  tone: 'warning' | 'success' | 'muted';
  isLast?: boolean;
}) {
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineDot, timelineDotStyle(tone)]} />
        {!isLast ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineContent}>
        <View style={styles.timelineTopRow}>
          <View style={styles.timelineTextBlock}>
            <Text style={styles.timelineTitle}>{title}</Text>
            <Text style={styles.timelineSubtitle}>{subtitle}</Text>
          </View>
          {date || time ? (
            <View style={styles.timelineDateRow}>
              {date ? <Text style={styles.timelineDate}>{date}</Text> : null}
              {time ? <Text style={styles.timelineDate}>{time}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function timelineDotStyle(tone: 'warning' | 'success' | 'muted') {
  if (tone === 'warning') return { borderColor: colors.semantic.warning, backgroundColor: colors.surface };
  if (tone === 'success') return { borderColor: colors.semantic.success, backgroundColor: colors.semantic.success };
  return { borderColor: colors.border, backgroundColor: colors.border };
}

function getDetailIcon(icon: 'file' | 'clock' | 'calendar' | 'users') {
  if (icon === 'clock') return Clock3;
  if (icon === 'calendar') return CalendarDays;
  if (icon === 'users') return Users;
  return FileText;
}

function approvalCategory(item: PendingApproval): CategoryFilter {
  return item.request_type_code === 'leave' ? 'leave' : 'esarf';
}

function isApprovalCountItem(item: PendingApproval) {
  return item.request_type_code !== 'employee_perk';
}

function formatApprovalCode(item: PendingApproval, sequence: number) {
  const type = item.request_type_code === 'leave' ? 'LEAVE' : item.request_type_code === 'use_offset' ? 'OFFSET' : 'ESARF';
  return `${type}-${shortRequestId(item.request_id)}-${sequence}`;
}

function formatApprovalDocumentCode(item: PendingApproval, sequence: number) {
  const type = item.request_type_code === 'leave' ? 'LEAVE' : item.request_type_code === 'use_offset' ? 'OFFSET' : 'ESARF';
  const year = item.submitted_at ? new Date(item.submitted_at).getFullYear() : new Date().getFullYear();
  return `${type}-${year}-${String(sequence).padStart(3, '0')}`;
}

function shortRequestId(requestId: string) {
  const numericId = requestId.match(/\d+/g)?.join('').slice(-3);
  if (numericId) return numericId.padStart(3, '0');
  return requestId.slice(-3).toUpperCase();
}

function formatApprovalType(item: PendingApproval) {
  if (item.request_type_code === 'overtime') return 'Overtime (OT)';
  if (item.request_type_code === 'offset_earn') return 'Offset';
  if (item.request_type_code === 'use_offset') return 'Use Offset';
  if (item.request_type_code === 'leave') return item.leave_type ? `${item.leave_type} Leave` : 'Leave';
  return item.request_type_name;
}

function getApprovalDate(item: PendingApproval) {
  return item.request_type_code === 'leave' ? item.start_date || item.submitted_at : item.date_from || item.submitted_at;
}

function parseFilterDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function formatCompactDate(value: string | null) {
  const time = parseFilterDate(value);
  if (time === null) return 'No date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

function formatSheetDate(value: string | null) {
  const time = parseFilterDate(value);
  if (time === null) return 'N/A';
  const date = new Date(time);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
  return `${month}. ${date.getDate()}, ${date.getFullYear()}`;
}

function formatSheetTime(value: string | null) {
  if (!value) return 'N/A';
  const timeMatch = value.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatHours(hours: number | null) {
  return `${Number(hours ?? 0).toFixed(2)}h`;
}

function formatPersonNameWithMiddleInitial(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return value || 'Employee';
  const [first, middle, ...rest] = parts;
  const maybeInitial = middle.replace('.', '');
  const middleText = maybeInitial.length === 1 ? `${maybeInitial}.` : `${maybeInitial[0]}.`;
  return [first, middleText, ...rest].join(' ');
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: 6,
    paddingTop: spacing.sm,
    paddingBottom: 90,
  },
  filterPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: colors.muted,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  searchBox: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
  refreshButton: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  refreshButtonText: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  categoryChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  categoryChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  categoryChipText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  categoryChipTextActive: {
    color: colors.primary,
  },
  categoryCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  categoryCountBadgeActive: {
    backgroundColor: colors.primary,
  },
  categoryCountText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.heavy,
    color: colors.primary,
  },
  categoryCountTextActive: {
    color: colors.surface,
  },
  pendingBand: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingBandLabel: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
  },
  pendingBandCount: {
    minWidth: 30,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: colors.semantic.warning,
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textAlign: 'center',
  },
  status: {
    fontSize: 13,
    color: colors.muted,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  cardOuter: {
    position: 'relative',
    marginBottom: spacing.sm,
    paddingLeft: 4,
  },
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
    backgroundColor: colors.semantic.warning,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    shadowColor: colors.muted,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 2,
  },
  avatar: {
    width: 35,
    height: 35,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardCode: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  cardName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    color: colors.text,
    textTransform: 'uppercase',
  },
  cardDept: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  cardMeta: {
    width: 116,
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 3,
  },
  statusPill: {
    maxWidth: 116,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#fef3c7',
    color: '#92400e',
    borderWidth: 1,
    borderColor: '#fde68a',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    paddingHorizontal: 9,
    paddingVertical: 5,
    textTransform: 'capitalize',
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 116,
    justifyContent: 'flex-end',
  },
  metaText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  cardBottomRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typePill: {
    flex: 1,
    minHeight: 25,
    borderRadius: radius.md,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  typePillText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#1d4ed8',
  },
  viewButton: {
    minHeight: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  viewText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  paginationBar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    shadowColor: colors.muted,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  paginationButton: {
    minHeight: 38,
    minWidth: 82,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  paginationButtonDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.background,
    opacity: 0.65,
  },
  paginationButtonText: {
    color: '#1d4ed8',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
  },
  paginationCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paginationText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
  },
  paginationMeta: {
    marginTop: 1,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.36)',
    justifyContent: 'flex-end',
  },
  sheetDismissArea: {
    flex: 1,
  },
  detailsSheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.brand.ink,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 18,
  },
  sheetScroll: {
    paddingBottom: spacing.xs,
  },
  requestSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  requestSummaryText: {
    flex: 1,
    minWidth: 0,
  },
  sheetCodeRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  sheetTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  sheetCode: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  sheetStatusPill: {
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#fef3c7',
    color: '#92400e',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  sheetIconClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  sheetProfileRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sheetProfileText: {
    flex: 1,
    minWidth: 0,
  },
  sheetName: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    textTransform: 'uppercase',
  },
  sheetDept: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  submittedBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  submittedLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  submittedDate: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  submittedTime: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  sectionTitleRow: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  detailsList: {
    marginHorizontal: spacing.lg,
    gap: 0,
  },
  detailRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailRowLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  detailRowValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
    color: colors.text,
    textAlign: 'right',
  },
  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  panelTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  rangePanel: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  rangeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  detailItem: {
    width: '50%',
    minHeight: 36,
    paddingRight: spacing.sm,
  },
  detailLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  detailValue: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  reasonBlock: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reasonText: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    color: colors.text,
  },
  timelineHeader: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timelineBlock: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
  },
  timelineRail: {
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    minHeight: 42,
    backgroundColor: colors.border,
  },
  timelineContent: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.sm,
  },
  timelineTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  timelineTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  timelineTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  timelineSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  timelineDateRow: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 2,
    paddingTop: 1,
  },
  timelineDate: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  sheetApproveButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    backgroundColor: colors.semantic.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sheetApproveText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
  sheetRejectButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.semantic.danger,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sheetRejectText: {
    color: colors.semantic.danger,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
});
