import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { getScreenBottomPadding } from '../utils/safeArea';
import {
  ArrowRight,
  BadgePercent,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  ListChecks,
  Tag,
  UserCheck,
} from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { TopBar } from '../components/TopBar';
import { BirthdayGreetingModal } from '../components/BirthdayGreetingModal';
import { BalanceHistoryPage } from '../components/BalanceHistoryModal';
import { DashboardFab } from '../components/DashboardFab';
import type { DashboardSummary } from '../services/dashboard';
import { loadPerkUsage, type PerkUsage } from '../services/perks';
import { loadMyRequests, type MyRequest } from '../services/requests';
import { syncAllOfflineItems } from '../services/offlineQueue';
import { isAppOnline } from '../services/network';
import { loadActiveEventsActivities } from '../services/eventsActivities';
import { addAppNotification } from '../services/notificationCenter';
import {
  checkBirthdayLeaveAppliedForYear,
  ensureBirthdayLeaveGrant,
  hasBirthdayModalBeenShownForYear,
  isAutoApprovedBirthdayGrant,
  markBirthdayModalShownForYear,
} from '../services/birthdayLeave';
import { formatUnifiedRequestType } from '../components/EsarfDetailsView';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { formatDateInput, hasCompletedOneYearOfService } from '../utils/dateTime';
import { isScheduledOtRequest } from '../utils/scheduledOt';
import { supabase } from '../lib/supabase';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type Props = {
  userEmail: string;
  summary: DashboardSummary;
  profileResult: ProfileLoadResult | null;
  onRefreshDashboard: () => void;
  onRefreshProfile: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onOpenRewards?: () => void;
  onSignOut?: () => void | Promise<void>;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onHelpTutorials?: () => void;
  onApplyEsarf?: () => void;
  onApplyPreApprovedOtOffset?: () => void;
  onRequestLeave?: () => void;
  onApplyPerks?: () => void;
  onFileTravelOrder?: () => void;
  onPhotoProof?: () => void;
  onPhotoLog?: () => void;
  onActivityLog?: () => void;
  onBirthdayGreetingClosed?: () => void;
  hideFab?: boolean;
};

export function DashboardScreen({
  userEmail,
  summary,
  profileResult,
  onRefreshDashboard,
  onRefreshProfile,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onOpenRewards,
  onSignOut,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onHelpTutorials,
  onApplyEsarf,
  onApplyPreApprovedOtOffset,
  onRequestLeave,
  onApplyPerks,
  onFileTravelOrder,
  onPhotoProof,
  onPhotoLog,
  onActivityLog,
  onBirthdayGreetingClosed,
  hideFab = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const [perkUsage, setPerkUsage] = useState<PerkUsage | null>(null);
  const [recentRequests, setRecentRequests] = useState<MyRequest[]>([]);
  const [showBirthdayModal, setShowBirthdayModal] = useState(false);
  const [isBirthdayLeaveClaimed, setIsBirthdayLeaveClaimed] = useState(false);
  const [isClaimingBirthdayLeave, setIsClaimingBirthdayLeave] = useState(false);
  const [hasCompletedOneYearService, setHasCompletedOneYearService] = useState(true);
  const [balanceHistoryVisible, setBalanceHistoryVisible] = useState(false);
  const [balanceHistoryTab, setBalanceHistoryTab] = useState<'offset' | 'leave'>('offset');
  const { width } = useWindowDimensions();
  const isCompactDashboard = width < 390;

  const handleOpenOffsetHistory = () => {
    setBalanceHistoryTab('offset');
    setBalanceHistoryVisible(true);
  };

  const handleOpenLeaveHistory = () => {
    setBalanceHistoryTab('leave');
    setBalanceHistoryVisible(true);
  };

  const refreshSupplemental = async () => {
    try {
      const [usage, requests] = await Promise.all([
        loadPerkUsage(),
        loadMyRequests(false),
        loadActiveEventsActivities().catch(() => []),
      ]);
      if (usage) {
        setPerkUsage(usage);
      }
      if (requests && requests.length > 0) {
        setRecentRequests(requests);
      }
    } catch (err) {
      console.log('[Dashboard] Supplemental fetch offline, keeping existing state:', err);
    }
  };

  const refreshDashboard = () => {
    onRefreshDashboard();
    onRefreshProfile();
    void refreshSupplemental();
  };

  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const handlePullRefresh = async () => {
    setIsPullRefreshing(true);
    try {
      if (isAppOnline()) {
        await syncAllOfflineItems().catch(() => { });
      }
      await Promise.allSettled([
        Promise.resolve(onRefreshDashboard()),
        Promise.resolve(onRefreshProfile()),
        refreshSupplemental(),
      ]);
    } finally {
      setIsPullRefreshing(false);
    }
  };

  useEffect(() => {
    // 1. Immediately hydrate from SQLite cache so data appears instantly even offline
    void (async () => {
      try {
        const [cachedRequests, cachedPerks] = await Promise.all([
          getCacheJSON<MyRequest[]>('my_requests_v1'),
          getCacheJSON<PerkUsage>('my_perk_usage_v1'),
        ]);
        if (cachedRequests && cachedRequests.length > 0) {
          setRecentRequests(cachedRequests);
        }
        if (cachedPerks) {
          setPerkUsage(cachedPerks);
        }
      } catch {
        // ignore
      }
    })();

    // 2. Fetch fresh updates
    refreshDashboard();

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshSupplemental();
      }
    });

    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    void refreshSupplemental();
  }, [summary]);

  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;
  const employeeName = formatHomeEmployeeName(profile, userEmail);
  const photoUrl = profile?.photoUrl ?? null;
  const orgUnit = profile?.departmentName || profile?.storeName || 'Work unit pending';
  const position = profile?.positionName || 'Position pending';
  const roleLine = `${position} | ${orgUnit}`;
  const completion = getProfileCompletion(profile);
  const recentActivity = useMemo(() => {
    return [...recentRequests]
      .sort((left, right) => Date.parse(right.submitted_at) - Date.parse(left.submitted_at))
      .slice(0, 3);
  }, [recentRequests]);

  const hasBirthdayLeaveInRecentRequests = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return recentRequests.some((req) => {
      if (req.status === 'rejected' || req.status === 'cancelled') return false;
      const isBday =
        isAutoApprovedBirthdayGrant(req) ||
        req.leave_category === 'Birthday Leave' ||
        req.leave_category === 'Birthday Leave Grant' ||
        req.reason === 'Auto-approved Birthday Leave Grant' ||
        req.request_id?.startsWith('bday_leave_') === true;
      if (!isBday) return false;
      const reqDate = req.start_date || req.date_from || req.submitted_at;
      if (!reqDate) return true;
      return new Date(reqDate).getFullYear() === currentYear;
    });
  }, [recentRequests]);

  const isBirthdayLeaveEffectivelyClaimed =
    isBirthdayLeaveClaimed || hasBirthdayLeaveInRecentRequests;

  useEffect(() => {
    if (profile?.dateHired) {
      setHasCompletedOneYearService(hasCompletedOneYearOfService(profile.dateHired));
    }
  }, [profile?.dateHired]);

  useEffect(() => {
    let isMounted = true;

    const processBirthdayGreeting = async () => {
      if (!profile?.birthDate) {
        return;
      }

      if (!isBirthdayToday(profile.birthDate)) {
        return;
      }

      let effectiveHired = profile?.dateHired;
      if (!effectiveHired && profile?.employeeId) {
        try {
          const { data: assignment } = await supabase
            .from('employee_assignments')
            .select('effective_from')
            .eq('employee_id', profile.employeeId)
            .order('effective_from', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (assignment?.effective_from) {
            effectiveHired = assignment.effective_from;
          }
        } catch {
          // ignore
        }
      }

      const hasCompletedOneYear = hasCompletedOneYearOfService(effectiveHired);
      if (isMounted) {
        setHasCompletedOneYearService(hasCompletedOneYear);
      }

      const identities = [profile.employeeId, userEmail, profile.username];
      const year = new Date().getFullYear();

      // Check whether user already claimed or manually applied for an auto-approved birthday leave grant
      const alreadyIncurred =
        hasBirthdayLeaveInRecentRequests ||
        (await checkBirthdayLeaveAppliedForYear(identities, year));

      if (isMounted) {
        setIsBirthdayLeaveClaimed(alreadyIncurred);
      }

      const modalAlreadyShown = await hasBirthdayModalBeenShownForYear(identities, year);

      if (alreadyIncurred) {
        // Only the birthday greeting modal should appear or popup in the dashboard for once if the user already incurred the birthday leave grant
        if (!modalAlreadyShown) {
          if (isMounted) {
            setShowBirthdayModal(true);
          }
          await markBirthdayModalShownForYear(identities, year);
        }
      } else if (!hasCompletedOneYear) {
        // Below 1 year: modal still appears on their birthday once upon logging in, but claim button is disabled
        if (!modalAlreadyShown) {
          if (isMounted) {
            setShowBirthdayModal(true);
          }
          await markBirthdayModalShownForYear(identities, year);
        }
      } else {
        // Not incurred yet and >= 1 year -> show greeting modal so user can claim
        if (!modalAlreadyShown) {
          if (isMounted) {
            setShowBirthdayModal(true);
          }
        }
      }
    };

    void processBirthdayGreeting();

    return () => {
      isMounted = false;
    };
  }, [
    profile?.birthDate,
    profile?.employeeId,
    profile?.username,
    profile?.dateHired,
    userEmail,
    hasBirthdayLeaveInRecentRequests,
  ]);

  const handleClaimBirthdayLeave = async () => {
    if (isBirthdayLeaveEffectivelyClaimed || isClaimingBirthdayLeave || !hasCompletedOneYearService) {
      return;
    }

    const identities = [profile?.employeeId, userEmail, profile?.username];
    const year = new Date().getFullYear();

    setIsClaimingBirthdayLeave(true);
    try {
      await ensureBirthdayLeaveGrant(profile, userEmail);
      setIsBirthdayLeaveClaimed(true);
      await markBirthdayModalShownForYear(identities, year);

      const greetingTitle = `Happy Birthday ${employeeName}! 🎉`;
      const greetingBody = `Happy Birthday ${employeeName}! 🎉 Wishing you a wonderful day filled with happiness, good health, and memorable moments. As a token of our appreciation for your hard work and dedication, we're delighted to grant you one (1) Birthday Leave, so you can celebrate your special day with your loved ones or simply take time to enjoy yourself. Thank you for being a valued member of our team. We hope your year ahead is filled with success, joy, and exciting opportunities. Have an amazing birthday! 🎂🎁`;

      try {
        await addAppNotification({
          title: greetingTitle,
          body: greetingBody,
        });
        onBirthdayGreetingClosed?.();
      } catch (err) {
        console.error('Unable to store birthday notification:', err);
      }

      await refreshSupplemental();
      onRefreshDashboard();
      setShowBirthdayModal(false);
    } catch (err) {
      console.warn('Failed to claim birthday leave:', err);
    } finally {
      setIsClaimingBirthdayLeave(false);
    }
  };

  const handleCloseBirthdayModal = async () => {
    setShowBirthdayModal(false);
    const identities = [profile?.employeeId, userEmail, profile?.username];
    const year = new Date().getFullYear();

    await markBirthdayModalShownForYear(identities, year);

    const greetingTitle = `Happy Birthday ${employeeName}! 🎉`;
    const greetingBody = `Happy Birthday ${employeeName}! 🎉 Wishing you a wonderful day filled with happiness, good health, and memorable moments. As a token of our appreciation for your hard work and dedication, we're delighted to grant you one (1) Birthday Leave, so you can celebrate your special day with your loved ones or simply take time to enjoy yourself. Thank you for being a valued member of our team. We hope your year ahead is filled with success, joy, and exciting opportunities. Have an amazing birthday! 🎂🎁`;

    try {
      await addAppNotification({
        title: greetingTitle,
        body: greetingBody,
      });
      onBirthdayGreetingClosed?.();
    } catch (err) {
      console.error('Unable to store birthday notification:', err);
    }
  };

  if (balanceHistoryVisible) {
    return (
      <BalanceHistoryPage
        name={employeeName}
        username={profile?.username ?? userEmail}
        photoUrl={photoUrl}
        notificationCount={notificationCount}
        onAssistant={onAssistant}
        onNotifications={onNotifications}
        onHelpTutorials={onHelpTutorials}
        initialTab={balanceHistoryTab}
        offsetBalance={summary.offset_balance}
        leaveRemaining={summary.leave_credit_remaining}
        annualCreditDays={summary.annual_credit_days}
        onClose={() => setBalanceHistoryVisible(false)}
        onRefreshDashboard={refreshDashboard}
        hasTabBar={true}
      />
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        showNetworkStatus
        name={employeeName}
        username={profile?.username ?? userEmail}
        photoUrl={photoUrl}
        pointsBalance={summary.hyg_points_balance}
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
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: getScreenBottomPadding(insets.bottom, true, 28) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
        <View style={styles.heroPanel}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTextBlock}>
              <Text style={styles.heroEyebrow}>Employee Workspace</Text>
              <Text style={styles.heroTitle} numberOfLines={1}>{employeeName}</Text>
              <Text style={styles.heroSub} numberOfLines={1}>{roleLine}</Text>
            </View>
          </View>
        </View>

        <DashboardQuickActionCarousel
          actions={[
            {
              id: 'esarf',
              label: 'Apply ESARF',
              accessibilityLabel: 'Apply ESARF',
              onPress: onApplyEsarf,
              Icon: ActionIconDocument,
            },
            {
              id: 'leave',
              label: 'Request Leave',
              accessibilityLabel: 'Request Leave',
              onPress: onRequestLeave,
              Icon: ActionIconCalendar,
            },
            {
              id: 'pre_approved',
              label: 'Pre-approved\nOT/Offset',
              accessibilityLabel: 'Apply Pre-approved OT/Offset',
              onPress: onApplyPreApprovedOtOffset,
              Icon: ActionIconClock,
            },
            {
              id: 'perks',
              label: 'Apply Perks',
              accessibilityLabel: 'Apply Perks',
              onPress: onApplyPerks,
              Icon: ActionIconTag,
            },
            {
              id: 'travel',
              label: 'File Travel\nOrder',
              accessibilityLabel: 'File Travel Order',
              onPress: onFileTravelOrder,
              Icon: ActionIconBriefcase,
            },
          ]}
        />

        {completion.percent < 100 ? <ProfileCompletionCard completion={completion} onPress={onOpenProfile} /> : null}

        <View style={styles.metricGrid}>
          <BalanceCard
            icon={<Clock3 size={19} color="#047857" strokeWidth={2.5} />}
            label="Offset Balance"
            value={`${summary.offset_balance.toFixed(1)}h`}
            detail="Available offset hours"
            trackColor="#bbf7d0"
            fillColor="#16a34a"
            ratio={Math.min(summary.offset_balance / 16, 1)}
            compact={isCompactDashboard}
            onPressHistory={handleOpenOffsetHistory}
          />
          <BalanceCard
            icon={<CalendarDays size={19} color="#6d28d9" strokeWidth={2.5} />}
            label="Leave Credit"
            value={`${summary.leave_credit_remaining.toFixed(1)}d`}
            detail={
              summary.annual_credit_days
                ? `${summary.leave_credit_remaining.toFixed(1)} of ${summary.annual_credit_days.toFixed(1)} days left`
                : 'Remaining leave days'
            }
            trackColor="#ddd6fe"
            fillColor="#7c3aed"
            ratio={Math.min(
              summary.leave_credit_remaining / Math.max(1, summary.annual_credit_days || 7),
              1,
            )}
            compact={isCompactDashboard}
            onPressHistory={handleOpenLeaveHistory}
          />
        </View>

        <PerksUsageCard usage={perkUsage} />

        <View style={styles.activityPanel}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <Text style={styles.sectionSub}>Latest submitted employee requests</Text>
            </View>
            <ListChecks size={20} color={colors.primary} strokeWidth={2.4} />
          </View>
          {recentActivity.length > 0 ? (
            recentActivity.map((item) => (
              <ActivityRow key={item.request_id} request={item} />
            ))
          ) : (
            <View style={styles.emptyActivity}>
              <Text style={styles.emptyActivityTitle}>No recent requests</Text>
              <Text style={styles.emptyActivityText}>Submitted requests will appear here.</Text>
            </View>
          )}
        </View>

      </ScrollView>

      <BirthdayGreetingModal
        visible={showBirthdayModal}
        employeeName={employeeName}
        isClaimDisabled={isBirthdayLeaveEffectivelyClaimed || !hasCompletedOneYearService}
        hasCompletedOneYear={hasCompletedOneYearService}
        isClaiming={isClaimingBirthdayLeave}
        onClaim={handleClaimBirthdayLeave}
        onClose={handleCloseBirthdayModal}
      />

      {!hideFab && (
        <DashboardFab
          onPhotoProof={onPhotoProof}
          onPhotoLog={onPhotoLog}
          onActivityLog={onActivityLog}
        />
      )}
    </View>
  );
}

function isBirthdayToday(birthDateStr?: string | null): boolean {
  if (!birthDateStr) return false;
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  const str = birthDateStr.trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (match) {
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    return month === currentMonth && day === currentDay;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getMonth() + 1 === currentMonth && parsed.getDate() === currentDay;
  }

  return false;
}

function ActionIconDocument({ size = 40, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M 6 3 C 4.6 3 3.5 4.1 3.5 5.5 L 3.5 26.5 C 3.5 27.9 4.6 29 6 29 L 26 29 C 27.4 29 28.5 27.9 28.5 26.5 L 28.5 11 L 20.5 3 Z M 7.5 13 h 2.8 v 2.8 h -2.8 Z M 12.5 13 h 11.5 v 2.8 h -11.5 Z M 7.5 17.2 h 2.8 v 2.8 h -2.8 Z M 12.5 17.2 h 11.5 v 2.8 h -11.5 Z M 7.5 21.4 h 2.8 v 2.8 h -2.8 Z M 12.5 21.4 h 11.5 v 2.8 h -11.5 Z M 7.5 25.6 h 2.8 v 2.8 h -2.8 Z M 12.5 25.6 h 11.5 v 2.8 h -11.5 Z"
      />
      <Path fill={color} d="M 20.5 3 L 20.5 9.5 C 20.5 10.3 21.2 11 22 11 L 28.5 11 Z" />
    </Svg>
  );
}

function ActionIconCalendar({ size = 40, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x="7" y="1" width="3" height="6" rx="1.5" fill={color} />
      <Rect x="22" y="1" width="3" height="6" rx="1.5" fill={color} />
      <Path
        fill={color}
        fillRule="evenodd"
        d="M 5 4 C 3.3 4 2 5.3 2 7 L 2 27 C 2 28.7 3.3 30 5 30 L 27 30 C 28.7 30 30 28.7 30 27 L 30 7 C 30 5.3 28.7 4 27 4 Z M 4.5 9.5 h 23 v 2.2 h -23 Z M 5.5 14 h 3.5 v 3.2 h -3.5 Z M 11 14 h 3.5 v 3.2 h -3.5 Z M 16.5 14 h 3.5 v 3.2 h -3.5 Z M 22 14 h 3.5 v 3.2 h -3.5 Z M 5.5 19 h 3.5 v 3.2 h -3.5 Z M 11 19 h 3.5 v 3.2 h -3.5 Z M 16.5 19 h 3.5 v 3.2 h -3.5 Z M 22 19 h 3.5 v 3.2 h -3.5 Z M 5.5 24 h 3.5 v 3.2 h -3.5 Z M 11 24 h 3.5 v 3.2 h -3.5 Z M 16.5 24 h 3.5 v 3.2 h -3.5 Z M 22 24 h 3.5 v 3.2 h -3.5 Z"
      />
    </Svg>
  );
}

function ActionIconClock({ size = 40, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M 16 1 C 7.7 1 1 7.7 1 16 C 1 24.3 7.7 31 16 31 C 24.3 31 31 24.3 31 16 C 31 7.7 24.3 1 16 1 Z M 14.5 5.5 C 14.5 4.7 15.2 4 16 4 C 16.8 4 17.5 4.7 17.5 5.5 L 17.5 14.5 L 22.8 19.8 C 23.4 20.4 23.4 21.3 22.8 21.9 C 22.2 22.5 21.3 22.5 20.7 21.9 L 14.8 16 C 14.6 15.8 14.5 15.5 14.5 15.2 Z"
      />
    </Svg>
  );
}

function ActionIconTag({ size = 40, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M 7.8 2.5 L 2.5 7.8 C 1.5 8.8 1 10.1 1 11.5 L 1 14 C 1 15.3 1.5 16.6 2.5 17.5 L 14.5 29.5 C 16.5 31.5 19.6 31.5 21.6 29.5 L 29.5 21.6 C 31.5 19.6 31.5 16.5 29.5 14.5 L 17.5 2.5 C 16.6 1.5 15.3 1 14 1 L 11.5 1 C 10.1 1 8.8 1.5 7.8 2.5 Z M 8.5 6 C 9.9 6 11 7.1 11 8.5 C 11 9.9 9.9 11 8.5 11 C 7.1 11 6 9.9 6 8.5 C 6 7.1 7.1 6 8.5 6 Z"
      />
    </Svg>
  );
}

function ActionIconBriefcase({ size = 40, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M 11 3 C 11 1.9 11.9 1 13 1 L 19 1 C 20.1 1 21 1.9 21 3 L 21 7 L 18.5 7 L 18.5 3.5 L 13.5 3.5 L 13.5 7 L 11 7 Z"
      />
      <Path
        fill={color}
        fillRule="evenodd"
        d="M 4 7 C 2.3 7 1 8.3 1 10 L 1 26 C 1 27.7 2.3 29 4 29 L 28 29 C 29.7 29 31 27.7 31 26 L 31 10 C 31 8.3 29.7 7 28 7 Z M 1 14.5 h 30 v 1.8 h -30 Z M 6.5 12.5 h 3.8 v 5.5 h -3.8 Z M 21.7 12.5 h 3.8 v 5.5 h -3.8 Z"
      />
    </Svg>
  );
}

type QuickActionItem = {
  id: string;
  label: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  Icon: React.ComponentType<{ size?: number; color?: string; style?: any }>;
};

function DashboardQuickActionCard({
  id,
  label,
  accessibilityLabel,
  onPress,
  Icon,
  cardWidth,
  cardHeight,
}: QuickActionItem & { cardWidth?: number; cardHeight?: number }) {
  const currentHeight = cardHeight || cardWidth || 108;
  const iconSize = Math.round(currentHeight * 0.38);

  return (
    <View style={styles.quickActionCardWrapper}>
      <Pressable
        style={({ pressed }) => [
          styles.quickActionCard,
          cardWidth ? { width: cardWidth, height: currentHeight } : null,
          !onPress ? styles.quickActionDisabled : null,
          pressed ? styles.quickActionPressed : null,
        ]}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label.replace('\n', ' ')}
      >
        <View style={styles.quickActionWatermark} pointerEvents="none">
          <Icon size={Math.round(currentHeight * 0.65)} color="#FFFFFF" />
        </View>

        <View
          style={[styles.quickActionTopIcon, { width: iconSize, height: iconSize }]}
          pointerEvents="none"
        >
          <Icon size={iconSize} color="#FFFFFF" />
        </View>

        <View style={styles.quickActionLabelContainer} pointerEvents="none">
          <Text
            style={styles.quickActionCardLabel}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function DashboardQuickActionCarousel({
  actions,
}: {
  actions: QuickActionItem[];
}) {
  const { width } = useWindowDimensions();
  const gap = 8;
  const isWide = width >= 540;

  // Sized dynamically so exactly 3 buttons fit cleanly and center on phone screens
  const cardWidth = useMemo(() => {
    if (isWide) {
      return 116;
    }
    const available = width - spacing.md * 2 - gap * 2;
    return Math.max(94, Math.floor(available / 3));
  }, [width, isWide]);

  const cardHeight = cardWidth;

  // Symmetric side padding ensures the 3 cards sit precisely at the center of the viewport
  const sidePadding = useMemo(() => {
    if (isWide) {
      return spacing.md;
    }
    return Math.max(spacing.md, Math.floor((width - (cardWidth * 3 + gap * 2)) / 2));
  }, [width, cardWidth, isWide]);

  const snapInterval = cardWidth + gap;

  // Snap offsets define magnetic stopping points showing 3 centered buttons at each position
  const snapOffsets = useMemo(() => {
    const maxSnapIndex = Math.max(0, actions.length - 3);
    return Array.from({ length: maxSnapIndex + 1 }, (_, i) => i * snapInterval);
  }, [actions.length, snapInterval]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
      directionalLockEnabled
      snapToInterval={snapInterval}
      snapToOffsets={snapOffsets}
      decelerationRate="fast"
      snapToAlignment="start"
      disableIntervalMomentum={true}
      contentContainerStyle={[
        styles.quickActionCarouselContent,
        { paddingHorizontal: sidePadding, gap },
      ]}
      style={styles.quickActionCarousel}
    >
      {actions.map((item) => (
        <DashboardQuickActionCard
          key={item.id}
          {...item}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
        />
      ))}
    </ScrollView>
  );
}

function DashboardQuickAction({
  icon,
  label,
  accessibilityLabel,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.quickActionCardWrapper}>
      <Pressable
        style={({ pressed }) => [
          styles.quickActionCard,
          !onPress ? styles.quickActionDisabled : null,
          pressed ? styles.quickActionPressed : null,
        ]}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label.replace('\n', ' ')}
      >
        <View style={styles.quickActionTopIcon} pointerEvents="none">{icon}</View>
        <View style={styles.quickActionLabelContainer} pointerEvents="none">
          <Text
            style={styles.quickActionCardLabel}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function ProfileCompletionCard({ completion, onPress }: { completion: ProfileCompletion; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.profileCompletionCard, pressed ? styles.cardPressed : null]} onPress={onPress}>
      <View style={styles.profileCompletionTop}>
        <View style={[styles.profileCompletionIcon, styles.metricIconBlue]}>
          <UserCheck size={19} color="#1d4ed8" strokeWidth={2.5} />
        </View>
        <View style={styles.profileCompletionText}>
          <Text style={styles.profileCompletionLabel}>Employee Profile Completion</Text>
          <Text style={styles.profileCompletionDetail}>
            {completion.missing === 0
              ? 'All profile tabs are complete'
              : `${completion.complete}/${completion.total} fields complete | ${completion.missing} pending`}
          </Text>
        </View>
        <View style={styles.profileCompletionScore}>
          <Text style={styles.profileCompletionPercent}>{completion.percent}%</Text>
          <ArrowRight size={16} color={colors.muted} strokeWidth={2.5} />
        </View>
      </View>
      <ProgressBar ratio={completion.percent / 100} trackColor="#dbeafe" fillColor="#2563eb" />
    </Pressable>
  );
}

function PerksUsageCard({ usage }: { usage: PerkUsage | null }) {
  const sharedLimit = usage?.sharedDiscountAmountLimit ?? 3000;
  const sharedUsed = usage?.sharedDiscountAmountUsed ?? 0;
  const creditLimit = usage?.creditAmountLimit ?? usage?.creditTransactionLimit ?? 3000;
  const creditUsed = usage?.creditAmountUsed ?? 0;
  const sharedRatio = getRemainingRatio(sharedLimit, sharedUsed);
  const creditRatio = getRemainingRatio(creditLimit, creditUsed);

  return (
    <View style={styles.perksPanel}>
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={styles.sectionTitle}>Perks Usage</Text>
          <Text style={styles.sectionSub}>Shared cash and credit discount balance</Text>
        </View>
        <View style={[styles.metricIcon, styles.metricIconAmber]}>
          <BadgePercent size={19} color="#b45309" strokeWidth={2.5} />
        </View>
      </View>

      <PerkUsageRow
        label="Shared Discount"
        used={sharedUsed}
        limit={sharedLimit}
        detail={`${usage?.sharedDiscountTransactionsUsed ?? 0}/${usage?.sharedDiscountTransactionsLimit ?? 6} cash or credit transactions used`}
        ratio={sharedRatio}
        trackColor="#fde68a"
        fillColor="#d97706"
      />
      <PerkUsageRow
        label="Credit Charge"
        used={creditUsed}
        limit={creditLimit}
        detail={`${usage?.creditTransactionsUsed ?? 0} credit transaction(s) | Per request threshold`}
        ratio={creditRatio}
        trackColor="#bfdbfe"
        fillColor="#2563eb"
      />
    </View>
  );
}

function PerkUsageRow({
  label,
  used,
  limit,
  detail,
  ratio,
  trackColor,
  fillColor,
}: {
  label: string;
  used: number;
  limit: number;
  detail: string;
  ratio: number;
  trackColor: string;
  fillColor: string;
}) {
  return (
    <View style={styles.perkUsageRow}>
      <View style={styles.perkUsageTop}>
        <View style={styles.perkUsageText}>
          <Text style={styles.perkUsageLabel}>{label}</Text>
          <Text style={styles.perkUsageDetail}>{detail}</Text>
        </View>
        <Text style={styles.perkUsageAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatPeso(Math.max(limit - used, 0))}
        </Text>
      </View>
      <View style={styles.perkUsageMetaRow}>
        <Text style={styles.perkUsageMeta}>Used {formatPeso(used)}</Text>
        <Text style={styles.perkUsageMeta}>Limit {formatPeso(limit)}</Text>
      </View>
      <ProgressBar ratio={ratio} trackColor={trackColor} fillColor={fillColor} />
    </View>
  );
}

function getRemainingRatio(limit: number, used: number) {
  if (limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min((limit - used) / limit, 1));
}

function BalanceCard({
  icon,
  label,
  value,
  detail,
  trackColor,
  fillColor,
  ratio,
  compact,
  onPressHistory,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  trackColor: string;
  fillColor: string;
  ratio: number;
  compact?: boolean;
  onPressHistory?: () => void;
}) {
  const isOffset = fillColor === '#16a34a';

  return (
    <View style={[styles.metricCard, compact ? styles.metricCardCompact : null]}>
      <View style={styles.metricHeader}>
        <View style={styles.metricIcon}>{icon}</View>
        <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
      </View>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{value}</Text>
      <Text style={styles.metricDetail} numberOfLines={2}>{detail}</Text>
      <ProgressBar ratio={ratio} trackColor={trackColor} fillColor={fillColor} />
      {onPressHistory ? (
        <TouchableOpacity
          style={[
            styles.metricHistoryBtn,
            {
              backgroundColor: isOffset ? '#f0fdf4' : '#faf5ff',
              borderColor: isOffset ? '#bbf7d0' : '#ddd6fe',
            },
          ]}
          onPress={onPressHistory}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`View ${label} history`}
        >
          {isOffset ? (
            <Clock3 size={11} color={fillColor} strokeWidth={2.4} />
          ) : (
            <CalendarDays size={11} color={fillColor} strokeWidth={2.4} />
          )}
          <Text style={[styles.metricHistoryBtnText, { color: fillColor }]}>History</Text>
          <ChevronRight size={12} color={fillColor} strokeWidth={2.4} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function ProgressBar({
  ratio,
  trackColor,
  fillColor,
}: {
  ratio: number;
  trackColor: string;
  fillColor: string;
}) {
  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <View style={[styles.progressFill, { backgroundColor: fillColor, width: `${Math.max(8, ratio * 100)}%` }]} />
    </View>
  );
}

function ActivityRow({ request }: { request: MyRequest }) {
  const statusTone = getActivityStatusTone(request);

  const pillStyle =
    statusTone === 'approved'
      ? styles.statusApproved
      : statusTone === 'rejected'
        ? styles.statusRejected
        : statusTone === 'pre_approved'
          ? styles.statusPreApproved
          : styles.statusPending;

  const textStyle =
    statusTone === 'approved'
      ? styles.statusApprovedText
      : statusTone === 'rejected'
        ? styles.statusRejectedText
        : statusTone === 'pre_approved'
          ? styles.statusPreApprovedText
          : styles.statusPendingText;

  return (
    <View style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <CheckCircle2 size={18} color="#0f766e" strokeWidth={2.5} />
      </View>
      <View style={styles.activityText}>
        <Text style={styles.activityTitle} numberOfLines={1}>{formatActivityType(request)}</Text>
        <Text style={styles.activityMeta} numberOfLines={1}>{formatActivityDate(request.submitted_at)}</Text>
      </View>
      <View style={[styles.statusPill, pillStyle]}>
        <Text style={[styles.statusPillText, textStyle]}>
          {formatStatus(request)}
        </Text>
      </View>
    </View>
  );
}

type ProfileCompletion = {
  percent: number;
  complete: number;
  total: number;
  missing: number;
};

type ProfileCompletionCheck = {
  value: (profile: EmployeeProfileSummary) => unknown;
  applies?: (profile: EmployeeProfileSummary) => boolean;
};

function getProfileCompletion(profile: EmployeeProfileSummary | null): ProfileCompletion {
  const fallbackTotal = PROFILE_COMPLETION_CHECKS.filter((check) => !check.applies).length;

  if (!profile) {
    return { percent: 0, complete: 0, total: fallbackTotal, missing: fallbackTotal };
  }

  const checks = PROFILE_COMPLETION_CHECKS.filter((check) => !check.applies || check.applies(profile));
  const complete = checks.filter((check) => hasProfileValue(check.value(profile))).length;
  const total = checks.length;
  const percent = total > 0 ? Math.round((complete / total) * 100) : 100;

  return {
    percent,
    complete,
    total,
    missing: total - complete,
  };
}

const PROFILE_COMPLETION_CHECKS: ProfileCompletionCheck[] = [
  { value: (profile) => profile.firstName },
  { value: (profile) => profile.lastName },
  { value: (profile) => profile.birthDate },
  { value: (profile) => profile.gender },
  { value: (profile) => profile.religion },
  { value: (profile) => profile.birthPlace },
  { value: (profile) => profile.nationality },
  { value: (profile) => profile.civilStatus },
  { value: (profile) => profile.height },
  { value: (profile) => profile.weight },
  { value: (profile) => profile.email },
  { value: (profile) => profile.cellphone },
  { value: (profile) => profile.otherPhone },
  { value: (profile) => profile.socialMediaType },
  { value: (profile) => profile.socialMediaDetail },
  { value: (profile) => profile.presentAddress },
  { value: (profile) => profile.zipCode },
  { value: (profile) => profile.permanentAddress },
  { value: (profile) => profile.employeeType },
  { value: (profile) => profile.username },
  { value: (profile) => profile.tin },
  { value: (profile) => profile.sss },
  { value: (profile) => profile.pagibig },
  { value: (profile) => profile.philhealth },
  { value: (profile) => profile.bankType },
  { value: (profile) => profile.accountNo },
  { value: (profile) => profile.elementarySchool },
  { value: (profile) => profile.elementaryYear },
  { value: (profile) => profile.secondarySchool },
  { value: (profile) => profile.secondaryYear },
  { value: (profile) => profile.collegeSchool },
  { value: (profile) => profile.collegeYear },
  { value: (profile) => profile.collegeCourse },
  { value: (profile) => profile.yearGraduated },
  { value: (profile) => profile.fatherName },
  { value: (profile) => profile.fatherOccupation },
  { value: (profile) => profile.motherMaidenName },
  { value: (profile) => profile.motherOccupation },
  { value: (profile) => profile.numberOfSiblings },
  { value: (profile) => profile.birthOrder },
  { value: (profile) => profile.emergencyContact },
  { value: (profile) => profile.emergencyContactNo },
  { value: (profile) => profile.spouseName, applies: hasSpouseFields },
  { value: (profile) => profile.spouseOccupation, applies: hasSpouseFields },
  { value: (profile) => profile.spouseContact, applies: hasSpouseFields },
  { value: (profile) => profile.childrenCount, applies: hasChildrenFields },
  { value: (profile) => profile.childrenNames, applies: hasChildrenFields },
];

function hasProfileValue(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function hasSpouseFields(profile: EmployeeProfileSummary) {
  return normalizeCompletionText(profile.civilStatus) === 'married';
}

function hasChildrenFields(profile: EmployeeProfileSummary) {
  const count = Number.parseInt(String(profile.childrenCount ?? '').trim(), 10);
  return (Number.isFinite(count) && count > 0) || hasProfileValue(profile.childrenNames);
}

function normalizeCompletionText(value?: string | null) {
  return String(value ?? '').trim().toLowerCase();
}

function formatHomeEmployeeName(profile: EmployeeProfileSummary | null, fallback: string) {
  if (!profile) {
    return fallback;
  }

  const middleInitial = profile.middleName?.trim()?.[0];
  return [
    profile.firstName,
    middleInitial ? `${middleInitial}.` : null,
    profile.lastName,
    profile.suffix,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ') || profile.fullName || fallback;
}

function formatPeso(value: number) {
  return `PHP ${Number(value ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatActivityType(request: MyRequest) {
  if (isAutoApprovedBirthdayGrant(request)) {
    return 'Birthday Leave Grant';
  }
  return formatUnifiedRequestType(request);
}

function formatActivityDate(value: string | null) {
  if (!value) {
    return 'Date pending';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Date pending';
  }

  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isPreApprovedRequest(request?: MyRequest | null): boolean {
  if (!request) return false;
  const rawStatus = (request.status || '').toLowerCase().trim();
  if (
    rawStatus === 'approved' ||
    rawStatus.includes('validat') ||
    rawStatus === 'rejected' ||
    rawStatus === 'cancelled' ||
    rawStatus.includes('reject') ||
    rawStatus.includes('denied')
  ) {
    return false;
  }
  if (request.final_approved_at && !rawStatus.includes('reject') && !rawStatus.includes('denied')) {
    return false;
  }
  if (rawStatus.includes('pre_approved') || rawStatus.includes('pre-approved')) {
    return true;
  }
  return isScheduledOtRequest(request);
}

function formatStatus(request: MyRequest) {
  if (isPreApprovedRequest(request)) {
    return 'Pre-Approved';
  }
  return (request.status || 'Pending').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getActivityStatusTone(request: MyRequest): 'approved' | 'rejected' | 'pre_approved' | 'pending' {
  const lower = (request.status || '').toLowerCase().trim();
  if (lower === 'approved' || lower.includes('validat')) {
    return 'approved';
  }
  if (request.final_approved_at && !lower.includes('reject') && !lower.includes('denied')) {
    return 'approved';
  }
  if (lower === 'rejected' || lower === 'cancelled' || lower.includes('reject') || lower.includes('denied')) {
    return 'rejected';
  }
  if (isPreApprovedRequest(request)) {
    return 'pre_approved';
  }
  return 'pending';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 104,
  },
  heroPanel: {
    borderRadius: radius.md,
    backgroundColor: colors.brand.ink,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heroTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    color: colors.brand.gold,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  heroTitle: {
    marginTop: 4,
    color: colors.brand.white,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: fontWeights.heavy,
  },
  heroSub: {
    marginTop: 3,
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
  },
  quickActionCarousel: {
    marginHorizontal: -spacing.md,
    marginBottom: spacing.sm,
  },
  quickActionCarouselContent: {
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 3,
  },
  quickActionCardWrapper: {
    borderRadius: 14,
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 3,
  },
  quickActionCard: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: '#FFB800',
    overflow: 'hidden',
    position: 'relative',
    paddingTop: 8,
    paddingHorizontal: 9,
    paddingBottom: 10,
    justifyContent: 'space-between',
  },
  quickActionPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
  quickActionDisabled: {
    opacity: 0.52,
  },
  quickActionWatermark: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    opacity: 0.18,
    transform: [{ rotate: '14deg' }],
  },
  quickActionTopIcon: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  quickActionLabelContainer: {
    justifyContent: 'flex-end',
    minHeight: 28,
    marginBottom: 4,
  },
  quickActionCardLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    textAlign: 'left',
    textShadowColor: 'rgba(0, 0, 0, 0.14)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  profileCompletionCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  profileCompletionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileCompletionIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCompletionText: {
    flex: 1,
    minWidth: 0,
  },
  profileCompletionLabel: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
  },
  profileCompletionDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  profileCompletionScore: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  profileCompletionPercent: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: fontWeights.heavy,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metricCard: {
    flex: 1,
    minHeight: 154,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  metricCardCompact: {
    minHeight: 140,
    padding: spacing.sm,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  metricIconBlue: {
    backgroundColor: '#dbeafe',
  },
  metricIconAmber: {
    backgroundColor: '#fef3c7',
  },
  metricLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: fontWeights.heavy,
  },
  metricDetail: {
    minHeight: 18,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: {
    height: 7,
    borderRadius: 4,
  },
  metricHistoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  metricHistoryBtnText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
  },
  perksPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  perkUsageRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  perkUsageTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  perkUsageText: {
    flex: 1,
    minWidth: 0,
  },
  perkUsageLabel: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  perkUsageDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  perkUsageAmount: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
    flexShrink: 1,
    maxWidth: '48%',
    textAlign: 'right',
  },
  perkUsageMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  perkUsageMeta: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  sectionSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
  },
  activityPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  activityRow: {
    minHeight: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ccfbf1',
  },
  activityText: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
  },
  activityMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  statusPill: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusPending: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  statusApproved: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  statusRejected: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  statusPreApproved: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  statusPillText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  statusPendingText: {
    color: '#92400e',
  },
  statusApprovedText: {
    color: '#166534',
  },
  statusRejectedText: {
    color: '#991b1b',
  },
  statusPreApprovedText: {
    color: '#1d4ed8',
  },
  emptyActivity: {
    minHeight: 76,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  emptyActivityTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  emptyActivityText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
});
