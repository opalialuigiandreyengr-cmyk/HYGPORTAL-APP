import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { User } from '@supabase/supabase-js';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Activity, BriefcaseBusiness, ClipboardCheck, KeyRound, Layers3, ListChecks, LogOut, Route, ShieldCheck, UsersRound, X } from 'lucide-react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

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
import {
  assignDepartmentPosition,
  clearPositionAuthorityLevel,
  createAdminDepartment,
  createAdminPosition,
  loadAuthorityCandidates,
  loadAdminPositionCatalog,
  loadDepartmentApprovalLadders,
  loadDepartmentPositionCatalog,
  loadPositionAuthorityLevels,
  removeDepartmentPosition,
  setAuthorityAssignment,
  setDepartmentApprovalLadder,
  setPositionAuthorityLevel,
  type AdminPositionCatalogRow,
  type AuthorityCandidate,
  type DepartmentApprovalLadderRow,
  type DepartmentPositionCatalogRow,
  type PositionAuthorityLevel,
} from './src/services/admin';
import { loadDashboardSummary, type DashboardSummary } from './src/services/dashboard';
import { loadEmployeeProfile } from './src/services/profile';
import { resolveLoginEmail } from './src/services/registerAccount';
import { loadMyRequests, type MyRequest } from './src/services/requests';
import { AppToast, type AppToastMessage } from './src/components/AppToast';
import { ApplyEsarfScreen } from './src/screens/ApplyEsarfScreen';
import { CreateEmployeeProfileScreen } from './src/screens/CreateEmployeeProfileScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { ProfileTabScreen } from './src/screens/ProfileTabScreen';
import { RegisterAccountScreen } from './src/screens/RegisterAccountScreen';
import { RequestsTabScreen } from './src/screens/RequestsTabScreen';
import { BottomTabBar } from './src/components/BottomTabBar';
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
type PublicScreen = 'login' | 'create_profile' | 'register_account';
type AdminScreen = 'home' | 'authority' | 'departments' | 'routes' | 'approvers';
type QuickRequestScreen = 'apply_esarf';
const SUPER_ADMIN_EMAIL = 'hygportal@gmail.com';
const hygLogo = require('./assets/HYG LOGO.png');
const authorityLevelColors = [
  { background: '#dbeafe', text: '#1d4ed8' },
  { background: '#dcfce7', text: '#15803d' },
  { background: '#fef3c7', text: '#b45309' },
  { background: '#ede9fe', text: '#6d28d9' },
  { background: '#cffafe', text: '#0e7490' },
  { background: '#fce7f3', text: '#be185d' },
  { background: '#e2e8f0', text: '#334155' },
  { background: '#fee2e2', text: '#b91c1c' },
];

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedInUser, setSignedInUser] = useState<User | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileLoadResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoginErrors, setShowLoginErrors] = useState(false);
  const [appToast, setAppToast] = useState<AppToastMessage | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({
    pending_requests: 0,
    pending_approvals: 0,
    offset_balance: 0,
    leave_credit_remaining: 7,
  });
  const [dashboardStatus, setDashboardStatus] = useState('');
  const [activeRequestType, setActiveRequestType] = useState<RequestTypeCode | null>(null);
  const [activeQuickRequestScreen, setActiveQuickRequestScreen] = useState<QuickRequestScreen | null>(null);
  const [activeTab, setActiveTab] = useState<PortalTab>('home');
  const [publicScreen, setPublicScreen] = useState<PublicScreen>('login');
  const [adminScreen, setAdminScreen] = useState<AdminScreen>('home');

  const dismissAppToast = useCallback(() => {
    setAppToast(null);
  }, []);

  function withToast(screen: ReactNode) {
    return (
      <SafeAreaProvider>
        <View style={styles.appShell}>
          {screen}
          <AppToast toast={appToast} onDismiss={dismissAppToast} />
        </View>
      </SafeAreaProvider>
    );
  }

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
      setAppToast({
        tone: 'warning',
        title: 'Login unavailable',
        message: 'Supabase is not configured. Check the mobile .env file.',
      });
      return;
    }
    if (!email.trim() || !password) {
      setShowLoginErrors(true);
      return;
    }

    setShowLoginErrors(false);
    setIsSubmitting(true);

    let loginEmail = '';
    try {
      loginEmail = await resolveLoginEmail(email);
    } catch (error) {
      setIsSubmitting(false);
      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('no login account')) {
        setAppToast({
          tone: 'warning',
          title: 'Account not found',
          message: 'No login account found for this username. Register your account first.',
        });
      } else {
        setAppToast({
          tone: 'error',
          title: 'Login failed',
          message: message || 'Unable to verify username. Please try again.',
        });
      }
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    setIsSubmitting(false);

    if (error) {
      setAppToast({
        tone: 'error',
        title: 'Wrong password',
        message: 'Password is incorrect.',
      });
      return;
    }

    if (data.user) {
      setAppToast({
        tone: 'success',
        title: 'Login successful',
        message: 'Welcome back to HYG Portal.',
      });
      setPublicScreen('login');
      setSignedInUser(data.user);
      if ((data.user.email ?? '').toLowerCase() !== SUPER_ADMIN_EMAIL) {
        await loadProfileForUser(data.user);
        await refreshDashboard();
      }
    }
  }

  if (signedInUser) {
    if ((signedInUser.email ?? '').toLowerCase() === SUPER_ADMIN_EMAIL) {
      if (adminScreen === 'authority') {
        return withToast(<AdminAuthorityScreen onBack={() => setAdminScreen('home')} />);
      }

      if (adminScreen === 'departments') {
        return withToast(<AdminDepartmentsScreen onBack={() => setAdminScreen('home')} />);
      }

      if (adminScreen === 'routes') {
        return withToast(<AdminRoutesScreen onBack={() => setAdminScreen('home')} />);
      }

      if (adminScreen === 'approvers') {
        return withToast(<AdminApproversScreen onBack={() => setAdminScreen('home')} />);
      }

      return withToast(
        <AdminHomeScreen
          onOpenAuthority={() => setAdminScreen('authority')}
          onOpenDepartments={() => setAdminScreen('departments')}
          onOpenRoutes={() => setAdminScreen('routes')}
          onOpenApprovers={() => setAdminScreen('approvers')}
          onSignOut={async () => {
            await supabase.auth.signOut();
            setSignedInUser(null);
            setProfileResult(null);
            setActiveTab('home');
            setActiveQuickRequestScreen(null);
            setAdminScreen('home');
          }}
        />,
      );
    }

    if (activeRequestType) {
      return withToast(
        <TimeRequestScreen
          requestType={activeRequestType}
          leaveCreditRemaining={dashboardSummary.leave_credit_remaining}
          onCancel={() => setActiveRequestType(null)}
          onSubmitted={async () => {
            setActiveRequestType(null);
            await refreshDashboard();
          }}
        />,
      );
    }

    if (activeQuickRequestScreen === 'apply_esarf') {
      return withToast(
        <ApplyEsarfScreen
          initials={profileResult?.status === 'linked'
            ? profileResult.profile.fullName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
            : (signedInUser.email ?? 'U').slice(0, 2).toUpperCase()}
          onBack={() => setActiveQuickRequestScreen(null)}
          onSubmitted={async () => {
            setActiveQuickRequestScreen(null);
            await refreshDashboard();
          }}
        />,
      );
    }

    const signOut = async () => {
      await supabase.auth.signOut();
      setSignedInUser(null);
      setProfileResult(null);
      setActiveTab('home');
      setActiveQuickRequestScreen(null);
      setDashboardSummary({ pending_requests: 0, pending_approvals: 0, offset_balance: 0, leave_credit_remaining: 7 });
    };

    let tabContent: ReactNode = null;
    if (activeTab === 'requests') {
      tabContent = <RequestsTabScreen />;
    } else if (activeTab === 'approvals') {
      tabContent = <NotificationsScreen />;
    } else if (activeTab === 'profile') {
      tabContent = (
        <ProfileTabScreen
          email={signedInUser.email ?? ''}
          username={email}
          isLoading={isLoadingProfile}
          result={profileResult}
          onToast={setAppToast}
          onSignOut={signOut}
        />
      );
    } else {
      tabContent = (
        <DashboardScreen
          userEmail={signedInUser.email ?? 'Employee'}
          summary={dashboardSummary}
          profileResult={profileResult}
          isLoadingProfile={isLoadingProfile}
          onRefreshDashboard={refreshDashboard}
          onRefreshProfile={() => loadProfileForUser(signedInUser)}
          onRequestType={setActiveRequestType}
        />
      );
    }

    return withToast(
      <View style={{ flex: 1 }}>
        {tabContent}
        <BottomTabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          onApplyEsarf={() => setActiveQuickRequestScreen('apply_esarf')}
        />
      </View>,
    );
  }

  if (publicScreen === 'create_profile') {
    return withToast(<CreateEmployeeProfileScreen onBack={() => setPublicScreen('login')} />);
  }

  if (publicScreen === 'register_account') {
    return withToast(<RegisterAccountScreen onBack={() => setPublicScreen('login')} />);
  }

  return withToast(
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
      onRegisterAccount={() => setPublicScreen('register_account')}
    />,
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

function AdminHomeScreen({
  onOpenAuthority,
  onOpenDepartments,
  onOpenRoutes,
  onOpenApprovers,
  onSignOut,
}: {
  onOpenAuthority: () => void;
  onOpenDepartments: () => void;
  onOpenRoutes: () => void;
  onOpenApprovers: () => void;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.adminSafeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.adminPage} showsVerticalScrollIndicator={false}>
        <View style={styles.adminTopBar}>
          <View style={styles.adminBrandRow}>
            <View style={styles.adminLogoFrame}>
              <Image source={hygLogo} style={styles.adminLogo} resizeMode="contain" />
            </View>
            <View style={styles.adminBrandText}>
              <Text style={styles.adminKicker}>HYG Admin</Text>
              <Text style={styles.adminTitle}>Dashboard</Text>
            </View>
          </View>
          <View style={styles.adminRoleBadge}>
            <Text style={styles.adminRoleBadgeText}>Admin</Text>
          </View>
        </View>

        <View style={styles.adminStatsGrid}>
          <AdminMetric icon={<UsersRound size={18} color={colors.primary} strokeWidth={2.5} />} label="Employees" value="Live" detail="Profiles and assignments" />
          <AdminMetric icon={<KeyRound size={18} color={colors.primary} strokeWidth={2.5} />} label="Accounts" value="Active" detail="Portal users" />
          <AdminMetric icon={<ClipboardCheck size={18} color={colors.primary} strokeWidth={2.5} />} label="Requests" value="Open" detail="Pending workflow" />
        </View>

        <View style={styles.adminStatsGrid}>
          <AdminMetric icon={<Route size={18} color={colors.primary} strokeWidth={2.5} />} label="Approvals" value="Ready" detail="Routing matrix" />
          <AdminMetric icon={<ListChecks size={18} color={colors.primary} strokeWidth={2.5} />} label="Audit" value="Tracked" detail="System activity" />
          <AdminMetric icon={<Activity size={18} color={colors.primary} strokeWidth={2.5} />} label="Health" value="Good" detail="Portal status" />
        </View>

        <View style={styles.adminSection}>
          <Text style={styles.adminSectionTitle}>Approval Controls</Text>
          <AdminAction icon={<Route size={19} color={colors.primary} strokeWidth={2.5} />} title="Approval Routes" detail="Design approver levels by department and requester level." accent="gold" onPress={onOpenRoutes} />
          <AdminAction icon={<ShieldCheck size={19} color={colors.primary} strokeWidth={2.5} />} title="Authority Levels" detail="Tick the approval level assigned to each position." accent="blue" onPress={onOpenAuthority} />
          <AdminAction icon={<UsersRound size={19} color={colors.primary} strokeWidth={2.5} />} title="Approver Assignments" detail="Choose which employee approves for each department level." accent="green" onPress={onOpenApprovers} />
          <AdminAction icon={<ClipboardCheck size={19} color={colors.primary} strokeWidth={2.5} />} title="Admin Review Queue" detail="Resolve requests where the system cannot find a matching approver." accent="red" />
        </View>

        <View style={styles.adminSection}>
          <Text style={styles.adminSectionTitle}>Employee Management</Text>
          <AdminAction icon={<KeyRound size={19} color={colors.primary} strokeWidth={2.5} />} title="Employee Access" detail="Review linked accounts and employee portal access." accent="green" />
          <AdminAction icon={<UsersRound size={19} color={colors.primary} strokeWidth={2.5} />} title="Departments & Positions" detail="Create departments and assign the positions allowed under each one." accent="blue" onPress={onOpenDepartments} />
        </View>

        <View style={styles.adminSection}>
          <Text style={styles.adminSectionTitle}>Activity Log</Text>
          <View style={styles.auditPanel}>
            <AuditLogItem title="Employee profile created" detail="New profile records and assignments will appear here." />
            <AuditLogItem title="Approver route updated" detail="Changes to approval levels and routing can be reviewed." />
            <AuditLogItem title="Login account registered" detail="User account linking and access events are tracked." />
          </View>
        </View>

        <Pressable style={styles.adminSignOutButton} onPress={onSignOut}>
          <LogOut size={17} color={colors.text} strokeWidth={2.5} />
          <Text style={styles.adminSignOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function AdminMetric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <View style={styles.adminMetric}>
      <View style={styles.adminMetricIcon}>{icon}</View>
      <Text style={styles.adminMetricLabel}>{label}</Text>
      <Text style={styles.adminMetricValue}>{value}</Text>
      <Text style={styles.adminMetricDetail}>{detail}</Text>
    </View>
  );
}

function AdminAction({
  title,
  detail,
  accent,
  icon,
  onPress,
}: {
  title: string;
  detail: string;
  accent: 'gold' | 'blue' | 'green' | 'red';
  icon: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.adminAction} onPress={onPress}>
      <View style={[styles.adminActionAccent, styles[`adminAccent_${accent}`]]} />
      <View style={styles.adminActionIcon}>{icon}</View>
      <View style={styles.adminActionText}>
        <Text style={styles.adminActionTitle}>{title}</Text>
        <Text style={styles.adminActionDetail}>{detail}</Text>
      </View>
      <Text style={styles.adminActionChevron}>›</Text>
    </Pressable>
  );
}

function AuditLogItem({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.auditItem}>
      <View style={styles.auditDot} />
      <View style={styles.auditText}>
        <Text style={styles.auditTitle}>{title}</Text>
        <Text style={styles.auditDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function AdminRoutesScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<DepartmentApprovalLadderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading approver routes...');
    try {
      const ladders = await loadDepartmentApprovalLadders();
      setRows(ladders);
      setStatus(ladders.length ? `${ladders.length} approver route(s) loaded.` : 'No departments found.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load approver routes.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleLevel(row: DepartmentApprovalLadderRow, level: number) {
    const current = row.route_levels || [];
    const next = current.includes(level)
      ? current.filter((item) => item !== level)
      : [...current, level].sort((a, b) => a - b);

    if (!next.length) {
      setStatus(`${row.department_name} needs at least one level.`);
      return;
    }

    setRows((existing) =>
      existing.map((item) =>
        item.department_id === row.department_id
          ? { ...item, route_levels: next }
          : item,
      ),
    );

    const key = row.department_id;
    setSavingKey(key);
    setStatus(`Saving ${row.department_name} approver route...`);
    try {
      await setDepartmentApprovalLadder(row.department_id, next);
      setStatus(`${row.department_name}: ${next.map((item) => `L${item}`).join(' -> ')}`);
    } catch (error) {
      setRows((existing) =>
        existing.map((item) =>
          item.department_id === row.department_id
            ? { ...item, route_levels: current }
            : item,
        ),
      );
      setStatus(error instanceof Error ? error.message : 'Unable to save approver route.');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <View style={styles.adminSafeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.adminPage} showsVerticalScrollIndicator={false}>
        <View style={styles.toolTopBar}>
          <Pressable style={styles.toolBackButton} onPress={onBack}>
            <Text style={styles.toolBackText}>Back</Text>
          </Pressable>
          <Text style={styles.toolTopTitle}>Approval Routes</Text>
        </View>

        <View style={styles.toolHeaderCard}>
          <View style={styles.toolHeaderIcon}>
            <Route size={22} color={colors.brand.ink} strokeWidth={2.6} />
          </View>
          <View style={styles.toolHeaderText}>
            <Text style={styles.toolEyebrow}>Routing Setup</Text>
            <Text style={styles.toolTitle}>Approver Routes</Text>
            <Text style={styles.toolSubtitle}>Choose the approval levels available in each department.</Text>
          </View>
          <Pressable disabled={isLoading} style={styles.toolRefreshButton} onPress={refresh}>
            <Text style={styles.toolRefreshText}>{isLoading ? '...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {status ? <Text style={styles.adminStatus}>{status}</Text> : null}

        <View style={styles.authorityGuideCard}>
          <Text style={styles.authorityGuideTitle}>How routing works</Text>
          <Text style={styles.authorityGuideText}>Tap a level to include or remove it. Changes save immediately. If IT has L1, L3, L7, L8, a Level 1 request goes to L3 first, then L7.</Text>
        </View>

        {rows.map((department) => (
          <View key={department.department_id} style={styles.routeDepartmentCard}>
            <View style={styles.departmentHeader}>
              <View style={styles.routeDepartmentTitleBlock}>
                <Text style={styles.departmentTitle}>{department.department_name}</Text>
              </View>
              {savingKey === department.department_id ? (
                <View style={styles.routeSavingPill}>
                  <Text style={styles.routeSavingText}>Saving</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.routePath}>
              {(department.route_levels || []).length ? (
                department.route_levels.map((level, index) => (
                  <View key={level} style={styles.routePathItem}>
                    {index > 0 ? <Text style={styles.routePathArrow}>›</Text> : null}
                    <View style={styles.routePathNode}>
                      <Text style={styles.routePathNodeText}>L{level}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.routePathEmpty}>Tap levels below to build the route.</Text>
              )}
            </View>

            <View style={styles.routeLadderChoices}>
              {Array.from({ length: 8 }).map((_, index) => {
                const level = index + 1;
                const active = (department.route_levels || []).includes(level);
                return (
                  <Pressable
                    key={level}
                    disabled={Boolean(savingKey)}
                    style={[
                      styles.routeLadderChip,
                      active ? styles.routeLadderChipActive : null,
                      savingKey && savingKey !== department.department_id ? styles.routeLadderChipDisabled : null,
                    ]}
                    onPress={() => toggleLevel(department, level)}
                  >
                    <Text style={[styles.routeLadderChipText, active ? styles.routeLadderChipTextActive : null]}>
                      L{level}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function AdminApproversScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<AuthorityCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading approvers...');
    try {
      const candidates = await loadAuthorityCandidates();
      setItems(candidates);
      setStatus(candidates.length ? `${candidates.length} employee(s) found.` : 'No employees found.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load approvers.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const departments = items.reduce<Array<{ key: string; name: string; employees: AuthorityCandidate[] }>>(
    (groups, item) => {
      const key = item.department_id || item.function_id || 'unassigned';
      let group = groups.find((candidate) => candidate.key === key);
      if (!group) {
        group = {
          key,
          name: item.department_name || item.function_name || 'Unassigned',
          employees: [],
        };
        groups.push(group);
      }
      group.employees.push(item);
      return groups;
    },
    [],
  );

  async function setAsApprover(item: AuthorityCandidate) {
    if (!item.position_level) {
      setStatus(`${item.position_name} needs an authority level first.`);
      return;
    }

    const key = `${item.employee_id}-${item.function_id}`;
    setSavingKey(key);
    setStatus(`Saving ${item.full_name} as L${item.position_level} approver...`);
    try {
      await setAuthorityAssignment(item.employee_id, item.function_id, item.position_level);
      setItems((current) =>
        current.map((candidate) =>
          candidate.employee_id === item.employee_id && candidate.function_id === item.function_id
            ? { ...candidate, current_authority_level: item.position_level }
            : candidate,
        ),
      );
      setStatus(`${item.full_name} is now L${item.position_level} approver.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save approver.');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <View style={styles.adminSafeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.adminPage} showsVerticalScrollIndicator={false}>
        <View style={styles.toolTopBar}>
          <Pressable style={styles.toolBackButton} onPress={onBack}>
            <Text style={styles.toolBackText}>Back</Text>
          </Pressable>
          <Text style={styles.toolTopTitle}>Approvers</Text>
        </View>

        <View style={styles.toolHeaderCard}>
          <View style={styles.toolHeaderIcon}>
            <UsersRound size={22} color={colors.brand.ink} strokeWidth={2.6} />
          </View>
          <View style={styles.toolHeaderText}>
            <Text style={styles.toolEyebrow}>Approver Setup</Text>
            <Text style={styles.toolTitle}>Approver Assignments</Text>
            <Text style={styles.toolSubtitle}>Choose the actual employee approver for each level.</Text>
          </View>
          <Pressable disabled={isLoading} style={styles.toolRefreshButton} onPress={refresh}>
            <Text style={styles.toolRefreshText}>{isLoading ? '...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {status ? <Text style={styles.adminStatus}>{status}</Text> : null}

        {departments.map((department) => (
          <View key={department.key} style={styles.approverGroupCard}>
            <View style={styles.departmentHeader}>
              <View>
                <Text style={styles.departmentTitle}>{department.name}</Text>
                <Text style={styles.departmentMeta}>{department.employees.length} employee(s)</Text>
              </View>
            </View>

            <View style={styles.departmentPositionList}>
              {department.employees.map((item) => {
                const active = item.current_authority_level === item.position_level;
                const key = `${item.employee_id}-${item.function_id}`;
                return (
                  <View key={key} style={styles.approverRow}>
                    <View style={styles.departmentPositionText}>
                      <Text style={styles.departmentPositionName} numberOfLines={1}>{item.full_name}</Text>
                      <Text style={styles.departmentPositionMeta}>{item.position_name} | L{item.position_level || '-'}</Text>
                      <Text style={styles.departmentPositionMeta}>
                        {item.current_authority_level ? `Approver L${item.current_authority_level}` : 'Not assigned'}
                      </Text>
                    </View>
                    <Pressable
                      disabled={Boolean(savingKey) || !item.position_level}
                      style={[styles.approverSetButton, active ? styles.approverSetButtonActive : null]}
                      onPress={() => setAsApprover(item)}
                    >
                      <Text style={[styles.approverSetButtonText, active ? styles.approverSetButtonTextActive : null]}>
                        {savingKey === key ? '...' : active ? 'Set' : `Use L${item.position_level || '-'}`}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function AdminDepartmentsScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<DepartmentPositionCatalogRow[]>([]);
  const [positions, setPositions] = useState<AdminPositionCatalogRow[]>([]);
  const [departmentName, setDepartmentName] = useState('');
  const [positionName, setPositionName] = useState('');
  const [activeDepartmentId, setActiveDepartmentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading departments...');
    try {
      const [departmentRows, positionRows] = await Promise.all([
        loadDepartmentPositionCatalog(),
        loadAdminPositionCatalog(),
      ]);
      setRows(departmentRows);
      setPositions(positionRows);
      setStatus(departmentRows.length ? `${departmentRows.length} department row(s) loaded.` : 'No departments yet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load departments.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const departments = rows.reduce<Array<{ id: string; name: string; positions: Array<{ id: string; name: string; employeeCount: number }> }>>(
    (groups, row) => {
      let group = groups.find((candidate) => candidate.id === row.department_id);
      if (!group) {
        group = { id: row.department_id, name: row.department_name, positions: [] };
        groups.push(group);
      }

      if (row.position_id && row.position_name && !group.positions.some((position) => position.id === row.position_id)) {
        group.positions.push({
          id: row.position_id,
          name: row.position_name,
          employeeCount: row.employee_count,
        });
      }

      return groups;
    },
    [],
  );

  const activeDepartment = departments.find((department) => department.id === activeDepartmentId) ?? null;
  const activeOptions = activeDepartment
    ? positions.filter((position) => !activeDepartment.positions.some((assigned) => assigned.id === position.position_id))
    : [];

  async function addDepartment() {
    const name = departmentName.trim();
    if (!name) {
      setStatus('Department name is required.');
      return;
    }

    setSavingKey('department');
    setStatus(`Creating ${name}...`);
    try {
      await createAdminDepartment(name);
      setDepartmentName('');
      setStatus(`${name} is ready.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create department.');
    } finally {
      setSavingKey('');
    }
  }

  async function addPosition() {
    const name = positionName.trim();
    if (!name) {
      setStatus('Position name is required.');
      return;
    }

    setSavingKey('position');
    setStatus(`Creating ${name}...`);
    try {
      await createAdminPosition(name);
      setPositionName('');
      setStatus(`${name} is ready.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create position.');
    } finally {
      setSavingKey('');
    }
  }

  async function assignPosition(positionId: string) {
    if (!activeDepartmentId) {
      return;
    }

    const selected = positions.find((position) => position.position_id === positionId);
    setSavingKey(`${activeDepartmentId}-${positionId}`);
    setStatus(`Assigning ${selected?.position_name ?? 'position'}...`);
    try {
      await assignDepartmentPosition(activeDepartmentId, positionId);
      setActiveDepartmentId(null);
      setStatus('Position assigned.');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to assign position.');
    } finally {
      setSavingKey('');
    }
  }

  async function removePosition(departmentId: string, positionId: string) {
    setSavingKey(`${departmentId}-${positionId}-remove`);
    setStatus('Removing position from department...');
    try {
      await removeDepartmentPosition(departmentId, positionId);
      setStatus('Position removed.');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to remove position.');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <View style={styles.adminSafeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.adminPage} showsVerticalScrollIndicator={false}>
        <View style={styles.toolTopBar}>
          <Pressable style={styles.toolBackButton} onPress={onBack}>
            <Text style={styles.toolBackText}>Back</Text>
          </Pressable>
          <Text style={styles.toolTopTitle}>Departments</Text>
        </View>

        <View style={styles.toolHeaderCard}>
          <View style={styles.toolHeaderIcon}>
            <BriefcaseBusiness size={22} color={colors.brand.ink} strokeWidth={2.6} />
          </View>
          <View style={styles.toolHeaderText}>
            <Text style={styles.toolEyebrow}>Employee Setup</Text>
            <Text style={styles.toolTitle}>Departments & Positions</Text>
            <Text style={styles.toolSubtitle}>Create departments and assign position options.</Text>
          </View>
          <Pressable disabled={isLoading} style={styles.toolRefreshButton} onPress={refresh}>
            <Text style={styles.toolRefreshText}>{isLoading ? '...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {status ? <Text style={styles.adminStatus}>{status}</Text> : null}

        <View style={styles.catalogCreateGrid}>
          <View style={styles.catalogCreateCard}>
            <Text style={styles.catalogCreateLabel}>New department</Text>
            <TextInput
              value={departmentName}
              onChangeText={setDepartmentName}
              placeholder="Operations, IT, HR"
              placeholderTextColor={colors.muted}
              style={styles.catalogInput}
            />
            <Pressable disabled={Boolean(savingKey)} style={styles.catalogCreateButton} onPress={addDepartment}>
              <Text style={styles.catalogCreateButtonText}>Add Department</Text>
            </Pressable>
          </View>

          <View style={styles.catalogCreateCard}>
            <Text style={styles.catalogCreateLabel}>New position</Text>
            <TextInput
              value={positionName}
              onChangeText={setPositionName}
              placeholder="Crew, Store Manager, IT Staff"
              placeholderTextColor={colors.muted}
              style={styles.catalogInput}
            />
            <Pressable disabled={Boolean(savingKey)} style={styles.catalogCreateButton} onPress={addPosition}>
              <Text style={styles.catalogCreateButtonText}>Add Position</Text>
            </Pressable>
          </View>
        </View>

        {departments.map((department) => (
          <View key={department.id} style={styles.departmentCard}>
            <View style={styles.departmentHeader}>
              <View>
                <Text style={styles.departmentTitle}>{department.name}</Text>
                <Text style={styles.departmentMeta}>{department.positions.length} position(s)</Text>
              </View>
              <Pressable disabled={Boolean(savingKey)} style={styles.departmentAddButton} onPress={() => setActiveDepartmentId(department.id)}>
                <Text style={styles.departmentAddButtonText}>Add Position</Text>
              </Pressable>
            </View>

            <View style={styles.departmentPositionList}>
              {department.positions.length ? (
                department.positions.map((position) => (
                  <View key={position.id} style={styles.departmentPositionRow}>
                    <View style={styles.departmentPositionText}>
                      <Text style={styles.departmentPositionName} numberOfLines={1}>{position.name}</Text>
                      <Text style={styles.departmentPositionMeta}>{position.employeeCount} employee(s)</Text>
                    </View>
                    <Pressable
                      disabled={Boolean(savingKey)}
                      style={styles.removePositionButton}
                      onPress={() => removePosition(department.id, position.id)}
                      hitSlop={8}
                    >
                      <X size={14} color={colors.surface} strokeWidth={2.8} />
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyLevelText}>No positions assigned.</Text>
              )}
            </View>
          </View>
        ))}

        <DepartmentPositionPicker
          departmentName={activeDepartment?.name ?? ''}
          visible={Boolean(activeDepartmentId)}
          options={activeOptions}
          onClose={() => setActiveDepartmentId(null)}
          onSelect={assignPosition}
        />
      </ScrollView>
    </View>
  );
}

function DepartmentPositionPicker({
  departmentName,
  visible,
  options,
  onClose,
  onSelect,
}: {
  departmentName: string;
  visible: boolean;
  options: AdminPositionCatalogRow[];
  onClose: () => void;
  onSelect: (positionId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const androidScrollRef = useRef<ScrollView>(null);
  const wheelItemHeight = 44;
  const [value, setValue] = useState(options[0]?.position_id || '');
  const bottomPadding = Math.max(insets.bottom, spacing.sm);

  useEffect(() => {
    setValue(options[0]?.position_id || '');
  }, [options, visible]);

  useEffect(() => {
    if (!visible || !options.length) {
      return;
    }

    requestAnimationFrame(() => {
      androidScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [visible, options]);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.adminPickerBackdrop, styles.adminPickerBackdropFlush]}>
        <View style={[styles.adminPickerSheet, styles.adminPickerSheetFlush]}>
          <View style={styles.adminPickerHeader}>
            <View style={styles.adminPickerHeaderText}>
              <Text style={styles.adminPickerTitle}>Add Position</Text>
              <Text style={styles.adminPickerSubtitle}>{departmentName || 'Department'}</Text>
            </View>
            <Pressable style={styles.adminPickerIconClose} onPress={onClose}>
              <X size={18} color={colors.text} strokeWidth={2.6} />
            </Pressable>
          </View>
          {options.length ? (
            <View style={styles.adminAndroidWheelFrame}>
              <View pointerEvents="none" style={styles.adminAndroidWheelSelection} />
              <ScrollView
                ref={androidScrollRef}
                style={styles.adminAndroidPickerFrame}
                contentContainerStyle={styles.adminAndroidPickerContent}
                showsVerticalScrollIndicator={false}
                snapToInterval={wheelItemHeight}
                decelerationRate="fast"
                onMomentumScrollEnd={(event) => {
                  const selectedIndex = Math.min(
                    options.length - 1,
                    Math.max(0, Math.round(event.nativeEvent.contentOffset.y / wheelItemHeight)),
                  );
                  setValue(options[selectedIndex]?.position_id || '');
                }}
              >
                {options.map((item) => {
                  const selected = item.position_id === (value || options[0]?.position_id);

                  return (
                    <Pressable
                      key={item.position_id}
                      style={[styles.adminWheelOptionRow, selected ? styles.adminWheelOptionRowSelected : null]}
                      onPress={() => setValue(item.position_id)}
                      android_ripple={{ color: '#fde68a', borderless: false }}
                    >
                      <Text style={[styles.adminWheelOptionText, selected ? styles.adminWheelOptionTextSelected : null]} numberOfLines={1}>
                        {item.position_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <Text style={styles.adminPickerEmpty}>All positions are already assigned to this department.</Text>
          )}
          <View style={[styles.adminPickerActions, { paddingBottom: bottomPadding }]}>
            <Pressable style={styles.adminPickerCancel} onPress={onClose}>
              <Text style={styles.adminPickerCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!options.length}
              style={[styles.adminPickerDone, !options.length ? styles.levelAddButtonDisabled : null]}
              onPress={() => {
                if (value || options[0]?.position_id) {
                  onSelect(value || options[0].position_id);
                }
              }}
            >
              <Text style={styles.adminPickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AdminAuthorityScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<PositionAuthorityLevel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [selectedPositionByLevel, setSelectedPositionByLevel] = useState<Record<number, string>>({});
  const [activeLevelPicker, setActiveLevelPicker] = useState<number | null>(null);
  const [expandedLevels, setExpandedLevels] = useState<Record<number, boolean>>({});

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading positions...');
    try {
      const positions = await loadPositionAuthorityLevels();
      setItems(positions);
      setStatus(positions.length ? `${positions.length} position(s) found.` : 'No positions found.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load position levels.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function chooseLevel(item: PositionAuthorityLevel, level: number) {
    const key = `${item.position_id}-${level}`;
    setSavingKey(key);
    setStatus(`Saving ${item.position_name} as Level ${level}...`);
    try {
      await setPositionAuthorityLevel(item.position_id, level);
      setItems((current) =>
        current.map((candidate) =>
          candidate.position_id === item.position_id
            ? { ...candidate, authority_level: level }
            : candidate,
        ),
      );
      setStatus(`${item.position_name} is now Level ${level}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save position level.');
    } finally {
      setSavingKey('');
    }
  }

  function availablePositionsForLevel(level: number) {
    return items.filter((item) => item.authority_level !== level);
  }

  function positionsForLevel(level: number) {
    return items.filter((item) => item.authority_level === level);
  }

  async function addSelectedPosition(level: number) {
    const selectedPositionId = selectedPositionByLevel[level];
    const selected = items.find((item) => item.position_id === selectedPositionId);

    if (!selected) {
      setStatus(`Select a position to add to Level ${level}.`);
      return;
    }

    await chooseLevel(selected, level);
    setSelectedPositionByLevel((current) => ({ ...current, [level]: '' }));
  }

  async function removePositionLevel(item: PositionAuthorityLevel) {
    const key = `${item.position_id}-clear`;
    setSavingKey(key);
    setStatus(`Removing ${item.position_name} from Level ${item.authority_level}...`);
    try {
      await clearPositionAuthorityLevel(item.position_id);
      setItems((current) =>
        current.map((candidate) =>
          candidate.position_id === item.position_id
            ? { ...candidate, authority_level: null }
            : candidate,
        ),
      );
      setStatus(`${item.position_name} was removed from its level.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to remove position level.');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <View style={styles.adminSafeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.adminPage} showsVerticalScrollIndicator={false}>
        <View style={styles.toolTopBar}>
          <Pressable style={styles.toolBackButton} onPress={onBack}>
            <Text style={styles.toolBackText}>Back</Text>
          </Pressable>
          <Text style={styles.toolTopTitle}>Authority Levels</Text>
        </View>

        <View style={styles.toolHeaderCard}>
          <View style={styles.toolHeaderIcon}>
            <Layers3 size={22} color={colors.brand.ink} strokeWidth={2.6} />
          </View>
          <View style={styles.toolHeaderText}>
            <Text style={styles.toolEyebrow}>Approver Setup</Text>
            <Text style={styles.toolTitle}>Authority Levels</Text>
            <Text style={styles.toolSubtitle}>Set approval authority by position.</Text>
          </View>
          <Pressable disabled={isLoading} style={styles.toolRefreshButton} onPress={refresh}>
            <Text style={styles.toolRefreshText}>{isLoading ? '...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {status ? <Text style={styles.adminStatus}>{status}</Text> : null}

        <View style={styles.authorityGuideCard}>
          <Text style={styles.authorityGuideTitle}>Simple rule</Text>
          <Text style={styles.authorityGuideText}>Set the position level first, then choose the real employee approver in their department below.</Text>
        </View>

        {Array.from({ length: 8 }).map((_, index) => {
          const level = index + 1;
          const assigned = positionsForLevel(level);
          const available = availablePositionsForLevel(level);
          const selectedPositionId = selectedPositionByLevel[level] || '';

          return (
            <View key={level} style={styles.levelSection}>
              <View style={styles.levelSectionHeader}>
                <View style={styles.levelTitleRow}>
                  <View style={[styles.levelNumberBadge, { backgroundColor: authorityLevelColors[index].background }]}>
                    <Text style={[styles.levelNumberText, { color: authorityLevelColors[index].text }]}>{level}</Text>
                  </View>
                  <View>
                    <Text style={styles.levelSectionTitle}>Level {level}</Text>
                    <Text style={styles.levelSectionMeta}>{assigned.length} position(s) added</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.addPositionLabel}>Add position</Text>
              <View style={styles.levelPickerRow}>
                <Pressable style={styles.compactPickerButton} onPress={() => setActiveLevelPicker(level)}>
                  <Text style={[styles.compactPickerText, !selectedPositionId ? styles.compactPickerPlaceholder : null]}>
                    {items.find((item) => item.position_id === selectedPositionId)?.position_name || 'Select position'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={Boolean(savingKey) || !selectedPositionId}
                  style={[styles.levelAddButton, !selectedPositionId ? styles.levelAddButtonDisabled : null]}
                  onPress={() => addSelectedPosition(level)}
                >
                  <Text style={styles.levelAddButtonText}>Add</Text>
                </Pressable>
              </View>

              <View style={styles.assignedPositionList}>
                {assigned.length ? (
                  (expandedLevels[level] ? assigned : assigned.slice(0, 3)).map((item) => (
                    <View key={item.position_id} style={styles.assignedPositionRow}>
                      <Text style={styles.assignedPositionName} numberOfLines={1}>{item.position_name}</Text>
                      <View style={styles.assignedPositionCount}>
                        <UsersRound size={14} color={colors.muted} strokeWidth={2.6} />
                        <Text style={styles.assignedPositionCountText}>{item.employee_count}</Text>
                      </View>
                      <View style={styles.assignedPositionDivider} />
                      <Pressable
                        disabled={Boolean(savingKey)}
                        style={styles.removePositionButton}
                        onPress={() => removePositionLevel(item)}
                        hitSlop={8}
                      >
                        <X size={14} color={colors.surface} strokeWidth={2.8} />
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyLevelText}>No positions assigned.</Text>
                )}
                {assigned.length > 3 && !expandedLevels[level] ? (
                  <Pressable
                    style={styles.assignedFade}
                    onPress={() => setExpandedLevels((current) => ({ ...current, [level]: true }))}
                  >
                    <Text style={styles.assignedMoreText}>+{assigned.length - 3} more</Text>
                  </Pressable>
                ) : assigned.length > 3 ? (
                  <Pressable
                    style={styles.assignedCollapse}
                    onPress={() => setExpandedLevels((current) => ({ ...current, [level]: false }))}
                  >
                    <Text style={styles.assignedMoreText}>Show less</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}

        <LevelPositionPicker
          level={activeLevelPicker}
          options={activeLevelPicker ? availablePositionsForLevel(activeLevelPicker) : []}
          selectedPositionId={activeLevelPicker ? selectedPositionByLevel[activeLevelPicker] || '' : ''}
          onClose={() => setActiveLevelPicker(null)}
          onSelect={(positionId) => {
            if (activeLevelPicker) {
              setSelectedPositionByLevel((current) => ({ ...current, [activeLevelPicker]: positionId }));
            }
            setActiveLevelPicker(null);
          }}
        />
      </ScrollView>
    </View>
  );
}

function LevelPositionPicker({
  level,
  options,
  selectedPositionId,
  onClose,
  onSelect,
}: {
  level: number | null;
  options: PositionAuthorityLevel[];
  selectedPositionId: string;
  onClose: () => void;
  onSelect: (positionId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const androidScrollRef = useRef<ScrollView>(null);
  const wheelItemHeight = 44;
  const [iosValue, setIosValue] = useState(selectedPositionId || options[0]?.position_id || '');
  const bottomPadding = Math.max(insets.bottom, spacing.sm);
  const title = level ? `Add to Level ${level}` : 'Add to Level';

  useEffect(() => {
    setIosValue(selectedPositionId || options[0]?.position_id || '');
  }, [selectedPositionId, options]);

  useEffect(() => {
    if (Platform.OS === 'ios' || level === null || !options.length) {
      return;
    }

    const selectedIndex = Math.max(
      0,
      options.findIndex((item) => item.position_id === (iosValue || options[0]?.position_id)),
    );

    requestAnimationFrame(() => {
      androidScrollRef.current?.scrollTo({ y: selectedIndex * wheelItemHeight, animated: false });
    });
  }, [iosValue, level, options]);

  if (Platform.OS === 'ios') {
    return (
      <Modal transparent animationType="fade" visible={level !== null} onRequestClose={onClose}>
        <View style={[styles.adminPickerBackdrop, { paddingBottom: bottomPadding }]}>
          <View style={styles.adminPickerSheet}>
            <View style={styles.adminPickerHeader}>
              <Text style={styles.adminPickerTitle}>{title}</Text>
              <Pressable style={styles.adminPickerClose} onPress={onClose}>
                <Text style={styles.adminPickerCloseText}>Close</Text>
              </Pressable>
            </View>
            {options.length ? (
              <View style={styles.adminWheelFrame}>
                <PickerField
                  value={iosValue}
                  onValueChange={setIosValue}
                  options={options.map((item) => item.position_id)}
                  labels={Object.fromEntries(options.map((item) => [item.position_id, item.position_name]))}
                />
              </View>
            ) : (
              <Text style={styles.adminPickerEmpty}>No available positions for this level.</Text>
            )}
            <View style={styles.adminPickerActions}>
              <Pressable style={styles.adminPickerCancel} onPress={onClose}>
                <Text style={styles.adminPickerCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.adminPickerDone}
                onPress={() => {
                  if (iosValue) {
                    onSelect(iosValue);
                  }
                }}
              >
                <Text style={styles.adminPickerDoneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal transparent animationType="fade" visible={level !== null} onRequestClose={onClose}>
      <View style={[styles.adminPickerBackdrop, styles.adminPickerBackdropFlush]}>
        <View style={[styles.adminPickerSheet, styles.adminPickerSheetFlush]}>
          <View style={styles.adminPickerHeader}>
            <Text style={styles.adminPickerTitle}>{title}</Text>
            <Pressable style={styles.adminPickerIconClose} onPress={onClose}>
              <X size={18} color={colors.text} strokeWidth={2.6} />
            </Pressable>
          </View>
          {options.length ? (
            <View style={styles.adminAndroidWheelFrame}>
              <View pointerEvents="none" style={styles.adminAndroidWheelSelection} />
              <ScrollView
                ref={androidScrollRef}
                style={styles.adminAndroidPickerFrame}
                contentContainerStyle={styles.adminAndroidPickerContent}
                showsVerticalScrollIndicator={false}
                snapToInterval={wheelItemHeight}
                decelerationRate="fast"
                onMomentumScrollEnd={(event) => {
                  const selectedIndex = Math.min(
                    options.length - 1,
                    Math.max(0, Math.round(event.nativeEvent.contentOffset.y / wheelItemHeight)),
                  );
                  setIosValue(options[selectedIndex]?.position_id || '');
                }}
              >
                {options.map((item) => {
                  const selected = item.position_id === (iosValue || options[0]?.position_id);

                  return (
                    <Pressable
                      key={item.position_id}
                      style={[styles.adminWheelOptionRow, selected ? styles.adminWheelOptionRowSelected : null]}
                      onPress={() => setIosValue(item.position_id)}
                      android_ripple={{ color: '#fde68a', borderless: false }}
                    >
                      <Text style={[styles.adminWheelOptionText, selected ? styles.adminWheelOptionTextSelected : null]} numberOfLines={1}>
                        {item.position_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <Text style={styles.adminPickerEmpty}>No available positions for this level.</Text>
          )}
          <View style={[styles.adminPickerActions, { paddingBottom: bottomPadding }]}>
            <Pressable style={styles.adminPickerCancel} onPress={onClose}>
              <Text style={styles.adminPickerCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!options.length}
              style={[styles.adminPickerDone, !options.length ? styles.levelAddButtonDisabled : null]}
              onPress={() => {
                if (iosValue || options[0]?.position_id) {
                  onSelect(iosValue || options[0].position_id);
                }
              }}
            >
              <Text style={styles.adminPickerDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
  appShell: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  adminSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  adminPage: {
    flexGrow: 1,
    padding: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  adminTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  adminIntro: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  adminBrandRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminLogoFrame: {
    width: 58,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.brand.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: spacing.sm,
  },
  adminLogo: {
    width: 54,
    height: 38,
  },
  adminBrandText: {
    flex: 1,
  },
  adminKicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  adminTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
  },
  adminIntroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  adminSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  adminRoleBadge: {
    borderRadius: 999,
    backgroundColor: colors.brand.gold,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  adminRoleBadgeText: {
    color: colors.brand.ink,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminStatsGrid: {
    flexDirection: 'row',
    marginHorizontal: -4,
    marginBottom: spacing.md,
  },
  adminMetric: {
    flex: 1,
    minHeight: 96,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.sm,
    marginHorizontal: 4,
    justifyContent: 'space-between',
  },
  adminMetricLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminMetricValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  adminMetricDetail: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  adminSection: {
    marginBottom: spacing.md,
  },
  adminSectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  adminAction: {
    minHeight: 74,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  adminActionAccent: {
    width: 6,
    alignSelf: 'stretch',
    borderRadius: 999,
    marginRight: spacing.md,
  },
  adminActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#eef4ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  adminMetricIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#eef4ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  adminAccent_gold: {
    backgroundColor: colors.brand.gold,
  },
  adminAccent_blue: {
    backgroundColor: colors.primary,
  },
  adminAccent_green: {
    backgroundColor: '#16a34a',
  },
  adminAccent_red: {
    backgroundColor: '#dc2626',
  },
  adminActionText: {
    flex: 1,
  },
  adminActionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  adminActionDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  adminActionChevron: {
    color: colors.muted,
    fontSize: 26,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  adminSignOutButton: {
    minHeight: 50,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  adminSignOutText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginLeft: spacing.xs,
  },
  adminBackButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  adminBackText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  toolTopBar: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  toolBackButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  toolBackText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  toolTopTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  toolHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  toolHeaderIcon: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  toolHeaderText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  toolEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  toolTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  toolSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  toolRefreshButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  toolRefreshText: {
    color: colors.brand.ink,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminRefreshButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  adminRefreshText: {
    color: colors.brand.ink,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminStatus: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  authorityGuideCard: {
    borderRadius: 8,
    backgroundColor: '#eef4ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  authorityGuideTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 3,
  },
  authorityGuideText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  routeDepartmentCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  routeDepartmentTitleBlock: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  routeSavingPill: {
    minHeight: 28,
    borderRadius: 14,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  routeSavingText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  routePath: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderColor: colors.border,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    marginTop: spacing.xs,
  },
  routePathItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.xs,
    marginVertical: 3,
  },
  routePathArrow: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '900',
    marginRight: 3,
  },
  routePathNode: {
    minWidth: 34,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  routePathNodeText: {
    color: colors.brand.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  routePathEmpty: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  routeChooseLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  routeLadderChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: spacing.xs,
  },
  routeLadderChip: {
    width: '24%',
    height: 36,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  routeLadderChipActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  routeLadderChipDisabled: {
    opacity: 0.5,
  },
  routeLadderChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  routeLadderChipTextActive: {
    color: '#1d4ed8',
  },
  approverGroupCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  approverRow: {
    minHeight: 66,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  approverSetButton: {
    minWidth: 70,
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  approverSetButtonActive: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
  },
  approverSetButtonText: {
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  approverSetButtonTextActive: {
    color: '#166534',
  },
  catalogCreateGrid: {
    marginBottom: spacing.sm,
  },
  catalogCreateCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  catalogCreateLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  catalogInput: {
    minHeight: 46,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: '#f8fafc',
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  catalogCreateButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogCreateButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  departmentCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  departmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  departmentTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  departmentMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 2,
  },
  departmentAddButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  departmentAddButtonText: {
    color: colors.brand.ink,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  departmentPositionList: {
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.xs,
  },
  departmentPositionRow: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.xs,
  },
  departmentPositionText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  departmentPositionName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  departmentPositionMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  levelSection: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  levelSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  levelTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelNumberBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  levelNumberText: {
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
  levelSectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  levelSectionMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  addPositionLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  authorityBadge: {
    width: 42,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorityBadgeText: {
    color: colors.brand.ink,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  authorityDetail: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
    fontWeight: '700',
  },
  authorityHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  levelPickerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  levelSelectShell: {
    flex: 1,
  },
  compactPickerButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  compactPickerText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  compactPickerPlaceholder: {
    color: colors.muted,
  },
  levelAddButton: {
    minWidth: 70,
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  levelAddButtonDisabled: {
    opacity: 0.55,
  },
  levelAddButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  assignedPositionList: {
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.xs,
    overflow: 'hidden',
  },
  assignedPositionRow: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.xs,
  },
  assignedPositionName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    paddingRight: spacing.sm,
  },
  assignedPositionCount: {
    minWidth: 50,
    minHeight: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  assignedPositionCountText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 4,
  },
  assignedPositionDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  removePositionButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.semantic.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedFade: {
    height: 34,
    marginTop: -18,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 250, 252, 0.88)',
    paddingBottom: 3,
  },
  assignedCollapse: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedMoreText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  emptyLevelText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    padding: spacing.sm,
    textAlign: 'center',
  },
  adminPickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    padding: spacing.md,
  },
  adminPickerBackdropFlush: {
    paddingBottom: 0,
  },
  adminPickerBackdropAndroid: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xl,
  },
  adminPickerSheet: {
    maxHeight: '70%',
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: 'hidden',
  },
  adminPickerSheetFlush: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  adminPickerSheetAndroid: {
    maxHeight: '82%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  adminPickerHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  adminPickerHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  adminPickerHeaderText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  adminPickerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  adminPickerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 2,
  },
  adminPickerClose: {
    minHeight: 36,
    justifyContent: 'center',
  },
  adminPickerIconClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  adminPickerCloseText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminPickerList: {
    maxHeight: 360,
  },
  adminPickerListContent: {
    padding: spacing.sm,
    paddingBottom: spacing.md,
  },
  adminWheelFrame: {
    height: 190,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  adminAndroidWheelFrame: {
    height: 178,
    position: 'relative',
    overflow: 'hidden',
  },
  adminAndroidWheelSelection: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: 67,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
  },
  adminAndroidPickerFrame: {
    height: 178,
  },
  adminAndroidPickerContent: {
    paddingVertical: 67,
  },
  adminPickerActions: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.sm,
  },
  adminPickerCancel: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  adminPickerDone: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  adminPickerCancelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminPickerDoneText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  adminWheelOptionRow: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  adminWheelOptionRowSelected: {
    backgroundColor: '#fef3c7',
  },
  adminWheelOptionText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  adminWheelOptionTextSelected: {
    color: '#92400e',
    fontWeight: '900',
  },
  adminPickerOption: {
    minHeight: 58,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminPickerOptionSelected: {
    backgroundColor: '#eef4ff',
    borderColor: colors.primary,
  },
  adminPickerOptionTextBlock: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  adminPickerOptionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  adminPickerOptionTextSelected: {
    color: colors.primary,
  },
  adminPickerOptionMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  adminPickerOptionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderColor: '#cbd5e1',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminPickerOptionRadioSelected: {
    borderColor: colors.primary,
  },
  adminPickerOptionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  adminPickerEmpty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    padding: spacing.md,
    textAlign: 'center',
  },
  auditPanel: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: '#e2e8f0',
    borderWidth: 1,
    overflow: 'hidden',
  },
  auditItem: {
    flexDirection: 'row',
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  auditDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand.gold,
    marginTop: 5,
    marginRight: spacing.sm,
  },
  auditText: {
    flex: 1,
  },
  auditTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  auditDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingTop: spacing.xl,
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
  adminCard: {
    borderRadius: 8,
    padding: spacing.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    marginBottom: spacing.md,
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
