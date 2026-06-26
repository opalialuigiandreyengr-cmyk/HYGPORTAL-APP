import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell, ChartNoAxesColumnIncreasing, Check, ChevronLeft, ChevronRight, ExternalLink, Info, LogOut, Menu, MessageCircle, RefreshCw, Settings, ShieldCheck, Sparkles, UsersRound, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights } from '../theme';
import { getInstallCopy, isPwaInstalled, openPlatformInstall } from '../constants/download';
import { Avatar } from './Avatar';

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
  onMessages?: () => void;
  onAvatar?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenMyTeam?: () => void;
  onBackHome?: () => void;
  backTitle?: string;
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
  onAvatar,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onBackHome,
  backTitle,
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
  const containerSafeTop = Platform.OS === 'web' ? 0 : Math.max(insets.top, 10);
  const openProfile = onOpenProfile ?? onAvatar;
  const installCopy = getInstallCopy();
  const showInstallBanner = Platform.OS === 'web' && !isPwaInstalled();

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
      {showInstallBanner ? (
        <View style={[styles.downloadBanner, { paddingTop: insets.top + 7 }]}>
          <View style={styles.downloadBrand}>
            <View style={styles.downloadLogoFrame}>
              <TopBarLogo />
            </View>
            <View style={styles.downloadTextBlock}>
              <Text style={styles.downloadTitle} numberOfLines={1}>HYG Portal System</Text>
              <Text style={styles.downloadSubtitle} numberOfLines={1}>{installCopy.subtitle}</Text>
            </View>
          </View>
          <Pressable style={styles.downloadButton} onPress={openPlatformInstall}>
            <Text style={styles.downloadButtonText}>{installCopy.action}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.container, { paddingTop: containerSafeTop + 10 }]}>
        <View style={styles.left}>
          <Pressable style={[styles.menuBtn, onBackHome ? styles.backBtn : null]} onPress={onBackHome ?? openSidebar} hitSlop={10}>
            {onBackHome ? (
              <ChevronLeft size={28} color={colors.text} strokeWidth={3} />
            ) : (
              <Menu size={24} color={colors.text} strokeWidth={2.6} />
            )}
          </Pressable>
        </View>

        {backTitle ? (
          <View style={styles.centerTitleWrap} pointerEvents="none">
            {backSubtitle ? <Text style={styles.centerSubtitle} numberOfLines={1}>{backSubtitle}</Text> : null}
            <Text style={styles.centerTitle} numberOfLines={1}>{backTitle}</Text>
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
            <TouchableOpacity activeOpacity={0.72} style={styles.iconBtn} hitSlop={10} onPress={onNotifications}>
              <Bell size={20} color={colors.text} strokeWidth={2} />
              {visibleNotificationCount > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>{notificationLabel}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Modal transparent visible={isSidebarMounted} animationType="none" onRequestClose={closeSidebar}>
        <View style={styles.sidebarRoot}>
          <Pressable style={styles.sidebarBackdropPressable} onPress={closeSidebar}>
            <Animated.View style={[styles.sidebarBackdrop, { opacity: sidebarProgress }]} />
          </Pressable>
          <Animated.View
            style={[
              styles.sidebarPanel,
              {
                marginTop: Platform.OS === 'web' ? 0 : Math.max(insets.top, 10),
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

            <Pressable style={({ pressed }) => [styles.sidebarPointsCard, pressed ? styles.sidebarPointsCardPressed : null]}>
              <Image source={hygCoinsImage} style={styles.sidebarPointsCoin} resizeMode="contain" />
              <View style={styles.sidebarPointsText}>
                <Text style={styles.sidebarPointsLabel}>HYG Points</Text>
                <Text style={styles.sidebarPointsValue}>{formatSidebarPoints(pointsBalance)}</Text>
                <Text style={styles.sidebarPointsRate}>1 Point = P1.00</Text>
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
              value="HYG Portal Mobile v1.5.1"
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
            <View style={styles.sidebarBrandFooter}>
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

const TopBarLogo = memo(function TopBarLogo() {
  return (
    <Image source={hygHorizontalLogo} style={styles.logo} resizeMode="contain" fadeDuration={0} />
  );
});

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.surface,
  },
  downloadBanner: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  downloadBrand: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  downloadLogoFrame: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  downloadTitle: {
    color: colors.brand.panel,
    fontSize: 15,
    fontWeight: fontWeights.heavy,
  },
  downloadSubtitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: fontWeights.medium,
  },
  downloadButton: {
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  downloadButtonText: {
    color: colors.brand.ink,
    fontSize: 12,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
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
    width: 86,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
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
    width: 156,
    height: 42,
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
    ...StyleSheet.absoluteFillObject,
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
  sidebarPointsRate: {
    color: colors.surface,
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
});
