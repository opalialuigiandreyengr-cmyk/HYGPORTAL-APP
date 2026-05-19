import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CalendarDays, Clock3, Eye, Funnel, RefreshCcw, Search } from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { loadMyRequests, type MyRequest } from '../services/requests';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const statusTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

type Props = {
  profileResult?: ProfileLoadResult | null;
};

export function RequestsTabScreen({ profileResult }: Props) {
  const [items, setItems] = useState<MyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
    refresh();
  }, []);

  const counts = useMemo(() => {
    return items.reduce(
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
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const fromTime = parseFilterDate(dateFrom);
    const toTime = parseFilterDate(dateTo, true);

    return items.filter((item) => {
      const statusKey = normalizeStatus(item.status);
      if (activeStatus !== 'all' && statusKey !== activeStatus) return false;

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
  }, [activeStatus, dateFrom, dateTo, items, query]);

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
            <View style={styles.dateField}>
              <TextInput
                value={dateFrom}
                onChangeText={setDateFrom}
                placeholder="mm/dd/yyyy"
                placeholderTextColor={colors.text}
                style={styles.dateInput}
                keyboardType="numbers-and-punctuation"
              />
              <CalendarDays size={15} color={colors.text} strokeWidth={2.3} />
            </View>
            <Text style={styles.dateDash}>-</Text>
            <View style={styles.dateField}>
              <TextInput
                value={dateTo}
                onChangeText={setDateTo}
                placeholder="mm/dd/yyyy"
                placeholderTextColor={colors.text}
                style={styles.dateInput}
                keyboardType="numbers-and-punctuation"
              />
              <CalendarDays size={15} color={colors.text} strokeWidth={2.3} />
            </View>
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

        {filteredItems.map((item, index) => (
          <RequestCard key={item.request_id} item={item} profile={profile} sequence={index + 1} />
        ))}
      </ScrollView>
    </View>
  );
}

function RequestCard({
  item,
  profile,
  sequence,
}: {
  item: MyRequest;
  profile: EmployeeProfileSummary | null;
  sequence: number;
}) {
  const statusKey = normalizeStatus(item.status);
  const requestDate = getRequestDate(item);
  const displayName = formatEmployeeDisplayName(profile);
  const department = profile?.departmentName || profile?.storeName || 'Department';

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
                {statusLabel(item.status)}
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
            <Pressable style={styles.viewButton}>
              <Eye size={15} color={colors.text} strokeWidth={2.3} />
              <Text style={styles.viewText}>View</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function normalizeStatus(status: string): StatusFilter {
  const value = status.toLowerCase();
  if (value.includes('approved')) return 'approved';
  if (value.includes('reject') || value.includes('denied')) return 'rejected';
  return 'pending';
}

function statusLabel(status: string) {
  const statusKey = normalizeStatus(status);
  if (statusKey === 'approved') return 'DEPT MGR APPROVED';
  if (statusKey === 'rejected') return 'REJECTED';
  return 'PENDING';
}

function statusPillStyle(status: StatusFilter) {
  if (status === 'approved') return { backgroundColor: colors.background, color: colors.primary };
  if (status === 'rejected') return { backgroundColor: colors.background, color: colors.semantic.danger };
  return { backgroundColor: colors.semantic.warning, color: colors.text };
}

function formatRequestCode(item: MyRequest, sequence?: number) {
  const type = item.request_type_code === 'leave' ? 'LEAVE' : item.request_type_code === 'use_offset' ? 'OFFSET' : 'ESARF';
  return `${type} - ${shortRequestId(item.request_id)} - ${sequence ?? 1}`;
}

function shortRequestId(requestId: string) {
  const numericId = requestId.match(/\d+/g)?.join('').slice(-3);
  if (numericId) return numericId.padStart(3, '0');
  return requestId.slice(-3).toUpperCase();
}

function formatRequestType(item: MyRequest) {
  if (item.request_type_code === 'overtime') return 'Overtime (OT)';
  if (item.request_type_code === 'offset_earn') return 'Offset';
  if (item.request_type_code === 'use_offset') return 'Use Offset';
  if (item.request_type_code === 'leave') return item.leave_type ? `${item.leave_type} Leave` : 'Leave';
  return item.request_type_name;
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

function formatCompactDate(value: string | null) {
  const time = parseFilterDate(value);
  if (time === null) return 'No date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time));
}

function formatCompactTime(value: string | null) {
  if (!value) return '--:--';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
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
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
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
    fontSize: 14,
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
    fontSize: 13,
    color: colors.text,
    paddingVertical: 0,
  },
  dateDash: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: colors.border,
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
    fontSize: 13,
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
    fontSize: 10,
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
    fontSize: 12,
    color: colors.muted,
    marginHorizontal: spacing.sm,
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
    backgroundColor: colors.primary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
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
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  cardName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    textTransform: 'uppercase',
  },
  cardDept: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.semibold,
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
    fontSize: 11,
    lineHeight: 14,
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
    fontSize: 12,
    lineHeight: 15,
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
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  typePillText: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.semantic.success,
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
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
});
