import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { hygPortalLogoMobile } from '../assets/portalLogo';
import { colors, fontWeights, spacing } from '../theme';

export function StartupSplash() {
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <View style={styles.logoFrame}>
          <Image source={hygPortalLogoMobile} style={styles.logo} resizeMode="contain" fadeDuration={0} />
        </View>
        <Text style={styles.title}>HYG Portal</Text>
        <Text style={styles.subtitle}>Employee workspace</Text>
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand.goldStrong} size="small" />
          <Text style={styles.loadingText}>Loading secure session...</Text>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.ink,
    padding: spacing.xl,
  },
  logoFrame: {
    width: 104,
    height: 104,
    borderRadius: 24,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logo: {
    width: 78,
    height: 78,
  },
  title: {
    color: colors.surface,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
    marginTop: 4,
    textAlign: 'center',
  },
  loadingRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  loadingText: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
  },
});
