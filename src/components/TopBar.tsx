import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, MessageSquare } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights } from '../theme';
import { hygPortalLogoMobile } from '../assets/portalLogo';
import { Avatar } from './Avatar';

type Props = {
  initials?: string;
  name?: string | null;
  photoUrl?: string | null;
  onNotifications?: () => void;
  onMessages?: () => void;
  onAvatar?: () => void;
};

export function TopBar({ initials, name, photoUrl, onNotifications, onMessages, onAvatar }: Props) {
  const insets = useSafeAreaInsets();
  const avatarName = name || initials || '?';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Left: Logo + Title */}
      <View style={styles.left}>
        <View style={styles.logoFrame}>
          <TopBarLogo />
        </View>
        <View>
          <Text style={styles.title}>HYG Portal System</Text>
          <View style={styles.betaBadge}>
            <Text style={styles.betaText}>BETA</Text>
          </View>
        </View>
      </View>

      {/* Right: Actions */}
      <View style={styles.right}>
        <Pressable style={styles.iconBtn} onPress={onMessages}>
          <MessageSquare size={20} color={colors.text} strokeWidth={2} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onNotifications}>
          <Bell size={20} color={colors.text} strokeWidth={2} />
        </Pressable>
        <Pressable style={styles.avatarBtn} onPress={onAvatar}>
          <Avatar name={avatarName} photoUrl={photoUrl} size={34} textSize={13} />
        </Pressable>
      </View>
    </View>
  );
}

const TopBarLogo = memo(function TopBarLogo() {
  return (
    <View style={styles.logoFallback}>
      <Image source={hygPortalLogoMobile} style={styles.logo} resizeMode="contain" fadeDuration={0} />
    </View>
  );
});

const styles = StyleSheet.create({
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoFrame: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    position: 'absolute',
    width: 24,
    height: 24,
  },
  logoFallback: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  title: {
    fontSize: 17,
    fontWeight: fontWeights.bold,
    color: colors.brand.panel,
  },
  betaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 2,
  },
  betaText: {
    fontSize: 10,
    fontWeight: fontWeights.heavy,
    color: colors.brand.goldStrong,
    letterSpacing: 0.5,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brand.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
