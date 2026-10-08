import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  BackHandler,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';

import { colors, fontWeights, radius, spacing } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchLeaveHistory, fetchOffsetHistory, type BalanceHistoryItem } from '../services/balanceHistory';
import { scheduleOffsetExpiryAlerts } from '../services/notificationCenter';
import { TopBar } from './TopBar';

type BalanceHistoryPageProps = {
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onHelpTutorials?: () => void;
  initialTab?: 'offset' | 'leave';
  offsetBalance: number;
  leaveRemaining: number;
  annualCreditDays?: number;
  onClose: () => void;
  onRefreshDashboard?: () => void;
};

type TransactionFilter = 'all' | 'earned' | 'deducted';
type FormattedHistoryEntry = {
  transaction?: string;
  details?: string;
  note: string;
};

function formatTransactionDate(dateStr?: string | null) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    return dateStr;
  }
}

function formatOffsetExpiryDate(dateStr?: string | null) {
  if (!dateStr) return 'Expiration unavailable';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Expiration unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function getOffsetExpiryColor(remainingDays?: number | null) {
  if (!remainingDays || remainingDays <= 7) return '#dc2626';
  if (remainingDays <= 30) return '#d97706';
  return '#15803d';
}

export function BalanceHistoryPage({
  name,
  username,
  photoUrl,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onHelpTutorials,
  initialTab = 'offset',
  offsetBalance,
  leaveRemaining,
  annualCreditDays = 0,
  onClose,
  onRefreshDashboard,
}: BalanceHistoryPageProps) {
  const [activeTab, setActiveTab] = useState<'offset' | 'leave'>(initialTab);
  const [offsetHistory, setOffsetHistory] = useState<BalanceHistoryItem[]>([]);
  const [leaveHistory, setLeaveHistory] = useState<BalanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [expandedTransactionIds, setExpandedTransactionIds] = useState<Set<string>>(new Set());

  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      if (activeTab === 'offset') {
        const data = await fetchOffsetHistory();
        setOffsetHistory(data);
        await Promise.all(
          data
            .filter((item) => item.amount > 0 && (item.remainingAmount ?? item.amount) > 0 && item.expiresAt)
            .map((item) => scheduleOffsetExpiryAlerts({
              creditId: item.id,
              expiresAt: item.expiresAt as string,
              remainingHours: item.remainingAmount ?? item.amount,
            })),
        );
      } else {
        const data = await fetchLeaveHistory();
        setLeaveHistory(data);
      }
    } catch {
      // Keep existing data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const handleRefresh = async () => {
    onRefreshDashboard?.();
    await loadData(true);
  };

  const currentItems = activeTab === 'offset' ? offsetHistory : leaveHistory;
  const filteredItems = useMemo(() => {
    if (transactionFilter === 'all') return currentItems;
    return currentItems.filter((item) => transactionFilter === 'earned' ? item.amount > 0 : item.amount < 0);
  }, [currentItems, transactionFilter]);
  const isOffset = activeTab === 'offset';
  const primaryColor = isOffset ? '#047857' : '#6d28d9';
  const fillColor = isOffset ? '#16a34a' : '#7c3aed';
  const trackColor = isOffset ? '#bbf7d0' : '#ddd6fe';
  const tintBg = isOffset ? '#f0fdf4' : '#faf5ff';
  const latestActiveOffsetCredit = useMemo(() => {
    if (!isOffset) return null;
    return offsetHistory
      .filter((item) => item.amount > 0 && (item.remainingAmount ?? item.amount) > 0 && item.expiresAt)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null;
  }, [isOffset, offsetHistory]);

  // Stats calculation
  const stats = useMemo(() => {
    let additions = 0;
    let deductions = 0;
    filteredItems.forEach((item) => {
      if (item.amount > 0) {
        additions += item.amount;
      } else {
        deductions += Math.abs(item.amount);
      }
    });
    return { additions, deductions };
  }, [filteredItems]);

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.page, { paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <TopBar
        name={name}
        username={username}
        photoUrl={photoUrl}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onHelpTutorials={onHelpTutorials}
        onBackHome={onClose}
        backTitle={isOffset ? 'Offset Balance History' : 'Leave Credit History'}
        backTitleLines={isOffset ? ['Offset Balance History'] : ['Leave Credit History']}
      />

      <View style={styles.content}>
        {/* Segmented Tab Switcher */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, isOffset ? styles.tabItemActiveOffset : null]}
              onPress={() => setActiveTab('offset')}
              activeOpacity={0.75}
            >
              <Clock3 size={15} color={isOffset ? '#ffffff' : colors.muted} strokeWidth={2.3} />
              <Text style={[styles.tabItemText, isOffset ? styles.tabItemTextActiveOffset : null]}>
                Offset Balance
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, !isOffset ? styles.tabItemActiveLeave : null]}
              onPress={() => setActiveTab('leave')}
              activeOpacity={0.75}
            >
              <CalendarDays size={15} color={!isOffset ? '#ffffff' : colors.muted} strokeWidth={2.3} />
              <Text style={[styles.tabItemText, !isOffset ? styles.tabItemTextActiveLeave : null]}>
                Leave Credit
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            stickyHeaderIndices={[1]}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            overScrollMode="never"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={fillColor} />
            }
          >

          <View style={[styles.summaryCard, { borderColor: trackColor }]}>
            {/* Current Balance */}
            <View style={[styles.banner, { backgroundColor: tintBg }]}>
              <View style={styles.bannerInfo}>
                <Text style={styles.bannerLabel}>
                  {isOffset ? 'AVAILABLE OFFSET BALANCE' : 'REMAINING LEAVE CREDITS'}
                </Text>
                <View style={styles.bannerValueRow}>
                  <Text style={[styles.bannerValue, { color: primaryColor }]}>
                    {isOffset ? `${offsetBalance.toFixed(1)}h` : `${leaveRemaining.toFixed(1)}d`}
                  </Text>
                  <View style={[styles.bannerBadge, { backgroundColor: trackColor }]}>
                    <Text style={[styles.bannerBadgeText, { color: primaryColor }]}>
                      {isOffset ? 'Available Hours' : 'Active Credits'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.bannerSub}>
                  {isOffset
                    ? 'Hours available for offset requests'
                    : annualCreditDays > 0
                      ? `${leaveRemaining.toFixed(1)} of ${annualCreditDays.toFixed(1)} days remaining`
                      : 'Remaining paid leave days'}
                </Text>
                {isOffset && latestActiveOffsetCredit ? (
                  <>
                    <View style={styles.bannerExpiry}>
                      <CalendarDays
                        size={12}
                        color={getOffsetExpiryColor(latestActiveOffsetCredit.remainingDays)}
                        strokeWidth={2.2}
                      />
                      <Text
                        style={[
                          styles.bannerExpiryText,
                          { color: getOffsetExpiryColor(latestActiveOffsetCredit.remainingDays) },
                        ]}
                      >
                        Expires on {formatOffsetExpiryDate(latestActiveOffsetCredit.expiresAt)}
                        {latestActiveOffsetCredit.remainingDays && latestActiveOffsetCredit.remainingDays > 0
                          ? ` (${latestActiveOffsetCredit.remainingDays} days left)`
                          : ''}
                      </Text>
                    </View>
                  </>
                ) : null}
              </View>
              <View style={[styles.bannerIcon, { backgroundColor: trackColor }]}>
                <CalendarDays size={40} color={primaryColor} strokeWidth={1.8} />
              </View>
            </View>

            {/* Earned / deducted summary */}
            <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <View style={[styles.statIcon, styles.statIconPositive]}>
                <ArrowUp size={17} color="#059669" strokeWidth={2.8} />
              </View>
              <View>
                <Text style={styles.statLabel}>
                  {isOffset ? 'Total Earned' : 'Total Credits'}
                </Text>
                <Text style={[styles.statValue, { color: '#059669' }]}>
                  +{stats.additions.toFixed(1)}{isOffset ? 'h' : 'd'}
                </Text>
              </View>
            </View>

            <View style={[styles.statChip, styles.statChipSecondary]}>
              <View style={[styles.statIcon, styles.statIconNegative]}>
                <ArrowDown size={17} color="#f43f5e" strokeWidth={2.8} />
              </View>
              <View>
                <Text style={styles.statLabel}>Total Deducted</Text>
                <Text style={[styles.statValue, { color: '#f43f5e' }]}>
                  -{stats.deductions.toFixed(1)}{isOffset ? 'h' : 'd'}
                </Text>
              </View>
            </View>
          </View>
          </View>

          <View style={styles.stickyFilterHeader}>
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={styles.transactionFilter}
                onPress={() => setFilterMenuOpen((open) => !open)}
                activeOpacity={0.8}
                accessibilityLabel="Change transaction filter"
              >
                <CalendarDays size={17} color={colors.primary} strokeWidth={2.2} />
                <Text style={styles.transactionFilterText}>
                  {transactionFilter === 'all' ? 'All Transactions' : transactionFilter === 'earned' ? 'Earned Only' : 'Deducted Only'}
                </Text>
                <ChevronDown size={17} color={colors.primary} strokeWidth={2.3} />
              </TouchableOpacity>
            </View>

            {filterMenuOpen ? (
              <View style={styles.filterMenu}>
                {([
                  ['all', 'All Transactions'],
                  ['earned', 'Earned Only'],
                  ['deducted', 'Deducted Only'],
                ] as const).map(([value, label]) => (
                  <TouchableOpacity
                    key={value}
                    style={styles.filterMenuOption}
                    onPress={() => {
                      setTransactionFilter(value);
                      setFilterMenuOpen(false);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.filterMenuText, transactionFilter === value ? styles.filterMenuTextActive : null]}>
                      {label}
                    </Text>
                    {transactionFilter === value ? <CheckCircle2 size={16} color={colors.primary} strokeWidth={2.4} /> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.historyHeadingRow}>
            <View>
              <Text style={styles.historyHeading}>Recent Transactions</Text>
              <Text style={styles.historySubheading}>All recorded activity</Text>
            </View>
            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() => setTransactionFilter('all')}
              activeOpacity={0.8}
              accessibilityLabel="View all transactions"
            >
              <Text style={styles.viewAllText}>View All</Text>
              <ChevronRight size={17} color={colors.primary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* History Transactions List */}
            {loading && !refreshing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={fillColor} />
                <Text style={styles.loadingText}>Loading transaction history...</Text>
              </View>
            ) : filteredItems.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconCircle, { backgroundColor: tintBg }]}>
                  {isOffset ? (
                    <Clock3 size={32} color={primaryColor} strokeWidth={2} />
                  ) : (
                    <CalendarDays size={32} color={primaryColor} strokeWidth={2} />
                  )}
                </View>
                <Text style={styles.emptyTitle}>
                  {isOffset ? 'No Offset History Yet' : 'No Leave Credit History Yet'}
                </Text>
                <Text style={styles.emptyDescription}>
                  {isOffset
                    ? 'Offset deductions from ESARF submissions, approvals, or refunds upon rejection will appear here.'
                    : 'Annual leave allocations and approved paid leaves will be tracked here.'}
                </Text>
              </View>
            ) : (
              filteredItems.map((item) => {
                const isPositive = item.amount > 0;
                const isNegative = item.amount < 0;
                const formattedAmount = `${isPositive ? '+' : ''}${item.amount.toFixed(1)}${item.unit}`;
                const amountColor = isPositive ? (isOffset ? '#16a34a' : '#7c3aed') : '#e11d48';
                const formattedReasons = formatHistoryReason(item.reason);
                const isExpanded = expandedTransactionIds.has(item.id);
                const hasExpandableReason = Boolean(
                  formattedReasons && (
                    formattedReasons.length > 1 ||
                    formattedReasons.some((entry) => entry.note.length > 80 || (entry.details?.length ?? 0) > 48)
                  ),
                );
                const remainingRatio = item.amount > 0
                  ? Math.min(1, Math.max(0, (item.remainingAmount ?? item.amount) / item.amount))
                  : 0;
                const remainingColor = remainingRatio <= 0
                  ? '#ef4444'
                  : remainingRatio < 1
                    ? '#eab308'
                    : '#22c55e';
                const expiryColor = getOffsetExpiryColor(item.remainingDays);
                const expiryTint = item.remainingDays && item.remainingDays <= 7
                  ? '#fef2f2'
                  : item.remainingDays && item.remainingDays <= 30
                    ? '#fffbeb'
                    : '#f0fdf4';

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.txCard}
                    onPress={() => {
                      setExpandedTransactionIds((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    activeOpacity={0.92}
                    accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} transaction ${item.title}`}
                  >
                    {/* Top Row: Icon + Title + Amount */}
                    <View style={styles.txTopRow}>
                      <View style={styles.txLeftGroup}>
                        <View
                          style={[
                            styles.txIconBadge,
                            {
                              backgroundColor: isPositive
                                ? isOffset
                                  ? '#dcfce7'
                                  : '#f3e8ff'
                                : '#ffe4e6',
                            },
                          ]}
                        >
                          {item.category === 'grant' ? (
                            <Sparkles size={14} color="#7c3aed" strokeWidth={2.4} />
                          ) : item.category === 'refund' ? (
                            <RotateCcw size={14} color="#059669" strokeWidth={2.4} />
                          ) : isPositive ? (
                            <Plus size={14} color={isOffset ? '#16a34a' : '#7c3aed'} strokeWidth={2.5} />
                          ) : (
                            <Minus size={14} color="#e11d48" strokeWidth={2.5} />
                          )}
                        </View>
                        <View style={styles.txTitleGroup}>
                          <Text style={styles.txTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.txSubtitle} numberOfLines={1}>
                            {item.subtitle}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.txAmountGroup}>
                        <Text style={[styles.txAmount, { color: amountColor }]}>
                          {formattedAmount}
                        </Text>
                        {!isOffset && item.type !== 'offset' && item.balanceAfter !== null && item.balanceAfter !== undefined && (
                          <View style={styles.balanceAfterBadge}>
                            <Text style={styles.balanceAfterText}>
                              Bal: {item.balanceAfter.toFixed(1)}
                              {item.unit}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Reason / Note if present */}
                    {formattedReasons ? (
                      <View style={[styles.reasonBox, hasExpandableReason && !isExpanded ? styles.reasonBoxCollapsed : null]}>
                        {formattedReasons.map((entry, entryIndex) => (
                          <View key={`${entry.transaction ?? 'note'}-${entryIndex}`} style={entryIndex > 0 ? styles.reasonEntrySpacer : null}>
                            {entry.transaction ? (
                              <Text style={styles.reasonTransaction}>{entry.transaction}</Text>
                            ) : null}
                            {entry.details ? (
                              <Text style={styles.reasonDetails}>{entry.details}</Text>
                            ) : null}
                            <Text style={styles.reasonText} numberOfLines={hasExpandableReason && !isExpanded ? 2 : undefined}>
                              “{entry.note}”
                            </Text>
                          </View>
                        ))}
                        {hasExpandableReason && !isExpanded ? (
                          <View style={styles.reasonFade} pointerEvents="none">
                            <View style={[styles.reasonFadeLayer, styles.reasonFadeLayerTop]} />
                            <View style={[styles.reasonFadeLayer, styles.reasonFadeLayerMiddle]} />
                            <View style={[styles.reasonFadeLayer, styles.reasonFadeLayerBottom]} />
                            <Text style={styles.reasonExpandHint}>Tap to expand</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {isOffset && item.amount > 0 && item.expiresAt ? (
                      <View style={[styles.expiryBox, { backgroundColor: expiryTint, borderColor: `${expiryColor}33` }]}>
                        <View style={styles.expiryHeader}>
                          <CalendarDays size={13} color={expiryColor} strokeWidth={2.2} />
                          <Text style={[styles.expiryRemaining, { color: remainingColor }]}>
                            {item.remainingAmount && item.remainingAmount > 0
                              ? `${item.remainingAmount.toFixed(1)}h remaining`
                              : 'Credit fully used'}
                          </Text>
                        </View>
                        {remainingRatio > 0 ? (
                          <Text style={[styles.expiryText, { color: expiryColor }]}>
                              {item.remainingDays && item.remainingDays > 0
                                ? `Expires on ${formatOffsetExpiryDate(item.expiresAt)} (${item.remainingDays} days left)`
                                : `Expired on ${formatOffsetExpiryDate(item.expiresAt)}`}
                          </Text>
                        ) : null}
                        <View style={styles.expiryTrack}>
                          <View
                            style={[
                              styles.expiryFill,
                              {
                                width: `${Math.round((remainingRatio <= 0 ? 1 : remainingRatio) * 100)}%`,
                                backgroundColor: remainingColor,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    ) : null}

                    {/* Footer Row: Date & Status */}
                    <View style={styles.txFooterRow}>
                      <Text style={styles.txDate}>{formatTransactionDate(item.date)}</Text>

                      {item.status ? (() => {
                        const statusLower = item.status.toLowerCase().trim();
                        const isApproved = statusLower === 'approved';
                        const isValidated = statusLower.includes('validat');
                        const isGreen = isApproved || isValidated;
                        const isRejected = statusLower === 'rejected' || statusLower === 'cancelled';

                        return (
                          <View
                            style={[
                              styles.statusPill,
                              isGreen
                                ? styles.statusApproved
                                : isRejected
                                  ? styles.statusRejected
                                  : styles.statusPending,
                            ]}
                          >
                            {isGreen ? (
                              <CheckCircle2 size={11} color="#047857" strokeWidth={2.4} />
                            ) : isRejected ? (
                              <ArrowUpRight size={11} color="#b91c1c" strokeWidth={2.4} />
                            ) : (
                              <Clock3 size={11} color="#b45309" strokeWidth={2.4} />
                            )}
                            <Text
                              style={[
                                styles.statusPillText,
                                isGreen
                                  ? styles.statusTextApproved
                                  : isRejected
                                    ? styles.statusTextRejected
                                    : styles.statusTextPending,
                              ]}
                            >
                              {item.status.toUpperCase()}
                            </Text>
                          </View>
                        );
                      })() : null}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
      </View>
    </View>
  );
}

function formatHistoryReason(reason?: string | null): FormattedHistoryEntry[] | null {
  const text = reason?.trim() ?? '';
  if (!text) return null;

  const entryPattern = /\[Entry\s+\d+\]\s*\(([^)]+)\)\s*(.*?)\s*\):\s*([\s\S]*?)(?=\s*\[Entry\s+\d+\]\s*\(|$)/g;
  const entries = Array.from(text.matchAll(entryPattern));
  if (entries.length === 0) return [{ note: text }];

  return entries.map((entry) => {
    const transaction = entry[1].trim();
    const rawDetails = entry[2].replace(/\s+/g, ' ').trim();
    const dateTimeMatch = /^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{2})\s+(.+?)\s+\((\d+(?:\.\d+)?)\s*hrs?\)$/i.exec(rawDetails);
    let details = rawDetails;

    if (dateTimeMatch) {
      const [, month, fromDay, toDay, year, rawTimes, hours] = dateTimeMatch;
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
        new Date(2000, Number(month) - 1, 1),
      );
      const dateLabel = fromDay === toDay
        ? `${monthName} ${Number(fromDay)}, 20${year}`
        : `${monthName} ${Number(fromDay)}–${Number(toDay)}, 20${year}`;
      const timeLabel = rawTimes
        .replace(/:00(?=\s?[AP]M)/gi, '')
        .replace(/\s*-\s*/g, '–');
      details = `${dateLabel} · ${timeLabel} · ${hours} hrs`;
    }

    return { transaction, details, note: entry[3].trim() };
  });
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.sm,
    marginTop: 0,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    paddingVertical: 7,
    borderRadius: radius.md - 2,
  },
  tabItemActiveOffset: {
    backgroundColor: '#1479ee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabItemActiveLeave: {
    backgroundColor: '#1479ee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabItemText: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: colors.muted,
  },
  tabItemTextActiveOffset: {
    color: '#ffffff',
    fontWeight: fontWeights.bold,
  },
  tabItemTextActiveLeave: {
    color: '#ffffff',
    fontWeight: fontWeights.bold,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.md,
  },
  rangeChip: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rangeChipText: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.muted,
  },
  rangeChipTextActive: {
    color: '#ffffff',
  },
  summaryCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    marginBottom: spacing.md,
  },
  bannerIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  banner: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  bannerInfo: {
    flex: 1,
  },
  bannerLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bannerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 5,
    marginBottom: 4,
  },
  bannerValue: {
    fontSize: 29,
    lineHeight: 33,
    fontWeight: fontWeights.heavy,
  },
  bannerBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  bannerBadgeText: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
  },
  bannerSub: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  bannerExpiry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  bannerExpiryText: {
    fontSize: 10,
    lineHeight: 14,
    color: '#15803d',
    fontWeight: fontWeights.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  statChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 2,
    paddingHorizontal: 0,
    gap: 7,
  },
  statChipSecondary: {
    borderLeftWidth: 1,
    borderLeftColor: '#eef2f7',
    paddingLeft: 12,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIconPositive: {
    backgroundColor: '#d1fae5',
  },
  statIconNegative: {
    backgroundColor: '#ffe4e6',
  },
  statLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: fontWeights.medium,
    flex: 1,
  },
  statValue: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
  historyHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  historyHeading: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  historySubheading: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    fontWeight: fontWeights.medium,
    marginTop: 1,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingLeft: 8,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.primary,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  stickyFilterHeader: {
    position: 'relative',
    zIndex: 10,
    backgroundColor: '#f8fafc',
    paddingBottom: spacing.xs,
  },
  transactionFilter: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5f1',
  },
  transactionFilterText: {
    flex: 1,
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  filterMenu: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 8,
    borderRadius: radius.md,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5f1',
    overflow: 'hidden',
  },
  filterMenuOption: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  filterMenuText: {
    fontSize: 13,
    fontWeight: fontWeights.medium,
    color: colors.text,
  },
  filterMenuTextActive: {
    color: colors.primary,
    fontWeight: fontWeights.bold,
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  loadingContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  emptyContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    textAlign: 'center',
  },
  txCard: {
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  txTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  txLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    flex: 1,
  },
  txIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitleGroup: {
    flex: 1,
  },
  txTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  txSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  txAmountGroup: {
    alignItems: 'flex-end',
    marginLeft: spacing.xs,
  },
  txAmount: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: fontWeights.heavy,
  },
  balanceAfterBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  balanceAfterText: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: fontWeights.bold,
  },
  reasonBox: {
    backgroundColor: '#f8fafc',
    borderLeftWidth: 2,
    borderLeftColor: '#cbd5e1',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginTop: 10,
  },
  reasonBoxCollapsed: {
    maxHeight: 76,
    overflow: 'hidden',
    position: 'relative',
  },
  reasonFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 32,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 5,
  },
  reasonFadeLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  reasonFadeLayerTop: {
    top: 0,
    height: 12,
    backgroundColor: 'rgba(248, 250, 252, 0.22)',
  },
  reasonFadeLayerMiddle: {
    top: 10,
    height: 12,
    backgroundColor: 'rgba(248, 250, 252, 0.58)',
  },
  reasonFadeLayerBottom: {
    bottom: 0,
    height: 16,
    backgroundColor: 'rgba(248, 250, 252, 0.88)',
  },
  reasonExpandHint: {
    fontSize: 9,
    lineHeight: 12,
    color: '#64748b',
    fontWeight: fontWeights.bold,
  },
  reasonText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#475569',
    fontStyle: 'italic',
  },
  reasonTransaction: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.text,
    fontWeight: fontWeights.bold,
  },
  reasonDetails: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginTop: 1,
  },
  reasonEntrySpacer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  expiryBox: {
    marginTop: 9,
    paddingVertical: 8,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  expiryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  expiryText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 15,
    color: '#64748b',
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  expiryRemaining: {
    fontSize: 11,
    lineHeight: 15,
    color: '#15803d',
    fontWeight: fontWeights.bold,
  },
  expiryTrack: {
    height: 7,
    marginTop: 7,
    borderRadius: 4,
    backgroundColor: '#dbeafe',
    overflow: 'hidden',
  },
  expiryFill: {
    height: '100%',
    borderRadius: 3,
  },
  txFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  txDate: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: fontWeights.medium,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusApproved: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  statusPending: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  statusRejected: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: fontWeights.heavy,
  },
  statusTextApproved: {
    color: '#047857',
  },
  statusTextPending: {
    color: '#b45309',
  },
  statusTextRejected: {
    color: '#b91c1c',
  },
});
