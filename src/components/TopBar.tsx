import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, MessageSquare } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontWeights } from '../theme';

const hygLogo = require('../../assets/HYG LOGO.png');

type Props = {
  initials?: string;
  onNotifications?: () => void;
  onMessages?: () => void;
  onAvatar?: () => void;
};

export function TopBar({ initials = '?', onNotifications, onMessages, onAvatar }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Left: Logo + Title */}
      <View style={styles.left}>
        <View style={styles.logoFrame}>
          <Image source={hygLogo} style={styles.logo} resizeMode="contain" />
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
          <MessageSquare size={20} color="#334155" strokeWidth={2} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onNotifications}>
          <Bell size={20} color="#334155" strokeWidth={2} />
        </Pressable>
        <Pressable style={styles.avatarBtn} onPress={onAvatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
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
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 24,
    height: 24,
  },
  title: {
    fontSize: 17,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  betaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef9c3',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 2,
  },
  betaText: {
    fontSize: 10,
    fontWeight: fontWeights.heavy,
    color: '#a16207',
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
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
});
