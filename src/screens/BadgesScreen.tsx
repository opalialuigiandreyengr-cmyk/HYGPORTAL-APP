import React, { useMemo, useState } from 'react';
import {
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
  Award,
  BadgeCheck,
  BookOpen,
  Heart,
  Lightbulb,
  Lock,
  Rocket,
  Star,
  Trophy,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights, spacing } from '../theme';
import { getScreenBottomPadding } from '../utils/safeArea';
import { TopBar } from '../components/TopBar';
import { AwardBadgeModal } from '../components/AwardBadgeModal';
import type { AppToastMessage } from '../components/AppToast';
import { canAwardBadges } from '../services/positions';
import type {
  BadgeCatalogItem,
  EarnedBadgeItem,
  EmployeeBadgesData,
} from '../services/badges';

export type BadgesScreenProps = {
  badgesData: EmployeeBadgesData;
  isLoading?: boolean;
  isRefreshing?: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  onBack: () => void;
  profileName?: string | null;
  username?: string | null;
  profilePhotoUrl?: string | null;
  employeeId?: string | null;
  positionName?: string | null;
  departmentName?: string | null;
  authorityLevel?: number | null;
  pointsBalance?: number;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSignOut?: () => void | Promise<void>;
};

type DisplayBadgeEntry =
  | { kind: 'earned'; key: string; item: EarnedBadgeItem }
  | { kind: 'locked'; key: string; item: BadgeCatalogItem };

const BADGE_CATEGORIES = [
  'All Categories',
  'Milestones',
  'Performance',
  'Learning & Skills',
  'Values & Culture',
  'Attendance',
] as const;

export function BadgesScreen({
  badgesData,
  isLoading = false,
  isRefreshing = false,
  errorMessage = '',
  onRefresh,
  onBack,
  profileName,
  username,
  profilePhotoUrl,
  employeeId,
  positionName,
  departmentName,
  authorityLevel,
  pointsBalance = 0,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onToast,
  onSignOut,
}: BadgesScreenProps) {
  const insets = useSafeAreaInsets();
  const { earned, locked, catalog, totalCatalogCount } = badgesData;
  const [selectedBadge, setSelectedBadge] = useState<DisplayBadgeEntry | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
  const [showAwardModal, setShowAwardModal] = useState(false);

  const canAward = Boolean(employeeId && canAwardBadges(positionName, authorityLevel));

  const allEntries = useMemo<DisplayBadgeEntry[]>(
    () => [
      ...earned.map((item) => ({ kind: 'earned' as const, key: `earned-${item.id}`, item })),
      ...locked.map((item) => ({ kind: 'locked' as const, key: `locked-${item.id}`, item })),
    ],
    [earned, locked],
  );

  const availableCategories = useMemo(() => {
    const base = [...BADGE_CATEGORIES] as string[];
    const seen = new Set(base.map((c) => c.toLowerCase()));
    for (const entry of allEntries) {
      const cat = (entry.item.category || '').trim();
      if (cat && !seen.has(cat.toLowerCase())) {
        seen.add(cat.toLowerCase());
        base.push(cat);
      }
    }
    return base;
  }, [allEntries]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      'All Categories': allEntries.length,
    };
    for (const cat of availableCategories) {
      if (cat === 'All Categories') continue;
      counts[cat] = allEntries.filter(
        (entry) => (entry.item.category || '').trim().toLowerCase() === cat.toLowerCase(),
      ).length;
    }
    return counts;
  }, [allEntries, availableCategories]);

  const filteredEntries = useMemo(() => {
    if (selectedCategory === 'All Categories') return allEntries;
    return allEntries.filter(
      (entry) => (entry.item.category || '').trim().toLowerCase() === selectedCategory.toLowerCase(),
    );
  }, [allEntries, selectedCategory]);

  const badgeRows = useMemo(() => chunkIntoRows(filteredEntries, 3), [filteredEntries]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={profileName || 'Badges'}
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
            colors={[colors.brand.gold]}
            tintColor={colors.brand.gold}
          />
        }
      >
        {/* Header with Earned Count */}
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBox}>
                <BadgeCheck size={24} color="#2563eb" strokeWidth={2.3} />
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={styles.headerTitle}>My Badges</Text>
                <Text style={styles.headerSub}>Earn badges and receive points</Text>
              </View>
            </View>
            <View style={styles.earnedCountBox}>
              <Text style={styles.earnedCountValue}>
                {earned.length}
                {totalCatalogCount > 0 ? (
                  <Text style={styles.earnedCountTotal}> / {totalCatalogCount}</Text>
                ) : null}
              </Text>
              <Text style={styles.earnedCountLabel}>EARNED</Text>
            </View>
          </View>
          {totalCatalogCount > 0 ? (
            <View style={styles.headerProgressTrack}>
              <View
                style={[
                  styles.headerProgressFill,
                  {
                    width: `${Math.min(100, Math.round((earned.length / totalCatalogCount) * 100))}%`,
                  },
                ]}
              />
            </View>
          ) : null}
        </View>

        {canAward ? (
          <Pressable
            style={({ pressed }) => [
              styles.awardBadgeBtn,
              pressed && styles.awardBadgeBtnPressed,
            ]}
            onPress={() => setShowAwardModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Award badge to a department employee"
          >
            <Award size={17} color="#ffffff" strokeWidth={2.3} />
            <Text style={styles.awardBadgeBtnText}>Award Badge</Text>
          </Pressable>
        ) : null}

        {/* Category Filter Carousel */}
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

        {errorMessage ? (
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isLoading && earned.length === 0 && locked.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Loading badges...</Text>
            <Text style={styles.emptySub}>Fetching your achievements from the server.</Text>
          </View>
        ) : null}

        {badgeRows.length > 0 ? (
          <View style={styles.gridContainer}>
            {badgeRows.map((row, rowIndex) => (
              <View key={`badge-row-${rowIndex}`} style={styles.gridRow}>
                {[0, 1, 2].map((colIndex) => {
                  const entry = row[colIndex];
                  if (!entry) {
                    return <View key={`empty-${rowIndex}-${colIndex}`} style={styles.gridSlot} />;
                  }
                  const isLocked = entry.kind === 'locked';
                  const badgeItem = entry.item;
                  return (
                    <Pressable
                      key={entry.key}
                      style={({ pressed }) => [
                        styles.gridSlot,
                        pressed && styles.gridSlotPressed,
                      ]}
                      onPress={() => setSelectedBadge(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={`${badgeItem.title}${isLocked ? ' (Locked)' : ' (Earned)'}`}
                    >
                      <BadgeVisual
                        iconData={badgeItem.iconData}
                        customImagePath={badgeItem.customImagePath}
                        iconColor={badgeItem.iconColor}
                        locked={isLocked}
                        size={104}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : !isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {selectedCategory !== 'All Categories'
                ? 'No badges in this category'
                : 'No badges available'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedCategory !== 'All Categories'
                ? `No badges found under "${selectedCategory}".`
                : 'Check back later for new badges to unlock.'}
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
        ) : null}
      </ScrollView>

      <BadgeDetailsModal
        entry={selectedBadge}
        onClose={() => setSelectedBadge(null)}
      />

      {canAward && employeeId ? (
        <AwardBadgeModal
          visible={showAwardModal}
          onClose={() => setShowAwardModal(false)}
          catalog={catalog}
          managerEmployeeId={employeeId}
          managerName={profileName || username || 'Manager'}
          managerPositionName={positionName}
          managerDepartmentName={departmentName}
          onToast={onToast}
        />
      ) : null}
    </View>
  );
}

function BadgeDetailsModal({
  entry,
  onClose,
}: {
  entry: DisplayBadgeEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;

  const isLocked = entry.kind === 'locked';
  const item = entry.item;
  const points = entry.kind === 'earned' ? entry.item.pointsAwarded : entry.item.points;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={Boolean(entry)}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <Pressable
            style={styles.modalCloseIconBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close badge details"
          >
            <X size={18} color={colors.muted} strokeWidth={2.4} />
          </Pressable>

          <View style={styles.modalBadgeCenter}>
            <BadgeVisual
              iconData={item.iconData}
              customImagePath={item.customImagePath}
              iconColor={item.iconColor}
              locked={isLocked}
              size={124}
            />
          </View>

          <View style={styles.modalStatusRow}>
            {isLocked ? (
              <View style={styles.modalLockedPill}>
                <Lock size={12} color="#64748b" strokeWidth={2.5} />
                <Text style={styles.modalLockedPillText}>Locked</Text>
              </View>
            ) : (
              <View style={styles.modalEarnedPill}>
                <BadgeCheck size={13} color="#15803d" strokeWidth={2.5} />
                <Text style={styles.modalEarnedPillText}>Earned</Text>
              </View>
            )}

            <View style={styles.modalCategoryPill}>
              <Text style={styles.modalCategoryPillText}>{item.category}</Text>
            </View>

            {points > 0 ? (
              <View style={[styles.pointsPill, isLocked && styles.pointsPillLocked]}>
                <Text style={[styles.pointsPillText, isLocked && styles.pointsPillTextLocked]}>
                  +{points} pts
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.modalTitle}>{item.title}</Text>

          {item.description ? (
            <Text style={styles.modalDesc}>{item.description}</Text>
          ) : (
            <Text style={styles.modalDescMuted}>
              {isLocked
                ? points > 0
                  ? `Complete this milestone to unlock this badge and earn +${points} pts.`
                  : 'Complete this milestone to unlock this badge.'
                : 'Achievement unlocked.'}
            </Text>
          )}

          {entry.kind === 'earned' ? (
            <View style={styles.modalEarnedDetails}>
              <Text style={styles.awardedDateText}>
                Earned on {formatAwardedDate(entry.item.awardedAt)}
              </Text>
              {entry.item.note ? (
                <View style={styles.noteBox}>
                  <Text style={styles.noteText}>"{entry.item.note}"</Text>
                  <Text style={styles.awardedByText}>— {entry.item.awardedBy}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.modalCloseButton,
              pressed && styles.modalCloseButtonPressed,
            ]}
            onPress={onClose}
          >
            <Text style={styles.modalCloseButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BadgeVisual({
  iconData,
  customImagePath,
  iconColor,
  locked = false,
  size = 82,
}: {
  iconData: string;
  customImagePath: string | null;
  iconColor: string;
  locked?: boolean;
  size?: number;
}) {
  const isImageUrl = Boolean(
    customImagePath &&
    (customImagePath.startsWith('http://') ||
      customImagePath.startsWith('https://') ||
      customImagePath.startsWith('data:image/')),
  );

  const iconSize = Math.round(size * 0.62);
  const resolvedColor = iconColor?.trim() || '#d97706';

  return (
    <View style={[styles.badgeVisualWrap, { width: size, height: size }]}>
      {isImageUrl && customImagePath ? (
        <>
          <Image
            source={{ uri: customImagePath }}
            style={{
              width: size,
              height: size,
              opacity: locked ? 0.35 : 1,
            }}
            resizeMode="contain"
          />
          {locked ? (
            <View style={styles.badgeLockOverlay}>
              <Lock size={Math.round(size * 0.24)} color="#475569" strokeWidth={2.5} />
            </View>
          ) : null}
        </>
      ) : locked ? (
        <Lock size={Math.round(size * 0.5)} color="#94a3b8" strokeWidth={2.2} />
      ) : (
        renderBadgeIcon(iconData, resolvedColor, iconSize)
      )}
    </View>
  );
}

function chunkIntoRows<T>(items: T[], rowSize: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += rowSize) {
    rows.push(items.slice(i, i + rowSize));
  }
  return rows;
}

function renderBadgeIcon(iconData: string, color: string, size = 28) {
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

function formatAwardedDate(dateStr: string) {
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
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
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
    backgroundColor: '#eff6ff',
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
  earnedCountBox: {
    paddingLeft: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  earnedCountValue: {
    color: '#d97706',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
  },
  earnedCountTotal: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  earnedCountLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  headerProgressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    overflow: 'hidden',
    marginTop: spacing.sm + 4,
  },
  headerProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#f59e0b',
  },
  awardBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  awardBadgeBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  awardBadgeBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  statusBanner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  statusBannerText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
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
    marginTop: 12,
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
  gridContainer: {
    gap: spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  gridSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridSlotPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  badgeVisualWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badgeLockOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  modalCloseIconBtn: {
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
  modalBadgeCenter: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
  },
  modalEarnedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  modalEarnedPillText: {
    color: '#15803d',
    fontSize: 11,
    fontWeight: '800',
  },
  modalLockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  modalLockedPillText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalDesc: {
    color: colors.muted,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 8,
  },
  modalDescMuted: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 8,
  },
  modalEarnedDetails: {
    width: '100%',
    marginTop: spacing.sm + 4,
    alignItems: 'center',
  },
  modalCloseButton: {
    marginTop: spacing.md + 2,
    width: '100%',
    backgroundColor: colors.brand.ink,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButtonPressed: {
    opacity: 0.88,
  },
  modalCloseButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '800',
  },
  pointsPill: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pointsPillLocked: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  pointsPillText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '800',
  },
  pointsPillTextLocked: {
    color: '#64748b',
  },
  modalCategoryPill: {
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  modalCategoryPillText: {
    color: '#1d4ed8',
    fontSize: 10.5,
    fontWeight: '700',
  },
  awardedDateText: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '700',
  },
  noteBox: {
    width: '100%',
    marginTop: 8,
    backgroundColor: '#f8fafc',
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.gold,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  noteText: {
    color: colors.text,
    fontSize: 12.5,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  awardedByText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  emptySub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
});
