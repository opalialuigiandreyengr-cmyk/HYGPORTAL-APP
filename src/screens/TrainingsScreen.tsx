import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Award,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GraduationCap,
  MapPin,
  User,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopBar } from '../components/TopBar';
import type { TrainingItem } from '../services/trainings';
import { colors, spacing } from '../theme';
import { getScreenBottomPadding } from '../utils/safeArea';

export type TrainingsScreenProps = {
  trainings: TrainingItem[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  onConfirmTraining?: (training: TrainingItem) => void | Promise<void>;
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
  onSignOut?: () => void | Promise<void>;
};

export function TrainingsScreen({
  trainings,
  isLoading = false,
  isRefreshing = false,
  errorMessage = '',
  onRefresh,
  onConfirmTraining,
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
  onSignOut,
}: TrainingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'concluded'>('upcoming');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleConfirmPress = async (item: TrainingItem) => {
    if (!onConfirmTraining || item.isConfirmed || confirmingId) return;
    setConfirmingId(item.id);
    try {
      await onConfirmTraining(item);
    } finally {
      setConfirmingId(null);
    }
  };

  const upcomingTrainings = useMemo(
    () =>
      trainings
        .filter((t) => t.status.toLowerCase() !== 'concluded')
        .sort((a, b) => a.trainingDate.localeCompare(b.trainingDate)),
    [trainings],
  );

  const concludedTrainings = useMemo(
    () =>
      trainings
        .filter((t) => t.status.toLowerCase() === 'concluded')
        .sort((a, b) => b.trainingDate.localeCompare(a.trainingDate)),
    [trainings],
  );

  const visibleList = activeTab === 'upcoming' ? upcomingTrainings : concludedTrainings;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={profileName || 'Trainings'}
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
            onRefresh={onRefresh}
            colors={['#dc2626', colors.brand.gold]}
            tintColor="#dc2626"
          />
        }
      >
        {/* Header Card */}
        <View style={styles.headerCard}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconBox}>
              <GraduationCap size={24} color="#dc2626" strokeWidth={2.3} />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>Trainings</Text>
              <Text style={styles.headerSub}>Scheduled and completed learning activities</Text>
            </View>
          </View>
          <View style={styles.countBox}>
            <Text style={styles.countValue}>{concludedTrainings.length}</Text>
            <Text style={styles.countLabel}>ATTENDED</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, activeTab === 'upcoming' && styles.tabBtnActive]}
            onPress={() => setActiveTab('upcoming')}
          >
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'upcoming' && styles.tabBtnTextActive,
              ]}
            >
              Upcoming ({upcomingTrainings.length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'concluded' && styles.tabBtnActive]}
            onPress={() => setActiveTab('concluded')}
          >
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'concluded' && styles.tabBtnTextActive,
              ]}
            >
              Concluded ({concludedTrainings.length})
            </Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isLoading && trainings.length === 0 ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator size="small" color="#dc2626" />
            <Text style={styles.emptyTitle}>Loading trainings...</Text>
            <Text style={styles.emptySub}>Fetching your scheduled and completed trainings.</Text>
          </View>
        ) : visibleList.length > 0 ? (
          <View style={styles.listContainer}>
            {visibleList.map((item) => {
              const isConcluded = item.status.toLowerCase() === 'concluded';
              return (
                <View key={item.id} style={styles.trainingCard}>
                  <View style={styles.trainingTopRow}>
                    <Text style={styles.trainingTitle}>{item.title}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        isConcluded ? styles.statusPillConcluded : styles.statusPillUpcoming,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          isConcluded
                            ? styles.statusPillTextConcluded
                            : styles.statusPillTextUpcoming,
                        ]}
                      >
                        {isConcluded ? 'Concluded' : 'Upcoming'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.trainingDivider} />

                  {item.description ? (
                    <Text style={styles.trainingDesc}>{item.description}</Text>
                  ) : null}

                  <View style={styles.metaGrid}>
                    {item.trainingDate ? (
                      <View style={styles.metaRow}>
                        <CalendarDays size={13} color={colors.muted} strokeWidth={2.2} />
                        <Text style={styles.metaText}>
                          {formatTrainingDate(item.trainingDate)}
                        </Text>
                      </View>
                    ) : null}

                    {item.startTime || item.endTime ? (
                      <View style={styles.metaRow}>
                        <Clock3 size={13} color={colors.muted} strokeWidth={2.2} />
                        <Text style={styles.metaText}>
                          {formatTimeRange(item.startTime, item.endTime)}
                        </Text>
                      </View>
                    ) : null}

                    {item.location ? (
                      <View style={styles.metaRow}>
                        <MapPin size={13} color={colors.muted} strokeWidth={2.2} />
                        <Text style={styles.metaText}>{item.location}</Text>
                      </View>
                    ) : null}

                    {item.trainer ? (
                      <View style={styles.metaRow}>
                        <User size={13} color={colors.muted} strokeWidth={2.2} />
                        <Text style={styles.metaText}>Trainer: {item.trainer}</Text>
                      </View>
                    ) : null}
                  </View>

                  {item.badgeTitle ? (
                    <View style={styles.badgeRewardBanner}>
                      <Award size={14} color="#b45309" strokeWidth={2.3} />
                      <Text style={styles.badgeRewardText} numberOfLines={1}>
                        Badge: {item.badgeTitle}
                        {item.badgePoints > 0 ? ` (+${item.badgePoints} Points)` : ''}
                      </Text>
                    </View>
                  ) : null}

                  {!isConcluded && onConfirmTraining ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.confirmBtn,
                        item.isConfirmed && styles.confirmBtnConfirmed,
                        pressed && !item.isConfirmed && !confirmingId && styles.confirmBtnPressed,
                      ]}
                      onPress={() => void handleConfirmPress(item)}
                      disabled={item.isConfirmed || confirmingId === item.id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        item.isConfirmed ? 'Attendance confirmed' : `Confirm ${item.title}`
                      }
                    >
                      {confirmingId === item.id ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <CheckCircle2
                            size={16}
                            color={item.isConfirmed ? '#15803d' : '#ffffff'}
                            strokeWidth={2.4}
                          />
                          <Text
                            style={[
                              styles.confirmBtnText,
                              item.isConfirmed && styles.confirmBtnTextConfirmed,
                            ]}
                          >
                            {item.isConfirmed ? 'Confirmed' : 'Confirm'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <GraduationCap size={28} color="#94a3b8" />
            <Text style={styles.emptyTitle}>
              {activeTab === 'upcoming' ? 'No upcoming trainings' : 'No concluded trainings'}
            </Text>
            <Text style={styles.emptySub}>
              {activeTab === 'upcoming'
                ? 'Scheduled trainings sent by the admin will appear here.'
                : 'Completed trainings you have attended will appear here.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function formatTrainingDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime12(time24: string) {
  const [hRaw, mRaw] = (time24 || '').split(':');
  const h = Number(hRaw);
  const m = Number(mRaw ?? 0);
  if (Number.isNaN(h)) return time24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(Number.isNaN(m) ? 0 : m).padStart(2, '0')} ${suffix}`;
}

function formatTimeRange(start: string, end: string) {
  if (start && end) return `${formatTime12(start)} – ${formatTime12(end)}`;
  return formatTime12(start || end);
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
    backgroundColor: '#fee2e2',
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
  countBox: {
    paddingLeft: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  countValue: {
    color: '#dc2626',
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '800',
  },
  countLabel: {
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
  trainingCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  trainingTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  trainingDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  trainingTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  statusPillUpcoming: {
    backgroundColor: '#eff6ff',
  },
  statusPillConcluded: {
    backgroundColor: '#dcfce7',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusPillTextUpcoming: {
    color: '#1d4ed8',
  },
  statusPillTextConcluded: {
    color: '#15803d',
  },
  trainingDesc: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  metaGrid: {
    gap: 5,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  metaText: {
    color: colors.text,
    fontSize: 12.5,
    fontWeight: '600',
  },
  badgeRewardBanner: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeRewardText: {
    flex: 1,
    color: '#b45309',
    fontSize: 12,
    fontWeight: '700',
  },
  confirmBtn: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    borderRadius: 11,
    paddingVertical: 11,
  },
  confirmBtnConfirmed: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  confirmBtnPressed: {
    opacity: 0.88,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  confirmBtnTextConfirmed: {
    color: '#15803d',
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
});
