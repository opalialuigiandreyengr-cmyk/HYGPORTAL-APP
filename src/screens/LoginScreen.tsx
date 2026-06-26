import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarCheck, Download, FileCheck2, Fingerprint, LockKeyhole, Mail, ShieldCheck, Smartphone } from 'lucide-react-native';

import { AppScreen, Card, IconTextField, PrimaryButton } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { getInstallPlatform, isPwaInstalled } from '../constants/download';

const hygLogo = require('../../assets/HYG LOGO.png');

type LoginScreenProps = {
  email: string;
  password: string;
  isSubmitting: boolean;
  emailError?: string;
  passwordError?: string;
  canUseBiometric: boolean;
  savedUsername?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onBiometricSubmit: () => void;
  onCreateProfile: () => void;
  onRegisterAccount: () => void;
};

export function LoginScreen({
  email,
  password,
  isSubmitting,
  emailError,
  passwordError,
  canUseBiometric,
  savedUsername,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onBiometricSubmit,
  onCreateProfile,
  onRegisterAccount,
}: LoginScreenProps) {
  const [showAndroidDownload, setShowAndroidDownload] = useState(false);
  const [showIosInstall, setShowIosInstall] = useState(false);

  useEffect(() => {
    // Only show install/download prompts on web when PWA is not installed
    if (Platform.OS === 'web' && !isPwaInstalled()) {
      const platform = getInstallPlatform();
      setShowAndroidDownload(platform === 'android');
      setShowIosInstall(platform === 'ios');
    }
  }, []);

  const handleDownloadApk = () => {
    const apkUrl = 'https://hygportal.vercel.app/hygportal.apk';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(apkUrl, '_blank');
    } else {
      void Linking.openURL(apkUrl);
    }
  };

  const handleIosInstall = () => {
    const message = 'To install HYG Portal on iPhone:\n\n1. Open this site in Safari\n2. Tap the Share button\n3. Tap "Add to Home Screen"\n4. Tap "Add" to confirm';
    if (typeof window !== 'undefined') {
      window.alert(message);
    }
  };

  return (
    <AppScreen variant="dark" keyboardAware>
      <StatusBar style="light" />

      {showAndroidDownload ? (
        <View style={styles.downloadBanner}>
          <View style={styles.downloadBannerContent}>
            <Download size={20} color={colors.brand.ink} strokeWidth={2.5} />
            <View style={styles.downloadBannerText}>
              <Text style={styles.downloadBannerTitle}>Get the Android app</Text>
              <Text style={styles.downloadBannerSubtitle}>Install the APK for faster access</Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.downloadButton, pressed ? styles.downloadButtonPressed : null]}
            onPress={handleDownloadApk}
          >
            <Download size={16} color={colors.brand.white} strokeWidth={3} />
            <Text style={styles.downloadButtonText}>Download APK</Text>
          </Pressable>
        </View>
      ) : null}

      {showIosInstall ? (
        <View style={styles.downloadBanner}>
          <View style={styles.downloadBannerContent}>
            <Smartphone size={20} color={colors.brand.ink} strokeWidth={2.5} />
            <View style={styles.downloadBannerText}>
              <Text style={styles.downloadBannerTitle}>Install on iPhone</Text>
              <Text style={styles.downloadBannerSubtitle}>Add to home screen for quick access</Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.downloadButton, pressed ? styles.downloadButtonPressed : null]}
            onPress={handleIosInstall}
          >
            <Smartphone size={16} color={colors.brand.white} strokeWidth={3} />
            <Text style={styles.downloadButtonText}>How to Install</Text>
          </Pressable>
        </View>
      ) : null}

      <Card variant="brand">
        <View style={styles.brandRow}>
          <View style={styles.logoFrame}>
            <Image source={hygLogo} style={styles.logo} resizeMode="contain" />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.kicker}>HYG Internal Access</Text>
            <Text style={styles.heroTitle}>Welcome back to your employee workspace.</Text>
          </View>
        </View>

        <Text style={styles.heroCopy}>
          Manage requests, approvals, schedules, and employee records through one secure portal.
        </Text>

        <View style={styles.featureList}>
          <FeaturePill icon={<CalendarCheck size={13} color={colors.brand.ink} strokeWidth={3} />} label="Attendance records" />
          <FeaturePill icon={<FileCheck2 size={13} color={colors.brand.ink} strokeWidth={3} />} label="ESARF and leave workflows" />
          <FeaturePill icon={<ShieldCheck size={13} color={colors.brand.ink} strokeWidth={3} />} label="Protected employee access" />
        </View>
      </Card>

      <View style={styles.formCardOffset}>
        <Card>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Use your assigned employee account.</Text>

          <IconTextField
            label="Username"
            icon={<Mail size={17} color={colors.muted} strokeWidth={2.5} />}
            error={emailError}
            inputProps={{
              value: email,
              onChangeText: onEmailChange,
              autoCapitalize: 'none',
              autoCorrect: false,
              keyboardType: 'default',
              placeholder: 'Username',
              returnKeyType: 'next',
            }}
          />

          <IconTextField
            label="Password"
            icon={<LockKeyhole size={17} color={colors.muted} strokeWidth={2.5} />}
            error={passwordError}
            inputProps={{
              value: password,
              onChangeText: onPasswordChange,
              autoCapitalize: 'none',
              secureTextEntry: true,
              placeholder: 'Password',
              returnKeyType: 'done',
              onSubmitEditing: onSubmit,
            }}
          />

          <PrimaryButton
            label={isSubmitting ? 'Please wait...' : 'Sign In'}
            disabled={isSubmitting}
            variant="gold"
            onPress={onSubmit}
          />

          {canUseBiometric ? (
            <Pressable
              style={({ pressed }) => [styles.biometricButton, pressed ? styles.biometricButtonPressed : null]}
              disabled={isSubmitting}
              onPress={onBiometricSubmit}
            >
              <Fingerprint size={21} color={colors.primary} strokeWidth={2.5} />
              <View style={styles.biometricText}>
                <Text style={styles.biometricTitle}>Sign in with biometrics</Text>
                <Text style={styles.biometricSubtitle}>{savedUsername || 'Saved account'}</Text>
              </View>
            </Pressable>
          ) : null}

          <View style={styles.profilePrompt}>
            <Text style={styles.profilePromptText}>Already have an employee profile? </Text>
            <Pressable onPress={onRegisterAccount} hitSlop={8}>
              <Text style={styles.profileLinkText}>Register here.</Text>
            </Pressable>
          </View>

          <View style={styles.promptSeparator} />

          <View style={styles.profilePrompt}>
            <Text style={styles.profilePromptText}>No employee profile yet? </Text>
            <Pressable onPress={onCreateProfile} hitSlop={8}>
              <Text style={styles.profileLinkText}>Create one here.</Text>
            </Pressable>
          </View>
        </Card>
      </View>
    </AppScreen>
  );
}

function FeaturePill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View style={styles.featurePill}>
      <View style={styles.featureIcon}>{icon}</View>
      <Text style={styles.featureText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  formCardOffset: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  downloadBanner: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    borderWidth: 1,
    borderColor: colors.brand.goldStrong,
  },
  downloadBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  downloadBannerText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  downloadBannerTitle: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: colors.brand.ink,
    marginBottom: 2,
  },
  downloadBannerSubtitle: {
    fontSize: 12,
    color: colors.brand.panel,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.ink,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  downloadButtonPressed: {
    opacity: 0.85,
  },
  downloadButtonText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.brand.white,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logoFrame: {
    width: 82,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.brand.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
  logo: {
    width: 76,
    height: 52,
  },
  brandText: {
    flex: 1,
  },
  kicker: {
    ...typography.label,
    color: colors.brand.gold,
    fontSize: 11,
    marginBottom: 3,
  },
  heroTitle: {
    ...typography.hero,
    color: '#f8fafc',
  },
  heroCopy: {
    ...typography.body,
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  featureList: {
    alignItems: 'flex-start',
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: colors.brand.panelSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: spacing.xs,
  },
  featureIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  featureText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: fontWeights.bold,
  },
  title: {
    ...typography.title,
    color: '#111827',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  notice: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  profilePrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  biometricButton: {
    minHeight: 54,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  biometricButtonPressed: {
    opacity: 0.76,
  },
  biometricText: {
    flex: 1,
  },
  biometricTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: fontWeights.heavy,
  },
  biometricSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  promptSeparator: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.lg,
  },
  profilePromptText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  profileLinkText: {
    color: colors.brand.goldStrong,
    fontSize: 12,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
  },
});
