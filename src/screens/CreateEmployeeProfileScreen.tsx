import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { UserPlus } from 'lucide-react-native';

import { colors, radius, spacing, typography } from '../theme';

type CreateEmployeeProfileScreenProps = {
  onBack: () => void;
};

export function CreateEmployeeProfileScreen({ onBack }: CreateEmployeeProfileScreenProps) {
  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.iconShell}>
          <UserPlus size={30} color={colors.primary} strokeWidth={2.5} />
        </View>

        <Text style={styles.kicker}>Employee Profile</Text>
        <Text style={styles.title}>Create Employee Profile</Text>
        <Text style={styles.subtitle}>
          This page will collect employee details and send them for HR validation before portal access is activated.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Coming next</Text>
          <Text style={styles.cardText}>
            The actual profile form will include personal information, company assignment, position, department, and contact details.
          </Text>
        </View>

        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Back to Sign In</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  iconShell: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: '#eaf1ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  kicker: {
    ...typography.label,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 40,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginBottom: spacing.lg,
  },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  cardText: {
    ...typography.body,
    color: colors.muted,
  },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '900',
  },
});
