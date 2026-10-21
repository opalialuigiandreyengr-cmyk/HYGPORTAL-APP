import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  Briefcase,
  CalendarDays,
  Compass,
  FileCheck,
  FileSpreadsheet,
  MapPin,
  Receipt,
  User,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import type { AppToastMessage } from '../components/AppToast';
import { colors, fontWeights, radius, spacing } from '../theme';
import { getScreenBottomPadding } from '../utils/safeArea';
import { supabase } from '../lib/supabase';
import { loadEmployeeProfile } from '../services/profile';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

export type FileOfficialTravelOrderScreenProps = {
  profileResult?: ProfileLoadResult | null;
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  companyName?: string | null;
  departmentName?: string | null;
  storeName?: string | null;
  positionName?: string | null;
  userEmail?: string | null;
  authUserId?: string | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onBack: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onRefresh?: () => void | Promise<void>;
  onSubmitted?: () => void | Promise<void>;
};

export function FileOfficialTravelOrderScreen({
  profileResult,
  name,
  username,
  photoUrl,
  employeeId,
  employeeName,
  companyName,
  departmentName,
  storeName,
  positionName,
  userEmail,
  authUserId,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onBack,
  onToast,
  onRefresh,
}: FileOfficialTravelOrderScreenProps) {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<EmployeeProfileSummary | null>(
    profileResult?.status === 'linked' ? profileResult.profile : null
  );

  useEffect(() => {
    if (profileResult?.status === 'linked') {
      setProfile(profileResult.profile);
    } else {
      let isMounted = true;
      (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const targetAuthId = authUserId || user?.id;
          if (targetAuthId) {
            const res = await loadEmployeeProfile(targetAuthId);
            if (isMounted && res.status === 'linked') {
              setProfile(res.profile);
            }
          }
        } catch (e) {
          console.warn('[FileOfficialTravelOrderScreen] Failed to auto-load profile:', e);
        }
      })();
      return () => {
        isMounted = false;
      };
    }
  }, [profileResult, authUserId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh?.();
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const targetAuthId = authUserId || user?.id;
        if (targetAuthId) {
          const res = await loadEmployeeProfile(targetAuthId);
          if (res.status === 'linked') {
            setProfile(res.profile);
          }
        }
      } catch (_) {}
    } finally {
      setRefreshing(false);
    }
  };

  const resolvedEmployeeName =
    profile?.fullName?.trim() ||
    employeeName?.trim() ||
    name?.trim() ||
    'Employee';

  const resolvedEmployeeId =
    profile?.employeeNo?.trim() ||
    profile?.employeeId?.trim() ||
    employeeId?.trim() ||
    'N/A';

  const resolvedCompany =
    profile?.companyName?.trim() ||
    companyName?.trim() ||
    'N/A';

  const resolvedDepartment =
    profile?.departmentName?.trim() ||
    departmentName?.trim() ||
    'N/A';

  const resolvedStore =
    profile?.storeName?.trim() ||
    storeName?.trim() ||
    'N/A';

  const resolvedPosition =
    profile?.positionName?.trim() ||
    positionName?.trim() ||
    'N/A';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={name}
        username={username}
        photoUrl={photoUrl}
        notificationCount={notificationCount}
        onBackHome={onBack}
        backTitle="Official Travel Order"
        onMessages={onAssistant}
        onNotifications={onNotifications}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: getScreenBottomPadding(insets.bottom, false, 48) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.brand.ink}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Employee Info Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <User size={16} color={colors.brand.ink} strokeWidth={2.4} />
              </View>
              <Text style={styles.cardTitle}>Applicant Details</Text>
            </View>

            <View style={styles.applicantGrid}>
              <View style={[styles.applicantItem, styles.applicantItemFull]}>
                <Text style={styles.applicantLabel}>Employee Name</Text>
                <Text style={styles.applicantValue} numberOfLines={2}>
                  {resolvedEmployeeName}
                </Text>
              </View>

              <View style={styles.applicantItem}>
                <Text style={styles.applicantLabel}>Employee ID</Text>
                <Text style={styles.applicantValue} numberOfLines={1}>
                  {resolvedEmployeeId}
                </Text>
              </View>

              <View style={styles.applicantItem}>
                <Text style={styles.applicantLabel}>Department</Text>
                <Text style={styles.applicantValue} numberOfLines={2}>
                  {resolvedDepartment}
                </Text>
              </View>

              <View style={styles.applicantItem}>
                <Text style={styles.applicantLabel}>Store</Text>
                <Text style={styles.applicantValue} numberOfLines={2}>
                  {resolvedStore}
                </Text>
              </View>

              <View style={styles.applicantItem}>
                <Text style={styles.applicantLabel}>Position</Text>
                <Text style={styles.applicantValue} numberOfLines={2}>
                  {resolvedPosition}
                </Text>
              </View>
            </View>
          </View>

          {/* Form Scaffold & Placeholder Outline */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <FileSpreadsheet size={16} color={colors.brand.ink} strokeWidth={2.4} />
              </View>
              <Text style={styles.cardTitle}>Upcoming Form Sections</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              The complete travel order form fields will be implemented here:
            </Text>

            <View style={styles.sectionsList}>
              <View style={styles.sectionItem}>
                <View style={styles.sectionIconBadge}>
                  <Compass size={16} color="#0284c7" strokeWidth={2.2} />
                </View>
                <View style={styles.sectionTextWrap}>
                  <Text style={styles.sectionTitle}>1. Purpose & Travel Category</Text>
                  <Text style={styles.sectionDesc}>
                    Official business reason, store audit, branch training, or client meeting.
                  </Text>
                </View>
              </View>

              <View style={styles.sectionItem}>
                <View style={styles.sectionIconBadge}>
                  <MapPin size={16} color="#d97706" strokeWidth={2.2} />
                </View>
                <View style={styles.sectionTextWrap}>
                  <Text style={styles.sectionTitle}>2. Destination & Venue</Text>
                  <Text style={styles.sectionDesc}>
                    Origin and destination branches, client sites, or official meeting venues.
                  </Text>
                </View>
              </View>

              <View style={styles.sectionItem}>
                <View style={styles.sectionIconBadge}>
                  <CalendarDays size={16} color="#7c3aed" strokeWidth={2.2} />
                </View>
                <View style={styles.sectionTextWrap}>
                  <Text style={styles.sectionTitle}>3. Departure & Return Schedule</Text>
                  <Text style={styles.sectionDesc}>
                    Inclusive travel dates, departure time, and expected return timestamp.
                  </Text>
                </View>
              </View>

              <View style={styles.sectionItem}>
                <View style={styles.sectionIconBadge}>
                  <Receipt size={16} color="#059669" strokeWidth={2.2} />
                </View>
                <View style={styles.sectionTextWrap}>
                  <Text style={styles.sectionTitle}>4. Expenses & Allowances</Text>
                  <Text style={styles.sectionDesc}>
                    Transportation mode (company vehicle/public), per diem, and meal budget.
                  </Text>
                </View>
              </View>

              <View style={styles.sectionItem}>
                <View style={styles.sectionIconBadge}>
                  <FileCheck size={16} color="#2563eb" strokeWidth={2.2} />
                </View>
                <View style={styles.sectionTextWrap}>
                  <Text style={styles.sectionTitle}>5. Endorsements & Approvals</Text>
                  <Text style={styles.sectionDesc}>
                    Supervisor review and operational approval routing.
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Under Construction Notice Card */}
          <View style={styles.noticeCard}>
            <AlertCircle size={20} color="#b45309" strokeWidth={2.2} />
            <View style={styles.noticeTextWrap}>
              <Text style={styles.noticeTitle}>Form Coming Soon</Text>
              <Text style={styles.noticeMessage}>
                The Official Travel Order form fields and database submission will be wired next.
                You can now access this screen directly from your Dashboard!
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.xs,
  },
  cardHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: spacing.sm,
    fontWeight: fontWeights.regular,
  },
  applicantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  applicantItem: {
    flex: 1,
    minWidth: 130,
    backgroundColor: '#f8fafc',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  applicantItemFull: {
    width: '100%',
    minWidth: '100%',
  },
  applicantLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: fontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  applicantValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: fontWeights.bold,
  },
  sectionsList: {
    gap: spacing.xs + 2,
  },
  sectionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sectionIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sectionTextWrap: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: colors.text,
    marginBottom: 2,
  },
  sectionDesc: {
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.muted,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#fffbeb',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
    padding: spacing.md,
  },
  noticeTextWrap: {
    flex: 1,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#92400e',
    marginBottom: 2,
  },
  noticeMessage: {
    fontSize: 12,
    lineHeight: 17,
    color: '#b45309',
  },
});
