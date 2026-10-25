import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Search,
  ShieldAlert,
  User,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { UniversalDateTimePicker } from '../components/UniversalDateTimePicker';
import { ScrollableTimePickerModal } from '../components/ScrollableTimePickerModal';
import type { AppToastMessage } from '../components/AppToast';
import { colors, fontWeights, radius, spacing } from '../theme';
import { getSafeBottomInset, getScreenBottomPadding } from '../utils/safeArea';
import { supabase } from '../lib/supabase';
import { loadEmployeeProfile } from '../services/profile';
import { loadEmployeeStoreOptions, type EmployeeStoreOption } from '../services/createProfile';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';
import { dateStringToDate, formatDateInput } from '../utils/dateTime';
import { submitLocalTravelOrder } from '../services/requests';

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

const GOLDILOCKS_COMPANIES = [
  'cake haven incorporation',
  'cakes and occasions corp.',
  'chawnah foods inc.',
  'fresh berry foods corp.',
];

const TRANSPORT_MODES = [
  'Company Vehicle',
  'Personal Vehicle (Approved Fuel Matrix)',
  'Public Utility Transport (Bus/Van)',
] as const;

const TRAVEL_PURPOSES = [
  'Routine Store Audit',
  'Emergency Equipment/Cold Chain Repair',
  'Inter-branch Supply/Stock Transfer',
  'Others',
] as const;

function formatDateDisplay(ymd: string): string {
  if (!ymd) return '';
  const parts = ymd.split('-');
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }
  return ymd;
}

function formatTimeDisplay(timeStr: string): string {
  if (!timeStr) return '';
  const clean = timeStr.trim();
  const ampmMatch = clean.toUpperCase().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/);
  if (ampmMatch) {
    return `${ampmMatch[1].padStart(2, '0')}:${ampmMatch[2]} ${ampmMatch[3]}`;
  }
  const parts = clean.split(':').map(Number);
  const rawHour = parts[0];
  const rawMinute = parts[1];
  if (Number.isNaN(rawHour) || Number.isNaN(rawMinute)) return timeStr;
  const period = rawHour >= 12 ? 'PM' : 'AM';
  const hour = rawHour % 12 || 12;
  const minStr = String(rawMinute).padStart(2, '0');
  const hourStr = String(hour).padStart(2, '0');
  return `${hourStr}:${minStr} ${period}`;
}

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
  onSubmitted,
}: FileOfficialTravelOrderScreenProps) {
  const insets = useSafeAreaInsets();
  const safeModalBottomPadding = useMemo(() => {
    return Platform.OS === 'android'
      ? Math.max(insets.bottom, 24) + 16
      : Math.max(insets.bottom, 16) + 12;
  }, [insets.bottom]);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<EmployeeProfileSummary | null>(
    profileResult?.status === 'linked' ? profileResult.profile : null
  );

  // Store options data
  const [allStores, setAllStores] = useState<EmployeeStoreOption[]>([]);
  const [goldilocksStores, setGoldilocksStores] = useState<EmployeeStoreOption[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);

  // Section 1: Travel Itinerary & Specific Work Intent form state
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [departureDate, setDepartureDate] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>('');
  const [departureTime, setDepartureTime] = useState<string>('');
  const [returnTime, setReturnTime] = useState<string>('');
  const [transportMode, setTransportMode] = useState<string>('');
  const [plateNo, setPlateNo] = useState<string>('');
  const [purposeOfTravel, setPurposeOfTravel] = useState<string>('');
  const [otherPurposeDetails, setOtherPurposeDetails] = useState<string>('');

  // Section 2: Financial Authorization & Per Diem Allowances form state
  const [transportBudget, setTransportBudget] = useState<string>('');
  const [mealBudget, setMealBudget] = useState<string>('');
  const [emergencyBudget, setEmergencyBudget] = useState<string>('');
  const [costCenterCode, setCostCenterCode] = useState<string>('');
  const [chargeToStore, setChargeToStore] = useState<string>('');

  // Modals state
  const [destinationModalVisible, setDestinationModalVisible] = useState(false);
  const [transportModalVisible, setTransportModalVisible] = useState(false);
  const [purposeModalVisible, setPurposeModalVisible] = useState(false);
  const [chargeStoreModalVisible, setChargeStoreModalVisible] = useState(false);
  const [activeDatePicker, setActiveDatePicker] = useState<'departure' | 'return' | null>(null);
  const [activeTimePicker, setActiveTimePicker] = useState<'departure' | 'return' | null>(null);
  const [destinationSearch, setDestinationSearch] = useState('');
  const [chargeStoreSearch, setChargeStoreSearch] = useState('');
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  // Validation & Submission
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Keyboard avoidance & scroll management
  const scrollRef = useRef<ScrollView | null>(null);
  const focusedFieldRef = useRef<string | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardLayouts = useRef<Record<string, number>>({});
  const inputLayouts = useRef<Record<string, number>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollToField = (fieldKey: string) => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = setTimeout(() => {
      if (!scrollRef.current) return;
      if (fieldKey === 'costCenter') {
        scrollRef.current.scrollToEnd({ animated: true });
        return;
      }
      const cardY =
        fieldKey === 'plateNo' || fieldKey === 'otherPurpose'
          ? cardLayouts.current.section1 || 0
          : cardLayouts.current.section2 || 0;
      const inputY = inputLayouts.current[fieldKey] || 0;
      const totalY = cardY + inputY;

      if (totalY > 0) {
        scrollRef.current.scrollTo({
          y: Math.max(0, totalY - 40),
          animated: true,
        });
      } else {
        scrollRef.current.scrollToEnd({ animated: true });
      }
    }, Platform.OS === 'android' ? 140 : 60);
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        const height = event.endCoordinates?.height ?? 0;
        setKeyboardHeight(height);
        if (focusedFieldRef.current) {
          scrollToField(focusedFieldRef.current);
        }
      }
    );

    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );

    return () => {
      showSub.remove();
      hideSub.remove();
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  // Load employee profile if not provided
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

  // Load stores from database across all 4 companies
  useEffect(() => {
    let isMounted = true;
    async function fetchStores() {
      setLoadingStores(true);
      try {
        const stores = await loadEmployeeStoreOptions();
        if (!isMounted) return;
        setAllStores(stores);

        // Filter Goldilocks stores across the 4 companies
        const filtered = stores.filter((s) => {
          const sName = (s.store_name || '').toLowerCase();
          const cName = (s.company_name || '').toLowerCase();
          const isGoldilocksCompany = GOLDILOCKS_COMPANIES.some((comp) => cName.includes(comp));
          return (
            sName.includes('goldilocks') ||
            (isGoldilocksCompany &&
              !sName.includes('chatime') &&
              !sName.includes('icebergs') &&
              !sName.includes('taters'))
          );
        });

        // Sort alphabetically
        filtered.sort((a, b) => a.store_name.localeCompare(b.store_name));
        setGoldilocksStores(filtered);
      } catch (err) {
        console.warn('[FileOfficialTravelOrderScreen] Failed to load store options:', err);
      } finally {
        if (isMounted) setLoadingStores(false);
      }
    }
    fetchStores();
    return () => {
      isMounted = false;
    };
  }, []);

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
      } catch (_) { }
      try {
        const stores = await loadEmployeeStoreOptions();
        setAllStores(stores);
        const filtered = stores.filter((s) => {
          const sName = (s.store_name || '').toLowerCase();
          const cName = (s.company_name || '').toLowerCase();
          const isGoldilocksCompany = GOLDILOCKS_COMPANIES.some((comp) => cName.includes(comp));
          return (
            sName.includes('goldilocks') ||
            (isGoldilocksCompany &&
              !sName.includes('chatime') &&
              !sName.includes('icebergs') &&
              !sName.includes('taters'))
          );
        });
        filtered.sort((a, b) => a.store_name.localeCompare(b.store_name));
        setGoldilocksStores(filtered);
      } catch (_) { }
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

  // Multi-select store toggling
  const toggleDestinationStore = (storeNameStr: string) => {
    setSelectedStores((prev) => {
      if (prev.includes(storeNameStr)) {
        return prev.filter((s) => s !== storeNameStr);
      } else {
        return [...prev, storeNameStr];
      }
    });
    setValidationErrors((prev) => ({ ...prev, destinationStore: '' }));
  };

  // Filtered stores for destination modal search
  const filteredGoldilocksStores = useMemo(() => {
    if (!destinationSearch.trim()) return goldilocksStores;
    const query = destinationSearch.toLowerCase();
    return goldilocksStores.filter(
      (s) =>
        s.store_name.toLowerCase().includes(query) ||
        s.company_name.toLowerCase().includes(query)
    );
  }, [goldilocksStores, destinationSearch]);

  // Filtered Goldilocks stores for "Charge to Store/Branch" (across 4 companies only)
  const filteredChargeStores = useMemo(() => {
    if (!chargeStoreSearch.trim()) return goldilocksStores;
    const query = chargeStoreSearch.toLowerCase();
    return goldilocksStores.filter(
      (s) =>
        s.store_name.toLowerCase().includes(query) ||
        s.company_name.toLowerCase().includes(query)
    );
  }, [goldilocksStores, chargeStoreSearch]);

  // Specific Mode of Transport display label
  const transportDisplayLabel = useMemo(() => {
    if (!transportMode) return 'Select mode of transport';
    if (transportMode.startsWith('Company Vehicle') && plateNo.trim()) {
      return `Company Vehicle (${plateNo.trim()})`;
    }
    return transportMode;
  }, [transportMode, plateNo]);

  // Handle Form Validation
  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (selectedStores.length === 0) {
      errors.destinationStore = 'Select at least 1 destination store.';
    }
    if (!departureDate) {
      errors.departureDate = 'Required';
    }
    if (!returnDate) {
      errors.returnDate = 'Required';
    }
    if (departureDate && returnDate && returnDate < departureDate) {
      errors.returnDate = 'Must be on or after departure';
    }
    if (!departureTime) {
      errors.departureTime = 'Required';
    }
    if (!returnTime) {
      errors.returnTime = 'Required';
    }
    if (
      departureDate &&
      returnDate &&
      departureDate === returnDate &&
      departureTime &&
      returnTime &&
      returnTime <= departureTime
    ) {
      errors.returnTime = 'Must be after departure';
    }
    if (!transportMode) {
      errors.transportMode = 'Select mode of transport.';
    } else if (transportMode.startsWith('Company Vehicle') && !plateNo.trim()) {
      errors.plateNo = 'Plate number is required for company vehicle.';
    }
    if (!purposeOfTravel) {
      errors.purposeOfTravel = 'Select purpose of travel.';
    } else if (purposeOfTravel.startsWith('Others') && !otherPurposeDetails.trim()) {
      errors.otherPurposeDetails = 'Please specify detailed operational tasks.';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Handler
  const handleSubmit = async () => {
    if (!validateForm()) {
      onToast?.({
        tone: 'error',
        title: 'Incomplete Details',
        message: 'Please complete all required fields correctly before submitting.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Simulate/prepare payload
      const payload = {
        employeeName: resolvedEmployeeName,
        employeeId: resolvedEmployeeId,
        destinationStores: selectedStores,
        departureDate,
        returnDate,
        departureTime,
        returnTime,
        transportMode,
        plateNo: transportMode.startsWith('Company Vehicle') ? plateNo.trim() : null,
        purposeOfTravel,
        purposeDetails: purposeOfTravel.startsWith('Others') ? otherPurposeDetails.trim() : null,
        transportBudget: transportBudget ? parseFloat(transportBudget) : 0,
        mealBudget: mealBudget ? parseFloat(mealBudget) : 0,
        emergencyBudget: emergencyBudget ? parseFloat(emergencyBudget) : 0,
        costCenterCode: costCenterCode.trim() || null,
        chargeToStore: chargeToStore || null,
        submittedAt: new Date().toISOString(),
      };

      console.log('[FileOfficialTravelOrderScreen] Submitting Travel Order:', payload);
      await submitLocalTravelOrder(payload);

      // Brief delay for user feedback
      await new Promise((resolve) => setTimeout(resolve, 600));

      onToast?.({
        tone: 'success',
        title: 'Request Submitted',
        message: 'Official Travel Order submitted successfully! Pending endorsement.',
      });

      await onSubmitted?.();
      onBack();
    } catch (err: any) {
      console.error('[FileOfficialTravelOrderScreen] Submission failed:', err);
      Alert.alert(
        'Submission Failed',
        err?.message || 'Unable to submit travel order request. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onBack();
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <StatusBar style="dark" />
      <TopBar
        name={name}
        username={username}
        photoUrl={photoUrl}
        notificationCount={notificationCount}
        onBackHome={onBack}
        backTitle="Official Travel Order"
        backAccessory="info"
        onBackAccessory={() => setShowPolicyModal(true)}
        onMessages={onAssistant}
        onNotifications={onNotifications}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom:
                Platform.OS === 'android'
                  ? (keyboardHeight > 0
                    ? keyboardHeight + 16
                    : Math.max(getScreenBottomPadding(insets.bottom, false, 32), insets.bottom + 32))
                  : (keyboardHeight > 0
                    ? 20
                    : Math.max(getScreenBottomPadding(insets.bottom, false, 32), insets.bottom + 32)),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
              <Text style={styles.cardTitle}>Employee Profile & Logistics Class</Text>
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

          {/* SECTION 1: Travel Itinerary & Specific Work Intent */}
          <View
            style={styles.card}
            onLayout={(e) => {
              cardLayouts.current.section1 = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIconBadgeYellow}>
                <Compass size={17} color="#0f172a" strokeWidth={2.4} />
              </View>
              <Text style={styles.cardTitle}>Travel Itinerary & Specific Work Intent</Text>
            </View>

            {/* Row 1: Destination Store & Departure Date */}
            <View style={styles.underlineRow}>
              {/* Destination Store */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.destinationStore ? styles.inputError : null,
                  ]}
                  onPress={() => setDestinationModalVisible(true)}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      selectedStores.length === 0 ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {selectedStores.length === 0
                      ? 'Select Store'
                      : selectedStores.length === 1
                        ? selectedStores[0]
                        : `${selectedStores[0]} (+${selectedStores.length - 1} more)`}
                  </Text>
                  <ChevronDown size={16} color="#0f172a" strokeWidth={2.4} />
                </Pressable>
                <Text style={styles.underlineLabel}>Destination Store</Text>
                {validationErrors.destinationStore ? (
                  <Text style={styles.fieldError}>{validationErrors.destinationStore}</Text>
                ) : null}
              </View>

              {/* Departure Date */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.departureDate ? styles.inputError : null,
                  ]}
                  onPress={() => setActiveDatePicker('departure')}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      !departureDate ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {departureDate ? formatDateDisplay(departureDate) : 'mm/dd/yyyy'}
                  </Text>
                  <CalendarDays size={16} color="#64748b" strokeWidth={2.2} />
                </Pressable>
                <Text style={styles.underlineLabel}>Departure Date</Text>
                {validationErrors.departureDate ? (
                  <Text style={styles.fieldError}>{validationErrors.departureDate}</Text>
                ) : null}
              </View>
            </View>

            {/* Row 2: Departure Time, Return Date, Return Time */}
            <View style={styles.underlineRow}>
              {/* Departure Time */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.departureTime ? styles.inputError : null,
                  ]}
                  onPress={() => setActiveTimePicker('departure')}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      !departureTime ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {departureTime ? formatTimeDisplay(departureTime) : '--:-- --'}
                  </Text>
                  <Clock3 size={16} color="#64748b" strokeWidth={2.2} />
                </Pressable>
                <Text style={styles.underlineLabel}>Departure Time</Text>
                {validationErrors.departureTime ? (
                  <Text style={styles.fieldError}>{validationErrors.departureTime}</Text>
                ) : null}
              </View>

              {/* Return Date */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.returnDate ? styles.inputError : null,
                  ]}
                  onPress={() => setActiveDatePicker('return')}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      !returnDate ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {returnDate ? formatDateDisplay(returnDate) : 'mm/dd/yyyy'}
                  </Text>
                  <CalendarDays size={16} color="#64748b" strokeWidth={2.2} />
                </Pressable>
                <Text style={styles.underlineLabel}>Return Date</Text>
                {validationErrors.returnDate ? (
                  <Text style={styles.fieldError}>{validationErrors.returnDate}</Text>
                ) : null}
              </View>

              {/* Return Time */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.returnTime ? styles.inputError : null,
                  ]}
                  onPress={() => setActiveTimePicker('return')}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      !returnTime ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {returnTime ? formatTimeDisplay(returnTime) : '--:-- --'}
                  </Text>
                  <Clock3 size={16} color="#64748b" strokeWidth={2.2} />
                </Pressable>
                <Text style={styles.underlineLabel}>Return Time</Text>
                {validationErrors.returnTime ? (
                  <Text style={styles.fieldError}>{validationErrors.returnTime}</Text>
                ) : null}
              </View>
            </View>

            {/* Row 3: Specific Mode of Transport & Purpose of Travel */}
            <View style={styles.underlineRow}>
              {/* Specific Mode of Transport */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.transportMode ? styles.inputError : null,
                  ]}
                  onPress={() => setTransportModalVisible(true)}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      !transportMode ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {transportDisplayLabel}
                  </Text>
                  <ChevronDown size={16} color="#0f172a" strokeWidth={2.4} />
                </Pressable>
                <Text style={styles.underlineLabel}>Specific Mode of Transport</Text>
                {validationErrors.transportMode ? (
                  <Text style={styles.fieldError}>{validationErrors.transportMode}</Text>
                ) : null}
              </View>

              {/* Purpose of Travel */}
              <View style={styles.underlineField}>
                <Pressable
                  style={[
                    styles.underlineBox,
                    validationErrors.purposeOfTravel ? styles.inputError : null,
                  ]}
                  onPress={() => setPurposeModalVisible(true)}
                >
                  <Text
                    style={[
                      styles.underlineText,
                      !purposeOfTravel ? styles.underlineTextPlaceholder : null,
                    ]}
                    numberOfLines={1}
                  >
                    {purposeOfTravel || 'Select purpose of travel'}
                  </Text>
                  <ChevronDown size={16} color="#0f172a" strokeWidth={2.4} />
                </Pressable>
                <Text style={styles.underlineLabel}>Purpose of Travel</Text>
                {validationErrors.purposeOfTravel ? (
                  <Text style={styles.fieldError}>{validationErrors.purposeOfTravel}</Text>
                ) : null}
              </View>
            </View>

            {/* Conditional Sub-field: Company Vehicle Plate No */}
            {transportMode.startsWith('Company Vehicle') ? (
              <View
                style={styles.conditionalFieldWrap}
                onLayout={(e) => {
                  inputLayouts.current.plateNo = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.conditionalFieldLabel}>Vehicle Plate No. *</Text>
                <TextInput
                  style={[
                    styles.textInputRegular,
                    validationErrors.plateNo ? styles.inputError : null,
                  ]}
                  placeholder="Enter Plate No. (e.g. NBD 1234)"
                  placeholderTextColor="#94a3b8"
                  value={plateNo}
                  onChangeText={(val) => {
                    setPlateNo(val.toUpperCase());
                    setValidationErrors((prev) => ({ ...prev, plateNo: '' }));
                  }}
                  autoCapitalize="characters"
                  onFocus={() => {
                    focusedFieldRef.current = 'plateNo';
                    scrollToField('plateNo');
                  }}
                  onBlur={() => {
                    if (focusedFieldRef.current === 'plateNo') {
                      focusedFieldRef.current = null;
                    }
                  }}
                />
                {validationErrors.plateNo ? (
                  <Text style={styles.fieldError}>{validationErrors.plateNo}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Conditional Sub-field: Others Purpose Detailed Tasks */}
            {purposeOfTravel.startsWith('Others') ? (
              <View
                style={styles.conditionalFieldWrap}
                onLayout={(e) => {
                  inputLayouts.current.otherPurpose = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.conditionalFieldLabel}>Specific Detailed Operational Tasks *</Text>
                <TextInput
                  style={[
                    styles.textAreaRegular,
                    validationErrors.otherPurposeDetails ? styles.inputError : null,
                  ]}
                  placeholder="Specify detailed operational tasks..."
                  placeholderTextColor="#94a3b8"
                  value={otherPurposeDetails}
                  onChangeText={(val) => {
                    setOtherPurposeDetails(val);
                    setValidationErrors((prev) => ({ ...prev, otherPurposeDetails: '' }));
                  }}
                  multiline
                  numberOfLines={3}
                  onFocus={() => {
                    focusedFieldRef.current = 'otherPurpose';
                    scrollToField('otherPurpose');
                  }}
                  onBlur={() => {
                    if (focusedFieldRef.current === 'otherPurpose') {
                      focusedFieldRef.current = null;
                    }
                  }}
                />
                {validationErrors.otherPurposeDetails ? (
                  <Text style={styles.fieldError}>{validationErrors.otherPurposeDetails}</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* SECTION 2: Financial Authorization & Per Diem Allowances */}
          <View
            style={styles.card}
            onLayout={(e) => {
              cardLayouts.current.section2 = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIconBadgeYellow}>
                <Text style={styles.pesoBadgeText}>₱</Text>
              </View>
              <Text style={styles.cardTitle}>Financial Authorization & Per Diem Allowances</Text>
            </View>

            {/* Sub-header row */}
            <View style={styles.subheadingRow}>
              <View style={styles.tabHeadingWrap}>
                <Text style={styles.tabHeadingText}>Expense Classification</Text>
                <View style={styles.tabUnderline} />
              </View>
              <View style={styles.tabHeadingWrap}>
                <Text style={styles.tabHeadingText}>Pre-authorized Budget</Text>
                <View style={styles.tabUnderline} />
              </View>
            </View>

            {/* Budget Row 1: Transport Costs */}
            <View
              style={styles.expenseRow}
              onLayout={(e) => {
                inputLayouts.current.transport = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.expenseLabelWrap}>
                <Text style={styles.expenseTitle}>Transport Costs</Text>
                <Text style={styles.expenseSubtitle}>(Fuel, Tolls, Commuter Fares)</Text>
              </View>
              <View style={styles.budgetInputContainer}>
                <Text style={styles.currencyPrefix}>₱</Text>
                <TextInput
                  style={styles.budgetInput}
                  placeholder="Enter Amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  value={transportBudget}
                  onChangeText={setTransportBudget}
                  onFocus={() => {
                    focusedFieldRef.current = 'transport';
                    scrollToField('transport');
                  }}
                  onBlur={() => {
                    if (focusedFieldRef.current === 'transport') {
                      focusedFieldRef.current = null;
                    }
                  }}
                />
              </View>
            </View>

            {/* Budget Row 2: Meal / Per Diem Allowance */}
            <View
              style={styles.expenseRow}
              onLayout={(e) => {
                inputLayouts.current.meal = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.expenseLabelWrap}>
                <Text style={styles.expenseTitle}>Meal / Per Diem Allowance</Text>
                <Text style={styles.expenseSubtitle}>(Standard Food Rate)</Text>
              </View>
              <View style={styles.budgetInputContainer}>
                <Text style={styles.currencyPrefix}>₱</Text>
                <TextInput
                  style={styles.budgetInput}
                  placeholder="Enter Amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  value={mealBudget}
                  onChangeText={setMealBudget}
                  onFocus={() => {
                    focusedFieldRef.current = 'meal';
                    scrollToField('meal');
                  }}
                  onBlur={() => {
                    if (focusedFieldRef.current === 'meal') {
                      focusedFieldRef.current = null;
                    }
                  }}
                />
              </View>
            </View>

            {/* Budget Row 3: Emergency Out-of-Pocket Expense */}
            <View
              style={styles.expenseRow}
              onLayout={(e) => {
                inputLayouts.current.emergency = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.expenseLabelWrap}>
                <Text style={styles.expenseTitle}>Emergency Out-of-Pocket Expense</Text>
                <Text style={styles.expenseSubtitle}>(Capped Parts/Tools)</Text>
              </View>
              <View style={styles.budgetInputContainer}>
                <Text style={styles.currencyPrefix}>₱</Text>
                <TextInput
                  style={styles.budgetInput}
                  placeholder="Enter Amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  value={emergencyBudget}
                  onChangeText={setEmergencyBudget}
                  onFocus={() => {
                    focusedFieldRef.current = 'emergency';
                    scrollToField('emergency');
                  }}
                  onBlur={() => {
                    if (focusedFieldRef.current === 'emergency') {
                      focusedFieldRef.current = null;
                    }
                  }}
                />
              </View>
            </View>

            {/* Sub-header 2: Accounting Fund Source & Control Codes */}
            <View
              style={styles.accountingSectionWrap}
              onLayout={(e) => {
                inputLayouts.current.costCenter = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.tabHeadingWrap}>
                <Text style={styles.tabHeadingText}>Accounting Fund Source & Control Codes</Text>
                <View style={[styles.tabUnderline, styles.tabUnderlineAccounting]} />
              </View>

              <View style={styles.underlineRow}>
                {/* Cost Center Code */}
                <View style={styles.underlineField}>
                  <View style={styles.underlineBox}>
                    <TextInput
                      style={[styles.underlineInput, styles.underlineText]}
                      placeholder="Enter Code"
                      placeholderTextColor="#94a3b8"
                      value={costCenterCode}
                      onChangeText={setCostCenterCode}
                      onFocus={() => {
                        focusedFieldRef.current = 'costCenter';
                        scrollToField('costCenter');
                      }}
                      onBlur={() => {
                        if (focusedFieldRef.current === 'costCenter') {
                          focusedFieldRef.current = null;
                        }
                      }}
                    />
                  </View>
                  <Text style={styles.underlineLabel}>Cost Center Code</Text>
                </View>

                {/* Charge to Store/Branch */}
                <View style={styles.underlineField}>
                  <Pressable
                    style={styles.underlineBox}
                    onPress={() => setChargeStoreModalVisible(true)}
                  >
                    <Text
                      style={[
                        styles.underlineText,
                        !chargeToStore ? styles.underlineTextPlaceholder : null,
                      ]}
                      numberOfLines={1}
                    >
                      {chargeToStore || 'Select Store'}
                    </Text>
                    <ChevronDown size={16} color="#0f172a" strokeWidth={2.4} />
                  </Pressable>
                  <Text style={styles.underlineLabel}>Charge to Store/Branch</Text>
                </View>
              </View>
            </View>
          </View>

          {/* ACTION BUTTONS: Cancel & Submit Request */}
          <View style={styles.actionButtonsRow}>
            <Pressable
              style={styles.cancelButton}
              onPress={handleCancel}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[styles.submitButton, isSubmitting ? styles.submitButtonDisabled : null]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Request</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* MODAL 1: Destination Store Multi-Select Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={destinationModalVisible}
        onRequestClose={() => setDestinationModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setDestinationModalVisible(false)}
          />
          <View
            style={[
              styles.optionSheet,
              { paddingBottom: safeModalBottomPadding },
            ]}
          >
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTextCol}>
                <Text style={styles.sheetTitle}>Select Destination Store(s)</Text>
                <Text style={styles.sheetSubtitle}>
                  Choose one or more Goldilocks branches across the 4 companies.
                </Text>
              </View>
              <Pressable
                style={styles.sheetCloseButton}
                onPress={() => setDestinationModalVisible(false)}
                hitSlop={8}
              >
                <X size={18} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>

            {/* Search Bar */}
            <View style={styles.modalSearchBox}>
              <Search size={16} color="#94a3b8" strokeWidth={2.2} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search Goldilocks stores..."
                placeholderTextColor="#94a3b8"
                value={destinationSearch}
                onChangeText={setDestinationSearch}
                clearButtonMode="while-editing"
              />
              {destinationSearch ? (
                <Pressable onPress={() => setDestinationSearch('')} hitSlop={6}>
                  <X size={14} color="#94a3b8" strokeWidth={2.4} />
                </Pressable>
              ) : null}
            </View>

            {/* Quick Actions Row */}
            <View style={styles.quickActionsRow}>
              <Text style={styles.selectedCountText}>
                {selectedStores.length} of {goldilocksStores.length} selected
              </Text>
              <View style={styles.quickActionButtons}>
                <Pressable
                  onPress={() => {
                    const allStoreNames = filteredGoldilocksStores.map((s) => s.store_name);
                    setSelectedStores(Array.from(new Set([...selectedStores, ...allStoreNames])));
                  }}
                  hitSlop={4}
                >
                  <Text style={styles.quickActionText}>Select All</Text>
                </Pressable>
                <Text style={styles.quickActionDivider}>•</Text>
                <Pressable
                  onPress={() => {
                    const filteredNames = new Set(filteredGoldilocksStores.map((s) => s.store_name));
                    setSelectedStores((prev) => prev.filter((name) => !filteredNames.has(name)));
                  }}
                  hitSlop={4}
                >
                  <Text style={styles.quickActionText}>Clear All</Text>
                </Pressable>
              </View>
            </View>

            {/* Scrollable Store List */}
            {loadingStores ? (
              <View style={styles.modalLoadingBox}>
                <ActivityIndicator size="small" color={colors.brand.gold} />
                <Text style={styles.modalLoadingText}>Loading stores from database...</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {filteredGoldilocksStores.length === 0 ? (
                  <View style={styles.modalEmptyBox}>
                    <Text style={styles.modalEmptyText}>No matching Goldilocks stores found.</Text>
                  </View>
                ) : (
                  filteredGoldilocksStores.map((store) => {
                    const isSelected = selectedStores.includes(store.store_name);
                    return (
                      <Pressable
                        key={`${store.company_name}_${store.store_name}`}
                        style={[
                          styles.storeOptionRow,
                          isSelected ? styles.storeOptionRowSelected : null,
                        ]}
                        onPress={() => toggleDestinationStore(store.store_name)}
                      >
                        <View style={[styles.checkbox, isSelected ? styles.checkboxActive : null]}>
                          {isSelected ? (
                            <Check size={14} color="#0f172a" strokeWidth={3} />
                          ) : null}
                        </View>
                        <View style={styles.storeOptionTextCol}>
                          <Text
                            style={[
                              styles.storeOptionName,
                              isSelected ? styles.storeOptionNameSelected : null,
                            ]}
                          >
                            {store.store_name}
                          </Text>
                          <Text style={styles.storeOptionCompany}>{store.company_name}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            )}

            {/* Done Button */}
            <Pressable
              style={styles.modalDoneButton}
              onPress={() => setDestinationModalVisible(false)}
            >
              <Text style={styles.modalDoneButtonText}>
                Done {selectedStores.length > 0 ? `(${selectedStores.length})` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL 2: Specific Mode of Transport Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={transportModalVisible}
        onRequestClose={() => setTransportModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setTransportModalVisible(false)}
          />
          <View
            style={[
              styles.optionSheet,
              { paddingBottom: safeModalBottomPadding },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTextCol}>
                <Text style={styles.sheetTitle}>Select Mode of Transport</Text>
                <Text style={styles.sheetSubtitle}>
                  Choose your authorized official travel transportation.
                </Text>
              </View>
              <Pressable
                style={styles.sheetCloseButton}
                onPress={() => setTransportModalVisible(false)}
                hitSlop={8}
              >
                <X size={18} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.simpleOptionsList}>
              {TRANSPORT_MODES.map((option) => {
                const isSelected = transportMode === option;
                return (
                  <Pressable
                    key={option}
                    style={[
                      styles.simpleOptionRow,
                      isSelected ? styles.simpleOptionRowSelected : null,
                    ]}
                    onPress={() => {
                      setTransportMode(option);
                      setTransportModalVisible(false);
                      setValidationErrors((prev) => ({ ...prev, transportMode: '' }));
                    }}
                  >
                    <View style={[styles.radioCircle, isSelected ? styles.radioCircleActive : null]}>
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text
                      style={[
                        styles.simpleOptionText,
                        isSelected ? styles.simpleOptionTextSelected : null,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 3: Purpose of Travel Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={purposeModalVisible}
        onRequestClose={() => setPurposeModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setPurposeModalVisible(false)}
          />
          <View
            style={[
              styles.optionSheet,
              { paddingBottom: safeModalBottomPadding },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTextCol}>
                <Text style={styles.sheetTitle}>Select Purpose of Travel</Text>
                <Text style={styles.sheetSubtitle}>
                  Choose the primary operational intent for this travel.
                </Text>
              </View>
              <Pressable
                style={styles.sheetCloseButton}
                onPress={() => setPurposeModalVisible(false)}
                hitSlop={8}
              >
                <X size={18} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.simpleOptionsList}>
              {TRAVEL_PURPOSES.map((option) => {
                const isSelected = purposeOfTravel === option;
                return (
                  <Pressable
                    key={option}
                    style={[
                      styles.simpleOptionRow,
                      isSelected ? styles.simpleOptionRowSelected : null,
                    ]}
                    onPress={() => {
                      setPurposeOfTravel(option);
                      setPurposeModalVisible(false);
                      setValidationErrors((prev) => ({ ...prev, purposeOfTravel: '' }));
                    }}
                  >
                    <View style={[styles.radioCircle, isSelected ? styles.radioCircleActive : null]}>
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text
                      style={[
                        styles.simpleOptionText,
                        isSelected ? styles.simpleOptionTextSelected : null,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL 4: Charge to Store/Branch Single Select Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={chargeStoreModalVisible}
        onRequestClose={() => setChargeStoreModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setChargeStoreModalVisible(false)}
          />
          <View
            style={[
              styles.optionSheet,
              { paddingBottom: safeModalBottomPadding },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTextCol}>
                <Text style={styles.sheetTitle}>Charge to Store / Branch</Text>
                <Text style={styles.sheetSubtitle}>
                  Select Goldilocks branch across the 4 companies to charge expenses.
                </Text>
              </View>
              <Pressable
                style={styles.sheetCloseButton}
                onPress={() => setChargeStoreModalVisible(false)}
                hitSlop={8}
              >
                <X size={18} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>

            {/* Search Bar */}
            <View style={styles.modalSearchBox}>
              <Search size={16} color="#94a3b8" strokeWidth={2.2} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search Goldilocks stores..."
                placeholderTextColor="#94a3b8"
                value={chargeStoreSearch}
                onChangeText={setChargeStoreSearch}
                clearButtonMode="while-editing"
              />
              {chargeStoreSearch ? (
                <Pressable onPress={() => setChargeStoreSearch('')} hitSlop={6}>
                  <X size={14} color="#94a3b8" strokeWidth={2.4} />
                </Pressable>
              ) : null}
            </View>

            {/* Scrollable Store List */}
            {loadingStores ? (
              <View style={styles.modalLoadingBox}>
                <ActivityIndicator size="small" color={colors.brand.gold} />
                <Text style={styles.modalLoadingText}>Loading stores from database...</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {filteredChargeStores.length === 0 ? (
                  <View style={styles.modalEmptyBox}>
                    <Text style={styles.modalEmptyText}>No matching Goldilocks stores found.</Text>
                  </View>
                ) : (
                  filteredChargeStores.map((store) => {
                    const isSelected = chargeToStore === store.store_name;
                    return (
                      <Pressable
                        key={`charge_${store.company_name}_${store.store_name}`}
                        style={[
                          styles.storeOptionRow,
                          isSelected ? styles.storeOptionRowSelected : null,
                        ]}
                        onPress={() => {
                          setChargeToStore(store.store_name);
                          setChargeStoreModalVisible(false);
                        }}
                      >
                        <View style={[styles.radioCircle, isSelected ? styles.radioCircleActive : null]}>
                          {isSelected ? <View style={styles.radioDot} /> : null}
                        </View>
                        <View style={styles.storeOptionTextCol}>
                          <Text
                            style={[
                              styles.storeOptionName,
                              isSelected ? styles.storeOptionNameSelected : null,
                            ]}
                          >
                            {store.store_name}
                          </Text>
                          <Text style={styles.storeOptionCompany}>{store.company_name}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      {activeDatePicker !== null ? (
        <UniversalDateTimePicker
          value={
            activeDatePicker === 'departure'
              ? departureDate
                ? dateStringToDate(departureDate)
                : new Date()
              : returnDate
                ? dateStringToDate(returnDate)
                : new Date()
          }
          mode="date"
          onChange={(event, selectedDate) => {
            if (event.type !== 'dismissed' && selectedDate) {
              const formatted = formatDateInput(selectedDate);
              if (activeDatePicker === 'departure') {
                setDepartureDate(formatted);
                if (returnDate && returnDate < formatted) {
                  setReturnDate(formatted);
                }
                setValidationErrors((prev) => ({ ...prev, departureDate: '' }));
              } else if (activeDatePicker === 'return') {
                setReturnDate(formatted);
                setValidationErrors((prev) => ({ ...prev, returnDate: '' }));
              }
            }
            if (Platform.OS !== 'ios') {
              setActiveDatePicker(null);
            }
          }}
          onClose={() => setActiveDatePicker(null)}
        />
      ) : null}

      {/* Time Picker Modal */}
      <ScrollableTimePickerModal
        visible={activeTimePicker !== null}
        title={activeTimePicker === 'departure' ? 'Select Departure Time' : 'Select Return Time'}
        initialTime={activeTimePicker === 'departure' ? departureTime : returnTime}
        onConfirm={(time24) => {
          if (activeTimePicker === 'departure') {
            setDepartureTime(time24);
            setValidationErrors((prev) => ({ ...prev, departureTime: '' }));
          } else if (activeTimePicker === 'return') {
            setReturnTime(time24);
            setValidationErrors((prev) => ({ ...prev, returnTime: '' }));
          }
          setActiveTimePicker(null);
        }}
        onCancel={() => setActiveTimePicker(null)}
      />

      {/* Corporate Policy Disclosure Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={showPolicyModal}
        onRequestClose={() => setShowPolicyModal(false)}
      >
        <View style={styles.policyModalBackdrop}>
          <Pressable
            style={styles.policyModalDismissArea}
            onPress={() => setShowPolicyModal(false)}
          />
          <View style={styles.policyModalPanel}>
            <View style={styles.policyModalHeader}>
              <View style={styles.policyModalTitleWrap}>
                <View style={styles.policyHeaderBadge}>
                  <ShieldAlert size={18} color="#0f172a" strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.policyModalTitle}>Policy Disclosure</Text>
                  <Text style={styles.policyModalSubtitle}>
                    Labor alignment & operational guidelines
                  </Text>
                </View>
              </View>
              <Pressable
                style={styles.policyCloseButton}
                onPress={() => setShowPolicyModal(false)}
                hitSlop={8}
              >
                <X size={18} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.policyScroll}
              contentContainerStyle={styles.policyScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.policyBanner}>
                <Text style={styles.policyBannerText}>
                  LABOR ALIGNMENT & CORPORATE POLICY DISCLOSURE:
                </Text>
              </View>

              {/* Policy 1 */}
              <View style={styles.policyItem}>
                <View style={styles.policyNumberBadge}>
                  <Text style={styles.policyNumberText}>1</Text>
                </View>
                <View style={styles.policyContentWrap}>
                  <Text style={styles.policyItemTitle}>Operational Directive & Wage Laws</Text>
                  <Text style={styles.policyItemBody}>
                    This Travel Order constitutes a legal, direct operational directive from management. Hours clocked during field assignments shall be recognized and computed strictly in line with statutory Wage and Hour Laws. Maintenance and logistics staff must report actual time worked using decentralized tools or authenticated manually via destination store signatures to prevent unrecorded overtime.
                  </Text>
                </View>
              </View>

              {/* Policy 2 */}
              <View style={styles.policyItem}>
                <View style={styles.policyNumberBadge}>
                  <Text style={styles.policyNumberText}>2</Text>
                </View>
                <View style={styles.policyContentWrap}>
                  <Text style={styles.policyItemTitle}>Liquidation Obligation</Text>
                  <Text style={styles.policyItemBody}>
                    All pre-authorized cash advances and field expenses must be fully supported by official receipts (OR) and submitted to the Finance Department within three (3) working days upon return to base. Failure to liquidate or clear accountability balances will authorize the company to automatically withhold the unliquidated amount from the employee's next payroll cycle under applicable wage deduction guidelines.
                  </Text>
                </View>
              </View>

              {/* Policy 3 */}
              <View style={styles.policyItem}>
                <View style={styles.policyNumberBadge}>
                  <Text style={styles.policyNumberText}>3</Text>
                </View>
                <View style={styles.policyContentWrap}>
                  <Text style={styles.policyItemTitle}>Route & Safety Compliance</Text>
                  <Text style={styles.policyItemBody}>
                    Deviation from the pre-approved route or itinerary without a documented operational emergency will void this travel order and may trigger disciplinary sanctions under the corporate Code of Conduct for breach of operational safety rules.
                  </Text>
                </View>
              </View>
            </ScrollView>

            <Pressable
              style={styles.policyAcknowledgeButton}
              onPress={() => setShowPolicyModal(false)}
            >
              <Text style={styles.policyAcknowledgeButtonText}>Understood & Acknowledged</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
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
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.md,
  },
  cardHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderIconBadgeYellow: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pesoBadgeText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '900',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    flex: 1,
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

  // Underline Form Styling (exact match with attached image)
  underlineRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  underlineField: {
    flex: 1,
    minWidth: 0,
  },
  underlineBox: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 5,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  underlineInput: {
    flex: 1,
    padding: 0,
    margin: 0,
  },
  underlineText: {
    flex: 1,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  underlineTextPlaceholder: {
    color: '#94a3b8',
    fontWeight: fontWeights.regular,
  },
  underlineLabel: {
    color: '#0f172a',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    marginTop: 4,
  },
  inputError: {
    borderBottomColor: '#ef4444',
  },
  fieldError: {
    color: '#ef4444',
    fontSize: 10.5,
    fontWeight: fontWeights.semibold,
    marginTop: 2,
  },

  // Conditional sub-fields
  conditionalFieldWrap: {
    marginTop: -4,
    marginBottom: 16,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  conditionalFieldLabel: {
    fontSize: 11.5,
    fontWeight: fontWeights.bold,
    color: '#334155',
    marginBottom: 6,
  },
  textInputRegular: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 38,
    fontSize: 13,
    color: '#0f172a',
  },
  textAreaRegular: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 64,
    fontSize: 13,
    color: '#0f172a',
    textAlignVertical: 'top',
  },

  // Section 2: Financial Authorization styling
  subheadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 14,
  },
  tabHeadingWrap: {
    alignSelf: 'flex-start',
  },
  tabHeadingText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748b',
  },
  tabUnderline: {
    height: 2,
    backgroundColor: '#94a3b8',
    marginTop: 4,
    width: 64,
    borderRadius: 1,
  },
  tabUnderlineAccounting: {
    width: 84,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  expenseLabelWrap: {
    flex: 1,
    paddingRight: 6,
  },
  expenseTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 17,
  },
  expenseSubtitle: {
    fontSize: 11.5,
    fontWeight: '400',
    color: '#64748b',
    lineHeight: 15,
  },
  budgetInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    height: 38,
    width: 145,
    paddingHorizontal: 8,
    gap: 6,
  },
  currencyPrefix: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  budgetInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0f172a',
    paddingVertical: 0,
    height: '100%',
  },
  accountingSectionWrap: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 14,
    gap: 12,
  },

  // Bottom action buttons
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  submitButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#0066cc',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0066cc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Modal Sheet common styles
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalDismissArea: {
    flex: 1,
  },
  optionSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  sheetHeaderTextCol: {
    flex: 1,
    paddingRight: 10,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    marginBottom: 2,
  },
  sheetSubtitle: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  sheetCloseButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
  },

  // Search input inside modal
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    paddingVertical: 0,
    height: '100%',
  },

  // Quick actions row
  quickActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 4,
  },
  selectedCountText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#0284c7',
  },
  quickActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284c7',
  },
  quickActionDivider: {
    color: '#cbd5e1',
    fontSize: 12,
  },

  // Modal scroll list
  modalScrollView: {
    maxHeight: 340,
  },
  modalScrollContent: {
    paddingVertical: 4,
  },
  modalLoadingBox: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalLoadingText: {
    fontSize: 12,
    color: '#64748b',
  },
  modalEmptyBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 13,
    color: '#94a3b8',
  },

  // Store multi-select row
  storeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginVertical: 2,
    gap: 12,
  },
  storeOptionRowSelected: {
    backgroundColor: '#fef3c7',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#facc15',
    borderColor: '#d97706',
  },
  storeOptionTextCol: {
    flex: 1,
  },
  storeOptionName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 1,
  },
  storeOptionNameSelected: {
    color: '#92400e',
  },
  storeOptionCompany: {
    fontSize: 11,
    color: '#64748b',
  },

  // Done button in modal
  modalDoneButton: {
    backgroundColor: '#0066cc',
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  modalDoneButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Simple option list (for transport mode & purpose)
  simpleOptionsList: {
    paddingVertical: 6,
    gap: 4,
  },
  simpleOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 12,
  },
  simpleOptionRowSelected: {
    backgroundColor: '#f0fdf4',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: '#16a34a',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#16a34a',
  },
  simpleOptionText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0f172a',
  },
  simpleOptionTextSelected: {
    color: '#15803d',
    fontWeight: '700',
  },
  policyModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  policyModalDismissArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  policyModalPanel: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: spacing.lg,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  policyModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  policyModalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  policyHeaderBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  policyModalTitle: {
    fontSize: 17,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  policyModalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  policyCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  policyScroll: {
    marginVertical: 12,
  },
  policyScrollContent: {
    gap: 12,
    paddingBottom: 6,
  },
  policyBanner: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  policyBannerText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  policyItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  policyNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  policyNumberText: {
    color: '#facc15',
    fontSize: 13,
    fontWeight: '900',
  },
  policyContentWrap: {
    flex: 1,
  },
  policyItemTitle: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
    marginBottom: 4,
  },
  policyItemBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
  },
  policyAcknowledgeButton: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  policyAcknowledgeButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
});
