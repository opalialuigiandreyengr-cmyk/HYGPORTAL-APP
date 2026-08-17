import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AlertCircle, CalendarDays, Check, Clock3, Eye, FileText, Funnel, RefreshCcw, Search, Users, X } from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import type { AppToastMessage } from '../components/AppToast';
import { colors, fontWeights, radius, spacing } from '../theme';
import { platformAlert } from '../utils/platformAlert';
import { decideApprovalStep, loadPendingApprovals, type PendingApproval } from '../services/approvals';
import { supabase } from '../lib/supabase';
import {
  EsarfCardView,
  EsarfRequestInfoPanel,
  formatUnifiedRequestCode,
  formatUnifiedRequestType,
  parseEsarfEntries,
} from '../components/EsarfDetailsView';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type CategoryFilter = 'all' | 'esarf' | 'leave';

const categoryTabs: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'esarf', label: 'ESARF' },
  { key: 'leave', label: 'Leave' },
];
const pageSize = 15;

type Props = {
  profileResult?: ProfileLoadResult | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenMyTeam?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  targetRequestId?: string | null;
  autoOpenFirst?: boolean;
  onClearTargetRequest?: () => void;
};

export function ApprovalsScreen({
  profileResult,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onToast,
  targetRequestId,
  autoOpenFirst,
  onClearTargetRequest,
}: Props) {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedApproval, setSelectedApproval] = useState<{ item: PendingApproval; sequence: number } | null>(null);
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

  useEffect(() => {
    if (items.length > 0 && (targetRequestId || autoOpenFirst)) {
      if (targetRequestId) {
        const matchIdx = items.findIndex(
          (i) => i.request_id === targetRequestId || i.step_id === targetRequestId,
        );
        if (matchIdx >= 0) {
          setSelectedApproval({ item: items[matchIdx], sequence: matchIdx + 1 });
          onClearTargetRequest?.();
          return;
        } else {
          onToast?.({
            tone: 'warning',
            title: 'Request Processed',
            message: 'This approval request has already been processed or is no longer pending.',
          });
          onClearTargetRequest?.();
          return;
        }
      }
      if (autoOpenFirst) {
        setSelectedApproval({ item: items[0], sequence: 1 });
        onClearTargetRequest?.();
      }
    }
  }, [items, targetRequestId, autoOpenFirst, onClearTargetRequest]);

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

    return items
      .filter((item) => {
        if (!isVisibleApproval(item)) return false;
        if (activeCategory !== 'all' && approvalCategory(item) !== activeCategory) return false;
        if (!normalizedQuery) return true;

        const haystack = [
          item.request_id,
          formatApprovalType(item),
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
      })
      .sort((a, b) => {
        const timeA = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
        const timeB = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
        return timeB - timeA;
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

  async function approve(item: PendingApproval, rejectedIndices: number[] = []) {
    setStatus('Approving request...');
    try {
      if (rejectedIndices.length > 0) {
        try {
          await supabase.rpc('update_time_request_entry_rejections', {
            p_request_id: item.request_id,
            p_rejected_entry_indices: rejectedIndices,
          });
        } catch {
          // Fallback to direct table update
          const { data: details } = await supabase
            .from('time_request_details')
            .select('reason')
            .eq('request_id', item.request_id)
            .maybeSingle();

          let rawReason = details?.reason || item.reason || '';
          rejectedIndices.forEach((idx) => {
            const regex = new RegExp(`(\\[Entry\\s+${idx}\\][^\n]*)`, 'gi');
            if (rawReason.match(regex)) {
              rawReason = rawReason.replace(regex, `$1 [REJECTED]`);
            } else {
              rawReason = `${rawReason}\n[Entry ${idx}] [REJECTED]`;
            }
          });

          await supabase
            .from('time_request_details')
            .update({ reason: rawReason })
            .eq('request_id', item.request_id);
        }
      }

      await decideApprovalStep(item.step_id, 'approved', 'Approved from mobile.');
      await refresh();
      onToast?.({
        tone: 'success',
        title: 'Request approved',
        message: `${formatApprovalType(item)} was approved successfully.`,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update approval.');
    }
  }

  function confirmApprove(item: PendingApproval, rejectedIndices: number[] = []) {
    platformAlert(
      'Approve request?',
      `Are you sure you want to approve ${formatApprovalType(item)} from ${item.requester_name || 'this employee'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            setSelectedApproval(null);
            void approve(item, rejectedIndices);
          },
        },
      ],
    );
  }

  async function performReject(item: PendingApproval, reason: string) {
    setStatus('Rejecting request...');
    await decideApprovalStep(item.step_id, 'rejected', reason);
    setSelectedApproval(null);
    await refresh();
    onToast?.({
      tone: 'success',
      title: 'Request rejected',
      message: `${formatApprovalType(item)} was rejected.`,
    });
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar name={profile?.fullName} username={profile?.username} photoUrl={profile?.photoUrl} notificationCount={notificationCount} onMessages={onAssistant} onNotifications={onNotifications} onOpenProfile={onOpenProfile} onOpenSettings={onOpenSettings} onOpenMyTeam={onOpenMyTeam} />
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
        onPerformReject={performReject}
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
  profile,
  onClose,
  onApprove,
  onPerformReject,
}: {
  approval: { item: PendingApproval; sequence: number } | null;
  profile: EmployeeProfileSummary | null;
  onClose: () => void;
  onApprove: (item: PendingApproval, rejectedIndices?: number[]) => void;
  onPerformReject: (item: PendingApproval, reason: string) => Promise<void>;
}) {
  const item = approval?.item ?? null;
  const sequence = approval?.sequence ?? 0;
  const isLeave = item?.request_type_code === 'leave';

  const esarfEntries = useMemo(() => {
    return item && !isLeave ? parseEsarfEntries(item) : [];
  }, [item, isLeave]);

  const [selectedEntryIndices, setSelectedEntryIndices] = useState<number[]>([]);
  const [rejectedEntryIndices, setRejectedEntryIndices] = useState<number[]>([]);
  const [isRejectingInline, setIsRejectingInline] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [isSubmittingReject, setIsSubmittingReject] = useState(false);

  useEffect(() => {
    if (esarfEntries.length > 0) {
      const activeEntries = esarfEntries.filter((e) => !e.isRejected).map((e) => e.index);
      const preRejectedEntries = esarfEntries.filter((e) => e.isRejected).map((e) => e.index);
      setSelectedEntryIndices(activeEntries);
      setRejectedEntryIndices(preRejectedEntries);
    }
  }, [esarfEntries]);

  useEffect(() => {
    setIsRejectingInline(false);
    setRejectReason('');
    setRejectError('');
    setIsSubmittingReject(false);
  }, [approval]);

  const effectiveRejectedIndices = useMemo(() => {
    const unselected = esarfEntries
      .map((e) => e.index)
      .filter((idx) => !selectedEntryIndices.includes(idx));
    return Array.from(new Set([...rejectedEntryIndices, ...unselected]));
  }, [esarfEntries, selectedEntryIndices, rejectedEntryIndices]);

  if (!approval || !item) return null;

  async function handleConfirmRejection() {
    if (!item) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('Please enter why this request is being rejected.');
      return;
    }

    setIsSubmittingReject(true);
    setRejectError('');
    try {
      await onPerformReject(item, reason);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to reject request.';
      setRejectError(msg);
      setIsSubmittingReject(false);
    }
  }

  const displayName = item.requester_name || formatEmployeeDisplayName(profile);
  const department = profile?.departmentName || profile?.storeName || 'Department';
  const timelineRows = approvalTimeline(item);

  const toggleEntrySelect = (idx: number) => {
    const target = esarfEntries.find((e) => e.index === idx);
    if (target?.isRejected) return;

    setSelectedEntryIndices((prev) => {
      if (prev.includes(idx)) {
        setRejectedEntryIndices((r) => Array.from(new Set([...r, idx])));
        return prev.filter((i) => i !== idx);
      } else {
        setRejectedEntryIndices((r) => r.filter((i) => i !== idx));
        return [...prev, idx];
      }
    });
  };

  const toggleRejectEntry = (idx: number) => {
    const target = esarfEntries.find((e) => e.index === idx);
    if (target?.isRejected) return;

    setRejectedEntryIndices((prev) => {
      if (prev.includes(idx)) {
        setSelectedEntryIndices((s) => Array.from(new Set([...s, idx])));
        return prev.filter((i) => i !== idx);
      } else {
        setSelectedEntryIndices((s) => s.filter((i) => i !== idx));
        return [...prev, idx];
      }
    });
  };

  const toggleSelectAll = () => {
    const activeEntries = esarfEntries.filter((e) => !e.isRejected);
    const activeIndices = activeEntries.map((e) => e.index);
    const preRejectedIndices = esarfEntries.filter((e) => e.isRejected).map((e) => e.index);

    const isAllActiveSelected = activeIndices.length > 0 && activeIndices.every((idx) => selectedEntryIndices.includes(idx));

    if (isAllActiveSelected) {
      setSelectedEntryIndices([]);
      setRejectedEntryIndices(esarfEntries.map((e) => e.index));
    } else {
      setSelectedEntryIndices(activeIndices);
      setRejectedEntryIndices(preRejectedIndices);
    }
  };

  const handleRejectAll = () => {
    setRejectedEntryIndices(esarfEntries.map((e) => e.index));
    setSelectedEntryIndices([]);
    setIsRejectingInline(true);
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.detailsSheet}>
          <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.requestSummaryHeader}>
              <View style={styles.requestSummaryText}>
                <Text style={styles.sheetTitle}>{formatApprovalType(item)}</Text>
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

            {isLeave ? (
              <>
                <View style={styles.sectionTitleRow}>
                  <FileText size={15} color={colors.muted} strokeWidth={2.2} />
                  <Text style={styles.sectionTitle}>Request Information</Text>
                </View>
                <View style={styles.detailsList}>
                  <DetailRow label="Transaction Type" value={formatApprovalType(item)} />
                  <DetailRow label="Leave Type" value={item.leave_type || 'N/A'} />
                  <DetailRow label="Leave Category" value={item.leave_category || 'N/A'} />
                  <DetailRow label="Total Days" value={`${item.total_days ?? 0}d`} />
                  <DetailRow label="Paid / Unpaid" value={`${item.paid_days ?? 0}d / ${item.unpaid_days ?? 0}d`} />
                </View>
              </>
            ) : (
              <EsarfRequestInfoPanel
                timeSchedule={item.time_schedule}
                dayOff={item.day_off}
                payrollClass={item.payroll_class}
              />
            )}

            {isLeave ? (
              <>
                <View style={styles.rangePanel}>
                  <View style={styles.panelTitleRow}>
                    <CalendarDays size={15} color={colors.muted} strokeWidth={2.2} />
                    <Text style={styles.panelTitle}>Date Range</Text>
                  </View>
                  <View style={styles.rangeGrid}>
                    <DetailItem label="Date From" value={formatSheetDate(item.start_date)} />
                    <DetailItem label="Date To" value={formatSheetDate(item.end_date)} />
                    <DetailItem label="Total Days" value={`${item.total_days ?? 0}d`} />
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
              </>
            ) : (
              /* ESARF entry cards matching exact approver UI design */
              <View style={{ marginTop: 0 }}>
                <View style={styles.actionPillsRow}>
                  <Pressable style={styles.approveAllBtn} onPress={toggleSelectAll}>
                    <Check size={14} color="#15803d" strokeWidth={2.4} />
                    <Text style={styles.approveAllBtnText}>
                      {selectedEntryIndices.length === esarfEntries.length ? 'Deselect All' : 'Select All'}
                    </Text>
                  </Pressable>
                </View>

                {esarfEntries.map((entry) => (
                  <EsarfCardView
                    key={entry.index}
                    entry={entry}
                    showCheckbox
                    isSelected={selectedEntryIndices.includes(entry.index)}
                    isRejected={rejectedEntryIndices.includes(entry.index)}
                    onToggleSelect={() => toggleEntrySelect(entry.index)}
                    onToggleReject={() => toggleRejectEntry(entry.index)}
                    hideTimeline
                  />
                ))}
              </View>
            )}
          </ScrollView>

          {isRejectingInline ? (
            <View style={styles.inlineRejectPanel}>
              <View style={styles.inlineRejectBanner}>
                <View style={styles.inlineRejectIconCircle}>
                  <AlertCircle size={18} color="#dc2626" strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inlineRejectTitle}>Reject Request</Text>
                  <Text style={styles.inlineRejectSubtitle}>
                    Specify the reason for rejecting this request
                  </Text>
                </View>
              </View>

              <View style={styles.inputContainer}>
                <TextInput
                  value={rejectReason}
                  onChangeText={(val) => {
                    setRejectReason(val);
                    if (rejectError) setRejectError('');
                  }}
                  placeholder="Type reason for rejection here..."
                  placeholderTextColor="#94a3b8"
                  style={styles.inlineRejectInput}
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                  editable={!isSubmittingReject}
                  autoFocus
                />
                <Text style={styles.charCountText}>{rejectReason.length}/500</Text>
              </View>

              {rejectError ? <Text style={styles.rejectErrorText}>{rejectError}</Text> : null}

              <View style={styles.inlineRejectActions}>
                <Pressable
                  style={styles.inlineCancelBtn}
                  onPress={() => {
                    setIsRejectingInline(false);
                    setRejectReason('');
                    setRejectError('');
                  }}
                  disabled={isSubmittingReject}
                >
                  <Text style={styles.inlineCancelText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.inlineSubmitRejectBtn, isSubmittingReject ? styles.btnDisabled : null]}
                  onPress={() => void handleConfirmRejection()}
                  disabled={isSubmittingReject}
                >
                  <Text style={styles.inlineSubmitRejectText}>
                    {isSubmittingReject ? 'Rejecting...' : 'Confirm Rejection'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.approverFooter}>
              <Pressable style={styles.approverRejectBtn} onPress={handleRejectAll}>
                <Text style={styles.approverRejectText}>Reject All</Text>
              </Pressable>
              <Pressable style={styles.approverConfirmBtn} onPress={() => onApprove(item, effectiveRejectedIndices)}>
                <Text style={styles.approverConfirmText}>Confirm Approval</Text>
              </Pressable>
            </View>
          )}
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
  return formatUnifiedRequestCode(item, sequence);
}

function formatApprovalType(item: PendingApproval) {
  return formatUnifiedRequestType(item);
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
    paddingHorizontal: spacing.md,
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
    marginHorizontal: spacing.md,
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
  actionPillsRow: {
    marginHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  approveAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  approveAllBtnText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#15803d',
  },
  rejectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  rejectAllBtnText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#dc2626',
  },
  approverFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  approverRejectBtn: {
    flex: 1,
    width: '48%',
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#ef4444',
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approverRejectText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#dc2626',
  },
  approverConfirmBtn: {
    flex: 1,
    width: '48%',
    height: 46,
    borderRadius: 10,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approverConfirmText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
  inlineRejectPanel: {
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    borderTopWidth: 1,
    borderTopColor: '#fecaca',
    backgroundColor: '#fff7f7',
  },
  inlineRejectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  inlineRejectIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineRejectTitle: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#991b1b',
  },
  inlineRejectSubtitle: {
    fontSize: 12,
    color: '#7f1d1d',
    marginTop: 1,
  },
  inputContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  inlineRejectInput: {
    minHeight: 80,
    maxHeight: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 20,
  },
  charCountText: {
    position: 'absolute',
    bottom: 6,
    right: 10,
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: fontWeights.medium,
  },
  rejectErrorText: {
    marginTop: 4,
    fontSize: 12,
    color: '#dc2626',
    fontWeight: fontWeights.bold,
  },
  inlineRejectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  inlineCancelBtn: {
    flex: 1,
    width: '48%',
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineCancelText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
  inlineSubmitRejectBtn: {
    flex: 1,
    width: '48%',
    height: 44,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineSubmitRejectText: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
