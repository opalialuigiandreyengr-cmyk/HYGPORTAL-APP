import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Image, type LayoutChangeEvent, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Bell, CalendarDays, CheckCheck, ChevronRight, Gift, Hourglass, Trash2, X } from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { colors, fontWeights, radius, spacing } from '../theme';
import type { ProfileLoadResult } from '../types/domain';
import {
  claimHygPointsNotification,
  deleteNotification,
  loadAppNotifications,
  markNotificationRead,
  type AppNotification,
  unreadCount,
} from '../services/notificationCenter';

type FilterKey = 'unread' | 'read';
const coinImage = require('../../assets/hygcoins.png');

export function NotificationsScreen({
  profileResult,
  notificationCount = 0,
  onCountChange,
  onAssistant,
  onNotifications,
  onBackHome,
}: {
  profileResult?: ProfileLoadResult | null;
  notificationCount?: number;
  onCountChange?: (count: number) => void;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onBackHome?: () => void;
}) {
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('unread');
  const [claimingIds, setClaimingIds] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedGift, setSelectedGift] = useState<AppNotification | null>(null);

  const refresh = useCallback(async () => {
    const loaded = await loadAppNotifications();
    setItems(loaded);
    onCountChange?.(unreadCount(loaded));
  }, [onCountChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter]);

  const filtered = useMemo(() => {
    return items.filter((item) => (activeFilter === 'unread' ? !item.readAt : !!item.readAt));
  }, [activeFilter, items]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filtered.length, totalPages, currentPage]);

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filtered.slice(startIndex, startIndex + itemsPerPage);
  }, [filtered, currentPage]);

  async function handleMarkRead(id: string) {
    setErrorMessage(null);
    const next = await markNotificationRead(id);
    setItems(next);
    onCountChange?.(unreadCount(next));
  }

  async function handleDelete(id: string) {
    setErrorMessage(null);
    const next = await deleteNotification(id);
    setItems(next);
    onCountChange?.(unreadCount(next));
  }

  async function handleClaim(item: AppNotification) {
    if (!item.actionId) {
      return;
    }

    setErrorMessage(null);
    setClaimingIds((current) => new Set(current).add(item.actionId!));
    try {
      await claimHygPointsNotification(item.actionId);
      const next = await loadAppNotifications();
      setItems(next);
      onCountChange?.(unreadCount(next));
      setSelectedGift(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to claim HYG Points.');
    } finally {
      setClaimingIds((current) => {
        const next = new Set(current);
        next.delete(item.actionId!);
        return next;
      });
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={profile?.fullName}
        username={profile?.username}
        photoUrl={profile?.photoUrl}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onBackHome={onBackHome}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerIconBubble}>
              <Bell size={24} color={colors.primary} strokeWidth={2.4} />
            </View>
            <Text style={styles.headerTitle}>Notifications</Text>
          </View>
          <Text style={styles.headerSub}>Unread alerts and updates from your requests.</Text>
          <View style={styles.filterRow}>
            <Pressable
              style={[styles.filterChip, activeFilter === 'unread' ? styles.filterChipActive : null]}
              onPress={() => setActiveFilter('unread')}
            >
              <Text style={[styles.filterText, activeFilter === 'unread' ? styles.filterTextActive : null]}>
                Unread ({items.filter((item) => !item.readAt).length})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filterChip, activeFilter === 'read' ? styles.filterChipActive : null]}
              onPress={() => setActiveFilter('read')}
            >
              <Text style={[styles.filterText, activeFilter === 'read' ? styles.filterTextActive : null]}>
                Read ({items.filter((item) => !!item.readAt).length})
              </Text>
            </Pressable>
          </View>
        </View>

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {paginatedItems.length ? (
          paginatedItems.map((item) => (
            <AnimatedNotificationCard
              key={item.id}
              item={item}
              claimingIds={claimingIds}
              setSelectedGift={setSelectedGift}
              onMarkRead={handleMarkRead}
              onDelete={handleDelete}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No {activeFilter} notifications</Text>
            <Text style={styles.emptySub}>New alerts will appear here automatically.</Text>
          </View>
        )}

        {totalPages > 1 ? (
          <View style={styles.paginationRow}>
            <Pressable
              disabled={currentPage === 1}
              style={[styles.paginationButton, currentPage === 1 ? styles.paginationButtonDisabled : null]}
              onPress={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            >
              <Text style={[styles.paginationButtonText, currentPage === 1 ? styles.paginationTextDisabled : null]}>Previous</Text>
            </Pressable>
            <Text style={styles.paginationInfo}>
              Page {currentPage} of {totalPages}
            </Text>
            <Pressable
              disabled={currentPage === totalPages}
              style={[styles.paginationButton, currentPage === totalPages ? styles.paginationButtonDisabled : null]}
              onPress={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            >
              <Text style={[styles.paginationButtonText, currentPage === totalPages ? styles.paginationTextDisabled : null]}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      <GiftClaimModal
        item={selectedGift}
        isClaiming={Boolean(selectedGift?.actionId && claimingIds.has(selectedGift.actionId))}
        onClose={() => setSelectedGift(null)}
        onClaim={() => selectedGift ? handleClaim(selectedGift) : undefined}
      />
    </View>
  );
}

function GiftClaimModal({
  item,
  isClaiming,
  onClose,
  onClaim,
}: {
  item: AppNotification | null;
  isClaiming: boolean;
  onClose: () => void;
  onClaim: () => void;
}) {
  if (!item) {
    return null;
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Pressable style={styles.modalClose} onPress={onClose}>
            <X size={24} color={colors.text} strokeWidth={2.4} />
          </Pressable>
          <View style={styles.sparkleLayer}>
            <View style={[styles.sparkle, styles.sparkleOne]} />
            <View style={[styles.sparkle, styles.sparkleTwo]} />
            <View style={[styles.sparkle, styles.sparkleThree]} />
            <View style={[styles.sparkle, styles.sparkleFour]} />
          </View>
          <CoinIcon size={96} />
          <Text style={styles.modalTitle}>{item.title}</Text>
          <View style={styles.titleDivider}>
            <View style={styles.titleLine} />
            <View style={styles.titleDot} />
            <View style={styles.titleLine} />
          </View>
          <Text style={styles.modalBody}>{item.body}</Text>

          <View style={styles.modalRewardPanel}>
            <View style={styles.rewardAmountRow}>
              <CoinIcon size={38} />
              <Text style={styles.rewardAmountText}>{item.points ? `${item.points} HYG Points` : 'HYG Points'}</Text>
            </View>
            <View style={styles.rewardDivider} />
            <RewardDetail
              icon={<CalendarDays size={22} color="#a16207" strokeWidth={2.4} />}
              label="Release time"
              value={formatDateTime(item.releaseAt ?? item.createdAt)}
            />
            <RewardDetail
              icon={<Hourglass size={22} color="#a16207" strokeWidth={2.4} />}
              label="Receive time"
              value={item.receivedAt ? formatDateTime(item.receivedAt) : 'Waiting for claim'}
              isPending={!item.receivedAt}
            />
          </View>

          <View style={styles.modalActions}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={isClaiming}
              style={[styles.claimNowButton, isClaiming ? styles.actionDisabled : null]}
              onPress={onClaim}
            >
              <CoinIcon size={28} />
              <Text style={styles.claimNowText}>{isClaiming ? 'Claiming...' : 'Claim Now'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const SCREEN_WIDTH = Dimensions.get('window').width;

interface AnimatedNotificationCardProps {
  item: AppNotification;
  claimingIds: Set<string>;
  setSelectedGift: (item: AppNotification) => void;
  onMarkRead: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function AnimatedNotificationCard({
  item,
  claimingIds,
  setSelectedGift,
  onMarkRead,
  onDelete,
}: AnimatedNotificationCardProps) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  const opacityAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;
  const marginBottomAnim = useRef(new Animated.Value(spacing.sm)).current;

  const handleLayout = (event: LayoutChangeEvent) => {
    if (naturalHeight === null) {
      const { height } = event.nativeEvent.layout;
      setNaturalHeight(height);
      heightAnim.setValue(height);
    }
  };

  const handlePressMarkRead = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(heightAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(marginBottomAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start(async () => {
      try {
        await onMarkRead(item.id);
      } catch (error) {
        setIsTransitioning(false);
        Animated.parallel([
          Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(heightAnim, { toValue: naturalHeight ?? 200, duration: 250, useNativeDriver: false }),
          Animated.timing(marginBottomAnim, { toValue: spacing.sm, duration: 250, useNativeDriver: false }),
        ]).start();
      }
    });
  };

  const handlePressDelete = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    Animated.parallel([
      Animated.timing(translateXAnim, {
        toValue: SCREEN_WIDTH,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(heightAnim, {
        toValue: 0,
        duration: 300,
        delay: 50,
        useNativeDriver: false,
      }),
      Animated.timing(marginBottomAnim, {
        toValue: 0,
        duration: 300,
        delay: 50,
        useNativeDriver: false,
      }),
    ]).start(async () => {
      try {
        await onDelete(item.id);
      } catch (error) {
        setIsTransitioning(false);
        Animated.parallel([
          Animated.timing(translateXAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(heightAnim, { toValue: naturalHeight ?? 200, duration: 250, useNativeDriver: false }),
          Animated.timing(marginBottomAnim, { toValue: spacing.sm, duration: 250, useNativeDriver: false }),
        ]).start();
      }
    });
  };

  const outerStyle = {
    height: naturalHeight === null ? undefined : heightAnim,
    marginBottom: naturalHeight === null ? spacing.sm : marginBottomAnim,
    overflow: 'hidden' as const,
  };

  const innerStyle = {
    opacity: opacityAnim,
    transform: [{ translateX: translateXAnim }],
  };
  const canDelete =
    item.actionType === 'hyg_points_claim'
      ? item.actionStatus === 'claimed' && Boolean(item.readAt)
      : true;

  return (
    <Animated.View style={outerStyle} onLayout={handleLayout}>
      <Animated.View style={innerStyle}>
        <View style={[styles.card, !item.readAt ? styles.cardUnread : null]}>
          <View style={styles.cardTop}>
            <View style={styles.cardIconBubble}>
              {item.actionType === 'hyg_points_claim' ? (
                <Gift size={25} color="#a16207" strokeWidth={2.3} />
              ) : (
                <Bell size={24} color={colors.primary} strokeWidth={2.3} />
              )}
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody}>{getNotificationCardBody(item)}</Text>
            </View>
          </View>
          <Text style={styles.cardDate}>{new Date(item.createdAt).toLocaleString()}</Text>
          <View style={styles.cardActions}>
            {item.actionType === 'hyg_points_claim' && item.actionStatus === 'released' && item.actionId ? (
              <Pressable
                disabled={claimingIds.has(item.actionId) || isTransitioning}
                style={[styles.claimInlineButton, (claimingIds.has(item.actionId) || isTransitioning) ? styles.actionDisabled : null]}
                onPress={() => setSelectedGift(item)}
              >
                <CoinIcon size={34} />
                <Text style={styles.claimInlineText}>{claimingIds.has(item.actionId) ? 'Claiming...' : item.actionLabel ?? 'Claim'}</Text>
                <ChevronRight size={22} color="#a16207" strokeWidth={2.8} />
              </Pressable>
            ) : item.actionType === 'hyg_points_claim' && item.actionStatus === 'claimed' ? (
              <View style={styles.claimedBadge}>
                <CheckCheck size={15} color="#166534" strokeWidth={2.4} />
                <Text style={styles.actionText}>Claimed</Text>
              </View>
            ) : !item.readAt ? (
              <Pressable
                disabled={isTransitioning}
                style={[styles.actionButton, isTransitioning ? styles.actionDisabled : null]}
                onPress={handlePressMarkRead}
              >
                <CheckCheck size={15} color="#166534" strokeWidth={2.4} />
                <Text style={styles.actionText}>Mark read</Text>
              </Pressable>
            ) : (
              <View style={styles.actionSpacer} />
            )}
            {canDelete ? (
              <Pressable
                disabled={isTransitioning}
                style={[styles.deleteButton, isTransitioning ? styles.actionDisabled : null]}
                onPress={handlePressDelete}
              >
                <Trash2 size={15} color="#b91c1c" strokeWidth={2.4} />
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function RewardDetail({
  icon,
  label,
  value,
  isPending = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  isPending?: boolean;
}) {
  return (
    <View style={styles.rewardDetailRow}>
      <View style={styles.rewardDetailIcon}>{icon}</View>
      <View style={styles.rewardDetailText}>
        <Text style={styles.rewardDetailLabel}>{label}</Text>
        <Text style={[styles.rewardDetailValue, isPending ? styles.rewardDetailPending : null]}>{value}</Text>
      </View>
    </View>
  );
}

function CoinIcon({ size }: { size: number }) {
  return <Image source={coinImage} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="contain" />;
}

function getNotificationCardBody(item: AppNotification) {
  if (item.actionType !== 'hyg_points_claim') {
    return item.body;
  }

  if (item.actionStatus === 'claimed') {
    const pointsLabel = item.points ? `${item.points} HYG Points` : 'HYG Points';
    return `Gift claimed. ${pointsLabel} added to your balance.`;
  }

  return 'You received a gift. Tap Claim to view details.';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: 90 },
  headerCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#64748b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: fontWeights.heavy },
  headerSub: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  headerIconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  filterChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: '#f8fbff' },
  filterText: { color: colors.muted, fontSize: 12, fontWeight: fontWeights.bold },
  filterTextActive: { color: colors.primary },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#64748b',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 2,
  },
  cardUnread: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardIconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff7df',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleWrap: { flex: 1, minWidth: 0, paddingTop: 3 },
  errorCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: { color: '#b91c1c', fontSize: 12, fontWeight: fontWeights.bold },
  cardTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: fontWeights.heavy },
  cardBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  cardDate: { color: colors.muted, fontSize: 11, marginTop: spacing.sm },
  cardActions: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionButton: { minHeight: 32, borderRadius: radius.sm, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ecfdf5' },
  claimedBadge: { minHeight: 32, borderRadius: radius.sm, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ecfdf5' },
  actionText: { color: '#166534', fontSize: 12, fontWeight: fontWeights.bold },
  claimInlineButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  claimInlineText: { flex: 1, color: '#a16207', fontSize: 14, fontWeight: fontWeights.heavy },
  actionDisabled: { opacity: 0.65 },
  deleteButton: { minHeight: 32, borderRadius: radius.sm, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fef2f2' },
  deleteText: { color: '#b91c1c', fontSize: 12, fontWeight: fontWeights.bold },
  actionSpacer: { minHeight: 32 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: spacing.md,
    paddingTop: 36,
    paddingBottom: spacing.md,
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 16,
  },
  modalClose: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 3,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#64748b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  sparkleLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 34,
    height: 160,
  },
  sparkle: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: '#f6d981', opacity: 0.8, transform: [{ rotate: '45deg' }] },
  sparkleOne: { left: 52, top: 40 },
  sparkleTwo: { right: 62, top: 22 },
  sparkleThree: { left: 86, top: 82 },
  sparkleFour: { right: 42, top: 82 },
  modalTitle: { marginTop: spacing.sm, color: '#0f172a', fontSize: 20, lineHeight: 26, fontWeight: fontWeights.heavy, textAlign: 'center' },
  titleDivider: { marginTop: spacing.xs, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0 },
  titleLine: { width: 28, height: 2, backgroundColor: '#e3b341' },
  titleDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#b8860b', marginHorizontal: 4 },
  modalBody: { color: '#475569', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  modalRewardPanel: {
    alignSelf: 'stretch',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f4dfab',
    backgroundColor: '#fffbef',
    padding: spacing.md,
    marginTop: spacing.md,
  },
  rewardAmountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rewardAmountText: { color: '#0f172a', fontSize: 15, fontWeight: fontWeights.heavy },
  rewardDivider: { height: 1, backgroundColor: '#ead7a1', marginVertical: spacing.sm },
  rewardDetailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  rewardDetailIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fbefc8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardDetailText: { flex: 1, minWidth: 0 },
  rewardDetailLabel: { color: '#0f172a', fontSize: 12, fontWeight: fontWeights.heavy },
  rewardDetailValue: { color: '#334155', fontSize: 12, lineHeight: 17, marginTop: 3 },
  rewardDetailPending: { color: '#a16207', fontWeight: fontWeights.heavy },
  modalActions: { alignSelf: 'stretch', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cancelButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1.4,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  cancelText: { color: '#0f172a', fontSize: 14, fontWeight: fontWeights.heavy },
  claimNowButton: {
    flex: 1.35,
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1.4,
    borderColor: '#b8860b',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#ffffff',
  },
  claimNowText: { color: '#a16207', fontSize: 14, fontWeight: fontWeights.heavy },
  emptyCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: fontWeights.heavy },
  emptySub: { color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'center' },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  paginationButton: {
    minHeight: 38,
    minWidth: 80,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  paginationButtonDisabled: {
    borderColor: colors.border,
    backgroundColor: '#f1f5f9',
    opacity: 0.6,
  },
  paginationButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  paginationTextDisabled: {
    color: colors.muted,
  },
  paginationInfo: {
    fontSize: 13,
    color: colors.text,
    fontWeight: fontWeights.bold,
  },
});
