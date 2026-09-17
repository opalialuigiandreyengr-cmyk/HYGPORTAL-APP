import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  AlertTriangle,
  Cake,
  CalendarDays,
  Check,
  ChevronDown,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { DateRangePickerModal } from '../components/DateRangePickerModal';
import { formatEsarfDateRange } from '../components/EsarfDetailsView';
import type { AppToastMessage } from '../components/AppToast';
import { leaveCategoryOptions, leaveTypeOptions } from '../constants/requestOptions';
import { supabase } from '../lib/supabase';
import { platformAlert } from '../utils/platformAlert';
import { withTimeout } from '../utils/withTimeout';
import type { AssistantDraft } from '../services/assistant';
import { colors, fontWeights, radius, spacing } from '../theme';
import { calculateLeaveDays, dateStringToDate, formatDateInput } from '../utils/dateTime';
import { updateMyPendingRequest, type MyRequest } from '../services/requests';
import { checkApproverActiveViewing, type ActiveViewerInfo } from '../services/requestViewerLock';
import { ActiveReviewLockModal } from '../components/ActiveReviewLockModal';
import { getDisabledLeaveTypes, getLeaveBreakdown } from '../utils/requestCalculations';
import {
  checkBirthdayLeaveAppliedForYear,
  isAutoApprovedBirthdayGrant,
  markBirthdayLeaveGrantedForYear,
  mergeIntoMyRequestsCache,
  parseBirthMonthDay,
  verifyEmployeeBirthday,
} from '../services/birthdayLeave';

export type LeaveEntry = {
  id: string;
  leaveType: string;
  leaveCategory: string;
  dateFrom: string;
  dateTo: string;
  paidDays: string;
  unpaidDays: string;
  reason: string;
};

type RequestLeaveProps = {
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  birthDate?: string | null;
  leaveCreditRemaining?: number;
  initialDraft?: Extract<AssistantDraft, { intent: 'draft_leave_request' }> | null;
  editingRequest?: MyRequest | null;
  notificationCount?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onBack?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSubmitted?: () => void | Promise<void>;
};

const RequestLeave = ({
  name,
  username,
  photoUrl,
  birthDate,
  leaveCreditRemaining = 0,
  initialDraft,
  editingRequest,
  notificationCount = 0,
  onAssistant,
  onNotifications,
  onBack,
  onToast,
  onSubmitted,
}: RequestLeaveProps) => {
  const [activeLockInfo, setActiveLockInfo] = useState<ActiveViewerInfo | null>(null);
  const [effectiveBirthDate, setEffectiveBirthDate] = useState<string | null>(birthDate || null);
  const [hasAppliedBirthdayLeaveThisYear, setHasAppliedBirthdayLeaveThisYear] =
    useState<boolean>(false);

  // Check if Birthday Leave has already been granted/applied for the current calendar year
  useEffect(() => {
    let isMounted = true;
    async function loadBirthdayGrantStatus() {
      try {
        const identity = username || '';
        const alreadyApplied = await checkBirthdayLeaveAppliedForYear(identity);
        if (isMounted) {
          setHasAppliedBirthdayLeaveThisYear(alreadyApplied);
        }
      } catch {
        // ignore errors
      }
    }
    loadBirthdayGrantStatus();
    return () => {
      isMounted = false;
    };
  }, [username]);

  // If already applied for Birthday Leave, ensure any unsubmitted draft doesn't default to it
  useEffect(() => {
    if (
      hasAppliedBirthdayLeaveThisYear &&
      (!editingRequest || editingRequest.leave_category !== 'Birthday Leave')
    ) {
      setEntries((prev) => {
        let changed = false;
        const next = prev.map((e) => {
          if (e.leaveCategory === 'Birthday Leave') {
            changed = true;
            return {
              ...e,
              leaveCategory: '',
              dateFrom: '',
              dateTo: '',
              reason: e.reason === 'Auto-approved Birthday Leave Grant' ? '' : e.reason,
            };
          }
          return e;
        });
        return changed ? next : prev;
      });
    }
  }, [hasAppliedBirthdayLeaveThisYear, editingRequest]);

  // Fallback load birthDate from database if not passed as prop
  useEffect(() => {
    if (birthDate) {
      setEffectiveBirthDate(birthDate);
      return;
    }
    async function loadFallbackBirthDate() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('employee_id')
          .eq('auth_user_id', user.id)
          .single();
        if (!profile?.employee_id) return;
        const { data: emp } = await supabase
          .from('employees')
          .select('birth_date')
          .eq('id', profile.employee_id)
          .single();
        if (emp?.birth_date) {
          setEffectiveBirthDate(emp.birth_date);
        }
      } catch {
        // ignore fallback errors
      }
    }
    loadFallbackBirthDate();
  }, [birthDate]);

  const [entries, setEntries] = useState<LeaveEntry[]>(() => {
    if (editingRequest) {
      const eStartDate = editingRequest.start_date || editingRequest.date_from || '';
      const eEndDate = editingRequest.end_date || editingRequest.date_to || eStartDate;
      return [
        {
          id: '1',
          leaveType: editingRequest.leave_type || (leaveCreditRemaining <= 0 ? 'Without Pay' : ''),
          leaveCategory: editingRequest.leave_category || '',
          dateFrom: eStartDate,
          dateTo: eEndDate,
          paidDays:
            editingRequest.paid_days !== null && editingRequest.paid_days !== undefined
              ? String(editingRequest.paid_days)
              : '1',
          unpaidDays:
            editingRequest.unpaid_days !== null && editingRequest.unpaid_days !== undefined
              ? String(editingRequest.unpaid_days)
              : '0',
          reason: editingRequest.reason || '',
        },
      ];
    }

    const draftStartDate = initialDraft?.fields.startDate || '';
    const draftEndDate = initialDraft?.fields.endDate || draftStartDate;

    return [
      {
        id: '1',
        leaveType:
          initialDraft?.fields.leaveType || (leaveCreditRemaining <= 0 ? 'Without Pay' : ''),
        leaveCategory: initialDraft?.fields.leaveCategory || '',
        dateFrom: draftStartDate,
        dateTo: draftEndDate,
        paidDays: '1',
        unpaidDays: '0',
        reason: initialDraft?.fields.reason || '',
      },
    ];
  });

  useEffect(() => {
    if (editingRequest) {
      const eStartDate = editingRequest.start_date || editingRequest.date_from || '';
      const eEndDate = editingRequest.end_date || editingRequest.date_to || eStartDate;
      setEntries([
        {
          id: '1',
          leaveType: editingRequest.leave_type || (leaveCreditRemaining <= 0 ? 'Without Pay' : ''),
          leaveCategory: editingRequest.leave_category || '',
          dateFrom: eStartDate,
          dateTo: eEndDate,
          paidDays:
            editingRequest.paid_days !== null && editingRequest.paid_days !== undefined
              ? String(editingRequest.paid_days)
              : '1',
          unpaidDays:
            editingRequest.unpaid_days !== null && editingRequest.unpaid_days !== undefined
              ? String(editingRequest.unpaid_days)
              : '0',
          reason: editingRequest.reason || '',
        },
      ]);
    }
  }, [editingRequest, leaveCreditRemaining]);

  const [activeDateChoiceIndex, setActiveDateChoiceIndex] = useState<number | null>(null);
  const [activeSelect, setActiveSelect] = useState<{
    index: number;
    field: 'leave_type' | 'leave_category';
  } | null>(null);

  const [showLeaveNotes, setShowLeaveNotes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [submissionErrorModal, setSubmissionErrorModal] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string | undefined>>({});

  const scrollRef = useRef<ScrollView | null>(null);
  const reasonInputRefs = useRef<Record<number, TextInput | null>>({});
  const entryCardLayouts = useRef<Record<number, number>>({});
  const pendingScrollToIndex = useRef<number | null>(null);
  const submittedIndices = useRef<Set<number>>(new Set());

  // Calculates credits deducted from the employee's annual leave balance for an entry
  // Birthday Leave grants 1 day With Pay for free (0 credits deducted from balance)
  function getEntryCreditsDeducted(entry: LeaveEntry): number {
    const totalDays = calculateLeaveDays(entry.dateFrom, entry.dateTo);
    const bd = getLeaveBreakdown(entry.leaveType, totalDays, entry.paidDays, entry.unpaidDays);
    if (entry.leaveCategory === 'Birthday Leave') {
      return Math.max(0, bd.paidDays - 1);
    }
    return bd.paidDays;
  }

  // Aggregate calculations across all entries
  const totalPaidDaysAllEntries = entries.reduce((sum, e) => {
    const totalDays = calculateLeaveDays(e.dateFrom, e.dateTo);
    const bd = getLeaveBreakdown(e.leaveType, totalDays, e.paidDays, e.unpaidDays);
    return sum + bd.paidDays;
  }, 0);

  const totalUnpaidDaysAllEntries = entries.reduce((sum, e) => {
    const totalDays = calculateLeaveDays(e.dateFrom, e.dateTo);
    const bd = getLeaveBreakdown(e.leaveType, totalDays, e.paidDays, e.unpaidDays);
    return sum + bd.unpaidDays;
  }, 0);

  const totalCreditsDeductedAllEntries = entries.reduce(
    (sum, e) => sum + getEntryCreditsDeducted(e),
    0,
  );

  const hasBirthdayLeaveEntry = entries.some((e) => e.leaveCategory === 'Birthday Leave');
  const remainingCredits = Math.max(0, leaveCreditRemaining - totalCreditsDeductedAllEntries);
  const creditUsedPercent =
    leaveCreditRemaining > 0
      ? Math.min(100, Math.round((remainingCredits / leaveCreditRemaining) * 100))
      : 0;

  const scrollToEntryCard = (index: number) => {
    const cardY = entryCardLayouts.current[index];
    if (cardY !== undefined) {
      scrollRef.current?.scrollTo({
        y: Math.max(0, cardY - 16),
        animated: true,
      });
    }
  };

  function updateEntry(index: number, updates: Partial<LeaveEntry>) {
    setEntries((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], ...updates };
      }
      return next;
    });
  }

  function addEntry() {
    const nextIndex = entries.length;
    pendingScrollToIndex.current = nextIndex;

    const availableLeft = Math.max(0, leaveCreditRemaining - totalCreditsDeductedAllEntries);
    const defaultType = availableLeft <= 0 ? 'Without Pay' : '';

    setEntries((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        leaveType: defaultType,
        leaveCategory: '',
        dateFrom: '',
        dateTo: '',
        paidDays: '0',
        unpaidDays: '0',
        reason: '',
      },
    ]);

    setTimeout(() => {
      if (pendingScrollToIndex.current === nextIndex) {
        pendingScrollToIndex.current = null;
        scrollToEntryCard(nextIndex);
      }
    }, Platform.OS === 'android' ? 140 : 80);
  }

  function removeEntry(index: number) {
    if (entries.length <= 1) return;
    const entryNumber = index + 1;
    platformAlert(
      'Delete Request',
      `Are you sure you want to delete Request #${entryNumber}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setEntries((prev) => prev.filter((_, i) => i !== index));
            setValidationErrors((current) => {
              const next = { ...current };
              Object.keys(next).forEach((k) => {
                if (k.startsWith(`entry_${index}_`)) {
                  delete next[k];
                }
              });
              return next;
            });
          },
        },
      ],
    );
  }

  function confirmDiscard(action?: () => void) {
    if (!action) {
      return;
    }

    platformAlert(
      isSubmitting ? 'Cancel submission?' : 'Discard leave request?',
      isSubmitting
        ? 'Submission is currently in progress. Are you sure you want to cancel?'
        : 'Are you sure you want to cancel and leave this page? Any unsaved changes will be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: isSubmitting ? 'Cancel Request' : 'Discard',
          style: 'destructive',
          onPress: () => {
            setIsSubmitting(false);
            action();
          },
        },
      ],
    );
  }

  useEffect(() => {
    const onBackPress = () => {
      if (onBack) {
        confirmDiscard(onBack);
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [onBack, isSubmitting]);

  // Handle select option choice (Leave Type or Leave Category)
  function chooseSelectOption(value: string) {
    if (!activeSelect) return;
    const { index, field } = activeSelect;
    const entry = entries[index];
    if (!entry) {
      setActiveSelect(null);
      return;
    }

    if (field === 'leave_type') {
      const totalDays = calculateLeaveDays(entry.dateFrom, entry.dateTo);
      const otherCreditsDeducted = entries.reduce((sum, e, i) => {
        if (i === index) return sum;
        return sum + getEntryCreditsDeducted(e);
      }, 0);
      const availableCreditsForThis = Math.max(0, leaveCreditRemaining - otherCreditsDeducted);

      let nextPaidDays = entry.paidDays;
      let nextUnpaidDays = entry.unpaidDays;

      let finalLeaveType = value;
      if (entry.leaveCategory === 'Birthday Leave') {
        if (totalDays === 1) {
          finalLeaveType = 'With Pay';
          nextPaidDays = '1';
          nextUnpaidDays = '0';
        } else if (totalDays > 1) {
          const otherDays = totalDays - 1;
          if (value === 'With Pay') {
            nextPaidDays = String(totalDays);
            nextUnpaidDays = '0';
          } else if (value === 'Without Pay' || value === 'Both') {
            finalLeaveType = 'Both';
            const safePaidExtra =
              value === 'Without Pay' ? 0 : Math.min(otherDays, availableCreditsForThis);
            nextPaidDays = String(1 + safePaidExtra);
            nextUnpaidDays = String(Math.round((otherDays - safePaidExtra) * 100) / 100);
          }
        }
      } else {
        if (value === 'With Pay') {
          nextPaidDays = String(totalDays);
          nextUnpaidDays = '0';
        } else if (value === 'Without Pay') {
          nextPaidDays = '0';
          nextUnpaidDays = String(totalDays);
        } else if (value === 'Both') {
          const safePaid = Math.min(totalDays, availableCreditsForThis);
          nextPaidDays = String(safePaid);
          nextUnpaidDays = String(Math.round((totalDays - safePaid) * 100) / 100);
        }
      }

      updateEntry(index, {
        leaveType: finalLeaveType,
        paidDays: nextPaidDays,
        unpaidDays: nextUnpaidDays,
      });
      setValidationErrors((current) => ({
        ...current,
        [`entry_${index}_leaveType`]: undefined,
        [`entry_${index}_split`]: undefined,
        totalCredits: undefined,
      }));
    } else if (field === 'leave_category') {
      if (value === 'Birthday Leave') {
        const isEditingThisBirthday = Boolean(
          editingRequest && editingRequest.leave_category === 'Birthday Leave',
        );
        const hasBirthdayInOther = entries.some(
          (e, i) => i !== index && e.leaveCategory === 'Birthday Leave',
        );
        if (!isEditingThisBirthday && (hasAppliedBirthdayLeaveThisYear || hasBirthdayInOther)) {
          platformAlert(
            'Birthday Leave Unavailable',
            hasAppliedBirthdayLeaveThisYear
              ? 'You have already applied for the auto-approved Birthday Leave Grant for this year.'
              : 'Birthday Leave has already been selected on another card.',
          );
          setActiveSelect(null);
          return;
        }

        if (!effectiveBirthDate) {
          platformAlert(
            'Birth Date Required',
            'Birth date is not recorded on your profile. Please contact HR to update your employee birth date before filing Birthday Leave.',
          );
          setActiveSelect(null);
          return;
        }

        // Accurately extract birth month and day (MM-DD)
        const parsed = parseBirthMonthDay(effectiveBirthDate);
        if (!parsed) {
          platformAlert(
            'Birth Date Required',
            'Birth date format is not recognized. Please contact HR to update your employee birth date before filing Birthday Leave.',
          );
          setActiveSelect(null);
          return;
        }

        const currentYear = new Date().getFullYear();
        const birthdayThisYear = `${currentYear}-${parsed.monthDay}`;

        // Automatically set the date to the accurate birthday of the user or employee
        const newDateFrom = birthdayThisYear;
        const newDateTo = birthdayThisYear;
        const newReason = entry.reason || 'Auto-approved Birthday Leave Grant';

        updateEntry(index, {
          leaveCategory: value,
          dateFrom: newDateFrom,
          dateTo: newDateTo,
          leaveType: 'With Pay',
          paidDays: '1',
          unpaidDays: '0',
          reason: newReason,
        });

        setValidationErrors((current) => ({
          ...current,
          [`entry_${index}_leaveCategory`]: undefined,
          [`entry_${index}_leaveType`]: undefined,
          [`entry_${index}_dateFrom`]: undefined,
          [`entry_${index}_dateTo`]: undefined,
          [`entry_${index}_leaveDays`]: undefined,
          [`entry_${index}_split`]: undefined,
          totalCredits: undefined,
        }));
      } else {
        const wasBirthdayLeave = entry.leaveCategory === 'Birthday Leave';
        if (wasBirthdayLeave) {
          const otherCreditsDeducted = entries.reduce((sum, e, i) => {
            if (i === index) return sum;
            return sum + getEntryCreditsDeducted(e);
          }, 0);
          const availableCreditsForThis = Math.max(0, leaveCreditRemaining - otherCreditsDeducted);
          const defaultType = availableCreditsForThis <= 0 ? 'Without Pay' : '';
          const isBirthdayReason =
            !entry.reason ||
            entry.reason === 'Auto-approved Birthday Leave Grant' ||
            entry.reason.toLowerCase().includes('birthday');

          updateEntry(index, {
            leaveCategory: value,
            dateFrom: '',
            dateTo: '',
            leaveType: defaultType,
            paidDays: '0',
            unpaidDays: '0',
            reason: isBirthdayReason ? '' : entry.reason,
          });

          setValidationErrors((current) => ({
            ...current,
            [`entry_${index}_leaveCategory`]: undefined,
            [`entry_${index}_leaveType`]: undefined,
            [`entry_${index}_dateFrom`]: undefined,
            [`entry_${index}_dateTo`]: undefined,
            [`entry_${index}_leaveDays`]: undefined,
            [`entry_${index}_split`]: undefined,
            totalCredits: undefined,
          }));
        } else {
          updateEntry(index, { leaveCategory: value });
          setValidationErrors((current) => ({
            ...current,
            [`entry_${index}_leaveCategory`]: undefined,
          }));
        }
      }
    }
    setActiveSelect(null);
  }

  // Handle date range selection from modal
  function onApplyDateRange(startYMD: string, endYMD: string) {
    if (activeDateChoiceIndex === null) return;
    const index = activeDateChoiceIndex;
    const entry = entries[index];
    if (!entry) {
      setActiveDateChoiceIndex(null);
      return;
    }

    const totalDays = calculateLeaveDays(startYMD, endYMD);
    const otherCreditsDeducted = entries.reduce((sum, e, i) => {
      if (i === index) return sum;
      return sum + getEntryCreditsDeducted(e);
    }, 0);
    const availableCreditsForThis = Math.max(0, leaveCreditRemaining - otherCreditsDeducted);

    let nextLeaveType = entry.leaveType;
    let nextPaidDays = entry.paidDays;
    let nextUnpaidDays = entry.unpaidDays;
    let nextReason = entry.reason;

    if (entry.leaveCategory === 'Birthday Leave') {
      const bdayCheck = verifyEmployeeBirthday(startYMD, endYMD, effectiveBirthDate);
      if (!bdayCheck.isVerified) {
        platformAlert(
          'Must Include Birthday',
          bdayCheck.message ||
            `Birthday Leave date range must cover your birthday (${bdayCheck.monthDay || ''}). Please select a date range that includes your birthday.`,
        );
        return;
      }

      if (totalDays === 1) {
        nextLeaveType = 'With Pay';
        nextPaidDays = '1';
        nextUnpaidDays = '0';
        // Auto-populate system grant reason on single day if blank
        if (!entry.reason || entry.reason.trim() === '') {
          nextReason = 'Auto-approved Birthday Leave Grant';
        }
      } else if (totalDays > 1) {
        // Multi-day: employee must be the one to enter the reason
        if (entry.reason === 'Auto-approved Birthday Leave Grant') {
          nextReason = '';
        }
        const otherDays = totalDays - 1;
        if (availableCreditsForThis <= 0) {
          nextLeaveType = 'Both';
          nextPaidDays = '1';
          nextUnpaidDays = String(otherDays);
        } else if (availableCreditsForThis >= otherDays) {
          nextLeaveType = 'With Pay';
          nextPaidDays = String(totalDays);
          nextUnpaidDays = '0';
        } else {
          nextLeaveType = 'Both';
          nextPaidDays = String(1 + availableCreditsForThis);
          nextUnpaidDays = String(otherDays - availableCreditsForThis);
        }
      }
    } else {
      if (entry.leaveType === 'With Pay') {
        nextPaidDays = String(totalDays);
        nextUnpaidDays = '0';
      } else if (entry.leaveType === 'Without Pay') {
        nextPaidDays = '0';
        nextUnpaidDays = String(totalDays);
      } else if (entry.leaveType === 'Both') {
        const safePaid = Math.min(totalDays, availableCreditsForThis);
        nextPaidDays = String(safePaid);
        nextUnpaidDays = String(Math.round((totalDays - safePaid) * 100) / 100);
      }
    }

    updateEntry(index, {
      dateFrom: startYMD,
      dateTo: endYMD,
      leaveType: nextLeaveType,
      paidDays: nextPaidDays,
      unpaidDays: nextUnpaidDays,
      reason: nextReason,
    });

    setValidationErrors((current) => ({
      ...current,
      [`entry_${index}_dateFrom`]: undefined,
      [`entry_${index}_dateTo`]: undefined,
      [`entry_${index}_leaveDays`]: undefined,
      [`entry_${index}_split`]: undefined,
      [`entry_${index}_reason`]: undefined,
      totalCredits: undefined,
    }));
    setActiveDateChoiceIndex(null);
  }

  function validateAllEntries() {
    const nextErrors: Record<string, string | undefined> = {};

    entries.forEach((entry, idx) => {
      const totalDays = calculateLeaveDays(entry.dateFrom, entry.dateTo);
      const breakdown = getLeaveBreakdown(entry.leaveType, totalDays, entry.paidDays, entry.unpaidDays);

      if (!entry.dateFrom) nextErrors[`entry_${idx}_dateFrom`] = 'Required';
      if (!entry.dateTo) nextErrors[`entry_${idx}_dateTo`] = 'Required';
      if (
        entry.dateFrom &&
        entry.dateTo &&
        dateStringToDate(entry.dateTo).getTime() < dateStringToDate(entry.dateFrom).getTime()
      ) {
        nextErrors[`entry_${idx}_dateTo`] = 'Date To cannot be earlier than Date From';
      }
      if (totalDays <= 0) nextErrors[`entry_${idx}_leaveDays`] = 'Required';
      if (!leaveTypeOptions.includes(entry.leaveType)) nextErrors[`entry_${idx}_leaveType`] = 'Required';
      if (!leaveCategoryOptions.includes(entry.leaveCategory)) {
        nextErrors[`entry_${idx}_leaveCategory`] = 'Required';
      }

      // Birthday Leave specific verification
      if (entry.leaveCategory === 'Birthday Leave') {
        const bdayCheck = verifyEmployeeBirthday(entry.dateFrom, entry.dateTo, effectiveBirthDate);
        if (!bdayCheck.isVerified) {
          nextErrors[`entry_${idx}_dateFrom`] =
            bdayCheck.message || 'Must fall on your birthday';
        }
      }

      if (entry.leaveType === 'Both' && totalDays > 0 && !breakdown.isValid) {
        nextErrors[`entry_${idx}_split`] = `Paid and unpaid days must equal ${totalDays.toFixed(2)} day(s).`;
      }
      if (!entry.reason.trim()) nextErrors[`entry_${idx}_reason`] = 'Required';
    });

    if (totalCreditsDeductedAllEntries > leaveCreditRemaining) {
      nextErrors.totalCredits = `Available paid leave is ${leaveCreditRemaining.toFixed(2)} day(s), but requested deduction is ${totalCreditsDeductedAllEntries.toFixed(2)} day(s).`;
    }

    return nextErrors;
  }

  async function executeSubmit() {
    setIsSubmitting(true);
    setSubmitStatus('Submitting leave request(s)...');

    const warningTimer = setTimeout(() => {
      setSubmitStatus((current) =>
        current
          ? `${current} (connection taking longer than expected... please wait)`
          : 'Submitting... (connection taking longer than expected...)',
      );
    }, 12000);

    try {
      if (editingRequest) {
        const targetReqId = editingRequest.request_id || (editingRequest as any).id;
        if (!targetReqId) {
          throw new Error('Request ID is missing.');
        }

        const lockInfo = await withTimeout(
          checkApproverActiveViewing(targetReqId),
          10000,
          'Checking approver status timed out. Please try again.',
        );
        if (lockInfo.isLocked) {
          const msg = `This request is currently being reviewed by your manager/approver (${lockInfo.approverName || 'Manager'}). Editing is temporarily disabled while they are viewing it to prevent data conflicts.`;
          setActiveLockInfo(lockInfo);
          setSubmitStatus(msg);
          setIsSubmitting(false);
          return;
        }

        const firstEntry = entries[0];
        const firstTotalDays = calculateLeaveDays(firstEntry.dateFrom, firstEntry.dateTo);
        const firstBreakdown = getLeaveBreakdown(
          firstEntry.leaveType,
          firstTotalDays,
          firstEntry.paidDays,
          firstEntry.unpaidDays,
        );

        await withTimeout(
          updateMyPendingRequest({
            requestId: targetReqId,
            leaveType: firstEntry.leaveType.trim(),
            leaveCategory: firstEntry.leaveCategory.trim(),
            startDate: firstEntry.dateFrom,
            endDate: firstEntry.dateTo,
            totalDays: firstTotalDays,
            paidDays: firstBreakdown.paidDays,
            unpaidDays: firstBreakdown.unpaidDays,
            reason: firstEntry.reason.trim(),
          }),
          25000,
          'Updating leave request timed out. Please check your network connection.',
        );

        // If user added additional entries while editing, submit them as new requests
        if (entries.length > 1) {
          for (let i = 1; i < entries.length; i++) {
            if (submittedIndices.current.has(i)) continue;
            setSubmitStatus(`Submitting request ${i + 1} of ${entries.length}...`);
            await new Promise((r) => setTimeout(r, 400));
            const ent = entries[i];
            const tDays = calculateLeaveDays(ent.dateFrom, ent.dateTo);
            const bd = getLeaveBreakdown(ent.leaveType, tDays, ent.paidDays, ent.unpaidDays);

            const res = await withTimeout<{ data: any; error: any }>(
              Promise.resolve(
                supabase.rpc('submit_leave_request', {
                  p_leave_type: ent.leaveType.trim(),
                  p_leave_category: ent.leaveCategory.trim(),
                  p_start_date: ent.dateFrom,
                  p_end_date: ent.dateTo,
                  p_paid_days: bd.paidDays,
                  p_unpaid_days: bd.unpaidDays,
                  p_reason: ent.reason.trim(),
                }),
              ),
              25000,
              `Submission for request #${i + 1} timed out. Please check your network connection and try again.`,
            );

            if (res?.error) {
              const isSingleDayBday = ent.leaveCategory === 'Birthday Leave' && tDays === 1;
              if (
                isSingleDayBday &&
                res.error.message?.toLowerCase().includes('insufficient paid leave')
              ) {
                console.warn(
                  'Birthday leave RPC credit check bypassed for auto-approved grant:',
                  res.error.message,
                );
              } else {
                throw new Error(res.error.message);
              }
            }
            submittedIndices.current.add(i);
          }
        }

        setSubmitStatus('Leave request updated successfully.');
        onToast?.({
          tone: 'success',
          title: 'Leave updated',
          message:
            entries.length > 1
              ? 'Your leave request was updated and new requests submitted.'
              : 'Your leave request was updated successfully.',
        });
        await onSubmitted?.();
        return;
      }

      // New submission: loop through all entries
      let autoApprovedBirthdayCount = 0;

      for (let i = 0; i < entries.length; i++) {
        if (submittedIndices.current.has(i)) continue;

        if (entries.length > 1) {
          setSubmitStatus(`Submitting request ${i + 1} of ${entries.length}...`);
        }

        if (i > 0) {
          await new Promise((r) => setTimeout(r, 400));
        }

        const ent = entries[i];
        const tDays = calculateLeaveDays(ent.dateFrom, ent.dateTo);
        const bd = getLeaveBreakdown(ent.leaveType, tDays, ent.paidDays, ent.unpaidDays);
        const isSingleDayBirthday = ent.leaveCategory === 'Birthday Leave' && tDays === 1;

        const res = await withTimeout<{ data: any; error: any }>(
          Promise.resolve(
            supabase.rpc('submit_leave_request', {
              p_leave_type: ent.leaveType.trim(),
              p_leave_category: ent.leaveCategory.trim(),
              p_start_date: ent.dateFrom,
              p_end_date: ent.dateTo,
              p_paid_days: bd.paidDays,
              p_unpaid_days: bd.unpaidDays,
              p_reason: ent.reason.trim(),
            }),
          ),
          25000,
          `Submission for request #${i + 1} timed out. Please check your network connection and try again.`,
        );

        if (res?.error) {
          if (
            isSingleDayBirthday &&
            res.error.message?.toLowerCase().includes('insufficient paid leave')
          ) {
            console.warn(
              'Birthday leave RPC credit check bypassed for auto-approved grant:',
              res.error.message,
            );
          } else {
            throw new Error(res.error.message);
          }
        }

        const newReqId = res?.data ? String(res.data) : `bday_leave_${Date.now()}`;
        let bdayRequestRecord: MyRequest | undefined;

        // If single-day Birthday Leave, sync to local cache as auto-approved by HYG Portal System
        if (isSingleDayBirthday) {
          autoApprovedBirthdayCount++;
          bdayRequestRecord = {
            request_id: newReqId,
            request_type_code: 'leave',
            request_type_name: 'Leave',
            status: 'approved',
            submitted_at: new Date().toISOString(),
            final_approved_at: new Date().toISOString(),
            rejected_at: null,
            rejected_reason: null,
            date_from: ent.dateFrom,
            date_to: ent.dateTo,
            start_date: ent.dateFrom,
            end_date: ent.dateTo,
            time_from: null,
            time_to: null,
            total_hours: null,
            leave_type: 'With Pay',
            leave_category: 'Birthday Leave',
            total_days: 1,
            paid_days: 1,
            unpaid_days: 0,
            reason: ent.reason.trim() || 'Auto-approved Birthday Leave Grant',
            approval_summary: [
              {
                step_order: 1,
                required_level: 1,
                status: 'approved',
                acted_at: new Date().toISOString(),
                remarks: 'System auto-approved Birthday Leave Grant',
                skipped_reason: null,
                approver_name: 'HYG Portal System',
                approver_position_name: 'Automated HR Perk System',
                approver_employee_no: 'SYS-001',
              },
            ],
          };
          await mergeIntoMyRequestsCache(bdayRequestRecord);
        }

        if (ent.leaveCategory === 'Birthday Leave') {
          const identity = username || '';
          if (identity) {
            await markBirthdayLeaveGrantedForYear(identity, bdayRequestRecord);
          }
          setHasAppliedBirthdayLeaveThisYear(true);
        }

        submittedIndices.current.add(i);
      }

      setSubmitStatus(`Submitted ${entries.length} leave request(s).`);

      if (autoApprovedBirthdayCount > 0 && entries.length === 1) {
        onToast?.({
          tone: 'success',
          title: 'Birthday Leave Granted! 🎂',
          message: 'Your 1-day Birthday Leave was auto-approved with pay by HYG Portal System.',
        });
      } else {
        onToast?.({
          tone: 'success',
          title: 'Leave submitted',
          message:
            entries.length > 1
              ? `${entries.length} leave requests submitted (${autoApprovedBirthdayCount} auto-approved birthday grant).`
              : 'Your leave request was sent for approval.',
        });
      }

      await onSubmitted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit leave request.';
      setSubmitStatus(`Failed: ${message}`);
      setSubmissionErrorModal(message);
      onToast?.({
        tone: 'error',
        title: 'Leave failed',
        message,
      });
    } finally {
      clearTimeout(warningTimer);
      setIsSubmitting(false);
    }
  }

  function submit() {
    if (isSubmitting) {
      return;
    }

    const nextErrors = validateAllEntries();
    setValidationErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      const firstErrorIndex = entries.findIndex((_, idx) =>
        Object.keys(nextErrors).some((k) => k.startsWith(`entry_${idx}_`)),
      );
      if (firstErrorIndex !== -1) {
        scrollToEntryCard(firstErrorIndex);
      } else {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
      setSubmitStatus(
        nextErrors.totalCredits || 'Please complete all required fields on each request card.',
      );
      return;
    }

    const isEdit = Boolean(editingRequest);
    const actionText = isEdit ? 'Update' : 'Submit';
    const confirmTitle = isEdit ? 'Confirm Leave Update' : 'Confirm Leave Submission';
    const firstEntry = entries[0];
    const isSingleDayBirthday =
      entries.length === 1 &&
      firstEntry.leaveCategory === 'Birthday Leave' &&
      calculateLeaveDays(firstEntry.dateFrom, firstEntry.dateTo) === 1;

    let confirmMsg: string;
    if (isEdit) {
      confirmMsg = 'Are you sure you want to update this leave request?';
    } else if (isSingleDayBirthday) {
      confirmMsg =
        'Your 1-day Birthday Leave will be auto-approved with pay by HYG Portal System without deducting leave credits. Proceed?';
    } else if (entries.length > 1) {
      confirmMsg = `Are you sure you want to submit these ${entries.length} leave requests?`;
    } else {
      confirmMsg = `Are you sure you want to submit this request for ${calculateLeaveDays(
        firstEntry.dateFrom,
        firstEntry.dateTo,
      )} day(s) of ${firstEntry.leaveType || 'leave'}?`;
    }

    platformAlert(confirmTitle, confirmMsg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: actionText,
        onPress: () => {
          executeSubmit();
        },
      },
    ]);
  }

  // Calculate disabled leave types for active select sheet
  const activeEntry = activeSelect !== null ? entries[activeSelect.index] : null;
  const activeEntryDays = activeEntry
    ? calculateLeaveDays(activeEntry.dateFrom, activeEntry.dateTo)
    : 0;
  const otherCreditsDeducted = entries.reduce((sum, e, i) => {
    if (activeSelect && i === activeSelect.index) return sum;
    return sum + getEntryCreditsDeducted(e);
  }, 0);
  const availableForActiveEntry = Math.max(0, leaveCreditRemaining - otherCreditsDeducted);

  const isEditingThisBirthdayRequest = Boolean(
    editingRequest && editingRequest.leave_category === 'Birthday Leave',
  );
  const hasBirthdayLeaveInOtherCard = entries.some(
    (e, i) => (!activeSelect || i !== activeSelect.index) && e.leaveCategory === 'Birthday Leave',
  );
  const isBirthdayLeaveDisabled =
    !isEditingThisBirthdayRequest &&
    (hasAppliedBirthdayLeaveThisYear || hasBirthdayLeaveInOtherCard);
  const disabledLeaveCategoriesForActiveEntry = isBirthdayLeaveDisabled ? ['Birthday Leave'] : [];

  const disabledLeaveTypesForActiveEntry =
    activeEntry?.leaveCategory === 'Birthday Leave'
      ? activeEntryDays === 1
        ? ['Without Pay', 'Both'] // 1-day Birthday Leave is locked to With Pay
        : availableForActiveEntry <= 0
        ? ['With Pay', 'Without Pay'] // If 0 credits for extra days, must be Both
        : ['Without Pay'] // Birthday is always granted with pay, so only With Pay and Both apply
      : getDisabledLeaveTypes(activeEntryDays, availableForActiveEntry);

  const selectSheet =
    activeSelect && activeEntry
      ? getSelectSheet(
          activeSelect.field,
          activeEntry.leaveType,
          activeEntry.leaveCategory,
          disabledLeaveTypesForActiveEntry,
          disabledLeaveCategoriesForActiveEntry,
        )
      : null;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={name}
        username={username}
        photoUrl={photoUrl}
        notificationCount={notificationCount}
        onBackHome={onBack ? () => confirmDiscard(onBack) : undefined}
        backTitle="Request Leave"
        backAccessory="info"
        onBackAccessory={() => setShowLeaveNotes(true)}
        onMessages={onAssistant ? () => confirmDiscard(onAssistant) : undefined}
        onNotifications={onNotifications ? () => confirmDiscard(onNotifications) : undefined}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.keyboardAvoider}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Available Paid Leave card */}
          <View style={styles.creditPanel}>
            <View style={styles.creditHeader}>
              <View>
                <Text style={styles.creditLabel}>Available Paid Leave</Text>
                <Text style={styles.creditValue}>{leaveCreditRemaining.toFixed(2)} days</Text>
              </View>
              <View style={styles.creditBadge}>
                <WalletCards size={17} color={colors.brand.ink} strokeWidth={2.6} />
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${creditUsedPercent}%` }]} />
            </View>
            <Text style={styles.creditHint}>
              {entries.length > 1 ? 'These requests use ' : 'This request uses '}
              {totalPaidDaysAllEntries.toFixed(2)} paid day(s){' '}
              {hasBirthdayLeaveEntry
                ? `(${totalCreditsDeductedAllEntries.toFixed(2)} deducted from leave credits) `
                : ''}
              and {totalUnpaidDaysAllEntries.toFixed(2)} unpaid day(s).
            </Text>
          </View>

          {/* Over-allocation Error Banner */}
          {validationErrors.totalCredits ? (
            <View style={styles.totalCreditsErrorBox}>
              <AlertTriangle size={15} color={colors.semantic.danger} strokeWidth={2.4} />
              <Text style={styles.totalCreditsErrorText}>{validationErrors.totalCredits}</Text>
            </View>
          ) : null}

          {/* Entry Cards matching ApplyEsarfScreen multiple entry pattern */}
          {entries.map((entry, index) => {
            const actualIndex = index;
            const badgeNumber = actualIndex + 1;
            const totalDays = calculateLeaveDays(entry.dateFrom, entry.dateTo);
            const daysDisplayText =
              !entry.dateFrom || !entry.dateTo || totalDays <= 0 ? 'NaN' : totalDays.toFixed(2);
            const dateDisplayText = formatEsarfDateRange(entry.dateFrom, entry.dateTo);
            const breakdown = getLeaveBreakdown(
              entry.leaveType,
              totalDays,
              entry.paidDays,
              entry.unpaidDays,
            );
            const isBirthday = entry.leaveCategory === 'Birthday Leave';
            const creditsDeductedForThisEntry = getEntryCreditsDeducted(entry);

            return (
              <View
                key={entry.id}
                style={styles.entryCard}
                onLayout={(event) => {
                  const y = event.nativeEvent.layout.y;
                  entryCardLayouts.current[actualIndex] = y;
                  if (pendingScrollToIndex.current === actualIndex) {
                    pendingScrollToIndex.current = null;
                    scrollRef.current?.scrollTo({
                      y: Math.max(0, y - 16),
                      animated: true,
                    });
                  }
                }}
              >
                {/* Card Header with badge & delete button */}
                <View style={styles.entryCardHeader}>
                  <View style={[styles.entryBadge, isBirthday ? styles.entryBadgeBirthday : null]}>
                    {isBirthday ? (
                      <Cake size={14} color="#854d0e" strokeWidth={2.6} />
                    ) : (
                      <Text style={styles.entryBadgeText}>{badgeNumber}</Text>
                    )}
                  </View>
                  <Text style={styles.entryCardTitle}>
                    {isBirthday ? 'Birthday Leave Information' : 'Leave Request Information'}
                  </Text>
                  {entries.length > 1 ? (
                    <Pressable
                      style={styles.deleteEntryButton}
                      onPress={() => removeEntry(actualIndex)}
                      hitSlop={6}
                      accessibilityLabel={`Delete request #${badgeNumber}`}
                    >
                      <Trash2 size={16} color="#ef4444" strokeWidth={2.2} />
                    </Pressable>
                  ) : null}
                </View>

                {/* Birthday Leave Festive Banner */}
                {isBirthday && totalDays === 1 ? (
                  <View style={styles.birthdayNoticeBanner}>
                    <View style={styles.birthdayIconBox}>
                      <Cake size={18} color="#b45309" strokeWidth={2.4} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={styles.birthdayNoticeTitle}>Auto-Approved Birthday Grant</Text>
                        <Sparkles size={13} color="#eab308" />
                      </View>
                      <Text style={styles.birthdayNoticeSubtitle}>
                        Verified birthday! Auto-approved by HYG Portal System with pay. 0 leave
                        credits deducted.
                      </Text>
                    </View>
                  </View>
                ) : isBirthday && totalDays > 1 ? (
                  <View style={styles.birthdayMultiNoticeBanner}>
                    <View style={styles.birthdayMultiIconBox}>
                      <CalendarDays size={16} color="#b45309" strokeWidth={2.4} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.birthdayMultiNoticeTitle}>Multi-Day Birthday Leave</Text>
                      <Text style={styles.birthdayMultiNoticeSubtitle}>
                        1 day is granted with pay (0 credits deducted). The other{' '}
                        {(totalDays - 1).toFixed(2)} day(s) require approver review and deduct{' '}
                        {creditsDeductedForThisEntry.toFixed(2)} credit(s).
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Row 1: Leave Type & Leave Category */}
                <View style={styles.underlineRow}>
                  {/* Leave Type */}
                  <View style={styles.underlineField}>
                    <Pressable
                      disabled={isBirthday && totalDays === 1}
                      style={[
                        styles.underlineBox,
                        validationErrors[`entry_${actualIndex}_leaveType`]
                          ? styles.underlineBoxError
                          : null,
                        isBirthday && totalDays === 1 ? styles.underlineBoxDisabled : null,
                      ]}
                      onPress={() => setActiveSelect({ index: actualIndex, field: 'leave_type' })}
                    >
                      <Text
                        style={[
                          styles.underlineText,
                          !entry.leaveType ? styles.underlineTextPlaceholder : null,
                        ]}
                        numberOfLines={1}
                      >
                        {entry.leaveType || 'Select leave type'}
                      </Text>
                      {isBirthday && totalDays === 1 ? (
                        <Check size={16} color="#16a34a" strokeWidth={2.6} />
                      ) : (
                        <ChevronDown size={16} color="#64748b" strokeWidth={2.4} />
                      )}
                    </Pressable>
                    <Text style={styles.underlineLabel}>Leave Type</Text>
                    {validationErrors[`entry_${actualIndex}_leaveType`] ? (
                      <Text style={styles.fieldError}>
                        {validationErrors[`entry_${actualIndex}_leaveType`]}
                      </Text>
                    ) : null}
                  </View>

                  {/* Leave Category */}
                  <View style={styles.underlineField}>
                    <Pressable
                      style={[
                        styles.underlineBox,
                        validationErrors[`entry_${actualIndex}_leaveCategory`]
                          ? styles.underlineBoxError
                          : null,
                      ]}
                      onPress={() =>
                        setActiveSelect({ index: actualIndex, field: 'leave_category' })
                      }
                    >
                      <Text
                        style={[
                          styles.underlineText,
                          !entry.leaveCategory ? styles.underlineTextPlaceholder : null,
                        ]}
                        numberOfLines={1}
                      >
                        {entry.leaveCategory || 'Select leave category'}
                      </Text>
                      <ChevronDown size={16} color="#64748b" strokeWidth={2.4} />
                    </Pressable>
                    <Text style={styles.underlineLabel}>Leave Category</Text>
                    {validationErrors[`entry_${actualIndex}_leaveCategory`] ? (
                      <Text style={styles.fieldError}>
                        {validationErrors[`entry_${actualIndex}_leaveCategory`]}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* If Leave Type === 'Both' and not Birthday Leave, show breakdown card */}
                {entry.leaveType === 'Both' && !isBirthday ? (
                  <View style={styles.bothFieldsSection}>
                    <View
                      style={[
                        styles.summaryBox,
                        validationErrors[`entry_${actualIndex}_split`] ? styles.inputError : null,
                      ]}
                    >
                      <Text style={styles.summaryText}>
                        With Pay {breakdown.paidDays.toFixed(2)}d | Without Pay{' '}
                        {breakdown.unpaidDays.toFixed(2)}d
                      </Text>
                      <Text style={styles.summaryHint}>
                        With Pay deducts credits after final approval.
                      </Text>
                    </View>
                    {validationErrors[`entry_${actualIndex}_split`] ? (
                      <Text style={styles.fieldError}>
                        {validationErrors[`entry_${actualIndex}_split`]}
                      </Text>
                    ) : null}
                  </View>
                ) : validationErrors[`entry_${actualIndex}_split`] ? (
                  <Text style={styles.fieldError}>
                    {validationErrors[`entry_${actualIndex}_split`]}
                  </Text>
                ) : null}

                {/* Row 2: Total No of Days & Date From-To */}
                <View style={styles.underlineRow}>
                  {/* Total No of Days */}
                  <View style={styles.underlineField}>
                    <View
                      style={[
                        styles.underlineBox,
                        validationErrors[`entry_${actualIndex}_leaveDays`]
                          ? styles.underlineBoxError
                          : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.underlineText,
                          daysDisplayText === 'NaN' ? styles.underlineTextPlaceholder : null,
                        ]}
                        numberOfLines={1}
                      >
                        {daysDisplayText}
                      </Text>
                    </View>
                    <Text style={styles.underlineLabel}>Total No of Days</Text>
                    {validationErrors[`entry_${actualIndex}_leaveDays`] ? (
                      <Text style={styles.fieldError}>
                        {validationErrors[`entry_${actualIndex}_leaveDays`]}
                      </Text>
                    ) : null}
                  </View>

                  {/* Date From-To */}
                  <View style={styles.underlineField}>
                    <Pressable
                      style={[
                        styles.underlineBox,
                        validationErrors[`entry_${actualIndex}_dateFrom`] ||
                        validationErrors[`entry_${actualIndex}_dateTo`]
                          ? styles.underlineBoxError
                          : null,
                      ]}
                      onPress={() => setActiveDateChoiceIndex(actualIndex)}
                    >
                      <Text
                        style={[
                          styles.underlineText,
                          !entry.dateFrom ? styles.underlineTextPlaceholder : null,
                        ]}
                        numberOfLines={1}
                      >
                        {dateDisplayText}
                      </Text>
                      <CalendarDays size={16} color="#64748b" strokeWidth={2} />
                    </Pressable>
                    <Text style={styles.underlineLabel}>
                      {isBirthday ? 'Birthday Date From-To' : 'Date From-To'}
                    </Text>
                    {validationErrors[`entry_${actualIndex}_dateFrom`] ? (
                      <Text style={styles.fieldError}>
                        {validationErrors[`entry_${actualIndex}_dateFrom`]}
                      </Text>
                    ) : validationErrors[`entry_${actualIndex}_dateTo`] ? (
                      <Text style={styles.fieldError}>
                        {validationErrors[`entry_${actualIndex}_dateTo`]}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Row 3: Reason Text Area */}
                <View style={styles.reasonFieldWrap}>
                  <Text style={styles.reasonFieldLabel}>Reason</Text>
                  <TextInput
                    ref={(r) => {
                      reasonInputRefs.current[actualIndex] = r;
                    }}
                    value={entry.reason}
                    onChangeText={(value) => {
                      updateEntry(actualIndex, { reason: value });
                      setValidationErrors((current) => ({
                        ...current,
                        [`entry_${actualIndex}_reason`]: undefined,
                      }));
                    }}
                    placeholder={
                      isBirthday
                        ? totalDays > 1
                          ? 'Enter reason for leave...'
                          : 'Auto-approved Birthday Leave Grant'
                        : 'Enter reason for leave...'
                    }
                    placeholderTextColor="#94a3b8"
                    multiline
                    textAlignVertical="top"
                    style={[
                      styles.reasonTextArea,
                      validationErrors[`entry_${actualIndex}_reason`] ? styles.inputError : null,
                    ]}
                  />
                  {validationErrors[`entry_${actualIndex}_reason`] ? (
                    <Text style={styles.fieldError}>
                      {validationErrors[`entry_${actualIndex}_reason`]}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {/* Add Request Button directly below the entry cards */}
          <Pressable
            style={({ pressed }) => [
              styles.addEntryBelowButton,
              pressed ? styles.addEntryBelowButtonPressed : null,
            ]}
            onPress={addEntry}
            hitSlop={6}
            accessibilityLabel="Add another request entry"
          >
            <View style={styles.addEntryBelowIcon}>
              <Plus size={16} color="#0f172a" strokeWidth={3} />
            </View>
            <Text style={styles.addEntryBelowText}>Add Request</Text>
          </Pressable>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={() => confirmDiscard(onBack)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={isSubmitting}
              style={[styles.submitButton, isSubmitting ? styles.submitButtonDisabled : null]}
              onPress={submit}
            >
              <Text style={styles.submitText}>
                {isSubmitting
                  ? 'Submitting...'
                  : editingRequest
                  ? 'Update Request'
                  : entries.length > 1
                  ? `Submit ${entries.length} Requests`
                  : 'Submit Request'}
              </Text>
            </Pressable>
          </View>

          {submissionErrorModal ? (
            <Modal
              transparent
              animationType="fade"
              visible={Boolean(submissionErrorModal)}
              onRequestClose={() => setSubmissionErrorModal(null)}
            >
              <View style={styles.errorModalBackdrop}>
                <View style={styles.errorModalCard}>
                  <View style={styles.errorModalIconContainer}>
                    <AlertTriangle size={32} color="#ef4444" strokeWidth={2.4} />
                  </View>

                  <Text style={styles.errorModalTitle}>
                    {submissionErrorModal.toLowerCase().includes('timed out')
                      ? 'Submission Timed Out'
                      : 'Submission Failed'}
                  </Text>

                  <Text style={styles.errorModalMessage}>{submissionErrorModal}</Text>

                  <View style={styles.errorModalActions}>
                    <Pressable
                      style={styles.errorModalDismissBtn}
                      onPress={() => {
                        setSubmissionErrorModal(null);
                      }}
                    >
                      <Text style={styles.errorModalDismissText}>Close</Text>
                    </Pressable>

                    <Pressable
                      style={styles.errorModalReloadBtn}
                      onPress={() => {
                        setSubmissionErrorModal(null);
                        setIsSubmitting(false);
                        setSubmitStatus('');
                        if (Platform.OS === 'web' && typeof window !== 'undefined') {
                          window.location.reload();
                        }
                      }}
                    >
                      <RotateCcw size={15} color="#0f172a" />
                      <Text style={styles.errorModalReloadText}>Reset / Reload</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Date Range Modal */}
      {activeDateChoiceIndex !== null ? (
        <DateRangePickerModal
          key={`leave-date-range-${activeDateChoiceIndex}-${entries[activeDateChoiceIndex]?.id || activeDateChoiceIndex}`}
          visible={true}
          allowFutureDates
          initialStartDate={entries[activeDateChoiceIndex]?.dateFrom || ''}
          initialEndDate={entries[activeDateChoiceIndex]?.dateTo || ''}
          onApply={onApplyDateRange}
          onClose={() => setActiveDateChoiceIndex(null)}
        />
      ) : null}

      {/* Select Option Modal */}
      {selectSheet ? (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setActiveSelect(null)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={styles.modalDismissArea} onPress={() => setActiveSelect(null)} />
            <View style={styles.optionSheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{selectSheet.title}</Text>
              {selectSheet.options.map((option) => {
                const selected = option === selectSheet.value;
                const disabled = selectSheet.disabledOptions.includes(option);
                return (
                  <Pressable
                    key={option}
                    disabled={disabled}
                    style={[
                      styles.optionRow,
                      selected ? styles.optionRowActive : null,
                      disabled ? styles.optionRowDisabled : null,
                    ]}
                    onPress={() => chooseSelectOption(option)}
                  >
                    <View style={styles.optionRowLeft}>
                      <Text
                        style={[
                          styles.optionText,
                          selected ? styles.optionTextActive : null,
                          disabled ? styles.optionTextDisabled : null,
                        ]}
                      >
                        {option}
                      </Text>
                      {disabled && option === 'Birthday Leave' ? (
                        <Text style={styles.optionDisabledHint}>
                          {hasAppliedBirthdayLeaveThisYear
                            ? 'Already applied for this year'
                            : 'Selected on another card'}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <Check size={18} color={colors.brand.goldStrong} strokeWidth={3} />
                    ) : null}
                  </Pressable>
                );
              })}
              <Pressable style={styles.sheetCancelButton} onPress={() => setActiveSelect(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Leave Guidelines / Information Notes Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={showLeaveNotes}
        onRequestClose={() => setShowLeaveNotes(false)}
      >
        <View style={styles.notesBackdrop}>
          <View style={styles.notesPanel}>
            <View style={styles.notesHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.notesTitle}>Leave Guidelines</Text>
                <Text style={styles.notesSubtitle}>Important notes for filing leave requests.</Text>
              </View>
              <Pressable
                style={styles.notesCloseButton}
                onPress={() => setShowLeaveNotes(false)}
                hitSlop={8}
              >
                <X size={18} color={colors.text} strokeWidth={2.6} />
              </Pressable>
            </View>

            <ScrollView style={styles.notesListScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.notesList}>
                {leaveGuidelinesNotes.map((note, index) => (
                  <View key={note.title} style={styles.timelineNoteRow}>
                    <View style={styles.timelineMarkerColumn}>
                      <View style={styles.timelineDot} />
                      {index < leaveGuidelinesNotes.length - 1 ? (
                        <View style={styles.timelineLine} />
                      ) : null}
                    </View>
                    <View style={styles.timelineNoteContent}>
                      <Text style={styles.timelineNoteTitle}>{note.title}</Text>
                      <Text style={styles.timelineNoteText}>{note.description}</Text>
                    </View>
                  </View>
                ))}
                <View style={styles.deadlineNote}>
                  <CalendarDays size={16} color="#b45309" strokeWidth={2.6} />
                  <Text style={styles.deadlineNoteText}>
                    Approved leave requests must be submitted on or before the{' '}
                    <Text style={styles.deadlineStrong}>5th</Text> and{' '}
                    <Text style={styles.deadlineStrong}>20th</Text> cutoffs for payroll processing.
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ActiveReviewLockModal
        visible={Boolean(activeLockInfo)}
        approverName={activeLockInfo?.approverName}
        approverPosition={activeLockInfo?.approverPosition}
        onClose={() => setActiveLockInfo(null)}
      />
    </View>
  );
};

const leaveGuidelinesNotes = [
  {
    title: 'Birthday Leave Grant',
    description:
      'Employees are entitled to 1 day Birthday Leave with pay on their birthday without deducting leave credits. Single-day Birthday Leave is auto-approved by HYG Portal System. Multi-day leaves require approver review.',
  },
  {
    title: 'Filing in Advance',
    description:
      'Submit planned leaves (e.g. Vacation, Birthday) at least 3–5 days prior. For sick or emergency leaves, notify your supervisor immediately and submit upon return.',
  },
  {
    title: 'Paid vs. Unpaid Leaves',
    description:
      'With Pay uses your accrued leave balance and is deducted upon approver approval. Without Pay applies if credits are exhausted. Both allows splitting duration between paid and unpaid days.',
  },
  {
    title: 'Working Days & Rest Days',
    description:
      'Selected date ranges should only cover regular working days. Rest days (scheduled day offs) and official non-working holidays must be excluded.',
  },
  {
    title: 'Review & Approval',
    description:
      'All standard requests require supervisor/manager review. Editing is temporarily disabled while an approver is actively reviewing to prevent data conflicts.',
  },
  {
    title: 'Medical Certificate',
    description:
      'For sick leave of 3 or more consecutive days, a valid physician’s medical certificate must be submitted to HR.',
  },
];

export default RequestLeave;

function getSelectSheet(
  field: 'leave_type' | 'leave_category',
  leaveType: string,
  leaveCategory: string,
  disabledLeaveTypes: string[],
  disabledLeaveCategories: string[] = [],
) {
  if (field === 'leave_type') {
    return {
      title: 'Select leave type',
      value: leaveType,
      options: leaveTypeOptions,
      disabledOptions: disabledLeaveTypes,
    };
  }
  if (field === 'leave_category') {
    return {
      title: 'Select leave category',
      value: leaveCategory,
      options: leaveCategoryOptions,
      disabledOptions: disabledLeaveCategories,
    };
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  keyboardAvoider: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
  },
  scroll: {
    flexGrow: 1,
    width: '100%',
    maxWidth: '100%',
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  creditPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  creditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  creditLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  creditValue: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: fontWeights.heavy,
  },
  creditBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.brand.goldStrong,
  },
  creditHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  totalCreditsErrorBox: {
    backgroundColor: '#fff7f7',
    borderWidth: 1,
    borderColor: colors.semantic.danger,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  totalCreditsErrorText: {
    flex: 1,
    color: colors.semantic.danger,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
  },
  entryCard: {
    width: '100%',
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  entryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.md,
  },
  entryBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#eab308',
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryBadgeBirthday: {
    backgroundColor: '#fef08a',
    borderWidth: 1,
    borderColor: '#eab308',
  },
  entryBadgeText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: fontWeights.heavy,
  },
  entryCardTitle: {
    flex: 1,
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
  },
  deleteEntryButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fde047',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  birthdayIconBox: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#fef08a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayNoticeTitle: {
    color: '#854d0e',
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    marginBottom: 2,
  },
  birthdayNoticeSubtitle: {
    color: '#a16207',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
  },
  birthdayMultiNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  birthdayMultiIconBox: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayMultiNoticeTitle: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    marginBottom: 2,
  },
  birthdayMultiNoticeSubtitle: {
    color: '#b45309',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
  },
  underlineRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    width: '100%',
    maxWidth: '100%',
  },
  underlineField: {
    flex: 1,
    minWidth: 0,
  },
  underlineBox: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 6,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  underlineBoxDisabled: {
    backgroundColor: '#f8fafc',
    borderBottomColor: '#e2e8f0',
  },
  underlineBoxError: {
    borderBottomColor: colors.semantic.danger,
  },
  underlineText: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
  underlineTextPlaceholder: {
    color: '#94a3b8',
    fontWeight: 'normal',
  },
  underlineInput: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: fontWeights.bold,
    padding: 0,
    margin: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as any) : {}),
  },
  underlineLabel: {
    color: '#334155',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    marginTop: 4,
  },
  bothFieldsSection: {
    marginBottom: spacing.xs,
  },
  reasonFieldWrap: {
    width: '100%',
    maxWidth: '100%',
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  reasonFieldLabel: {
    color: '#334155',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    marginBottom: 4,
  },
  reasonTextArea: {
    width: '100%',
    maxWidth: '100%',
    minHeight: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 'normal',
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as any) : {}),
  },
  inputError: {
    borderColor: colors.semantic.danger,
    backgroundColor: '#fff7f7',
  },
  fieldError: {
    color: colors.semantic.danger,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
    marginTop: 3,
  },
  summaryBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    padding: spacing.md,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  summaryText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  summaryHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  addEntryBelowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#eab308',
    backgroundColor: 'rgba(234, 179, 8, 0.08)',
    marginTop: 4,
    marginBottom: spacing.md,
  },
  addEntryBelowButtonPressed: {
    backgroundColor: 'rgba(234, 179, 8, 0.18)',
    transform: [{ scale: 0.99 }],
  },
  addEntryBelowIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#eab308',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEntryBelowText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
  submitButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.68,
  },
  submitText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.44)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  optionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
    marginBottom: spacing.xs,
  },
  optionRow: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionRowLeft: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  optionDisabledHint: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    fontWeight: fontWeights.medium,
    marginTop: 2,
  },
  optionRowActive: {
    backgroundColor: '#fffbeb',
    borderColor: 'rgba(234, 179, 8, 0.4)',
  },
  optionRowDisabled: {
    opacity: 0.45,
  },
  optionText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  optionTextActive: {
    color: colors.brand.ink,
  },
  optionTextDisabled: {
    color: colors.muted,
  },
  sheetCancelButton: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  errorModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  errorModalIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorModalTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  errorModalMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  errorModalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  errorModalDismissBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorModalDismissText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  errorModalReloadBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: colors.brand.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  errorModalReloadText: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: colors.brand.ink,
  },
  notesBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  notesPanel: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  notesTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: fontWeights.heavy,
  },
  notesSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  notesCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesListScroll: {
    maxHeight: 480,
  },
  notesList: {
    gap: 0,
    paddingTop: 4,
  },
  timelineNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
  },
  timelineMarkerColumn: {
    width: 18,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginRight: 8,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.brand.goldStrong,
    backgroundColor: colors.surface,
    marginTop: 5,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: '#e2e8f0',
    marginTop: 3,
  },
  timelineNoteContent: {
    flex: 1,
    paddingBottom: 14,
  },
  timelineNoteTitle: {
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    marginBottom: 2,
  },
  timelineNoteText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
  },
  deadlineNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  deadlineNoteText: {
    flex: 1,
    color: '#b45309',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.medium,
  },
  deadlineStrong: {
    fontWeight: fontWeights.heavy,
  },
});
