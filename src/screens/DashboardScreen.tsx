import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowRight,
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  ListChecks,
  RefreshCw,
  Tag,
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
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onSignOut?: () => void | Promise<void>;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onApplyEsarf?: () => void;
  onRequestLeave?: () => void;
  onApplyPerks?: () => void;
};

export function DashboardScreen({
  userEmail,
  summary,
  profileResult,
  onRefreshDashboard,
  onRefreshProfile,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onSignOut,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onApplyEsarf,
  onRequestLeave,
  onApplyPerks,
}: Props) {
  const [perkUsage, setPerkUsage] = useState<PerkUsage | null>(null);
  const [recentRequests, setRecentRequests] = useState<MyRequest[]>([]);
  const { width } = useWindowDimensions();
  const isCompactDashboard = width < 390;

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
  const completion = getProfileCompletion(profile);
  const recentActivity = useMemo(() => {
    return [...recentRequests]
      .sort((left, right) => Date.parse(right.submitted_at) - Date.parse(left.submitted_at))
      .slice(0, 3);
  }, [recentRequests]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={employeeName}
        username={profile?.username ?? userEmail}
        photoUrl={photoUrl}
        pointsBalance={summary.hyg_points_balance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
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

        <View style={styles.quickActionRow}>
          <DashboardQuickAction
            icon={<FileText size={18} color={colors.brand.ink} strokeWidth={2.7} />}
            label="Apply ESARF"
            onPress={onApplyEsarf}
          />
          <DashboardQuickAction
            icon={<CalendarDays size={18} color={colors.brand.ink} strokeWidth={2.7} />}
            label="Request Leave"
            onPress={onRequestLeave}
          />
          <DashboardQuickAction
            icon={<Tag size={18} color={colors.brand.ink} strokeWidth={2.7} />}
            label="Apply Perks"
            onPress={onApplyPerks}
          />
        </View>

        {completion.percent < 100 ? <ProfileCompletionCard completion={completion} onPress={onOpenProfile} /> : null}

        <View style={styles.metricGrid}>
          <BalanceCard
            icon={<Clock3 size={19} color="#047857" strokeWidth={2.5} />}
            label="Offset Balance"
            value={`${summary.offset_balance.toFixed(1)}h`}
            detail="Available offset hours"
            trackColor="#bbf7d0"
            fillColor="#16a34a"
            ratio={Math.min(summary.offset_balance / 16, 1)}
            compact={isCompactDashboard}
          />
          <BalanceCard
            icon={<CalendarDays size={19} color="#6d28d9" strokeWidth={2.5} />}
            label="Leave Credit"
            value={`${summary.leave_credit_remaining.toFixed(1)}d`}
            detail="Remaining leave days"
            trackColor="#ddd6fe"
            fillColor="#7c3aed"
            ratio={Math.min(summary.leave_credit_remaining / 7, 1)}
            compact={isCompactDashboard}
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

function DashboardQuickAction({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.quickActionButton,
        !onPress ? styles.quickActionDisabled : null,
        pressed ? styles.quickActionPressed : null,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.quickActionIcon}>{icon}</View>
      <Text style={styles.quickActionLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>
        {label}
      </Text>
    </Pressable>
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
  const sharedLimit = usage?.sharedDiscountAmountLimit ?? 3000;
  const sharedUsed = usage?.sharedDiscountAmountUsed ?? 0;
  const creditLimit = usage?.creditAmountLimit ?? usage?.creditTransactionLimit ?? 3000;
  const creditUsed = usage?.creditAmountUsed ?? 0;
  const sharedRatio = getRemainingRatio(sharedLimit, sharedUsed);
  const creditRatio = getRemainingRatio(creditLimit, creditUsed);

  return (
    <View style={styles.perksPanel}>
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={styles.sectionTitle}>Perks Usage</Text>
          <Text style={styles.sectionSub}>Shared cash and credit discount balance</Text>
        </View>
        <View style={[styles.metricIcon, styles.metricIconAmber]}>
          <BadgePercent size={19} color="#b45309" strokeWidth={2.5} />
        </View>
      </View>

      <PerkUsageRow
        label="Shared Discount"
        used={sharedUsed}
        limit={sharedLimit}
        detail={`${usage?.sharedDiscountTransactionsUsed ?? 0}/${usage?.sharedDiscountTransactionsLimit ?? 6} cash or credit transactions used`}
        ratio={sharedRatio}
        trackColor="#fde68a"
        fillColor="#d97706"
      />
      <PerkUsageRow
        label="Credit Charge"
        used={creditUsed}
        limit={creditLimit}
        detail={`${usage?.creditTransactionsUsed ?? 0} credit transaction(s) | Per request threshold`}
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
        <View style={styles.perkUsageText}>
          <Text style={styles.perkUsageLabel}>{label}</Text>
          <Text style={styles.perkUsageDetail}>{detail}</Text>
        </View>
        <Text style={styles.perkUsageAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {formatPeso(Math.max(limit - used, 0))}
        </Text>
      </View>
      <View style={styles.perkUsageMetaRow}>
        <Text style={styles.perkUsageMeta}>Used {formatPeso(used)}</Text>
        <Text style={styles.perkUsageMeta}>Limit {formatPeso(limit)}</Text>
      </View>
      <ProgressBar ratio={ratio} trackColor={trackColor} fillColor={fillColor} />
    </View>
  );
}

function getRemainingRatio(limit: number, used: number) {
  if (limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min((limit - used) / limit, 1));
}

function BalanceCard({
  icon,
  label,
  value,
  detail,
  trackColor,
  fillColor,
  ratio,
  compact,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  trackColor: string;
  fillColor: string;
  ratio: number;
  compact?: boolean;
}) {
  return (
    <View style={[styles.metricCard, compact ? styles.metricCardCompact : null]}>
      <View style={styles.metricHeader}>
        <View style={styles.metricIcon}>{icon}</View>
        <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
      </View>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{value}</Text>
      <Text style={styles.metricDetail} numberOfLines={2}>{detail}</Text>
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

type ProfileCompletionCheck = {
  value: (profile: EmployeeProfileSummary) => unknown;
  applies?: (profile: EmployeeProfileSummary) => boolean;
};

function getProfileCompletion(profile: EmployeeProfileSummary | null): ProfileCompletion {
  const fallbackTotal = PROFILE_COMPLETION_CHECKS.filter((check) => !check.applies).length;

  if (!profile) {
    return { percent: 0, complete: 0, total: fallbackTotal, missing: fallbackTotal };
  }

  const checks = PROFILE_COMPLETION_CHECKS.filter((check) => !check.applies || check.applies(profile));
  const complete = checks.filter((check) => hasProfileValue(check.value(profile))).length;
  const total = checks.length;
  const percent = total > 0 ? Math.round((complete / total) * 100) : 100;

  return {
    percent,
    complete,
    total,
    missing: total - complete,
  };
}

const PROFILE_COMPLETION_CHECKS: ProfileCompletionCheck[] = [
  { value: (profile) => profile.firstName },
  { value: (profile) => profile.lastName },
  { value: (profile) => profile.birthDate },
  { value: (profile) => profile.gender },
  { value: (profile) => profile.religion },
  { value: (profile) => profile.birthPlace },
  { value: (profile) => profile.nationality },
  { value: (profile) => profile.civilStatus },
  { value: (profile) => profile.height },
  { value: (profile) => profile.weight },
  { value: (profile) => profile.email },
  { value: (profile) => profile.cellphone },
  { value: (profile) => profile.otherPhone },
  { value: (profile) => profile.socialMediaType },
  { value: (profile) => profile.socialMediaDetail },
  { value: (profile) => profile.presentAddress },
  { value: (profile) => profile.zipCode },
  { value: (profile) => profile.permanentAddress },
  { value: (profile) => profile.employeeType },
  { value: (profile) => profile.username },
  { value: (profile) => profile.tin },
  { value: (profile) => profile.sss },
  { value: (profile) => profile.pagibig },
  { value: (profile) => profile.philhealth },
  { value: (profile) => profile.bankType },
  { value: (profile) => profile.accountNo },
  { value: (profile) => profile.elementarySchool },
  { value: (profile) => profile.elementaryYear },
  { value: (profile) => profile.secondarySchool },
  { value: (profile) => profile.secondaryYear },
  { value: (profile) => profile.collegeSchool },
  { value: (profile) => profile.collegeYear },
  { value: (profile) => profile.collegeCourse },
  { value: (profile) => profile.yearGraduated },
  { value: (profile) => profile.fatherName },
  { value: (profile) => profile.fatherOccupation },
  { value: (profile) => profile.motherMaidenName },
  { value: (profile) => profile.motherOccupation },
  { value: (profile) => profile.numberOfSiblings },
  { value: (profile) => profile.birthOrder },
  { value: (profile) => profile.emergencyContact },
  { value: (profile) => profile.emergencyContactNo },
  { value: (profile) => profile.spouseName, applies: hasSpouseFields },
  { value: (profile) => profile.spouseOccupation, applies: hasSpouseFields },
  { value: (profile) => profile.spouseContact, applies: hasSpouseFields },
  { value: (profile) => profile.childrenCount, applies: hasChildrenFields },
  { value: (profile) => profile.childrenNames, applies: hasChildrenFields },
];

function hasProfileValue(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function hasSpouseFields(profile: EmployeeProfileSummary) {
  return normalizeCompletionText(profile.civilStatus) === 'married';
}

function hasChildrenFields(profile: EmployeeProfileSummary) {
  const count = Number.parseInt(String(profile.childrenCount ?? '').trim(), 10);
  return (Number.isFinite(count) && count > 0) || hasProfileValue(profile.childrenNames);
}

function normalizeCompletionText(value?: string | null) {
  return String(value ?? '').trim().toLowerCase();
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
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  quickActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#facc15',
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: spacing.sm,
    gap: 6,
  },
  quickActionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  quickActionDisabled: {
    opacity: 0.52,
  },
  quickActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    color: colors.brand.ink,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
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
    flexWrap: 'nowrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metricCard: {
    flex: 1,
    minHeight: 142,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  metricCardCompact: {
    minHeight: 126,
    padding: spacing.sm,
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
    fontSize: 22,
    lineHeight: 27,
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
  perkUsageText: {
    flex: 1,
    minWidth: 0,
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
    flexShrink: 1,
    maxWidth: '48%',
    textAlign: 'right',
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
