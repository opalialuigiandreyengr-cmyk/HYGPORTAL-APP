import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

export function AppScreen({
  children,
  variant = 'default',
  keyboardAware = false,
}: {
  children: ReactNode;
  variant?: 'default' | 'dark';
  keyboardAware?: boolean;
}) {
  const content = (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  return (
    <View style={[styles.safeArea, variant === 'dark' && styles.safeAreaDark]}>
      {keyboardAware ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          style={styles.keyboardView}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </View>
  );
}

export function Card({
  children,
  variant = 'surface',
}: {
  children: ReactNode;
  variant?: 'surface' | 'brand';
}) {
  return <View style={[styles.card, variant === 'brand' && styles.brandCard]}>{children}</View>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'gold';
}) {
  return (
    <Pressable
      disabled={disabled}
      style={[styles.button, variant === 'gold' && styles.goldButton, disabled && styles.disabled]}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, variant === 'gold' && styles.goldButtonText]}>{label}</Text>
    </Pressable>
  );
}

export function IconTextField({
  label,
  icon,
  inputProps,
}: {
  label: string;
  icon: ReactNode;
  inputProps: TextInputProps;
}) {
  return (
    <>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.iconInputShell}>
        {icon}
        <TextInput placeholderTextColor="#94a3b8" {...inputProps} style={[styles.iconInput, inputProps.style]} />
      </View>
    </>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeAreaDark: {
    backgroundColor: colors.brand.ink,
  },
  keyboardView: {
    flex: 1,
  },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: spacing.md,
  },
  brandCard: {
    borderColor: colors.brand.line,
    backgroundColor: colors.brand.panel,
  },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  goldButton: {
    backgroundColor: colors.brand.gold,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  goldButtonText: {
    color: '#111827',
  },
  inputLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  iconInputShell: {
    minHeight: 48,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  iconInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
    paddingLeft: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  disabled: {
    opacity: 0.7,
  },
});
