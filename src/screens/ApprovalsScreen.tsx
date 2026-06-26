import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CalendarDays, Check, Clock3, Eye, FileText, Funnel, RefreshCcw, Search, Users, X } from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import type { AppToastMessage } from '../components/AppToast';
import { colors, fontWeights, radius, spacing } from '../theme';
import { decideApprovalStep, loadPendingApprovals, type PendingApproval } from '../services/approvals';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type CategoryFilter = 'all' | 'esarf' | 'leave';

const categoryTabs: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'esarf', label: 'ESARF' },
  { key: 'leave', label: 'Leave' },
];
const pageSize = 10;

type Props = {
  profileResult?: ProfileLoadResult | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenSettings?: () => void;
  onOpenMyTeam?: () => void;
  onToast?: (toast: AppToastMessage) => void;
};

export function ApprovalsScreen({ profileResult, notificationCount = 0, onAssistant, onNotifications, onOpenSettings, onOpenMyTeam, onToast }: Props) {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedApproval, setSelectedApproval] = useState<{ item: PendingApproval; sequence: number } | null>(null);
  const [rejectApproval, setRejectApproval] = useState<PendingApproval | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading approvals...');
    try {
      const approvals = await loadPendingApprovals();
      setItems(approvals);
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

  const categoryCounts = useMemo(() => {
    return items.reduce(
      (totals, item) => {
        if (isVisibleApproval(item)) {
          totals.all += 1;
          totals[approvalCategory(item)] += 1;
        }
        return totals;
      },
      { all: 0, esarf: 0, leave: 0 },
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      if (!isVisibleApproval(item)) return false;
      if (activeCategory !== 'all' && approvalCategory(item) !== activeCategory) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        item.request_id,
        item.request_type_name,
        item.request_type_code,
        item.requester_name,
        item.requester_employee_no,
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

  useEffect(() => {
    setPage(1);
  }, [activeCategory, query]);

  async function approve(item: PendingApproval) {
    setStatus('Approving request...');
    try {
      await decideApprovalStep(item.step_id, 'approved', 'Approved from mobile.');
      await refresh();
      onToast?.({
        tone: 'success',
        title: 'Request approved',
        message: `${item.request_type_name || formatApprovalType(item)} was approved successfully.`,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update approval.');
    }
  }

  function confirmApprove(item: PendingApproval) {
    Alert.alert(
      'Approve request?',
      `Are you sure you want to approve ${item.request_type_name || formatApprovalType(item)} from ${item.requester_name || 'this employee'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            setSelectedApproval(null);
            void approve(item);
          },
        },
      ],
    );
  }

  function beginReject(item: PendingApproval) {
    setSelectedApproval(null);
    setRejectApproval(item);
    setRejectReason('');
    setRejectError('');
  }

  async function submitRejection() {
    const reason = rejectReason.trim();
    if (!rejectApproval || isRejecting) return;
    if (!reason) {
      setRejectError('Please enter why this request is being rejected.');
      return;
    }

    setIsRejecting(true);
    setRejectError('');
    setStatus('Rejecting request...');
    try {
      await decideApprovalStep(rejectApproval.step_id, 'rejected', reason);
      setRejectApproval(null);
      setRejectReason('');
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reject approval.';
      setRejectError(message);
      setStatus(message);
    } finally {
      setIsRejecting(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar name={profile?.fullName} username={profile?.username} photoUrl={profile?.photoUrl} notificationCount={notificationCount} onMessages={onAssistant} onNotifications={onNotifications} onOpenSettings={onOpenSettings} onOpenMyTeam={onOpenMyTeam} />
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
            <Pressable disabled={isLoading} style={styles.filterButton} onPress={refresh}>
              {isLoading ? (
                <RefreshCcw size={15} color={colors.text} strokeWidth={2.6} />
              ) : (
                <Funnel size={15} color={colors.text} fill={colors.text} strokeWidth={2.2} />
              )}
              <Text style={styles.filterButtonText}>{isLoading ? 'Sync' : 'Filter'}</Text>
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

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {paginatedItems.map((item, index) => {
          const sequence = (currentPage - 1) * pageSize + index + 1;
          return (
            <ApprovalCard
              key={item.step_id}
              item={item}
              profile={profile}
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
        profile={profile}
        onClose={() => setSelectedApproval(null)}
        onApprove={confirmApprove}
        onReject={(item) => {
          beginReject(item);
        }}
      />
      <RejectReasonSheet
        item={rejectApproval}
        reason={rejectReason}
        error={rejectError}
        isSubmitting={isRejecting}
        onChangeReason={(value) => {
          setRejectReason(value);
          if (rejectError) setRejectError('');
        }}
        onClose={() => {
          if (isRejecting) return;
          setRejectApproval(null);
          setRejectReason('');
          setRejectError('');
        }}
        onSubmit={() => void submitRejection()}
      />
    </View>
  );
}

function ApprovalCard({
  item,
  profile,
  sequence,
  onView,
}: {
  item: PendingApproval;
  profile: EmployeeProfileSummary | null;
  sequence: number;
  onView: () => void;
}) {
  const displayName = item.requester_name || formatEmployeeDisplayName(profile);
  const department = profile?.departmentName || profile?.storeName || 'Department';
  const requestDate = item.request_type_code === 'leave' ? item.start_date : item.date_from;

  return (
    <View style={styles.cardOuter}>
      <View style={styles.cardAccent} />
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Avatar name={displayName} photoUrl={item.requester_photo_url ?? null} size={35} textSize={13} />
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <View style={styles.cardTitleBlock}>
              <Text style={styles.cardCode} numberOfLines={1}>
                {formatApprovalCode(item, sequence)}
              </Text>
              <Text style={styles.cardName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.cardDept}>{department}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={[styles.statusPill, styles.statusPending]} numberOfLines={1}>
                PENDING
              </Text>
              <View style={styles.metaLine}>
                <CalendarDays size={14} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {formatCompactDate(requestDate)}
                </Text>
              </View>
              <View style={styles.metaLine}>
                <Clock3 size={14} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {formatCompactTime(item.submitted_at || item.time_from)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.cardBottomRow}>
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{item.request_type_name || formatApprovalType(item)}</Text>
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
  profile,
  onClose,
  onApprove,
  onReject,
}: {
  approval: { item: PendingApproval; sequence: number } | null;
  profile: EmployeeProfileSummary | null;
  onClose: () => void;
  onApprove: (item: PendingApproval) => void;
  onReject: (item: PendingApproval) => void;
}) {
  if (!approval) return null;

  const { item, sequence } = approval;
  const displayName = item.requester_name || formatEmployeeDisplayName(profile);
  const department = profile?.departmentName || profile?.storeName || 'Department';
  const isLeave = item.request_type_code === 'leave';
  const timelineRows = approvalTimeline(item);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.detailsSheet}>
          <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.requestSummaryHeader}>
              <View style={styles.requestSummaryText}>
                <Text style={styles.sheetTitle}>{item.request_type_name || formatApprovalType(item)}</Text>
                <View style={styles.sheetCodeRow}>
                  <Text style={styles.sheetCode}>{formatApprovalCode(item, sequence)}</Text>
                  <Text style={[styles.sheetStatusPill, styles.statusPending]}>PENDING</Text>
                </View>
              </View>
              <Pressable style={styles.sheetIconClose} onPress={onClose}>
                <X size={18} color={colors.text} strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.sheetHeader}>
              <View style={styles.sheetProfileRow}>
                <Avatar name={displayName} photoUrl={item.requester_photo_url ?? null} size={34} textSize={13} />
                <View style={styles.sheetProfileText}>
                  <Text style={styles.sheetName} numberOfLines={1}>{displayName}</Text>
                  <Text style={styles.sheetDept} numberOfLines={1}>{department}</Text>
                </View>
              </View>
              <View style={styles.submittedBlock}>
                <Text style={styles.submittedLabel}>Submitted on</Text>
                <Text style={styles.submittedDate}>{formatSheetDate(item.submitted_at)}</Text>
                <Text style={styles.submittedTime}>{formatCompactTime(item.submitted_at)}</Text>
              </View>
            </View>

            <View style={styles.sectionTitleRow}>
              <FileText size={15} color={colors.muted} strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>Request Information</Text>
            </View>
            <View style={styles.detailsList}>
              <DetailRow label="Transaction Type" value={formatApprovalType(item)} />
              {isLeave ? (
                <>
                  <DetailRow label="Leave Type" value={item.leave_type || 'N/A'} />
                  <DetailRow label="Leave Category" value={item.leave_category || 'N/A'} />
                  <DetailRow label="Total Days" value={`${item.total_days ?? 0}d`} />
                  <DetailRow label="Paid / Unpaid" value={`${item.paid_days ?? 0}d / ${item.unpaid_days ?? 0}d`} />
                </>
              ) : (
                <>
                  <DetailRow label="Date" value={formatSheetDate(item.date_from)} />
                  <DetailRow label="Time" value={`${formatCompactTime(item.time_from)} - ${formatCompactTime(item.time_to)}`} />
                  <DetailRow label="Total Hours" value={`${item.total_hours ?? 0}h`} />
                </>
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
                    <DetailItem label="Time From" value={formatCompactTime(item.time_from)} />
                    <DetailItem label="Time To" value={formatCompactTime(item.time_to)} />
                  </>
                )}
              </View>
            </View>

            <View style={styles.reasonBlock}>
              <View style={styles.panelTitleRow}>
                <FileText size={15} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.panelTitle}>Reason / Details</Text>
              </View>
              <Text style={styles.sheetReasonText}>{item.reason || 'No reason provided.'}</Text>
            </View>

            <View style={styles.timelineHeader}>
              <Users size={15} color={colors.muted} strokeWidth={2.2} />
              <Text style={styles.panelTitle}>Approval Timeline</Text>
            </View>
            <View style={styles.timelineBlock}>
              {timelineRows.map((step, index) => (
                <TimelineItem
                  key={`${item.request_id}-${step.title}-${index}`}
                  title={step.title}
                  subtitle={step.subtitle}
                  date={step.date}
                  time={step.time}
                  tone={step.tone}
                  isLast={index === timelineRows.length - 1}
                />
              ))}
            </View>
          </ScrollView>
          <View style={styles.sheetFooter}>
            <Pressable style={styles.approveActionButton} onPress={() => onApprove(item)}>
              <Check size={16} color={colors.surface} strokeWidth={2.6} />
              <Text style={styles.approveActionText}>Approve</Text>
            </Pressable>
            <Pressable style={styles.rejectActionButton} onPress={() => onReject(item)}>
              <X size={16} color="#b91c1c" strokeWidth={2.6} />
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RejectReasonSheet({
  item,
  reason,
  error,
  isSubmitting,
  onChangeReason,
  onClose,
  onSubmit,
}: {
  item: PendingApproval | null;
  reason: string;
  error: string;
  isSubmitting: boolean;
  onChangeReason: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!item) return null;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.rejectSheet}>
          <ScrollView
            contentContainerStyle={styles.rejectSheetContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.rejectHeader}>
              <View style={styles.requestSummaryText}>
                <Text style={styles.sheetTitle}>Reject Request</Text>
                <Text style={styles.rejectHelper}>Enter the reason for rejecting this {formatApprovalType(item).toLowerCase()}.</Text>
              </View>
              <Pressable style={styles.sheetIconClose} onPress={onClose} disabled={isSubmitting}>
                <X size={18} color={colors.text} strokeWidth={2.4} />
              </Pressable>
            </View>

            <Text style={styles.rejectLabel}>Reason for rejection</Text>
            <TextInput
              value={reason}
              onChangeText={onChangeReason}
              placeholder="Why are you rejecting this request?"
              placeholderTextColor={colors.muted}
              style={styles.rejectInput}
              multiline
              maxLength={500}
              textAlignVertical="top"
              editable={!isSubmitting}
              autoFocus
            />
            {error ? <Text style={styles.rejectError}>{error}</Text> : null}

            <View style={styles.rejectFooter}>
              <Pressable style={styles.cancelActionButton} onPress={onClose} disabled={isSubmitting}>
                <Text style={styles.cancelActionText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.rejectSubmitButton, !reason.trim() || isSubmitting ? styles.actionButtonDisabled : null]}
                onPress={onSubmit}
                disabled={isSubmitting}
              >
                <X size={16} color={colors.surface} strokeWidth={2.6} />
                <Text style={styles.rejectSubmitText}>{isSubmitting ? 'Rejecting...' : 'Reject'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowLabel}>{label}</Text>
      <Text style={styles.detailRowValue}>{value}</Text>
    </View>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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

function isVisibleApproval(item: PendingApproval) {
  return approvalCategory(item) === 'esarf' || approvalCategory(item) === 'leave';
}

function approvalCategory(item: PendingApproval): CategoryFilter {
  if (item.request_type_code === 'leave') return 'leave';
  return 'esarf';
}

function formatApprovalCode(item: PendingApproval, sequence: number) {
  const prefix = approvalCategory(item).toUpperCase();
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

function formatApprovalType(item: PendingApproval) {
  if (item.request_type_code === 'leave') return 'Leave Request';
  return 'ESARF Request';
}

function approvalTimeline(item: PendingApproval) {
  const isLeave = item.request_type_code === 'leave';
  const fallback = isLeave ? [1] : [1, 2];
  const summary = (item.approval_summary ?? [])
    .filter((step) => !isLeave || step.step_order === 1 || step.required_level === 1)
    .slice(0, fallback.length);
  const rows: { label: string; status: string; actedAt: string | null }[] = summary.length
    ? summary.map((step) => ({
        label: approvalRoleLabel(step),
        status: `L${step.required_level} | ${approvalStepStatus(step.status)}`,
        actedAt: step.acted_at,
      }))
    : fallback.map((level) => ({
        label: `Level ${level} Approver`,
        status: `L${level} | ${level === 1 ? 'Pending to approve' : 'Not yet processed'}`,
        actedAt: null,
      }));

  while (rows.length < fallback.length) {
    const level = fallback[rows.length];
    rows.push({ label: `Level ${level} Approver`, status: `L${level} | Not yet processed`, actedAt: null });
  }

  return rows.map((row) => ({
    title: row.label,
    subtitle: row.status,
    date: row.actedAt ? formatSheetDate(row.actedAt) : undefined,
    time: row.actedAt ? formatCompactTime(row.actedAt) : undefined,
    tone: timelineTone(row.status),
  }));
}

function approvalRoleLabel(step: PendingApproval['approval_summary'][number]) {
  const approverName = step.approver_name?.trim();
  if (approverName) return approverName;

  const positionName = step.approver_position_name?.trim();
  if (positionName) return positionName;

  const skippedReason = step.skipped_reason?.trim();
  if (skippedReason) return skippedReason;

  return `Level ${step.required_level} Approver`;
}

function approvalStepStatus(status: string) {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'Approved';
  if (value.includes('reject')) return 'Rejected';
  if (value.includes('pending') || value.includes('admin_fallback')) return 'Pending to approve';
  if (value.includes('waiting')) return 'Not yet processed';
  if (value.includes('skipped')) return 'Skipped';
  if (value.includes('cancelled')) return 'Cancelled';
  return 'Not yet processed';
}

function timelineTone(status: string) {
  if (status.includes('Approved')) return 'success' as const;
  if (status.includes('Pending to approve')) return 'warning' as const;
  return 'muted' as const;
}

function formatEmployeeDisplayName(profile: EmployeeProfileSummary | null) {
  return profile?.fullName || 'Employee';
}

function formatCompactDate(value?: string | null) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSheetDate(value?: string | null) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatCompactTime(value?: string | null) {
  if (!value) return 'N/A';
  if (/^\d{2}:\d{2}/.test(value)) {
    const [hoursRaw, minutes] = value.split(':');
    const hours = Number(hoursRaw);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${minutes} ${suffix}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  filterButton: {
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
  filterButtonText: {
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
  status: {
    fontSize: 13,
    color: colors.muted,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
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
    backgroundColor: colors.primary,
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
    backgroundColor: colors.brand.panel,
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
    fontSize: 13,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    textTransform: 'capitalize',
  },
  statusPending: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    color: '#92400e',
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
  rejectButton: {
    minHeight: 26,
    borderRadius: radius.sm,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rejectText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#b91c1c',
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
  sheetTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  sheetCodeRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  sheetCode: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  sheetStatusPill: {
    maxWidth: 120,
    borderRadius: 999,
    overflow: 'hidden',
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
  rangePanel: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
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
  sheetReasonText: {
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
  approveActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  approveActionText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.surface,
  },
  rejectActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  rejectSheet: {
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rejectSheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  rejectHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rejectHelper: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    color: colors.muted,
  },
  rejectLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  rejectInput: {
    minHeight: 104,
    maxHeight: 150,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.medium,
    color: colors.text,
  },
  rejectError: {
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    color: '#b91c1c',
  },
  rejectFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelActionText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  rejectSubmitButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: '#b91c1c',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  rejectSubmitText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.surface,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
});
