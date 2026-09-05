import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Edit3,
  Eye,
  FileText,
  Funnel,
  RefreshCcw,
  Save,
  Search,
  Users,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import type { AppToastMessage } from '../components/AppToast';
import { colors, fontWeights, radius, spacing } from '../theme';
import { platformAlert } from '../utils/platformAlert';
import {
  decideApprovalStep,
  loadApprovedApprovals,
  loadPendingApprovals,
  updateApprovedRequest,
  type ApprovedApproval,
  type PendingApproval,
} from '../services/approvals';
import { startApproverViewingSession } from '../services/requestViewerLock';
import { supabase } from '../lib/supabase';
import {
  EsarfCardView,
  EsarfRequestInfoPanel,
  buildUpdatedReasonText,
  computeEffectiveTotalHours,
  formatUnifiedRequestCode,
  formatUnifiedRequestType,
  isOtOrOffsetTransaction,
  isOvertimeOrOffset,
  isRequestEditable,
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
  onOpenRewards?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  targetRequestId?: string | null;
  autoOpenFirst?: boolean;
  onClearTargetRequest?: () => void;
  pointsBalance?: number;
};

export function ApprovalsScreen({
  profileResult,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onOpenRewards,
  onToast,
  targetRequestId,
  autoOpenFirst,
  onClearTargetRequest,
  pointsBalance = 0,
}: Props) {
  const [mainTab, setMainTab] = useState<'pending' | 'approved'>('pending');
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [approvedItems, setApprovedItems] = useState<ApprovedApproval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedApproval, setSelectedApproval] = useState<{ item: PendingApproval; sequence: number } | null>(null);
  const [selectedApproved, setSelectedApproved] = useState<{ item: ApprovedApproval; sequence: number } | null>(null);
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;

  async function refresh() {
    setIsLoading(true);
    setStatus(mainTab === 'pending' ? 'Loading approvals...' : 'Loading approved requests...');
    try {
      const approvals = await loadPendingApprovals().catch((err) => {
        console.warn('Error loading pending approvals:', err);
        return [] as PendingApproval[];
      });
      const approvedList = await loadApprovedApprovals(profile?.employeeNo, profile?.fullName).catch((err) => {
        console.warn('Error loading approved approvals:', err);
        return [] as ApprovedApproval[];
      });

      setItems(approvals);
      setApprovedItems(approvedList);

      if (mainTab === 'pending') {
        setStatus(approvals.length ? '' : 'No pending approvals.');
      } else {
        setStatus(approvedList.length ? '' : 'No approved requests found.');
      }
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
    if (items.length > 0 && (targetRequestId || autoOpenFirst) && mainTab === 'pending') {
      if (targetRequestId) {
        const matchIdx = items.findIndex(
          (i) => i.request_id === targetRequestId || i.step_id === targetRequestId,
        );
        if (matchIdx >= 0) {
          setSelectedApproval({ item: items[matchIdx], sequence: matchIdx + 1 });
          onClearTargetRequest?.();
          return;
        }
      }
      if (autoOpenFirst) {
        setSelectedApproval({ item: items[0], sequence: 1 });
        onClearTargetRequest?.();
        return;
      }
    }

    if (approvedItems.length > 0 && targetRequestId) {
      const approvedIdx = approvedItems.findIndex(
        (i) => i.request_id === targetRequestId || i.step_id === targetRequestId,
      );
      if (approvedIdx >= 0) {
        setMainTab('approved');
        setSelectedApproved({ item: approvedItems[approvedIdx], sequence: approvedIdx + 1 });
        onClearTargetRequest?.();
        return;
      }
    }

    if (targetRequestId && items.length > 0 && approvedItems.length > 0) {
      onToast?.({
        tone: 'warning',
        title: 'Request Processed',
        message: 'This approval request has already been processed or is no longer available.',
      });
      onClearTargetRequest?.();
    }
  }, [items, approvedItems, targetRequestId, autoOpenFirst, mainTab, onClearTargetRequest]);

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

  const approvedCategoryCounts = useMemo(() => {
    return approvedItems.reduce(
      (totals, item) => {
        if (isVisibleApproval(item)) {
          totals.all += 1;
          totals[approvalCategory(item)] += 1;
        }
        return totals;
      },
      { all: 0, esarf: 0, leave: 0 },
    );
  }, [approvedItems]);

  const activeCategoryCounts = mainTab === 'pending' ? categoryCounts : approvedCategoryCounts;

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

  const filteredApprovedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return approvedItems
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
        const timeA = a.approved_at || a.submitted_at ? new Date(a.approved_at || a.submitted_at).getTime() : 0;
        const timeB = b.approved_at || b.submitted_at ? new Date(b.approved_at || b.submitted_at).getTime() : 0;
        return timeB - timeA;
      });
  }, [activeCategory, approvedItems, query]);

  const currentFilteredItems = mainTab === 'pending' ? filteredItems : filteredApprovedItems;
  const pageCount = Math.max(1, Math.ceil(currentFilteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return currentFilteredItems.slice(start, start + pageSize);
  }, [currentPage, currentFilteredItems]);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, query, mainTab]);

  async function approve(
    item: PendingApproval,
    rejectedIndices: number[] = [],
    adjustedHoursMap: Record<number, string> = {},
  ) {
    setStatus('Approving request...');
    try {
      const isLeave = item.request_type_code === 'leave';
      const entries = !isLeave ? parseEsarfEntries(item) : [];
      const isEditable = isRequestEditable(item, entries);
      const hasHoursAdjustment = isEditable && Object.keys(adjustedHoursMap).length > 0;

      const newTotalHours = computeEffectiveTotalHours(
        entries,
        rejectedIndices,
        adjustedHoursMap,
        item.total_hours,
      );

      const updatedReason = buildUpdatedReasonText(
        item.reason,
        entries,
        adjustedHoursMap,
        rejectedIndices,
      );

      // 1. Update time_request_details in database if hours were adjusted or entries rejected
      if (hasHoursAdjustment || rejectedIndices.length > 0) {
        const updatePayload: Record<string, any> = {
          total_hours: newTotalHours,
        };
        if (updatedReason !== item.reason) {
          updatePayload.reason = updatedReason;
        }

        try {
          const { error: updateErr } = await supabase
            .from('time_request_details')
            .update(updatePayload)
            .eq('request_id', item.request_id);

          if (updateErr) {
            console.warn('Direct update failed, trying RPC fallback:', updateErr);
            await supabase.rpc('admin_update_request_data', {
              p_request_id: item.request_id,
              p_is_perk: false,
              p_total_hours: newTotalHours,
              p_reason: updatedReason,
            });
          }
        } catch (dbErr) {
          console.warn('Error updating time_request_details:', dbErr);
        }
      }

      // 2. Also call update_time_request_entry_rejections if any entries rejected
      if (rejectedIndices.length > 0) {
        try {
          await supabase.rpc('update_time_request_entry_rejections', {
            p_request_id: item.request_id,
            p_rejected_entry_indices: rejectedIndices,
          });
        } catch {
          // Handled via reason update above
        }
      }

      // 3. Decide approval step (RPC 'decide_approval_step')
      await decideApprovalStep(item.step_id, 'approved', 'Approved from mobile.');
      await refresh();

      const adjustedMsg = hasHoursAdjustment
        ? ` with ${newTotalHours.toFixed(2)} hrs (adjusted)`
        : '';
      onToast?.({
        tone: 'success',
        title: 'Request approved',
        message: `${formatApprovalType(item)} was approved successfully${adjustedMsg}.`,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update approval.');
    }
  }

  function confirmApprove(
    item: PendingApproval,
    rejectedIndices: number[] = [],
    adjustedHoursMap: Record<number, string> = {},
  ) {
    const isLeave = item.request_type_code === 'leave';
    const entries = !isLeave ? parseEsarfEntries(item) : [];
    const isEditable = isRequestEditable(item, entries);
    const hasAdjustment = isEditable && Object.keys(adjustedHoursMap).some((idxStr) => {
      const entry = entries.find((e) => e.index === Number(idxStr));
      if (!entry) return false;
      const val = adjustedHoursMap[Number(idxStr)];
      return val !== '' && parseFloat(val) !== parseFloat(entry.totalHours);
    });

    const newTotal = computeEffectiveTotalHours(entries, rejectedIndices, adjustedHoursMap, item.total_hours);

    let message = `Are you sure you want to approve ${formatApprovalType(item)} from ${item.requester_name || 'this employee'}?`;
    if (hasAdjustment) {
      message = `Are you sure you want to approve ${formatApprovalType(item)} from ${item.requester_name || 'this employee'} with adjusted total of ${newTotal.toFixed(2)} hrs (originally ${(item.total_hours ?? 0).toFixed(2)} hrs)?`;
    }

    platformAlert(
      'Approve request?',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            setSelectedApproval(null);
            void approve(item, rejectedIndices, adjustedHoursMap);
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
      <TopBar name={profile?.fullName} username={profile?.username} photoUrl={profile?.photoUrl} pointsBalance={pointsBalance} notificationCount={notificationCount} onMessages={onAssistant} onNotifications={onNotifications} onOpenProfile={onOpenProfile} onOpenSettings={onOpenSettings} onOpenMyTeam={onOpenMyTeam} onOpenRewards={onOpenRewards} />
      
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Main Tab Switcher: Pending vs Approved */}
        <View style={styles.mainTabContainer}>
          <Pressable
            style={[styles.mainTabButton, mainTab === 'pending' ? styles.mainTabButtonPendingActive : null]}
            onPress={() => setMainTab('pending')}
          >
            <Clock3 size={15} color={mainTab === 'pending' ? colors.primary : colors.muted} strokeWidth={2.4} />
            <Text style={[styles.mainTabText, mainTab === 'pending' ? styles.mainTabTextPendingActive : null]}>
              Pending Approvals
            </Text>
            <View style={[styles.mainTabBadge, mainTab === 'pending' ? styles.mainTabBadgePendingActive : null]}>
              <Text style={[styles.mainTabBadgeText, mainTab === 'pending' ? styles.mainTabBadgeTextPendingActive : null]}>
                {items.length}
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={[styles.mainTabButton, mainTab === 'approved' ? styles.mainTabButtonApprovedActive : null]}
            onPress={() => setMainTab('approved')}
          >
            <CheckCircle2 size={15} color={mainTab === 'approved' ? '#15803d' : colors.muted} strokeWidth={2.4} />
            <Text style={[styles.mainTabText, mainTab === 'approved' ? styles.mainTabTextApprovedActive : null]}>
              Approved Requests
            </Text>
            <View style={[styles.mainTabBadge, mainTab === 'approved' ? styles.mainTabBadgeApprovedActive : null]}>
              <Text style={[styles.mainTabBadgeText, mainTab === 'approved' ? styles.mainTabBadgeTextApprovedActive : null]}>
                {approvedItems.length}
              </Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.filterPanel}>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Search size={16} color={colors.muted} strokeWidth={2.4} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={mainTab === 'pending' ? 'Search pending approvals...' : 'Search approved requests...'}
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
                        {activeCategoryCounts[tab.key]}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {mainTab === 'pending'
          ? (paginatedItems as PendingApproval[]).map((item, index) => {
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
            })
          : (paginatedItems as ApprovedApproval[]).map((item, index) => {
              const sequence = (currentPage - 1) * pageSize + index + 1;
              return (
                <ApprovedCard
                  key={item.step_id || item.request_id}
                  item={item}
                  profile={profile}
                  sequence={sequence}
                  onView={() => setSelectedApproved({ item, sequence })}
                />
              );
            })}

        {currentFilteredItems.length > pageSize ? (
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
                {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, currentFilteredItems.length)} of {currentFilteredItems.length}
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

      {/* Pending Approval Modal */}
      <ApprovalDetailsSheet
        approval={selectedApproval}
        profile={profile}
        onClose={() => setSelectedApproval(null)}
        onApprove={confirmApprove}
        onPerformReject={performReject}
      />

      {/* Approved Request View Modal */}
      <ApprovedDetailsSheet
        approval={selectedApproved}
        profile={profile}
        onClose={() => setSelectedApproved(null)}
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

function ApprovedCard({
  item,
  profile,
  sequence,
  onView,
}: {
  item: ApprovedApproval;
  profile: EmployeeProfileSummary | null;
  sequence: number;
  onView: () => void;
}) {
  const displayName = item.requester_name || formatEmployeeDisplayName(profile);
  const department = profile?.departmentName || profile?.storeName || 'Department';
  const requestDate = item.request_type_code === 'leave' ? item.start_date : item.date_from;

  return (
    <View style={styles.cardOuter}>
      <View style={[styles.cardAccent, { backgroundColor: '#16a34a' }]} />
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
              <Text style={[styles.statusPill, styles.statusApproved]} numberOfLines={1}>
                APPROVED
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
                  {formatCompactTime(item.approved_at || item.submitted_at || item.time_from)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.cardBottomRow}>
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{formatApprovalType(item)}</Text>
            </View>
            <Pressable style={styles.viewApprovedButton} onPress={onView}>
              <Eye size={15} color="#15803d" strokeWidth={2.3} />
              <Text style={styles.viewApprovedText}>View</Text>
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
  onApprove: (item: PendingApproval, rejectedIndices?: number[], adjustedHoursMap?: Record<number, string>) => void;
  onPerformReject: (item: PendingApproval, reason: string) => Promise<void>;
}) {
  const item = approval?.item ?? null;
  const sequence = approval?.sequence ?? 0;
  const isLeave = item?.request_type_code === 'leave';

  const esarfEntries = useMemo(() => {
    return item && !isLeave ? parseEsarfEntries(item) : [];
  }, [item, isLeave]);

  const isEditable = useMemo(() => {
    return isRequestEditable(item, esarfEntries);
  }, [item, esarfEntries]);

  const [selectedEntryIndices, setSelectedEntryIndices] = useState<number[]>([]);
  const [rejectedEntryIndices, setRejectedEntryIndices] = useState<number[]>([]);
  const [adjustedHoursMap, setAdjustedHoursMap] = useState<Record<number, string>>({});
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
    setAdjustedHoursMap({});
  }, [approval]);

  useEffect(() => {
    if (item && item.request_id) {
      const approverName = profile?.fullName || 'Manager / Approver';
      const approverPosition = profile?.positionName || profile?.departmentName || 'Approver';
      const stopSession = startApproverViewingSession(item.request_id, approverName, approverPosition);
      return () => {
        stopSession();
      };
    }
  }, [item, profile]);

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

                {esarfEntries.map((entry) => {
                  const canEdit = isEditable && isOtOrOffsetTransaction(entry.transactionLabel);
                  return (
                    <EsarfCardView
                      key={entry.index}
                      entry={entry}
                      showCheckbox
                      isSelected={selectedEntryIndices.includes(entry.index)}
                      isRejected={rejectedEntryIndices.includes(entry.index)}
                      onToggleSelect={() => toggleEntrySelect(entry.index)}
                      onToggleReject={() => toggleRejectEntry(entry.index)}
                      hideTimeline
                      isEditableHours={canEdit}
                      adjustedHours={adjustedHoursMap[entry.index]}
                      onHoursChange={(val) => {
                        const cleaned = val.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1');
                        setAdjustedHoursMap((prev) => ({
                          ...prev,
                          [entry.index]: cleaned,
                        }));
                      }}
                    />
                  );
                })}
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
            <>
              {isEditable && Object.keys(adjustedHoursMap).some((idxStr) => {
                const entry = esarfEntries.find((e) => e.index === Number(idxStr));
                if (!entry) return false;
                const val = adjustedHoursMap[Number(idxStr)];
                return val !== '' && parseFloat(val) !== parseFloat(entry.totalHours);
              }) ? (
                <View style={styles.adjustedHoursBanner}>
                  <Clock3 size={15} color="#854d0e" strokeWidth={2.4} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.adjustedHoursBannerTitle}>
                      Adjusted Total: <Text style={styles.adjustedHoursBold}>{computeEffectiveTotalHours(esarfEntries, effectiveRejectedIndices, adjustedHoursMap, item.total_hours).toFixed(2)} hrs</Text>
                    </Text>
                    <Text style={styles.adjustedHoursBannerSub}>
                      Original requested: {(item.total_hours ?? 0).toFixed(2)} hrs
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.approverFooter}>
                <Pressable style={styles.approverRejectBtn} onPress={handleRejectAll}>
                  <Text style={styles.approverRejectText}>Reject All</Text>
                </Pressable>
                <Pressable
                  style={styles.approverConfirmBtn}
                  onPress={() => {
                    for (const [idxStr, val] of Object.entries(adjustedHoursMap)) {
                      const parsed = parseFloat(val);
                      if (val.trim() === '' || isNaN(parsed) || parsed < 0) {
                        platformAlert('Invalid Hours', `Please enter a valid number of hours for Entry ${idxStr}.`);
                        return;
                      }
                    }
                    onApprove(item, effectiveRejectedIndices, adjustedHoursMap);
                  }}
                >
                  <Text style={styles.approverConfirmText}>Confirm Approval</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ApprovedDetailsSheet({
  approval,
  profile,
  onClose,
}: {
  approval: { item: ApprovedApproval; sequence: number } | null;
  profile: EmployeeProfileSummary | null;
  onClose: () => void;
}) {
  const item = approval?.item ?? null;
  const sequence = approval?.sequence ?? 0;
  const isLeave = item?.request_type_code === 'leave';

  const esarfEntries = useMemo(() => {
    return item && !isLeave ? parseEsarfEntries(item) : [];
  }, [item, isLeave]);

  if (!approval || !item) return null;

  const displayName = item.requester_name || formatEmployeeDisplayName(profile);
  const department = profile?.departmentName || profile?.storeName || 'Department';

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
                  <Text style={[styles.sheetStatusPill, styles.statusApproved]}>APPROVED</Text>
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
                <Text style={styles.submittedLabel}>Approved on</Text>
                <Text style={styles.submittedDate}>{formatSheetDate(item.approved_at || item.submitted_at)}</Text>
                <Text style={styles.submittedTime}>{formatCompactTime(item.approved_at || item.submitted_at)}</Text>
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
              </>
            ) : (
              <View style={{ marginTop: 0 }}>
                {esarfEntries.map((entry) => (
                  <EsarfCardView
                    key={entry.index}
                    entry={entry}
                    isSelected={!entry.isRejected}
                    isRejected={entry.isRejected}
                    hideTimeline
                  />
                ))}
              </View>
            )}

            {item.remarks ? (
              <View style={styles.reasonBlock}>
                <View style={styles.panelTitleRow}>
                  <CheckCircle2 size={15} color="#16a34a" strokeWidth={2.2} />
                  <Text style={styles.panelTitle}>Approver Remarks</Text>
                </View>
                <Text style={styles.sheetReasonText}>{item.remarks}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.approvedSheetFooter}>
            <Pressable style={styles.closeSheetBtn} onPress={onClose}>
              <Text style={styles.closeSheetText}>Close</Text>
            </Pressable>
          </View>
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

function isVisibleApproval(item: PendingApproval | ApprovedApproval) {
  return approvalCategory(item) === 'esarf' || approvalCategory(item) === 'leave';
}

function approvalCategory(item: PendingApproval | ApprovedApproval): CategoryFilter {
  if (item.request_type_code === 'leave') return 'leave';
  return 'esarf';
}

function formatApprovalCode(item: PendingApproval | ApprovedApproval, sequence: number) {
  return formatUnifiedRequestCode(item, sequence);
}

function formatApprovalType(item: PendingApproval | ApprovedApproval) {
  return formatUnifiedRequestType(item);
}

function isUseOffsetApproval(item: PendingApproval | ApprovedApproval) {
  if (item.request_type_code === 'use_offset') return true;
  const transLower = (item.transaction_type || '').toLowerCase();
  if (transLower.includes('use offset') || transLower.includes('use_offset')) return true;
  const reasonLower = (item.reason || '').toLowerCase();
  if (reasonLower.includes('(use offset)') || reasonLower.includes('(use_offset)')) return true;
  return false;
}

function approvalTimeline(item: PendingApproval | ApprovedApproval) {
  const isLeave = item.request_type_code === 'leave';
  const isUseOffset = isUseOffsetApproval(item);
  const isSingleApprover = isLeave || isUseOffset;
  const fallback = isSingleApprover ? [1] : [1, 2];
  const summary = (item.approval_summary ?? [])
    .filter((step) => !isSingleApprover || step.step_order === 1 || step.required_level === 1);
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
  mainTabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  mainTabButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  mainTabButtonPendingActive: {
    borderColor: colors.primary,
    backgroundColor: '#eff6ff',
  },
  mainTabButtonApprovedActive: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  mainTabText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  mainTabTextPendingActive: {
    color: colors.primary,
  },
  mainTabTextApprovedActive: {
    color: '#15803d',
  },
  mainTabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  mainTabBadgePendingActive: {
    backgroundColor: colors.primary,
  },
  mainTabBadgeApprovedActive: {
    backgroundColor: '#16a34a',
  },
  mainTabBadgeText: {
    fontSize: 11,
    fontWeight: fontWeights.heavy,
    color: colors.muted,
  },
  mainTabBadgeTextPendingActive: {
    color: colors.surface,
  },
  mainTabBadgeTextApprovedActive: {
    color: colors.surface,
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
  statusApproved: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
    borderWidth: 1,
    color: '#15803d',
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
  viewApprovedButton: {
    minHeight: 26,
    borderRadius: radius.sm,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  viewApprovedText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#15803d',
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
  adjustedHoursBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.md,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  adjustedHoursBannerTitle: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#854d0e',
  },
  adjustedHoursBold: {
    fontWeight: fontWeights.heavy,
    color: '#713f12',
  },
  adjustedHoursBannerSub: {
    fontSize: 11,
    color: '#a16207',
    marginTop: 1,
  },
  approvedSheetFooter: {
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
  closeSheetBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeSheetText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
  editApprovedBtn: {
    flex: 1.2,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  editApprovedText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
  cancelActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelActionText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
  saveApprovedBtn: {
    flex: 1.2,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveApprovedText: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
  editInputGroup: {
    marginBottom: 10,
  },
  editLabel: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: 4,
  },
  editInput: {
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    fontSize: 14,
    color: colors.text,
  },
  editRow: {
    flexDirection: 'row',
    gap: 8,
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
