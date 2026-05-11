import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme';
import type { ProfileLoadResult } from '../types/domain';

export function ProfilePanel({
  isLoading,
  result,
  onRefresh,
}: {
  isLoading: boolean;
  result: ProfileLoadResult | null;
  onRefresh: () => void;
}) {
  if (isLoading) {
    return (
      <View style={styles.profilePanel}>
        <Text style={styles.profileTitle}>Loading employee profile...</Text>
      </View>
    );
  }

  if (!result) {
    return (
      <View style={styles.profilePanel}>
        <Text style={styles.profileTitle}>Employee profile not loaded</Text>
        <Pressable style={styles.smallButton} onPress={onRefresh}>
          <Text style={styles.smallButtonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  if (result.status !== 'linked') {
    return (
      <View style={styles.profilePanel}>
        <Text style={styles.profileTitle}>
          {result.status === 'schema_missing'
            ? 'Database setup needed'
            : result.status === 'error'
              ? 'Profile load error'
              : 'Profile not linked'}
        </Text>
        <Text style={styles.profileMuted}>{result.message}</Text>
        <Pressable style={styles.smallButton} onPress={onRefresh}>
          <Text style={styles.smallButtonText}>Check Again</Text>
        </Pressable>
      </View>
    );
  }

  const { profile } = result;

  return (
    <View style={styles.profilePanel}>
      <Text style={styles.profileTitle}>{profile.fullName}</Text>
      <Text style={styles.profileMuted}>
        {profile.employeeNo ? `${profile.employeeNo} | ` : ''}
        {profile.employmentStatus}
      </Text>
      <View style={styles.profileRows}>
        <ProfileRow label="Company" value={profile.companyName} />
        <ProfileRow label="Store" value={profile.storeName} />
        <ProfileRow label="Position" value={profile.positionName} />
        <ProfileRow label="Level" value={profile.authorityLevel ? `Level ${profile.authorityLevel}` : null} />
        <ProfileRow label="Function" value={profile.functionName} />
      </View>
    </View>
  );
}

export function RequestTile({ title, detail, onPress }: { title: string; detail: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.requestTile} onPress={onPress}>
      <Text style={styles.requestTitle}>{title}</Text>
      <Text style={styles.requestDetail}>{detail}</Text>
    </Pressable>
  );
}

export function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileRowLabel}>{label}</Text>
      <Text style={styles.profileRowValue}>{value || 'Not assigned'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profilePanel: {
    borderRadius: 8,
    padding: spacing.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  profileTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  profileMuted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  profileRows: {
    marginTop: spacing.xs,
  },
  profileRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingVertical: spacing.sm,
  },
  profileRowLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  profileRowValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 3,
  },
  smallButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  smallButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  requestTile: {
    width: '47%',
    minHeight: 92,
    justifyContent: 'space-between',
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    margin: 5,
  },
  requestTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  requestDetail: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  summaryCard: {
    borderRadius: 8,
    padding: spacing.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
});
