import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowRight,
  BadgePercent,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ListChecks,
  RefreshCw,
  UserCheck,
} from 'lucide-react-native';

import { colors, fontWeights, spacing, radius } from '../theme';
import { TopBar } from '../components/TopBar';
import type { DashboardSummary } from '../services/dashboard';
import { loadPerkUsage, type PerkUsage } from '../services/perks';
import { loadMyRequests, type MyRequest } from '../services/requests';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type Props = {
  userEmail: string;
  summary: DashboardSummary;
  profileResult: ProfileLoadResult | null;
  onRefreshDashboard: () => void;
  onRefreshProfile: () => void;
  onOpenProfile: () => void;
  onAssistant?: () => void;
};

export function DashboardScreen({
  userEmail,
  summary,
  profileResult,
  onRefreshDashboard,
  onRefreshProfile,
  onOpenProfile,
  onAssistant,
}: Props) {
  const [perkUsage, setPerkUsage] = useState<PerkUsage | null>(null);
  const [recentRequests, setRecentRequests] = useState<MyRequest[]>([]);

  const refreshSupplemental = async () => {
    try {
      const [usage, requests] = await Promise.all([loadPerkUsage(), loadMyRequests()]);
      setPerkUsage(usage);
      setRecentRequests(requests);
    } catch {
      setPerkUsage(null);
      setRecentRequests([]);
    }
  };

  const refreshDashboard = () => {
    onRefreshDashboard();
    onRefreshProfile();
    void refreshSupplemental();
  };

  useEffect(() => {
    refreshDashboard();
  }, []);

  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;
  const employeeName = profile?.fullName ?? userEmail;
  const photoUrl = profile?.photoUrl ?? null;
  const orgUnit = profile?.departmentName || profile?.storeName || 'Work unit pending';
  const position = profile?.positionName || 'Position pending';
  const roleLine = `${position} | ${orgUnit}`;
  const pendingWork = summary.pending_requests + summary.pending_approvals;
  const completion = getProfileCompletion(profile);
  const recentActivity = useMemo(() => {
    return [...recentRequests]
      .sort((left, right) => Date.parse(right.submitted_at) - Date.parse(left.submitted_at))
      .slice(0, 3);
  }, [recentRequests]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar name={employeeName} photoUrl={photoUrl} onMessages={onAssistant} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroPanel}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTextBlock}>
              <Text style={styles.heroEyebrow}>Employee Workspace</Text>
              <Text style={styles.heroTitle} numberOfLines={1}>{employeeName}</Text>
              <Text style={styles.heroSub} numberOfLines={1}>{roleLine}</Text>
            </View>
            <Pressable style={styles.refreshButton} onPress={refreshDashboard}>
              <RefreshCw size={18} color={colors.brand.ink} strokeWidth={2.5} />
            </Pressable>
          </View>
        </View>

        <PriorityCard
          icon={<Bell size={18} color="#b45309" strokeWidth={2.5} />}
          label="Pending"
          value={String(pendingWork)}
          detail={`${summary.pending_requests} requests | ${summary.pending_approvals} approvals`}
          tone="amber"
        />

        <ProfileCompletionCard completion={completion} onPress={onOpenProfile} />

        <View style={styles.metricGrid}>
          <BalanceCard
            icon={<Clock3 size={19} color="#047857" strokeWidth={2.5} />}
            label="Offset Balance"
            value={`${summary.offset_balance.toFixed(1)}h`}
            detail="Available offset hours"
            trackColor="#bbf7d0"
            fillColor="#16a34a"
            ratio={Math.min(summary.offset_balance / 16, 1)}
          />
          <BalanceCard
            icon={<CalendarDays size={19} color="#6d28d9" strokeWidth={2.5} />}
            label="Leave Credit"
            value={`${summary.leave_credit_remaining.toFixed(1)}d`}
            detail="Remaining leave days"
            trackColor="#ddd6fe"
            fillColor="#7c3aed"
            ratio={Math.min(summary.leave_credit_remaining / 7, 1)}
          />
        </View>

        <PerksUsageCard usage={perkUsage} />

        <View style={styles.activityPanel}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <Text style={styles.sectionSub}>Latest submitted employee requests</Text>
            </View>
            <ListChecks size={20} color={colors.primary} strokeWidth={2.4} />
          </View>
          {recentActivity.length > 0 ? (
            recentActivity.map((item) => (
              <ActivityRow key={item.request_id} request={item} />
            ))
          ) : (
            <View style={styles.emptyActivity}>
              <Text style={styles.emptyActivityTitle}>No recent requests</Text>
              <Text style={styles.emptyActivityText}>Submitted requests will appear here.</Text>
            </View>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

function PriorityCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'amber' | 'blue';
}) {
  return (
    <View style={styles.priorityCard}>
      <View style={[styles.priorityIcon, tone === 'amber' ? styles.priorityIconAmber : styles.priorityIconBlue]}>
        {icon}
      </View>
      <View style={styles.priorityText}>
        <View style={styles.priorityTopLine}>
          <Text style={styles.priorityLabel}>{label}</Text>
          <Text style={styles.priorityValue}>{value}</Text>
        </View>
        <Text style={styles.priorityDetail} numberOfLines={1}>{detail}</Text>
      </View>
    </View>
  );
}

function ProfileCompletionCard({ completion, onPress }: { completion: ProfileCompletion; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.profileCompletionCard, pressed ? styles.cardPressed : null]} onPress={onPress}>
      <View style={styles.profileCompletionTop}>
        <View style={[styles.profileCompletionIcon, styles.metricIconBlue]}>
          <UserCheck size={19} color="#1d4ed8" strokeWidth={2.5} />
        </View>
        <View style={styles.profileCompletionText}>
          <Text style={styles.profileCompletionLabel}>Employee Profile Completion</Text>
          <Text style={styles.profileCompletionDetail}>
            {completion.missing === 0
              ? 'All profile tabs are complete'
              : `${completion.complete}/${completion.total} fields complete | ${completion.missing} pending`}
          </Text>
        </View>
        <View style={styles.profileCompletionScore}>
          <Text style={styles.profileCompletionPercent}>{completion.percent}%</Text>
          <ArrowRight size={16} color={colors.muted} strokeWidth={2.5} />
        </View>
      </View>
      <ProgressBar ratio={completion.percent / 100} trackColor="#dbeafe" fillColor="#2563eb" />
    </Pressable>
  );
}

function PerksUsageCard({ usage }: { usage: PerkUsage | null }) {
  const cashLimit = usage?.cashAmountLimit ?? 3000;
  const cashUsed = usage?.cashAmountUsed ?? 0;
  const creditLimit = usage?.creditAmountLimit ?? 3000;
  const creditUsed = usage?.creditAmountUsed ?? 0;
  const cashRatio = cashLimit > 0 ? Math.min(cashUsed / cashLimit, 1) : 0;
  const creditRatio = creditLimit > 0 ? Math.min(creditUsed / creditLimit, 1) : 0;

  return (
    <View style={styles.perksPanel}>
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={styles.sectionTitle}>Perks Usage</Text>
          <Text style={styles.sectionSub}>Cash and credit benefit balance</Text>
        </View>
        <View style={[styles.metricIcon, styles.metricIconAmber]}>
          <BadgePercent size={19} color="#b45309" strokeWidth={2.5} />
        </View>
      </View>

      <PerkUsageRow
        label="Cash"
        used={cashUsed}
        limit={cashLimit}
        detail={`${usage?.cashTransactionsUsed ?? 0}/${usage?.cashTransactionsLimit ?? 6} transactions used`}
        ratio={cashRatio}
        trackColor="#fde68a"
        fillColor="#d97706"
      />
      <PerkUsageRow
        label="Credit"
        used={creditUsed}
        limit={creditLimit}
        detail={`${usage?.creditTransactionsUsed ?? 0} credit transactions | First discount ${usage?.creditFirstDiscountUsed ? 'used' : 'available'}`}
        ratio={creditRatio}
        trackColor="#bfdbfe"
        fillColor="#2563eb"
      />
    </View>
  );
}

function PerkUsageRow({
  label,
  used,
  limit,
  detail,
  ratio,
  trackColor,
  fillColor,
}: {
  label: string;
  used: number;
  limit: number;
  detail: string;
  ratio: number;
  trackColor: string;
  fillColor: string;
}) {
  return (
    <View style={styles.perkUsageRow}>
      <View style={styles.perkUsageTop}>
        <View>
          <Text style={styles.perkUsageLabel}>{label}</Text>
          <Text style={styles.perkUsageDetail}>{detail}</Text>
        </View>
        <Text style={styles.perkUsageAmount}>{formatPeso(Math.max(limit - used, 0))}</Text>
      </View>
      <View style={styles.perkUsageMetaRow}>
        <Text style={styles.perkUsageMeta}>Used {formatPeso(used)}</Text>
        <Text style={styles.perkUsageMeta}>Limit {formatPeso(limit)}</Text>
      </View>
      <ProgressBar ratio={ratio} trackColor={trackColor} fillColor={fillColor} />
    </View>
  );
}

function BalanceCard({
  icon,
  label,
  value,
  detail,
  trackColor,
  fillColor,
  ratio,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  trackColor: string;
  fillColor: string;
  ratio: number;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <View style={styles.metricIcon}>{icon}</View>
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
      <ProgressBar ratio={ratio} trackColor={trackColor} fillColor={fillColor} />
    </View>
  );
}

function ProgressBar({
  ratio,
  trackColor,
  fillColor,
}: {
  ratio: number;
  trackColor: string;
  fillColor: string;
}) {
  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <View style={[styles.progressFill, { backgroundColor: fillColor, width: `${Math.max(8, ratio * 100)}%` }]} />
    </View>
  );
}

function ActivityRow({ request }: { request: MyRequest }) {
  const statusTone = getActivityStatusTone(request.status);

  return (
    <View style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <CheckCircle2 size={18} color="#0f766e" strokeWidth={2.5} />
      </View>
      <View style={styles.activityText}>
        <Text style={styles.activityTitle} numberOfLines={1}>{formatActivityType(request)}</Text>
        <Text style={styles.activityMeta} numberOfLines={1}>{formatActivityDate(request.submitted_at)}</Text>
      </View>
      <View style={[styles.statusPill, statusTone === 'approved' ? styles.statusApproved : statusTone === 'rejected' ? styles.statusRejected : styles.statusPending]}>
        <Text style={[styles.statusPillText, statusTone === 'approved' ? styles.statusApprovedText : statusTone === 'rejected' ? styles.statusRejectedText : styles.statusPendingText]}>
          {formatStatus(request.status)}
        </Text>
      </View>
    </View>
  );
}

type ProfileCompletion = {
  percent: number;
  complete: number;
  total: number;
  missing: number;
};

function getProfileCompletion(profile: EmployeeProfileSummary | null): ProfileCompletion {
  if (!profile) {
    return { percent: 0, complete: 0, total: PROFILE_COMPLETION_CHECKS.length, missing: PROFILE_COMPLETION_CHECKS.length };
  }

  const complete = PROFILE_COMPLETION_CHECKS.filter((check) => hasProfileValue(check(profile))).length;
  const percent = Math.round((complete / PROFILE_COMPLETION_CHECKS.length) * 100);

  return {
    percent,
    complete,
    total: PROFILE_COMPLETION_CHECKS.length,
    missing: PROFILE_COMPLETION_CHECKS.length - complete,
  };
}

const PROFILE_COMPLETION_CHECKS: Array<(profile: EmployeeProfileSummary) => unknown> = [
  (profile) => profile.firstName,
  (profile) => profile.lastName,
  (profile) => profile.employeeNo,
  (profile) => profile.birthDate,
  (profile) => profile.gender,
  (profile) => profile.religion,
  (profile) => profile.birthPlace,
  (profile) => profile.nationality,
  (profile) => profile.civilStatus,
  (profile) => profile.height,
  (profile) => profile.weight,
  (profile) => profile.education,
  (profile) => profile.email,
  (profile) => profile.cellphone,
  (profile) => profile.otherPhone,
  (profile) => profile.socialMediaType,
  (profile) => profile.socialMediaDetail,
  (profile) => profile.presentAddress,
  (profile) => profile.zipCode,
  (profile) => profile.permanentAddress,
  (profile) => profile.companyName,
  (profile) => profile.employeeType,
  (profile) => profile.username,
  (profile) => profile.dateHired,
  (profile) => profile.storeName || profile.clusterName || profile.areaName,
  (profile) => profile.departmentName,
  (profile) => profile.positionName,
  (profile) => profile.tin,
  (profile) => profile.sss,
  (profile) => profile.pagibig,
  (profile) => profile.philhealth,
  (profile) => profile.bankType,
  (profile) => profile.accountNo,
  (profile) => profile.elementarySchool,
  (profile) => profile.elementaryYear,
  (profile) => profile.secondarySchool,
  (profile) => profile.secondaryYear,
  (profile) => profile.collegeSchool,
  (profile) => profile.collegeYear,
  (profile) => profile.collegeCourse,
  (profile) => profile.yearGraduated,
  (profile) => profile.fatherName,
  (profile) => profile.fatherOccupation,
  (profile) => profile.motherMaidenName,
  (profile) => profile.motherOccupation,
  (profile) => profile.numberOfSiblings,
  (profile) => profile.birthOrder,
  (profile) => profile.emergencyContact,
  (profile) => profile.spouseName,
  (profile) => profile.spouseOccupation,
  (profile) => profile.spouseContact,
  (profile) => profile.childrenCount,
  (profile) => profile.childrenNames,
];

function hasProfileValue(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function formatPeso(value: number) {
  return `PHP ${Number(value ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatActivityType(request: MyRequest) {
  return request.request_type_name || request.request_type_code.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatActivityDate(value: string | null) {
  if (!value) {
    return 'Date pending';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Date pending';
  }

  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getActivityStatusTone(status: string) {
  if (status === 'approved') {
    return 'approved';
  }
  if (status === 'rejected' || status === 'cancelled') {
    return 'rejected';
  }
  return 'pending';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 104,
  },
  heroPanel: {
    borderRadius: radius.md,
    backgroundColor: colors.brand.ink,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heroTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    color: colors.brand.gold,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  heroTitle: {
    marginTop: 4,
    color: colors.brand.white,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: fontWeights.heavy,
  },
  heroSub: {
    marginTop: 3,
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityCard: {
    minHeight: 66,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  priorityIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityIconAmber: {
    backgroundColor: '#fef3c7',
  },
  priorityIconBlue: {
    backgroundColor: '#dbeafe',
  },
  priorityLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  priorityText: {
    flex: 1,
    minWidth: 0,
  },
  priorityTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  priorityValue: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: fontWeights.heavy,
  },
  priorityDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
  },
  profileCompletionCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  profileCompletionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileCompletionIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCompletionText: {
    flex: 1,
    minWidth: 0,
  },
  profileCompletionLabel: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
  },
  profileCompletionDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  profileCompletionScore: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  profileCompletionPercent: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: fontWeights.heavy,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metricCard: {
    width: '48.5%',
    minHeight: 142,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  metricIconBlue: {
    backgroundColor: '#dbeafe',
  },
  metricIconAmber: {
    backgroundColor: '#fef3c7',
  },
  metricLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.text,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: fontWeights.heavy,
  },
  metricDetail: {
    minHeight: 18,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: {
    height: 7,
    borderRadius: 4,
  },
  perksPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  perkUsageRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  perkUsageTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  perkUsageLabel: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  perkUsageDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  perkUsageAmount: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  perkUsageMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  perkUsageMeta: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  sectionSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
  },
  activityPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  activityRow: {
    minHeight: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ccfbf1',
  },
  activityText: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
  },
  activityMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  statusPill: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusPending: {
    backgroundColor: '#fef3c7',
  },
  statusApproved: {
    backgroundColor: '#dcfce7',
  },
  statusRejected: {
    backgroundColor: '#fee2e2',
  },
  statusPillText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  statusPendingText: {
    color: '#92400e',
  },
  statusApprovedText: {
    color: '#166534',
  },
  statusRejectedText: {
    color: '#991b1b',
  },
  emptyActivity: {
    minHeight: 76,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  emptyActivityTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  emptyActivityText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
});
