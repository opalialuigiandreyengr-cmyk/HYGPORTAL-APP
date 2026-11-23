import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  CheckCircle2,
  Clock3,
  Coins,
  Gift,
  PackageCheck,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopBar } from '../components/TopBar';
import type { AppToastMessage } from '../components/AppToast';
import {
  loadRedeemedRewards,
  loadRewardsCatalog,
  redeemRewardItem,
  type RedeemedRewardItem,
  type RewardCatalogItem,
} from '../services/rewards';
import { colors, fontWeights, spacing } from '../theme';
import { getScreenBottomPadding } from '../utils/safeArea';

export type RewardsCatalogScreenProps = {
  userId?: string | null;
  employeeId?: string | null;
  onBack: () => void;
  profileName?: string | null;
  username?: string | null;
  profilePhotoUrl?: string | null;
  pointsBalance?: number;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onPointsUpdated?: (newBalance: number) => void;
  onToast?: (toast: AppToastMessage) => void;
  onSignOut?: () => void | Promise<void>;
};

export function RewardsCatalogScreen({
  userId,
  employeeId,
  onBack,
  profileName,
  username,
  profilePhotoUrl,
  pointsBalance = 0,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onPointsUpdated,
  onToast,
  onSignOut,
}: RewardsCatalogScreenProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'redeemable' | 'redeemed'>('redeemable');
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
  const [catalog, setCatalog] = useState<RewardCatalogItem[]>([]);
  const [redeemed, setRedeemed] = useState<RedeemedRewardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [confirmReward, setConfirmReward] = useState<RewardCatalogItem | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState('');

  const fetchAll = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading((prev) => (catalog.length === 0 && redeemed.length === 0 ? true : prev));
      }

      try {
        const [nextCatalog, nextRedeemed] = await Promise.all([
          loadRewardsCatalog({ forceRefresh }),
          loadRedeemedRewards(userId ?? undefined, employeeId ?? undefined, { forceRefresh }).catch(
            () => [] as RedeemedRewardItem[],
          ),
        ]);
        setCatalog(nextCatalog);
        setRedeemed(nextRedeemed);
        setErrorMessage('');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load rewards.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [userId, employeeId],
  );

  useEffect(() => {
    void fetchAll(false);
  }, [fetchAll]);

  const redeemedRewardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of redeemed) {
      const s = (r.status || '').toLowerCase();
      if (r.rewardId && s !== 'rejected' && s !== 'cancelled') {
        ids.add(r.rewardId);
      }
    }
    return ids;
  }, [redeemed]);

  const redeemableCatalog = useMemo(
    () => catalog.filter((item) => !redeemedRewardIds.has(item.id)),
    [catalog, redeemedRewardIds],
  );

  const activeItemsForCategory = activeTab === 'redeemable' ? redeemableCatalog : redeemed;

  const availableCategories = useMemo(() => {
    const cats = ['All Categories'];
    const seen = new Set<string>(['all categories']);
    for (const item of activeItemsForCategory) {
      const cat = (item.category || 'General').trim();
      if (cat && !seen.has(cat.toLowerCase())) {
        seen.add(cat.toLowerCase());
        cats.push(cat);
      }
    }
    return cats;
  }, [activeItemsForCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      'All Categories': activeItemsForCategory.length,
    };
    for (const cat of availableCategories) {
      if (cat === 'All Categories') continue;
      counts[cat] = activeItemsForCategory.filter(
        (item) => (item.category || 'General').trim().toLowerCase() === cat.toLowerCase(),
      ).length;
    }
    return counts;
  }, [activeItemsForCategory, availableCategories]);

  useEffect(() => {
    if (
      selectedCategory !== 'All Categories' &&
      !availableCategories.some((c) => c.toLowerCase() === selectedCategory.toLowerCase())
    ) {
      setSelectedCategory('All Categories');
    }
  }, [availableCategories, selectedCategory]);

  const filteredCatalog = useMemo(() => {
    if (selectedCategory === 'All Categories') return redeemableCatalog;
    return redeemableCatalog.filter(
      (item) => (item.category || 'General').trim().toLowerCase() === selectedCategory.toLowerCase(),
    );
  }, [redeemableCatalog, selectedCategory]);

  const filteredRedeemed = useMemo(() => {
    if (selectedCategory === 'All Categories') return redeemed;
    return redeemed.filter(
      (item) => (item.category || 'General').trim().toLowerCase() === selectedCategory.toLowerCase(),
    );
  }, [redeemed, selectedCategory]);

  const handleConfirmRedeem = async () => {
    if (!confirmReward || isRedeeming) return;
    setIsRedeeming(true);
    setRedeemError('');
    try {
      const { item, newBalance } = await redeemRewardItem(confirmReward, userId ?? undefined);
      setCatalog((prev) =>
        prev.map((c) =>
          c.id === confirmReward.id ? { ...c, stocks: Math.max(0, c.stocks - 1) } : c,
        ),
      );
      setRedeemed((prev) => [item, ...prev]);
      if (typeof newBalance === 'number') {
        onPointsUpdated?.(newBalance);
      } else {
        onPointsUpdated?.(Math.max(0, pointsBalance - confirmReward.pointsValue));
      }
      onToast?.({
        tone: 'success',
        title: 'Reward Redeemed!',
        message: `${confirmReward.productName} has been submitted for redemption.`,
      });
      setConfirmReward(null);
      setActiveTab('redeemed');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Could not redeem this reward.';
      setRedeemError(msg);
      onToast?.({
        tone: 'error',
        title: 'Redemption Failed',
        message: msg,
      });
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={profileName || 'Rewards'}
        username={username}
        photoUrl={profilePhotoUrl}
        pointsBalance={pointsBalance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onBackHome={onBack}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: getScreenBottomPadding(insets.bottom, true, 28) },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void fetchAll(true)}
            colors={['#16a34a', colors.brand.gold]}
            tintColor="#16a34a"
          />
        }
      >
        {/* Header Card */}
        <View style={styles.headerCard}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconBox}>
              <Gift size={24} color="#16a34a" strokeWidth={2.3} />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>Rewards</Text>
              <Text style={styles.headerSub}>Redeem your HYG points for rewards</Text>
            </View>
          </View>
          <View style={styles.balanceBox}>
            <Text style={styles.balanceValue}>{pointsBalance.toLocaleString()}</Text>
            <Text style={styles.balanceLabel}>POINTS</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, activeTab === 'redeemable' && styles.tabBtnActive]}
            onPress={() => setActiveTab('redeemable')}
          >
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'redeemable' && styles.tabBtnTextActive,
              ]}
            >
              Redeemable ({redeemableCatalog.length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'redeemed' && styles.tabBtnActive]}
            onPress={() => setActiveTab('redeemed')}
          >
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'redeemed' && styles.tabBtnTextActive,
              ]}
            >
              Redeemed ({redeemed.length})
            </Text>
          </Pressable>
        </View>

        {/* Category Filter Carousel */}
        {availableCategories.length > 1 ? (
          <View style={styles.categorySection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryPillsScroll}
            >
              {availableCategories.map((cat) => {
                const isSelected = selectedCategory === cat;
                const count = categoryCounts[cat] ?? 0;
                return (
                  <TouchableOpacity
                    key={cat}
                    activeOpacity={0.7}
                    style={[
                      styles.categoryPill,
                      isSelected && styles.categoryPillActive,
                    ]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.categoryPillText,
                        isSelected && styles.categoryPillTextActive,
                      ]}
                    >
                      {cat}
                    </Text>
                    <View
                      style={[
                        styles.categoryPillBadge,
                        isSelected && styles.categoryPillBadgeActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.categoryPillBadgeText,
                          isSelected && styles.categoryPillBadgeTextActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isLoading && catalog.length === 0 && redeemed.length === 0 ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator size="small" color="#16a34a" />
            <Text style={styles.emptyTitle}>Loading rewards...</Text>
            <Text style={styles.emptySub}>Fetching available rewards and redemptions.</Text>
          </View>
        ) : activeTab === 'redeemable' ? (
          filteredCatalog.length > 0 ? (
            <View style={styles.listContainer}>
              {filteredCatalog.map((item) => {
                const isAlreadyRedeemed = redeemedRewardIds.has(item.id);
                const isOutOfStock = item.stocks <= 0;
                const canAfford = pointsBalance >= item.pointsValue;
                const canRedeem = !isAlreadyRedeemed && !isOutOfStock && canAfford;
                const hasImage = isValidImageUrl(item.imageUrl);

                return (
                  <View key={item.id} style={styles.rewardCard}>
                    <View style={styles.rewardCardTop}>
                      <View style={styles.rewardImageBox}>
                        {hasImage && item.imageUrl ? (
                          <Image
                            source={{ uri: item.imageUrl }}
                            style={styles.rewardImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <Gift size={28} color="#16a34a" strokeWidth={2} />
                        )}
                      </View>
                      <View style={styles.rewardInfo}>
                        <Text style={styles.rewardTitle} numberOfLines={2}>
                          {item.productName}
                        </Text>
                        <View style={styles.rewardCategoryRow}>
                          <View style={styles.rewardCategoryBadge}>
                            <Text style={styles.rewardCategoryBadgeText}>
                              {item.category || 'General'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.rewardMetaRow}>
                          <View style={styles.pointsCostPill}>
                            <Coins size={12} color="#b45309" strokeWidth={2.4} />
                            <Text style={styles.pointsCostText}>
                              {item.pointsValue.toLocaleString()} Points
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.stockPill,
                              isOutOfStock && styles.stockPillEmpty,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stockText,
                                isOutOfStock && styles.stockTextEmpty,
                              ]}
                            >
                              {isOutOfStock ? 'Out of Stock' : `${item.stocks} left`}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>

                    <Pressable
                      style={({ pressed }) => [
                        styles.redeemButton,
                        !canRedeem && styles.redeemButtonDisabled,
                        pressed && canRedeem && styles.redeemButtonPressed,
                      ]}
                      onPress={() => {
                        setRedeemError('');
                        setConfirmReward(item);
                      }}
                      disabled={!canRedeem}
                      accessibilityRole="button"
                      accessibilityLabel={`Redeem ${item.productName}`}
                    >
                      <Text
                        style={[
                          styles.redeemButtonText,
                          !canRedeem && styles.redeemButtonTextDisabled,
                        ]}
                      >
                        {isAlreadyRedeemed
                          ? 'Redeemed'
                          : isOutOfStock
                            ? 'Out of Stock'
                            : !canAfford
                              ? `Need ${(item.pointsValue - pointsBalance).toLocaleString()} more Points`
                              : 'Redeem'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Gift size={28} color="#94a3b8" />
              <Text style={styles.emptyTitle}>
                {selectedCategory !== 'All Categories'
                  ? 'No rewards in this category'
                  : 'No redeemable rewards yet'}
              </Text>
              <Text style={styles.emptySub}>
                {selectedCategory !== 'All Categories'
                  ? `No redeemable rewards found under "${selectedCategory}".`
                  : 'Check back later for new items you can redeem with your HYG points.'}
              </Text>
              {selectedCategory !== 'All Categories' ? (
                <TouchableOpacity
                  style={styles.clearCategoryBtn}
                  onPress={() => setSelectedCategory('All Categories')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.clearCategoryText}>Show All Categories</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        ) : filteredRedeemed.length > 0 ? (
          <View style={styles.listContainer}>
            {filteredRedeemed.map((item) => {
              const hasImage = isValidImageUrl(item.imageUrl);
              const statusTone = getRedemptionStatusTone(item.status);

              return (
                <View key={item.id} style={styles.redeemedCard}>
                  <View style={styles.rewardImageBox}>
                    {hasImage && item.imageUrl ? (
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={styles.rewardImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <PackageCheck size={26} color="#2563eb" strokeWidth={2} />
                    )}
                  </View>
                  <View style={styles.rewardInfo}>
                    <View style={styles.redeemedTopRow}>
                      <Text style={styles.rewardTitle} numberOfLines={2}>
                        {item.rewardName}
                      </Text>
                      <View style={[styles.statusPill, { backgroundColor: statusTone.bg }]}>
                        <Text style={[styles.statusPillText, { color: statusTone.text }]}>
                          {statusTone.label}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.rewardCategoryRow}>
                      <View style={styles.rewardCategoryBadge}>
                        <Text style={styles.rewardCategoryBadgeText}>
                          {item.category || 'General'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.redeemedMetaRow}>
                      <Text style={styles.redeemedCostText}>
                        -{item.pointsCost.toLocaleString()} Points
                      </Text>
                      <View style={styles.redeemedDateRow}>
                        <Clock3 size={11} color={colors.muted} />
                        <Text style={styles.redeemedDateText}>
                          {formatRedemptionDate(item.redeemedAt)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <PackageCheck size={28} color="#94a3b8" />
            <Text style={styles.emptyTitle}>No redeemed rewards yet</Text>
            <Text style={styles.emptySub}>
              Rewards you redeem will appear here along with their status.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Redeem Confirmation Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(confirmReward)}
        onRequestClose={() => {
          if (!isRedeeming) setConfirmReward(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isRedeeming) setConfirmReward(null);
            }}
          />
          {confirmReward ? (
            <View style={styles.modalCard}>
              <Pressable
                style={styles.modalCloseBtn}
                onPress={() => {
                  if (!isRedeeming) setConfirmReward(null);
                }}
                hitSlop={10}
              >
                <X size={18} color={colors.muted} strokeWidth={2.4} />
              </Pressable>

              <View style={styles.modalIconBox}>
                {isValidImageUrl(confirmReward.imageUrl) && confirmReward.imageUrl ? (
                  <Image
                    source={{ uri: confirmReward.imageUrl }}
                    style={styles.modalImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Gift size={46} color="#16a34a" strokeWidth={2.2} />
                )}
              </View>

              <Text style={styles.modalTitle}>Confirm Redemption</Text>
              <Text style={styles.modalSub}>
                Redeem <Text style={styles.modalBold}>{confirmReward.productName}</Text> for{' '}
                <Text style={styles.modalBold}>
                  {confirmReward.pointsValue.toLocaleString()} Points
                </Text>
                ?
              </Text>

              <View style={styles.modalBalanceCard}>
                <Text style={styles.modalBalanceLabel}>Remaining Balance After</Text>
                <Text style={styles.modalBalanceValue}>
                  {Math.max(0, pointsBalance - confirmReward.pointsValue).toLocaleString()} Points
                </Text>
              </View>

              {redeemError ? (
                <View style={styles.modalErrorBox}>
                  <Text style={styles.modalErrorText}>{redeemError}</Text>
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setConfirmReward(null)}
                  disabled={isRedeeming}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalConfirmBtn, isRedeeming && { opacity: 0.7 }]}
                  onPress={() => void handleConfirmRedeem()}
                  disabled={isRedeeming}
                >
                  {isRedeeming ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <CheckCircle2 size={16} color="#ffffff" strokeWidth={2.4} />
                      <Text style={styles.modalConfirmText}>Confirm</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function isValidImageUrl(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:image/')
  );
}

function getRedemptionStatusTone(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'approved' || s === 'fulfilled') {
    return {
      bg: '#dcfce7',
      text: '#15803d',
      label: s === 'fulfilled' ? 'Fulfilled' : 'Approved',
    };
  }
  if (s === 'rejected' || s === 'cancelled') {
    return {
      bg: '#fee2e2',
      text: '#b91c1c',
      label: s === 'cancelled' ? 'Cancelled' : 'Rejected',
    };
  }
  return {
    bg: '#fef3c7',
    text: '#b45309',
    label: 'Pending',
  };
}

function formatRedemptionDate(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.md,
  },
  headerCard: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  headerIconBox: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
  },
  headerSub: {
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 2,
  },
  balanceBox: {
    paddingLeft: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  balanceValue: {
    color: '#16a34a',
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '800',
  },
  balanceLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 1,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 4,
    marginBottom: spacing.md,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tabBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  tabBtnTextActive: {
    color: colors.text,
    fontWeight: '800',
  },
  categorySection: {
    marginBottom: spacing.md,
  },
  categoryPillsScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  categoryPillActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#818cf8',
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    color: '#475569',
  },
  categoryPillTextActive: {
    color: '#4338ca',
    fontWeight: fontWeights.bold,
  },
  categoryPillBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  categoryPillBadgeActive: {
    backgroundColor: '#c7d2fe',
  },
  categoryPillBadgeText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
  categoryPillBadgeTextActive: {
    color: '#312e81',
  },
  clearCategoryBtn: {
    marginTop: 8,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  clearCategoryText: {
    color: '#4338ca',
    fontSize: 12.5,
    fontWeight: fontWeights.bold,
  },
  rewardCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  rewardCategoryBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rewardCategoryBadgeText: {
    color: '#1d4ed8',
    fontSize: 10.5,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorBannerText: {
    color: '#b91c1c',
    fontSize: 12.5,
    fontWeight: '600',
  },
  listContainer: {
    gap: spacing.sm + 4,
  },
  rewardCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm + 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  rewardCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
  },
  rewardImageBox: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rewardImage: {
    width: 64,
    height: 64,
  },
  rewardInfo: {
    flex: 1,
    minWidth: 0,
  },
  rewardTitle: {
    color: colors.text,
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '800',
  },
  rewardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  pointsCostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pointsCostText: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '800',
  },
  stockPill: {
    backgroundColor: '#eff6ff',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  stockPillEmpty: {
    backgroundColor: '#fee2e2',
  },
  stockText: {
    color: '#1d4ed8',
    fontSize: 11.5,
    fontWeight: '700',
  },
  stockTextEmpty: {
    color: '#b91c1c',
  },
  redeemButton: {
    backgroundColor: '#16a34a',
    borderRadius: 11,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemButtonPressed: {
    opacity: 0.88,
  },
  redeemButtonDisabled: {
    backgroundColor: '#e2e8f0',
  },
  redeemButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  redeemButtonTextDisabled: {
    color: '#64748b',
  },
  redeemedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  redeemedTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  redeemedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  redeemedCostText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '800',
  },
  redeemedDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  redeemedDateText: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  emptySub: {
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 10,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: spacing.sm + 4,
    right: spacing.sm + 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalIconBox: {
    width: 120,
    height: 120,
    borderRadius: 20,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.sm + 4,
  },
  modalImage: {
    width: 120,
    height: 120,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalSub: {
    color: colors.muted,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
  },
  modalBold: {
    color: colors.text,
    fontWeight: '800',
  },
  modalBalanceCard: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  modalBalanceLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  modalBalanceValue: {
    color: '#16a34a',
    fontSize: 14,
    fontWeight: '800',
  },
  modalErrorBox: {
    width: '100%',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: spacing.sm,
  },
  modalErrorText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: spacing.md + 2,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 11,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  modalConfirmBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#16a34a',
    borderRadius: 11,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});
