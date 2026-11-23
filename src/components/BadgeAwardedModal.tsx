import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import {
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Heart,
  Lightbulb,
  Rocket,
  Star,
  Trophy,
} from 'lucide-react-native';

import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { loadEmployeeBadges, type EarnedBadgeItem } from '../services/badges';
import { colors, spacing } from '../theme';

type BadgeAwardedModalProps = {
  userId?: string | null;
  employeeId?: string | null;
  employeeCode?: string | null;
};

const RAYS_COUNT = 12;
const RAY_PATHS = Array.from({ length: RAYS_COUNT }, (_, idx) => {
  const centerAngle = (idx * 360) / RAYS_COUNT;
  const halfSpread = 9;
  const startRad = ((centerAngle - halfSpread) * Math.PI) / 180;
  const endRad = ((centerAngle + halfSpread) * Math.PI) / 180;
  const r = 100;
  const x1 = (100 + r * Math.cos(startRad)).toFixed(2);
  const y1 = (100 + r * Math.sin(startRad)).toFixed(2);
  const x2 = (100 + r * Math.cos(endRad)).toFixed(2);
  const y2 = (100 + r * Math.sin(endRad)).toFixed(2);
  return `M 100 100 L ${x1} ${y1} L ${x2} ${y2} Z`;
});

function getClaimedCacheKey(userId: string) {
  return `claimed_badge_awards_v1_${userId}`;
}

export function BadgeAwardedModal({
  userId,
  employeeId,
  employeeCode,
}: BadgeAwardedModalProps) {
  const [queue, setQueue] = useState<EarnedBadgeItem[]>([]);
  const [isClaiming, setIsClaiming] = useState(false);

  const claimedIdsRef = useRef<Set<string>>(new Set());
  const isCheckingRef = useRef(false);

  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const badgeScaleAnim = useRef(new Animated.Value(0.65)).current;

  const currentBadge = queue[0] ?? null;

  const candidateEmpIds = useMemo(
    () =>
      Array.from(
        new Set(
          [employeeId, employeeCode]
            .map((v) => v?.trim())
            .filter((v): v is string => Boolean(v)),
        ),
      ),
    [employeeId, employeeCode],
  );

  const checkUnclaimedBadges = useCallback(async () => {
    if (!userId || isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const cacheKey = getClaimedCacheKey(userId);
      const cachedClaimed = await getCacheJSON<string[]>(cacheKey);
      if (Array.isArray(cachedClaimed)) {
        for (const id of cachedClaimed) {
          claimedIdsRef.current.add(id);
        }
      }

      const data = await loadEmployeeBadges(
        userId,
        employeeId ?? undefined,
        employeeCode ?? undefined,
      );

      const unclaimed = data.earned.filter(
        (item) => !claimedIdsRef.current.has(item.id),
      );

      if (unclaimed.length > 0) {
        setQueue((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const additions = unclaimed.filter((u) => !existingIds.has(u.id));
          if (additions.length === 0) return prev;
          return [...prev, ...additions];
        });
      }
    } catch {
      // Ignore transient network errors; next check or realtime event will retry
    } finally {
      isCheckingRef.current = false;
    }
  }, [userId, employeeId, employeeCode]);

  // Initial check on login / mount + foreground + polling fallback
  useEffect(() => {
    if (!userId) {
      setQueue([]);
      claimedIdsRef.current = new Set();
      return;
    }

    void checkUnclaimedBadges();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkUnclaimedBadges();
      }
    });

    const pollTimer = setInterval(() => {
      void checkUnclaimedBadges();
    }, 45000);

    return () => {
      appStateSub.remove();
      clearInterval(pollTimer);
    };
  }, [userId, checkUnclaimedBadges]);

  // Realtime subscription for immediate popup when a badge is awarded
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`realtime_awarded_badges_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'awarded_badges',
        },
        (payload) => {
          const newRow = payload.new as { employee_id?: string | null } | undefined;
          const rowEmpId = (newRow?.employee_id || '').trim();
          if (
            candidateEmpIds.length === 0 ||
            (rowEmpId && candidateEmpIds.includes(rowEmpId))
          ) {
            void checkUnclaimedBadges();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, candidateEmpIds, checkUnclaimedBadges]);

  // Animated glowing rays + entrance spring when a badge is visible
  useEffect(() => {
    if (!currentBadge) return;

    rotateAnim.setValue(0);
    pulseAnim.setValue(0);
    badgeScaleAnim.setValue(0.65);

    const spinLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    const springIn = Animated.spring(badgeScaleAnim, {
      toValue: 1,
      friction: 6,
      tension: 85,
      useNativeDriver: true,
    });

    spinLoop.start();
    pulseLoop.start();
    springIn.start();

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [currentBadge?.id, rotateAnim, pulseAnim, badgeScaleAnim]);

  const handleClaim = useCallback(async () => {
    if (!currentBadge || !userId || isClaiming) return;
    setIsClaiming(true);
    try {
      if (isSupabaseConfigured) {
        try {
          await supabase.rpc('claim_awarded_badge_transaction', {
            p_awarded_badge_id: currentBadge.id,
          });
        } catch {
          // Do not block dismissing the modal if network/RPC is unavailable
        }
      }
      claimedIdsRef.current.add(currentBadge.id);
      const cacheKey = getClaimedCacheKey(userId);
      await setCacheJSON(cacheKey, Array.from(claimedIdsRef.current));
    } catch {
      // Even if cache write fails, dismiss current badge from in-memory queue
    } finally {
      setQueue((prev) => prev.filter((item) => item.id !== currentBadge.id));
      setIsClaiming(false);
    }
  }, [currentBadge, userId, isClaiming]);

  if (!currentBadge) {
    return null;
  }

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const glowScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.08],
  });

  const glowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.65, 1],
  });

  const isImageUrl = Boolean(
    currentBadge.customImagePath &&
    (currentBadge.customImagePath.startsWith('http://') ||
      currentBadge.customImagePath.startsWith('https://') ||
      currentBadge.customImagePath.startsWith('data:image/')),
  );

  const iconColor = currentBadge.iconColor?.trim() || '#d97706';

  return (
    <Modal
      transparent
      animationType="fade"
      visible={Boolean(currentBadge)}
      onRequestClose={() => {
        void handleClaim();
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.congratulationsTitle}>Congratulations!</Text>
          <Text style={styles.awardedSubtitle}>You have been awarded a new badge.</Text>

          {/* Badge Icon with Animated Glowing Rays */}
          <View style={styles.stage}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.raysContainer,
                {
                  opacity: glowOpacity,
                  transform: [{ rotate: spin }, { scale: glowScale }],
                },
              ]}
            >
              <Svg width={210} height={210} viewBox="0 0 200 200">
                <Defs>
                  <RadialGradient id="badgeRayGlow" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#fde68a" stopOpacity={0.95} />
                    <Stop offset="45%" stopColor="#f59e0b" stopOpacity={0.42} />
                    <Stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                {RAY_PATHS.map((d, idx) => (
                  <Path key={idx} d={d} fill="url(#badgeRayGlow)" />
                ))}
              </Svg>
            </Animated.View>

            <Animated.View
              pointerEvents="none"
              style={[
                styles.haloCircle,
                {
                  opacity: glowOpacity,
                  transform: [{ scale: glowScale }],
                },
              ]}
            />

            <Animated.View
              style={[
                styles.badgeCenter,
                { transform: [{ scale: badgeScaleAnim }] },
              ]}
            >
              {isImageUrl && currentBadge.customImagePath ? (
                <Image
                  source={{ uri: currentBadge.customImagePath }}
                  style={styles.customBadgeImage}
                  resizeMode="contain"
                />
              ) : (
                renderBadgeIcon(currentBadge.iconData, iconColor, 68)
              )}
            </Animated.View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.categoryPill}>
              <Text style={styles.categoryPillText}>{currentBadge.category}</Text>
            </View>
            {currentBadge.pointsAwarded > 0 ? (
              <View style={styles.pointsPill}>
                <Text style={styles.pointsPillText}>
                  +{currentBadge.pointsAwarded} pts
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.title}>{currentBadge.title}</Text>

          {currentBadge.description ? (
            <Text style={styles.description}>{currentBadge.description}</Text>
          ) : null}

          <Text style={styles.awardedMeta}>
            Awarded {formatAwardedDate(currentBadge.awardedAt)} by {currentBadge.awardedBy}
          </Text>

          {currentBadge.note ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>"{currentBadge.note}"</Text>
              <Text style={styles.noteAuthor}>— {currentBadge.awardedBy}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.claimButton,
              pressed && !isClaiming && styles.claimButtonPressed,
            ]}
            onPress={() => void handleClaim()}
            disabled={isClaiming}
            accessibilityRole="button"
            accessibilityLabel="Claim badge"
          >
            <Text style={styles.claimButtonText}>
              {queue.length > 1 ? `Claim Badge (1 of ${queue.length})` : 'Claim Badge'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function renderBadgeIcon(iconData: string, color: string, size: number) {
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
  return `on ${date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fde68a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 22,
    elevation: 12,
  },
  congratulationsTitle: {
    color: '#d97706',
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 2,
  },
  awardedSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  stage: {
    width: 210,
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.xs,
    position: 'relative',
  },
  raysContainer: {
    position: 'absolute',
    width: 210,
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
  },
  haloCircle: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(251, 191, 36, 0.22)',
  },
  badgeCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  customBadgeImage: {
    width: 96,
    height: 96,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  categoryPill: {
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryPillText: {
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '700',
  },
  pointsPill: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pointsPillText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '800',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    color: colors.muted,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 6,
  },
  awardedMeta: {
    color: '#16a34a',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  noteBox: {
    width: '100%',
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.gold,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  noteText: {
    color: colors.text,
    fontSize: 12.5,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  noteAuthor: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  claimButton: {
    marginTop: spacing.md + 2,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brand.gold,
    borderRadius: 12,
    paddingVertical: 13,
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  claimButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  claimButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
  },
});
