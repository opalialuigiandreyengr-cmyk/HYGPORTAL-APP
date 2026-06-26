import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, useWindowDimensions, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import type { User } from '@supabase/supabase-js';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Activity, Bell, BriefcaseBusiness, CalendarDays, Check, ChevronRight, ClipboardCheck, Download, Fingerprint, Gift, KeyRound, Layers3, ListChecks, LogOut, Moon, Plus, Route, ShieldCheck, Smartphone, Trash2, UsersRound, X } from 'lucide-react-native';
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
import { getCacheJSON, initLocalCache, setCacheJSON } from './src/lib/localCache';
import { loadPendingApprovals, type PendingApproval } from './src/services/approvals';
import {
  assignDepartmentPosition,
  assignStoreCluster,
  clearPositionAuthorityLevel,
  createAdminCluster,
  createAdminDepartment,
  createAdminPosition,
  loadAdminClusters,
  loadAuthorityCandidates,
  loadAdminPositionCatalog,
  loadAdminStoreClusterCatalog,
  loadDepartmentApprovalLadders,
  loadDepartmentPositionCatalog,
  loadPositionAuthorityLevels,
  removeDepartmentPosition,
  setAuthorityAssignment,
  setDepartmentApprovalLadder,
  setPositionAuthorityLevel,
  type AdminClusterRow,
  type AdminPositionCatalogRow,
  type AdminStoreClusterRow,
  type AuthorityCandidate,
  type DepartmentApprovalLadderRow,
  type DepartmentPositionCatalogRow,
  type PositionAuthorityLevel,
} from './src/services/admin';
import { loadDashboardSummary, type DashboardSummary } from './src/services/dashboard';
import { loadRewardsWallet, type RewardsWallet, type RewardsWalletHistoryItem } from './src/services/rewards';
import {
  getBiometricEnabled,
  getBiometricLogin,
  getSavedUsername,
  isBiometricAvailable,
  promptBiometric,
  saveBiometricLogin,
  saveUsername,
  setBiometricEnabled,
} from './src/services/biometric';
import {
  addAppNotification,
  disablePushDevice,
  getNotificationsEnabled,
  loadAppNotifications,
  registerPushDevice,
  requestNotificationPermission,
  scheduleLocalNotification,
  setNotificationsEnabled,
  unreadCount,
} from './src/services/notificationCenter';
import { loadEmployeeProfile } from './src/services/profile';
import { resolveLoginEmail } from './src/services/registerAccount';
import {
  deleteMyTeamSchedule,
  loadMyTeamEmployees,
  loadMyTeamSchedules,
  saveMyTeamSchedules,
  type MyTeamEmployee,
  type MyTeamSchedule,
} from './src/services/team';
import { AppToast, type AppToastMessage } from './src/components/AppToast';
import {
  checkForAppUpdate,
  downloadAppUpdate,
  getInitialAppUpdateState,
  restartToApplyAppUpdate,
  type AppUpdateState,
} from './src/services/appUpdates';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { ApplyDiscountScreen } from './src/screens/ApplyDiscountScreen';
import { ApplyEsarfScreen } from './src/screens/ApplyEsarfScreen';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { CreateEmployeeProfileScreen } from './src/screens/CreateEmployeeProfileScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { ProfileTabScreen } from './src/screens/ProfileTabScreen';
import { RegisterAccountScreen } from './src/screens/RegisterAccountScreen';
import { RequestsTabScreen } from './src/screens/RequestsTabScreen';
import { BottomTabBar } from './src/components/BottomTabBar';
import { TopBar } from './src/components/TopBar';
import { hygPortalLogo, preloadHygPortalLogo } from './src/assets/portalLogo';
import { openApkDownload, registerPwaInstallSupport, PWA_VERSION } from './src/constants/download';
import type { AssistantDraft } from './src/services/assistant';
import { colors, spacing } from './src/theme';
import RequestLeave from './src/screens/RequestLeave';
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

type PortalTab = 'home' | 'requests' | 'approvals' | 'notifications' | 'perks' | 'profile' | 'settings' | 'rewards' | 'my_team';
type PublicScreen = 'login' | 'create_profile' | 'register_account';
type AdminScreen = 'home' | 'authority' | 'departments' | 'routes' | 'approvers' | 'clusters';
type QuickRequestScreen = 'assistant' | 'apply_esarf' | 'request_leave' | 'apply_discount';
const SUPER_ADMIN_EMAIL = 'hygportal@gmail.com';
const hygLogo = hygPortalLogo;
const hygCoinsImage = require('./assets/hygcoins.png');
const NATIVE_APP_VERSION = '1.5.2';
const APP_VERSION = Platform.OS === 'web' ? PWA_VERSION : NATIVE_APP_VERSION;
const authorityLevelColors = [
  { background: '#cffafe', text: '#0e7490' },
  { background: '#fce7f3', text: '#be185d' },
  { background: '#e2e8f0', text: '#334155' },
  { background: '#fee2e2', text: '#b91c1c' },
];

function normalizeRoleName(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
}

function isStoreManagerProfile(profileResult: ProfileLoadResult | null) {
  return profileResult?.status === 'linked' && normalizeRoleName(profileResult.profile.positionName) === 'store manager';
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function isApprovalBadgeItem(item: PendingApproval) {
  return item.request_type_code !== 'employee_perk';
}

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
    hyg_points_balance: 0,
  });
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [dashboardStatus, setDashboardStatus] = useState('');
  const [activeRequestType, setActiveRequestType] = useState<RequestTypeCode | null>(null);
  const [activeQuickRequestScreen, setActiveQuickRequestScreen] = useState<QuickRequestScreen | null>(null);
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null);
  const [activeTab, setActiveTab] = useState<PortalTab>('home');
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [savedUsername, setSavedUsername] = useState('');
  const [publicScreen, setPublicScreen] = useState<PublicScreen>('login');
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [adminScreen, setAdminScreen] = useState<AdminScreen>('home');
  const didAutoPromptBiometricRef = useRef(false);
  const canUseApprovals =
    profileResult?.status === 'linked' && Number(profileResult.profile.authorityLevel ?? 1) > 1;
  const canUseMyTeam = isStoreManagerProfile(profileResult);

  useEffect(() => {
    registerPwaInstallSupport();
    void initLocalCache();
  }, []);

  useEffect(() => {
    preloadHygPortalLogo();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [enabled, available, storedUsername] = await Promise.all([
        getBiometricEnabled(),
        isBiometricAvailable(),
        getSavedUsername(),
      ]);
      const notifEnabled = await getNotificationsEnabled();
      if (!active) {
        return;
      }
      setBiometricEnabledState(enabled);
      setBiometricAvailable(available);
      setSavedUsername(storedUsername);
      if (storedUsername) {
        setEmail(storedUsername);
      }
      setNotificationsEnabledState(notifEnabled);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active || !session?.user) {
        return;
      }

      if (enabled && available) {
        const unlocked = await promptBiometric('Unlock HYG Portal');
        if (!unlocked) {
          return;
        }
      }

      setSignedInUser(session.user);
      if ((session.user.email ?? '').toLowerCase() !== SUPER_ADMIN_EMAIL) {
        await loadProfileForUser(session.user);
        await refreshDashboard();
        await refreshPendingApprovalCount();
        await refreshNotificationUnreadCount();
      }
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }
      if (!session?.user) {
        setSignedInUser(null);
        setProfileResult(null);
      }
    });

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!signedInUser || (signedInUser.email ?? '').toLowerCase() === SUPER_ADMIN_EMAIL) {
      return;
    }

    refreshPendingApprovalCount();
    refreshNotificationUnreadCount();
  }, [activeTab, signedInUser]);

  useEffect(() => {
    if (!signedInUser || !notificationsEnabled || (signedInUser.email ?? '').toLowerCase() === SUPER_ADMIN_EMAIL) {
      return;
    }

    const timer = setInterval(() => {
      void refreshPendingApprovalCount();
      void refreshNotificationUnreadCount();
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, [notificationsEnabled, signedInUser]);

  useEffect(() => {
    if (activeTab === 'approvals' && !canUseApprovals) {
      setActiveTab('perks');
    } else if (activeTab === 'my_team' && !canUseMyTeam) {
      setActiveTab('home');
    }
  }, [activeTab, canUseApprovals, canUseMyTeam]);

  // ─── Android hardware back-button / gesture handler ─────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let backPressedOnce = false;
    let exitToastTimer: ReturnType<typeof setTimeout> | null = null;

    const onBackPress = () => {
      // 1. Close any open quick-request modal (assistant / esarf / leave / discount)
      if (activeQuickRequestScreen !== null) {
        setActiveQuickRequestScreen(null);
        setAssistantDraft(null);
        return true;
      }

      // 2. Close time-request screen
      if (activeRequestType !== null) {
        setActiveRequestType(null);
        return true;
      }

      // 3. Admin sub-screens → admin home
      if (signedInUser && (signedInUser.email ?? '').toLowerCase() === SUPER_ADMIN_EMAIL) {
        if (adminScreen !== 'home') {
          setAdminScreen('home');
          return true;
        }
      }

      // 4. Non-home tabs → home tab
      if (signedInUser && activeTab !== 'home') {
        setActiveTab('home');
        return true;
      }

      // 5. Public sub-screens (register / create profile) → login
      if (!signedInUser && publicScreen !== 'login') {
        setPublicScreen('login');
        return true;
      }

      // 6. At the root screen (login or home dashboard) – double-press to exit
      if (backPressedOnce) {
        // Second press – let the app exit
        return false;
      }
      backPressedOnce = true;
      ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
      exitToastTimer = setTimeout(() => {
        backPressedOnce = false;
      }, 2000);
      return true; // Consume this press
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => {
      subscription.remove();
      if (exitToastTimer) clearTimeout(exitToastTimer);
    };
  }, [
    activeQuickRequestScreen,
    activeRequestType,
    activeTab,
    adminScreen,
    publicScreen,
    signedInUser,
  ]);
  // ─────────────────────────────────────────────────────────────────────────────

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
    try {
      const cacheKey = `employee_profile_result_v1:${user.id}`;
      const cached = await getCacheJSON<ProfileLoadResult>(cacheKey);
      if (cached) {
        setProfileResult(cached);
      }
      const result = await loadEmployeeProfile(user.id);
      setProfileResult(result);
      await setCacheJSON(cacheKey, result);
    } finally {
      setIsLoadingProfile(false);
    }
  }

  async function refreshDashboard() {
    setDashboardStatus('Refreshing dashboard...');
    try {
      const cached = await getCacheJSON<DashboardSummary>('dashboard_summary_v1');
      if (cached) {
        setDashboardSummary(cached);
      }
      const summary = await loadDashboardSummary();
      setDashboardSummary(summary);
      setDashboardStatus('');
    } catch (error) {
      setDashboardStatus(error instanceof Error ? error.message : 'Unable to refresh dashboard.');
    }
  }

  async function refreshPendingApprovalCount() {
    try {
      const approvals = await loadPendingApprovals();
      const count = approvals.filter(isApprovalBadgeItem).length;
      setPendingApprovalCount(count);
    } catch {
      setPendingApprovalCount(0);
    }
  }

  async function refreshNotificationUnreadCount() {
    try {
      const notifications = await loadAppNotifications();
      setNotificationUnreadCount(unreadCount(notifications));
    } catch {
      setNotificationUnreadCount(0);
    }
  }

  function openAssistantDraft(draft: AssistantDraft) {
    setAssistantDraft(draft);
    if (signedInUser) {
      void loadProfileForUser(signedInUser);
    }
    if (draft.intent === 'draft_leave_request') {
      setActiveQuickRequestScreen('request_leave');
    } else if (draft.intent === 'draft_esarf_request') {
      setActiveQuickRequestScreen('apply_esarf');
    } else {
      setActiveQuickRequestScreen('apply_discount');
    }
  }

  function closeQuickRequest() {
    setActiveQuickRequestScreen(null);
    setAssistantDraft(null);
  }

  function openQuickRequest(screen: QuickRequestScreen) {
    setAssistantDraft(null);
    setActiveQuickRequestScreen(screen);
  }

  function openAssistant() {
    openQuickRequest('assistant');
  }

  function openNotifications() {
    setAssistantDraft(null);
    setActiveQuickRequestScreen(null);
    setActiveTab('notifications');
  }

  async function completeLogin(user: User) {
    setPublicScreen('login');
    setSignedInUser(user);
    if ((user.email ?? '').toLowerCase() !== SUPER_ADMIN_EMAIL) {
      await loadProfileForUser(user);
      await refreshDashboard();
      await refreshPendingApprovalCount();
      await refreshNotificationUnreadCount();
      if (notificationsEnabled) {
        try {
          await registerPushDevice();
        } catch {
          // A network or device registration failure should not prevent login.
        }
      }
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
      const username = email.trim();
      await saveUsername(username);
      setSavedUsername(username);
      if (biometricEnabled) {
        await saveBiometricLogin(username, password);
      }
      setAppToast({
        tone: 'success',
        title: 'Login successful',
        message: 'Welcome back to HYG Portal.',
      });
      await completeLogin(data.user);
    }
  }

  async function signInWithBiometric() {
    if (!isSupabaseConfigured) {
      setAppToast({
        tone: 'warning',
        title: 'Login unavailable',
        message: 'Supabase is not configured. Check the mobile .env file.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      let credential = null;

      if (Platform.OS === 'web') {
        // On web (PWA), getBiometricLogin performs the WebAuthn assertion (Touch ID / Face ID)
        // internally – no separate promptBiometric call needed (that would cause a double prompt).
        credential = await getBiometricLogin();
      } else {
        // On native, verify biometric first (promptBiometric), then retrieve saved credentials.
        const unlocked = await promptBiometric('Sign in to HYG Portal');
        if (!unlocked) {
          return;
        }
        credential = await getBiometricLogin();
      }

      if (!credential) {
        setAppToast({
          tone: 'warning',
          title: 'Biometric setup required',
          message: 'Sign in with your password once and enable biometrics again in Settings.',
        });
        return;
      }

      if (!credential.password) {
        setAppToast({
          tone: 'warning',
          title: 'Biometric setup required',
          message: 'Sign in with your password once and enable biometrics again in Settings.',
        });
        return;
      }

      const loginEmail = await resolveLoginEmail(credential.username);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: credential.password,
      });

      if (error || !data.user) {
        setAppToast({
          tone: 'warning',
          title: 'Biometric sign-in unavailable',
          message: 'Your saved login is no longer valid. Sign in with your password to refresh it.',
        });
        return;
      }

      setEmail(credential.username);
      setSavedUsername(credential.username);
      setPassword('');
      setAppToast({
        tone: 'success',
        title: 'Biometric login successful',
        message: `Welcome back, ${credential.username}.`,
      });
      await completeLogin(data.user);
    } catch (error) {
      const msg = String(error instanceof Error ? error.message : error).toLowerCase();
      const isNetworkError =
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('failed to fetch') ||
        msg.includes('internet') ||
        msg.includes('connection') ||
        msg.includes('typeerror');

      if (isNetworkError) {
        Alert.alert(
          'No Internet Connection',
          'Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
      } else {
        setAppToast({
          tone: 'error',
          title: 'Biometric login failed',
          message: error instanceof Error ? error.message : 'Unable to sign in using biometrics.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }


  useEffect(() => {
    const canAutoPromptBiometric =
      publicScreen === 'login' &&
      !signedInUser &&
      !isSubmitting &&
      biometricEnabled &&
      biometricAvailable &&
      Boolean(savedUsername);

    if (!canAutoPromptBiometric || didAutoPromptBiometricRef.current) {
      return;
    }

    didAutoPromptBiometricRef.current = true;
    void signInWithBiometric();
  }, [biometricAvailable, biometricEnabled, isSubmitting, publicScreen, savedUsername, signedInUser]);

  if (signedInUser) {
    const currentUsername =
      profileResult?.status === 'linked'
        ? profileResult.profile.username || email || savedUsername || signedInUser.email
        : email || savedUsername || signedInUser.email;

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

      if (adminScreen === 'clusters') {
        return withToast(<AdminClustersScreen onBack={() => setAdminScreen('home')} />);
      }

      return withToast(
        <AdminHomeScreen
          onOpenAuthority={() => setAdminScreen('authority')}
          onOpenDepartments={() => setAdminScreen('departments')}
          onOpenRoutes={() => setAdminScreen('routes')}
          onOpenApprovers={() => setAdminScreen('approvers')}
          onOpenClusters={() => setAdminScreen('clusters')}
          onSignOut={async () => {
            await supabase.auth.signOut();
            setSignedInUser(null);
            setProfileResult(null);
            setActiveTab('home');
            setActiveQuickRequestScreen(null);
            setAssistantDraft(null);
            setAdminScreen('home');
            setPassword('');
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

    const signOut = async () => {
      await supabase.auth.signOut();
      setSignedInUser(null);
      setProfileResult(null);
      setActiveTab('home');
      setActiveQuickRequestScreen(null);
      setAssistantDraft(null);
      setPassword('');
      setDashboardSummary({ pending_requests: 0, pending_approvals: 0, offset_balance: 0, leave_credit_remaining: 7, hyg_points_balance: 0 });
      setPendingApprovalCount(0);
      setNotificationUnreadCount(0);
    };
    const openMyTeam = canUseMyTeam ? () => setActiveTab('my_team') : undefined;

    let tabContent: ReactNode = null;
    if (activeTab === 'requests') {
      tabContent = (
        <RequestsTabScreen
          profileResult={profileResult}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenMyTeam={openMyTeam}
        />
      );
    } else if (activeTab === 'approvals' && canUseApprovals) {
      tabContent = (
        <ApprovalsScreen
          profileResult={profileResult}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenMyTeam={openMyTeam}
          onToast={setAppToast}
        />
      );
    } else if (activeTab === 'notifications') {
      tabContent = (
        <NotificationsScreen
          profileResult={profileResult}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onBackHome={() => setActiveTab('home')}
          onCountChange={setNotificationUnreadCount}
        />
      );
    } else if (activeTab === 'perks') {
      tabContent = (
        <ApplyDiscountScreen
          name={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email}
          username={currentUsername}
          photoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onBack={() => setActiveTab('home')}
          onToast={setAppToast}
          onSubmitted={async () => {
            setActiveTab('requests');
            await refreshDashboard();
          }}
        />
      );
    } else if (activeTab === 'profile') {
      tabContent = (
        <ProfileTabScreen
          email={signedInUser.email ?? ''}
          username={email}
          isLoading={isLoadingProfile}
          result={profileResult}
          onToast={setAppToast}
          onSignOut={signOut}
          onProfileUpdated={async () => {
            await loadProfileForUser(signedInUser);
          }}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenMyTeam={openMyTeam}
        />
      );
    } else if (activeTab === 'settings') {
      tabContent = (
        <SettingsTabScreen
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onBackHome={() => setActiveTab('home')}
          onSignOut={signOut}
          userEmail={signedInUser.email ?? ''}
          username={currentUsername}
          profileName={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email ?? ''}
          profilePhotoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
          notificationCount={notificationUnreadCount}
          pointsBalance={dashboardSummary.hyg_points_balance}
          biometricAvailable={biometricAvailable}
          biometricEnabled={biometricEnabled}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={async () => {
            if (notificationsEnabled) {
              await setNotificationsEnabled(false);
              setNotificationsEnabledState(false);
              let disableWarning: string | null = null;
              try {
                await disablePushDevice();
              } catch (error) {
                disableWarning = error instanceof Error ? error.message : 'Device cleanup did not finish.';
              }
              setAppToast({
                tone: disableWarning ? 'warning' : 'success',
                title: 'Notifications disabled',
                message: disableWarning
                  ? 'Notifications are off in this app. If alerts still arrive, turn them off in iOS notification settings too.'
                  : 'Automatic notifications are now off.',
              });
              return;
            }

            let granted = false;
            try {
              granted = await requestNotificationPermission();
            } catch (error) {
              setAppToast({
                tone: 'warning',
                title: 'Notifications unavailable',
                message: error instanceof Error ? error.message : 'Unable to request notification permission.',
              });
              return;
            }

            if (!granted) {
              setAppToast({
                tone: 'warning',
                title: 'Permission denied',
                message: 'Please allow notifications in phone settings first.',
              });
              return;
            }

            setNotificationsEnabledState(true);

            try {
              await registerPushDevice();
            } catch (error) {
              setNotificationsEnabledState(false);
              setAppToast({
                tone: 'warning',
                title: 'Push registration failed',
                message: error instanceof Error ? error.message : 'Unable to register this device for alerts.',
              });
              return;
            }

            try {
              await setNotificationsEnabled(true);
              setNotificationsEnabledState(true);
              const body = 'Notifications are enabled. Approval alerts, HYG Points gifts, and account updates will appear here and on your device.';
              await addAppNotification({ title: 'Notifications enabled', body });
              await refreshNotificationUnreadCount();
              try {
                await scheduleLocalNotification({ title: 'HYG Portal', body });
              } catch (scheduleError) {
                console.error('[NotificationCenter] scheduleLocalNotification failed:', scheduleError);
              }
              setAppToast({
                tone: 'success',
                title: 'Notifications enabled',
                message: Platform.OS === 'web'
                  ? 'Web Push is active! Lock your device or go home now to see the banner.'
                  : 'Automatic notifications are now on. A confirmation alert was sent.',
              });
            } catch (storageError) {
              setNotificationsEnabledState(false);
              setAppToast({
                tone: 'warning',
                title: 'Activation failed',
                message: storageError instanceof Error ? storageError.message : 'Unable to save configuration.',
              });
            }
          }}
          onToggleBiometric={async () => {
            if (biometricEnabled) {
              await setBiometricEnabled(false);
              setBiometricEnabledState(false);
              setAppToast({
                tone: 'success',
                title: 'Biometric disabled',
                message: 'Biometric unlock has been turned off.',
              });
              return;
            }

            const username = email.trim() || savedUsername;
            if (!username || !password) {
              setAppToast({
                tone: 'warning',
                title: 'Password sign-in required',
                message: 'Sign in using your password once before enabling biometric login.',
              });
              return;
            }

            if (!biometricAvailable) {
              setAppToast({
                tone: 'warning',
                title: 'Biometric unavailable',
                message: Platform.OS === 'web'
                  ? 'Touch ID / Face ID is not available on this browser. Make sure you are using Safari on iOS 14+ and the PWA is installed.'
                  : 'No enrolled fingerprint or Face ID was found on this device.',
              });
              return;
            }

            // On web (PWA) the enrollment IS the biometric prompt – saveBiometricLogin
            // calls navigator.credentials.create which shows the Touch ID / Face ID dialog.
            // We must NOT call promptBiometric first because there is no credential stored yet.
            if (Platform.OS === 'web') {
              try {
                await saveBiometricLogin(username, password);
                setSavedUsername(username);
                await setBiometricEnabled(true);
                setBiometricEnabledState(true);
                setAppToast({
                  tone: 'success',
                  title: 'Biometric enabled',
                  message: 'Touch ID / Face ID unlock is now enabled for this PWA.',
                });
              } catch (err) {
                setAppToast({
                  tone: 'warning',
                  title: 'Enrollment failed',
                  message: err instanceof Error ? err.message : 'Could not register biometric. Please try again.',
                });
              }
              return;
            }

            // Native: verify biometric first, then save credentials.
            const success = await promptBiometric('Enable biometric unlock for HYG Portal');
            if (!success) {
              setAppToast({
                tone: 'warning',
                title: 'Verification failed',
                message: 'Biometric verification was cancelled or failed.',
              });
              return;
            }

            await saveBiometricLogin(username, password);
            setSavedUsername(username);
            await setBiometricEnabled(true);
            setBiometricEnabledState(true);
            setAppToast({
              tone: 'success',
              title: 'Biometric enabled',
              message: Platform.OS === 'ios'
                ? 'Face ID/Touch ID unlock is now enabled.'
                : 'Fingerprint unlock is now enabled.',
            });
          }}
        />
      );
    } else if (activeTab === 'rewards') {
      tabContent = (
        <RewardsPlaceholderScreen
          profileName={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email ?? ''}
          username={currentUsername}
          employeeCode={profileResult?.status === 'linked' ? profileResult.profile.employeeNo || profileResult.profile.employeeId : signedInUser.id}
          profilePhotoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
          pointsBalance={dashboardSummary.hyg_points_balance}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onOpenProfile={() => setActiveTab('profile')}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenMyTeam={openMyTeam}
          onToast={setAppToast}
          onSignOut={signOut}
        />
      );
    } else if (activeTab === 'my_team' && canUseMyTeam) {
      tabContent = (
        <MyTeamPlaceholderScreen
          profileResult={profileResult}
          notificationCount={notificationUnreadCount}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onBackHome={() => setActiveTab('home')}
          onOpenProfile={() => setActiveTab('profile')}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenMyTeam={openMyTeam}
          onSignOut={signOut}
        />
      );
    } else {
      tabContent = (
        <DashboardScreen
          userEmail={signedInUser.email ?? 'Employee'}
          summary={dashboardSummary}
          profileResult={profileResult}
          onRefreshDashboard={refreshDashboard}
          onRefreshProfile={() => loadProfileForUser(signedInUser)}
          onOpenProfile={() => setActiveTab('profile')}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenMyTeam={openMyTeam}
          onSignOut={signOut}
          onAssistant={openAssistant}
          onNotifications={openNotifications}
          onApplyEsarf={() => openQuickRequest('apply_esarf')}
          onRequestLeave={() => openQuickRequest('request_leave')}
          onApplyPerks={() => openQuickRequest('apply_discount')}
          notificationCount={notificationUnreadCount}
        />
      );
    }

    return withToast(
      <View style={{ flex: 1 }}>
        {tabContent}
        {activeTab !== 'settings' && activeTab !== 'notifications' && activeTab !== 'my_team' ? (
          <BottomTabBar
            activeTab={activeTab}
            onChange={setActiveTab}
            requestCount={dashboardSummary.pending_requests}
            approvalCount={pendingApprovalCount}
            showApprovals={canUseApprovals}
            onAssistant={openAssistant}
          />
        ) : null}

        <SlideOverlayContainer visible={activeQuickRequestScreen === 'assistant'}>
          <AssistantScreen
            name={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email}
            username={currentUsername}
            photoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
            leaveCreditRemaining={dashboardSummary.leave_credit_remaining}
            offsetBalance={dashboardSummary.offset_balance}
            onBack={closeQuickRequest}
            onOpenDraft={openAssistantDraft}
          />
        </SlideOverlayContainer>

        <SlideOverlayContainer visible={activeQuickRequestScreen === 'apply_esarf'}>
          <ApplyEsarfScreen
            name={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email}
            username={currentUsername}
            photoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
            offsetBalance={dashboardSummary.offset_balance}
            profilePayrollClass={profileResult?.status === 'linked' ? profileResult.profile.payrollClass : null}
            profileSchedule={profileResult?.status === 'linked' ? profileResult.profile.timeSchedule : null}
            profileDayOff={profileResult?.status === 'linked' ? profileResult.profile.dayOff : null}
            profileDepartmentName={profileResult?.status === 'linked' ? profileResult.profile.departmentName : null}
            profileStoreName={profileResult?.status === 'linked' ? profileResult.profile.storeName : null}
            initialDraft={assistantDraft?.intent === 'draft_esarf_request' ? assistantDraft : null}
            notificationCount={notificationUnreadCount}
            onAssistant={openAssistant}
            onNotifications={openNotifications}
            onBack={closeQuickRequest}
            onToast={setAppToast}
            onSubmitted={async () => {
              closeQuickRequest();
              setActiveTab('requests');
              await refreshDashboard();
            }}
          />
        </SlideOverlayContainer>

        <SlideOverlayContainer visible={activeQuickRequestScreen === 'request_leave'}>
          <RequestLeave
            name={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email}
            username={currentUsername}
            photoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
            leaveCreditRemaining={dashboardSummary.leave_credit_remaining}
            initialDraft={assistantDraft?.intent === 'draft_leave_request' ? assistantDraft : null}
            notificationCount={notificationUnreadCount}
            onAssistant={openAssistant}
            onNotifications={openNotifications}
            onBack={closeQuickRequest}
            onToast={setAppToast}
            onSubmitted={async () => {
              closeQuickRequest();
              setActiveTab('requests');
              await refreshDashboard();
            }}
          />
        </SlideOverlayContainer>

        <SlideOverlayContainer visible={activeQuickRequestScreen === 'apply_discount'}>
          <ApplyDiscountScreen
            name={profileResult?.status === 'linked' ? profileResult.profile.fullName : signedInUser.email}
            username={currentUsername}
            photoUrl={profileResult?.status === 'linked' ? profileResult.profile.photoUrl : null}
            initialDraft={assistantDraft?.intent === 'draft_perk_request' ? assistantDraft : null}
            notificationCount={notificationUnreadCount}
            onAssistant={openAssistant}
            onNotifications={openNotifications}
            onBack={closeQuickRequest}
            onToast={setAppToast}
            onSubmitted={async () => {
              closeQuickRequest();
              setActiveTab('requests');
              await refreshDashboard();
            }}
          />
        </SlideOverlayContainer>
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
      canUseBiometric={biometricEnabled && biometricAvailable && Boolean(savedUsername)}
      savedUsername={savedUsername}
      emailError={showLoginErrors && !email.trim() ? 'Required' : ''}
      passwordError={showLoginErrors && !password ? 'Required' : ''}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={signIn}
      onBiometricSubmit={signInWithBiometric}
      onCreateProfile={() => setPublicScreen('create_profile')}
      onRegisterAccount={() => setPublicScreen('register_account')}
    />,
  );
}

const SCREEN_WIDTH = Dimensions.get('window').width;

function SlideOverlayContainer({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const [shouldRender, setShouldRender] = useState(visible);
  const slideAnim = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_WIDTH,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShouldRender(false);
      });
    }
  }, [visible]);

  if (!shouldRender) {
    return null;
  }

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform: [{ translateX: slideAnim }],
          backgroundColor: '#ffffff',
          zIndex: 10,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function RewardsPlaceholderScreen({
  profileName,
  username,
  employeeCode,
  profilePhotoUrl,
  pointsBalance = 0,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onToast,
  onSignOut,
}: {
  profileName?: string | null;
  username?: string | null;
  employeeCode?: string | null;
  profilePhotoUrl?: string | null;
  pointsBalance?: number;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSignOut?: () => void | Promise<void>;
}) {
  const barcodeDigits = makeEan13Digits(employeeCode || username || profileName || 'HYG Portal');
  const [showWalletHistory, setShowWalletHistory] = useState(false);
  const [wallet, setWallet] = useState<RewardsWallet>(() => ({
    balance: pointsBalance,
    totalEarned: pointsBalance,
    totalRedeemed: 0,
    history: [],
  }));
  const [walletStatus, setWalletStatus] = useState('');
  const { width } = useWindowDimensions();
  const rewardsCardWidth = Math.max(0, (width - spacing.md * 2 - spacing.sm) / 2);
  const effectivePointsBalance = wallet.balance;

  useEffect(() => {
    let active = true;
    async function refreshWallet() {
      setWalletStatus('Loading wallet...');
      try {
        const nextWallet = await loadRewardsWallet();
        if (!active) {
          return;
        }
        setWallet(nextWallet);
        setWalletStatus('');
      } catch (error) {
        if (!active) {
          return;
        }
        setWalletStatus(error instanceof Error ? error.message : 'Unable to load HYG Wallet.');
      }
    }

    void refreshWallet();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setWallet((current) => ({
      ...current,
      balance: current.balance || pointsBalance,
    }));
  }, [pointsBalance]);

  if (showWalletHistory) {
    return (
      <View style={styles.settingsRoot}>
        <StatusBar style="dark" />
        <TopBar
          name={profileName || 'Rewards'}
          username={username}
          photoUrl={profilePhotoUrl}
          pointsBalance={effectivePointsBalance}
          notificationCount={notificationCount}
          onMessages={onAssistant}
          onNotifications={onNotifications}
          onBackHome={() => setShowWalletHistory(false)}
          onOpenProfile={onOpenProfile}
          onOpenSettings={onOpenSettings}
          onOpenMyTeam={onOpenMyTeam}
          onSignOut={onSignOut}
        />
        <ScrollView contentContainerStyle={styles.settingsScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.rewardsHistoryHeader}>
            <Image source={hygCoinsImage} style={styles.rewardsHistoryIcon} resizeMode="contain" />
            <View>
              <Text style={styles.rewardsHistoryTitle}>HYG Wallet History</Text>
              <Text style={styles.rewardsHistorySub}>Points earned and deducted</Text>
            </View>
          </View>

          {wallet.history.length ? wallet.history.map((item) => (
            <View key={item.id} style={styles.rewardsHistoryRow}>
              <View style={[styles.rewardsHistorySign, getRewardsHistorySignStyle(item)]}>
                <Text style={styles.rewardsHistorySignText}>{getRewardsHistorySign(item)}</Text>
              </View>
              <View style={styles.rewardsHistoryText}>
                <Text style={styles.rewardsHistorySource}>{item.source}</Text>
                <Text style={styles.rewardsHistoryDate}>{formatRewardsHistoryDate(item.date)}</Text>
              </View>
              <Text style={[styles.rewardsHistoryAmount, getRewardsHistoryAmountStyle(item)]}>
                {getRewardsHistoryAmountPrefix(item)}{formatRewardsPoints(item.points)}
              </Text>
            </View>
          )) : (
            <View style={styles.rewardsHistoryRow}>
              <View style={[styles.rewardsHistorySign, styles.rewardsHistorySignMinus]}>
                <Text style={styles.rewardsHistorySignText}>0</Text>
              </View>
              <View style={styles.rewardsHistoryText}>
                <Text style={styles.rewardsHistorySource}>No wallet history yet</Text>
                <Text style={styles.rewardsHistoryDate}>Claim HYG Points to start your history.</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.settingsRoot}>
      <StatusBar style="dark" />
      <TopBar
        name={profileName || 'Rewards'}
        username={username}
        photoUrl={profilePhotoUrl}
        pointsBalance={effectivePointsBalance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
      <ScrollView contentContainerStyle={[styles.settingsScroll, styles.myTeamScroll]} showsVerticalScrollIndicator={false}>
        <View style={styles.rewardsBarcodeCard}>
          <Text style={styles.rewardsBarcodeHint}>Scan to earn HYG Points</Text>
          <Text style={styles.rewardsBarcodeSub}>Present this barcode at any HYG partner location</Text>
          <View style={styles.rewardsBarcodeFrame}>
            <RewardsBarcode digits={barcodeDigits} />
            <Text style={styles.rewardsBarcodeText} numberOfLines={1}>
              {barcodeDigits.split('').join(' ')}
            </Text>
          </View>
        </View>

        <View style={styles.rewardsBalanceRow}>
          <View style={[styles.rewardsPointsCard, { width: rewardsCardWidth }]}>
            <View style={styles.rewardsPointsHeader}>
              <View style={styles.rewardsPointsHeaderLeft}>
                <Image source={hygCoinsImage} style={styles.rewardsCoinIcon} resizeMode="contain" />
                <View style={styles.rewardsPointsTitleBlock}>
                  <Text style={styles.rewardsPointsTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                    HYG Points
                  </Text>
                  <Text style={styles.rewardsConversion}>1 Point = P1.00</Text>
                </View>
              </View>
            </View>
            <View style={styles.rewardsPointsBody}>
              <Image source={hygCoinsImage} style={styles.rewardsPointsWatermark} resizeMode="contain" />
              <View>
                <Text style={styles.rewardsPointsLabel}>Available Balance</Text>
                  <Text style={styles.rewardsPointsValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62}>
                  {formatRewardsPoints(effectivePointsBalance)}
                </Text>
                <Text style={styles.rewardsPointsUnit}>Points</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.rewardsPointsAction, pressed ? styles.rewardsPointsActionPressed : null]}
                onPress={() => Alert.alert('Coming soon', 'Rewards redemption will be available soon.')}
              >
                <Text style={styles.rewardsPointsActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                  View Rewards
                </Text>
                <ChevronRight size={16} color={colors.surface} strokeWidth={2.8} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.rewardsWalletCard, { width: rewardsCardWidth }]}>
            <View style={styles.rewardsWalletHeader}>
              <View style={styles.rewardsWalletHeaderLeft}>
                <Image source={hygCoinsImage} style={styles.rewardsWalletCoin} resizeMode="contain" />
                <Text style={styles.rewardsWalletTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                  HYG Wallet
                </Text>
              </View>
            </View>
            <View style={styles.rewardsWalletBody}>
              <View style={styles.rewardsWalletStats}>
                <View style={styles.rewardsWalletStatItem}>
                  <Text style={styles.rewardsWalletLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                    Total Earned
                  </Text>
                  <Text style={styles.rewardsWalletValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                    P{formatRewardsPoints(wallet.totalEarned)}
                  </Text>
                </View>
                <View style={styles.rewardsWalletStatItem}>
                  <Text style={styles.rewardsWalletLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                    Total Redeemed
                  </Text>
                  <Text style={styles.rewardsWalletValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                    P{formatRewardsPoints(wallet.totalRedeemed)}
                  </Text>
                </View>
              </View>
              {walletStatus ? <Text style={styles.rewardsWalletStatus}>{walletStatus}</Text> : null}
              <Pressable
                style={({ pressed }) => [styles.rewardsWalletHistoryButton, pressed ? styles.rewardsWalletHistoryButtonPressed : null]}
                onPress={() => setShowWalletHistory(true)}
              >
                <Text style={styles.rewardsWalletHistoryButtonText}>History</Text>
                <ChevronRight size={14} color={colors.brand.gold} strokeWidth={2.8} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.rewardsServiceGrid}>
          <RewardsServiceTile title="Earn Points" text="Scan and earn points at partner locations" />
          <RewardsServiceTile title="Redeem Rewards" text="Use your points to get rewards" />
          <RewardsServiceTile title="Track History" text="View your points activity and history" />
        </View>

        <View style={styles.rewardsPromoStrip}>
          <Image source={hygCoinsImage} style={styles.rewardsPromoCoins} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.rewardsPromoTitle}>Earn Points. Redeem Rewards.</Text>
            <Text style={styles.rewardsPromoText}>Get more value every time you use HYG Portal.</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function RewardsServiceTile({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.rewardsServiceTile}>
      <View style={styles.rewardsServiceIcon}>
        <Image source={hygCoinsImage} style={styles.rewardsServiceCoin} resizeMode="contain" />
      </View>
      <Text style={styles.rewardsServiceTitle}>{title}</Text>
      <Text style={styles.rewardsServiceText}>{text}</Text>
    </View>
  );
}

function RewardsBarcode({ digits }: { digits: string }) {
  const pattern = getEan13Pattern(digits);

  return (
    <View style={styles.barcodeBars}>
      {pattern.split('').map((bit, index) => (
        <View key={`${index}-${bit}`} style={[styles.barcodeBar, bit === '1' ? styles.barcodeBarFilled : null]} />
      ))}
    </View>
  );
}

function makeEan13Digits(seed: string) {
  const numeric = seed.replace(/\D/g, '');
  const hashDigits = stableHash(seed).toString().padStart(12, '0');
  const base = (numeric || hashDigits).padStart(12, '0').slice(-12);
  return `${base}${getEan13Checksum(base)}`;
}

function getEan13Checksum(base12: string) {
  const sum = base12
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

const EAN13_LEFT_ODD: Record<string, string> = {
  '0': '0001101',
  '1': '0011001',
  '2': '0010011',
  '3': '0111101',
  '4': '0100011',
  '5': '0110001',
  '6': '0101111',
  '7': '0111011',
  '8': '0110111',
  '9': '0001011',
};

const EAN13_LEFT_EVEN: Record<string, string> = {
  '0': '0100111',
  '1': '0110011',
  '2': '0011011',
  '3': '0100001',
  '4': '0011101',
  '5': '0111001',
  '6': '0000101',
  '7': '0010001',
  '8': '0001001',
  '9': '0010111',
};

const EAN13_RIGHT: Record<string, string> = {
  '0': '1110010',
  '1': '1100110',
  '2': '1101100',
  '3': '1000010',
  '4': '1011100',
  '5': '1001110',
  '6': '1010000',
  '7': '1000100',
  '8': '1001000',
  '9': '1110100',
};

const EAN13_PARITY: Record<string, string> = {
  '0': 'OOOOOO',
  '1': 'OOEOEE',
  '2': 'OOEEOE',
  '3': 'OOEEEO',
  '4': 'OEOOEE',
  '5': 'OEEOOE',
  '6': 'OEEEOO',
  '7': 'OEOEOE',
  '8': 'OEOEEO',
  '9': 'OEEOEO',
};

function getEan13Pattern(digits: string) {
  const first = digits[0] ?? '0';
  const parity = EAN13_PARITY[first] ?? EAN13_PARITY['0'];
  const left = digits
    .slice(1, 7)
    .split('')
    .map((digit, index) => (parity[index] === 'E' ? EAN13_LEFT_EVEN[digit] : EAN13_LEFT_ODD[digit]))
    .join('');
  const right = digits
    .slice(7)
    .split('')
    .map((digit) => EAN13_RIGHT[digit])
    .join('');
  return `101${left}01010${right}101`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 10_000_000_000);
}

function formatRewardsPoints(value: number) {
  return Number(value ?? 0).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function formatRewardsHistoryDate(date: string) {
  return new Date(date).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getRewardsHistorySign(item: RewardsWalletHistoryItem) {
  if (item.type === 'earned') return '+';
  if (item.type === 'pending') return '...';
  return '-';
}

function getRewardsHistoryAmountPrefix(item: RewardsWalletHistoryItem) {
  if (item.type === 'earned') return '+';
  if (item.type === 'pending') return '';
  return '-';
}

function getRewardsHistorySignStyle(item: RewardsWalletHistoryItem) {
  return item.type === 'earned' || item.type === 'pending'
    ? styles.rewardsHistorySignAdd
    : styles.rewardsHistorySignMinus;
}

function getRewardsHistoryAmountStyle(item: RewardsWalletHistoryItem) {
  return item.type === 'earned' || item.type === 'pending'
    ? styles.rewardsHistoryAmountAdd
    : styles.rewardsHistoryAmountMinus;
}

function MyTeamPlaceholderScreen({
  profileResult,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onBackHome,
  onOpenProfile,
  onOpenSettings,
  onOpenMyTeam,
  onToast,
  onSignOut,
}: {
  profileResult: ProfileLoadResult | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onBackHome: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenMyTeam?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSignOut?: () => void | Promise<void>;
}) {
  const [activeView, setActiveView] = useState<'team' | 'schedule'>('team');
  const [employees, setEmployees] = useState<MyTeamEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(() => formatLocalIsoDate(new Date()));
  const [visibleScheduleMonth, setVisibleScheduleMonth] = useState(() => getMonthStart(new Date()));
  const [isScheduleComposerOpen, setIsScheduleComposerOpen] = useState(false);
  const [scheduleEmployeeIds, setScheduleEmployeeIds] = useState<string[]>([]);
  const [scheduleFromTime, setScheduleFromTime] = useState('');
  const [scheduleToTime, setScheduleToTime] = useState('');
  const [scheduleNotes, setScheduleNotes] = useState('');
  const [scheduleIsDayOff, setScheduleIsDayOff] = useState(false);
  const [scheduleFormError, setScheduleFormError] = useState('');
  const [mockAssignments, setMockAssignments] = useState<MockScheduleAssignment[]>([]);
  const [activeScheduleTab, setActiveScheduleTab] = useState<'calendar' | 'table'>('calendar');
  const [scheduleScrollWidth, setScheduleScrollWidth] = useState(0);
  const scheduleScrollViewRef = useRef<ScrollView>(null);
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;
  const storeScope = profile?.storeName || profile?.departmentName || 'Assigned store';
  const scheduledEmployeeIdsForDate = useMemo(
    () => new Set(mockAssignments.filter((assignment) => assignment.date === selectedScheduleDate).map((assignment) => assignment.employeeId)),
    [mockAssignments, selectedScheduleDate],
  );
  const todayScheduleDate = useMemo(() => formatLocalIsoDate(new Date()), []);
  const employeeScheduleSummaries = useMemo(
    () => buildTeamScheduleSummaries(mockAssignments, todayScheduleDate),
    [mockAssignments, todayScheduleDate],
  );

  async function refreshTeam() {
    setIsLoading(true);
    setStatus('Loading team...');
    try {
      const [rows, schedules] = await Promise.all([loadMyTeamEmployees(), loadMyTeamSchedules()]);
      setEmployees(rows);
      setMockAssignments(mapMyTeamScheduleRows(schedules));
      setStatus(rows.length ? '' : 'No team members found for your assigned store.');
    } catch (error) {
      setEmployees([]);
      setMockAssignments([]);
      setStatus(error instanceof Error ? error.message : 'Unable to load team members.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshTeam();
  }, []);

  function openScheduleComposer() {
    setScheduleFormError('');
    const firstAvailable = employees.find((employee) => !scheduledEmployeeIdsForDate.has(employee.employee_id));
    setScheduleEmployeeIds(firstAvailable?.employee_id ? [firstAvailable.employee_id] : []);
    setScheduleFromTime('09:00');
    setScheduleToTime('18:00');
    setScheduleNotes('');
    setScheduleIsDayOff(false);
    setIsScheduleComposerOpen(true);
  }

  function selectScheduleMonth(monthDate: Date) {
    const nextMonth = getMonthStart(monthDate);
    const today = new Date();
    setVisibleScheduleMonth(nextMonth);
    setSelectedScheduleDate(
      nextMonth.getFullYear() === today.getFullYear() && nextMonth.getMonth() === today.getMonth()
        ? formatLocalIsoDate(today)
        : formatLocalIsoDate(nextMonth),
    );
  }

  async function addMockScheduleAssignment() {
    if (!selectedScheduleDate) {
      setScheduleFormError('Select a date first.');
      return;
    }
    const selectedEmployees = employees.filter((item) => scheduleEmployeeIds.includes(item.employee_id));
    if (!selectedEmployees.length) {
      setScheduleFormError('Select at least one employee.');
      return;
    }
    if (!scheduleIsDayOff && (!scheduleFromTime.trim() || !scheduleToTime.trim())) {
      setScheduleFormError('Enter from and to time.');
      return;
    }

    try {
      const schedules = await saveMyTeamSchedules({
        employeeIds: selectedEmployees.map((employee) => employee.employee_id),
        scheduleDate: selectedScheduleDate,
        fromTime: scheduleIsDayOff ? '' : scheduleFromTime.trim(),
        toTime: scheduleIsDayOff ? '' : scheduleToTime.trim(),
        isDayOff: scheduleIsDayOff,
        notes: scheduleNotes.trim(),
      });
      setMockAssignments(mapMyTeamScheduleRows(schedules));
      setScheduleFromTime('');
      setScheduleToTime('');
      setScheduleNotes('');
      setScheduleEmployeeIds([]);
      setScheduleFormError('');
      setIsScheduleComposerOpen(false);
      setTimeout(() => {
        onToast?.({
          tone: 'success',
          title: 'Schedule saved',
          message: `${selectedEmployees.length} employee${selectedEmployees.length === 1 ? '' : 's'} saved to ${formatScheduleDisplayDate(selectedScheduleDate)}.`,
        });
      }, 120);
    } catch (error) {
      setScheduleFormError(error instanceof Error ? error.message : 'Unable to save schedule.');
    }
  }

  async function deleteMockScheduleAssignment(assignmentId: string) {
    const assignment = mockAssignments.find((item) => item.id === assignmentId);
    try {
      await deleteMyTeamSchedule(assignmentId);
      setMockAssignments((current) => current.filter((item) => item.id !== assignmentId));
      onToast?.({
        tone: 'success',
        title: 'Schedule deleted',
        message: assignment
          ? `${assignment.employeeName}'s schedule was removed from ${formatScheduleDisplayDate(assignment.date)}.`
          : 'Schedule was removed.',
      });
    } catch (error) {
      onToast?.({
        tone: 'error',
        title: 'Delete failed',
        message: error instanceof Error ? error.message : 'Unable to delete schedule.',
      });
    }
  }

  return (
    <View style={styles.settingsRoot}>
      <StatusBar style="dark" />
      <TopBar
        name={profile?.fullName || 'My Team'}
        username={profile?.username}
        photoUrl={profile?.photoUrl}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onBackHome={onBackHome}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
      <ScrollView contentContainerStyle={[styles.settingsScroll, styles.myTeamScroll]} showsVerticalScrollIndicator={false}>
        <View style={styles.settingsHeroCard}>
          <View style={styles.myTeamHeroInline}>
            <Text style={styles.profileTitle}>My Team</Text>
            <View style={styles.myTeamStoreInlinePill}>
              <Text style={styles.myTeamStoreInlineText} numberOfLines={1}>{storeScope}</Text>
            </View>
          </View>
        </View>

        <View style={styles.myTeamSegment}>
          <Pressable
            style={[styles.myTeamSegmentButton, activeView === 'team' ? styles.myTeamSegmentButtonActive : null]}
            onPress={() => setActiveView('team')}
          >
            <UsersRound size={17} color={activeView === 'team' ? colors.brand.ink : colors.muted} strokeWidth={2.7} />
            <Text style={[styles.myTeamSegmentText, activeView === 'team' ? styles.myTeamSegmentTextActive : null]}>My Team</Text>
          </Pressable>
          <Pressable
            style={[styles.myTeamSegmentButton, activeView === 'schedule' ? styles.myTeamSegmentButtonActive : null]}
            onPress={() => setActiveView('schedule')}
          >
            <CalendarDays size={17} color={activeView === 'schedule' ? colors.brand.ink : colors.muted} strokeWidth={2.7} />
            <Text style={[styles.myTeamSegmentText, activeView === 'schedule' ? styles.myTeamSegmentTextActive : null]}>Schedule</Text>
          </Pressable>
        </View>

        {activeView === 'team' ? (
          <View>
            <View style={styles.myTeamHeaderRow}>
              <View>
                <Text style={styles.myTeamSectionTitle}>Employees</Text>
                <Text style={styles.myTeamSectionSub}>{employees.length} team member(s)</Text>
              </View>
              <Pressable disabled={isLoading} style={styles.myTeamRefreshButton} onPress={() => void refreshTeam()}>
                <Text style={styles.myTeamRefreshText}>{isLoading ? 'Loading' : 'Refresh'}</Text>
              </Pressable>
            </View>
            {status ? <Text style={styles.myTeamStatus}>{status}</Text> : null}
            {employees.map((employee) => {
              const displayName = employee.full_name || '';
              const scheduleSummary = employeeScheduleSummaries[employee.employee_id] ?? {
                scheduleLabel: 'No sched',
                dayOffLabel: 'None',
              };
              return (
                <View key={employee.employee_id} style={styles.myTeamEmployeeCard}>
                  <View style={styles.myTeamEmployeeAvatar}>
                    {employee.photo_url ? (
                      <Image source={{ uri: employee.photo_url }} style={styles.myTeamEmployeePhoto} resizeMode="cover" />
                    ) : (
                      <Text style={styles.myTeamEmployeeAvatarText}>{getInitials(displayName || employee.employee_no || 'TM')}</Text>
                    )}
                  </View>
                  <View style={styles.myTeamEmployeeText}>
                    <Text style={styles.myTeamEmployeeName}>{displayName || 'Unnamed employee'}</Text>
                    <Text style={styles.myTeamEmployeeMeta} numberOfLines={1}>
                      {[employee.employee_no, employee.position_name, employee.department_name].filter(Boolean).join(' | ') || 'Employee details pending'}
                    </Text>
                    <View style={styles.myTeamScheduleRow}>
                      <View style={styles.myTeamSchedulePill}>
                        <Text style={styles.myTeamSchedulePillText} numberOfLines={1}>{scheduleSummary.scheduleLabel}</Text>
                      </View>
                      <View style={styles.myTeamSchedulePill}>
                        <Text style={styles.myTeamSchedulePillText} numberOfLines={1}>{scheduleSummary.dayOffLabel}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.myTeamStatusPill}>
                    <Text style={styles.myTeamStatusPillText}>{employee.employment_status || 'Active'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View onLayout={(e) => setScheduleScrollWidth(e.nativeEvent.layout.width)}>
            <ScrollView
              ref={scheduleScrollViewRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                if (scheduleScrollWidth > 0) {
                  const offsetX = e.nativeEvent.contentOffset.x;
                  const index = Math.round(offsetX / scheduleScrollWidth);
                  setActiveScheduleTab(index === 0 ? 'calendar' : 'table');
                }
              }}
            >
              <View style={{ width: scheduleScrollWidth || '100%' }}>
                <MockScheduleCalendar
                  selectedDate={selectedScheduleDate}
                  visibleMonth={visibleScheduleMonth}
                  assignments={mockAssignments}
                  onSelectDate={setSelectedScheduleDate}
                  onSelectMonth={selectScheduleMonth}
                  onAddSchedule={openScheduleComposer}
                  onDeleteSchedule={deleteMockScheduleAssignment}
                />
              </View>
              <View style={{ width: scheduleScrollWidth || '100%' }}>
                <MockScheduleTable assignments={mockAssignments} storeScope={storeScope} onDeleteSchedule={deleteMockScheduleAssignment} />
              </View>
            </ScrollView>
            <View style={styles.schedulePaginationContainer}>
              <View style={[styles.schedulePaginationDot, activeScheduleTab === 'calendar' ? styles.schedulePaginationDotActive : null]} />
              <View style={[styles.schedulePaginationDot, activeScheduleTab === 'table' ? styles.schedulePaginationDotActive : null]} />
            </View>
          </View>
        )}
      </ScrollView>
      <ScheduleComposerModal
        visible={isScheduleComposerOpen}
        selectedDate={selectedScheduleDate}
        employees={employees}
        excludedEmployeeIds={Array.from(scheduledEmployeeIdsForDate)}
        employeeIds={scheduleEmployeeIds}
        fromTime={scheduleFromTime}
        toTime={scheduleToTime}
        notes={scheduleNotes}
        isDayOff={scheduleIsDayOff}
        onDayOffChange={setScheduleIsDayOff}
        error={scheduleFormError}
        onEmployeeToggle={(employeeId) => {
          setScheduleEmployeeIds((current) =>
            current.includes(employeeId)
              ? current.filter((item) => item !== employeeId)
              : [...current, employeeId],
          );
        }}
        onFromTimeChange={setScheduleFromTime}
        onToTimeChange={setScheduleToTime}
        onNotesChange={setScheduleNotes}
        onCancel={() => setIsScheduleComposerOpen(false)}
        onSubmit={addMockScheduleAssignment}
      />
    </View>
  );
}

const calendarWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mockScheduleHolidays: Record<string, string> = {
  '2026-06-12': 'Independence Day',
  '2026-08-21': 'Ninoy Aquino Day',
  '2026-08-31': 'National Heroes Day',
  '2026-11-30': 'Bonifacio Day',
  '2026-12-25': 'Christmas Day',
  '2026-12-30': 'Rizal Day',
};

type MockScheduleAssignment = {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  fromTime: string;
  toTime: string;
  isDayOff?: boolean;
  notes: string;
};

function mapMyTeamScheduleRows(rows: MyTeamSchedule[]): MockScheduleAssignment[] {
  return rows.map((row) => ({
    id: row.id,
    date: row.schedule_date,
    employeeId: row.employee_id,
    employeeName: row.employee_name || 'Employee',
    fromTime: row.from_time ?? '',
    toTime: row.to_time ?? '',
    isDayOff: row.is_day_off,
    notes: row.notes ?? '',
  }));
}

function buildTeamScheduleSummaries(assignments: MockScheduleAssignment[], today: string) {
  return assignments.reduce<Record<string, { scheduleLabel: string; dayOffLabel: string }>>((summaries, assignment) => {
    const current = summaries[assignment.employeeId] ?? { scheduleLabel: 'No sched', dayOffLabel: 'None' };

    if (assignment.date === today && !assignment.isDayOff && assignment.fromTime && assignment.toTime) {
      current.scheduleLabel = `${formatTimeDisplay(assignment.fromTime)} - ${formatTimeDisplay(assignment.toTime)}`;
    }

    if (assignment.isDayOff && assignment.date <= today) {
      const currentDayOffDate = parseTeamDayOffDate(current.dayOffLabel);
      if (!currentDayOffDate || assignment.date > currentDayOffDate) {
        current.dayOffLabel = `Off: ${formatScheduleShortDate(assignment.date)}`;
      }
    }

    summaries[assignment.employeeId] = current;
    return summaries;
  }, {});
}

function parseTeamDayOffDate(label: string) {
  if (!label.startsWith('Off: ')) {
    return '';
  }

  const parsed = new Date(label.replace('Off: ', ''));
  return Number.isNaN(parsed.getTime()) ? '' : formatLocalIsoDate(parsed);
}

function MockScheduleCalendar({
  selectedDate,
  visibleMonth,
  assignments,
  onSelectDate,
  onSelectMonth,
  onAddSchedule,
  onDeleteSchedule,
}: {
  selectedDate: string;
  visibleMonth: Date;
  assignments: MockScheduleAssignment[];
  onSelectDate: (date: string) => void;
  onSelectMonth: (date: Date) => void;
  onAddSchedule: () => void;
  onDeleteSchedule: (assignmentId: string) => void;
}) {
  const [isMonthSelectorOpen, setIsMonthSelectorOpen] = useState(false);
  const calendarCells = useMemo(
    () => buildMockScheduleMonth(visibleMonth.getFullYear(), visibleMonth.getMonth()),
    [visibleMonth],
  );
  const monthOptions = useMemo(() => buildScheduleMonthOptions(visibleMonth.getFullYear()), [visibleMonth]);
  const selectedCell = calendarCells.find((item) => item.date && item.isoDate === selectedDate);
  const selectedAssignments = assignments.filter((assignment) => assignment.date === selectedDate);
  const selectedMonthLabel = visibleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <View>
      <View style={styles.myTeamHeaderRow}>
        <View>
          <Text style={styles.myTeamSectionTitle}>Schedule Calendar</Text>
          <Text style={styles.myTeamSectionSub}>
            {selectedCell?.date ? `Selected: ${formatScheduleShortDate(selectedDate)}` : 'Select a date'}
          </Text>
        </View>
        <Pressable style={styles.scheduleAddButton} onPress={onAddSchedule}>
          <Plus size={19} color={colors.brand.ink} strokeWidth={3} />
        </Pressable>
      </View>
      <View style={styles.scheduleCalendarCard}>
        <View style={styles.scheduleCalendarHeader}>
          <Pressable
            style={styles.scheduleMonthSelect}
            onPress={() => setIsMonthSelectorOpen(true)}
          >
            <CalendarDays size={16} color={colors.primary} strokeWidth={2.7} />
            <Text style={styles.scheduleCalendarMonth}>{selectedMonthLabel}</Text>
          </Pressable>
          <Text style={styles.scheduleCalendarBadge}>Select month</Text>
        </View>
        <View style={styles.scheduleWeekdayRow}>
          {calendarWeekdays.map((day) => (
            <Text
              key={day}
              style={[
                styles.scheduleWeekdayText,
                day === 'Sun' || day === 'Sat' ? styles.scheduleWeekdayWeekendText : null,
              ]}
            >
              {day}
            </Text>
          ))}
        </View>
        <View style={styles.scheduleCalendarGrid}>
          {calendarCells.map((item, index) => {
            const dayAssignments = item.isoDate ? assignments.filter((assignment) => assignment.date === item.isoDate) : [];
            const selected = Boolean(item.isoDate && item.isoDate === selectedDate);
            const hasAssignment = dayAssignments.length > 0;
            const isHoliday = Boolean(item.isoDate && mockScheduleHolidays[item.isoDate]);
            const isWeekend = item.tone === 'rest';

            return (
            <Pressable
              key={item.date ? `day-${item.date}` : `blank-${index}`}
              disabled={!item.date || !item.isoDate}
              onPress={() => item.isoDate && onSelectDate(item.isoDate)}
              style={[
                styles.scheduleDayCell,
                !item.date ? styles.scheduleDayCellBlank : null,
                isWeekend && item.date ? styles.scheduleDayCellWeekend : null,
              ]}
            >
              {item.date ? (
                <View
                  style={[
                    styles.scheduleDatePill,
                    isWeekend ? styles.scheduleDatePillRest : null,
                    hasAssignment ? styles.scheduleDatePillAssigned : null,
                    selected ? styles.scheduleDatePillSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.scheduleDayDate,
                      isWeekend ? styles.scheduleDayDateRest : null,
                      hasAssignment || selected ? styles.scheduleDayDateStrong : null,
                    ]}
                  >
                    {item.date}
                  </Text>
                  {isHoliday ? <View style={styles.scheduleHolidayDot} /> : null}
                </View>
              ) : null}
            </Pressable>
            );
          })}
        </View>
        <View style={styles.scheduleLegendRow}>
          <View style={styles.scheduleLegendItem}>
            <View style={[styles.scheduleLegendDot, styles.scheduleLegendDotHoliday]} />
            <Text style={styles.scheduleLegendText}>Holiday</Text>
          </View>
          <View style={styles.scheduleLegendItem}>
            <View style={[styles.scheduleLegendDot, styles.scheduleLegendDotWeekend]} />
            <Text style={styles.scheduleLegendText}>Sat / Sun</Text>
          </View>
          <View style={styles.scheduleLegendItem}>
            <View style={[styles.scheduleLegendDot, styles.scheduleLegendDotAssigned]} />
            <Text style={styles.scheduleLegendText}>With schedule</Text>
          </View>
        </View>
      </View>
      <View style={styles.selectedSchedulePanel}>
        <Text style={styles.selectedScheduleTitle}>{formatScheduleDisplayDate(selectedDate)}</Text>
        {mockScheduleHolidays[selectedDate] ? (
          <View style={styles.selectedHolidayRow}>
            <Text style={styles.selectedHolidayText}>{mockScheduleHolidays[selectedDate]}</Text>
          </View>
        ) : null}
        {selectedAssignments.length ? (
          selectedAssignments.map((assignment) => (
            <View key={assignment.id} style={styles.selectedScheduleRow}>
              <View style={styles.selectedScheduleTextBlock}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.selectedScheduleName}>{assignment.employeeName}</Text>
                  {assignment.isDayOff ? (
                    <View style={styles.selectedScheduleDayOffBadge}>
                      <Text style={styles.selectedScheduleDayOffBadgeText}>Day Off</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.selectedScheduleMeta}>
                  {formatScheduleAssignmentLine(assignment.date, assignment.fromTime, assignment.toTime, assignment.isDayOff)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${assignment.employeeName} schedule`}
                style={styles.selectedScheduleDelete}
                onPress={() => onDeleteSchedule(assignment.id)}
              >
                <Trash2 size={16} color={colors.semantic.danger} strokeWidth={2.6} />
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.selectedScheduleEmpty}>No employee schedule added for this date.</Text>
        )}
      </View>
      <Modal visible={isMonthSelectorOpen} transparent animationType="fade" onRequestClose={() => setIsMonthSelectorOpen(false)}>
        <View style={styles.scheduleMonthModalBackdrop}>
          <Pressable style={styles.scheduleMonthModalDismiss} onPress={() => setIsMonthSelectorOpen(false)} />
          <View style={styles.scheduleMonthModalSheet}>
            <View style={styles.scheduleMonthModalHeader}>
              <View>
                <Text style={styles.scheduleMonthModalTitle}>Select Month</Text>
                <Text style={styles.scheduleMonthModalSub}>{visibleMonth.getFullYear()}</Text>
              </View>
              <Pressable style={styles.scheduleMonthModalClose} onPress={() => setIsMonthSelectorOpen(false)}>
                <X size={18} color={colors.text} strokeWidth={2.7} />
              </Pressable>
            </View>
            <View style={styles.scheduleMonthMenu}>
              {monthOptions.map((monthOption) => {
                const selected =
                  monthOption.date.getFullYear() === visibleMonth.getFullYear() &&
                  monthOption.date.getMonth() === visibleMonth.getMonth();

                return (
                  <Pressable
                    key={monthOption.key}
                    style={[styles.scheduleMonthOption, selected ? styles.scheduleMonthOptionActive : null]}
                    onPress={() => {
                      onSelectMonth(monthOption.date);
                      setIsMonthSelectorOpen(false);
                    }}
                  >
                    <Text style={[styles.scheduleMonthOptionText, selected ? styles.scheduleMonthOptionTextActive : null]}>
                      {monthOption.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MockScheduleTable({
  assignments,
  storeScope,
  onDeleteSchedule,
}: {
  assignments: MockScheduleAssignment[];
  storeScope: string;
  onDeleteSchedule: (assignmentId: string) => void;
}) {
  const sortedAssignments = useMemo(() => {
    return [...assignments].sort((a, b) => {
      const employeeCompare = a.employeeName.localeCompare(b.employeeName);
      if (employeeCompare !== 0) return employeeCompare;
      return a.date.localeCompare(b.date);
    });
  }, [assignments]);

  return (
    <View style={styles.scheduleTableCard}>
      <View style={styles.myTeamHeaderRow}>
        <View>
          <Text style={styles.myTeamSectionTitle}>Raw Schedule Table</Text>
          <Text style={styles.myTeamSectionSub}>
            {assignments.length} total assignment{assignments.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Pressable
          disabled={sortedAssignments.length === 0}
          style={[styles.scheduleExportButton, sortedAssignments.length === 0 ? styles.scheduleExportButtonDisabled : null]}
          onPress={() => void exportScheduleTableToExcel(sortedAssignments, storeScope)}
        >
          <Download size={16} color={colors.brand.ink} strokeWidth={2.7} />
          <Text style={styles.scheduleExportButtonText}>Export</Text>
        </Pressable>
      </View>
      {sortedAssignments.length > 0 ? (
        <View style={styles.scheduleTableContainer}>
          <View style={styles.scheduleTableHeader}>
            <View style={[styles.scheduleTableHeaderCell, styles.scheduleTableNameColumn]}>
              <Text style={styles.scheduleTableHeaderText}>Employee Name</Text>
            </View>
            <View style={[styles.scheduleTableHeaderCell, styles.scheduleTableDateColumn]}>
              <Text style={styles.scheduleTableHeaderText}>Date</Text>
            </View>
            <View style={[styles.scheduleTableHeaderCell, styles.scheduleTableShiftColumn]}>
              <Text style={styles.scheduleTableHeaderText}>Time / Shift</Text>
            </View>
          </View>
          {sortedAssignments.map((assignment, index) => {
            const startsEmployeeGroup =
              index > 0 && sortedAssignments[index - 1].employeeName !== assignment.employeeName;

            return (
              <View key={assignment.id}>
                {startsEmployeeGroup ? <ScheduleTableSpacerRow /> : null}
                <View style={[styles.scheduleTableRow, index % 2 === 1 ? styles.scheduleTableRowAlt : null]}>
                  <View style={[styles.scheduleTableCell, styles.scheduleTableNameColumn]}>
                    <Text style={[styles.scheduleTableCellText, styles.scheduleTableCellStrong]}>
                      {assignment.employeeName}
                    </Text>
                  </View>
                  <View style={[styles.scheduleTableCell, styles.scheduleTableDateColumn]}>
                    <Text style={styles.scheduleTableCellText}>
                      {formatScheduleShortDate(assignment.date)}
                    </Text>
                  </View>
                  <View style={[styles.scheduleTableCell, styles.scheduleTableShiftColumn, { alignItems: 'flex-start' }]}>
                    {assignment.isDayOff ? (
                      <Text style={styles.scheduleTableCellTime}>Day Off</Text>
                    ) : (
                      <Text style={styles.scheduleTableCellTime}>
                        {formatTimeDisplay(assignment.fromTime)} - {formatTimeDisplay(assignment.toTime)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.scheduleTableEmpty}>
          <Text style={styles.scheduleTableEmptyText}>No schedules added yet.</Text>
        </View>
      )}
    </View>
  );
}

function ScheduleTableSpacerRow() {
  return (
    <View style={[styles.scheduleTableRow, styles.scheduleTableSpacerRow]}>
      <View style={[styles.scheduleTableCell, styles.scheduleTableNameColumn]} />
      <View style={[styles.scheduleTableCell, styles.scheduleTableDateColumn]} />
      <View style={[styles.scheduleTableCell, styles.scheduleTableShiftColumn]} />
    </View>
  );
}

async function exportScheduleTableToExcel(assignments: MockScheduleAssignment[], storeScope: string) {
  if (!assignments.length) {
    Alert.alert('No schedules to export', 'Add schedules before exporting the table.');
    return;
  }

  const title = `Schedule - ${storeScope || 'Assigned Store'}`;
  const rows = buildScheduleExportRows(assignments);
  const workbookBytes = buildScheduleWorkbookBytes(title, rows);
  const fileName = `${slugifyFilePart(title)}.xlsx`;

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([workbookBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('Export unavailable', 'Sharing files is not available on this device.');
      return;
    }

    const file = new FileSystem.File(FileSystem.Paths.cache, fileName);
    file.write(workbookBytes);
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: title,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  } catch (error) {
    Alert.alert('Export failed', error instanceof Error ? error.message : 'Unable to export schedule.');
  }
}

function buildScheduleExportRows(assignments: MockScheduleAssignment[]) {
  return assignments.flatMap((assignment, index) => {
    const startsEmployeeGroup =
      index > 0 && assignments[index - 1].employeeName !== assignment.employeeName;
    const row = [
      assignment.employeeName,
      formatScheduleShortDate(assignment.date),
      assignment.isDayOff ? 'Day Off' : `${formatTimeDisplay(assignment.fromTime)} - ${formatTimeDisplay(assignment.toTime)}`,
    ];

    return startsEmployeeGroup ? [['', '', ''], row] : [row];
  });
}

function buildScheduleWorkbookBytes(title: string, rows: string[][]) {
  const sheetRows = [
    ['Schedule', title, ''],
    ['Employee Name', 'Date', 'Time / Shift'],
    ...rows,
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 24 }];
  worksheet['!ref'] = `A1:C${sheetRows.length}`;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Schedule');
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(output);
}

function slugifyFilePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'schedule';
}

function ScheduleComposerModal({
  visible,
  selectedDate,
  employees,
  excludedEmployeeIds,
  employeeIds,
  fromTime,
  toTime,
  notes,
  isDayOff,
  onDayOffChange,
  error,
  onEmployeeToggle,
  onFromTimeChange,
  onToTimeChange,
  onNotesChange,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  selectedDate: string;
  employees: MyTeamEmployee[];
  excludedEmployeeIds: string[];
  employeeIds: string[];
  fromTime: string;
  toTime: string;
  notes: string;
  isDayOff: boolean;
  onDayOffChange: (value: boolean) => void;
  error: string;
  onEmployeeToggle: (employeeId: string) => void;
  onFromTimeChange: (value: string) => void;
  onToTimeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const [isEmployeeDropdownOpen, setIsEmployeeDropdownOpen] = useState(false);
  const [activeTimePicker, setActiveTimePicker] = useState<'from' | 'to' | null>(null);
  const [digitalHour, setDigitalHour] = useState('9');
  const [digitalMinute, setDigitalMinute] = useState('00');
  const [digitalPeriod, setDigitalPeriod] = useState<'AM' | 'PM'>('AM');
  const availableEmployees = employees.filter(
    (employee) => !excludedEmployeeIds.includes(employee.employee_id) || employeeIds.includes(employee.employee_id),
  );
  const selectedEmployeeNames = availableEmployees
    .filter((employee) => employeeIds.includes(employee.employee_id))
    .map((employee) => employee.full_name || employee.employee_no || 'Employee');
  const selectedEmployeeLabel =
    selectedEmployeeNames.length === 0
      ? ''
      : selectedEmployeeNames.length === 1
        ? selectedEmployeeNames[0]
        : `${selectedEmployeeNames.length} employees selected`;

  function openDigitalTimePicker(target: 'from' | 'to') {
    const value = target === 'from' ? fromTime : toTime;
    const parsed = parseDigitalTimeValue(value);
    setDigitalHour(parsed.hour);
    setDigitalMinute(parsed.minute);
    setDigitalPeriod(parsed.period);
    setActiveTimePicker(target);
  }

  function applyDigitalTimePicker() {
    if (!activeTimePicker) {
      return;
    }

    const value = digitalTimeToInput(digitalHour, digitalMinute, digitalPeriod);
    if (activeTimePicker === 'from') {
      onFromTimeChange(value);
    } else {
      onToTimeChange(value);
    }
    setActiveTimePicker(null);
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.scheduleComposerBackdrop}>
        <Pressable style={styles.scheduleComposerDismiss} onPress={onCancel} />
        <View style={styles.scheduleComposerSheet}>
          <View style={styles.scheduleComposerHeader}>
            <View>
              <Text style={styles.scheduleComposerTitle}>Add Schedule</Text>
              <Text style={styles.scheduleComposerSub}>{formatScheduleDisplayDate(selectedDate)}</Text>
            </View>
            <Pressable style={styles.scheduleComposerClose} onPress={onCancel}>
              <X size={18} color={colors.text} strokeWidth={2.8} />
            </Pressable>
          </View>

          <Text style={styles.scheduleComposerLabel}>Employee</Text>
          <Pressable
            style={styles.scheduleDropdownField}
            onPress={() => setIsEmployeeDropdownOpen((current) => !current)}
          >
            <Text style={[styles.scheduleDropdownText, !selectedEmployeeLabel ? styles.scheduleDropdownPlaceholder : null]} numberOfLines={1}>
              {selectedEmployeeLabel || 'Select employees'}
            </Text>
            <ChevronRight size={16} color={colors.muted} strokeWidth={2.7} />
          </Pressable>
          {isEmployeeDropdownOpen ? (
            <ScrollView style={styles.scheduleDropdownMenu} nestedScrollEnabled showsVerticalScrollIndicator>
              {availableEmployees.length ? availableEmployees.map((employee) => {
                const name = employee.full_name || employee.employee_no || 'Employee';
                const selected = employeeIds.includes(employee.employee_id);
                return (
                  <Pressable
                    key={employee.employee_id}
                    style={[styles.scheduleDropdownOption, selected ? styles.scheduleDropdownOptionActive : null]}
                    onPress={() => {
                      onEmployeeToggle(employee.employee_id);
                    }}
                  >
                    <View style={[styles.scheduleDropdownCheckbox, selected ? styles.scheduleDropdownCheckboxActive : null]}>
                      {selected ? <Text style={styles.scheduleDropdownCheckboxText}>OK</Text> : null}
                    </View>
                    <Text style={[styles.scheduleDropdownOptionText, selected ? styles.scheduleDropdownOptionTextActive : null]} numberOfLines={1}>
                      {name}
                    </Text>
                  </Pressable>
                );
              }) : (
                <Text style={styles.scheduleDropdownEmpty}>All employees already have a schedule for this date.</Text>
              )}
            </ScrollView>
          ) : null}

          <Pressable
            style={styles.scheduleDayOffRow}
            onPress={() => {
              onDayOffChange(!isDayOff);
              if (!isDayOff) {
                setActiveTimePicker(null);
              }
            }}
          >
            <View style={[styles.scheduleDayOffCheckbox, isDayOff ? styles.scheduleDayOffCheckboxActive : null]}>
              {isDayOff ? <Check size={14} color={colors.brand.ink} strokeWidth={3} /> : null}
            </View>
            <Text style={styles.scheduleDayOffLabel}>Mark as Day Off</Text>
          </Pressable>

          {!isDayOff ? (
            <>
              <View style={styles.scheduleTimeRow}>
                <View style={styles.scheduleTimeField}>
                  <Text style={styles.scheduleComposerLabel}>From</Text>
                  <Pressable style={styles.scheduleTimePickerButton} onPress={() => openDigitalTimePicker('from')}>
                    <Text style={[styles.scheduleTimePickerText, !fromTime ? styles.scheduleDropdownPlaceholder : null]}>
                      {fromTime ? formatTimeDisplay(fromTime) : 'Select time'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.scheduleTimeField}>
                  <Text style={styles.scheduleComposerLabel}>To</Text>
                  <Pressable style={styles.scheduleTimePickerButton} onPress={() => openDigitalTimePicker('to')}>
                    <Text style={[styles.scheduleTimePickerText, !toTime ? styles.scheduleDropdownPlaceholder : null]}>
                      {toTime ? formatTimeDisplay(toTime) : 'Select time'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {activeTimePicker ? (
                <View style={styles.digitalTimePickerPanel}>
                  <View style={styles.digitalTimePickerControls}>
                    <SlideTimeColumn
                      label="Hour"
                      options={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']}
                      value={digitalHour}
                      onChange={setDigitalHour}
                    />
                    <SlideTimeColumn
                      label="Minute"
                      options={['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']}
                      value={digitalMinute}
                      onChange={setDigitalMinute}
                    />
                    <SlideTimeColumn
                      label="AM/PM"
                      options={['AM', 'PM']}
                      value={digitalPeriod}
                      onChange={(value) => setDigitalPeriod(value as 'AM' | 'PM')}
                    />
                  </View>
                  <View style={styles.digitalTimePickerActions}>
                    <Pressable style={styles.digitalTimeCancel} onPress={() => setActiveTimePicker(null)}>
                      <Text style={styles.digitalTimeCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable style={styles.digitalTimeApply} onPress={applyDigitalTimePicker}>
                      <Text style={styles.digitalTimeApplyText}>Apply</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.scheduleDayOffNotice}>
              <Text style={styles.scheduleDayOffNoticeText}>This day will be marked as a scheduled Day Off.</Text>
            </View>
          )}

          <Text style={styles.scheduleComposerLabel}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={onNotesChange}
            placeholder="Optional"
            placeholderTextColor="#94a3b8"
            multiline
            style={[styles.scheduleComposerInput, styles.scheduleComposerNotes]}
          />
          {error ? <Text style={styles.scheduleComposerError}>{error}</Text> : null}

          <View style={styles.scheduleComposerActions}>
            <Pressable style={styles.scheduleComposerCancel} onPress={onCancel}>
              <Text style={styles.scheduleComposerCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.scheduleComposerSubmit} onPress={onSubmit}>
              <Text style={styles.scheduleComposerSubmitText}>Add</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SlideTimeColumn({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    const index = options.indexOf(value);
    if (index >= 0 && scrollViewRef.current) {
      const itemHeight = 42;
      const frameHeight = 132;
      const y = Math.max(0, index * itemHeight - (frameHeight / 2) + (itemHeight / 2));
      scrollViewRef.current.scrollTo({ y, animated: true });
    }
  }, [value, options]);

  return (
    <View style={styles.digitalTimePickerColumn}>
      <Text style={styles.digitalTimePickerLabel}>{label}</Text>
      <ScrollView
        ref={scrollViewRef}
        style={styles.slideTimePickerFrame}
        contentContainerStyle={styles.slideTimePickerContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {options.map((option) => {
          const selected = option === value;

          return (
            <Pressable
              key={option}
              style={[styles.slideTimeOption, selected ? styles.slideTimeOptionActive : null]}
              onPress={() => onChange(option)}
            >
              <Text style={[styles.slideTimeOptionText, selected ? styles.slideTimeOptionTextActive : null]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function formatLocalIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatScheduleDisplayDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return 'Select a date';
  }
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatScheduleShortDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return 'Select a date';
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatScheduleAssignmentLine(dateValue: string, fromTime: string, toTime: string, isDayOff?: boolean) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const timeText = isDayOff ? 'Day Off' : `${formatTimeDisplay(fromTime)} to ${formatTimeDisplay(toTime)}`;
  if (!year || !month || !day) {
    return timeText;
  }

  const date = new Date(year, month - 1, day);
  const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
  const monthLabel = date.toLocaleDateString('en-US', { month: 'long' });
  return `${day} ${monthLabel} (${dayLabel}) | ${timeText}`;
}

function parseDigitalTimeValue(value: string) {
  if (!value) {
    return { hour: '9', minute: '00', period: 'AM' as const };
  }

  const [rawHour, rawMinute] = value.split(':').map(Number);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) {
    return { hour: '9', minute: '00', period: 'AM' as const };
  }

  const period = rawHour >= 12 ? 'PM' : 'AM';
  const displayHour = rawHour % 12 || 12;
  const minuteText = String(rawMinute).padStart(2, '0');
  const roundedMinute = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].includes(minuteText)
    ? String(rawMinute).padStart(2, '0')
    : '00';

  return {
    hour: String(displayHour),
    minute: roundedMinute,
    period: period as 'AM' | 'PM',
  };
}

function digitalTimeToInput(hourValue: string, minuteValue: string, period: 'AM' | 'PM') {
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) {
    hour = 9;
  }

  if (period === 'AM' && hour === 12) {
    hour = 0;
  } else if (period === 'PM' && hour !== 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, '0')}:${String(Number.isFinite(minute) ? minute : 0).padStart(2, '0')}`;
}

function buildScheduleMonthOptions(year: number) {
  return Array.from({ length: 12 }, (_, month) => {
    const date = new Date(year, month, 1);
    return {
      key: `${year}-${month}`,
      date,
      label: date.toLocaleDateString('en-US', { month: 'short' }),
    };
  });
}

function buildMockScheduleMonth(year: number, month: number) {
  const firstDate = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDate.getDay();
  const cells: Array<
    { date: string; isoDate: string; shift: string; tone: 'work' | 'rest' } |
    { date: null; isoDate: null; shift: ''; tone: 'blank' }
  > = [];

  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push({ date: null, isoDate: null, shift: '', tone: 'blank' });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = new Date(year, month, day).getDay();
    const isRest = weekday === 0 || weekday === 6;
    const shift = isRest ? 'REST' : getMockShift(day);
    const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ date: String(day), isoDate, shift, tone: isRest ? 'rest' : 'work' });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ date: null, isoDate: null, shift: '', tone: 'blank' });
  }

  return cells;
}

function getMockShift(day: number) {
  const shifts = ['9A-6P', '10A-7P', '2P-11P', '8A-5P'];
  return shifts[day % shifts.length];
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return 'TM';
  }
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}


function SettingsTabScreen({
  onAssistant,
  onNotifications,
  onBackHome,
  onOpenMyTeam,
  onSignOut,
  userEmail,
  username,
  profileName,
  profilePhotoUrl,
  notificationCount = 0,
  pointsBalance = 0,
  biometricAvailable,
  biometricEnabled,
  notificationsEnabled,
  onToggleNotifications,
  onToggleBiometric,
}: {
  onAssistant?: () => void;
  onNotifications?: () => void;
  onBackHome: () => void;
  onOpenMyTeam?: () => void;
  onSignOut: () => void | Promise<void>;
  userEmail: string;
  username?: string | null;
  profileName?: string | null;
  profilePhotoUrl?: string | null;
  notificationCount?: number;
  pointsBalance?: number;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void | Promise<void>;
  onToggleBiometric: () => void | Promise<void>;
}) {
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>(() => getInitialAppUpdateState());
  const isCheckingForUpdate = appUpdateState.status === 'checking';
  const isDownloadingUpdate = appUpdateState.status === 'downloading';
  const canDownloadUpdate = appUpdateState.status === 'available';
  const canRestartForUpdate = appUpdateState.status === 'ready';
  const isWebApp = Platform.OS === 'web';
  const shouldShowUpdateActions = !isWebApp;
  const shouldShowApkDownload = !isWebApp && (appUpdateState.status === 'unsupported' || appUpdateState.status === 'error');
  const biometricLabel = biometricEnabled
    ? Platform.OS === 'ios'
      ? 'Enabled (Face ID / Touch ID)'
      : 'Enabled (Fingerprint)'
    : 'Disabled';
  const updateStatusLabel = getAppUpdateStatusLabel(appUpdateState.status);

  useEffect(() => {
    let active = true;
    setAppUpdateState((current) => ({ ...current, status: 'checking', message: 'Checking for app updates...' }));
    checkForAppUpdate().then((state) => {
      if (active) {
        setAppUpdateState(state);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleCheckForUpdate() {
    setAppUpdateState((current) => ({ ...current, status: 'checking', message: 'Checking for app updates...' }));
    setAppUpdateState(await checkForAppUpdate());
  }

  async function handleDownloadUpdate() {
    setAppUpdateState((current) => ({ ...current, status: 'downloading', message: 'Downloading update...' }));
    setAppUpdateState(await downloadAppUpdate());
  }

  async function handleRestartForUpdate() {
    try {
      await restartToApplyAppUpdate();
    } catch (error) {
      setAppUpdateState((current) => ({
        ...current,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to restart app.',
      }));
    }
  }

  return (
    <View style={styles.settingsRoot}>
      <StatusBar style="dark" />
      <TopBar
        name={profileName || userEmail || 'Settings'}
        username={username || userEmail}
        photoUrl={profilePhotoUrl}
        pointsBalance={pointsBalance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onBackHome={onBackHome}
        onOpenMyTeam={onOpenMyTeam}
        onSignOut={onSignOut}
      />
      <ScrollView contentContainerStyle={styles.settingsTabScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.settingsHeroCard}>
          <Text style={styles.profileTitle}>Settings</Text>
          <Text style={styles.profileMuted}>Security and app preferences.</Text>
        </View>

        <SettingsSection title="Preferences">
          <SettingsPreferenceRow
            icon={<Fingerprint size={22} color={colors.primary} strokeWidth={2.7} />}
            label="Biometric Login"
            value={biometricLabel}
            hint={biometricAvailable
              ? (Platform.OS === 'web' ? 'Use Touch ID or Face ID to sign in faster.' : 'Use fingerprint or Face ID for faster sign in.')
              : (Platform.OS === 'web' ? 'Tap to register Touch ID / Face ID for this PWA (requires iOS 14+ Safari).' : 'Set up fingerprint or Face ID in phone settings first.')}
            enabled={biometricEnabled}
            disabled={!biometricAvailable && !biometricEnabled && Platform.OS !== 'web'}
            onToggle={() => void onToggleBiometric()}
          />
          <SettingsPreferenceRow
            icon={<Bell size={22} color={colors.primary} strokeWidth={2.7} />}
            label="Notifications"
            value={notificationsEnabled ? 'Enabled' : 'Disabled'}
            hint="Receive approval and account alerts."
            enabled={notificationsEnabled}
            onToggle={() => void onToggleNotifications()}
          />
          <SettingsPreferenceRow
            icon={<Moon size={22} color={colors.primary} strokeWidth={2.7} />}
            label="Theme"
            value="Light"
            hint="Dark mode coming soon."
            enabled={false}
            disabled
          />
        </SettingsSection>

        <SettingsSection title="Update App">
          <View style={styles.settingsUpdateSimpleCard}>
            <View style={styles.settingsBiometricHeader}>
              <View style={styles.settingsSimpleIcon}>
                <Smartphone size={22} color={colors.semantic.success} strokeWidth={2.7} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsRowLabel}>App Version</Text>
                <Text style={styles.settingsRowSub}>v{APP_VERSION} | {updateStatusLabel}</Text>
              </View>
              <View style={[
                styles.settingsUpdatePill,
                appUpdateState.status === 'available' || appUpdateState.status === 'ready'
                  ? styles.settingsUpdatePillActive
                  : null,
              ]}>
                <Text style={[
                  styles.settingsUpdatePillText,
                  appUpdateState.status === 'available' || appUpdateState.status === 'ready'
                    ? styles.settingsUpdatePillTextActive
                    : null,
                ]}>
                  {appUpdateState.status === 'ready' ? 'Ready' : appUpdateState.status === 'available' ? 'New' : 'OK'}
                </Text>
              </View>
            </View>
            <Text style={styles.settingsBiometricHint}>{appUpdateState.message}</Text>
            {shouldShowUpdateActions ? (
              <View style={styles.settingsUpdateActions}>
                <Pressable
                  disabled={isCheckingForUpdate || isDownloadingUpdate}
                  style={[styles.settingsUpdateButton, (isCheckingForUpdate || isDownloadingUpdate) ? styles.disabledButton : null]}
                  onPress={() => void handleCheckForUpdate()}
                >
                  <Text style={styles.settingsUpdateButtonText}>{isCheckingForUpdate ? 'Checking...' : 'Check Now'}</Text>
                </Pressable>
                {canDownloadUpdate ? (
                  <Pressable
                    disabled={isDownloadingUpdate}
                    style={[styles.settingsUpdateButtonPrimary, isDownloadingUpdate ? styles.disabledButton : null]}
                    onPress={() => void handleDownloadUpdate()}
                  >
                    <Text style={styles.settingsUpdateButtonPrimaryText}>{isDownloadingUpdate ? 'Downloading...' : 'Download'}</Text>
                  </Pressable>
                ) : null}
                {canRestartForUpdate ? (
                  <Pressable style={styles.settingsUpdateButtonPrimary} onPress={() => void handleRestartForUpdate()}>
                    <Text style={styles.settingsUpdateButtonPrimaryText}>Restart</Text>
                  </Pressable>
                ) : null}
                {shouldShowApkDownload ? (
                  <Pressable
                    disabled={isCheckingForUpdate || isDownloadingUpdate}
                    style={[styles.settingsUpdateButtonPrimary, (isCheckingForUpdate || isDownloadingUpdate) ? styles.disabledButton : null]}
                    onPress={openApkDownload}
                  >
                    <Text style={styles.settingsUpdateButtonPrimaryText}>Download APK</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.settingsSectionCard}>
      <Text style={styles.settingsSectionTitle}>{title}</Text>
      <View style={styles.settingsSectionBody}>{children}</View>
    </View>
  );
}

function SettingsPreferenceRow({
  icon,
  label,
  value,
  hint,
  enabled,
  disabled,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <View style={[styles.settingsPreferenceRow, disabled ? styles.settingsPreferenceRowDisabled : null]}>
      <View style={styles.settingsSimpleIcon}>{icon}</View>
      <View style={styles.settingsPreferenceText}>
        <Text style={styles.settingsRowLabel}>{label}</Text>
        <Text style={styles.settingsRowSub}>{value}</Text>
        <Text style={styles.settingsPreferenceHint}>{hint}</Text>
      </View>
      <Pressable
        disabled={disabled || !onToggle}
        style={[
          styles.settingsToggle,
          enabled ? styles.settingsToggleOn : styles.settingsToggleOff,
          disabled ? styles.disabledButton : null,
        ]}
        onPress={onToggle}
      >
        <View style={[styles.settingsToggleKnob, enabled ? styles.settingsToggleKnobOn : null]} />
      </Pressable>
    </View>
  );
}

function getAppUpdateStatusLabel(status: AppUpdateState['status']) {
  if (status === 'checking') return 'Checking';
  if (status === 'available') return 'Update available';
  if (status === 'downloading') return 'Downloading';
  if (status === 'ready') return 'Ready to install';
  if (status === 'up_to_date') return 'Up to date';
  if (status === 'unsupported') {
    return Platform.OS === 'web' ? 'Web App' : 'Release build required';
  }
  if (status === 'error') return 'Check failed';
  return 'Automatic';
}

function SettingsActionRow({ label, value }: { label: string; value: string }) {
  return (
    <Pressable style={styles.settingsActionRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingsRowLabel}>{label}</Text>
        <Text style={styles.settingsRowSub}>{value}</Text>
      </View>
      <ChevronRight size={16} color={colors.muted} strokeWidth={2.8} />
    </Pressable>
  );
}

function SettingsInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingsInfoRow}>
      <Text style={styles.settingsInfoLabel}>{label}</Text>
      <Text style={styles.settingsInfoValue}>{value}</Text>
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
  onOpenClusters,
  onSignOut,
}: {
  onOpenAuthority: () => void;
  onOpenDepartments: () => void;
  onOpenRoutes: () => void;
  onOpenApprovers: () => void;
  onOpenClusters: () => void;
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
          <AdminAction icon={<Layers3 size={19} color={colors.primary} strokeWidth={2.5} />} title="Clusters & Stores" detail="Group stores so cluster managers can approve every store in their cluster." accent="blue" onPress={onOpenClusters} />
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
  const [positions, setPositions] = useState<PositionAuthorityLevel[]>([]);
  const [departmentPositions, setDepartmentPositions] = useState<DepartmentPositionCatalogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading approver routes...');
    try {
      const [ladders, positionRows, departmentPositionRows] = await Promise.all([
        loadDepartmentApprovalLadders(),
        loadPositionAuthorityLevels(),
        loadDepartmentPositionCatalog(),
      ]);
      setRows(ladders);
      setPositions(positionRows);
      setDepartmentPositions(departmentPositionRows);
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
    const currentRoles = roleMapFromRow(row);
    const next = current.includes(level)
      ? current.filter((item) => item !== level)
      : [...current, level].sort((a, b) => a - b);
    const nextRoles = { ...currentRoles };

    if (!next.includes(level)) {
      delete nextRoles[level];
    }

    if (!next.length) {
      setStatus(`${row.department_name} needs at least one level.`);
      return;
    }

    setRows((existing) =>
      existing.map((item) =>
        item.department_id === row.department_id
          ? { ...item, route_levels: next, route_roles: routeRolesFromMap(nextRoles) }
          : item,
      ),
    );

    const key = row.department_id;
    setSavingKey(key);
    setStatus(`Saving ${row.department_name} approver route...`);
    try {
      await setDepartmentApprovalLadder(row.department_id, next, nextRoles);
      setRows(await loadDepartmentApprovalLadders());
      setStatus(`${row.department_name}: ${next.map((item) => `L${item}`).join(' -> ')}`);
    } catch (error) {
      setRows((existing) =>
        existing.map((item) =>
          item.department_id === row.department_id
            ? { ...item, route_levels: current, route_roles: row.route_roles }
            : item,
        ),
      );
      setStatus(error instanceof Error ? error.message : 'Unable to save approver route.');
    } finally {
      setSavingKey('');
    }
  }

  async function chooseRouteRole(row: DepartmentApprovalLadderRow, level: number, positionId: string | null) {
    const levels = row.route_levels || [];
    const currentRoles = roleMapFromRow(row);
    const nextRoles = { ...currentRoles };

    if (positionId) {
      nextRoles[level] = positionId;
    } else {
      delete nextRoles[level];
    }

    setRows((existing) =>
      existing.map((item) =>
        item.department_id === row.department_id
          ? { ...item, route_roles: routeRolesFromMap(nextRoles) }
          : item,
      ),
    );

    const selectedRole = positionId ? positions.find((item) => item.position_id === positionId)?.position_name : null;
    setSavingKey(`${row.department_id}-${level}`);
    setStatus(`Saving ${row.department_name} Level ${level} role...`);
    try {
      await setDepartmentApprovalLadder(row.department_id, levels, nextRoles);
      setRows(await loadDepartmentApprovalLadders());
      setStatus(`${row.department_name} L${level}: ${selectedRole || 'any role'}.`);
    } catch (error) {
      setRows((existing) =>
        existing.map((item) =>
          item.department_id === row.department_id
            ? { ...item, route_roles: row.route_roles }
            : item,
        ),
      );
      setStatus(error instanceof Error ? error.message : 'Unable to save route role.');
    } finally {
      setSavingKey('');
    }
  }

  function roleMapFromRow(row: DepartmentApprovalLadderRow): Record<number, string> {
    return Object.fromEntries(
      Object.entries(row.route_roles || {}).map(([level, role]) => [Number(level), role.position_id]),
    );
  }

  function routeRolesFromMap(roles: Record<number, string>): DepartmentApprovalLadderRow['route_roles'] {
    return Object.fromEntries(
      Object.entries(roles).map(([level, positionId]) => {
        const position =
          departmentPositions.find((item) => item.position_id === positionId) ||
          positions.find((item) => item.position_id === positionId);
        return [
          level,
          {
            position_id: positionId,
            position_name: position?.position_name || 'Selected role',
          },
        ];
      }),
    );
  }

  function roleOptionsForDepartmentLevel(departmentId: string, level: number) {
    return departmentPositions
      .filter(
        (item) =>
          item.department_id === departmentId &&
          item.position_id &&
          item.authority_level === level,
      )
      .sort((a, b) => (a.position_name || '').localeCompare(b.position_name || ''));
  }

  function nextRouteRoleId(row: DepartmentApprovalLadderRow, level: number) {
    const options = roleOptionsForDepartmentLevel(row.department_id, level);
    const selectedId = row.route_roles?.[String(level)]?.position_id || null;

    if (!options.length) return null;
    if (!selectedId) return options[0].position_id;

    const currentIndex = options.findIndex((item) => item.position_id === selectedId);
    return currentIndex >= 0 && currentIndex < options.length - 1
      ? options[currentIndex + 1].position_id
      : null;
  }

  function routeApproverLabel(row: DepartmentApprovalLadderRow, level: number) {
    const approvers = row.route_approvers?.[String(level)] || [];
    return approvers.length ? `Approver: ${approvers.join(', ')}` : 'No approver tagged yet';
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
            <Text style={styles.toolSubtitle}>Choose levels and the exact role inside each level.</Text>
          </View>
          <Pressable disabled={isLoading} style={styles.toolRefreshButton} onPress={refresh}>
            <Text style={styles.toolRefreshText}>{isLoading ? '...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {status ? <Text style={styles.adminStatus}>{status}</Text> : null}

        <View style={styles.authorityGuideCard}>
          <Text style={styles.authorityGuideTitle}>How routing works</Text>
          <Text style={styles.authorityGuideText}>Tap a level to include it. For selected levels, tap the role control to cycle from any role to each role in that level.</Text>
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
                    <View style={styles.routePathMeta}>
                      {department.route_roles?.[String(level)]?.position_name ? (
                        <Text style={styles.routePathRoleText} numberOfLines={1}>
                          {department.route_roles[String(level)].position_name}
                        </Text>
                      ) : null}
                      <Text style={styles.routePathApproverText} numberOfLines={1}>
                        {routeApproverLabel(department, level)}
                      </Text>
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

            {(department.route_levels || []).length ? (
              <View style={styles.routeRoleChoices}>
                {(department.route_levels || []).map((level) => {
                  const options = roleOptionsForDepartmentLevel(department.department_id, level);
                  const selectedRole = department.route_roles?.[String(level)]?.position_name;
                  const disabled = Boolean(savingKey) || !options.length;
                  const approverLabel = routeApproverLabel(department, level);

                  return (
                    <Pressable
                      key={`${department.department_id}-${level}-role`}
                      disabled={disabled}
                      style={[styles.routeRoleButton, disabled ? styles.routeLadderChipDisabled : null]}
                      onPress={() => chooseRouteRole(department, level, nextRouteRoleId(department, level))}
                    >
                      <Text style={styles.routeRoleButtonText} numberOfLines={1}>
                        L{level}: {selectedRole || (options.length ? 'Any role' : 'No roles')}
                      </Text>
                      <Text style={styles.routeRoleApproverText} numberOfLines={1}>
                        {approverLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function AdminClustersScreen({ onBack }: { onBack: () => void }) {
  const [clusters, setClusters] = useState<AdminClusterRow[]>([]);
  const [stores, setStores] = useState<AdminStoreClusterRow[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [clusterName, setClusterName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading clusters and stores...');
    try {
      const [clusterRows, storeRows] = await Promise.all([
        loadAdminClusters(),
        loadAdminStoreClusterCatalog(),
      ]);
      setClusters(clusterRows);
      setStores(storeRows);
      setStatus(`${clusterRows.length} cluster(s), ${storeRows.length} store(s) loaded.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load clusters.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const companyNames = Array.from(new Set(stores.map((store) => store.company_name).filter(Boolean))).sort();
  const storesByCompany = stores.reduce<Array<{ companyId: string; companyName: string; stores: AdminStoreClusterRow[] }>>(
    (groups, store) => {
      let group = groups.find((item) => item.companyId === store.company_id);
      if (!group) {
        group = { companyId: store.company_id, companyName: store.company_name, stores: [] };
        groups.push(group);
      }
      group.stores.push(store);
      return groups;
    },
    [],
  );

  async function addCluster() {
    const company = companyName.trim();
    const name = clusterName.trim();
    if (!company || !name) {
      setStatus('Company and cluster name are required.');
      return;
    }

    setSavingKey('cluster');
    setStatus(`Creating ${name}...`);
    try {
      await createAdminCluster(company, name);
      setClusterName('');
      setStatus(`${name} cluster created.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create cluster.');
    } finally {
      setSavingKey('');
    }
  }

  async function assignCluster(store: AdminStoreClusterRow, clusterId: string | null) {
    const cluster = clusterId ? clusters.find((item) => item.cluster_id === clusterId) : null;
    const key = `${store.store_id}-${clusterId ?? 'clear'}`;
    setSavingKey(key);
    setStatus(cluster ? `Assigning ${store.store_name} to ${cluster.cluster_name}...` : `Clearing ${store.store_name} cluster...`);
    try {
      await assignStoreCluster(store.store_id, clusterId);
      setStatus(cluster ? `${store.store_name} is now in ${cluster.cluster_name}.` : `${store.store_name} cluster cleared.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to assign store cluster.');
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
          <Text style={styles.toolTopTitle}>Clusters</Text>
        </View>

        <View style={styles.toolHeaderCard}>
          <View style={styles.toolHeaderIcon}>
            <Layers3 size={22} color={colors.brand.ink} strokeWidth={2.6} />
          </View>
          <View style={styles.toolHeaderText}>
            <Text style={styles.toolEyebrow}>Store Scope</Text>
            <Text style={styles.toolTitle}>Clusters & Stores</Text>
            <Text style={styles.toolSubtitle}>Group stores so one cluster manager can approve requests across many stores.</Text>
          </View>
          <Pressable disabled={isLoading} style={styles.toolRefreshButton} onPress={refresh}>
            <Text style={styles.toolRefreshText}>{isLoading ? '...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {status ? <Text style={styles.adminStatus}>{status}</Text> : null}

        <View style={styles.catalogCreateCard}>
          <Text style={styles.catalogCreateLabel}>New cluster</Text>
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            placeholder={companyNames[0] || 'Company name'}
            placeholderTextColor={colors.muted}
            style={styles.catalogInput}
          />
          <TextInput
            value={clusterName}
            onChangeText={setClusterName}
            placeholder="Cluster North, Cluster A"
            placeholderTextColor={colors.muted}
            style={styles.catalogInput}
          />
          <Pressable disabled={Boolean(savingKey)} style={styles.catalogCreateButton} onPress={addCluster}>
            <Text style={styles.catalogCreateButtonText}>Add Cluster</Text>
          </Pressable>
        </View>

        {clusters.map((cluster) => (
          <View key={cluster.cluster_id} style={styles.departmentCard}>
            <View style={styles.departmentHeader}>
              <View>
                <Text style={styles.departmentTitle}>{cluster.cluster_name}</Text>
                <Text style={styles.departmentMeta}>{cluster.company_name} | {cluster.store_count} store(s)</Text>
              </View>
            </View>

          </View>
        ))}

        {storesByCompany.map((company) => {
          const companyClusters = clusters.filter((cluster) => cluster.company_id === company.companyId);
          return (
            <View key={company.companyId} style={styles.approverGroupCard}>
              <View style={styles.departmentHeader}>
                <View>
                  <Text style={styles.departmentTitle}>{company.companyName}</Text>
                  <Text style={styles.departmentMeta}>{company.stores.length} store(s)</Text>
                </View>
              </View>

              <View style={styles.departmentPositionList}>
                {company.stores.map((store) => (
                  <View key={store.store_id} style={styles.approverRow}>
                    <View style={styles.departmentPositionText}>
                      <Text style={styles.departmentPositionName} numberOfLines={1}>{store.store_name}</Text>
                      <Text style={styles.departmentPositionMeta}>
                        {store.cluster_name ? `Cluster: ${store.cluster_name}` : 'No cluster assigned'}
                      </Text>
                    </View>
                    <View style={styles.clusterAssignActions}>
                      {store.cluster_id ? (
                        <Pressable
                          disabled={Boolean(savingKey)}
                          style={styles.removePositionButton}
                          onPress={() => assignCluster(store, null)}
                        >
                          <X size={14} color={colors.surface} strokeWidth={2.8} />
                        </Pressable>
                      ) : null}
                      {companyClusters.map((cluster) => {
                        const active = store.cluster_id === cluster.cluster_id;
                        const key = `${store.store_id}-${cluster.cluster_id}`;
                        return (
                          <Pressable
                            key={cluster.cluster_id}
                            disabled={Boolean(savingKey) || active}
                            style={[styles.approverSetButton, active ? styles.approverSetButtonActive : null]}
                            onPress={() => assignCluster(store, cluster.cluster_id)}
                          >
                            <Text style={[styles.approverSetButtonText, active ? styles.approverSetButtonTextActive : null]}>
                              {savingKey === key ? '...' : active ? 'Set' : cluster.cluster_name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
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
                      <Text style={styles.departmentPositionMeta}>
                        {item.company_name} | {item.position_name} | L{item.position_level || '-'}
                      </Text>
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
  routePathMeta: {
    maxWidth: 126,
    marginLeft: 4,
  },
  routePathRoleText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '800',
  },
  routePathApproverText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
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
  routeRoleChoices: {
    gap: 6,
    marginTop: spacing.sm,
  },
  routeRoleButton: {
    minHeight: 34,
    borderRadius: 8,
    borderColor: '#fde68a',
    borderWidth: 1,
    backgroundColor: '#fffbeb',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  routeRoleButtonText: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '900',
  },
  routeRoleApproverText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
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
  clusterAssignActions: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.xs,
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
  settingsRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  settingsScroll: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  myTeamScroll: {
    paddingBottom: 180,
  },
  settingsTabScroll: {
    padding: spacing.md,
    paddingBottom: 180,
    flexGrow: 1,
  },
  settingsHeroCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  myTeamHeroInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  myTeamStoreInlinePill: {
    flexShrink: 1,
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  myTeamStoreInlineText: {
    color: '#3730a3',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  myTeamSegment: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  myTeamSegmentButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  myTeamSegmentButtonActive: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.goldStrong,
  },
  myTeamSegmentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  myTeamSegmentTextActive: {
    color: colors.brand.ink,
  },
  myTeamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  myTeamSectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  myTeamSectionSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  myTeamRefreshButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  myTeamRefreshText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '900',
  },
  myTeamStatus: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  myTeamEmployeeCard: {
    minHeight: 88,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  myTeamEmployeeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#eef4ff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  myTeamEmployeePhoto: {
    width: '100%',
    height: '100%',
  },
  myTeamEmployeeAvatarText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  myTeamEmployeeText: {
    flex: 1,
    minWidth: 0,
  },
  myTeamEmployeeName: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  myTeamEmployeeMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 1,
  },
  myTeamScheduleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 7,
  },
  myTeamSchedulePill: {
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    minHeight: 24,
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  myTeamSchedulePillText: {
    color: '#475569',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  myTeamStatusPill: {
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  myTeamStatusPillText: {
    color: '#15803d',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scheduleCalendarCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  scheduleCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  scheduleMonthSelect: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    flexShrink: 1,
  },
  scheduleCalendarMonth: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  scheduleCalendarBadge: {
    borderRadius: 999,
    backgroundColor: '#fef3c7',
    color: '#92400e',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  scheduleMonthMenu: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 8,
    marginBottom: spacing.sm,
  },
  scheduleMonthModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  scheduleMonthModalDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  scheduleMonthModalSheet: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  scheduleMonthModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  scheduleMonthModalTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },
  scheduleMonthModalSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  scheduleMonthModalClose: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleMonthOption: {
    width: '30.8%',
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleMonthOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  scheduleMonthOptionText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  scheduleMonthOptionTextActive: {
    color: colors.surface,
  },
  scheduleAddButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    borderWidth: 1,
    borderColor: colors.brand.goldStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: '#e2e8f0',
  },
  scheduleWeekdayRow: {
    flexDirection: 'row',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: spacing.sm,
  },
  scheduleWeekdayText: {
    width: '14.2857%',
    minHeight: 28,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingVertical: 6,
  },
  scheduleWeekdayWeekendText: {
    color: '#64748b',
    backgroundColor: '#f1f5f9',
  },
  scheduleDayCell: {
    width: '14.2857%',
    minHeight: 52,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDayCellBlank: {
    backgroundColor: '#f8fafc',
  },
  scheduleDayCellWeekend: {
    backgroundColor: '#eff6ff',
  },
  scheduleDayCellRest: {
    backgroundColor: '#fef2f2',
  },
  scheduleDayCellSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: '#eff6ff',
  },
  scheduleDayDate: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  scheduleDayDateRest: {
    color: '#64748b',
  },
  scheduleDayDateHoliday: {
    color: '#6d28d9',
  },
  scheduleDayDateStrong: {
    color: colors.brand.ink,
  },
  scheduleDatePill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDatePillRest: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  scheduleDatePillHoliday: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  scheduleDatePillAssigned: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.goldStrong,
  },
  scheduleDatePillSelected: {
    backgroundColor: '#bfdbfe',
    borderColor: colors.primary,
    borderWidth: 2,
  },
  scheduleHolidayDot: {
    position: 'absolute',
    bottom: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#8b5cf6',
  },
  scheduleLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  scheduleLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  scheduleLegendDotHoliday: {
    backgroundColor: '#8b5cf6',
  },
  scheduleLegendDotWeekend: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  scheduleLegendDotAssigned: {
    backgroundColor: colors.brand.gold,
  },
  scheduleLegendText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  selectedSchedulePanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  selectedScheduleTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  selectedHolidayRow: {
    borderRadius: 8,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  selectedHolidayText: {
    color: '#6d28d9',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  selectedScheduleRow: {
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
  },
  selectedScheduleTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  selectedScheduleName: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  selectedScheduleMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    marginTop: 3,
  },
  schedulePaginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  schedulePaginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
  },
  schedulePaginationDotActive: {
    width: 16,
    backgroundColor: colors.primary,
  },
  scheduleTableCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  scheduleTableContainer: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  scheduleExportButton: {
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    borderWidth: 1,
    borderColor: colors.brand.goldStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  scheduleExportButtonDisabled: {
    opacity: 0.5,
  },
  scheduleExportButtonText: {
    color: colors.brand.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scheduleTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    alignItems: 'stretch',
  },
  scheduleTableHeaderCell: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  scheduleTableNameColumn: {
    width: '38%',
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  scheduleTableDateColumn: {
    width: '24%',
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  scheduleTableShiftColumn: {
    width: '38%',
  },
  scheduleTableHeaderText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scheduleTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    minHeight: 42,
  },
  scheduleTableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  scheduleTableSpacerRow: {
    minHeight: 32,
    backgroundColor: colors.surface,
  },
  scheduleTableCell: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  scheduleTableCellText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  scheduleTableCellStrong: {
    fontWeight: '900',
  },
  scheduleTableCellTime: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  scheduleTableDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleTableEmpty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleTableEmptyText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  selectedScheduleDelete: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedScheduleEmpty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  scheduleComposerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  scheduleComposerDismiss: {
    flex: 1,
  },
  scheduleComposerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  scheduleComposerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  scheduleComposerTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
  },
  scheduleComposerSub: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  scheduleComposerClose: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleComposerLabel: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    marginBottom: 7,
  },
  scheduleEmployeeSelector: {
    gap: 8,
    paddingBottom: spacing.md,
  },
  scheduleEmployeeChip: {
    minHeight: 38,
    maxWidth: 190,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  scheduleEmployeeChipActive: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.goldStrong,
  },
  scheduleEmployeeChipText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  scheduleEmployeeChipTextActive: {
    color: colors.brand.ink,
    fontWeight: '900',
  },
  scheduleDropdownField: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
  },
  scheduleDropdownText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  scheduleDropdownPlaceholder: {
    color: '#94a3b8',
  },
  scheduleDropdownMenu: {
    maxHeight: 180,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  scheduleDropdownOption: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  scheduleDropdownOptionActive: {
    backgroundColor: '#fffbeb',
  },
  scheduleDropdownOptionText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  scheduleDropdownOptionTextActive: {
    color: '#92400e',
    fontWeight: '900',
  },
  scheduleDropdownCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDropdownCheckboxActive: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.goldStrong,
  },
  scheduleDropdownCheckboxText: {
    color: colors.brand.ink,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '900',
  },
  scheduleDropdownEmpty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    padding: 12,
  },
  scheduleTimeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scheduleTimeField: {
    flex: 1,
  },
  scheduleTimePickerButton: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginBottom: spacing.md,
  },
  scheduleTimePickerText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  digitalTimePickerPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  digitalTimePickerControls: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  digitalTimePickerColumn: {
    flex: 1,
  },
  digitalTimePickerLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  digitalTimePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  slideTimePickerFrame: {
    height: 132,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: colors.surface,
  },
  slideTimePickerContent: {
    paddingVertical: 5,
  },
  slideTimeOption: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 5,
    marginVertical: 2,
    borderRadius: 8,
  },
  slideTimeOptionActive: {
    backgroundColor: colors.primary,
  },
  slideTimeOptionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  slideTimeOptionTextActive: {
    color: colors.surface,
  },
  digitalTimeOption: {
    minWidth: 38,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  digitalTimeOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  digitalTimeOptionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  digitalTimeOptionTextActive: {
    color: colors.surface,
  },
  digitalPeriodRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
  },
  digitalPeriodOption: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitalTimePickerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  digitalTimeCancel: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitalTimeCancelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  digitalTimeApply: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitalTimeApplyText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '900',
  },
  scheduleComposerInput: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 12,
    marginBottom: spacing.md,
  },
  scheduleComposerNotes: {
    minHeight: 82,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  scheduleComposerError: {
    color: colors.semantic.danger,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  scheduleDayOffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 16,
    paddingVertical: 4,
  },
  scheduleDayOffCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDayOffCheckboxActive: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.goldStrong,
  },
  scheduleDayOffLabel: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  scheduleDayOffNotice: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  scheduleDayOffNoticeText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  selectedScheduleDayOffBadge: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#ffedd5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  selectedScheduleDayOffBadgeText: {
    color: '#c2410c',
    fontSize: 10,
    fontWeight: '900',
  },
  scheduleComposerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scheduleComposerCancel: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleComposerCancelText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  scheduleComposerSubmit: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleComposerSubmitText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '900',
  },
  settingsHeroRow: {
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  settingsHeroLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settingsHeroValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  settingsSectionCard: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  settingsSectionBody: {
    marginTop: spacing.xs,
  },
  rewardsBarcodeCard: {
    borderRadius: 8,
    backgroundColor: colors.brand.ink,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#102a4c',
  },
  rewardsBarcodeHint: {
    color: colors.surface,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  rewardsBarcodeSub: {
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  rewardsBarcodeFrame: {
    width: '100%',
    minHeight: 104,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rewardsBarcodeText: {
    color: '#020617',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  barcodeBars: {
    width: '100%',
    height: 62,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  barcodeBar: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  barcodeBarFilled: {
    backgroundColor: '#020617',
  },
  rewardsBalanceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rewardsPointsCard: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  rewardsPointsHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  rewardsPointsHeaderLeft: {
    flex: 1,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  rewardsCoinIcon: {
    width: 48,
    height: 48,
  },
  rewardsPointsTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  rewardsPointsTitle: {
    color: colors.brand.ink,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  rewardsPointsBody: {
    minHeight: 166,
    justifyContent: 'space-between',
    padding: spacing.sm,
    position: 'relative',
  },
  rewardsConversion: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    marginTop: 1,
  },
  rewardsPointsWatermark: {
    position: 'absolute',
    right: -18,
    top: 34,
    width: 112,
    height: 112,
    opacity: 0.14,
  },
  rewardsPointsLabel: {
    color: colors.brand.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  rewardsPointsValue: {
    color: colors.brand.ink,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    marginTop: 2,
  },
  rewardsPointsUnit: {
    color: colors.brand.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  rewardsPointsAction: {
    borderRadius: 999,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    zIndex: 2,
  },
  rewardsPointsActionPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  rewardsPointsActionText: {
    color: colors.surface,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  rewardsWalletCard: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.brand.ink,
    borderWidth: 1,
    borderColor: '#102a4c',
  },
  rewardsWalletHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f233d',
    borderBottomWidth: 1,
    borderBottomColor: '#102a4c',
  },
  rewardsWalletHeaderLeft: {
    flex: 1,
    minWidth: 0,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  rewardsWalletCoin: {
    width: 48,
    height: 48,
  },
  rewardsWalletTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.surface,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
  },
  rewardsWalletBody: {
    minHeight: 166,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  rewardsWalletStats: {
    gap: spacing.xs,
  },
  rewardsWalletStatItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    paddingBottom: spacing.xs,
  },
  rewardsWalletLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  rewardsWalletValue: {
    color: colors.surface,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    marginTop: 2,
  },
  rewardsWalletStatus: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
  },
  rewardsWalletHistoryButton: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.brand.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
  },
  rewardsWalletHistoryButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  rewardsWalletHistoryButtonText: {
    color: colors.brand.gold,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  rewardsHistoryHeader: {
    borderRadius: 8,
    backgroundColor: colors.brand.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rewardsHistoryIcon: {
    width: 50,
    height: 50,
  },
  rewardsHistoryTitle: {
    color: colors.surface,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  rewardsHistorySub: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  rewardsHistoryRow: {
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rewardsHistorySign: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardsHistorySignAdd: {
    backgroundColor: '#dcfce7',
  },
  rewardsHistorySignMinus: {
    backgroundColor: '#fee2e2',
  },
  rewardsHistorySignText: {
    color: colors.brand.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
  },
  rewardsHistoryText: {
    flex: 1,
    minWidth: 0,
  },
  rewardsHistorySource: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  rewardsHistoryDate: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  rewardsHistoryAmount: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  rewardsHistoryAmountAdd: {
    color: '#16a34a',
  },
  rewardsHistoryAmountMinus: {
    color: '#dc2626',
  },
  rewardsServiceGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rewardsServiceTile: {
    flex: 1,
    minHeight: 124,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    padding: spacing.sm,
  },
  rewardsServiceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  rewardsServiceCoin: {
    width: 28,
    height: 28,
  },
  rewardsServiceTitle: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  rewardsServiceText: {
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  rewardsPromoStrip: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: colors.brand.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  rewardsPromoCoins: {
    width: 44,
    height: 44,
  },
  rewardsPromoTitle: {
    color: colors.brand.gold,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  rewardsPromoText: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 2,
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
  settingsSectionTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  settingsActionRow: {
    minHeight: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  settingsRowLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  settingsRowSub: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  settingsBiometricCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  settingsPreferenceRow: {
    minHeight: 88,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  settingsPreferenceRowDisabled: {
    opacity: 0.76,
  },
  settingsSimpleIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsPreferenceText: {
    flex: 1,
    minWidth: 0,
  },
  settingsPreferenceHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  settingsUpdateSimpleCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  settingsBiometricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  settingsBiometricHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  settingsUpdatePill: {
    minWidth: 52,
    minHeight: 28,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  settingsUpdatePillActive: {
    backgroundColor: '#fef3c7',
  },
  settingsUpdatePillText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settingsUpdatePillTextActive: {
    color: '#92400e',
  },
  settingsUpdateMeta: {
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 2,
  },
  settingsUpdateMetaText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  settingsUpdateActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  settingsUpdateButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  settingsUpdateButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settingsUpdateButtonPrimary: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  settingsUpdateButtonPrimaryText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settingsToggle: {
    width: 52,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 3,
    justifyContent: 'center',
  },
  settingsToggleOn: {
    backgroundColor: '#1d4ed8',
  },
  settingsToggleOff: {
    backgroundColor: '#cbd5e1',
  },
  settingsToggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
  },
  settingsToggleKnobOn: {
    alignSelf: 'flex-end',
  },
  settingsInfoRow: {
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  settingsInfoLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settingsInfoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  settingsSignOutWrap: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
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
  adminCard: {
    borderRadius: 8,
    padding: spacing.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    marginBottom: spacing.md,
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
