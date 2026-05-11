import { StatusBar } from 'expo-status-bar';
import { type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarCheck, FileCheck2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react-native';

import { AppScreen, Card, Divider, IconTextField, PrimaryButton } from '../components/ui';
import { colors, radius, spacing, typography } from '../theme';

const hygLogo = require('../../assets/HYG LOGO.png');

type LoginScreenProps = {
  email: string;
  password: string;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onCreateProfile: () => void;
};

export function LoginScreen({
  email,
  password,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onCreateProfile,
}: LoginScreenProps) {
  return (
    <AppScreen variant="dark" keyboardAware>
      <StatusBar style="light" />
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
            label="Email"
            icon={<Mail size={17} color={colors.muted} strokeWidth={2.5} />}
            inputProps={{
              value: email,
              onChangeText: onEmailChange,
              autoCapitalize: 'none',
              autoCorrect: false,
              keyboardType: 'email-address',
              placeholder: 'name@company.com',
              returnKeyType: 'next',
            }}
          />

          <IconTextField
            label="Password"
            icon={<LockKeyhole size={17} color={colors.muted} strokeWidth={2.5} />}
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

          <Text style={styles.notice}>Contact HR Admin if you cannot sign in.</Text>
          <Divider />

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
    fontWeight: '800',
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
    marginTop: spacing.xs,
  },
  profilePromptText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  profileLinkText: {
    color: colors.brand.goldStrong,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
});
