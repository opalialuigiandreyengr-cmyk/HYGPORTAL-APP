import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarDays, Clock3, Eye, FileText, Funnel, RefreshCcw, Search, Users, X } from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { loadMyRequests, loadMyRequestsCached, type MyRequest } from '../services/requests';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type CategoryFilter = 'all' | 'esarf' | 'leave' | 'perks';

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const categoryTabs: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'esarf', label: 'ESARF' },
  { key: 'leave', label: 'Leave' },
  { key: 'perks', label: 'Perks' },
];
const pageSize = 10;

type Props = {
  profileResult?: ProfileLoadResult | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenSettings?: () => void;
  onOpenMyTeam?: () => void;
};

export function RequestsTabScreen({ profileResult, notificationCount = 0, onAssistant, onNotifications, onOpenSettings, onOpenMyTeam }: Props) {
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
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading...');
    try {
      const requests = await loadMyRequests();
      setItems(requests);
      setStatus(requests.length ? '' : 'No requests yet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load requests.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const cached = await loadMyRequestsCached();
      if (active && cached.length) {
        setItems(cached);
        setStatus('');
      }
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const categoryItems = activeCategory === 'all'
      ? items
      : items.filter((item) => requestCategory(item) === activeCategory);

    return categoryItems.reduce(
      (totals, item) => {
        totals.all += 1;
        const statusKey = normalizeStatus(item.status);
        if (statusKey === 'approved') totals.approved += 1;
        else if (statusKey === 'rejected') totals.rejected += 1;
        else totals.pending += 1;
        return totals;
      },
      { all: 0, pending: 0, approved: 0, rejected: 0 },
    );
  }, [activeCategory, items]);

  const categoryCounts = useMemo(() => {
    return items.reduce(
      (totals, item) => {
        totals.all += 1;
        totals[requestCategory(item)] += 1;
        return totals;
      },
      { all: 0, esarf: 0, leave: 0, perks: 0 },
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const fromTime = parseFilterDate(dateFrom);
    const toTime = parseFilterDate(dateTo, true);

    return items.filter((item) => {
      const statusKey = normalizeStatus(item.status);
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
        item.reason,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
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
      <TopBar name={profile?.fullName} username={profile?.username} photoUrl={profile?.photoUrl} notificationCount={notificationCount} onMessages={onAssistant} onNotifications={onNotifications} onOpenSettings={onOpenSettings} onOpenMyTeam={onOpenMyTeam} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
            <Pressable disabled={isLoading} style={styles.filterButton} onPress={refresh}>
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

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {paginatedItems.map((item, index) => {
          const sequence = (currentPage - 1) * pageSize + index + 1;
          return (
          <RequestCard
            key={item.request_id}
            item={item}
            profile={profile}
            sequence={sequence}
            onView={() => setSelectedRequest({ item, sequence })}
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

      {activeDatePicker && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setActiveDatePicker(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.iosPickerPanel}>
              <DateTimePicker
                value={tempPickerDate}
                mode="date"
                display="spinner"
                onChange={handleDatePickerChange}
              />
              <View style={styles.iosPickerActions}>
                <Pressable style={styles.iosPickerCancel} onPress={() => setActiveDatePicker(null)}>
                  <Text style={styles.iosPickerCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.iosPickerDone} onPress={confirmIosDatePicker}>
                  <Text style={styles.iosPickerDoneText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : activeDatePicker ? (
        <DateTimePicker
          value={dateValueForPicker(activeDatePicker)}
          mode="date"
          display="default"
          onChange={handleDatePickerChange}
        />
      ) : null}

      <RequestDetailsSheet
        request={selectedRequest}
        profile={profile}
        onClose={() => setSelectedRequest(null)}
      />
    </View>
  );
}

function RequestCard({
  item,
  profile,
  sequence,
  onView,
}: {
  item: MyRequest;
  profile: EmployeeProfileSummary | null;
  sequence: number;
  onView: () => void;
}) {
  const statusKey = normalizeStatus(item.status);
  const requestDate = getRequestDate(item);
  const displayName = formatEmployeeDisplayName(profile);
  const department = formatProfileWorkUnit(profile);

  return (
    <View style={styles.cardOuter}>
      <View style={styles.cardAccent} />
      <View style={styles.card}>
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
              <Text style={[styles.statusPill, statusPillStyle(statusKey)]} numberOfLines={1}>
                {statusLabel(item)}
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
              <Text style={styles.typePillText}>{formatRequestType(item)}</Text>
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

function RequestDetailsSheet({
  request,
  profile,
  onClose,
}: {
  request: { item: MyRequest; sequence: number } | null;
  profile: EmployeeProfileSummary | null;
  onClose: () => void;
}) {
  if (!request) return null;

  const { item, sequence } = request;
  const displayName = formatEmployeeDisplayName(profile);
  const department = formatProfileWorkUnit(profile);
  const isLeave = item.request_type_code === 'leave';
  const isPerk = isPerkRequest(item);
  const rejectedReason = getRejectedReason(item);
  const currentStatusDate = item.final_approved_at || item.rejected_at || item.submitted_at;
  const timelineRows = isPerk ? [
    {
      title: normalizeStatus(item.status) === 'approved' ? 'Approval Code Success' : 'Waiting for Approval Code',
      subtitle: normalizeStatus(item.status) === 'approved' ? 'Email approval code verified' : 'Approval code not yet verified',
      date: formatSheetDate(currentStatusDate),
      time: formatSheetTime(currentStatusDate),
      tone: normalizeStatus(item.status) === 'approved' ? ('success' as const) : ('warning' as const),
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
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetDismissArea} onPress={onClose} />
        <View style={styles.detailsSheet}>
          <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.requestSummaryHeader}>
              <View style={styles.requestSummaryText}>
                <Text style={styles.sheetTitle}>{requestSheetTitle(item)}</Text>
                <View style={styles.sheetCodeRow}>
                  <Text style={styles.sheetCode}>{formatRequestDocumentCode(item, sequence)}</Text>
                  <Text style={[styles.sheetStatusPill, statusPillStyle(normalizeStatus(item.status))]}>
                    {statusLabel(item)}
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

            <SectionTitle icon="file" title="Request Information" />
            <View style={styles.detailsList}>
              <DetailRow icon="file" label="Transaction Type" value={formatRequestType(item)} />
              {isPerk ? (
                <>
                  <DetailRow icon="file" label="Approval Code" value={item.perk_approval_code || 'N/A'} />
                  <DetailRow icon="calendar" label="Transaction Date" value={formatSheetDate(item.date_from)} />
                  <DetailRow icon="file" label="Benefit" value={item.perk_benefit || 'N/A'} />
                </>
              ) : !isLeave ? (
                <>
                  <DetailRow icon="clock" label="Time Schedule" value={item.time_schedule || 'N/A'} />
                  <DetailRow icon="calendar" label="Day Off" value={item.day_off || 'N/A'} />
                  <DetailRow icon="users" label="Payroll Class" value={item.payroll_class || 'N/A'} />
                </>
              ) : (
                <>
                  <DetailRow icon="file" label="Leave Type" value={item.leave_type || 'N/A'} />
                  <DetailRow icon="calendar" label="Leave Category" value={item.leave_category || 'N/A'} />
                </>
              )}
            </View>

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
            ) : (
            <View style={styles.rangePanel}>
              <View style={styles.panelTitleRow}>
                <CalendarDays size={15} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.panelTitle}>Date & Time Range</Text>
              </View>
              <View style={styles.rangeGrid}>
                <DetailItem label="Date From" value={formatSheetDate(isLeave ? item.start_date : item.date_from)} />
                <DetailItem label="Date To" value={formatSheetDate(isLeave ? item.end_date : item.date_to)} />
                {isPerk ? (
                  <DetailItem label="Status Date" value={formatSheetDate(currentStatusDate)} />
                ) : !isLeave ? (
                <>
                  <DetailItem label="Time From" value={formatSheetTime(item.time_from)} />
                  <DetailItem label="Time To" value={formatSheetTime(item.time_to)} />
                </>
                ) : (
                <DetailItem label="Total Days" value={`${item.total_days ?? 0}d`} />
              )}
              </View>
              {!isLeave && !isPerk ? (
                <View style={styles.totalHoursBox}>
                  <View>
                    <Text style={styles.detailLabel}>Total Hours</Text>
                    <Text style={styles.totalHoursValue}>{formatHours(item.total_hours)}</Text>
                  </View>
                </View>
              ) : null}
            </View>
            )}

          {!isPerk ? (
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
          ) : null}

          <View style={styles.timelineHeader}>
            <Users size={15} color={colors.muted} strokeWidth={2.2} />
            <Text style={styles.panelTitle}>{isPerk ? 'Approval Verification' : 'Approval Timeline'}</Text>
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
            <Pressable style={styles.sheetCloseButton} onPress={onClose}>
              <Text style={styles.sheetCloseText}>Close</Text>
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


function normalizeStatus(status: string): StatusFilter {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'approved';
  if (value.includes('reject') || value.includes('denied')) return 'rejected';
  return 'pending';
}

function statusLabel(item: MyRequest) {
  const statusKey = normalizeStatus(item.status);
  if (isPerkRequest(item) && statusKey === 'approved') return 'APPROVED';
  if (statusKey === 'approved') return 'APPROVED';
  if (statusKey === 'rejected') return 'REJECTED';
  return 'PENDING';
}

function statusPillStyle(status: StatusFilter) {
  if (status === 'approved') return { backgroundColor: '#dcfce7', borderColor: '#86efac', borderWidth: 1, color: '#15803d' };
  if (status === 'rejected') return { backgroundColor: colors.background, color: colors.semantic.danger };
  return { backgroundColor: '#fef3c7', borderColor: '#fde68a', borderWidth: 1, color: '#92400e' };
}

function formatRequestCode(item: MyRequest, sequence?: number) {
  const type = item.request_type_code === 'leave'
    ? 'LEAVE'
    : item.request_type_code === 'use_offset'
      ? 'OFFSET'
      : isPerkRequest(item)
        ? 'PERK'
        : 'ESARF';
  return `${type}-${shortRequestId(item.request_id)}-${sequence ?? 1}`;
}

function formatRequestDocumentCode(item: MyRequest, sequence: number) {
  const type = item.request_type_code === 'leave'
    ? 'LEAVE'
    : item.request_type_code === 'use_offset'
      ? 'OFFSET'
      : isPerkRequest(item)
        ? 'PERK'
        : 'ESARF';
  const year = item.submitted_at ? new Date(item.submitted_at).getFullYear() : new Date().getFullYear();
  return `${type}-${year}-${String(sequence).padStart(3, '0')}`;
}

function requestSheetTitle(item: MyRequest) {
  if (isPerkRequest(item)) return 'Perk Request';
  if (item.request_type_code === 'leave') return 'Leave Request';
  return 'ESARF Request';
}

function shortRequestId(requestId: string) {
  const numericId = requestId.match(/\d+/g)?.join('').slice(-3);
  if (numericId) return numericId.padStart(3, '0');
  return requestId.slice(-3).toUpperCase();
}

function formatRequestType(item: MyRequest) {
  if (item.transaction_type) return item.transaction_type;
  if (item.request_type_code === 'discount') return 'Employee Discount (Cash)';
  if (item.request_type_code === 'charge') return 'Employee Charge (Credit)';
  if (item.request_type_code === 'overtime') return 'Overtime (OT)';
  if (item.request_type_code === 'offset_earn') return 'Offset';
  if (item.request_type_code === 'use_offset') return 'Use Offset';
  if (item.request_type_code === 'leave') return item.leave_type ? `${item.leave_type} Leave` : 'Leave';
  return item.request_type_name;
}

function requestCategory(item: MyRequest): CategoryFilter {
  if (isPerkRequest(item)) return 'perks';
  return item.request_type_code === 'leave' ? 'leave' : 'esarf';
}

function isPerkRequest(item: MyRequest) {
  return item.request_type_code === 'discount' || item.request_type_code === 'charge';
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
  return item.request_type_code === 'leave' ? item.start_date || item.submitted_at : item.date_from || item.submitted_at;
}

function parseFilterDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = slashMatch
    ? new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2]))
    : new Date(normalized);
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
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
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

function formatMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function approvalTimeline(item: MyRequest) {
  const isLeave = item.request_type_code === 'leave';
  const fallback = isLeave ? [1] : [1, 2];
  const summary = (item.approval_summary ?? [])
    .filter((step) => !isLeave || step.step_order === 1 || step.required_level === 1)
    .slice(0, fallback.length);
  const rows: { label: string; status: string; actedAt: string | null }[] = summary.length
    ? summary.map((step) => ({
        label: approvalRoleLabel(step),
        status: `L${step.required_level} • ${approvalStepStatus(step.status)}`,
        actedAt: step.acted_at,
      }))
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

  return `Level ${step.required_level} Approver`;
}

function fallbackApprovalRoleLabel(level: number) {
  return `Level ${level} Approver`;
}

function normalizeDisplayValue(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function formatPersonNameWithMiddleInitial(value: string) {
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
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
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
    paddingHorizontal: spacing.lg,
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
    marginHorizontal: spacing.lg,
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
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.text,
  },
  tabCountBadge: {
    minWidth: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: {
    fontSize: 11,
    fontWeight: fontWeights.heavy,
    color: colors.primary,
  },
  tabIndicator: {
    position: 'absolute',
    left: 8,
    right: 8,
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
});
