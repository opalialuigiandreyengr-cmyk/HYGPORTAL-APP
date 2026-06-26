import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
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
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ListChecks,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { WebNativeDateInput } from '../components/WebNativeDateInput';
import { dayOffOptions, payrollClassOptions, scheduleOptions } from '../constants/requestOptions';
import { supabase } from '../lib/supabase';
import type { AssistantDraft } from '../services/assistant';
import { loadMyFlexibleSchedule } from '../services/team';
import { colors, fontWeights, radius, spacing } from '../theme';
import type { RequestTypeCode } from '../types/domain';
import { calculateRequestHours } from '../utils/requestCalculations';
import { dateStringToDate, formatDateInput, formatTimeDisplay, formatTimeInput, timeStringToDate } from '../utils/dateTime';

type ValidationKey =
  | 'schedule'
  | 'dayOff'
  | 'payrollClass'
  | 'transactions'
  | 'dateFrom'
  | 'dateTo'
  | 'timeFrom'
  | 'timeTo'
  | 'totalHours'
  | 'reason';

type SectionKey = 'request' | 'transactions' | 'datetime';

const transactionOptions = [
  { key: 'ut', label: 'Undertime (UT)', requestType: 'overtime' },
  { key: 'ot', label: 'Overtime (OT)', requestType: 'overtime' },
  { key: 'fio', label: 'Failure to Punch In/Out (FIO)', requestType: 'overtime' },
  { key: 'ob', label: 'Official Business (OB)', requestType: 'overtime' },
  { key: 'offset', label: 'Offset', requestType: 'offset_earn' },
  { key: 'use_offset', label: 'Use Offset', requestType: 'use_offset' },
] satisfies { key: string; label: string; requestType: RequestTypeCode }[];

const exclusiveTransactionGroups = [
  ['ut', 'ot'],
  ['offset', 'use_offset'],
  ['ot', 'offset', 'use_offset'],
  ['ut', 'offset', 'use_offset'],
];
const NO_SCHEDULE_LABEL = 'No schedule';
const NO_DAY_OFF_LABEL = 'No day off';

export function ApplyEsarfScreen({
  name,
  username,
  photoUrl,
  offsetBalance = 0,
  profilePayrollClass,
  profileSchedule,
  profileDayOff,
  profileDepartmentName,
  profileStoreName,
  initialDraft,
  onAssistant,
  onBack,
  onSubmitted,
  onToast,
  notificationCount,
  onNotifications,
}: {
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  offsetBalance?: number;
  profilePayrollClass?: string | null;
  profileSchedule?: string | null;
  profileDayOff?: string | null;
  profileDepartmentName?: string | null;
  profileStoreName?: string | null;
  initialDraft?: Extract<AssistantDraft, { intent: 'draft_esarf_request' }> | null;
  onAssistant?: () => void;
  onBack: () => void;
  onSubmitted?: () => void | Promise<void>;
  onToast?: (toast: { tone: 'success' | 'error' | 'warning'; title: string; message: string }) => void;
  notificationCount?: number;
  onNotifications?: () => void;
}) {
  const isOperationsDepartment = normalizeDepartmentName(profileDepartmentName).includes('operation');
  const operationsScopeLabel = isOperationsDepartment
    ? formatOperationsScopeLabel(profileDepartmentName, profileStoreName)
    : '';
  const fixedSchedule = profileSchedule?.trim() || NO_SCHEDULE_LABEL;
  const fixedDayOff = profileDayOff?.trim() || NO_DAY_OFF_LABEL;
  const initialSchedule = initialDraft?.fields.schedule ?? fixedSchedule;
  const initialDayOff = initialDraft?.fields.dayOff ?? fixedDayOff;
  const initialPayrollClass = initialDraft?.fields.payrollClass ?? profilePayrollClass ?? 'Select payroll class';
  const initialTransactions = initialDraft?.fields.transactions ?? [];
  const initialDateFrom = initialDraft?.fields.dateFrom ?? '';
  const initialDateTo = initialDraft?.fields.dateTo ?? initialDateFrom;
  const initialTimeFrom = initialDraft?.fields.timeFrom ?? '';
  const initialTimeTo = initialDraft?.fields.timeTo ?? '';
  const initialReason = initialDraft?.fields.reason ?? '';
  const [schedule, setSchedule] = useState(initialSchedule);
  const [dayOff, setDayOff] = useState(initialDayOff);
  const [payrollClass, setPayrollClass] = useState(initialPayrollClass);
  const [transactions, setTransactions] = useState<string[]>(initialTransactions);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [timeFrom, setTimeFrom] = useState(initialTimeFrom);
  const [timeTo, setTimeTo] = useState(initialTimeTo);
  const [reason, setReason] = useState(initialReason);
  const [activePicker, setActivePicker] = useState<'date_from' | 'date_to' | 'time_from' | 'time_to' | null>(null);
  const [activeSelect, setActiveSelect] = useState<'schedule' | 'day_off' | 'payroll_class' | null>(null);
  const [showSubmissionNotes, setShowSubmissionNotes] = useState(false);
  const [showReasonComposer, setShowReasonComposer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [validationErrors, setValidationErrors] = useState<Partial<Record<ValidationKey, string>>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const scrollRef = useRef<ScrollView | null>(null);
  const reasonComposerInputRef = useRef<TextInput | null>(null);
  const reasonFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionY = useRef<Record<SectionKey, number>>({ request: 0, transactions: 0, datetime: 0 });

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshFlexibleSchedule() {
      if (!dateFrom) {
        setSchedule(isOperationsDepartment ? NO_SCHEDULE_LABEL : fixedSchedule);
        setDayOff(isOperationsDepartment ? NO_DAY_OFF_LABEL : fixedDayOff);
        setScheduleStatus(isOperationsDepartment ? 'Select an ESARF date to load your My Team schedule.' : '');
        setValidationErrors((current) => ({ ...current, schedule: undefined, dayOff: undefined, totalHours: undefined }));
        return;
      }

      setScheduleStatus('Loading My Team schedule...');
      try {
        const row = await loadMyFlexibleSchedule(dateFrom);
        if (!active) {
          return;
        }

        if (!row) {
          setSchedule(isOperationsDepartment ? NO_SCHEDULE_LABEL : fixedSchedule);
          setDayOff(isOperationsDepartment ? NO_DAY_OFF_LABEL : fixedDayOff);
          setScheduleStatus(isOperationsDepartment ? 'No My Team schedule found for this ESARF date.' : '');
        } else if (row.is_day_off) {
          setSchedule(formatFlexibleScheduleLabel(row.previous_from_time, row.previous_to_time));
          setDayOff(getWeekdayShortLabel(dateFrom));
          setScheduleStatus('Using My Team day off for this ESARF date.');
        } else {
          setSchedule(formatFlexibleScheduleLabel(row.from_time, row.to_time));
          setDayOff(getWeekdayShortLabel(dateFrom));
          setScheduleStatus('Using My Team schedule for this ESARF date.');
        }
        setValidationErrors((current) => ({ ...current, schedule: undefined, dayOff: undefined, totalHours: undefined }));
      } catch (error) {
        if (!active) {
          return;
        }
        setSchedule(isOperationsDepartment ? NO_SCHEDULE_LABEL : fixedSchedule);
        setDayOff(isOperationsDepartment ? NO_DAY_OFF_LABEL : fixedDayOff);
        setScheduleStatus(error instanceof Error ? error.message : 'Unable to load My Team schedule.');
      }
    }

    void refreshFlexibleSchedule();

    return () => {
      active = false;
    };
  }, [dateFrom, fixedDayOff, fixedSchedule, isOperationsDepartment]);

  useEffect(() => {
    if (!showReasonComposer) {
      if (reasonFocusTimer.current) {
        clearTimeout(reasonFocusTimer.current);
        reasonFocusTimer.current = null;
      }
      return;
    }

    reasonFocusTimer.current = setTimeout(() => {
      reasonComposerInputRef.current?.focus();
    }, 80);

    return () => {
      if (reasonFocusTimer.current) {
        clearTimeout(reasonFocusTimer.current);
        reasonFocusTimer.current = null;
      }
    };
  }, [showReasonComposer]);

  useEffect(() => {
    if (!isOvertimeAllowedForPayroll(payrollClass)) {
      setTransactions((current) => current.filter((item) => item !== 'ot'));
    }
  }, [payrollClass]);

  function toggleTransaction(key: string) {
    setValidationErrors((current) => ({ ...current, transactions: undefined }));
    setTransactions((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      const conflicts = getConflictingTransactions(key);
      return [...current.filter((item) => !conflicts.includes(item)), key];
    });
  }

  function valueForPicker(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to') {
    if (kind === 'date_to') {
      return dateTo ? dateStringToDate(dateTo) : new Date();
    }
    if (kind === 'time_from') {
      return timeFrom ? timeStringToDate(timeFrom) : new Date();
    }
    if (kind === 'time_to') {
      return timeTo ? timeStringToDate(timeTo) : new Date();
    }
    return dateFrom ? dateStringToDate(dateFrom) : new Date();
  }

  function openPicker(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to') {
    setTempPickerDate(valueForPicker(kind));
    setActivePicker(kind);
  }

  function openReasonComposer() {
    setShowReasonComposer(true);
  }

  function applyPickerValue(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to', selectedDate: Date) {
    if (kind === 'date_from') {
      applyDateValue(kind, formatDateInput(selectedDate));
    } else if (kind === 'date_to') {
      applyDateValue(kind, formatDateInput(selectedDate));
    } else if (kind === 'time_from') {
      setTimeFrom(formatTimeInput(selectedDate));
      setValidationErrors((current) => ({ ...current, timeFrom: undefined, totalHours: undefined }));
    } else if (kind === 'time_to') {
      setTimeTo(formatTimeInput(selectedDate));
      setValidationErrors((current) => ({ ...current, timeTo: undefined, totalHours: undefined }));
    }
  }

  function applyDateValue(kind: 'date_from' | 'date_to', value: string) {
    if (kind === 'date_from') {
      setDateFrom(value);
      setValidationErrors((current) => ({ ...current, dateFrom: undefined, totalHours: undefined }));
    } else {
      setDateTo(value);
      setValidationErrors((current) => ({ ...current, dateTo: undefined }));
    }
  }

  function pickerValue() {
    if (Platform.OS === 'ios') {
      return tempPickerDate;
    }
    if (!activePicker) {
      return new Date();
    }
    return valueForPicker(activePicker);
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

  function chooseSelectOption(value: string) {
    if (activeSelect === 'schedule') {
      setSchedule(value);
      setValidationErrors((current) => ({ ...current, schedule: undefined, totalHours: undefined }));
    } else if (activeSelect === 'day_off') {
      setDayOff(value);
      setValidationErrors((current) => ({ ...current, dayOff: undefined, totalHours: undefined }));
    } else if (activeSelect === 'payroll_class') {
      setPayrollClass(value);
      setValidationErrors((current) => ({ ...current, payrollClass: undefined }));
    }
    setActiveSelect(null);
  }

  const selectSheet = getSelectSheet(activeSelect, schedule, dayOff, payrollClass);
  const effectiveScheduleForHours = schedule === NO_SCHEDULE_LABEL ? '' : schedule;
  const effectiveDayOffForHours = dayOff === NO_DAY_OFF_LABEL ? '' : dayOff;
  const isUseOffsetSelected = transactions.includes('use_offset');
  const totalHours = calculateRequestHours({
    requestType: isUseOffsetSelected ? 'use_offset' : 'overtime',
    dateFrom,
    timeFrom,
    timeTo,
    timeSchedule: effectiveScheduleForHours,
    dayOff: effectiveDayOffForHours,
  });
  const scheduleContextError = getScheduleContextError({
    dateFrom,
    schedule,
    dayOff,
    isOperationsDepartment,
  });
  const payrollContextError = payrollClassOptions.includes(payrollClass)
    ? ''
    : 'Payroll class is missing from your employee profile. Contact HR before submitting ESARF.';
  const requestInfoNotice = scheduleContextError || payrollContextError || scheduleStatus;
  const hasUnsavedChanges =
    schedule !== initialSchedule ||
    dayOff !== initialDayOff ||
    payrollClass !== initialPayrollClass ||
    transactions.join('|') !== initialTransactions.join('|') ||
    dateFrom !== initialDateFrom ||
    dateTo !== initialDateTo ||
    timeFrom !== initialTimeFrom ||
    timeTo !== initialTimeTo ||
    reason !== initialReason;

  function closeTransientPanels() {
    Keyboard.dismiss();
    setActivePicker(null);
    setActiveSelect(null);
    setShowReasonComposer(false);
    setShowSubmissionNotes(false);
  }

  function confirmDiscard(action: () => void) {
    closeTransientPanels();

    if (isSubmitting) {
      return;
    }

    if (!hasUnsavedChanges) {
      action();
      return;
    }

    if (Platform.OS === 'web') {
      const confirm = (globalThis as unknown as { confirm?: (message: string) => boolean }).confirm;
      if (confirm?.('Discard this ESARF draft? Your unsaved changes will be lost.')) {
        action();
      }
      return;
    }

    Alert.alert('Discard request?', 'Your ESARF draft has unsaved changes.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  }

  async function submit() {
    if (isSubmitting) {
      return;
    }

    const nextErrors = validateForm({
      schedule,
      dayOff,
      payrollClass,
      transactions,
      dateFrom,
      dateTo,
      timeFrom,
      timeTo,
      totalHours,
      offsetBalance,
      reason,
      scheduleContextError,
    });
    setValidationErrors(nextErrors);

    const firstSection = getFirstInvalidSection(nextErrors);
    if (firstSection) {
      scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[firstSection] - 12), animated: true });
      if (firstSection === 'datetime' && nextErrors.reason) {
        setTimeout(() => setShowReasonComposer(true), 260);
      }
      const message = getValidationErrorMessage(nextErrors);
      setSubmitStatus(message);
      onToast?.({
        tone: 'error',
        title: 'ESARF error',
        message,
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('Submitting ESARF...');

    try {
      const selectedTransactions = transactionOptions.filter((option) => transactions.includes(option.key));
      const requestIds: string[] = [];

      for (const transaction of selectedTransactions) {
        const { data, error } = await supabase.rpc('submit_time_request', {
          p_request_type_code: transaction.requestType,
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_time_from: timeFrom,
          p_time_to: timeTo,
          p_total_hours: totalHours,
          p_reason: reason.trim(),
          p_time_schedule: schedule,
          p_day_off: dayOff,
          p_payroll_class: payrollClass,
          p_transaction_type: transaction.label,
        });

        if (error) {
          throw new Error(error.message);
        }

        if (data) {
          requestIds.push(String(data));
        }
      }

      const count = requestIds.length;
      setSubmitStatus(`Submitted ${count} request(s).`);
      onToast?.({
        tone: 'success',
        title: 'ESARF submitted',
        message: `${count} request${count === 1 ? '' : 's'} sent for approval.`,
      });
      await onSubmitted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit ESARF.';
      setSubmitStatus(message);
      onToast?.({
        tone: 'error',
        title: 'ESARF failed',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={name}
        username={username}
        photoUrl={photoUrl}
        notificationCount={notificationCount}
        onBackHome={() => confirmDiscard(onBack)}
        backTitle="Apply ESARF"
        backAccessory="info"
        onBackAccessory={() => setShowSubmissionNotes(true)}
        onMessages={onAssistant ? () => confirmDiscard(onAssistant) : undefined}
        onNotifications={onNotifications ? () => confirmDiscard(onNotifications) : undefined}
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section
          number="1"
          title="Schedule and payroll"
          icon={<CalendarDays size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'request')}
          onLayoutY={(y) => {
            sectionY.current.request = y;
          }}
        >
          <PickerButton
            label="Schedule"
            value={schedule}
            placeholder="Select schedule"
            onPress={() => {}}
            disabled={true}
            error={validationErrors.schedule}
          />
          <PickerButton
            label="Day off"
            value={dayOff}
            placeholder="Select day off"
            onPress={() => {}}
            disabled={true}
            error={validationErrors.dayOff}
          />
          <PickerButton
            label="Payroll class"
            value={payrollClass}
            placeholder="Select payroll class"
            onPress={() => {}}
            disabled={true}
            error={validationErrors.payrollClass}
          />
        </Section>

        <Section
          number="2"
          title="Transaction type"
          icon={<ListChecks size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'transactions')}
          onLayoutY={(y) => {
            sectionY.current.transactions = y;
          }}
        >
          <Text style={styles.helperText}>Select one or more transactions.</Text>
          <View style={styles.transactionGrid}>
            {transactionOptions.map((option) => {
              const selected = transactions.includes(option.key);
              const disabled =
                (!selected && isTransactionDisabled(option.key, transactions)) ||
                (option.key === 'ot' && !isOvertimeAllowedForPayroll(payrollClass));
              return (
                <Pressable
                  key={option.key}
                  disabled={disabled}
                  style={[
                    styles.transactionOption,
                    selected ? styles.transactionOptionActive : null,
                    disabled ? styles.transactionOptionDisabled : null,
                  ]}
                  onPress={() => toggleTransaction(option.key)}
                >
                  <View style={[styles.checkbox, selected ? styles.checkboxActive : null]}>
                    {selected ? <Check size={14} color={colors.brand.ink} strokeWidth={3} /> : null}
                  </View>
                  <Text
                    style={[
                      styles.transactionLabel,
                      selected ? styles.transactionLabelActive : null,
                      disabled ? styles.transactionLabelDisabled : null,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {validationErrors.transactions ? <Text style={styles.fieldError}>{validationErrors.transactions}</Text> : null}
        </Section>

        <Section
          number="3"
          title="Date and time range"
          icon={<CalendarDays size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'datetime')}
          onLayoutY={(y) => {
            sectionY.current.datetime = y;
          }}
        >
          {operationsScopeLabel ? (
            <View style={styles.operationsScope}>
              <Text style={styles.operationsScopeText} numberOfLines={1}>{operationsScopeLabel}</Text>
            </View>
          ) : null}
          {requestInfoNotice ? (
            <View style={[styles.scheduleNotice, scheduleContextError || payrollContextError ? styles.scheduleNoticeError : null]}>
              <Text style={[styles.scheduleNoticeText, scheduleContextError || payrollContextError ? styles.scheduleNoticeTextError : null]}>
                {requestInfoNotice}
              </Text>
            </View>
          ) : null}
          <View style={styles.twoColumn}>
            <PickerButton
              label="Date from"
              value={formatDateDisplay(dateFrom)}
              placeholder="mm/dd/yyyy"
              onPress={() => openPicker('date_from')}
              webValue={dateFrom}
              onWebChange={(value) => applyDateValue('date_from', value)}
              error={validationErrors.dateFrom}
            />
            <PickerButton
              label="Date to"
              value={formatDateDisplay(dateTo)}
              placeholder="mm/dd/yyyy"
              onPress={() => openPicker('date_to')}
              webValue={dateTo}
              onWebChange={(value) => applyDateValue('date_to', value)}
              error={validationErrors.dateTo}
            />
          </View>

          <View style={styles.twoColumn}>
            <PickerButton
              label="Time from"
              value={timeFrom ? formatTimeDisplay(timeFrom) : ''}
              placeholder="--:-- --"
              onPress={() => openPicker('time_from')}
              error={validationErrors.timeFrom}
            />
            <PickerButton
              label="Time to"
              value={timeTo ? formatTimeDisplay(timeTo) : ''}
              placeholder="--:-- --"
              onPress={() => openPicker('time_to')}
              error={validationErrors.timeTo}
            />
          </View>

          <FieldLabel label="Total No of Hours" />
          <View style={[styles.disabledInput, validationErrors.totalHours ? styles.inputError : null]}>
            <Text style={styles.disabledInputText}>{totalHours.toFixed(2)}</Text>
          </View>
          {validationErrors.totalHours ? <Text style={styles.fieldError}>{validationErrors.totalHours}</Text> : null}

          {isUseOffsetSelected ? (
            <View style={[styles.offsetBalancePanel, totalHours > offsetBalance ? styles.offsetBalancePanelInvalid : null]}>
              <Text style={styles.offsetBalanceLabel}>Offset balance available</Text>
              <Text style={styles.offsetBalanceValue}>{offsetBalance.toFixed(2)} hour(s)</Text>
              <Text style={styles.offsetBalanceHint}>
                Use Offset requests cannot exceed your available offset balance.
              </Text>
            </View>
          ) : null}

          <FieldLabel label="Reason" />
          <Pressable
            style={[styles.reasonInput, validationErrors.reason ? styles.inputError : null]}
            onPress={openReasonComposer}
          >
            <Text style={reason ? styles.reasonPreviewText : styles.reasonPlaceholderText}>
              {reason || 'Enter reason'}
            </Text>
          </Pressable>
          {validationErrors.reason ? <Text style={styles.fieldError}>{validationErrors.reason}</Text> : null}
        </Section>

        <View style={styles.actions}>
          <Pressable disabled={isSubmitting} style={styles.cancelButton} onPress={() => confirmDiscard(onBack)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={isSubmitting}
            style={[styles.submitButton, isSubmitting ? styles.submitButtonDisabled : null]}
            onPress={submit}
          >
            <Text style={styles.submitText}>{isSubmitting ? 'Submitting...' : 'Submit Request'}</Text>
          </Pressable>
        </View>
        {submitStatus ? <Text style={styles.submitStatus}>{submitStatus}</Text> : null}

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
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.iosPickerDone} onPress={confirmIosPicker}>
                    <Text style={styles.submitText}>Done</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : activePicker ? (
          <DateTimePicker
            value={pickerValue()}
            mode={activePicker.startsWith('date') ? 'date' : 'time'}
            display="default"
            is24Hour={false}
            onChange={handlePickerChange}
          />
        ) : null}

        {selectSheet ? (
          <Modal transparent animationType="fade" visible onRequestClose={() => setActiveSelect(null)}>
            <View style={styles.modalBackdrop}>
              <Pressable style={styles.modalDismissArea} onPress={() => setActiveSelect(null)} />
              <View style={styles.optionSheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>{selectSheet.title}</Text>
                {selectSheet.options.map((option) => {
                  const selected = option === selectSheet.value;
                  return (
                    <Pressable
                      key={option}
                      style={[styles.optionRow, selected ? styles.optionRowActive : null]}
                      onPress={() => chooseSelectOption(option)}
                    >
                      <Text style={[styles.optionText, selected ? styles.optionTextActive : null]}>{option}</Text>
                      {selected ? <Check size={18} color={colors.brand.goldStrong} strokeWidth={3} /> : null}
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

        <Modal
          transparent
          animationType="fade"
          visible={showSubmissionNotes}
          onRequestClose={() => setShowSubmissionNotes(false)}
        >
          <View style={styles.notesBackdrop}>
            <View style={styles.notesPanel}>
              <View style={styles.notesHeader}>
                <View>
                  <Text style={styles.notesTitle}>Submission Notes</Text>
                  <Text style={styles.notesSubtitle}>Review before sending your ESARF.</Text>
                </View>
                <Pressable style={styles.notesCloseButton} onPress={() => setShowSubmissionNotes(false)}>
                  <X size={18} color={colors.text} strokeWidth={2.7} />
                </Pressable>
              </View>

              <View style={styles.notesList}>
                {submissionNotes.map((note, index) => (
                  <View key={note} style={styles.timelineNoteRow}>
                    <View style={styles.timelineMarkerColumn}>
                      <View style={styles.timelineDot} />
                      {index < submissionNotes.length - 1 ? <View style={styles.timelineLine} /> : null}
                    </View>
                    <Text style={styles.timelineNoteText}>{note}</Text>
                  </View>
                ))}
                <View style={styles.deadlineNote}>
                  <CalendarDays size={16} color="#b45309" strokeWidth={2.7} />
                  <Text style={styles.deadlineNoteText}>
                    Submit approved ESARF forms on or before the <Text style={styles.deadlineStrong}>5th</Text> and{' '}
                    <Text style={styles.deadlineStrong}>20th</Text>.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          transparent
          animationType="fade"
          visible={showReasonComposer}
          onRequestClose={() => setShowReasonComposer(false)}
          onShow={() => reasonComposerInputRef.current?.focus()}
        >
          <View style={styles.composerBackdrop}>
            <Pressable style={styles.composerDismissArea} onPress={() => setShowReasonComposer(false)} />
            <View style={[styles.reasonComposer, { marginBottom: Platform.OS === 'ios' ? keyboardHeight : 0 }]}>
              <TextInput
                ref={reasonComposerInputRef}
                autoFocus
                value={reason}
                onChangeText={(value) => {
                  setReason(value);
                  setValidationErrors((current) => ({ ...current, reason: undefined }));
                }}
                placeholder="Enter reason"
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
                style={styles.reasonComposerInput}
              />
              <Pressable style={styles.reasonComposerDone} onPress={() => setShowReasonComposer(false)}>
                <Text style={styles.reasonComposerDoneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

const submissionNotes = [
  'Prepare two copies of the form for every payroll period.',
  'Select the correct transaction type for each entry.',
  'For FIO, record only the missed time-in or time-out.',
  'Leave dates should exclude rest days and holidays.',
  'Overnight overtime must be written on its actual date.',
];

function getSelectSheet(
  activeSelect: 'schedule' | 'day_off' | 'payroll_class' | null,
  schedule: string,
  dayOff: string,
  payrollClass: string,
) {
  if (activeSelect === 'schedule') {
    return { title: 'Select schedule', value: schedule, options: scheduleOptions };
  }
  if (activeSelect === 'day_off') {
    return { title: 'Select day off', value: dayOff, options: dayOffOptions };
  }
  if (activeSelect === 'payroll_class') {
    return { title: 'Select payroll class', value: payrollClass, options: payrollClassOptions };
  }
  return null;
}

function getConflictingTransactions(key: string) {
  return exclusiveTransactionGroups
    .filter((group) => group.includes(key))
    .flat()
    .filter((item) => item !== key);
}

function isTransactionDisabled(key: string, selectedKeys: string[]) {
  return selectedKeys.some((selectedKey) => getConflictingTransactions(selectedKey).includes(key));
}

function isOvertimeAllowedForPayroll(payrollClass: string) {
  const normalized = payrollClass.trim().toLowerCase();
  return normalized !== 'admin' && normalized !== 'managerial';
}

function validateForm({
  schedule,
  dayOff,
  payrollClass,
  transactions,
  dateFrom,
  dateTo,
  timeFrom,
  timeTo,
  totalHours,
  offsetBalance,
  reason,
  scheduleContextError,
}: {
  schedule: string;
  dayOff: string;
  payrollClass: string;
  transactions: string[];
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  totalHours: number;
  offsetBalance: number;
  reason: string;
  scheduleContextError: string;
}) {
  const errors: Partial<Record<ValidationKey, string>> = {};

  if (scheduleContextError) {
    errors.schedule = scheduleContextError;
  }
  if (!isValidScheduleValue(schedule)) errors.schedule = 'Schedule is required.';
  if (!isValidDayOffValue(dayOff)) errors.dayOff = 'Day off is required.';
  if (!payrollClassOptions.includes(payrollClass)) errors.payrollClass = 'Payroll class is required.';
  if (!isOvertimeAllowedForPayroll(payrollClass) && transactions.includes('ot')) {
    errors.transactions = 'Overtime is disabled for Admin and Managerial.';
  }
  if (!transactions.length) errors.transactions = 'Select at least one transaction.';
  if (!dateFrom) errors.dateFrom = 'Date From is required.';
  if (!dateTo) errors.dateTo = 'Date To is required.';
  if (dateFrom && dateTo && dateStringToDate(dateTo).getTime() < dateStringToDate(dateFrom).getTime()) {
    errors.dateTo = 'Date To cannot be earlier than Date From';
  }
  if (!timeFrom) errors.timeFrom = 'Time From is required.';
  if (!timeTo) errors.timeTo = 'Time To is required.';
  if (dateFrom && timeFrom && timeTo && totalHours <= 0) errors.totalHours = 'Total hours must be greater than zero.';
  if (transactions.includes('use_offset') && totalHours > offsetBalance) {
    errors.totalHours = `Use Offset cannot exceed your ${offsetBalance.toFixed(2)} hour offset balance.`;
  }
  if (!reason.trim()) errors.reason = 'Reason is required.';

  return errors;
}

function getValidationErrorMessage(errors: Partial<Record<ValidationKey, string>>) {
  return (
    errors.schedule ||
    errors.dayOff ||
    errors.payrollClass ||
    errors.transactions ||
    errors.dateFrom ||
    errors.dateTo ||
    errors.timeFrom ||
    errors.timeTo ||
    errors.totalHours ||
    errors.reason ||
    'Please complete all required fields.'
  );
}

function isValidScheduleValue(value: string) {
  return value === NO_SCHEDULE_LABEL || Boolean(parseScheduleLabel(value));
}

function isValidDayOffValue(value: string) {
  return value === NO_DAY_OFF_LABEL || dayOffOptions.includes(value);
}

function normalizeDepartmentName(value?: string | null) {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
}

function formatOperationsScopeLabel(departmentName?: string | null, storeName?: string | null) {
  const department = departmentName?.trim().replace(/\s+/g, ' ') || 'Operations';
  const store = storeName?.trim().replace(/\s+/g, ' ');
  return [department, store].filter(Boolean).join(' | ').toUpperCase();
}

function getWeekdayShortLabel(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) {
    return NO_DAY_OFF_LABEL;
  }
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short' });
}

function formatFlexibleScheduleLabel(fromTime?: string | null, toTime?: string | null) {
  if (!fromTime || !toTime) {
    return NO_SCHEDULE_LABEL;
  }
  return `${formatTimeDisplay(fromTime)} - ${formatTimeDisplay(toTime)}`;
}

function parseScheduleLabel(value: string) {
  return value.trim().match(/^\d{1,2}:\d{2}\s?(AM|PM)\s-\s\d{1,2}:\d{2}\s?(AM|PM)$/i);
}

function getScheduleContextError({
  dateFrom,
  schedule,
  dayOff,
  isOperationsDepartment,
}: {
  dateFrom: string;
  schedule: string;
  dayOff: string;
  isOperationsDepartment: boolean;
}) {
  if (!dateFrom) {
    return '';
  }

  const hasSchedule = schedule !== NO_SCHEDULE_LABEL && isValidScheduleValue(schedule);
  const hasDayOff = dayOff !== NO_DAY_OFF_LABEL && isValidDayOffValue(dayOff);
  if (hasSchedule || hasDayOff) {
    return '';
  }

  return isOperationsDepartment
    ? 'No schedule found for this date.'
    : 'No schedule found on your profile.';
}

function getFirstInvalidSection(errors: Partial<Record<ValidationKey, string>>): SectionKey | null {
  if (errors.transactions) return 'transactions';
  if (errors.schedule || errors.dayOff || errors.payrollClass) {
    return 'request';
  }
  if (
    errors.dateFrom ||
    errors.dateTo ||
    errors.timeFrom ||
    errors.timeTo ||
    errors.totalHours ||
    errors.reason
  ) {
    return 'datetime';
  }
  return null;
}

function hasSectionError(errors: Partial<Record<ValidationKey, string>>, section: SectionKey) {
  return getFirstInvalidSection(
    section === 'request'
      ? { schedule: errors.schedule, dayOff: errors.dayOff, payrollClass: errors.payrollClass }
      : section === 'transactions'
        ? { transactions: errors.transactions }
        : {
            dateFrom: errors.dateFrom,
            dateTo: errors.dateTo,
            timeFrom: errors.timeFrom,
            timeTo: errors.timeTo,
            totalHours: errors.totalHours,
            reason: errors.reason,
          },
  ) !== null;
}

function Section({
  number,
  title,
  icon,
  children,
  invalid = false,
  onLayoutY,
}: {
  number: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  invalid?: boolean;
  onLayoutY?: (y: number) => void;
}) {
  return (
    <View
      style={[styles.section, invalid ? styles.sectionInvalid : null]}
      onLayout={(event) => onLayoutY?.(event.nativeEvent.layout.y)}
    >
      <View style={styles.sectionHeader}>
        <View style={styles.sectionNumber}>
          <Text style={styles.sectionNumberText}>{number}</Text>
        </View>
        <View style={styles.sectionTitleWrap}>
          {icon}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}


function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  icon?: ReactNode;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={styles.textFieldWrap}>
      <FieldLabel label={label} />
      <View style={styles.inputShell}>
        {icon}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          keyboardType={keyboardType}
          style={styles.textInput}
        />
        {icon ? <ChevronDown size={16} color="#94a3b8" strokeWidth={2.4} /> : null}
      </View>
    </View>
  );
}

function PickerButton({
  label,
  value,
  placeholder,
  onPress,
  disabled = false,
  webValue,
  onWebChange,
  error,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
  webValue?: string;
  onWebChange?: (value: string) => void;
  error?: string;
}) {
  const useWebNativeDate = Platform.OS === 'web' && onWebChange && !disabled;

  return (
    <View style={styles.textFieldWrap}>
      <FieldLabel label={label} />
      <Pressable disabled={disabled} style={[styles.selectButton, disabled ? styles.selectButtonDisabled : null, error ? styles.inputError : null]} onPress={useWebNativeDate ? undefined : onPress}>
        <Text style={[styles.selectButtonText, disabled ? styles.selectButtonTextDisabled : null, !value ? styles.placeholderText : null]}>{value || placeholder}</Text>
        {disabled ? null : <ChevronDown size={16} color={error ? colors.semantic.danger : '#94a3b8'} strokeWidth={2.4} />}
        {useWebNativeDate ? <WebNativeDateInput value={webValue ?? ''} label={label} onChange={onWebChange} /> : null}
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function formatDateDisplay(value: string) {
  if (!value) {
    return '';
  }
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) {
    return value;
  }
  return `${month}/${day}/${year}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  notesButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 21,
    lineHeight: 26,
    color: colors.text,
    fontWeight: fontWeights.heavy,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionInvalid: {
    borderColor: 'rgba(220, 38, 38, 0.42)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.lg,
  },
  sectionNumber: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionNumberText: {
    color: colors.brand.ink,
    fontSize: 13,
    fontWeight: fontWeights.heavy,
  },
  sectionTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: fontWeights.heavy,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    marginBottom: 8,
  },
  helperText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  operationsScope: {
    minHeight: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  operationsScopeText: {
    color: colors.brand.ink,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
  },
  scheduleNotice: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  scheduleNoticeError: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  scheduleNoticeText: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
  },
  scheduleNoticeTextError: {
    color: colors.semantic.danger,
  },
  transactionGrid: {
    gap: 10,
  },
  transactionOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  transactionOptionActive: {
    borderColor: 'rgba(234, 179, 8, 0.55)',
    backgroundColor: '#fffbeb',
  },
  transactionOptionDisabled: {
    opacity: 0.45,
    backgroundColor: '#f1f5f9',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxActive: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.goldStrong,
  },
  transactionLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
  },
  transactionLabelActive: {
    color: '#92400e',
  },
  transactionLabelDisabled: {
    color: '#94a3b8',
  },
  twoColumn: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: 2,
  },
  textFieldWrap: {
    flex: 1,
  },
  selectButton: {
    position: 'relative',
    minHeight: 48,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  selectButtonText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  selectButtonDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  selectButtonTextDisabled: {
    color: '#475569',
  },
  placeholderText: {
    color: '#94a3b8',
  },
  inputError: {
    borderColor: colors.semantic.danger,
    backgroundColor: '#fff7f7',
  },
  fieldError: {
    color: colors.semantic.danger,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    marginTop: -8,
    marginBottom: spacing.md,
  },
  inputShell: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
  },
  textInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
    minWidth: 0,
  },
  reasonInput: {
    minHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  reasonPreviewText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  reasonPlaceholderText: {
    color: '#94a3b8',
    fontSize: 15,
    lineHeight: 21,
  },
  disabledInput: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginBottom: spacing.md,
  },
  disabledInputText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  offsetBalancePanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  offsetBalancePanelInvalid: {
    borderColor: 'rgba(220, 38, 38, 0.42)',
    backgroundColor: '#fff7f7',
  },
  offsetBalanceLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  offsetBalanceValue: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: fontWeights.heavy,
    marginTop: 2,
  },
  offsetBalanceHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
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
  submitStatus: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    marginTop: spacing.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  iosPickerPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  iosPickerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  iosPickerCancel: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosPickerDone: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    marginBottom: spacing.sm,
  },
  optionRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  optionRowActive: {
    backgroundColor: '#fffbeb',
    borderColor: 'rgba(234, 179, 8, 0.4)',
  },
  optionText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  optionTextActive: {
    color: '#92400e',
  },
  sheetCancelButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  notesBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  notesPanel: {
    width: '100%',
    maxWidth: 430,
    borderRadius: radius.md,
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
    marginBottom: spacing.lg,
  },
  notesTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: fontWeights.heavy,
  },
  notesSubtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 20,
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
  notesList: {
    gap: 0,
  },
  timelineNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 38,
  },
  timelineMarkerColumn: {
    width: 18,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    marginTop: 5,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: '#bfdbfe',
    marginTop: 3,
  },
  timelineNoteText: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    paddingBottom: 13,
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
    marginTop: spacing.sm,
  },
  deadlineNoteText: {
    flex: 1,
    color: '#b45309',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  deadlineStrong: {
    fontWeight: fontWeights.heavy,
  },
  composerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.16)',
  },
  composerDismissArea: {
    flex: 1,
  },
  reasonComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  reasonComposerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reasonComposerDone: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  reasonComposerDoneText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
});
