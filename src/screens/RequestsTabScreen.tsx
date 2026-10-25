import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, type AppStateStatus, DeviceEventEmitter, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { UniversalDateTimePicker } from '../components/UniversalDateTimePicker';
import { AlertTriangle, CalendarDays, Camera, Check, Clock3, Eye, FileText, Funnel, Lock, Pencil, Plus, RefreshCcw, Search, Trash2, Users, X } from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { getSafeBottomInset, getScreenBottomPadding } from '../utils/safeArea';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import {
  attachScheduledOtPhotoProof,
  deleteMyPendingRequest,
  isUUID,
  loadMyRequests,
  loadMyRequestsCached,
  type MyRequest,
} from '../services/requests';
import {
  isScheduledOtAwaitingProof,
  isScheduledOtReadyForProof,
  isScheduledOtRequest,
  formatScheduledOtStatusMessage,
} from '../utils/scheduledOt';
import { PhotoProofPickerModal, type SelectedProofAttachment } from '../components/PhotoProofPickerModal';
import { formatTimeDisplay, stripSecondsFromTimeString } from '../utils/dateTime';
import { syncAllOfflineItems } from '../services/offlineQueue';
import { isAppOnline, useNetworkStatus } from '../services/network';
import { checkApproverActiveViewing, type ActiveViewerInfo } from '../services/requestViewerLock';
import { ActiveReviewLockModal } from '../components/ActiveReviewLockModal';
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal';
import { isAutoApprovedBirthdayGrant } from '../services/birthdayLeave';
import { resolveApproverLevel } from '../services/positions';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  EsarfCardView,
  EsarfRequestInfoPanel,
  formatUnifiedRequestCode,
  formatUnifiedRequestType,
  getDirectProofImageUrl,
  parseEsarfEntries,
  type ParsedEsarfEntry,
} from '../components/EsarfDetailsView';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type StatusFilter = 'all' | 'pending' | 'approved' | 'validated' | 'rejected';
type CategoryFilter = 'all' | 'esarf' | 'leave' | 'travel_order' | 'perks';

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'validated', label: 'Validated' },
  { key: 'rejected', label: 'Rejected' },
];

const categoryTabs: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'esarf', label: 'ESARF' },
  { key: 'leave', label: 'Leave' },
  { key: 'travel_order', label: 'Travel Order' },
  { key: 'perks', label: 'Perks' },
];
const pageSize = 15;

type Props = {
  profileResult?: ProfileLoadResult | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onHelpTutorials?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenMyTeam?: () => void;
  onOpenRewards?: () => void;
  onEditRequest?: (request: MyRequest) => void;
  onFileTravelOrder?: () => void;
  refreshTrigger?: number;
  pointsBalance?: number;
  onSignOut?: () => void | Promise<void>;
};

export function RequestsTabScreen({
  profileResult,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onHelpTutorials,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onOpenRewards,
  onEditRequest,
  onFileTravelOrder,
  refreshTrigger,
  pointsBalance = 0,
  onSignOut,
}: Props) {
  const [items, setItems] = useState<MyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeDatePicker, setActiveDatePicker] = useState<'from' | 'to' | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const [selectedRequest, setSelectedRequest] = useState<{ item: MyRequest; sequence: number } | null>(null);
  const [activeLockInfo, setActiveLockInfo] = useState<ActiveViewerInfo | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [requestToDelete, setRequestToDelete] = useState<{ item: MyRequest; sequence: number } | null>(null);
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;
  const insets = useSafeAreaInsets();
  const { isOnline } = useNetworkStatus();

  async function handleEditRequest(item: MyRequest) {
    if (!onEditRequest) return;
    if (!canEditRequest(item)) {
      const msg = 'This ESARF request has already received an approval in the timeline and can no longer be edited.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(msg);
      } else {
        Alert.alert('Cannot Edit Request', msg);
      }
      return;
    }
    const lockInfo = await checkApproverActiveViewing(item.request_id);
    if (lockInfo.isLocked) {
      if (selectedRequest) {
        setSelectedRequest(null);
      }
      setActiveLockInfo(lockInfo);
      return;
    }
    onEditRequest(item);
  }

  function handleDeleteRequest(item: MyRequest, sequence?: number) {
    const statusKey = normalizeStatus(item.status, item);
    if (statusKey !== 'pending') return;
    if (!canDeleteRequest(item, isOnline)) {
      const msg = !isOnline || !isAppOnline()
        ? 'Deleting requests is only available in online mode once requests are synced.'
        : isOfflineUnsyncedRequest(item)
          ? 'This offline request has not been synced online yet. Requests can only be deleted once synced online.'
          : 'This ESARF request has already received an approval in the timeline and can no longer be deleted.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(msg);
      } else {
        Alert.alert('Cannot Delete Request', msg);
      }
      return;
    }
    if (selectedRequest) {
      setSelectedRequest(null);
    }
    setRequestToDelete({ item, sequence: sequence ?? 1 });
  }

  async function handleConfirmDelete() {
    if (!requestToDelete) return;
    const req = requestToDelete.item;
    const isPerk = isPerkRequest(req);
    setRequestToDelete(null);
    setTimeout(() => {
      void executeDelete(req, isPerk);
    }, 80);
  }

  function handleCancelDelete() {
    setRequestToDelete(null);
  }

  async function executeDelete(item: MyRequest, isPerk: boolean) {
    const targetId = item.request_id;
    // Immediately dismiss modal and details sheet so screen never freezes or locks touch
    setRequestToDelete(null);
    if (selectedRequest?.item.request_id === targetId) {
      setSelectedRequest(null);
    }

    if (!canDeleteRequest(item, isOnline)) {
      const msg = !isOnline || !isAppOnline()
        ? 'Deleting requests is only available in online mode once requests are synced.'
        : isOfflineUnsyncedRequest(item)
          ? 'This offline request has not been synced online yet. Requests can only be deleted once synced online.'
          : 'This ESARF request has already received an approval in the timeline and can no longer be deleted.';
      setTimeout(() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(msg);
        } else {
          Alert.alert('Cannot Delete Request', msg);
        }
      }, 150);
      return;
    }

    setDeletingId(targetId);

    // Optimistically remove from list immediately for 0-lag UI feedback
    const previousItems = items;
    setItems((prev) => prev.filter((r) => r.request_id !== targetId));

    try {
      if (isAppOnline() && isUUID(targetId)) {
        const lockInfo = await checkApproverActiveViewing(targetId);
        if (lockInfo.isLocked) {
          setItems(previousItems);
          setActiveLockInfo(lockInfo);
          return;
        }
      }

      await deleteMyPendingRequest(targetId, isPerk);
      clearEsarfEntriesCache();

      if (isAppOnline()) {
        void refreshSilently();
      } else {
        const cached = await loadMyRequestsCached();
        if (cached && cached.length) {
          setItems(cached);
        }
      }
    } catch (error) {
      setItems(previousItems);
      const msg = error instanceof Error ? error.message : 'Unable to delete request.';
      setTimeout(() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(msg);
        } else {
          Alert.alert('Delete Failed', msg);
        }
      }, 150);
    } finally {
      setDeletingId(null);
    }
  }

  async function refresh(forceRefresh = true) {
    clearEsarfEntriesCache();
    setIsLoading(true);
    setStatus('Loading...');
    try {
      const requests = await loadMyRequests(forceRefresh);
      setItems(requests);
      setStatus(requests.length ? '' : 'No requests yet.');
    } catch (error) {
      const cached = await loadMyRequestsCached();
      if (cached && cached.length) {
        setItems(cached);
        setStatus('');
      } else {
        setStatus(error instanceof Error ? error.message : 'Unable to load requests.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const handlePullRefresh = async () => {
    setIsPullRefreshing(true);
    try {
      if (isAppOnline()) {
        await syncAllOfflineItems().catch(() => { });
      }
      await refresh(true);
    } finally {
      setIsPullRefreshing(false);
    }
  };



  const handleView = useCallback((item: MyRequest, sequence: number) => {
    setSelectedRequest({ item, sequence });
  }, []);

  const handleEdit = useCallback((item: MyRequest) => {
    clearEsarfEntriesCache();
    void handleEditRequest(item);
  }, [onEditRequest]);

  const handleDelete = useCallback((item: MyRequest, sequence?: number) => {
    handleDeleteRequest(item, sequence);
  }, []);

  async function refreshSilently() {
    try {
      const requests = await loadMyRequests(true);
      clearEsarfEntriesCache();
      setItems(requests);
      setStatus(requests.length ? '' : 'No requests yet.');
      setSelectedRequest((curr) => {
        if (!curr) return null;
        const fresh = requests.find((it) => it.request_id === curr.item.request_id);
        if (fresh) {
          return { ...curr, item: fresh };
        }
        return curr;
      });
    } catch {
      // Keep current items on silent error
    }
  }

  useEffect(() => {
    let active = true;

    // 1. Initial load from cache then fresh from server
    (async () => {
      const cached = await loadMyRequestsCached();
      if (active && cached.length) {
        setItems(cached);
        setStatus('');
      }
      if (active) {
        if (!cached || !cached.length) {
          await refresh(true);
        } else {
          void refreshSilently();
        }
      }
    })();

    // 2. AppState listener: Refresh whenever the app is brought to foreground
    const appStateSub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        void refreshSilently();
      }
    });

    // 3. Periodic silent polling (every 60 seconds while on screen as backup to Realtime WebSocket)
    const pollInterval = setInterval(() => {
      void refreshSilently();
    }, 60000);

    // 4. Supabase Realtime channel subscription for instant database reflections
    let realtimeChannel: any = null;
    const employeeId = profileResult?.status === 'linked' ? profileResult.profile.employeeId : undefined;

    if (isSupabaseConfigured) {
      const channelId = `realtime_requests_screen_${employeeId || 'my'}_${Date.now()}`;
      realtimeChannel = supabase.channel(channelId);

      if (employeeId) {
        realtimeChannel
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'requests',
              filter: `submitted_by_employee_id=eq.${employeeId}`,
            },
            () => {
              void refreshSilently();
            },
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'employee_perk_requests',
              filter: `employee_id=eq.${employeeId}`,
            },
            () => {
              void refreshSilently();
            },
          );
      } else {
        realtimeChannel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'requests',
          },
          () => {
            void refreshSilently();
          },
        );
      }

      realtimeChannel.subscribe();
    }

    // 5. Listen for offline request queue / cache updates
    const requestsUpdatedSub = DeviceEventEmitter.addListener('my_requests_updated', async () => {
      clearEsarfEntriesCache();
      const cached = await loadMyRequestsCached();
      if (active && cached) {
        setItems(cached);
        setStatus(cached.length ? '' : 'No requests yet.');

        setSelectedRequest((curr) => {
          if (!curr) return null;
          const fresh = cached.find((it) => it.request_id === curr.item.request_id);
          if (fresh) {
            return { ...curr, item: fresh };
          }
          return curr;
        });
      }
      if (active && isAppOnline()) {
        void refreshSilently();
      }
    });

    const reqSyncedSub = DeviceEventEmitter.addListener('offline_request_synced', ({ oldId, newId }: { oldId: string; newId: string }) => {
      if (!active) return;
      setItems((prev) =>
        prev.map((it) => (it.request_id === oldId ? { ...it, request_id: newId, status: 'pending' } : it)),
      );
      setSelectedRequest((curr) => {
        if (!curr || curr.item.request_id !== oldId) return curr;
        return {
          ...curr,
          item: {
            ...curr.item,
            request_id: newId,
            status: 'pending',
          },
        };
      });
    });

    const reqSyncedOnlineSub = DeviceEventEmitter.addListener('requests_synced_online', () => {
      if (!active) return;
      clearEsarfEntriesCache();
      if (isAppOnline()) {
        void refreshSilently();
      }
    });

    return () => {
      active = false;
      appStateSub.remove();
      clearInterval(pollInterval);
      requestsUpdatedSub.remove();
      reqSyncedSub.remove();
      reqSyncedOnlineSub.remove();
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, [profileResult?.status, profileResult?.status === 'linked' ? profileResult.profile.employeeId : undefined, refreshTrigger]);

  const counts = useMemo(() => {
    const categoryItems = activeCategory === 'all'
      ? items.filter(Boolean)
      : items.filter((item) => Boolean(item) && requestCategory(item) === activeCategory);

    return categoryItems.reduce(
      (totals, item) => {
        if (!item) return totals;
        totals.all += 1;
        const statusKey = normalizeStatus(item.status, item);
        if (statusKey === 'validated') totals.validated += 1;
        else if (statusKey === 'approved') totals.approved += 1;
        else if (statusKey === 'rejected') totals.rejected += 1;
        else totals.pending += 1;
        return totals;
      },
      { all: 0, pending: 0, approved: 0, validated: 0, rejected: 0 },
    );
  }, [activeCategory, items]);

  const categoryCounts = useMemo(() => {
    return items.filter(Boolean).reduce(
      (totals, item) => {
        if (!item) return totals;
        totals.all += 1;
        const cat = requestCategory(item);
        if (totals[cat] !== undefined) {
          totals[cat] += 1;
        }
        return totals;
      },
      { all: 0, esarf: 0, leave: 0, travel_order: 0, perks: 0 },
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const fromTime = parseFilterDate(dateFrom);
    const toTime = parseFilterDate(dateTo, true);

    return items.filter((item) => {
      if (!item) return false;
      const statusKey = normalizeStatus(item.status, item);
      if (activeStatus !== 'all' && statusKey !== activeStatus) return false;
      if (activeCategory !== 'all' && requestCategory(item) !== activeCategory) return false;

      const requestTime = parseFilterDate(getRequestDate(item));
      if (fromTime !== null && (requestTime === null || requestTime < fromTime)) return false;
      if (toTime !== null && (requestTime === null || requestTime > toTime)) return false;

      if (!normalizedQuery) return true;
      const haystack = [
        item.request_id,
        formatRequestCode(item),
        item.request_type_name,
        item.request_type_code,
        item.status,
        statusLabel(item),
        item.reason,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    }).sort((a, b) => {
      const timeA = a.submitted_at ? Date.parse(a.submitted_at) : 0;
      const timeB = b.submitted_at ? Date.parse(b.submitted_at) : 0;
      return timeB - timeA;
    });
  }, [activeCategory, activeStatus, dateFrom, dateTo, items, query]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [currentPage, filteredItems]);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, activeStatus, dateFrom, dateTo, query]);

  function openDatePicker(target: 'from' | 'to') {
    setActiveDatePicker(target);
    setTempPickerDate(dateValueForPicker(target));
  }

  function dateValueForPicker(target: 'from' | 'to') {
    const value = target === 'from' ? dateFrom : dateTo;
    const parsed = parseFilterDate(value);
    return parsed === null ? new Date() : new Date(parsed);
  }

  function applyDatePickerValue(target: 'from' | 'to', date: Date) {
    const formatted = formatDatePickerValue(date);
    if (target === 'from') setDateFrom(formatted);
    else setDateTo(formatted);
  }

  function handleDatePickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setActiveDatePicker(null);
      return;
    }

    if (!selectedDate || !activeDatePicker) return;

    if (Platform.OS === 'ios') {
      setTempPickerDate(selectedDate);
      return;
    }

    applyDatePickerValue(activeDatePicker, selectedDate);
    setActiveDatePicker(null);
  }

  function confirmIosDatePicker() {
    if (activeDatePicker) {
      applyDatePickerValue(activeDatePicker, tempPickerDate);
    }
    setActiveDatePicker(null);
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        showNetworkStatus
        name={profile?.fullName}
        username={profile?.username}
        photoUrl={profile?.photoUrl}
        pointsBalance={pointsBalance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onHelpTutorials={onHelpTutorials}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onOpenRewards={onOpenRewards}
        onSignOut={onSignOut}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: getScreenBottomPadding(insets.bottom, true, 28) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={handlePullRefresh}
            colors={[colors.brand.gold, colors.primary]}
            tintColor={colors.brand.gold}
            progressBackgroundColor="#ffffff"
          />
        }
      >
        <View style={styles.filterPanel}>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Search size={16} color={colors.muted} strokeWidth={2.4} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search requests..."
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                returnKeyType="search"
              />
            </View>
            <Pressable disabled={isLoading} style={styles.filterButton} onPress={() => void refresh(true)}>
              {isLoading ? (
                <RefreshCcw size={15} color={colors.text} strokeWidth={2.6} />
              ) : (
                <Funnel size={15} color={colors.text} fill={colors.text} strokeWidth={2.2} />
              )}
              <Text style={styles.filterButtonText}>{isLoading ? 'Sync' : 'Filter'}</Text>
            </Pressable>
          </View>

          <View style={styles.dateRow}>
            <Pressable style={styles.dateField} onPress={() => openDatePicker('from')}>
              <Text style={[styles.dateInput, !dateFrom && styles.datePlaceholder]}>
                {dateFrom || 'mm/dd/yyyy'}
              </Text>
              <CalendarDays size={15} color={colors.text} strokeWidth={2.3} />
            </Pressable>
            <Text style={styles.dateDash}>-</Text>
            <Pressable style={styles.dateField} onPress={() => openDatePicker('to')}>
              <Text style={[styles.dateInput, !dateTo && styles.datePlaceholder]}>
                {dateTo || 'mm/dd/yyyy'}
              </Text>
              <CalendarDays size={15} color={colors.text} strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRowContent}
            style={styles.categoryScroll}
          >
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
                        {categoryCounts[tab.key] ?? 0}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.tabsCard}>
          {statusTabs.map((tab) => {
            const active = activeStatus === tab.key;
            return (
              <Pressable key={tab.key} style={styles.tabButton} onPress={() => setActiveStatus(tab.key)}>
                <View style={styles.tabLabelRow}>
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
                  <View style={styles.tabCountBadge}>
                    <Text style={styles.tabCountText}>{counts[tab.key]}</Text>
                  </View>
                </View>
                {active ? <View style={styles.tabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>

        {status && status !== 'No requests yet.' ? <Text style={styles.status}>{status}</Text> : null}

        {filteredItems.length === 0 && !isLoading ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>
              {activeCategory === 'travel_order'
                ? 'No Travel Orders'
                : activeCategory === 'leave'
                ? 'No Leave Requests'
                : activeCategory === 'esarf'
                ? 'No ESARF Requests'
                : activeCategory === 'perks'
                ? 'No Perk Requests'
                : 'No Requests Found'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeCategory === 'travel_order'
                ? 'You have not submitted any official travel order requests yet.'
                : query
                ? `No requests match "${query}".`
                : activeStatus !== 'all'
                ? `No ${activeStatus} requests found.`
                : 'You have no requests in this category.'}
            </Text>
            {activeCategory === 'travel_order' && onFileTravelOrder ? (
              <Pressable style={styles.emptyActionBtn} onPress={onFileTravelOrder}>
                <Plus size={16} color="#ffffff" strokeWidth={2.4} />
                <Text style={styles.emptyActionBtnText}>File Travel Order</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {paginatedItems.map((item, index) => {
          const sequence = (currentPage - 1) * pageSize + index + 1;
          return (
            <RequestCard
              key={item.request_id || `req-${index}`}
              item={item}
              profile={profile}
              sequence={sequence}
              isDeleting={deletingId === item.request_id}
              isOnline={isOnline}
              onView={handleView}
              onEdit={onEditRequest ? handleEdit : undefined}
              onDelete={undefined}
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
              onPress={() => setPage((value) => Math.max(pageCount, value + 1))}
            >
              <Text style={styles.paginationButtonText}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {activeDatePicker ? (
        <UniversalDateTimePicker
          value={dateValueForPicker(activeDatePicker)}
          mode="date"
          display="default"
          onChange={handleDatePickerChange}
          onClose={() => setActiveDatePicker(null)}
        />
      ) : null}

      <RequestDetailsSheet
        request={
          selectedRequest
            ? {
              ...selectedRequest,
              item: items.find((it) => it.request_id === selectedRequest.item.request_id) || selectedRequest.item,
            }
            : null
        }
        profile={profile}
        isDeleting={Boolean(selectedRequest && deletingId === selectedRequest.item.request_id)}
        onClose={() => setSelectedRequest(null)}
        onEdit={
          selectedRequest && canEditRequest(selectedRequest.item) && onEditRequest
            ? (req) => void handleEditRequest(req)
            : undefined
        }
        onDelete={undefined}
        onProofAttached={async () => {
          setSelectedRequest(null);
          await refresh(true);
        }}
      />

      <DeleteConfirmationModal
        visible={Boolean(requestToDelete)}
        request={requestToDelete?.item ?? null}
        sequence={requestToDelete?.sequence ?? 1}
        isDeleting={Boolean(requestToDelete && deletingId === requestToDelete.item.request_id)}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={handleCancelDelete}
      />

      <ActiveReviewLockModal
        visible={Boolean(activeLockInfo)}
        approverName={activeLockInfo?.approverName}
        approverPosition={activeLockInfo?.approverPosition}
        onClose={() => setActiveLockInfo(null)}
      />
    </View>
  );
}

const RequestCard = memo(function RequestCard({
  item,
  profile,
  sequence,
  isDeleting,
  isOnline = true,
  onView,
  onEdit,
  onDelete,
}: {
  item: MyRequest;
  profile: EmployeeProfileSummary | null;
  sequence: number;
  isDeleting?: boolean;
  isOnline?: boolean;
  onView: (item: MyRequest, sequence: number) => void;
  onEdit?: (item: MyRequest) => void;
  onDelete?: (item: MyRequest, sequence?: number) => void;
}) {
  const statusKey = normalizeStatus(item.status, item);
  const requestDate = getRequestDate(item);
  const displayName = formatEmployeeDisplayName(profile);
  const department = formatProfileWorkUnit(profile);
  const isPerk = isPerkRequest(item);
  const canEdit = canEditRequest(item);
  const canDelete = canDeleteRequest(item, isOnline);

  return (
    <View style={styles.cardOuter}>
      <View style={[styles.card, isDeleting ? { opacity: 0.6 } : null]}>
        <View style={styles.avatar}>
          <Avatar name={displayName} photoUrl={profile?.photoUrl} size={35} textSize={13} />
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTopRow}>
            <View style={styles.cardTitleBlock}>
              <Text style={styles.cardCode} numberOfLines={1}>
                {formatRequestCode(item, sequence)}
              </Text>
              <Text style={styles.cardName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.cardDept}>{department}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={[styles.statusPill, statusPillStyle(statusKey, item)]} numberOfLines={1}>
                {renderStatusPillContent(item)}
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

          {isScheduledOtAwaitingProof(item) ? (
            <View
              style={[
                styles.cardOtBadge,
                isScheduledOtReadyForProof(item) ? styles.cardOtBadgeReady : styles.cardOtBadgeLocked,
              ]}
            >
              {isScheduledOtReadyForProof(item) ? (
                <>
                  <Camera size={13} color="#b45309" strokeWidth={2.3} />
                  <Text style={styles.cardOtBadgeTextReady}>Attach Photo Proof Required</Text>
                </>
              ) : (
                <>
                  <Lock size={13} color="#1d4ed8" strokeWidth={2.3} />
                  <Text style={styles.cardOtBadgeTextLocked}>
                    Attach proof opens on schedule ({formatCompactDate(item.date_from || item.submitted_at)})
                  </Text>
                </>
              )}
            </View>
          ) : null}

          <View style={styles.cardBottomRow}>
            <View style={styles.typePill}>
              <Text style={styles.typePillText} numberOfLines={1} ellipsizeMode="tail">
                {formatRequestType(item)}
              </Text>
            </View>
            {statusKey === 'pending' ? (
              <>
                {!isPerk && canEdit && onEdit ? (
                  <Pressable
                    style={styles.editButton}
                    onPress={() => onEdit(item)}
                    accessibilityLabel="Edit request"
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Pencil size={14} color="#92400e" strokeWidth={2.3} />
                    <Text style={styles.editText}>Edit</Text>
                  </Pressable>
                ) : null}
                {/* Delete button temporarily removed */}
              </>
            ) : null}
            <Pressable
              style={styles.viewButton}
              onPress={() => onView(item, sequence)}
              accessibilityLabel="View request"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Eye size={15} color={colors.text} strokeWidth={2.3} />
              <Text style={styles.viewText}>View</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
});

function RequestDetailsSheet({
  request,
  profile,
  isDeleting,
  onClose,
  onEdit,
  onDelete,
  onProofAttached,
}: {
  request: { item: MyRequest; sequence: number } | null;
  profile: EmployeeProfileSummary | null;
  isDeleting?: boolean;
  onClose: () => void;
  onEdit?: (request: MyRequest) => void;
  onDelete?: (request: MyRequest) => void;
  onProofAttached?: () => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const footerBottomPadding = getSafeBottomInset(insets.bottom, Platform.OS === 'ios' ? 24 : spacing.md);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!request) {
      setShowDeleteConfirm(false);
    }
  }, [request]);

  const lastRequestRef = useRef(request);
  if (request) {
    lastRequestRef.current = request;
  }
  const displayRequest = request || lastRequestRef.current;

  if (!displayRequest) return null;

  const { item, sequence } = displayRequest;
  const displayName = formatEmployeeDisplayName(profile);
  const department = formatProfileWorkUnit(profile);
  const isLeave = item.request_type_code === 'leave';
  const isPerk = isPerkRequest(item);
  const isTravel = isTravelOrderRequest(item);
  const rejectedReason = getRejectedReason(item);
  const currentStatusDate = item.final_approved_at || item.rejected_at || item.submitted_at;
  const itemStatusKey = normalizeStatus(item.status, item);
  const timelineRows = isPerk ? [
    {
      title: itemStatusKey === 'approved' ? 'Approval Code Success' : 'Waiting for Approval Code',
      subtitle: itemStatusKey === 'approved' ? 'Email approval code verified' : 'Approval code not yet verified',
      date: formatSheetDate(currentStatusDate),
      time: formatSheetTime(currentStatusDate),
      tone: itemStatusKey === 'approved' ? ('success' as const) : ('warning' as const),
    },
  ] : [
    {
      title: 'Submitted',
      subtitle: 'Request submitted',
      date: formatSheetDate(item.submitted_at),
      time: formatSheetTime(item.submitted_at),
      tone: 'muted' as const,
    },
    ...approvalTimeline(item).map((step) => ({
      title: step.label,
      subtitle: step.status,
      date: step.actedAt ? formatSheetDate(step.actedAt) : undefined,
      time: step.actedAt ? formatSheetTime(step.actedAt) : undefined,
      tone: timelineTone(step.status),
    })),
  ];

  return (
    <Modal transparent animationType="slide" visible={Boolean(request)} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.detailsSheet}>
          <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.requestSummaryHeader}>
              <View style={styles.requestSummaryText}>
                <Text style={styles.sheetTitle}>{requestSheetTitle(item)}</Text>
                <View style={styles.sheetCodeRow}>
                  <Text style={styles.sheetCode}>{formatRequestDocumentCode(item, sequence)}</Text>
                  <Text style={[styles.sheetStatusPill, statusPillStyle(itemStatusKey, item)]}>
                    {renderStatusPillContent(item)}
                  </Text>
                </View>
              </View>
              <Pressable style={styles.sheetIconClose} onPress={onClose}>
                <X size={18} color={colors.text} strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.sheetHeader}>
              <View style={styles.sheetProfileRow}>
                <Avatar name={displayName} photoUrl={profile?.photoUrl} size={34} textSize={13} />
                <View style={styles.sheetProfileText}>
                  <Text style={styles.sheetName} numberOfLines={1}>{displayName}</Text>
                  <Text style={styles.sheetDept} numberOfLines={1}>{department}</Text>
                </View>
              </View>
              <View style={styles.submittedBlock}>
                <Text style={styles.submittedLabel}>Submitted on</Text>
                <Text style={styles.submittedDate}>{formatSheetDate(item.submitted_at)}</Text>
                <Text style={styles.submittedTime}>{formatSheetTime(item.submitted_at)}</Text>
              </View>
            </View>

            {isPerk || isLeave ? (
              <>
                <SectionTitle icon="file" title="Request Information" />
                <View style={styles.detailsList}>
                  {isPerk ? (
                    <>
                      <DetailRow icon="file" label="Transaction Type" value={formatRequestType(item)} />
                      <DetailRow icon="file" label="Approval Code" value={item.perk_approval_code || 'N/A'} />
                      <DetailRow icon="calendar" label="Transaction Date" value={formatSheetDate(item.date_from)} />
                      <DetailRow icon="file" label="Benefit" value={item.perk_benefit || 'N/A'} />
                    </>
                  ) : (
                    <>
                      <DetailRow icon="file" label="Transaction Type" value={formatRequestType(item)} />
                      <DetailRow icon="file" label="Leave Type" value={item.leave_type || 'N/A'} />
                      <DetailRow icon="calendar" label="Leave Category" value={item.leave_category || 'N/A'} />
                    </>
                  )}
                </View>
              </>
            ) : isTravel ? (
              <>
                <SectionTitle icon="file" title="Request Information" />
                <View style={styles.detailsList}>
                  <DetailRow icon="file" label="Transaction Type" value="Official Travel Order" />
                  <DetailRow icon="calendar" label="Travel Dates" value={compactRange(item.date_from, item.date_to)} />
                  {item.time_from ? (
                    <DetailRow
                      icon="clock"
                      label="Departure / Return Time"
                      value={`${formatCompactTime(item.time_from)}${item.time_to ? ` - ${formatCompactTime(item.time_to)}` : ''}`}
                    />
                  ) : null}
                </View>
              </>
            ) : (
              <EsarfRequestInfoPanel
                transactionType={formatRequestType(item)}
                timeSchedule={item.time_schedule}
                dayOff={item.day_off}
                payrollClass={item.payroll_class}
              />
            )}

            {isPerk ? (
              <View style={styles.rangePanel}>
                <View style={styles.panelTitleRow}>
                  <FileText size={15} color={colors.muted} strokeWidth={2.2} />
                  <Text style={styles.panelTitle}>Approved Slip</Text>
                </View>
                <View style={styles.slipItemsBox}>
                  <Text style={styles.slipItemsLabel}>Items</Text>
                  <Text style={styles.slipItemsText}>{item.reason || 'No items listed.'}</Text>
                </View>
                <View style={styles.slipTotals}>
                  <AmountLine label="Subtotal" value={`PHP ${formatMoney(item.perk_amount)}`} />
                  <AmountLine label="Discount 15%" value={`PHP ${formatMoney(item.perk_discount_amount)}`} />
                  <View style={styles.slipTotalDivider} />
                  <AmountLine label="Total" value={`PHP ${formatMoney(item.perk_final_amount)}`} strong />
                </View>
              </View>
            ) : isLeave ? (
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
                  <Text style={styles.reasonText}>{item.reason || 'No reason provided.'}</Text>
                  {rejectedReason ? (
                    <View style={styles.rejectedReasonBox}>
                      <Text style={styles.rejectedReasonLabel}>Rejected reason</Text>
                      <Text style={styles.rejectedReasonText}>{rejectedReason}</Text>
                    </View>
                  ) : null}
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
            ) : isTravel ? (
              <>
                <View style={styles.rangePanel}>
                  <View style={styles.panelTitleRow}>
                    <CalendarDays size={15} color={colors.muted} strokeWidth={2.2} />
                    <Text style={styles.panelTitle}>Travel Itinerary</Text>
                  </View>
                  <View style={styles.rangeGrid}>
                    <DetailItem label="Departure Date" value={formatSheetDate(item.date_from)} />
                    <DetailItem label="Return Date" value={formatSheetDate(item.date_to || item.date_from)} />
                    {item.time_from ? (
                      <DetailItem
                        label="Departure Time"
                        value={formatCompactTime(item.time_from)}
                      />
                    ) : null}
                    {item.time_to ? (
                      <DetailItem
                        label="Return Time"
                        value={formatCompactTime(item.time_to)}
                      />
                    ) : null}
                  </View>
                </View>

                <View style={styles.reasonBlock}>
                  <View style={styles.panelTitleRow}>
                    <FileText size={15} color={colors.muted} strokeWidth={2.2} />
                    <Text style={styles.panelTitle}>Purpose & Directive Details</Text>
                  </View>
                  <Text style={styles.reasonText}>{item.reason || 'Official Travel Order directive.'}</Text>
                  {rejectedReason ? (
                    <View style={styles.rejectedReasonBox}>
                      <Text style={styles.rejectedReasonLabel}>Rejected reason</Text>
                      <Text style={styles.rejectedReasonText}>{rejectedReason}</Text>
                    </View>
                  ) : null}
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
              /* ESARF entry cards matching exact image design */
              <View style={{ marginTop: 0 }}>
                {getCachedEsarfEntries(item).map((entry) => (
                  <EsarfCardView key={entry.index} entry={entry} timelineRows={timelineRows} />
                ))}
                {isScheduledOtAwaitingProof(item) ? (
                  <ScheduledOtPhotoProofCard
                    item={item}
                    profile={profile}
                    onProofAttached={onProofAttached}
                  />
                ) : null}
                {rejectedReason ? (
                  <View style={styles.rejectedReasonBox}>
                    <Text style={styles.rejectedReasonLabel}>Rejected reason</Text>
                    <Text style={styles.rejectedReasonText}>{rejectedReason}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>
          <View style={[styles.sheetFooter, { paddingBottom: footerBottomPadding }]}>
            {itemStatusKey === 'pending' ? (
              <>
                {!isPerk && onEdit ? (
                  <Pressable
                    style={styles.sheetEditButton}
                    onPress={() => {
                      const itemToEdit = item;
                      onClose();
                      if (onEdit) {
                        setTimeout(() => {
                          onEdit(itemToEdit);
                        }, 50);
                      }
                    }}
                  >
                    <Pencil size={15} color="#92400e" strokeWidth={2.4} />
                    <Text style={styles.sheetEditText}>Edit Request</Text>
                  </Pressable>
                ) : null}
                {/* Delete button temporarily removed */}
              </>
            ) : null}
            <Pressable style={styles.sheetCloseButton} onPress={onClose}>
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>

        {showDeleteConfirm ? (
          <DeleteConfirmationModal
            visible={showDeleteConfirm}
            request={item}
            sequence={sequence}
            isDeleting={isDeleting}
            useModal={false}
            onConfirm={() => {
              setShowDeleteConfirm(false);
              const target = item;
              onClose();
              if (onDelete) {
                setTimeout(() => {
                  onDelete(target);
                }, 100);
              }
            }}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function ScheduledOtPhotoProofCard({
  item,
  profile,
  onProofAttached,
}: {
  item: MyRequest;
  profile: EmployeeProfileSummary | null;
  onProofAttached?: () => void | Promise<void>;
}) {
  const [selectedProofs, setSelectedProofs] = useState<SelectedProofAttachment[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReady = isScheduledOtReadyForProof(item);
  const statusMessage = formatScheduledOtStatusMessage(item);

  const userInfo = useMemo(() => ({
    resolvedEmpId: profile?.employeeId,
    resolvedName: profile?.fullName,
    resolvedEmail: profile?.email,
    resolvedStore: profile?.storeName,
    resolvedAuthId: profile?.profileId,
  }), [profile]);

  async function handleSubmitProof() {
    if (selectedProofs.length === 0) {
      const msg = 'Please select at least 1 photo proof to attach before submitting.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(msg);
      } else {
        Alert.alert('Photo Proof Required', msg);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      await attachScheduledOtPhotoProof({
        requestId: item.request_id,
        proofs: selectedProofs,
      });

      const successMsg = 'Photo proof attached successfully! Your scheduled OT request has been forwarded to your approver(s).';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(successMsg);
      } else {
        Alert.alert('Proof Attached', successMsg);
      }

      if (onProofAttached) {
        await onProofAttached();
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to attach photo proof. Please try again.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(errMsg);
      } else {
        Alert.alert('Submission Failed', errMsg);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleRemoveProof(index: number) {
    setSelectedProofs((prev) => prev.filter((_, i) => i !== index));
  }

  const unlockDate = formatCompactDate(item.date_from || item.submitted_at);

  return (
    <View style={[styles.scheduledOtProofCard, !isReady ? styles.scheduledOtProofCardDisabled : null]}>
      <View style={styles.scheduledOtProofHeaderRow}>
        <View style={styles.scheduledOtProofHeaderTitleRow}>
          <Camera
            size={16}
            color={!isReady ? '#64748b' : selectedProofs.length > 0 ? '#15803d' : '#2563eb'}
            strokeWidth={2.2}
            style={{ marginTop: 2 }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.scheduledOtProofTitleCountRow}>
              <Text style={[styles.scheduledOtProofSectionTitle, !isReady ? styles.scheduledOtTextDisabled : null]}>
                Photo Proof
              </Text>
              <Text style={styles.scheduledOtProofSectionCount}>
                ({selectedProofs.length}/3)
              </Text>
            </View>
            <Text style={styles.scheduledOtProofSectionSubtitle} numberOfLines={1}>
              Attach up to 3 Photo Proofs
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.scheduledOtReqBadge,
            !isReady
              ? styles.scheduledOtReqBadgeOptional
              : selectedProofs.length > 0
                ? styles.scheduledOtReqBadgeSuccess
                : styles.scheduledOtReqBadgeRequired,
          ]}
        >
          {selectedProofs.length > 0 ? (
            <Check size={11} color="#15803d" strokeWidth={2.8} />
          ) : null}
          <Text
            style={[
              styles.scheduledOtReqBadgeText,
              !isReady
                ? styles.scheduledOtReqBadgeTextOptional
                : selectedProofs.length > 0
                  ? styles.scheduledOtReqBadgeTextSuccess
                  : styles.scheduledOtReqBadgeTextRequired,
            ]}
          >
            {!isReady ? 'Optional' : selectedProofs.length > 0 ? `${selectedProofs.length} Attached` : '1 Required'}
          </Text>
        </View>
      </View>

      {!isReady ? (
        <View style={styles.scheduledOtLockedButton}>
          <Lock size={15} color="#ffffff" strokeWidth={2.2} />
          <Text style={styles.scheduledOtLockedButtonText}>
            Proof attachment unlocks on {unlockDate}
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 4 }}>
          {selectedProofs.length > 0 ? (
            <View style={styles.scheduledOtThumbnailRow}>
              {selectedProofs.map((proof, idx) => (
                <View key={proof.uri + idx} style={styles.scheduledOtThumbWrap}>
                  {Platform.OS === 'web' ? (
                    React.createElement('img', {
                      src: getDirectProofImageUrl(proof.uri),
                      referrerPolicy: 'no-referrer',
                      style: { width: 64, height: 64, borderRadius: 10, objectFit: 'cover' },
                    })
                  ) : (
                    <Image
                      source={{ uri: getDirectProofImageUrl(proof.uri) }}
                      style={styles.scheduledOtThumbImg}
                      resizeMode="cover"
                    />
                  )}
                  <Pressable
                    style={styles.scheduledOtThumbRemoveBtn}
                    onPress={() => handleRemoveProof(idx)}
                    hitSlop={6}
                  >
                    <X size={12} color="#ffffff" strokeWidth={3} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.scheduledOtActionRow}>
            <Pressable
              style={styles.scheduledOtPrimaryBtn}
              onPress={() => setIsPickerOpen(true)}
              disabled={isSubmitting}
            >
              <Camera size={15} color="#ffffff" strokeWidth={2.2} />
              <Text style={styles.scheduledOtPrimaryBtnText}>
                {selectedProofs.length > 0
                  ? `Manage Proofs (${selectedProofs.length}/3)`
                  : 'Attach Photo Proof (1 Required)'}
              </Text>
            </Pressable>

            {selectedProofs.length > 0 ? (
              <Pressable
                style={[styles.scheduledOtSubmitBtn, isSubmitting ? { opacity: 0.7 } : null]}
                onPress={handleSubmitProof}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Check size={16} color="#ffffff" strokeWidth={2.4} />
                    <Text style={styles.scheduledOtSubmitBtnText}>Submit Proof & Forward Request</Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {isPickerOpen ? (
        <PhotoProofPickerModal
          visible={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          selectedProofs={selectedProofs}
          onSelectProofs={(proofs) => setSelectedProofs(proofs)}
          userInfo={userInfo}
          title="Attach Photo Proof for Scheduled OT"
          subtitle="Select up to 3 photos from your Photo Log or upload from Gallery"
          maxSlots={3}
        />
      ) : null}
    </View>
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

function AmountLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.amountLine}>
      <Text style={[styles.amountLineLabel, strong ? styles.amountLineStrong : null]}>{label}</Text>
      <Text style={[styles.amountLineValue, strong ? styles.amountLineValueStrong : null]}>{value}</Text>
    </View>
  );
}

function getDetailIcon(icon: 'file' | 'clock' | 'calendar' | 'users') {
  if (icon === 'clock') return Clock3;
  if (icon === 'calendar') return CalendarDays;
  if (icon === 'users') return Users;
  return FileText;
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
  tone: 'warning' | 'success' | 'danger' | 'muted';
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

function timelineDotStyle(tone: 'warning' | 'success' | 'danger' | 'muted') {
  if (tone === 'warning') return { borderColor: colors.semantic.warning, backgroundColor: colors.surface };
  if (tone === 'success') return { borderColor: colors.semantic.success, backgroundColor: colors.semantic.success };
  if (tone === 'danger') return { borderColor: colors.semantic.danger, backgroundColor: colors.semantic.danger };
  return { borderColor: colors.border, backgroundColor: colors.border };
}


const esarfEntriesCache = new Map<string, ParsedEsarfEntry[]>();

export function clearEsarfEntriesCache() {
  esarfEntriesCache.clear();
}

function getCachedEsarfEntries(item: MyRequest): ParsedEsarfEntry[] {
  const key = [
    'v3',
    item.request_id || '',
    item.status || '',
    item.time_schedule || '',
    item.day_off || '',
    item.payroll_class || '',
    item.date_from || '',
    item.date_to || '',
    item.time_from || '',
    item.time_to || '',
    item.total_hours ?? '',
    item.transaction_type || '',
    item.reason || '',
  ].join('|');

  let entries = esarfEntriesCache.get(key);
  if (!entries) {
    entries = parseEsarfEntries(item);
    if (esarfEntriesCache.size > 250) {
      esarfEntriesCache.clear();
    }
    esarfEntriesCache.set(key, entries);
  }
  return entries;
}

function isPartialApproval(item: MyRequest): boolean {
  if (!item || item.request_type_code === 'leave' || isPerkRequest(item)) return false;
  const entries = getCachedEsarfEntries(item);
  if (entries.length <= 1) return false;
  const hasRejected = entries.some((e) => e.isRejected);
  const hasApproved = entries.some((e) => !e.isRejected);
  return hasRejected && hasApproved;
}

function normalizeStatus(status: string, item?: MyRequest): StatusFilter {
  if (item && isAutoApprovedBirthdayGrant(item)) {
    return 'approved';
  }
  const value = (status || '').toLowerCase().trim();
  // Scheduled OT awaiting proof or in pre_approved status:
  // Must map to 'pending' so it appears in 'All' and 'Pending' tabs, NOT 'approved'!
  if (item && isScheduledOtAwaitingProof(item)) {
    return 'pending';
  }
  if (value.includes('pre_approved') || value.includes('pre-approved') || (item && isScheduledOtRequest(item))) {
    return 'pending';
  }
  if (value.includes('validat')) return 'validated';
  if (value.includes('approved')) return 'approved';
  if (item?.final_approved_at && !value.includes('reject') && !value.includes('denied')) return 'approved';
  if (item?.approval_summary && item.approval_summary.length > 0) {
    const summary = item.approval_summary;
    if (
      summary.length > 0 &&
      summary.every(
        (s) =>
          (s.status || '').toLowerCase().includes('approved') ||
          (s.status || '').toLowerCase().includes('skipped'),
      )
    ) {
      return 'approved';
    }
  }
  if (value.includes('reject') || value.includes('denied')) return 'rejected';
  return 'pending';
}

function statusLabel(item: MyRequest): string {
  const rawStatus = (item.status || '').trim();
  const lower = rawStatus.toLowerCase();

  // If final approved or rejected, display those first
  if (lower === 'approved' || (item?.final_approved_at && !lower.includes('reject') && !lower.includes('denied'))) {
    return 'APPROVED';
  }
  if (lower === 'rejected' || lower.includes('reject') || lower.includes('denied')) {
    return 'REJECTED';
  }

  if (
    isScheduledOtAwaitingProof(item) ||
    lower.includes('pre_approved') ||
    lower.includes('pre-approved') ||
    isScheduledOtRequest(item)
  ) {
    return 'PRE-APPROVED';
  }
  if (isPartialApproval(item)) {
    const entries = getCachedEsarfEntries(item);
    const approvedCount = entries.filter((e) => !e.isRejected).length;
    return `${approvedCount}/${entries.length} APPROVED`;
  }

  // If validated in database, display as is ("VALIDATED")
  if (lower.includes('validat')) {
    return 'VALIDATED';
  }

  const statusKey = normalizeStatus(item.status, item);
  if (statusKey === 'validated') return 'VALIDATED';
  if (statusKey === 'approved') return 'APPROVED';
  if (statusKey === 'rejected') return 'REJECTED';
  if (rawStatus && lower !== 'pending' && lower !== 'submitted' && lower !== 'waiting') {
    return rawStatus.toUpperCase();
  }
  return 'PENDING';
}

function renderStatusPillContent(item: MyRequest) {
  if (isPartialApproval(item)) {
    const entries = getCachedEsarfEntries(item);
    const approvedCount = entries.filter((e) => !e.isRejected).length;
    return (
      <Text>
        <Text style={{ color: '#dc2626', fontWeight: '900' }}>{approvedCount}/{entries.length}</Text>
        <Text style={{ color: '#15803d' }}> APPROVED</Text>
      </Text>
    );
  }
  return statusLabel(item);
}

function statusPillStyle(status: StatusFilter | 'partial', item?: MyRequest) {
  const rawStatus = (item?.status || '').toLowerCase();
  const isFinalDone = rawStatus === 'approved' || rawStatus.includes('reject') || Boolean(item?.final_approved_at);

  if (
    item &&
    !isFinalDone &&
    (isScheduledOtAwaitingProof(item) ||
      rawStatus.includes('pre_approved') ||
      rawStatus.includes('pre-approved') ||
      isScheduledOtRequest(item))
  ) {
    return { backgroundColor: '#eff6ff', borderColor: '#93c5fd', borderWidth: 1, color: '#1d4ed8' };
  }
  if (item && isPartialApproval(item)) {
    return { backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1, color: '#15803d' };
  }
  if (status === 'validated' || rawStatus.includes('validat')) {
    return { backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1, color: '#15803d' };
  }
  if (status === 'approved') return { backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1, color: '#15803d' };
  if (status === 'rejected') return { backgroundColor: colors.background, color: colors.semantic.danger };
  return { backgroundColor: '#fef3c7', borderColor: '#fde68a', borderWidth: 1, color: '#92400e' };
}

function formatRequestCode(item: MyRequest, sequence?: number) {
  return formatUnifiedRequestCode(item, sequence ?? 1);
}

function formatRequestDocumentCode(item: MyRequest, sequence: number) {
  return formatUnifiedRequestCode(item, sequence);
}

function requestSheetTitle(item: MyRequest) {
  return formatUnifiedRequestType(item);
}

function shortRequestId(requestId: string) {
  const numericId = requestId.match(/\d+/g)?.join('').slice(-3);
  if (numericId) return numericId.padStart(3, '0');
  return requestId.slice(-3).toUpperCase();
}

function formatRequestType(item: MyRequest) {
  if (isAutoApprovedBirthdayGrant(item)) return 'Birthday Leave Grant';
  return formatUnifiedRequestType(item);
}

export function isTravelOrderRequest(item: MyRequest | null | undefined): boolean {
  if (!item) return false;
  const code = (item.request_type_code || '').toLowerCase().trim();
  if (
    code === 'travel_order' ||
    code === 'travel' ||
    code === 'official_travel' ||
    code === 'official_travel_order' ||
    code === 'to'
  ) {
    return true;
  }
  const name = (item.request_type_name || '').toLowerCase();
  if (name.includes('travel order') || name.includes('official travel')) {
    return true;
  }
  const trans = (item.transaction_type || '').toLowerCase();
  if (trans.includes('travel order') || trans.includes('official travel')) {
    return true;
  }
  return false;
}

function requestCategory(item: MyRequest): CategoryFilter {
  if (isTravelOrderRequest(item)) return 'travel_order';
  if (isPerkRequest(item)) return 'perks';
  return item.request_type_code === 'leave' ? 'leave' : 'esarf';
}

function isPerkRequest(item: MyRequest) {
  return item.request_type_code === 'discount' || item.request_type_code === 'charge';
}

function isEsarfRequest(item: MyRequest): boolean {
  return !isPerkRequest(item) && item.request_type_code !== 'leave' && !isTravelOrderRequest(item);
}

function hasApprovedTimelineStatus(item: MyRequest): boolean {
  if (!item) return false;
  if (isPartialApproval(item)) return true;
  if (!item.approval_summary || item.approval_summary.length === 0) return false;
  return item.approval_summary.some((step) =>
    (step.status || '').toLowerCase().includes('approved')
  );
}

function canEditRequest(item: MyRequest): boolean {
  if (isScheduledOtAwaitingProof(item)) {
    return true;
  }
  const statusKey = normalizeStatus(item.status, item);
  if (statusKey !== 'pending') return false;
  if (isPerkRequest(item)) return false;
  // If ESARF has at least one approved status in the timeline, it cannot be edited
  if (isEsarfRequest(item) && hasApprovedTimelineStatus(item)) {
    return false;
  }
  return true;
}

function isOfflineUnsyncedRequest(item?: MyRequest | null): boolean {
  if (!item) return false;
  const id = item.request_id || '';
  if (id.startsWith('offline_') || id.includes('local') || !isUUID(id)) {
    return true;
  }
  const statusLower = (item.status || '').toLowerCase();
  if (statusLower.includes('offline') || statusLower.includes('pending sync')) {
    return true;
  }
  return false;
}

function canDeleteRequest(_item: MyRequest, _isOnline = true): boolean {
  // Temporarily removed delete capability on requests
  return false;
}

function formatEmployeeDisplayName(profile: EmployeeProfileSummary | null) {
  if (!profile) return 'Your Name';

  const middleInitial = profile.middleName?.trim()?.[0];
  const parts = [
    profile.firstName,
    middleInitial ? `${middleInitial}.` : null,
    profile.lastName,
    profile.suffix,
  ].filter(Boolean);

  return parts.length ? parts.join(' ') : profile.fullName || 'Your Name';
}

function formatProfileWorkUnit(profile: EmployeeProfileSummary | null) {
  if (normalizeDepartmentName(profile?.departmentName).includes('operation')) {
    const department = profile?.departmentName?.trim().replace(/\s+/g, ' ') || 'Operations';
    const store = profile?.storeName?.trim().replace(/\s+/g, ' ');
    return [department, store].filter(Boolean).join(' | ').toUpperCase();
  }

  return profile?.departmentName || profile?.storeName || 'Department';
}

function normalizeDepartmentName(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
}

function getRequestDate(item: MyRequest) {
  let rawDate: string | null;
  if (isTravelOrderRequest(item)) {
    rawDate = item.date_from || item.start_date || item.submitted_at;
  } else if (isEsarfRequest(item)) {
    rawDate = item.submitted_at || item.date_from;
  } else if (item.request_type_code === 'leave') {
    rawDate = item.start_date || item.date_from || item.submitted_at;
  } else {
    rawDate = item.date_from || item.submitted_at;
  }

  if (isAutoApprovedBirthdayGrant(item) && rawDate && rawDate.length >= 10) {
    const currentYearStr = new Date().getFullYear().toString();
    if (!rawDate.startsWith(currentYearStr)) {
      return `${currentYearStr}-${rawDate.slice(5, 10)}`;
    }
  }

  return rawDate;
}

function parseFilterDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const normalizedIso = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(normalized)
    ? normalized.replace(' ', 'T')
    : normalized;
  const date = slashMatch
    ? new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2]))
    : new Date(normalizedIso);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function formatDatePickerValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function formatSheetDate(value: string | null) {
  const time = parseFilterDate(value);
  if (time === null) return 'N/A';
  const date = new Date(time);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
  return `${month}. ${date.getDate()}, ${date.getFullYear()}`;
}

function formatCompactDate(value: string | null) {
  const time = parseFilterDate(value);
  if (time === null) return 'No date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

function compactRange(start: string | null, end: string | null) {
  const startText = formatCompactDate(start);
  const endText = formatCompactDate(end);
  if (startText === 'No date' && endText === 'No date') return 'No date';
  if (startText === endText || endText === 'No date') return startText;
  if (startText === 'No date') return endText;
  return `${startText} - ${endText}`;
}

function formatCompactTime(value: string | null) {
  if (!value) return '--:--';
  const trimmed = value.trim();
  if (trimmed.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const normalized = trimmed.replace(' ', 'T');
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
    }
  }
  return stripSecondsFromTimeString(trimmed);
}

function formatSheetTime(value: string | null) {
  if (!value) return 'N/A';
  const trimmed = value.trim();
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
    }
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatHours(hours: number | null) {
  return `${Number(hours ?? 0).toFixed(2)}h`;
}

function formatMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isUseOffsetRequest(item: MyRequest) {
  if (item.request_type_code === 'use_offset') return true;
  const transLower = (item.transaction_type || '').toLowerCase();
  if (transLower.includes('use offset') || transLower.includes('use_offset')) return true;
  const reasonLower = (item.reason || '').toLowerCase();
  if (reasonLower.includes('(use offset)') || reasonLower.includes('(use_offset)')) return true;
  return false;
}

function approvalTimeline(item: MyRequest) {
  if (isAutoApprovedBirthdayGrant(item)) {
    return [
      {
        label: 'HYG Portal System',
        status: 'Auto-Approved',
        actedAt: item.final_approved_at || item.submitted_at,
      },
    ];
  }

  const fallback = [1, 2];
  const summary = (item.approval_summary && item.approval_summary.length > 0)
    ? item.approval_summary
    : [];
  const rows: { label: string; status: string; actedAt: string | null }[] = summary.length
    ? summary.map((step) => {
      const isAutoApproved =
        step.approver_name === 'HYG Portal System' ||
        step.remarks?.toLowerCase().includes('auto-approved') ||
        item.reason?.toLowerCase().includes('auto-approved');
      const levelNum = resolveApproverLevel(step);
      const statusText = isAutoApproved
        ? 'Auto-Approved'
        : `L${levelNum} • ${approvalStepStatus(step.status)}`;
      return {
        label: approvalRoleLabel(step),
        status: statusText,
        actedAt: step.acted_at,
      };
    })
    : fallback.map((level) => ({
      label: fallbackApprovalRoleLabel(level),
      status: `L${level} • ${level === 1 ? 'Pending to approve' : 'Not yet processed'}`,
      actedAt: null,
    }));

  while (rows.length < fallback.length) {
    const level = fallback[rows.length];
    rows.push({ label: fallbackApprovalRoleLabel(level), status: `L${level} • Not yet processed`, actedAt: null });
  }

  return rows;
}

function approvalRoleLabel(step: MyRequest['approval_summary'][number]) {
  const approverName = normalizeDisplayValue(step.approver_name);
  if (approverName) return formatPersonNameWithMiddleInitial(approverName);

  const positionName = normalizeDisplayValue(step.approver_position_name);
  if (positionName) return positionName;

  const skippedReason = normalizeDisplayValue(step.skipped_reason);
  if (skippedReason) return skippedReason;

  const levelNum = resolveApproverLevel(step);
  return `Level ${levelNum} Approver`;
}

function fallbackApprovalRoleLabel(level: number) {
  return `Level ${level} Approver`;
}

function normalizeDisplayValue(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function formatPersonNameWithMiddleInitial(value: string) {
  if (value.toLowerCase().includes('system') || value.toLowerCase().includes('admin')) {
    return value;
  }
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return value;

  const [first, middle, ...rest] = parts;
  const maybeInitial = middle.replace('.', '');
  const middleText = maybeInitial.length === 1 ? `${maybeInitial}.` : `${maybeInitial[0]}.`;
  return [first, middleText, ...rest].join(' ');
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

function getRejectedReason(item: MyRequest) {
  if (normalizeStatus(item.status) !== 'rejected') {
    return null;
  }

  const reason = normalizeDisplayValue(item.rejected_reason);
  if (reason) {
    return reason;
  }

  const rejectedStep = (item.approval_summary ?? []).find((step) => normalizeStatus(step.status) === 'rejected');
  return normalizeDisplayValue(rejectedStep?.remarks) ?? 'No rejection reason provided.';
}

function timelineTone(status: string) {
  if (status.includes('Approved')) return 'success' as const;
  if (status.includes('Rejected')) return 'danger' as const;
  if (status.includes('Pending to approve')) return 'warning' as const;
  return 'muted' as const;
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
    fontSize: Platform.OS === 'web' ? 16 : 15,
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
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateField: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
  },
  datePlaceholder: {
    color: colors.muted,
  },
  dateDash: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
    color: colors.border,
  },
  categoryScroll: {
    marginTop: spacing.sm,
  },
  categoryRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  categoryChip: {
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    flexShrink: 0,
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
  emptyContainer: {
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 290,
    lineHeight: 18,
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  emptyActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.32)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  iosPickerPanel: {
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  iosPickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  iosPickerCancel: {
    minHeight: 38,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  iosPickerDone: {
    minHeight: 38,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  iosPickerCancelText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  iosPickerDoneText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.surface,
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.brand.ink,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 18,
  },
  sheetScroll: {
    paddingBottom: spacing.sm,
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
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  esarfDivider: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  esarfDividerText: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    textTransform: 'uppercase',
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
    borderRadius: 20,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
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
  detailsList: {
    marginHorizontal: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  detailRow: {
    minHeight: 44,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
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
    minHeight: 54,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
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
  totalHoursBox: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  totalHoursValue: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  slipItemsBox: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  slipItemsLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  slipItemsText: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  slipTotals: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  amountLine: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  amountLineLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  amountLineValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    textAlign: 'right',
  },
  amountLineStrong: {
    color: colors.text,
    fontSize: 15,
  },
  amountLineValueStrong: {
    color: colors.brand.goldStrong,
    fontSize: 18,
    lineHeight: 23,
  },
  slipTotalDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  reasonBlock: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.sm,
  },
  reasonText: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    color: colors.text,
  },
  rejectedReasonBox: {
    marginTop: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    padding: spacing.sm,
  },
  rejectedReasonLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    color: colors.semantic.danger,
    textTransform: 'uppercase',
  },
  rejectedReasonText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    color: '#991b1b',
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
    marginHorizontal: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  sheetCloseButton: {
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.surface,
  },
  tabsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    shadowColor: colors.muted,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 2,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.text,
  },
  tabCountBadge: {
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  tabCountText: {
    fontSize: 10,
    fontWeight: fontWeights.heavy,
    color: colors.primary,
  },
  tabIndicator: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 0,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.primary,
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
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
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
    width: 130,
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 3,
  },
  statusPill: {
    maxWidth: 130,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    textTransform: 'uppercase',
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
    gap: 6,
  },
  typePill: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: radius.md,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  typePillText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#1d4ed8',
  },
  viewButton: {
    height: 28,
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
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  editButton: {
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  editText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#92400e',
  },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetEditButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sheetEditText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#92400e',
  },
  sheetDeleteButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sheetDeleteText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.semantic.danger,
  },
  cardOtBadge: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  cardOtBadgeReady: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  cardOtBadgeLocked: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  cardOtBadgeTextReady: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: '#b45309',
  },
  cardOtBadgeTextLocked: {
    fontSize: 12,
    fontWeight: fontWeights.medium,
    color: '#1d4ed8',
  },
  scheduledOtProofCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  scheduledOtProofCardDisabled: {
    opacity: 0.65,
  },
  scheduledOtProofHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  scheduledOtProofHeaderTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  scheduledOtProofSectionTitle: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  scheduledOtTextDisabled: {
    color: '#334155',
  },
  scheduledOtProofTitleCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduledOtProofSectionCount: {
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    color: '#64748b',
  },
  scheduledOtProofSectionSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
    lineHeight: 15,
  },
  scheduledOtReqBadge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  scheduledOtReqBadgeOptional: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  scheduledOtReqBadgeText: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
  },
  scheduledOtReqBadgeTextOptional: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: fontWeights.bold,
  },
  scheduledOtReqBadgeRequired: {
    backgroundColor: '#fee2e2',
  },
  scheduledOtReqBadgeTextRequired: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: fontWeights.bold,
  },
  scheduledOtReqBadgeSuccess: {
    backgroundColor: '#dcfce7',
  },
  scheduledOtReqBadgeTextSuccess: {
    color: '#15803d',
    fontSize: 11,
    fontWeight: fontWeights.bold,
  },
  scheduledOtLockedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  scheduledOtLockedButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.semibold,
  },
  scheduledOtPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  scheduledOtPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.semibold,
  },
  scheduledOtThumbnailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  scheduledOtThumbWrap: {
    position: 'relative',
    width: 64,
    height: 64,
  },
  scheduledOtThumbImg: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  scheduledOtThumbRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  scheduledOtActionRow: {
    flexDirection: 'column',
    gap: 8,
    marginTop: 2,
  },
  scheduledOtSubmitBtn: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  scheduledOtSubmitBtnText: {
    fontSize: 13.5,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
});
