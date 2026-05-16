import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CalendarDays, ArrowRightLeft, Briefcase, RefreshCw } from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { TopBar } from '../components/TopBar';
import type { DashboardSummary } from '../services/dashboard';
import type { ProfileLoadResult, RequestTypeCode } from '../types/domain';

type Props = {
  userEmail: string;
  summary: DashboardSummary;
  profileResult: ProfileLoadResult | null;
  isLoadingProfile: boolean;
  onRefreshDashboard: () => void;
  onRefreshProfile: () => void;
  onRequestType: (type: RequestTypeCode) => void;
};

export function DashboardScreen({
  userEmail,
  summary,
  profileResult,
  isLoadingProfile,
  onRefreshDashboard,
  onRefreshProfile,
  onRequestType,
}: Props) {
  useEffect(() => {
    onRefreshDashboard();
    onRefreshProfile();
  }, []);

  const employeeName =
    profileResult?.status === 'linked'
      ? profileResult.profile.fullName
      : userEmail;

  const initials = employeeName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar initials={initials} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name} numberOfLines={1}>{employeeName}</Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={onRefreshDashboard}>
            <RefreshCw size={18} color={colors.primary} strokeWidth={2.5} />
          </Pressable>
        </View>

        {/* Summary Cards */}
        <View style={styles.grid}>
          <StatCard label="Pending" value={String(summary.pending_requests)} color="#3b82f6" />
          <StatCard label="Approvals" value={String(summary.pending_approvals)} color="#f59e0b" />
          <StatCard label="Offset" value={`${summary.offset_balance.toFixed(1)}h`} color="#10b981" />
          <StatCard label="Leave" value={`${summary.leave_credit_remaining.toFixed(1)}d`} color="#8b5cf6" />
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <ActionCard
            icon={<ArrowRightLeft size={22} color="#10b981" strokeWidth={2} />}
            title="Offset Earn"
            subtitle="2 approvers"
            onPress={() => onRequestType('offset_earn')}
          />
          <ActionCard
            icon={<CalendarDays size={22} color="#f59e0b" strokeWidth={2} />}
            title="Use Offset"
            subtitle="1 approver"
            onPress={() => onRequestType('use_offset')}
          />
          <ActionCard
            icon={<Briefcase size={22} color="#8b5cf6" strokeWidth={2} />}
            title="Leave"
            subtitle="1 approver"
            onPress={() => onRequestType('leave')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statDot, { backgroundColor: color }]} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.actionCard} onPress={onPress}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSub}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: 90,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  greeting: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  name: {
    fontSize: 17,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 4,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: fontWeights.semibold,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCard: {
    width: '48%' as unknown as number,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  actionSub: {
    fontSize: 11,
    color: colors.muted,
  },
});
