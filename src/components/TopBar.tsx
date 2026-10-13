import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, DeviceEventEmitter, Easing, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell, ChartNoAxesColumnIncreasing, Check, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, Info, LogOut, Menu, MessageCircle, RefreshCw, Settings, ShieldCheck, Sparkles, UsersRound, Wifi, WifiOff, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSafeBottomInset } from '../utils/safeArea';

import { NATIVE_APP_VERSION } from '../services/appUpdates';
import { colors, fontWeights } from '../theme';
import { Avatar } from './Avatar';
import { useNetworkStatus, isOfflineSupported } from '../services/network';
import { getPendingOfflineCount, syncAllOfflineItems } from '../services/offlineQueue';

const hygHorizontalLogo = require('../../assets/hyghorizontal.png');
const hygCoinsImage = require('../../assets/hygcoins.png');
const HYG_FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61577361682054';

type Props = {
  initials?: string;
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  pointsBalance?: number;
  notificationCount?: number;
  onNotifications?: () => void;
  onHelpTutorials?: () => void;
  onMessages?: () => void;
  onAvatar?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenMyTeam?: () => void;
  onOpenRewards?: () => void;
  onBackHome?: () => void;
  backTitle?: string;
  backTitleMultiline?: boolean;
  backTitleLines?: string[];
  backSubtitle?: string;
  backAccessory?: 'sparkles' | 'info';
  onBackAccessory?: () => void;
  onSignOut?: () => void | Promise<void>;
};

export function TopBar({
  initials,
  name,
  username,
  photoUrl,
  pointsBalance = 0,
  notificationCount = 0,
  onNotifications,
  onHelpTutorials,
  onAvatar,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onOpenRewards,
  onBackHome,
  backTitle,
  backTitleMultiline = false,
  backTitleLines,
  backSubtitle,
  backAccessory,
  onBackAccessory,
  onSignOut,
}: Props) {
  const insets = useSafeAreaInsets();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarMounted, setIsSidebarMounted] = useState(false);
  const sidebarProgress = useRef(new Animated.Value(0)).current;
  const avatarName = name || initials || '?';
  const sidebarUsername = username?.trim() || initials || name || '?';
  const visibleNotificationCount = Math.max(0, Math.floor(notificationCount));
  const notificationLabel = visibleNotificationCount > 99 ? '99+' : String(visibleNotificationCount);
  const containerSafeTop = Platform.OS === 'web' ? insets.top : Math.max(insets.top, 10);
  const openProfile = onOpenProfile ?? onAvatar;

  // Network connectivity and offline queue
  const network = useNetworkStatus();
  const isOnline = network.isOnline;
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCounts, setPendingCounts] = useState({ total: 0, esarf: 0, leave: 0, photoProof: 0, profile: 0 });
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [justSyncedNotice, setJustSyncedNotice] = useState<string | null>(null);
  const syncNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPending = useCallback(async () => {
    try {
      const counts = await getPendingOfflineCount();
      setPendingCounts(counts);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshPending();

    const qSub = DeviceEventEmitter.addListener('offline_queue_changed', () => {
      void refreshPending();
    });
    const syncStartSub = DeviceEventEmitter.addListener('offline_sync_started', () => {
      setIsSyncing(true);
    });
    const syncEndSub = DeviceEventEmitter.addListener('offline_sync_completed', (info) => {
      setIsSyncing(false);
      void refreshPending();
      if (info && info.total > 0) {
        setJustSyncedNotice(`Saved online! ${info.total} offline item(s) synced.`);
        if (syncNoticeTimer.current) clearTimeout(syncNoticeTimer.current);
        syncNoticeTimer.current = setTimeout(() => {
          setJustSyncedNotice(null);
        }, 6000);
      }
    });

    return () => {
      qSub.remove();
      syncStartSub.remove();
      syncEndSub.remove();
      if (syncNoticeTimer.current) clearTimeout(syncNoticeTimer.current);
    };
  }, [refreshPending]);

  useEffect(() => {
    Animated.timing(sidebarProgress, {
      toValue: isSidebarOpen ? 1 : 0,
      duration: isSidebarOpen ? 240 : 190,
      easing: isSidebarOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !isSidebarOpen) {
        setIsSidebarMounted(false);
      }
    });
  }, [isSidebarOpen, sidebarProgress]);

  function openSidebar() {
    setIsSidebarMounted(true);
    requestAnimationFrame(() => setIsSidebarOpen(true));
  }

  function closeSidebar() {
    setIsSidebarOpen(false);
  }

  function openSidebarAction(action?: () => void) {
    closeSidebar();
    action?.();
  }

  function handleOpenRewards() {
    openSidebarAction(() => {
      onOpenRewards?.();
      DeviceEventEmitter.emit('open_rewards_tab');
    });
  }

  async function openHygFacebook() {
    closeSidebar();
    await Linking.openURL(HYG_FACEBOOK_URL);
  }

  const sidebarTranslateX = sidebarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-340, 0],
  });

  return (
    <View style={styles.shell}>
      <View style={[styles.container, { paddingTop: containerSafeTop + 10 }]}>
        <View style={styles.left}>
          <Pressable style={[styles.menuBtn, onBackHome ? styles.backBtn : null]} onPress={onBackHome ?? openSidebar} hitSlop={10}>
            {onBackHome ? (
              <ChevronLeft size={28} color={colors.text} strokeWidth={3} />
            ) : (
              <Menu size={24} color={colors.text} strokeWidth={2.6} />
            )}
          </Pressable>

          {/* Online/Offline Status Indicator next to the burger icon (Android APK only) */}
          {isOfflineSupported ? (
            <Pressable
              style={[
                styles.networkBadge,
                isSyncing
                  ? styles.networkBadgeSyncing
                  : isOnline
                  ? styles.networkBadgeOnline
                  : styles.networkBadgeOffline,
              ]}
              onPress={() => setShowNetworkModal(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Connection Status: ${isOnline ? 'Online' : 'Offline'}`}
            >
              <View
                style={[
                  styles.networkDot,
                  isSyncing
                    ? styles.networkDotSyncing
                    : isOnline
                    ? styles.networkDotOnline
                    : styles.networkDotOffline,
                ]}
              />
              <Text
                style={[
                  styles.networkBadgeText,
                  isSyncing
                    ? styles.networkTextSyncing
                    : isOnline
                    ? styles.networkTextOnline
                    : styles.networkTextOffline,
                ]}
                numberOfLines={1}
              >
                {isSyncing ? 'Syncing' : isOnline ? 'Online' : 'Offline'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {backTitle ? (
          <View style={styles.centerTitleWrap} pointerEvents="none">
            {backSubtitle ? <Text style={styles.centerSubtitle} numberOfLines={1}>{backSubtitle}</Text> : null}
            {backTitleLines?.length ? (
              <View style={styles.centerTitleLines}>
                {backTitleLines.map((line) => (
                  <Text key={line} style={styles.centerTitleLine} numberOfLines={1}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : (
              <Text
                style={[styles.centerTitle, backTitleMultiline ? styles.centerTitleMultiline : null]}
                numberOfLines={backTitleMultiline ? 2 : 1}
              >
                {backTitle}
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.centerLogoWrap} pointerEvents="none">
            <TopBarLogo />
          </View>
        )}

        <View style={styles.right}>
          {backAccessory === 'sparkles' ? (
            <View style={styles.headerAccessoryIcon}>
              <Sparkles size={20} color={colors.brand.ink} strokeWidth={2.7} />
            </View>
          ) : backAccessory === 'info' ? (
            <Pressable
              disabled={!onBackAccessory}
              style={({ pressed }) => [
                styles.headerAccessoryIcon,
                styles.headerInfoIcon,
                pressed && onBackAccessory ? styles.headerAccessoryPressed : null,
              ]}
              onPress={onBackAccessory}
              hitSlop={10}
            >
              <Info size={21} color={colors.primary} strokeWidth={2.7} />
            </Pressable>
          ) : !backTitle ? (
            <>
              <TouchableOpacity
                activeOpacity={0.72}
                style={styles.iconBtn}
                hitSlop={10}
                onPress={onHelpTutorials}
                accessibilityRole="button"
                accessibilityLabel="HYG Portal Tutorials"
              >
                <CircleHelp size={20} color={colors.text} strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.72} style={styles.iconBtn} hitSlop={10} onPress={onNotifications}>
                <Bell size={20} color={colors.text} strokeWidth={2} />
                {visibleNotificationCount > 0 ? (
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationBadgeText}>{notificationLabel}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </View>

      {/* Offline Status Banner on screens (Android APK only) */}
      {isOfflineSupported && !isOnline ? (
        <Pressable
          style={styles.offlineBanner}
          onPress={() => setShowNetworkModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Offline status banner"
        >
          <WifiOff size={13} color="#b91c1c" strokeWidth={2.5} />
          <Text style={styles.offlineBannerText} numberOfLines={1}>
            Offline Mode — Requests & proofs save locally and auto-sync
          </Text>
          {pendingCounts.total > 0 ? (
            <View style={styles.offlineBannerBadge}>
              <Text style={styles.offlineBannerBadgeText}>{pendingCounts.total} queued</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {/* Sync Success Banner when requests are saved online (Android APK only) */}
      {isOfflineSupported && justSyncedNotice ? (
        <View style={styles.syncSuccessBanner}>
          <Check size={14} color="#15803d" strokeWidth={2.8} />
          <Text style={styles.syncSuccessBannerText} numberOfLines={1}>
            {justSyncedNotice}
          </Text>
        </View>
      ) : null}

      {/* Network & Offline Status Modal (Android APK only) */}
      {isOfflineSupported ? (
        <Modal
          transparent
          visible={showNetworkModal}
          animationType="fade"
          onRequestClose={() => setShowNetworkModal(false)}
        >
        <View style={styles.networkModalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowNetworkModal(false)} />
          <View style={styles.networkModalCard}>
            <View style={styles.networkModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {isOnline ? (
                  <Wifi size={20} color="#15803d" strokeWidth={2.5} />
                ) : (
                  <WifiOff size={20} color="#b91c1c" strokeWidth={2.5} />
                )}
                <Text style={styles.networkModalTitle}>Network & Sync</Text>
              </View>
              <Pressable onPress={() => setShowNetworkModal(false)} hitSlop={8} style={styles.networkModalCloseBtn}>
                <X size={20} color={colors.muted} strokeWidth={2.4} />
              </Pressable>
            </View>

            {/* Status Box */}
            <View
              style={[
                styles.networkStatusBox,
                isOnline ? styles.networkStatusBoxOnline : styles.networkStatusBoxOffline,
              ]}
            >
              <View
                style={[
                  styles.networkStatusDotLarge,
                  isOnline ? styles.dotOnlineLarge : styles.dotOfflineLarge,
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.networkStatusBoxTitle,
                    { color: isOnline ? '#15803d' : '#b91c1c' },
                  ]}
                >
                  {isOnline ? 'Online — Connected' : 'Offline — No Internet'}
                </Text>
                <Text style={styles.networkStatusBoxSub}>
                  {isOnline
                    ? `Active Connection: ${String(network.connectionType).toUpperCase()}`
                    : 'No internet or mobile data connection detected'}
                </Text>
              </View>
            </View>

            {/* Offline Storage & Queue Info */}
            <View style={styles.networkQueueCard}>
              <Text style={styles.networkQueueTitle}>
                {pendingCounts.total > 0
                  ? `Pending Local Submissions (${pendingCounts.total})`
                  : 'Offline Capabilities'}
              </Text>
              {pendingCounts.total > 0 ? (
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.networkQueueDesc}>
                    {[
                      pendingCounts.esarf > 0 ? `• ESARF Requests: ${pendingCounts.esarf}` : null,
                      pendingCounts.leave > 0 ? `• Leave Requests: ${pendingCounts.leave}` : null,
                      pendingCounts.photoProof > 0 ? `• Photo Proofs: ${pendingCounts.photoProof}` : null,
                      pendingCounts.profile > 0 ? `• Profile Updates: ${pendingCounts.profile}` : null,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  </Text>
                  <Text style={[styles.networkQueueDesc, { marginTop: 6, fontWeight: fontWeights.semibold }]}>
                    {isOnline
                      ? 'Connected! You can sync these now or let them auto-sync in the background.'
                      : 'Saved securely on this device. Once you reconnect to internet or mobile data, they will sync automatically.'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.networkQueueDesc}>
                  You can apply for ESARF, request Leave, capture photo proofs, and update your profile even without internet connection. Everything is saved locally and will automatically sync to the database once connected.
                </Text>
              )}

              {isOnline && pendingCounts.total > 0 ? (
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.networkSyncBtn}
                  disabled={isSyncing}
                  onPress={async () => {
                    setIsSyncing(true);
                    await syncAllOfflineItems();
                    await refreshPending();
                    setIsSyncing(false);
                  }}
                >
                  {isSyncing ? (
                    <Text style={styles.networkSyncBtnText}>Syncing now...</Text>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <RefreshCw size={14} color="#ffffff" strokeWidth={2.4} />
                      <Text style={styles.networkSyncBtnText}>Sync All Now</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Close Button */}
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.networkModalDoneBtn}
              onPress={() => setShowNetworkModal(false)}
            >
              <Text style={styles.networkModalDoneText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      ) : null}

      <Modal transparent visible={isSidebarMounted} animationType="none" onRequestClose={closeSidebar}>
        <View style={styles.sidebarRoot}>
          <Pressable style={styles.sidebarBackdropPressable} onPress={closeSidebar}>
            <Animated.View style={[styles.sidebarBackdrop, { opacity: sidebarProgress }]} />
          </Pressable>
          <Animated.View
            style={[
              styles.sidebarPanel,
              {
                marginTop: Platform.OS === 'web' ? insets.top : Math.max(insets.top, 10),
                transform: [{ translateX: sidebarTranslateX }],
              },
            ]}
          >
            <View style={styles.sidebarProfileCard}>
              <Pressable style={styles.sidebarClose} onPress={closeSidebar} hitSlop={8}>
                <X size={20} color={colors.surface} strokeWidth={2.6} />
              </Pressable>
              <View style={styles.sidebarProfileTop}>
                <Avatar name={avatarName} photoUrl={photoUrl} size={58} textSize={20} />
                <View style={styles.sidebarGreeting}>
                  <Text style={styles.sidebarHello}>Hello,</Text>
                  <Text style={styles.sidebarName} numberOfLines={1}>{sidebarUsername}</Text>
                  <Pressable
                    disabled={!openProfile}
                    style={({ pressed }) => [styles.viewProfileButton, pressed && openProfile ? styles.viewProfileButtonPressed : null]}
                    onPress={() => openSidebarAction(openProfile)}
                  >
                    <Text style={styles.viewProfileText}>View Profile</Text>
                    <ChevronRight size={15} color={colors.brand.ink} strokeWidth={2.8} />
                  </Pressable>
                </View>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.sidebarPointsCard, pressed ? styles.sidebarPointsCardPressed : null]}
              onPress={handleOpenRewards}
            >
              <Image source={hygCoinsImage} style={styles.sidebarPointsCoin} resizeMode="contain" />
              <View style={styles.sidebarPointsText}>
                <Text style={styles.sidebarPointsLabel}>HYG Points</Text>
                <Text style={styles.sidebarPointsValue}>{formatSidebarPoints(pointsBalance)}</Text>
                <Text style={styles.sidebarPointsBalance}>Balance</Text>
              </View>
              <View style={styles.sidebarPointsAction}>
                <ChartNoAxesColumnIncreasing size={21} color={colors.brand.ink} strokeWidth={2.7} />
              </View>
              <ChevronRight size={24} color={colors.brand.gold} strokeWidth={3} />
            </Pressable>

            {onOpenMyTeam ? (
              <SidebarRow
                icon={<UsersRound size={20} color={colors.primary} strokeWidth={2.6} />}
                label="My Team"
                value="Team schedules and members"
                onPress={() => openSidebarAction(onOpenMyTeam)}
              />
            ) : null}
            {onHelpTutorials ? (
              <SidebarRow
                icon={<CircleHelp size={20} color={colors.primary} strokeWidth={2.6} />}
                label="Tutorials"
                value="HYG Portal video guides"
                onPress={() => openSidebarAction(onHelpTutorials)}
              />
            ) : null}
            <SidebarRow
              icon={<Settings size={20} color={colors.primary} strokeWidth={2.6} />}
              label="Settings"
              value="Security, notifications, and theme"
              onPress={() => openSidebarAction(onOpenSettings)}
              disabled={!onOpenSettings}
            />
            <SidebarRow
              icon={<ExternalLink size={20} color={colors.primary} strokeWidth={2.6} />}
              label="Follow HYG"
              value="Facebook page"
              onPress={openHygFacebook}
            />
            <SidebarRow
              icon={<MessageCircle size={20} color={colors.primary} strokeWidth={2.6} />}
              label="Contact Us"
              value="Message HYG through Facebook"
              onPress={openHygFacebook}
            />
            <SidebarRow
              icon={<Info size={20} color={colors.primary} strokeWidth={2.6} />}
              label="About"
              value={`HYG Portal Mobile v${NATIVE_APP_VERSION}`}
            />
            <Pressable
              style={({ pressed }) => [
                styles.sidebarUpdateCard,
                pressed && onOpenSettings ? { opacity: 0.82, transform: [{ scale: 0.99 }] } : null,
                !onOpenSettings ? { opacity: 0.8 } : null
              ]}
              onPress={() => openSidebarAction(onOpenSettings)}
              disabled={!onOpenSettings}
            >
              <View style={[styles.sidebarRowIcon, styles.sidebarUpdateIcon]}>
                <RefreshCw size={21} color={colors.semantic.success} strokeWidth={2.8} />
              </View>
              <View style={styles.sidebarRowText}>
                <Text style={styles.sidebarRowLabel}>Update App</Text>
                <Text style={styles.sidebarUpdateSub}>Check or update in Settings</Text>
              </View>
              <View style={styles.sidebarUpdateCheck}>
                <ChevronRight size={17} color={colors.semantic.success} strokeWidth={3} />
              </View>
            </Pressable>
            {onSignOut ? (
              <View style={styles.sidebarFooter}>
                <SidebarRow
                  icon={<LogOut size={20} color="#dc2626" strokeWidth={2.6} />}
                  label="Sign Out"
                  value="Exit your account"
                  onPress={() => openSidebarAction(onSignOut)}
                  compact
                  danger
                />
              </View>
            ) : null}
            <View style={[styles.sidebarBrandFooter, { paddingBottom: getSafeBottomInset(insets.bottom, 14) }]}>
              <View style={styles.sidebarBrandIcon}>
                <ShieldCheck size={25} color={colors.primary} strokeWidth={2.5} />
              </View>
              <View>
                <Text style={styles.sidebarBrandTitle}>Secure. Reliable. Rewarding.</Text>
                <Text style={styles.sidebarBrandSub}>HYG Portal System</Text>
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

function formatSidebarPoints(value: number) {
  return Number(value ?? 0).toLocaleString('en-PH', {
    maximumFractionDigits: 0,
  });
}

function SidebarRow({
  icon,
  label,
  value,
  onPress,
  disabled,
  danger,
  compact,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
  compact?: boolean;
}) {
  const canPress = Boolean(onPress) && !disabled;
  return (
    <Pressable
      disabled={!canPress}
      style={({ pressed }) => [
        styles.sidebarRow,
        compact ? styles.sidebarRowCompact : null,
        pressed && canPress ? styles.sidebarRowPressed : null,
        disabled ? styles.sidebarRowDisabled : null,
      ]}
      onPress={onPress}
    >
      <View style={styles.sidebarRowIcon}>{icon}</View>
      <View style={styles.sidebarRowText}>
        <Text style={[styles.sidebarRowLabel, danger ? styles.sidebarRowLabelDanger : null]}>{label}</Text>
      </View>
      {canPress ? <ChevronRight size={16} color={colors.muted} strokeWidth={2.8} /> : null}
    </Pressable>
  );
}

const TopBarLogo = memo(function TopBarLogo({ style }: { style?: any }) {
  return (
    <Image source={hygHorizontalLogo} style={[styles.logo, style]} resizeMode="contain" fadeDuration={0} />
  );
});

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.surface,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  left: {
    minWidth: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  centerLogoWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
  },
  centerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
  },
  centerTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: fontWeights.heavy,
  },
  centerTitleMultiline: {
    fontSize: 13,
    lineHeight: 15,
    textAlign: 'center',
  },
  centerTitleLines: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitleLine: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
  },
  centerSubtitle: {
    color: colors.primary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  headerAccessoryIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfoIcon: {
    backgroundColor: '#eff6ff',
  },
  headerAccessoryPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.98 }],
  },
  logo: {
    width: 140,
    height: 36,
    maxWidth: '100%',
  },
  right: {
    width: 86,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  iconBtn: {
    zIndex: 2,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -5,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationBadgeText: {
    color: colors.surface,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: fontWeights.heavy,
  },
  sidebarRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebarBackdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  sidebarBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.52)',
  },
  sidebarPanel: {
    width: '82%',
    maxWidth: 340,
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    paddingHorizontal: 0,
    paddingBottom: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  sidebarProfileCard: {
    position: 'relative',
    backgroundColor: colors.brand.ink,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  sidebarProfileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 34,
  },
  sidebarGreeting: {
    flex: 1,
    minWidth: 0,
  },
  sidebarHello: {
    color: colors.surface,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  sidebarName: {
    color: colors.surface,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: fontWeights.heavy,
  },
  sidebarClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  viewProfileButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: colors.brand.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    paddingLeft: 14,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  viewProfileButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  viewProfileText: {
    color: colors.brand.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  sidebarPointsCard: {
    minHeight: 86,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: colors.brand.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  sidebarPointsCardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  sidebarPointsCoin: {
    width: 46,
    height: 46,
  },
  sidebarPointsText: {
    flex: 1,
    minWidth: 0,
  },
  sidebarPointsLabel: {
    color: colors.surface,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  sidebarPointsValue: {
    color: colors.brand.gold,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: fontWeights.heavy,
  },
  sidebarPointsBalance: {
    color: '#A3A3A3',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
  },
  sidebarPointsAction: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarRow: {
    minHeight: 62,
    borderRadius: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sidebarRowCompact: {
    minHeight: 58,
    paddingVertical: 8,
  },
  sidebarRowPressed: {
    backgroundColor: colors.background,
    transform: [{ scale: 0.99 }],
  },
  sidebarRowDisabled: {
    opacity: 0.55,
  },
  sidebarRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarRowText: {
    flex: 1,
    minWidth: 0,
  },
  sidebarRowLabel: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: fontWeights.heavy,
  },
  sidebarRowLabelDanger: {
    color: '#dc2626',
  },
  sidebarFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 0,
  },
  sidebarUpdateCard: {
    minHeight: 62,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
  },
  sidebarUpdateIcon: {
    backgroundColor: '#dcfce7',
  },
  sidebarUpdateSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  sidebarUpdateCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.semantic.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarBrandFooter: {
    marginTop: 'auto',
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  sidebarBrandIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarBrandTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
  },
  sidebarBrandSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  networkBadgeOnline: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  networkBadgeOffline: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  networkBadgeSyncing: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  networkDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.5,
  },
  networkDotOnline: {
    backgroundColor: '#16a34a',
  },
  networkDotOffline: {
    backgroundColor: '#dc2626',
  },
  networkDotSyncing: {
    backgroundColor: '#2563eb',
  },
  networkBadgeText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
  },
  networkTextOnline: {
    color: '#15803d',
  },
  networkTextOffline: {
    color: '#b91c1c',
  },
  networkTextSyncing: {
    color: '#1d4ed8',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
    paddingVertical: 5,
    paddingHorizontal: 14,
    gap: 7,
  },
  offlineBannerText: {
    flexShrink: 1,
    fontSize: 11,
    color: '#991b1b',
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
  offlineBannerBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  offlineBannerBadgeText: {
    fontSize: 9.5,
    fontWeight: fontWeights.bold,
    color: '#991b1b',
  },
  syncSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderBottomWidth: 1,
    borderBottomColor: '#a7f3d0',
    paddingVertical: 5,
    paddingHorizontal: 14,
    gap: 7,
  },
  syncSuccessBannerText: {
    flexShrink: 1,
    fontSize: 11,
    color: '#15803d',
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  networkModalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  networkModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  networkModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  networkModalTitle: {
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  networkModalCloseBtn: {
    padding: 4,
  },
  networkStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    gap: 12,
    marginBottom: 12,
  },
  networkStatusBoxOnline: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  networkStatusBoxOffline: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  networkStatusDotLarge: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotOnlineLarge: {
    backgroundColor: '#16a34a',
  },
  dotOfflineLarge: {
    backgroundColor: '#dc2626',
  },
  networkStatusBoxTitle: {
    fontSize: 13.5,
    fontWeight: fontWeights.heavy,
  },
  networkStatusBoxSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  networkQueueCard: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  networkQueueTitle: {
    fontSize: 12.5,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: 4,
  },
  networkQueueDesc: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },
  networkSyncBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  networkSyncBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  networkModalDoneBtn: {
    backgroundColor: colors.background,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  networkModalDoneText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
});
