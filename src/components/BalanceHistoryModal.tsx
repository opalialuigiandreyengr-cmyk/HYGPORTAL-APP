import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react-native';

import { colors, fontWeights, radius, spacing } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSafeBottomInset } from '../utils/safeArea';
import { fetchLeaveHistory, fetchOffsetHistory, type BalanceHistoryItem } from '../services/balanceHistory';

type BalanceHistoryModalProps = {
  visible: boolean;
  initialTab?: 'offset' | 'leave';
  offsetBalance: number;
  leaveRemaining: number;
  annualCreditDays?: number;
  onClose: () => void;
  onRefreshDashboard?: () => void;
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

export function BalanceHistoryModal({
  visible,
  initialTab = 'offset',
  offsetBalance,
  leaveRemaining,
  annualCreditDays = 0,
  onClose,
  onRefreshDashboard,
}: BalanceHistoryModalProps) {
  const { width, height } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<'offset' | 'leave'>(initialTab);
  const [offsetHistory, setOffsetHistory] = useState<BalanceHistoryItem[]>([]);
  const [leaveHistory, setLeaveHistory] = useState<BalanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Sync initial tab when modal opens
  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

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
    if (visible) {
      loadData();
    }
  }, [visible, activeTab]);

  const handleRefresh = async () => {
    onRefreshDashboard?.();
    await loadData(true);
  };

  const currentItems = activeTab === 'offset' ? offsetHistory : leaveHistory;
  const isOffset = activeTab === 'offset';
  const primaryColor = isOffset ? '#047857' : '#6d28d9';
  const fillColor = isOffset ? '#16a34a' : '#7c3aed';
  const trackColor = isOffset ? '#bbf7d0' : '#ddd6fe';
  const tintBg = isOffset ? '#f0fdf4' : '#faf5ff';

  // Stats calculation
  const stats = useMemo(() => {
    let additions = 0;
    let deductions = 0;
    currentItems.forEach((item) => {
      if (item.amount > 0) {
        additions += item.amount;
      } else {
        deductions += Math.abs(item.amount);
      }
    });
    return { additions, deductions };
  }, [currentItems]);

  const insets = useSafeAreaInsets();
  const isWide = width >= 600;

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />

        <View
          style={[
            styles.sheetContainer,
            isWide ? styles.sheetContainerWide : null,
            {
              height: isWide ? undefined : Math.min(height * 0.84, 680),
              maxHeight: Math.min(height * 0.9, 720),
              paddingBottom: getSafeBottomInset(insets.bottom, Platform.OS === 'ios' ? 24 : spacing.md),
            },
          ]}
        >
          {/* Mobile Top Drag Indicator */}
          {!isWide && <View style={styles.sheetHandle} />}

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleBlock}>
              <View style={[styles.headerIconContainer, { backgroundColor: tintBg, borderColor: trackColor }]}>
                {isOffset ? (
                  <Clock3 size={20} color={primaryColor} strokeWidth={2.4} />
                ) : (
                  <CalendarDays size={20} color={primaryColor} strokeWidth={2.4} />
                )}
              </View>
              <View style={styles.headerTextGroup}>
                <Text style={styles.headerTitle}>
                  {isOffset ? 'Offset Balance History' : 'Leave Credit History'}
                </Text>
                <Text style={styles.headerSubtitle}>
                  Track your deductions, credits, and adjustments
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={12}
              accessibilityLabel="Close balance history modal"
            >
              <X size={18} color="#64748b" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Segmented Tab Switcher */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, isOffset ? styles.tabItemActiveOffset : null]}
              onPress={() => setActiveTab('offset')}
              activeOpacity={0.75}
            >
              <Clock3 size={15} color={isOffset ? '#16a34a' : colors.muted} strokeWidth={2.3} />
              <Text style={[styles.tabItemText, isOffset ? styles.tabItemTextActiveOffset : null]}>
                Offset Balance
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, !isOffset ? styles.tabItemActiveLeave : null]}
              onPress={() => setActiveTab('leave')}
              activeOpacity={0.75}
            >
              <CalendarDays size={15} color={!isOffset ? '#7c3aed' : colors.muted} strokeWidth={2.3} />
              <Text style={[styles.tabItemText, !isOffset ? styles.tabItemTextActiveLeave : null]}>
                Leave Credit
              </Text>
            </TouchableOpacity>
          </View>

          {/* Current Balance Banner */}
          <View style={[styles.banner, { backgroundColor: tintBg, borderColor: trackColor }]}>
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
            </View>
          </View>

          {/* Quick Stats Summary Chips */}
          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <View style={[styles.statDot, { backgroundColor: '#16a34a' }]} />
              <Text style={styles.statLabel}>
                {isOffset ? 'Total Earned/Credited:' : 'Total Credits Granted:'}
              </Text>
              <Text style={[styles.statValue, { color: '#16a34a' }]}>
                +{stats.additions.toFixed(1)}
                {isOffset ? 'h' : 'd'}
              </Text>
            </View>

            <View style={styles.statChip}>
              <View style={[styles.statDot, { backgroundColor: '#e11d48' }]} />
              <Text style={styles.statLabel}>Total Deducted:</Text>
              <Text style={[styles.statValue, { color: '#e11d48' }]}>
                -{stats.deductions.toFixed(1)}
                {isOffset ? 'h' : 'd'}
              </Text>
            </View>
          </View>

          {/* History Transactions List */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            overScrollMode="never"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={fillColor} />
            }
          >
            {loading && !refreshing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={fillColor} />
                <Text style={styles.loadingText}>Loading transaction history...</Text>
              </View>
            ) : currentItems.length === 0 ? (
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
              currentItems.map((item) => {
                const isPositive = item.amount > 0;
                const isNegative = item.amount < 0;
                const formattedAmount = `${isPositive ? '+' : ''}${item.amount.toFixed(1)}${item.unit}`;
                const amountColor = isPositive ? (isOffset ? '#16a34a' : '#7c3aed') : '#e11d48';

                return (
                  <View key={item.id} style={styles.txCard}>
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
                    {item.reason ? (
                      <View style={styles.reasonBox}>
                        <Text style={styles.reasonText} numberOfLines={2}>
                          "{item.reason.trim()}"
                        </Text>
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
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Footer Action */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.closeActionBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.closeActionBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  dismissArea: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    width: '100%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: Platform.OS === 'ios' ? 28 : spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  sheetContainerWide: {
    maxWidth: 540,
    borderRadius: 24,
    marginBottom: 'auto',
    marginTop: 'auto',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  headerTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  headerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    color: colors.muted,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.sm,
    marginTop: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.md - 2,
  },
  tabItemActiveOffset: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabItemActiveLeave: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabItemText: {
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    color: colors.muted,
  },
  tabItemTextActiveOffset: {
    color: '#16a34a',
    fontWeight: fontWeights.bold,
  },
  tabItemTextActiveLeave: {
    color: '#7c3aed',
    fontWeight: fontWeights.bold,
  },
  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  bannerInfo: {
    flex: 1,
  },
  bannerLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bannerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 3,
    marginBottom: 2,
  },
  bannerValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: fontWeights.heavy,
  },
  bannerBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  bannerBadgeText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
  },
  bannerSub: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
    gap: 5,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: fontWeights.medium,
    flex: 1,
  },
  statValue: {
    fontSize: 11,
    fontWeight: fontWeights.heavy,
  },
  scrollArea: {
    flex: 1,
    minHeight: 180,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
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
    padding: spacing.sm + 2,
    marginBottom: spacing.xs + 2,
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
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitleGroup: {
    flex: 1,
  },
  txTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  txSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  txAmountGroup: {
    alignItems: 'flex-end',
    marginLeft: spacing.xs,
  },
  txAmount: {
    fontSize: 15,
    lineHeight: 18,
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
    fontSize: 9,
    color: '#64748b',
    fontWeight: fontWeights.bold,
  },
  reasonBox: {
    backgroundColor: '#f8fafc',
    borderLeftWidth: 2,
    borderLeftColor: '#cbd5e1',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  reasonText: {
    fontSize: 11,
    lineHeight: 15,
    color: '#475569',
    fontStyle: 'italic',
  },
  txFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  txDate: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: fontWeights.medium,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
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
    fontSize: 9,
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
  footer: {
    paddingTop: spacing.xs,
  },
  closeActionBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeActionBtnText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
});
