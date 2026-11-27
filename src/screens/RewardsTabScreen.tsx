import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Award,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Clock3,
  Coins,
  Gift,
  GraduationCap,
  Heart,
  History,
  Lightbulb,
  MapPin,
  Rocket,
  Star,
  Trophy,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colors, spacing } from '../theme';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { getScreenBottomPadding } from '../utils/safeArea';
import { TopBar } from '../components/TopBar';
import {
  loadRedeemedRewards,
  loadRewardsCatalog,
  loadRewardsWallet,
  type RedeemedRewardItem,
  type RewardCatalogItem,
  type RewardsWallet,
  type RewardsWalletHistoryItem,
} from '../services/rewards';
import { emptyEmployeeBadgesData, loadEmployeeBadges, type EarnedBadgeItem, type EmployeeBadgesData } from '../services/badges';
import { confirmTrainingAttendance, loadMyTrainings, type TrainingItem } from '../services/trainings';
import { BadgesScreen } from './BadgesScreen';
import { RewardsCatalogScreen } from './RewardsCatalogScreen';
import { TrainingsScreen } from './TrainingsScreen';
import type { AppToastMessage } from '../components/AppToast';

const hygCoinsImage = require('../../assets/hygcoins.png');

export type RewardsTabScreenProps = {
  userId?: string | null;
  employeeId?: string | null;
  profileName?: string | null;
  username?: string | null;
  employeeCode?: string | null;
  profilePhotoUrl?: string | null;
  positionName?: string | null;
  departmentName?: string | null;
  authorityLevel?: number | null;
  pointsBalance?: number;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onHelpTutorials?: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onPointsUpdated?: (balance: number) => void;
  onToast?: (toast: AppToastMessage) => void;
  onSignOut?: () => void | Promise<void>;
};

export function RewardsTabScreen({
  userId,
  employeeId,
  profileName,
  username,
  employeeCode,
  profilePhotoUrl,
  positionName,
  departmentName,
  authorityLevel,
  pointsBalance = 0,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onHelpTutorials,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onPointsUpdated,
  onToast,
  onSignOut,
}: RewardsTabScreenProps) {
  const onPointsUpdatedRef = useRef(onPointsUpdated);
  onPointsUpdatedRef.current = onPointsUpdated;

  const barcodeDigits = useMemo(
    () => makeEan13Digits(employeeCode || username || profileName || 'HYG Portal'),
    [employeeCode, username, profileName]
  );
  const [showWalletHistory, setShowWalletHistory] = useState(false);
  const [showBadges, setShowBadges] = useState(false);
  const [showRewardsCatalog, setShowRewardsCatalog] = useState(false);
  const [showTrainings, setShowTrainings] = useState(false);
  const [wallet, setWallet] = useState<RewardsWallet>(() => ({
    balance: pointsBalance,
    totalEarned: pointsBalance,
    totalRedeemed: 0,
    history: [],
  }));
  const [badgesData, setBadgesData] = useState<EmployeeBadgesData>(() => emptyEmployeeBadgesData());
  const [redeemedRewards, setRedeemedRewards] = useState<RedeemedRewardItem[]>([]);
  const [catalogRewards, setCatalogRewards] = useState<RewardCatalogItem[]>([]);
  const [trainings, setTrainings] = useState<TrainingItem[]>([]);
  const [seenIdsState, setSeenIdsState] = useState<{
    loaded: boolean;
    badges: string[];
    rewards: string[];
    trainings: string[];
    history: string[];
  }>({
    loaded: false,
    badges: [],
    rewards: [],
    trainings: [],
    history: [],
  });
  const seenStorageKey = useMemo(
    () => `rewards_seen_dots_v1_${userId || employeeId || employeeCode || username || 'me'}`,
    [userId, employeeId, employeeCode, username],
  );
  const [isLoadingTrainings, setIsLoadingTrainings] = useState(false);
  const [trainingsError, setTrainingsError] = useState('');
  const [isLoadingBadges, setIsLoadingBadges] = useState(false);
  const [badgesError, setBadgesError] = useState('');
  const [walletStatus, setWalletStatus] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const statCardGap = 8;
  const rewardsCardWidth = Math.max(0, (width - spacing.md * 2 - statCardGap) / 2);
  const effectivePointsBalance = wallet.balance;

  const [comingSoonFeature, setComingSoonFeature] = useState<string | null>(null);

  const handleComingSoon = useCallback((featureTitle?: string) => {
    setComingSoonFeature(featureTitle || 'This feature');
  }, []);

  const refreshBadges = useCallback(async (forceRefresh = false) => {
    setIsLoadingBadges(true);
    try {
      const nextBadges = await loadEmployeeBadges(
        userId ?? undefined,
        employeeId ?? undefined,
        employeeCode ?? undefined,
        { forceRefresh },
      );
      setBadgesData(nextBadges);
      setBadgesError('');
    } catch (error) {
      setBadgesError(error instanceof Error ? error.message : 'Unable to load badges.');
    } finally {
      setIsLoadingBadges(false);
    }
  }, [userId, employeeId, employeeCode]);

  const refreshTrainings = useCallback(async (forceRefresh = false) => {
    setIsLoadingTrainings(true);
    try {
      const nextTrainings = await loadMyTrainings(
        userId ?? undefined,
        employeeId ?? undefined,
        employeeCode ?? undefined,
        { forceRefresh },
      );
      setTrainings(nextTrainings);
      setTrainingsError('');
    } catch (error) {
      setTrainingsError(error instanceof Error ? error.message : 'Unable to load trainings.');
    } finally {
      setIsLoadingTrainings(false);
    }
  }, [userId, employeeId, employeeCode]);

  const refreshWallet = useCallback(async (isPull = false) => {
    if (isPull) {
      setIsRefreshing(true);
    } else {
      setWallet((curr) => {
        if (curr.history.length === 0 && curr.totalEarned === 0 && curr.balance === 0) {
          setWalletStatus('Loading wallet...');
        }
        return curr;
      });
    }
    try {
      const [nextWallet, nextRedeemed, nextCatalog] = await Promise.all([
        loadRewardsWallet(userId ?? undefined, employeeId ?? undefined, { forceRefresh: isPull }),
        loadRedeemedRewards(userId ?? undefined, employeeId ?? undefined, { forceRefresh: isPull }).catch(
          () => [] as RedeemedRewardItem[],
        ),
        loadRewardsCatalog({ forceRefresh: isPull }).catch(() => [] as RewardCatalogItem[]),
        refreshBadges(isPull),
        refreshTrainings(isPull),
      ]);
      setWallet(nextWallet);
      setRedeemedRewards(nextRedeemed);
      setCatalogRewards(nextCatalog);
      onPointsUpdatedRef.current?.(nextWallet.balance);
      setWalletStatus('');
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : 'Unable to load HYG Wallet.');
    } finally {
      setIsRefreshing(false);
    }
  }, [userId, employeeId, refreshBadges, refreshTrainings]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  useEffect(() => {
    let isMounted = true;
    getCacheJSON<{
      badges?: string[];
      rewards?: string[];
      trainings?: string[];
      history?: string[];
    }>(seenStorageKey)
      .then((cached) => {
        if (!isMounted) return;
        setSeenIdsState({
          loaded: true,
          badges: Array.isArray(cached?.badges) ? cached.badges : [],
          rewards: Array.isArray(cached?.rewards) ? cached.rewards : [],
          trainings: Array.isArray(cached?.trainings) ? cached.trainings : [],
          history: Array.isArray(cached?.history) ? cached.history : [],
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setSeenIdsState((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      isMounted = false;
    };
  }, [seenStorageKey]);

  const availableRewardIds = useMemo(
    () =>
      catalogRewards
        .filter((r) => r.stocks > 0 && (r.status || 'active').toLowerCase() !== 'inactive')
        .map((r) => r.id),
    [catalogRewards],
  );

  const hasNewBadges = useMemo(() => {
    if (!seenIdsState.loaded || badgesData.earned.length === 0) return false;
    const seen = new Set(seenIdsState.badges);
    return badgesData.earned.some((b) => !seen.has(b.id));
  }, [seenIdsState.loaded, seenIdsState.badges, badgesData.earned]);

  const hasNewRewards = useMemo(() => {
    if (!seenIdsState.loaded || availableRewardIds.length === 0) return false;
    const seen = new Set(seenIdsState.rewards);
    return availableRewardIds.some((id) => !seen.has(id));
  }, [seenIdsState.loaded, seenIdsState.rewards, availableRewardIds]);

  const hasNewTrainings = useMemo(() => {
    if (!seenIdsState.loaded || trainings.length === 0) return false;
    const seen = new Set(seenIdsState.trainings);
    return trainings.some((t) => !seen.has(t.id));
  }, [seenIdsState.loaded, seenIdsState.trainings, trainings]);

  const hasNewHistory = useMemo(() => {
    if (!seenIdsState.loaded || wallet.history.length === 0) return false;
    const seen = new Set(seenIdsState.history);
    return wallet.history.some((h) => !seen.has(h.id));
  }, [seenIdsState.loaded, seenIdsState.history, wallet.history]);

  const markSectionSeen = useCallback(
    (section: 'badges' | 'rewards' | 'trainings' | 'history', ids: string[]) => {
      setSeenIdsState((prev) => {
        const merged = Array.from(new Set([...prev[section], ...ids]));
        const next = { ...prev, [section]: merged };
        void setCacheJSON(seenStorageKey, {
          badges: next.badges,
          rewards: next.rewards,
          trainings: next.trainings,
          history: next.history,
        }).catch(() => {});
        return next;
      });
    },
    [seenStorageKey],
  );

  useEffect(() => {
    setWallet((current) => {
      if (current.history.length === 0 && current.totalEarned === 0 && pointsBalance > 0) {
        return {
          ...current,
          balance: pointsBalance,
          totalEarned: pointsBalance,
        };
      }
      return current;
    });
  }, [pointsBalance]);

  const concludedTrainingsCount = useMemo(
    () => trainings.filter((t) => t.status.toLowerCase() === 'concluded').length,
    [trainings],
  );

  const handleConfirmTraining = useCallback(async (training: TrainingItem) => {
    try {
      await confirmTrainingAttendance(
        training.id,
        userId ?? undefined,
        employeeId ?? undefined,
        employeeCode ?? undefined,
      );
      setTrainings((prev) =>
        prev.map((t) => (t.id === training.id ? { ...t, isConfirmed: true } : t)),
      );
      onToast?.({
        tone: 'success',
        title: 'Attendance Confirmed',
        message: `Your attendance for "${training.title}" has been confirmed.`,
      });
    } catch (error) {
      onToast?.({
        tone: 'error',
        title: 'Confirmation Failed',
        message: error instanceof Error ? error.message : 'Unable to confirm training attendance.',
      });
    }
  }, [userId, employeeId, employeeCode, onToast]);

  if (showTrainings) {
    return (
      <TrainingsScreen
        trainings={trainings}
        isLoading={isLoadingTrainings}
        isRefreshing={isRefreshing}
        errorMessage={trainingsError}
        onRefresh={() => void refreshWallet(true)}
        onConfirmTraining={handleConfirmTraining}
        onBack={() => setShowTrainings(false)}
        profileName={profileName}
        username={username}
        profilePhotoUrl={profilePhotoUrl}
        pointsBalance={effectivePointsBalance}
        notificationCount={notificationCount}
        onAssistant={onAssistant}
        onNotifications={onNotifications}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
    );
  }

  if (showRewardsCatalog) {
    return (
      <RewardsCatalogScreen
        userId={userId}
        employeeId={employeeId}
        onBack={() => {
          setShowRewardsCatalog(false);
          void loadRedeemedRewards(userId ?? undefined, employeeId ?? undefined)
            .then(setRedeemedRewards)
            .catch(() => { });
        }}
        profileName={profileName}
        username={username}
        profilePhotoUrl={profilePhotoUrl}
        pointsBalance={effectivePointsBalance}
        notificationCount={notificationCount}
        onAssistant={onAssistant}
        onNotifications={onNotifications}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onPointsUpdated={(newBalance) => {
          setWallet((curr) => ({ ...curr, balance: newBalance }));
          onPointsUpdatedRef.current?.(newBalance);
          void loadRedeemedRewards(userId ?? undefined, employeeId ?? undefined)
            .then(setRedeemedRewards)
            .catch(() => { });
        }}
        onToast={onToast}
        onSignOut={onSignOut}
      />
    );
  }

  if (showBadges) {
    return (
      <BadgesScreen
        badgesData={badgesData}
        isLoading={isLoadingBadges}
        isRefreshing={isRefreshing}
        errorMessage={badgesError}
        onRefresh={() => void refreshWallet(true)}
        onBack={() => setShowBadges(false)}
        profileName={profileName}
        username={username}
        profilePhotoUrl={profilePhotoUrl}
        employeeId={employeeId}
        positionName={positionName}
        departmentName={departmentName}
        authorityLevel={authorityLevel}
        pointsBalance={effectivePointsBalance}
        onToast={onToast}
        notificationCount={notificationCount}
        onAssistant={onAssistant}
        onNotifications={onNotifications}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
    );
  }

  if (showWalletHistory) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <TopBar
          name={profileName || 'Rewards'}
          username={username}
          photoUrl={profilePhotoUrl}
          pointsBalance={effectivePointsBalance}
          notificationCount={notificationCount}
          onMessages={onAssistant}
          onNotifications={onNotifications}
          onBackHome={() => setShowWalletHistory(false)}
          onOpenProfile={onOpenProfile}
          onOpenSettings={onOpenSettings}
          onOpenMyTeam={onOpenMyTeam}
          onSignOut={onSignOut}
        />
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: getScreenBottomPadding(insets.bottom, true, 28) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refreshWallet(true)}
              colors={[colors.brand.gold]}
              tintColor={colors.brand.gold}
            />
          }
        >
          <View style={styles.rewardsHistoryHeader}>
            <Image source={hygCoinsImage} style={styles.rewardsHistoryIcon} resizeMode="contain" />
            <View>
              <Text style={styles.rewardsHistoryTitle}>HYG Wallet History</Text>
              <Text style={styles.rewardsHistorySub}>Points earned and deducted</Text>
            </View>
          </View>

          {wallet.history.length ? (
            wallet.history.map((item) => (
              <View key={item.id} style={styles.rewardsHistoryRow}>
                <View style={[styles.rewardsHistorySign, getRewardsHistorySignStyle(item)]}>
                  <Text style={styles.rewardsHistorySignText}>{getRewardsHistorySign(item)}</Text>
                </View>
                <View style={styles.rewardsHistoryText}>
                  <Text style={styles.rewardsHistorySource}>{item.source}</Text>
                  <Text style={styles.rewardsHistoryDate}>{formatRewardsHistoryDate(item.date)}</Text>
                </View>
                <Text style={[styles.rewardsHistoryAmount, getRewardsHistoryAmountStyle(item)]}>
                  {getRewardsHistoryAmountPrefix(item)}
                  {formatRewardsPoints(item.points)}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.rewardsHistoryRow}>
              <View style={[styles.rewardsHistorySign, styles.rewardsHistorySignMinus]}>
                <Text style={styles.rewardsHistorySignText}>0</Text>
              </View>
              <View style={styles.rewardsHistoryText}>
                <Text style={styles.rewardsHistorySource}>No wallet history yet</Text>
                <Text style={styles.rewardsHistoryDate}>Claim HYG Points to start your history.</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        showNetworkStatus
        name={profileName || 'Rewards'}
        username={username}
        photoUrl={profilePhotoUrl}
        pointsBalance={effectivePointsBalance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onHelpTutorials={onHelpTutorials}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: getScreenBottomPadding(insets.bottom, true, 28) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void refreshWallet(true)}
            colors={[colors.brand.gold]}
            tintColor={colors.brand.gold}
          />
        }
      >
        {/* Barcode card hidden for the meantime */}
        {false && (
          <View style={styles.rewardsBarcodeCard}>
            <Text style={styles.rewardsBarcodeHint}>Scan to earn HYG Points</Text>
            <Text style={styles.rewardsBarcodeSub}>Present this barcode at any HYG partner location</Text>
            <View style={styles.rewardsBarcodeFrame}>
              <RewardsBarcode digits={barcodeDigits} />
              <Text style={styles.rewardsBarcodeText} numberOfLines={1}>
                {barcodeDigits.split('').join(' ')}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.rewardsStatsGrid}>
          <View style={styles.rewardsStatsRow}>
            <RewardsStatCard
              gradientId="rewards-stat-grad-points"
              width={rewardsCardWidth}
              value={formatRewardsPoints(effectivePointsBalance)}
              title="Available Points"
              subtitle="total redeemable points"
              icon={<Coins size={22} color="#ffffff" strokeWidth={2.2} />}
              watermark={<Coins size={68} color="#ffffff" strokeWidth={1.6} />}
            />
            <RewardsStatCard
              gradientId="rewards-stat-grad-redeemed"
              width={rewardsCardWidth}
              value={formatRewardsPoints(wallet.totalRedeemed)}
              title="Points Redeemed"
              subtitle="total points spent on rewards"
              icon={<Gift size={22} color="#ffffff" strokeWidth={2.2} />}
              watermark={<Gift size={68} color="#ffffff" strokeWidth={1.6} />}
            />
          </View>
          <View style={styles.rewardsStatsRow}>
            <RewardsStatCard
              gradientId="rewards-stat-grad-badges"
              width={rewardsCardWidth}
              value={formatRewardsPoints(badgesData.earned.length)}
              title="Badges Earned"
              subtitle="achievements unlocked"
              icon={<BadgeCheck size={22} color="#ffffff" strokeWidth={2.2} />}
              watermark={<BadgeCheck size={68} color="#ffffff" strokeWidth={1.6} />}
            />
            <RewardsStatCard
              gradientId="rewards-stat-grad-trainings"
              width={rewardsCardWidth}
              value={String(concludedTrainingsCount)}
              title="Trainings Attended"
              subtitle="completed learning activities"
              icon={<GraduationCap size={22} color="#ffffff" strokeWidth={2.2} />}
              watermark={<GraduationCap size={68} color="#ffffff" strokeWidth={1.6} />}
            />
          </View>
        </View>

        {walletStatus ? (
          <Text style={styles.rewardsWalletStatusNotice} numberOfLines={1}>
            {walletStatus}
          </Text>
        ) : null}

        <View style={styles.rewardsActionRow}>
          <RewardsActionButton
            label="Badges"
            icon={<BadgeCheck size={16} color="#2563eb" strokeWidth={2.4} />}
            showDot={hasNewBadges}
            onPress={() => {
              markSectionSeen('badges', badgesData.earned.map((b) => b.id));
              setShowBadges(true);
            }}
          />
          <RewardsActionButton
            label="Rewards"
            icon={<Gift size={16} color="#16a34a" strokeWidth={2.4} />}
            showDot={hasNewRewards}
            onPress={() => {
              markSectionSeen('rewards', availableRewardIds);
              setShowRewardsCatalog(true);
            }}
          />
          <RewardsActionButton
            label="Trainings"
            icon={<CalendarDays size={16} color="#dc2626" strokeWidth={2.4} />}
            showDot={hasNewTrainings}
            onPress={() => {
              markSectionSeen('trainings', trainings.map((t) => t.id));
              setShowTrainings(true);
            }}
          />
          <RewardsActionButton
            label="History"
            icon={<History size={16} color="#f59e0b" strokeWidth={2.4} />}
            showDot={hasNewHistory}
            onPress={() => {
              markSectionSeen('history', wallet.history.map((h) => h.id));
              setShowWalletHistory(true);
            }}
          />
        </View>

        <RecentBadgesCard earnedBadges={badgesData.earned} />

        <RedeemedRewardsCard redeemedRewards={redeemedRewards} />

        <AttendedTrainingsCard trainings={trainings} />
      </ScrollView>

      <Modal
        visible={comingSoonFeature !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setComingSoonFeature(null)}
      >
        <View style={styles.rewardsModalBackdrop}>
          <Pressable style={styles.rewardsModalDismissArea} onPress={() => setComingSoonFeature(null)} />
          <View style={styles.rewardsModalCard}>
            <Pressable
              style={styles.rewardsModalCloseBtn}
              onPress={() => setComingSoonFeature(null)}
              hitSlop={12}
            >
              <X size={18} color="#94a3b8" />
            </Pressable>

            <View style={styles.rewardsModalIconWrapper}>
              <View style={styles.rewardsModalIconOuterRing}>
                <View style={styles.rewardsModalIconInnerCircle}>
                  <Gift size={24} color="#ca8a04" strokeWidth={2.4} />
                </View>
              </View>
            </View>

            <View style={styles.rewardsModalBadge}>
              <Text style={styles.rewardsModalBadgeText}>COMING SOON</Text>
            </View>

            <Text style={styles.rewardsModalTitle}>Coming Soon.</Text>
            <Text style={styles.rewardsModalSub}>
              {comingSoonFeature
                ? `${comingSoonFeature} is currently under development and will be available soon.`
                : 'This feature will be available soon.'}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.rewardsModalActionBtn,
                pressed ? styles.rewardsModalActionBtnPressed : null,
              ]}
              onPress={() => setComingSoonFeature(null)}
            >
              <Text style={styles.rewardsModalActionBtnText}>Got It</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export { RewardsTabScreen as RewardsPlaceholderScreen };

function RewardsStatCard({
  gradientId,
  width,
  value,
  title,
  subtitle,
  icon,
  watermark,
}: {
  gradientId: string;
  width: number;
  value: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  watermark?: React.ReactNode;
}) {
  return (
    <View style={[styles.rewardsStatCard, { width }]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={gradientId} x1="100%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#102c4f" />
              <Stop offset="55%" stopColor="#091c36" />
              <Stop offset="100%" stopColor="#040d1a" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill={`url(#${gradientId})`} />
        </Svg>
      </View>
      {watermark ? <View style={styles.rewardsStatWatermark}>{watermark}</View> : null}
      <View style={styles.rewardsStatContent}>
        <View style={styles.rewardsStatTopRow}>
          <Text
            style={styles.rewardsStatValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
          >
            {value}
          </Text>
          <View style={styles.rewardsStatIconBox}>{icon}</View>
        </View>
        <View style={styles.rewardsStatBottom}>
          <Text style={styles.rewardsStatTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {title}
          </Text>
          <Text style={styles.rewardsStatSubtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {subtitle}
          </Text>
        </View>
      </View>
    </View>
  );
}

function RewardsActionButton({
  label,
  icon,
  showDot = false,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  showDot?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.rewardsActionBtn,
        pressed ? styles.rewardsActionBtnPressed : null,
      ]}
      onPress={onPress}
    >
      {icon}
      <Text style={styles.rewardsActionBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {label}
      </Text>
      {showDot ? <View style={styles.rewardsActionDot} /> : null}
    </Pressable>
  );
}

const RewardsBarcode = memo(function RewardsBarcode({ digits }: { digits: string }) {
  const pattern = useMemo(() => getEan13Pattern(digits), [digits]);

  return (
    <View style={styles.barcodeBars}>
      {pattern.split('').map((bit, index) => (
        <View key={`${index}-${bit}`} style={[styles.barcodeBar, bit === '1' ? styles.barcodeBarFilled : null]} />
      ))}
    </View>
  );
});

function makeEan13Digits(seed: string) {
  const numeric = seed.replace(/\D/g, '');
  const hashDigits = stableHash(seed).toString().padStart(12, '0');
  const base = (numeric || hashDigits).padStart(12, '0').slice(-12);
  return `${base}${getEan13Checksum(base)}`;
}

function getEan13Checksum(base12: string) {
  const sum = base12
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

const EAN13_LEFT_ODD: Record<string, string> = {
  '0': '0001101',
  '1': '0011001',
  '2': '0010011',
  '3': '0111101',
  '4': '0100011',
  '5': '0110001',
  '6': '0101111',
  '7': '0110011',
  '8': '0110111',
  '9': '0001011',
};

const EAN13_LEFT_EVEN: Record<string, string> = {
  '0': '0100111',
  '1': '0110011',
  '2': '0011011',
  '3': '0100001',
  '4': '0011101',
  '5': '0111001',
  '6': '0000101',
  '7': '0010001',
  '8': '0001001',
  '9': '0010111',
};

const EAN13_RIGHT: Record<string, string> = {
  '0': '1110010',
  '1': '1100110',
  '2': '1101100',
  '3': '1000010',
  '4': '1011100',
  '5': '1001110',
  '6': '1010000',
  '7': '1000100',
  '8': '1001000',
  '9': '1110100',
};

const EAN13_PARITY: Record<string, string> = {
  '0': 'OOOOOO',
  '1': 'OOEOEE',
  '2': 'OOEEOE',
  '3': 'OOEEEO',
  '4': 'OEOOEE',
  '5': 'OEEOOE',
  '6': 'OEEEOO',
  '7': 'OEOEOE',
  '8': 'OEOEEO',
  '9': 'OEEOEO',
};

function getEan13Pattern(digits: string) {
  const first = digits[0] ?? '0';
  const parity = EAN13_PARITY[first] ?? EAN13_PARITY['0'];
  const left = digits
    .slice(1, 7)
    .split('')
    .map((digit, index) => (parity[index] === 'E' ? EAN13_LEFT_EVEN[digit] : EAN13_LEFT_ODD[digit]))
    .join('');
  const right = digits
    .slice(7)
    .split('')
    .map((digit) => EAN13_RIGHT[digit])
    .join('');
  return `101${left}01010${right}101`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 10_000_000_000);
}

function formatRewardsPoints(value: number) {
  return Number(value ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function formatRewardsHistoryDate(date: string) {
  return new Date(date).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getRewardsHistorySign(item: RewardsWalletHistoryItem) {
  if (item.type === 'earned') return '+';
  if (item.type === 'pending') return '...';
  return '-';
}

function getRewardsHistoryAmountPrefix(item: RewardsWalletHistoryItem) {
  if (item.type === 'earned') return '+';
  if (item.type === 'pending') return '';
  return '-';
}

function getRewardsHistorySignStyle(item: RewardsWalletHistoryItem) {
  return item.type === 'earned' || item.type === 'pending'
    ? styles.rewardsHistorySignAdd
    : styles.rewardsHistorySignMinus;
}

function getRewardsHistoryAmountStyle(item: RewardsWalletHistoryItem) {
  return item.type === 'earned' || item.type === 'pending'
    ? styles.rewardsHistoryAmountAdd
    : styles.rewardsHistoryAmountMinus;
}

function RecentBadgesCard({
  earnedBadges,
}: {
  earnedBadges: EarnedBadgeItem[];
}) {
  const recentBadges = useMemo(() => {
    return [...earnedBadges]
      .sort((a, b) => {
        const ta = new Date(a.awardedAt).getTime();
        const tb = new Date(b.awardedAt).getTime();
        return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
      })
      .slice(0, 3);
  }, [earnedBadges]);

  return (
    <View style={styles.recentBadgesCard}>
      <View style={styles.recentBadgesHeader}>
        <View style={styles.recentBadgesHeaderText}>
          <Text style={styles.recentBadgesTitle}>Earned Badges</Text>
          <Text style={styles.recentBadgesSubtitle}>Recently earned and unlocked badges</Text>
        </View>
        <BadgeCheck size={24} color="#2563eb" strokeWidth={2.2} />
      </View>

      {recentBadges.length > 0 ? (
        <View style={styles.recentBadgesList}>
          {recentBadges.map((item) => {
            const isImageUrl = Boolean(
              item.customImagePath &&
              (item.customImagePath.startsWith('http://') ||
                item.customImagePath.startsWith('https://') ||
                item.customImagePath.startsWith('data:image/')),
            );
            const { dateText, timeText } = formatRecentBadgeDateTime(item.awardedAt);

            return (
              <View key={item.id} style={styles.recentBadgeRow}>
                <View style={styles.recentBadgeLeft}>
                  <View style={styles.recentBadgeIconWrap}>
                    {isImageUrl && item.customImagePath ? (
                      <Image
                        source={{ uri: item.customImagePath }}
                        style={styles.recentBadgeImage}
                        resizeMode="contain"
                      />
                    ) : (
                      renderRecentBadgeIcon(
                        item.iconData,
                        item.iconColor?.trim() || '#d97706',
                      )
                    )}
                  </View>
                  <View style={styles.recentBadgeInfo}>
                    <Text style={styles.recentBadgeTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {dateText ? (
                      <View style={styles.recentBadgeMetaRow}>
                        <CalendarDays size={12} color={colors.muted} strokeWidth={2} />
                        <Text style={styles.recentBadgeMetaText}>{dateText}</Text>
                      </View>
                    ) : null}
                    {timeText ? (
                      <View style={styles.recentBadgeMetaRow}>
                        <Clock3 size={12} color={colors.muted} strokeWidth={2} />
                        <Text style={styles.recentBadgeMetaText}>{timeText}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {item.pointsAwarded > 0 ? (
                  <Text style={styles.recentBadgePoints}>+{item.pointsAwarded} Points</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.recentBadgesEmpty}>
          <Text style={styles.recentBadgesEmptyText}>No badges earned yet.</Text>
        </View>
      )}
    </View>
  );
}

function renderRecentBadgeIcon(iconData: string, color: string) {
  const size = 28;
  const strokeWidth = 2.2;
  switch (iconData) {
    case 'emoji_events':
      return <Trophy size={size} color={color} strokeWidth={strokeWidth} />;
    case 'rocket_launch':
      return <Rocket size={size} color={color} strokeWidth={strokeWidth} />;
    case 'menu_book':
      return <BookOpen size={size} color={color} strokeWidth={strokeWidth} />;
    case 'workspace_premium':
      return <Award size={size} color={color} strokeWidth={strokeWidth} />;
    case 'favorite':
      return <Heart size={size} color={color} strokeWidth={strokeWidth} />;
    case 'verified':
      return <BadgeCheck size={size} color={color} strokeWidth={strokeWidth} />;
    case 'lightbulb_outline':
      return <Lightbulb size={size} color={color} strokeWidth={strokeWidth} />;
    case 'star':
    default:
      return <Star size={size} color={color} strokeWidth={strokeWidth} />;
  }
}

function formatRecentBadgeDateTime(dateStr: string): { dateText: string; timeText: string } {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return { dateText: '', timeText: '' };
  }
  const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  const month = monthNames[date.getMonth()] || '';
  const day = date.getDate();
  const year = date.getFullYear();
  const timeText = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return {
    dateText: `${month} ${day}, ${year}`,
    timeText,
  };
}

function RedeemedRewardsCard({
  redeemedRewards,
}: {
  redeemedRewards: RedeemedRewardItem[];
}) {
  const featured = useMemo(() => {
    return [...redeemedRewards]
      .sort((a, b) => {
        const ta = new Date(a.redeemedAt).getTime();
        const tb = new Date(b.redeemedAt).getTime();
        return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
      })
      .slice(0, 5);
  }, [redeemedRewards]);

  return (
    <View style={styles.recentBadgesCard}>
      <View style={styles.recentBadgesHeader}>
        <View style={styles.recentBadgesHeaderText}>
          <Text style={styles.recentBadgesTitle}>Redeemed Rewards</Text>
          <Text style={styles.recentBadgesSubtitle}>Recently redeemed rewards using points</Text>
        </View>
        <Gift size={24} color="#16a34a" strokeWidth={2.2} />
      </View>

      {featured.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.redeemedCarouselContent}
          style={styles.redeemedCarousel}
        >
          {featured.map((item) => {
            const isImageUrl = Boolean(
              item.imageUrl &&
              (item.imageUrl.startsWith('http://') ||
                item.imageUrl.startsWith('https://') ||
                item.imageUrl.startsWith('data:image/')),
            );
            const { dateText, timeText } = formatRecentBadgeDateTime(item.redeemedAt);

            return (
              <View key={item.id} style={styles.redeemedRewardItemCard}>
                <View style={styles.redeemedRewardThumbBox}>
                  {isImageUrl && item.imageUrl ? (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.redeemedRewardThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <Gift size={24} color="#16a34a" strokeWidth={2} />
                  )}
                </View>

                <View style={styles.redeemedRewardInfo}>
                  <Text style={styles.redeemedRewardTitle} numberOfLines={1}>
                    {item.rewardName}
                  </Text>
                  <View style={styles.redeemedRewardCategoryPill}>
                    <Text style={styles.redeemedRewardCategoryText} numberOfLines={1}>
                      {(item.category || 'General').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.redeemedRewardDateTimeRow}>
                    {dateText ? (
                      <View style={styles.redeemedRewardMetaPair}>
                        <CalendarDays size={11} color={colors.muted} strokeWidth={2} />
                        <Text style={styles.redeemedRewardMetaText}>{dateText}</Text>
                      </View>
                    ) : null}
                    {timeText ? (
                      <View style={styles.redeemedRewardMetaPair}>
                        <Clock3 size={11} color={colors.muted} strokeWidth={2} />
                        <Text style={styles.redeemedRewardMetaText}>{timeText}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.redeemedRewardPoints}>
                    {item.pointsCost.toLocaleString()} Points
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.recentBadgesEmpty}>
          <Text style={styles.recentBadgesEmptyText}>No redeemed rewards yet.</Text>
        </View>
      )}
    </View>
  );
}

function AttendedTrainingsCard({
  trainings,
}: {
  trainings: TrainingItem[];
}) {
  const attended = useMemo(() => {
    return trainings
      .filter((t) => t.status.toLowerCase() === 'concluded')
      .sort((a, b) => b.trainingDate.localeCompare(a.trainingDate))
      .slice(0, 3);
  }, [trainings]);

  return (
    <View style={styles.recentBadgesCard}>
      <View style={styles.recentBadgesHeader}>
        <View style={styles.recentBadgesHeaderText}>
          <Text style={styles.recentBadgesTitle}>Attended Trainings</Text>
          <Text style={styles.recentBadgesSubtitle}>Completed learning activities and sessions</Text>
        </View>
        <GraduationCap size={24} color="#dc2626" strokeWidth={2.2} />
      </View>

      {attended.length > 0 ? (
        <View style={styles.recentBadgesList}>
          {attended.map((item) => {
            const { dateText } = formatRecentBadgeDateTime(
              item.trainingDate ? `${item.trainingDate}T00:00:00` : '',
            );

            return (
              <View key={item.id} style={styles.recentBadgeRow}>
                <View style={styles.recentBadgeLeft}>
                  <View style={styles.recentBadgeInfo}>
                    <Text style={styles.recentBadgeTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {dateText ? (
                      <View style={styles.recentBadgeMetaRow}>
                        <CalendarDays size={12} color={colors.muted} strokeWidth={2} />
                        <Text style={styles.recentBadgeMetaText}>{dateText}</Text>
                      </View>
                    ) : null}
                    {item.location ? (
                      <View style={styles.recentBadgeMetaRow}>
                        <MapPin size={12} color={colors.muted} strokeWidth={2} />
                        <Text style={styles.recentBadgeMetaText} numberOfLines={1}>
                          {item.location}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {item.badgePoints > 0 ? (
                  <Text style={styles.recentBadgePoints}>+{item.badgePoints} Points</Text>
                ) : (
                  <View style={styles.attendedStatusPill}>
                    <Text style={styles.attendedStatusText}>Completed</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.recentBadgesEmpty}>
          <Text style={styles.recentBadgesEmptyText}>No attended trainings yet.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.md,
  },
  rewardsStatsGrid: {
    gap: 6,
    marginBottom: spacing.sm,
  },
  rewardsStatsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  rewardsStatCard: {
    backgroundColor: '#081a33',
    borderRadius: 12,
    minHeight: 96,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#102c4f',
  },
  rewardsStatContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  rewardsStatWatermark: {
    position: 'absolute',
    right: -8,
    bottom: -10,
    opacity: 0.09,
  },
  rewardsStatTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  rewardsStatValue: {
    flex: 1,
    color: colors.surface,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
  },
  rewardsStatIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsStatBottom: {
    marginTop: 4,
  },
  rewardsStatTitle: {
    color: colors.surface,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  rewardsStatSubtitle: {
    color: '#cbd5e1',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    marginTop: 1,
  },
  rewardsWalletStatusNotice: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  rewardsActionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  rewardsActionBtn: {
    position: 'relative',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  rewardsActionDot: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  rewardsActionBtnPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  rewardsActionBtnText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  rewardsBarcodeCard: {
    borderRadius: 8,
    backgroundColor: colors.brand.ink,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#102a4c',
  },
  rewardsBarcodeHint: {
    color: colors.surface,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  rewardsBarcodeSub: {
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  rewardsBarcodeFrame: {
    width: '100%',
    minHeight: 104,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rewardsBarcodeText: {
    color: '#020617',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  barcodeBars: {
    width: '100%',
    height: 62,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  barcodeBar: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  barcodeBarFilled: {
    backgroundColor: '#020617',
  },
  rewardsBalanceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rewardsPointsCard: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  rewardsPointsHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  rewardsPointsHeaderLeft: {
    flex: 1,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  rewardsCoinIcon: {
    width: 48,
    height: 48,
  },
  rewardsPointsTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  rewardsPointsTitle: {
    color: colors.brand.ink,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  rewardsPointsBody: {
    minHeight: 166,
    justifyContent: 'space-between',
    padding: spacing.sm,
    position: 'relative',
  },
  rewardsConversion: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    marginTop: 1,
  },
  rewardsPointsWatermark: {
    position: 'absolute',
    right: -18,
    top: 34,
    width: 112,
    height: 112,
    opacity: 0.14,
  },
  rewardsPointsLabel: {
    color: colors.brand.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  rewardsPointsValue: {
    color: colors.brand.ink,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    marginTop: 2,
  },
  rewardsPointsUnit: {
    color: colors.brand.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  rewardsPointsAction: {
    borderRadius: 999,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    zIndex: 2,
  },
  rewardsPointsActionPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  rewardsPointsActionText: {
    color: colors.surface,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  rewardsWalletCard: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.brand.ink,
    borderWidth: 1,
    borderColor: '#102a4c',
  },
  rewardsWalletHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f233d',
    borderBottomWidth: 1,
    borderBottomColor: '#102a4c',
  },
  rewardsWalletHeaderLeft: {
    flex: 1,
    minWidth: 0,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  rewardsWalletCoin: {
    width: 48,
    height: 48,
  },
  rewardsWalletTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.surface,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  rewardsWalletBody: {
    minHeight: 166,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  rewardsWalletStats: {
    gap: spacing.xs,
  },
  rewardsWalletStatItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    paddingBottom: spacing.xs,
  },
  rewardsWalletLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  rewardsWalletValue: {
    color: colors.surface,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    marginTop: 2,
  },
  rewardsWalletStatusSlot: {
    minHeight: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
  },
  rewardsWalletStatus: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  rewardsWalletHistoryButton: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.brand.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
  },
  rewardsWalletHistoryButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  rewardsWalletHistoryButtonText: {
    color: colors.brand.gold,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  rewardsHistoryHeader: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rewardsHistoryIcon: {
    width: 50,
    height: 50,
  },
  rewardsHistoryTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  rewardsHistorySub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  rewardsHistoryRow: {
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rewardsHistorySign: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsHistorySignAdd: {
    backgroundColor: '#dcfce7',
  },
  rewardsHistorySignMinus: {
    backgroundColor: '#fee2e2',
  },
  rewardsHistorySignText: {
    color: colors.brand.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
  },
  rewardsHistoryText: {
    flex: 1,
    minWidth: 0,
  },
  rewardsHistorySource: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  rewardsHistoryDate: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  rewardsHistoryAmount: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  rewardsHistoryAmountAdd: {
    color: '#16a34a',
  },
  rewardsHistoryAmountMinus: {
    color: '#dc2626',
  },
  rewardsServiceGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rewardsServiceTile: {
    flex: 1,
    minHeight: 124,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    padding: spacing.sm,
  },
  rewardsServiceTilePressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  rewardsServiceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  rewardsServiceCoin: {
    width: 28,
    height: 28,
  },
  rewardsServiceTitle: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  rewardsServiceText: {
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  rewardsPromoStrip: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: colors.brand.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  rewardsPromoCoins: {
    width: 44,
    height: 44,
  },
  rewardsPromoTitle: {
    color: colors.brand.gold,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  rewardsPromoText: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  rewardsModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  rewardsModalDismissArea: {
    ...StyleSheet.absoluteFill,
  },
  rewardsModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rewardsModalCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsModalIconWrapper: {
    marginBottom: spacing.sm,
  },
  rewardsModalIconOuterRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fde68a',
  },
  rewardsModalIconInnerCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fde047',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsModalBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: spacing.xs,
  },
  rewardsModalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#854d0e',
    letterSpacing: 0.5,
  },
  rewardsModalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.brand.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  rewardsModalSub: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  rewardsModalActionBtn: {
    width: '100%',
    minHeight: 44,
    backgroundColor: colors.brand.gold,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsModalActionBtnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  rewardsModalActionBtnText: {
    color: colors.brand.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  recentBadgesCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  recentBadgesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recentBadgesHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  recentBadgesTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  recentBadgesSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    marginTop: 2,
  },
  recentBadgesList: {
    marginTop: spacing.sm + 4,
    gap: 10,
  },
  recentBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  recentBadgeRowPressed: {
    backgroundColor: '#f8fafc',
  },
  recentBadgeLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recentBadgeIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  recentBadgeImage: {
    width: 38,
    height: 38,
  },
  recentBadgeInfo: {
    flex: 1,
    minWidth: 0,
  },
  recentBadgeTitle: {
    color: colors.text,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
    marginBottom: 2,
  },
  recentBadgeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  recentBadgeMetaText: {
    color: colors.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '500',
  },
  recentBadgePoints: {
    color: '#16a34a',
    fontSize: 14.5,
    fontWeight: '800',
  },
  recentBadgesEmpty: {
    marginTop: spacing.sm + 4,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  recentBadgesEmptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
  },
  redeemedCarousel: {
    marginTop: spacing.sm + 4,
  },
  redeemedCarouselContent: {
    gap: 10,
  },
  redeemedRewardItemCard: {
    width: 248,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 11,
  },
  redeemedRewardThumbBox: {
    width: 54,
    height: 54,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  redeemedRewardThumb: {
    width: 54,
    height: 54,
  },
  redeemedRewardInfo: {
    flex: 1,
    minWidth: 0,
  },
  redeemedRewardTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  redeemedRewardCategoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    marginTop: 3,
  },
  redeemedRewardCategoryText: {
    color: '#1d4ed8',
    fontSize: 9.5,
    fontWeight: '800',
  },
  redeemedRewardDateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 4,
  },
  redeemedRewardMetaPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  redeemedRewardMetaText: {
    color: colors.muted,
    fontSize: 10.5,
    fontWeight: '500',
  },
  redeemedRewardPoints: {
    color: colors.text,
    fontSize: 12.5,
    fontWeight: '800',
    marginTop: 3,
  },
  attendedStatusPill: {
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  attendedStatusText: {
    color: '#15803d',
    fontSize: 11,
    fontWeight: '800',
  },
});
