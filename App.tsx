import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { PickerField, SelectButton } from './src/components/formControls';
import { ProfilePanel, RequestTile, SummaryCard } from './src/components/portalCards';
import {
  dayOffOptions,
  leaveCategoryOptions,
  leaveTypeOptions,
  payrollClassOptions,
  requestLabels,
  scheduleOptions,
} from './src/constants/requestOptions';
import { isSupabaseConfigured, supabase } from './src/lib/supabase';
import { decideApprovalStep, loadPendingApprovals, type PendingApproval } from './src/services/approvals';
import { loadDashboardSummary, type DashboardSummary } from './src/services/dashboard';
import { loadEmployeeProfile } from './src/services/profile';
import { loadMyRequests, type MyRequest } from './src/services/requests';
import { CreateEmployeeProfileScreen } from './src/screens/CreateEmployeeProfileScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { colors, spacing } from './src/theme';
import type { ProfileLoadResult, RequestTypeCode } from './src/types/domain';
import {
  calculateLeaveDays,
  dateStringToDate,
  formatDateInput,
  formatTimeDisplay,
  formatTimeInput,
  timeStringToDate,
} from './src/utils/dateTime';
import {
  calculateRequestHours,
  getDisabledLeaveTypes,
  getHoursHint,
  getLeaveBreakdown,
} from './src/utils/requestCalculations';

type PortalTab = 'home' | 'requests' | 'approvals' | 'profile';
type PublicScreen = 'login' | 'create_profile';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedInUser, setSignedInUser] = useState<User | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileLoadResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoginErrors, setShowLoginErrors] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({
    pending_requests: 0,
    pending_approvals: 0,
    offset_balance: 0,
    leave_credit_remaining: 7,
  });
  const [dashboardStatus, setDashboardStatus] = useState('');
  const [activeRequestType, setActiveRequestType] = useState<RequestTypeCode | null>(null);
  const [activeTab, setActiveTab] = useState<PortalTab>('home');
  const [publicScreen, setPublicScreen] = useState<PublicScreen>('login');

  async function loadProfileForUser(user: User) {
    setIsLoadingProfile(true);
    const result = await loadEmployeeProfile(user.id);
    setProfileResult(result);
    setIsLoadingProfile(false);
  }

  async function refreshDashboard() {
    setDashboardStatus('Refreshing dashboard...');
    try {
      const summary = await loadDashboardSummary();
      setDashboardSummary(summary);
      setDashboardStatus('');
    } catch (error) {
      setDashboardStatus(error instanceof Error ? error.message : 'Unable to refresh dashboard.');
    }
  }

  async function signIn() {
    if (!isSupabaseConfigured) {
      Alert.alert('Supabase is not configured', 'Check the mobile .env file.');
      return;
    }
    if (!email.trim() || !password) {
      setShowLoginErrors(true);
      return;
    }

    setShowLoginErrors(false);
    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setIsSubmitting(false);

    if (error) {
      Alert.alert('Login failed', error.message);
      return;
    }

    if (data.user) {
      setPublicScreen('login');
      setSignedInUser(data.user);
      await loadProfileForUser(data.user);
      await refreshDashboard();
    }
  }

  if (signedInUser) {
    const tabBar = <PortalTabBar activeTab={activeTab} onChange={setActiveTab} />;

    if (activeTab === 'requests') {
      return <MyRequestsScreen onBack={() => setActiveTab('home')} footer={tabBar} />;
    }

    if (activeTab === 'approvals') {
      return <ApprovalsScreen onBack={() => setActiveTab('home')} footer={tabBar} />;
    }

    if (activeTab === 'profile') {
      return (
        <ProfileScreen
          user={signedInUser}
          isLoading={isLoadingProfile}
          result={profileResult}
          onRefresh={() => loadProfileForUser(signedInUser)}
          onSignOut={async () => {
            await supabase.auth.signOut();
            setSignedInUser(null);
            setProfileResult(null);
            setActiveTab('home');
            setDashboardSummary({
              pending_requests: 0,
              pending_approvals: 0,
              offset_balance: 0,
              leave_credit_remaining: 7,
            });
          }}
          footer={tabBar}
        />
      );
    }

    if (activeRequestType) {
      return (
        <TimeRequestScreen
          requestType={activeRequestType}
          leaveCreditRemaining={dashboardSummary.leave_credit_remaining}
          onCancel={() => setActiveRequestType(null)}
          onSubmitted={async () => {
            setActiveRequestType(null);
            await refreshDashboard();
          }}
        />
      );
    }

    return (
      <View style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.header}>
            <Text style={styles.kicker}>New HYG Portal</Text>
            <Text style={styles.title}>Employee Center</Text>
            <Text style={styles.subtitle}>
              Signed in as {signedInUser.email ?? 'Employee'}.
            </Text>
          </View>

          <ProfilePanel
            isLoading={isLoadingProfile}
            result={profileResult}
            onRefresh={() => loadProfileForUser(signedInUser)}
          />

          <View style={styles.summaryGrid}>
            <SummaryCard label="Pending Requests" value={String(dashboardSummary.pending_requests)} />
            <SummaryCard label="For Approval" value={String(dashboardSummary.pending_approvals)} />
            <SummaryCard label="Offset Balance" value={`${dashboardSummary.offset_balance.toFixed(1)}h`} />
            <SummaryCard label="Leave Credit" value={`${dashboardSummary.leave_credit_remaining.toFixed(1)}d`} />
          </View>

          <Pressable style={styles.secondaryButton} onPress={refreshDashboard}>
            <Text style={styles.secondaryButtonText}>Refresh Dashboard</Text>
          </Pressable>

          {dashboardStatus ? <Text style={styles.submitStatus}>{dashboardStatus}</Text> : null}

          <View style={styles.requestGrid}>
            <RequestTile title="Overtime" detail="2 approvers" onPress={() => setActiveRequestType('overtime')} />
            <RequestTile title="Offset Earn" detail="2 approvers" onPress={() => setActiveRequestType('offset_earn')} />
            <RequestTile title="Use Offset" detail="1 approver" onPress={() => setActiveRequestType('use_offset')} />
            <RequestTile title="Leave" detail="1 approver" onPress={() => setActiveRequestType('leave')} />
          </View>

          {tabBar}
        </ScrollView>
      </View>
    );
  }

  if (publicScreen === 'create_profile') {
    return <CreateEmployeeProfileScreen onBack={() => setPublicScreen('login')} />;
  }

  return (
    <LoginScreen
      email={email}
      password={password}
      isSubmitting={isSubmitting}
      emailError={showLoginErrors && !email.trim() ? 'Required' : ''}
      passwordError={showLoginErrors && !password ? 'Required' : ''}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={signIn}
      onCreateProfile={() => setPublicScreen('create_profile')}
    />
  );
}

function MyRequestsScreen({ onBack, footer }: { onBack: () => void; footer?: ReactNode }) {
  const [items, setItems] = useState<MyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading requests...');
    try {
      const requests = await loadMyRequests();
      setItems(requests);
      setStatus(requests.length ? `${requests.length} request(s) found.` : 'No requests yet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load requests.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Employee</Text>
          <Text style={styles.title}>My Requests</Text>
          <Text style={styles.subtitle}>Track status and approval progress for submitted requests.</Text>
        </View>

        <Pressable disabled={isLoading} style={styles.primaryButton} onPress={refresh}>
          <Text style={styles.primaryButtonText}>{isLoading ? 'Loading...' : 'Refresh My Requests'}</Text>
        </Pressable>

        {status ? <Text style={styles.submitStatus}>{status}</Text> : null}

        {items.map((item) => (
          <View key={item.request_id} style={styles.approvalCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.profileTitle}>{item.request_type_name}</Text>
              <Text style={[styles.statusPill, styles[`status_${statusKey(item.status)}`]]}>{item.status}</Text>
            </View>
            <Text style={styles.profileMuted}>
              {item.request_type_code === 'leave'
                ? `${item.start_date} to ${item.end_date} | ${item.total_days ?? 0} day(s)`
                : `${item.date_from} ${item.time_from} to ${item.time_to} | ${item.total_hours ?? 0}h`}
            </Text>
            {item.request_type_code === 'leave' ? (
              <Text style={styles.profileMuted}>
                {item.leave_type} | {item.leave_category} | Paid {item.paid_days ?? 0}d | Unpaid {item.unpaid_days ?? 0}d
              </Text>
            ) : null}
            <Text style={styles.profileMuted}>{item.reason || 'No reason provided.'}</Text>

            <View style={styles.timeline}>
              {item.approval_summary.map((step) => (
                <View key={`${item.request_id}-${step.step_order}`} style={styles.timelineItem}>
                  <Text style={styles.timelineTitle}>
                    Step {step.step_order} | Level {step.required_level} | {step.status}
                  </Text>
                  <Text style={styles.timelineText}>
                    {step.approver_name || step.skipped_reason || 'No approver assigned'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>

        {footer}
      </ScrollView>
    </View>
  );
}

function statusKey(status: string) {
  if (status === 'approved') {
    return 'approved';
  }
  if (status === 'rejected') {
    return 'rejected';
  }
  if (status === 'needs_admin_review') {
    return 'review';
  }
  return 'pending';
}

function ApprovalsScreen({ onBack, footer }: { onBack: () => void; footer?: ReactNode }) {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading approvals...');
    try {
      const approvals = await loadPendingApprovals();
      setItems(approvals);
      setStatus(approvals.length ? `${approvals.length} pending approval(s).` : 'No pending approvals.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load approvals.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function decide(item: PendingApproval, decision: 'approved' | 'rejected') {
    setStatus(`${decision === 'approved' ? 'Approving' : 'Rejecting'} request...`);
    try {
      await decideApprovalStep(
        item.step_id,
        decision,
        decision === 'rejected' ? 'Rejected from mobile test.' : 'Approved from mobile test.',
      );
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update approval.');
    }
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Approvals</Text>
          <Text style={styles.title}>Inbox</Text>
          <Text style={styles.subtitle}>Approve or reject requests assigned to your employee profile.</Text>
        </View>

        <Pressable disabled={isLoading} style={styles.primaryButton} onPress={refresh}>
          <Text style={styles.primaryButtonText}>{isLoading ? 'Loading...' : 'Refresh Pending Approvals'}</Text>
        </Pressable>

        {status ? <Text style={styles.submitStatus}>{status}</Text> : null}

        {items.map((item) => (
          <View key={item.step_id} style={styles.approvalCard}>
            <Text style={styles.profileTitle}>{item.request_type_name}</Text>
            <Text style={styles.profileMuted}>
              {item.requester_name} {item.requester_employee_no ? `(${item.requester_employee_no})` : ''}
            </Text>
            {item.request_type_code === 'leave' ? (
              <>
                <Text style={styles.profileMuted}>
                  {item.start_date} to {item.end_date} | {item.total_days ?? 0} day(s)
                </Text>
                <Text style={styles.profileMuted}>
                  {item.leave_type} | {item.leave_category} | Paid {item.paid_days ?? 0}d | Unpaid {item.unpaid_days ?? 0}d
                </Text>
              </>
            ) : (
              <Text style={styles.profileMuted}>
                {item.date_from} {item.time_from} to {item.time_to} | {item.total_hours ?? 0}h
              </Text>
            )}
            <Text style={styles.profileMuted}>{item.reason || 'No reason provided.'}</Text>
            <View style={styles.approvalActions}>
              <Pressable style={styles.approveButton} onPress={() => decide(item, 'approved')}>
                <Text style={styles.approveButtonText}>Approve</Text>
              </Pressable>
              <Pressable style={styles.rejectButton} onPress={() => decide(item, 'rejected')}>
                <Text style={styles.rejectButtonText}>Reject</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>

        {footer}
      </ScrollView>
    </View>
  );
}

function ProfileScreen({
  user,
  isLoading,
  result,
  onRefresh,
  onSignOut,
  footer,
}: {
  user: User;
  isLoading: boolean;
  result: ProfileLoadResult | null;
  onRefresh: () => void;
  onSignOut: () => void;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Employee</Text>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Signed in as {user.email ?? 'Employee'}.</Text>
        </View>

        <ProfilePanel isLoading={isLoading} result={result} onRefresh={onRefresh} />

        <Pressable style={styles.secondaryButton} onPress={onSignOut}>
          <Text style={styles.secondaryButtonText}>Sign Out</Text>
        </Pressable>

        {footer}
      </ScrollView>
    </View>
  );
}

function PortalTabBar({
  activeTab,
  onChange,
}: {
  activeTab: PortalTab;
  onChange: (tab: PortalTab) => void;
}) {
  return (
    <View style={styles.tabBar}>
      <TabButton label="Home" active={activeTab === 'home'} onPress={() => onChange('home')} />
      <TabButton label="Requests" active={activeTab === 'requests'} onPress={() => onChange('requests')} />
      <TabButton label="Approvals" active={activeTab === 'approvals'} onPress={() => onChange('approvals')} />
      <TabButton label="Profile" active={activeTab === 'profile'} onPress={() => onChange('profile')} />
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TimeRequestScreen({
  requestType,
  leaveCreditRemaining,
  onCancel,
  onSubmitted,
}: {
  requestType: RequestTypeCode;
  leaveCreditRemaining: number;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [timeFrom, setTimeFrom] = useState('18:00');
  const [timeTo, setTimeTo] = useState('20:00');
  const [reason, setReason] = useState('');
  const [timeSchedule, setTimeSchedule] = useState('9:00AM - 6:00PM');
  const [dayOff, setDayOff] = useState('Sun');
  const [payrollClass, setPayrollClass] = useState('Rank and File');
  const [leaveType, setLeaveType] = useState('With Pay');
  const [leaveCategory, setLeaveCategory] = useState('Vacation Leave');
  const [paidLeaveDays, setPaidLeaveDays] = useState('1');
  const [unpaidLeaveDays, setUnpaidLeaveDays] = useState('0');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [activePicker, setActivePicker] = useState<'date_from' | 'date_to' | 'time_from' | 'time_to' | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const submitLockRef = useRef(false);

  const totalHours = calculateRequestHours({
    requestType,
    dateFrom,
    timeFrom,
    timeTo,
    timeSchedule,
    dayOff,
  });
  const totalLeaveDays = calculateLeaveDays(dateFrom, dateTo);
  const disabledLeaveTypes = getDisabledLeaveTypes(totalLeaveDays, leaveCreditRemaining);
  const leaveBreakdown = getLeaveBreakdown(leaveType, totalLeaveDays, paidLeaveDays, unpaidLeaveDays);

  useEffect(() => {
    if (requestType !== 'leave' || !disabledLeaveTypes.includes(leaveType)) {
      return;
    }

    setLeaveType(disabledLeaveTypes.includes('Both') ? 'Without Pay' : 'Both');
  }, [disabledLeaveTypes, leaveType, requestType]);

  useEffect(() => {
    if (requestType !== 'leave' || leaveType !== 'Both' || totalLeaveDays <= 0) {
      return;
    }

    const safePaidDays = Math.min(totalLeaveDays, Math.max(0, leaveCreditRemaining));
    setPaidLeaveDays(String(safePaidDays));
    setUnpaidLeaveDays(String(Math.round((totalLeaveDays - safePaidDays) * 100) / 100));
  }, [leaveCreditRemaining, leaveType, requestType, totalLeaveDays]);

  function valueForPicker(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to') {
    if (kind === 'date_to') {
      return dateStringToDate(dateTo);
    }
    if (kind === 'time_from') {
      return timeStringToDate(timeFrom);
    }
    if (kind === 'time_to') {
      return timeStringToDate(timeTo);
    }
    return dateStringToDate(dateFrom);
  }

  function openPicker(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to') {
    setTempPickerDate(valueForPicker(kind));
    setActivePicker(kind);
  }

  function applyPickerValue(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to', selectedDate: Date) {
    if (kind === 'date_from') {
      setDateFrom(formatDateInput(selectedDate));
    } else if (kind === 'date_to') {
      setDateTo(formatDateInput(selectedDate));
    } else if (kind === 'time_from') {
      setTimeFrom(formatTimeInput(selectedDate));
    } else if (kind === 'time_to') {
      setTimeTo(formatTimeInput(selectedDate));
    }
  }

  function pickerValue() {
    if (Platform.OS === 'ios') {
      return tempPickerDate;
    }
    if (activePicker === 'date_to') {
      return dateStringToDate(dateTo);
    }
    if (activePicker === 'time_from') {
      return timeStringToDate(timeFrom);
    }
    if (activePicker === 'time_to') {
      return timeStringToDate(timeTo);
    }
    return dateStringToDate(dateFrom);
  }

  function handlePickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setActivePicker(null);
      return;
    }

    if (!selectedDate || !activePicker) {
      return;
    }

    if (Platform.OS === 'ios') {
      setTempPickerDate(selectedDate);
      return;
    }

    applyPickerValue(activePicker, selectedDate);
    setActivePicker(null);
  }

  function confirmIosPicker() {
    if (activePicker) {
      applyPickerValue(activePicker, tempPickerDate);
    }
    setActivePicker(null);
  }

  async function submit() {
    if (submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setSubmitStatus('Preparing request...');
    if (requestType === 'leave') {
      if (!dateFrom || !dateTo || !leaveType.trim() || !leaveCategory.trim() || !reason.trim()) {
        Alert.alert('Missing details', 'Complete the leave dates, type, category, and reason.');
        setSubmitStatus('Missing leave details.');
        submitLockRef.current = false;
        return;
      }

      if (totalLeaveDays <= 0) {
        Alert.alert('Invalid dates', 'Date To must be the same as or later than Date From.');
        setSubmitStatus('Invalid leave dates.');
        submitLockRef.current = false;
        return;
      }

      if (!leaveBreakdown.isValid) {
        Alert.alert('Check leave days', `Paid and unpaid days must equal ${totalLeaveDays.toFixed(2)} total day(s).`);
        setSubmitStatus('Invalid leave day split.');
        submitLockRef.current = false;
        return;
      }

      if (leaveBreakdown.paidDays > leaveCreditRemaining) {
        Alert.alert(
          'Insufficient leave credit',
          `Available paid leave is ${leaveCreditRemaining.toFixed(2)} day(s). Use Without Pay or Both to continue.`,
        );
        setSubmitStatus('Insufficient paid leave credit.');
        submitLockRef.current = false;
        return;
      }

      setIsSubmittingRequest(true);
      setSubmitStatus('Submitting leave to Supabase...');
      const { data, error } = await supabase.rpc('submit_leave_request', {
        p_leave_type: leaveType.trim(),
        p_leave_category: leaveCategory.trim(),
        p_start_date: dateFrom,
        p_end_date: dateTo,
        p_paid_days: leaveBreakdown.paidDays,
        p_unpaid_days: leaveBreakdown.unpaidDays,
        p_reason: reason.trim(),
      });
      setIsSubmittingRequest(false);

      if (error) {
        setSubmitStatus(`Failed: ${error.message}`);
        Alert.alert('Request failed', error.message);
        submitLockRef.current = false;
        return;
      }

      setSubmitStatus(`Submitted. Request ID: ${data}`);
      Alert.alert('Request submitted', `Leave request created.\n\nID: ${data}`);
      onSubmitted();
      submitLockRef.current = false;
      return;
    }

    if (!dateFrom || !dateTo || !timeFrom || !timeTo || !timeSchedule || !dayOff || !payrollClass || !reason.trim()) {
      Alert.alert('Missing details', 'Complete schedule, day off, payroll class, date, time, and reason.');
      setSubmitStatus('Missing ESARF request details.');
      submitLockRef.current = false;
      return;
    }

    if (totalHours <= 0) {
      Alert.alert('Invalid time', 'Total hours must be greater than zero.');
      setSubmitStatus('Invalid total hours.');
      submitLockRef.current = false;
      return;
    }

    setIsSubmittingRequest(true);
    setSubmitStatus('Submitting to Supabase...');
    const { data, error } = await supabase.rpc('submit_time_request', {
      p_request_type_code: requestType,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_time_from: timeFrom,
      p_time_to: timeTo,
      p_total_hours: totalHours,
      p_reason: reason.trim(),
      p_time_schedule: timeSchedule,
      p_day_off: dayOff,
      p_payroll_class: payrollClass,
    });
    setIsSubmittingRequest(false);

    if (error) {
      setSubmitStatus(`Failed: ${error.message}`);
      Alert.alert('Request failed', error.message);
      submitLockRef.current = false;
      return;
    }

    setSubmitStatus(`Submitted. Request ID: ${data}`);
    Alert.alert('Request submitted', `${requestLabels[requestType]} request created.\n\nID: ${data}`);
    onSubmitted();
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.kicker}>New Request</Text>
          <Text style={styles.title}>{requestLabels[requestType]}</Text>
          <Text style={styles.subtitle}>
            This will create approval steps from your level, function, and scope.
          </Text>
        </View>

        <View style={styles.authCard}>
          <Text style={styles.inputLabel}>Date From</Text>
          <SelectButton label={dateFrom} onPress={() => openPicker('date_from')} />

          <Text style={styles.inputLabel}>Date To</Text>
          <SelectButton label={dateTo} onPress={() => openPicker('date_to')} />

          {requestType === 'leave' ? (
            <>
              <Text style={styles.inputLabel}>Leave Type</Text>
              <PickerField
                value={leaveType}
                onValueChange={setLeaveType}
                options={leaveTypeOptions}
                disabledOptions={disabledLeaveTypes}
              />

              <Text style={styles.inputLabel}>Leave Category</Text>
              <PickerField value={leaveCategory} onValueChange={setLeaveCategory} options={leaveCategoryOptions} />

              <Text style={styles.inputLabel}>Leave Days</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{totalLeaveDays.toFixed(2)} day(s)</Text>
                <Text style={styles.readOnlyHint}>
                  Available paid leave: {leaveCreditRemaining.toFixed(2)} day(s)
                  {disabledLeaveTypes.includes('With Pay') ? '. With Pay disabled for this date range.' : ''}
                </Text>
              </View>

              {leaveType === 'Both' ? (
                <>
                  <Text style={styles.inputLabel}>With Pay Days</Text>
                  <TextInput
                    value={paidLeaveDays}
                    onChangeText={setPaidLeaveDays}
                    keyboardType="decimal-pad"
                    placeholder="3"
                    placeholderTextColor="#94a3b8"
                    style={styles.input}
                  />

                  <Text style={styles.inputLabel}>Without Pay Days</Text>
                  <TextInput
                    value={unpaidLeaveDays}
                    onChangeText={setUnpaidLeaveDays}
                    keyboardType="decimal-pad"
                    placeholder="2"
                    placeholderTextColor="#94a3b8"
                    style={styles.input}
                  />
                </>
              ) : null}

              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>
                  With Pay {leaveBreakdown.paidDays.toFixed(2)}d | Without Pay {leaveBreakdown.unpaidDays.toFixed(2)}d
                </Text>
                <Text style={styles.readOnlyHint}>
                  With Pay deducts credits after final approval. Without Pay does not deduct credits.
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.inputLabel}>Time Schedule</Text>
              <PickerField
                value={timeSchedule}
                onValueChange={setTimeSchedule}
                options={scheduleOptions}
              />

              <Text style={styles.inputLabel}>Day Off</Text>
              <PickerField value={dayOff} onValueChange={setDayOff} options={dayOffOptions} />

              <Text style={styles.inputLabel}>Payroll Class</Text>
              <PickerField
                value={payrollClass}
                onValueChange={setPayrollClass}
                options={payrollClassOptions}
              />

              <Text style={styles.inputLabel}>Time From</Text>
              <SelectButton label={formatTimeDisplay(timeFrom)} onPress={() => openPicker('time_from')} />

              <Text style={styles.inputLabel}>Time To</Text>
              <SelectButton label={formatTimeDisplay(timeTo)} onPress={() => openPicker('time_to')} />

              <Text style={styles.inputLabel}>Total Hours</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{totalHours.toFixed(2)} hours</Text>
                <Text style={styles.readOnlyHint}>{getHoursHint(requestType, dateFrom, dayOff)}</Text>
              </View>
            </>
          )}

          <Text style={styles.inputLabel}>Reason</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="Reason for request"
            placeholderTextColor="#94a3b8"
            style={[styles.input, styles.textArea]}
          />

          <Pressable
            disabled={isSubmittingRequest}
            style={[styles.primaryButton, isSubmittingRequest && styles.disabledButton]}
            onPress={submit}
          >
            <Text style={styles.primaryButtonText}>
              {isSubmittingRequest ? 'Submitting...' : 'Submit Request'}
            </Text>
          </Pressable>

          <Pressable disabled={isSubmittingRequest} style={styles.secondaryButton} onPress={onCancel}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>

          {submitStatus ? <Text style={styles.submitStatus}>{submitStatus}</Text> : null}
        </View>

        {activePicker && Platform.OS === 'ios' ? (
          <Modal transparent animationType="fade" visible onRequestClose={() => setActivePicker(null)}>
            <View style={styles.modalBackdrop}>
              <View style={styles.iosPickerPanel}>
                <DateTimePicker
                  value={pickerValue()}
                  mode={activePicker.startsWith('date') ? 'date' : 'time'}
                  display="spinner"
                  is24Hour={false}
                  onChange={handlePickerChange}
                />
                <View style={styles.iosPickerActions}>
                  <Pressable style={styles.iosPickerCancel} onPress={() => setActivePicker(null)}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.iosPickerDone} onPress={confirmIosPicker}>
                    <Text style={styles.primaryButtonText}>Done</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : activePicker ? (
          <View>
            <DateTimePicker
              value={pickerValue()}
              mode={activePicker.startsWith('date') ? 'date' : 'time'}
              display="default"
              is24Hour={false}
              onChange={handlePickerChange}
            />
          </View>
        ) : null}
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
  header: {
    marginBottom: spacing.lg,
    paddingTop: spacing.lg,
  },
  kicker: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  debugText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  authCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
  },
  pickerShell: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  picker: {
    minHeight: 48,
    color: colors.text,
  },
  selectButton: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
  },
  selectButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    padding: spacing.md,
  },
  iosPickerPanel: {
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  iosPickerActions: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.sm,
  },
  iosPickerCancel: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  iosPickerDone: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginLeft: spacing.xs,
  },
  readOnlyField: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: '#f8fafc',
  },
  readOnlyText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  readOnlyHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  textArea: {
    minHeight: 92,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  submitStatus: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
  },
  tabButtonText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  tabButtonTextActive: {
    color: '#ffffff',
  },
  disabledButton: {
    opacity: 0.7,
  },
  summaryGrid: {
    marginTop: spacing.sm,
  },
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
  profileDebug: {
    color: '#475569',
    fontSize: 11,
    lineHeight: 16,
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
  requestGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
    marginHorizontal: -5,
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
  approvalCard: {
    borderRadius: 8,
    padding: spacing.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  approvalActions: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  approveButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#16a34a',
    marginRight: spacing.xs,
  },
  approveButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  rejectButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#dc2626',
    marginLeft: spacing.xs,
  },
  rejectButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  statusPill: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  status_pending: {
    backgroundColor: '#2563eb',
  },
  status_approved: {
    backgroundColor: '#16a34a',
  },
  status_rejected: {
    backgroundColor: '#dc2626',
  },
  status_review: {
    backgroundColor: '#f97316',
  },
  timeline: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  timelineItem: {
    marginBottom: spacing.sm,
  },
  timelineTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  timelineText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});
