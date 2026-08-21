import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
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
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { UniversalDateTimePicker } from '../components/UniversalDateTimePicker';
import { DateRangePickerModal } from '../components/DateRangePickerModal';
import { ScrollableTimePickerModal } from '../components/ScrollableTimePickerModal';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ListChecks,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { WebNativeDateInput } from '../components/WebNativeDateInput';
import { dayOffOptions, payrollClassOptions, scheduleOptions } from '../constants/requestOptions';
import { supabase } from '../lib/supabase';
import type { AssistantDraft } from '../services/assistant';
import { loadMyFlexibleSchedule } from '../services/team';
import { updateMyPendingRequest, type MyRequest } from '../services/requests';
import { parseEsarfEntries } from '../components/EsarfDetailsView';
import { colors, fontWeights, radius, spacing } from '../theme';
import { platformAlert } from '../utils/platformAlert';
import type { RequestTypeCode } from '../types/domain';
import { calculateRequestHours, parse12HourToken, parseDayOffList } from '../utils/requestCalculations';
import { dateStringToDate, formatDateInput, formatTimeDisplay, formatTimeInput, timeStringToDate } from '../utils/dateTime';

export type EsarfEntry = {
  id: string;
  transaction: string;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  reason: string;
};

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
  { key: 'ut', label: 'Undertime (UT)', shortLabel: 'UT', requestType: 'overtime' },
  { key: 'ot', label: 'Overtime (OT)', shortLabel: 'OT', requestType: 'overtime' },
  { key: 'fio', label: 'Failure to Punch In/Out (FIO)', shortLabel: 'FIO', requestType: 'overtime' },
  { key: 'ob', label: 'Official Business (OB)', shortLabel: 'OB', requestType: 'overtime' },
  { key: 'offset', label: 'Offset', shortLabel: 'Offset', requestType: 'offset_earn' },
  { key: 'use_offset', label: 'Use Offset', shortLabel: 'Use Offset', requestType: 'use_offset' },
] satisfies { key: string; label: string; shortLabel: string; requestType: RequestTypeCode }[];

const INLINE_TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30',
  '22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00', '01:30',
  '02:00', '02:30', '03:00', '03:30', '04:00', '04:30', '05:00', '05:30',
];

const exclusiveTransactionGroups = [
  ['ut', 'ot'],
  ['offset', 'use_offset'],
  ['ot', 'offset', 'use_offset'],
  ['ut', 'offset', 'use_offset'],
];
function WebNativeTimePicker({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  if (Platform.OS !== 'web') return null;
  return (
    <View style={{ marginVertical: 4, alignItems: 'center' }}>
      {React.createElement('input', {
        type: 'time',
        value,
        onChange: (e: any) => onChange(e.target.value || '09:00'),
        style: {
          fontSize: '15px',
          fontWeight: 'bold',
          padding: '8px 14px',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          backgroundColor: '#ffffff',
          color: '#0f172a',
          outline: 'none',
          cursor: 'pointer',
        },
      })}
    </View>
  );
}

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
  editingRequest,
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
  editingRequest?: MyRequest | null;
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
  const fixedSchedule = normalizeSchedule(profileSchedule);
  const fixedDayOff = normalizeDayOff(profileDayOff);
  const initialSchedule = editingRequest?.time_schedule
    ? normalizeSchedule(editingRequest.time_schedule)
    : initialDraft?.fields.schedule
    ? normalizeSchedule(initialDraft.fields.schedule)
    : fixedSchedule;
  const initialDayOff = editingRequest?.day_off
    ? normalizeDayOff(editingRequest.day_off)
    : initialDraft?.fields.dayOff
    ? normalizeDayOff(initialDraft.fields.dayOff)
    : fixedDayOff;
  const initialPayrollClass = editingRequest?.payroll_class ?? initialDraft?.fields.payrollClass ?? profilePayrollClass ?? 'Select payroll class';
  const initialTransactions = initialDraft?.fields.transactions ?? [];
  const initialDateFrom = editingRequest?.date_from ?? initialDraft?.fields.dateFrom ?? '';
  const initialDateTo = editingRequest?.date_to ?? initialDraft?.fields.dateTo ?? initialDateFrom;
  const initialTimeFrom = editingRequest?.time_from ?? initialDraft?.fields.timeFrom ?? '';
  const initialTimeTo = editingRequest?.time_to ?? initialDraft?.fields.timeTo ?? '';
  const initialReason = editingRequest?.reason ?? initialDraft?.fields.reason ?? '';
  const [schedule, setSchedule] = useState(initialSchedule);
  const [dayOff, setDayOff] = useState(initialDayOff);
  const [payrollClass, setPayrollClass] = useState(initialPayrollClass);
  const [isUserCustomSchedule, setIsUserCustomSchedule] = useState(Boolean(editingRequest?.time_schedule));
  const [isUserCustomDayOff, setIsUserCustomDayOff] = useState(Boolean(editingRequest?.day_off));

  const [entries, setEntries] = useState<EsarfEntry[]>(() => {
    if (editingRequest) {
      const parsed = parseEsarfEntries(editingRequest);
      if (parsed.length > 0) {
        return parsed.map((p, idx) => {
          const key = parseTransactionStringToKeys(p.transactionLabel || editingRequest.transaction_type, editingRequest.request_type_code);
          return {
            id: String(idx + 1),
            transaction: key,
            dateFrom: editingRequest.date_from || '',
            dateTo: editingRequest.date_to || editingRequest.date_from || '',
            timeFrom: editingRequest.time_from || '',
            timeTo: editingRequest.time_to || '',
            reason: p.reason || editingRequest.reason || '',
          };
        });
      }
    }
    const defaultKey = parseTransactionStringToKeys(
      editingRequest?.transaction_type,
      editingRequest?.request_type_code,
    );
    return [
      {
        id: '1',
        transaction: defaultKey || initialTransactions[0] || '',
        dateFrom: initialDateFrom,
        dateTo: initialDateTo,
        timeFrom: initialTimeFrom,
        timeTo: initialTimeTo,
        reason: initialReason,
      },
    ];
  });

  const [activeEntryPicker, setActiveEntryPicker] = useState<{
    index: number;
    kind: 'date_from' | 'date_to' | 'time_from' | 'time_to';
  } | null>(null);
  const [activeTransactionSelectIndex, setActiveTransactionSelectIndex] = useState<number | null>(null);
  const [activeDateChoiceIndex, setActiveDateChoiceIndex] = useState<number | null>(null);
  const [activeScrollableTimePicker, setActiveScrollableTimePicker] = useState<{ index: number; field: 'time_from' | 'time_to' } | null>(null);

  const [activeSelect, setActiveSelect] = useState<'schedule' | 'day_off' | 'payroll_class' | null>(null);
  const [isCustomScheduleOpen, setIsCustomScheduleOpen] = useState(false);
  const [customStartTime, setCustomStartTime] = useState('09:00');
  const [customEndTime, setCustomEndTime] = useState('18:00');
  const [customTimePickerKind, setCustomTimePickerKind] = useState<'start' | 'end' | null>(null);
  const [tempCustomPickerDate, setTempCustomPickerDate] = useState(new Date());
  const [showSubmissionNotes, setShowSubmissionNotes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [validationErrors, setValidationErrors] = useState<Partial<Record<string, string>>>({});
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const scrollRef = useRef<ScrollView | null>(null);
  const reasonInputRef = useRef<TextInput | null>(null);
  const sectionY = useRef<Record<SectionKey, number>>({ request: 0, transactions: 0, datetime: 0 });

  const primaryDateFrom = entries[0]?.dateFrom || '';

  useEffect(() => {
    if (editingRequest) {
      setSchedule(editingRequest.time_schedule ? normalizeSchedule(editingRequest.time_schedule) : fixedSchedule);
      setDayOff(editingRequest.day_off ? normalizeDayOff(editingRequest.day_off) : fixedDayOff);
      setPayrollClass(editingRequest.payroll_class ?? profilePayrollClass ?? 'Select payroll class');
      setIsUserCustomSchedule(Boolean(editingRequest.time_schedule));
      setIsUserCustomDayOff(Boolean(editingRequest.day_off));

      const parsed = parseEsarfEntries(editingRequest);
      if (parsed.length > 0) {
        setEntries(
          parsed.map((p, idx) => ({
            id: String(idx + 1),
            transaction: parseTransactionStringToKeys(p.transactionLabel || editingRequest.transaction_type, editingRequest.request_type_code),
            dateFrom: editingRequest.date_from || '',
            dateTo: editingRequest.date_to || editingRequest.date_from || '',
            timeFrom: editingRequest.time_from || '',
            timeTo: editingRequest.time_to || '',
            reason: p.reason || editingRequest.reason || '',
          })),
        );
      } else {
        const defaultKey = parseTransactionStringToKeys(editingRequest.transaction_type, editingRequest.request_type_code);
        setEntries([
          {
            id: '1',
            transaction: defaultKey || '',
            dateFrom: editingRequest.date_from || '',
            dateTo: editingRequest.date_to || editingRequest.date_from || '',
            timeFrom: editingRequest.time_from || '',
            timeTo: editingRequest.time_to || '',
            reason: editingRequest.reason || '',
          },
        ]);
      }
    }
  }, [editingRequest]);

  useEffect(() => {
    let active = true;
    async function refreshFlexibleSchedule() {
      const hasProfileSchedule = fixedSchedule !== NO_SCHEDULE_LABEL || fixedDayOff !== NO_DAY_OFF_LABEL;

      if (!primaryDateFrom) {
        if (!isUserCustomSchedule) {
          setSchedule(hasProfileSchedule ? fixedSchedule : (isOperationsDepartment ? NO_SCHEDULE_LABEL : fixedSchedule));
        }
        if (!isUserCustomDayOff) {
          setDayOff(hasProfileSchedule ? fixedDayOff : (isOperationsDepartment ? NO_DAY_OFF_LABEL : fixedDayOff));
        }
        setValidationErrors((current) => ({ ...current, schedule: undefined, dayOff: undefined, totalHours: undefined }));
        return;
      }

      try {
        const row = await loadMyFlexibleSchedule(primaryDateFrom);
        if (!active) return;

        if (!row) {
          if (!isUserCustomSchedule) {
            setSchedule(hasProfileSchedule ? fixedSchedule : NO_SCHEDULE_LABEL);
          }
          if (!isUserCustomDayOff) {
            setDayOff(hasProfileSchedule ? fixedDayOff : NO_DAY_OFF_LABEL);
          }
        } else if (row.is_day_off) {
          if (!isUserCustomSchedule) {
            setSchedule(formatFlexibleScheduleLabel(row.previous_from_time, row.previous_to_time));
          }
          if (!isUserCustomDayOff) {
            setDayOff(getWeekdayShortLabel(primaryDateFrom));
          }
        } else {
          if (!isUserCustomSchedule) {
            setSchedule(formatFlexibleScheduleLabel(row.from_time, row.to_time));
          }
          if (!isUserCustomDayOff) {
            setDayOff(getWeekdayShortLabel(primaryDateFrom));
          }
        }
        setValidationErrors((current) => ({ ...current, schedule: undefined, dayOff: undefined }));
      } catch (error) {
        if (!active) {
          return;
        }
        if (!isUserCustomSchedule) {
          setSchedule(hasProfileSchedule ? fixedSchedule : NO_SCHEDULE_LABEL);
        }
        if (!isUserCustomDayOff) {
          setDayOff(hasProfileSchedule ? fixedDayOff : NO_DAY_OFF_LABEL);
        }
      }
    }

    void refreshFlexibleSchedule();

    return () => {
      active = false;
    };
  }, [primaryDateFrom, fixedDayOff, fixedSchedule, isOperationsDepartment, isUserCustomSchedule, isUserCustomDayOff]);

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        transaction: '',
        dateFrom: '',
        dateTo: '',
        timeFrom: '',
        timeTo: '',
        reason: '',
      },
    ]);
  }

  function removeEntry(index: number) {
    if (entries.length <= 1) return;
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function updateEntry(index: number, updates: Partial<EsarfEntry>) {
    setEntries((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], ...updates };
      }
      return next;
    });
  }

  function getEntryTotalHours(entry: EsarfEntry) {
    if (!entry.dateFrom || !entry.timeFrom || !entry.timeTo) {
      return 0;
    }
    const transKeys = parseEntryTransactions(entry.transaction);
    const isUseOffset = transKeys.includes('use_offset');
    const isOffsetEarn = transKeys.includes('offset');

    let requestType: RequestTypeCode = 'overtime';
    if (isUseOffset) {
      requestType = 'use_offset';
    } else if (isOffsetEarn) {
      requestType = 'offset_earn';
    }

    return calculateRequestHours({
      requestType,
      dateFrom: entry.dateFrom,
      timeFrom: entry.timeFrom,
      timeTo: entry.timeTo,
      timeSchedule: schedule === NO_SCHEDULE_LABEL ? '' : schedule,
      dayOff: dayOff === NO_DAY_OFF_LABEL ? '' : dayOff,
      isFullHours: isUseOffset,
    });
  }

  function valueForEntryPicker(index: number, kind: 'date_from' | 'date_to' | 'time_from' | 'time_to') {
    const entry = entries[index];
    if (!entry) return new Date();
    if (kind === 'date_to') return entry.dateTo ? dateStringToDate(entry.dateTo) : new Date();
    if (kind === 'time_from') return entry.timeFrom ? timeStringToDate(entry.timeFrom) : new Date();
    if (kind === 'time_to') return entry.timeTo ? timeStringToDate(entry.timeTo) : new Date();
    return entry.dateFrom ? dateStringToDate(entry.dateFrom) : new Date();
  }

  function openEntryPicker(index: number, kind: 'date_from' | 'date_to' | 'time_from' | 'time_to') {
    setTempPickerDate(valueForEntryPicker(index, kind));
    setActiveEntryPicker({ index, kind });
  }

  function applyEntryPickerValue(index: number, kind: 'date_from' | 'date_to' | 'time_from' | 'time_to', selectedDate: Date) {
    if (kind === 'date_from') {
      const val = formatDateInput(selectedDate);
      const currentTo = entries[index]?.dateTo;
      const nextTo = currentTo && dateStringToDate(currentTo).getTime() >= dateStringToDate(val).getTime() ? currentTo : val;
      updateEntry(index, { dateFrom: val, dateTo: nextTo });
      setValidationErrors((current) => ({
        ...current,
        [`entry_${index}_dateFrom`]: undefined,
        [`entry_${index}_dateTo`]: undefined,
      }));
    } else if (kind === 'date_to') {
      const val = formatDateInput(selectedDate);
      const currentFrom = entries[index]?.dateFrom;
      const nextFrom = currentFrom && dateStringToDate(currentFrom).getTime() <= dateStringToDate(val).getTime() ? currentFrom : val;
      updateEntry(index, { dateFrom: nextFrom, dateTo: val });
      setValidationErrors((current) => ({
        ...current,
        [`entry_${index}_dateFrom`]: undefined,
        [`entry_${index}_dateTo`]: undefined,
      }));
    } else if (kind === 'time_from') {
      updateEntry(index, { timeFrom: formatTimeInput(selectedDate) });
      setValidationErrors((current) => ({ ...current, [`entry_${index}_timeFrom`]: undefined }));
    } else if (kind === 'time_to') {
      updateEntry(index, { timeTo: formatTimeInput(selectedDate) });
      setValidationErrors((current) => ({ ...current, [`entry_${index}_timeTo`]: undefined }));
    }
  }

  function pickerValue() {
    if (Platform.OS === 'ios') return tempPickerDate;
    if (!activeEntryPicker) return new Date();
    return valueForEntryPicker(activeEntryPicker.index, activeEntryPicker.kind);
  }

  function handlePickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setActiveEntryPicker(null);
      return;
    }
    if (!selectedDate || !activeEntryPicker) return;
    if (Platform.OS === 'ios') {
      setTempPickerDate(selectedDate);
      return;
    }
    applyEntryPickerValue(activeEntryPicker.index, activeEntryPicker.kind, selectedDate);
    setActiveEntryPicker(null);
  }

  function confirmIosPicker() {
    if (activeEntryPicker) {
      applyEntryPickerValue(activeEntryPicker.index, activeEntryPicker.kind, tempPickerDate);
    }
    setActiveEntryPicker(null);
  }

  function openCustomScheduleModal() {
    closeTransientPanels();
    const { startTime, endTime } = parseScheduleToTimes(schedule);
    setCustomStartTime(startTime);
    setCustomEndTime(endTime);
    setCustomTimePickerKind('start');
    setIsCustomScheduleOpen(true);
  }

  function confirmCustomSchedule() {
    const formatted = getCustomSchedulePreview(customStartTime, customEndTime);
    setSchedule(formatted);
    setIsUserCustomSchedule(true);
    setValidationErrors((current) => ({ ...current, schedule: undefined }));
    setIsCustomScheduleOpen(false);
  }

  function openCustomTimePicker(kind: 'start' | 'end') {
    const timeVal = kind === 'start' ? customStartTime : customEndTime;
    const dateObj = timeStringToDate(timeVal);
    setTempCustomPickerDate(dateObj);
    setCustomTimePickerKind(kind);
  }

  function handleCustomTimePickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setCustomTimePickerKind(null);
      return;
    }
    if (!selectedDate || !customTimePickerKind) return;
    if (Platform.OS === 'ios') {
      setTempCustomPickerDate(selectedDate);
      return;
    }
    const formattedTime = formatTimeInput(selectedDate);
    if (customTimePickerKind === 'start') {
      setCustomStartTime(formattedTime);
    } else {
      setCustomEndTime(formattedTime);
    }
    setCustomTimePickerKind(null);
  }

  function confirmIosCustomTimePicker() {
    if (customTimePickerKind) {
      const formattedTime = formatTimeInput(tempCustomPickerDate);
      if (customTimePickerKind === 'start') {
        setCustomStartTime(formattedTime);
      } else {
        setCustomEndTime(formattedTime);
      }
    }
    setCustomTimePickerKind(null);
  }

  function chooseSelectOption(value: string) {
    if (activeSelect === 'schedule') {
      if (value === 'Custom schedule...') {
        setActiveSelect(null);
        openCustomScheduleModal();
        return;
      }
      setSchedule(value);
      setIsUserCustomSchedule(true);
      setValidationErrors((current) => ({ ...current, schedule: undefined }));
    } else if (activeSelect === 'day_off') {
      setDayOff(value);
      setIsUserCustomDayOff(true);
      setValidationErrors((current) => ({ ...current, dayOff: undefined }));
    } else if (activeSelect === 'payroll_class') {
      setPayrollClass(value);
      setValidationErrors((current) => ({ ...current, payrollClass: undefined }));
    }
    setActiveSelect(null);
  }

  const selectSheet = getSelectSheet(activeSelect, schedule, dayOff, payrollClass);
  const scheduleContextError = getScheduleContextError({
    dateFrom: primaryDateFrom,
    schedule,
    dayOff,
    isOperationsDepartment,
  });
  const payrollContextError = payrollClassOptions.includes(payrollClass)
    ? ''
    : 'Payroll class is missing from your employee profile. Contact HR before submitting ESARF.';
  const requestInfoNotice = scheduleContextError || payrollContextError;
  const hasUnsavedChanges =
    schedule !== initialSchedule ||
    dayOff !== initialDayOff ||
    payrollClass !== initialPayrollClass ||
    entries.length > 1 ||
    entries[0]?.transaction !== (initialTransactions[0] ?? '') ||
    entries[0]?.dateFrom !== initialDateFrom ||
    entries[0]?.dateTo !== initialDateTo ||
    entries[0]?.timeFrom !== initialTimeFrom ||
    entries[0]?.timeTo !== initialTimeTo ||
    entries[0]?.reason !== initialReason;

  function closeTransientPanels() {
    Keyboard.dismiss();
    setActiveEntryPicker(null);
    setActiveTransactionSelectIndex(null);
    setActiveDateChoiceIndex(null);
    setActiveSelect(null);
    setShowSubmissionNotes(false);
    setIsCustomScheduleOpen(false);
    setCustomTimePickerKind(null);
  }

  function confirmDiscard(action: () => void) {
    closeTransientPanels();

    if (isSubmitting) return;
    if (!hasUnsavedChanges) {
      action();
      return;
    }

    platformAlert('Discard request?', 'Your ESARF draft has unsaved changes.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  }

  function validateForm() {
    const errors: Partial<Record<string, string>> = {};

    if (scheduleContextError) {
      errors.schedule = scheduleContextError;
    }
    if (!isValidScheduleValue(schedule)) errors.schedule = 'Schedule is required.';
    if (!isValidDayOffValue(dayOff)) errors.dayOff = 'Day off is required.';
    if (!payrollClassOptions.includes(payrollClass)) errors.payrollClass = 'Payroll class is required.';

    entries.forEach((entry, i) => {
      const num = entries.length - i;
      const transKeys = parseEntryTransactions(entry.transaction);
      if (!transKeys.length) errors[`entry_${i}_transaction`] = `Request #${num}: Select at least one transaction type.`;
      if (!isOvertimeAllowedForPayroll(payrollClass) && transKeys.includes('ot')) {
        errors[`entry_${i}_transaction`] = `Request #${num}: Overtime is disabled for Admin and Managerial.`;
      }
      if (!entry.dateFrom) errors[`entry_${i}_dateFrom`] = `Request #${num}: Date From is required.`;
      if (!entry.dateTo) errors[`entry_${i}_dateTo`] = `Request #${num}: Date To is required.`;
      if (entry.dateFrom && entry.dateTo && dateStringToDate(entry.dateTo).getTime() < dateStringToDate(entry.dateFrom).getTime()) {
        errors[`entry_${i}_dateTo`] = `Request #${num}: Date To cannot be earlier than Date From.`;
      }
      if (!entry.timeFrom) errors[`entry_${i}_timeFrom`] = `Request #${num}: Time From is required.`;
      if (!entry.timeTo) errors[`entry_${i}_timeTo`] = `Request #${num}: Time To is required.`;
      const hours = getEntryTotalHours(entry);
      if (transKeys.includes('use_offset') && hours > offsetBalance) {
        errors[`entry_${i}_totalHours`] = `Request #${num}: Use Offset cannot exceed available offset balance.`;
      }
      if (!entry.reason.trim()) errors[`entry_${i}_reason`] = `Request #${num}: Reason is required.`;
    });

    return errors;
  }

  async function submit() {
    if (isSubmitting) return;

    const nextErrors = validateForm();
    setValidationErrors(nextErrors);

    const message = Object.values(nextErrors).find((msg): msg is string => Boolean(msg));
    if (message) {
      setSubmitStatus(message);
      onToast?.({ tone: 'error', title: 'ESARF error', message });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus(`Submitting ${entries.length} request(s)...`);

    try {
      const allTransKeys = entries.flatMap((e) => parseEntryTransactions(e.transaction));
      const isUseOffset = allTransKeys.includes('use_offset');
      const isOffsetEarn = allTransKeys.includes('offset');

      let primaryRequestType: RequestTypeCode = 'overtime';
      if (isUseOffset) {
        primaryRequestType = 'use_offset';
      } else if (isOffsetEarn) {
        primaryRequestType = 'offset_earn';
      }

      const transactionTypesPerEntry = entries.map((e) => {
        const keys = parseEntryTransactions(e.transaction);
        const opts = transactionOptions.filter((t) => keys.includes(t.key));
        return opts.map((t) => t.shortLabel || t.label).join('/') || e.transaction;
      });
      const combinedTransactionType = Array.from(new Set(transactionTypesPerEntry)).join(', ');

      const totalHoursSum = entries.reduce((sum, e) => sum + getEntryTotalHours(e), 0);

      const allDatesFrom = entries.map((e) => e.dateFrom).filter(Boolean);
      const allDatesTo = entries.map((e) => e.dateTo || e.dateFrom).filter(Boolean);
      const sortedFrom = [...allDatesFrom].sort();
      const sortedTo = [...allDatesTo].sort();

      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];
      const overallDateFrom = sortedFrom[0] || firstEntry.dateFrom;
      const overallDateTo = sortedTo[sortedTo.length - 1] || lastEntry.dateTo || lastEntry.dateFrom || firstEntry.dateFrom;
      const overallTimeFrom = firstEntry.timeFrom;
      const overallTimeTo = lastEntry.timeTo || firstEntry.timeTo;

      let combinedReason: string;
      if (entries.length === 1) {
        combinedReason = firstEntry.reason.trim();
      } else {
        combinedReason = entries
          .map((e, idx) => {
            const keys = parseEntryTransactions(e.transaction);
            const opts = transactionOptions.filter((t) => keys.includes(t.key));
            const transLabel = opts.map((t) => t.shortLabel || t.label).join('/') || e.transaction;
            const dateStr = formatEsarfDateRange(e.dateFrom, e.dateTo);
            const timeFromStr = e.timeFrom ? formatTimeDisplay(e.timeFrom) : '';
            const timeToStr = e.timeTo ? formatTimeDisplay(e.timeTo) : '';
            const hrs = getEntryTotalHours(e);
            return `[Entry ${idx + 1}] (${transLabel}) ${dateStr} ${timeFromStr}-${timeToStr} (${hrs.toFixed(2)} hrs): ${e.reason.trim()}`;
          })
          .join('\n');
      }

      if (editingRequest) {
        const targetReqId = editingRequest.request_id || (editingRequest as any).id;
        if (!targetReqId) {
          throw new Error('Request ID is missing.');
        }

        await updateMyPendingRequest({
          requestId: targetReqId,
          dateFrom: overallDateFrom,
          dateTo: overallDateTo,
          timeFrom: overallTimeFrom,
          timeTo: overallTimeTo,
          totalHours: totalHoursSum,
          timeSchedule: schedule,
          dayOff: dayOff,
          payrollClass: payrollClass,
          transactionType: combinedTransactionType,
          reason: combinedReason,
        });

        setSubmitStatus(`Updated ESARF request with ${entries.length} entry(ies).`);
        onToast?.({
          tone: 'success',
          title: 'ESARF updated',
          message: `ESARF request with ${entries.length} entry(ies) has been updated.`,
        });
        await onSubmitted?.();
        return;
      }

      const { error } = await supabase.rpc('submit_time_request', {
        p_request_type_code: primaryRequestType,
        p_date_from: overallDateFrom,
        p_date_to: overallDateTo,
        p_time_from: overallTimeFrom,
        p_time_to: overallTimeTo,
        p_total_hours: totalHoursSum,
        p_reason: combinedReason,
        p_time_schedule: schedule,
        p_day_off: dayOff,
        p_payroll_class: payrollClass,
        p_transaction_type: combinedTransactionType,
      });

      if (error) {
        throw new Error(error.message);
      }

      setSubmitStatus(`Submitted ESARF request with ${entries.length} entry(ies).`);
      onToast?.({
        tone: 'success',
        title: 'ESARF submitted',
        message: `ESARF request with ${entries.length} entry(ies) sent for approval.`,
      });
      await onSubmitted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit ESARF.';
      setSubmitStatus(message);
      onToast?.({ tone: 'error', title: 'ESARF failed', message });
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.keyboardAvoider}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.scheduleCard,
            hasSectionError(validationErrors, 'request') ? styles.scheduleCardInvalid : null,
          ]}
          onLayout={(event) => {
            sectionY.current.request = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.scheduleCardHeader}>
            <CalendarDays size={20} color={colors.primary} strokeWidth={2.2} />
            <Text style={styles.scheduleCardTitle}>Schedule and Payroll</Text>
          </View>

          <View style={styles.scheduleFieldGroup}>
            <Text style={styles.scheduleFieldLabel}>Time Schedule</Text>
            <View
              style={[
                styles.scheduleInputBox,
                validationErrors.schedule ? styles.inputError : null,
              ]}
            >
              <Pressable
                style={styles.scheduleInputTouchable}
                onPress={() => setActiveSelect('schedule')}
              >
                <Text
                  style={[
                    styles.scheduleInputText,
                    !schedule || schedule === NO_SCHEDULE_LABEL ? styles.placeholderText : null,
                  ]}
                  numberOfLines={1}
                >
                  {schedule || 'Select time schedule'}
                </Text>
              </Pressable>
              <View style={styles.scheduleActionIcons}>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.scheduleIconButton}
                  onPress={openCustomScheduleModal}
                  accessibilityLabel="Set custom base schedule"
                >
                  <Clock3 size={18} color={colors.primary} strokeWidth={2.2} />
                </Pressable>
              </View>
            </View>
            {validationErrors.schedule ? (
              <Text style={styles.fieldError}>{validationErrors.schedule}</Text>
            ) : null}
          </View>

          <View style={styles.scheduleTwoColumnRow}>
            <View style={styles.scheduleColumnField}>
              <Text style={styles.scheduleFieldLabel}>Day-off</Text>
              <View
                style={[
                  styles.scheduleInputBox,
                  validationErrors.dayOff ? styles.inputError : null,
                ]}
              >
                <Text
                  style={[
                    styles.scheduleInputText,
                    !dayOff || dayOff === NO_DAY_OFF_LABEL ? styles.placeholderText : null,
                  ]}
                  numberOfLines={1}
                >
                  {dayOff || 'Select day off'}
                </Text>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.scheduleIconButton}
                  onPress={() => setActiveSelect('day_off')}
                >
                  <Repeat size={18} color="#64748b" strokeWidth={2} />
                </Pressable>
              </View>
              {validationErrors.dayOff ? (
                <Text style={styles.fieldError}>{validationErrors.dayOff}</Text>
              ) : null}
            </View>

            <View style={styles.scheduleColumnField}>
              <Text style={styles.scheduleFieldLabel}>Payroll Class</Text>
              <View
                style={[
                  styles.scheduleInputBox,
                  validationErrors.payrollClass ? styles.inputError : null,
                ]}
              >
                <Text
                  style={[
                    styles.scheduleInputText,
                    !payrollClass || payrollClass === 'Select payroll class'
                      ? styles.placeholderText
                      : null,
                  ]}
                  numberOfLines={1}
                >
                  {payrollClass || 'Select payroll class'}
                </Text>
              </View>
              {validationErrors.payrollClass ? (
                <Text style={styles.fieldError}>{validationErrors.payrollClass}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View
          style={styles.entriesSectionContainer}
          onLayout={(event) => {
            sectionY.current.transactions = event.nativeEvent.layout.y;
            sectionY.current.datetime = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.entriesSectionHeader}>
            <Text style={styles.entriesSectionTitle}>ESARF Request Information</Text>
            <Pressable style={styles.addEntryButton} onPress={addEntry} hitSlop={6}>
              <Plus size={18} color="#0f172a" strokeWidth={3} />
            </Pressable>
          </View>

          {operationsScopeLabel ? (
            <View style={styles.operationsScope}>
              <Text style={styles.operationsScopeText} numberOfLines={1}>
                {operationsScopeLabel}
              </Text>
            </View>
          ) : null}

          {requestInfoNotice ? (
            <View
              style={[
                styles.scheduleNotice,
                scheduleContextError || payrollContextError ? styles.scheduleNoticeError : null,
              ]}
            >
              <Text
                style={[
                  styles.scheduleNoticeText,
                  scheduleContextError || payrollContextError ? styles.scheduleNoticeTextError : null,
                ]}
              >
                {requestInfoNotice}
              </Text>
            </View>
          ) : null}

          {entries.map((entry, index) => {
            const actualIndex = index;
            const badgeNumber = actualIndex + 1;
              const entryTransKeys = parseEntryTransactions(entry.transaction);
              const selectedOptions = transactionOptions.filter((t) => entryTransKeys.includes(t.key));
              const transactionLabelText = selectedOptions.length
                ? selectedOptions.map((t) => t.shortLabel || t.label).join(', ')
                : 'Select transaction';
              const dateDisplayText = formatEsarfDateRange(entry.dateFrom, entry.dateTo);
              const hours = getEntryTotalHours(entry);

              return (
                <View key={entry.id} style={styles.entryCard}>
                  <View style={styles.entryCardHeader}>
                    <View style={styles.entryBadge}>
                      <Text style={styles.entryBadgeText}>{badgeNumber}</Text>
                    </View>
                    <Text style={styles.entryCardTitle}>ESARF Request Information</Text>
                    {entries.length > 1 ? (
                      <Pressable
                        style={styles.deleteEntryButton}
                        onPress={() => removeEntry(actualIndex)}
                        hitSlop={6}
                      >
                        <Trash2 size={16} color="#ef4444" strokeWidth={2.2} />
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Row 1: Transaction Type & Date From-To */}
                  <View style={styles.underlineRow}>
                    <View style={styles.underlineField}>
                      <Pressable
                        style={[
                          styles.underlineBox,
                          validationErrors[`entry_${actualIndex}_transaction`] ? styles.inputError : null,
                        ]}
                        onPress={() => setActiveTransactionSelectIndex(actualIndex)}
                      >
                        <Text
                          style={[
                            styles.underlineText,
                            !selectedOptions.length ? styles.underlineTextPlaceholder : null,
                          ]}
                          numberOfLines={1}
                        >
                          {transactionLabelText}
                        </Text>
                        <ChevronDown size={16} color="#64748b" strokeWidth={2.4} />
                      </Pressable>
                      <Text style={styles.underlineLabel}>Transaction Type</Text>
                      {validationErrors[`entry_${actualIndex}_transaction`] ? (
                        <Text style={styles.fieldError}>{validationErrors[`entry_${actualIndex}_transaction`]}</Text>
                      ) : null}
                    </View>

                    <View style={styles.underlineField}>
                      <Pressable
                        style={[
                          styles.underlineBox,
                          validationErrors[`entry_${actualIndex}_dateFrom`] ? styles.inputError : null,
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
                      <Text style={styles.underlineLabel}>Date From-To</Text>
                      {validationErrors[`entry_${actualIndex}_dateFrom`] ? (
                        <Text style={styles.fieldError}>{validationErrors[`entry_${actualIndex}_dateFrom`]}</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* Row 2: Total No of Hours, Time From, Time To */}
                  <View style={styles.underlineRow}>
                    <View style={styles.underlineField}>
                      <View style={styles.underlineBox}>
                        <Text style={styles.underlineText}>
                          {(hours ?? 0).toFixed(2)}
                        </Text>
                      </View>
                      <Text style={styles.underlineLabel}>Total No of Hours</Text>
                    </View>

                    <View style={styles.underlineField}>
                      <Pressable
                        style={[
                          styles.underlineBox,
                          validationErrors[`entry_${actualIndex}_timeFrom`] ? styles.inputError : null,
                        ]}
                        onPress={() => setActiveScrollableTimePicker({ index: actualIndex, field: 'time_from' })}
                      >
                        <Text
                          style={[
                            styles.underlineText,
                            !entry.timeFrom ? styles.underlineTextPlaceholder : null,
                          ]}
                          numberOfLines={1}
                        >
                          {entry.timeFrom ? formatTimeDisplay(entry.timeFrom) : '--:-- --'}
                        </Text>
                        <Clock3 size={16} color="#64748b" strokeWidth={2} />
                      </Pressable>
                      <Text style={styles.underlineLabel}>Time From</Text>
                      {validationErrors[`entry_${actualIndex}_timeFrom`] ? (
                        <Text style={styles.fieldError}>{validationErrors[`entry_${actualIndex}_timeFrom`]}</Text>
                      ) : null}
                    </View>

                    <View style={styles.underlineField}>
                      <Pressable
                        style={[
                          styles.underlineBox,
                          validationErrors[`entry_${actualIndex}_timeTo`] ? styles.inputError : null,
                        ]}
                        onPress={() => setActiveScrollableTimePicker({ index: actualIndex, field: 'time_to' })}
                      >
                        <Text
                          style={[
                            styles.underlineText,
                            !entry.timeTo ? styles.underlineTextPlaceholder : null,
                          ]}
                          numberOfLines={1}
                        >
                          {entry.timeTo ? formatTimeDisplay(entry.timeTo) : '--:-- --'}
                        </Text>
                        <Clock3 size={16} color="#64748b" strokeWidth={2} />
                      </Pressable>
                      <Text style={styles.underlineLabel}>Time To</Text>
                      {validationErrors[`entry_${actualIndex}_timeTo`] ? (
                        <Text style={styles.fieldError}>{validationErrors[`entry_${actualIndex}_timeTo`]}</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* Row 3: Reason */}
                  <View style={styles.underlineFieldFull}>
                    <TextInput
                      value={entry.reason}
                      onChangeText={(text) => {
                        updateEntry(actualIndex, { reason: text });
                        setValidationErrors((current) => ({
                          ...current,
                          [`entry_${actualIndex}_reason`]: undefined,
                        }));
                      }}
                      placeholder="Enter reason"
                      placeholderTextColor="#94a3b8"
                      underlineColorAndroid="transparent"
                      style={[
                        styles.underlineTextInput,
                        validationErrors[`entry_${actualIndex}_reason`] ? styles.inputError : null,
                      ]}
                    />
                    <Text style={styles.underlineLabel}>Reason</Text>
                    {validationErrors[`entry_${actualIndex}_reason`] ? (
                      <Text style={styles.fieldError}>{validationErrors[`entry_${actualIndex}_reason`]}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
        </View>

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

        {activeEntryPicker ? (
          <UniversalDateTimePicker
            value={pickerValue()}
            mode={activeEntryPicker.kind.startsWith('date') ? 'date' : 'time'}
            display="default"
            is24Hour={false}
            onChange={handlePickerChange}
            onClose={() => setActiveEntryPicker(null)}
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
                  const isCustom = option === 'Custom schedule...';
                  return (
                    <Pressable
                      key={option}
                      style={[
                        styles.optionRow,
                        selected ? styles.optionRowActive : null,
                        isCustom ? styles.customOptionRow : null,
                      ]}
                      onPress={() => chooseSelectOption(option)}
                    >
                      {isCustom ? (
                        <View style={styles.customOptionWrap}>
                          <Clock3 size={16} color={colors.primary} strokeWidth={2.2} />
                          <Text style={[styles.optionText, styles.customOptionText]}>{option}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.optionText, selected ? styles.optionTextActive : null]}>{option}</Text>
                      )}
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

        {isCustomScheduleOpen ? (
          <Modal transparent animationType="fade" visible onRequestClose={() => setIsCustomScheduleOpen(false)}>
            <View style={styles.modalBackdrop}>
              <Pressable style={styles.modalDismissArea} onPress={() => setIsCustomScheduleOpen(false)} />
              <View style={styles.customScheduleModalPanel}>
                <View style={styles.sheetHandle} />
                <View style={styles.customScheduleHeader}>
                  <View style={styles.customScheduleIconBadge}>
                    <Clock3 size={18} color="#0f172a" strokeWidth={2.5} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.customScheduleTitle}>Custom Base Schedule</Text>
                    <Text style={styles.customScheduleSubtitle}>
                      Tap Shift Start or Shift End to choose working hours.
                    </Text>
                  </View>
                </View>

                <View style={styles.customTimeRow}>
                  <Pressable
                    style={[
                      styles.customTimeColCard,
                      customTimePickerKind === 'start' ? styles.customTimeColCardActive : null,
                    ]}
                    onPress={() => setCustomTimePickerKind('start')}
                  >
                    <Text
                      style={[
                        styles.customTimeLabel,
                        customTimePickerKind === 'start' ? styles.customTimeLabelActive : null,
                      ]}
                    >
                      Shift Start
                    </Text>
                    <View style={styles.customTimeBoxInner}>
                      <Text style={styles.customTimeText}>
                        {formatTimeDisplay(customStartTime)}
                      </Text>
                      <Clock3
                        size={16}
                        color={customTimePickerKind === 'start' ? colors.brand.goldStrong : colors.primary}
                        strokeWidth={2.2}
                      />
                    </View>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.customTimeColCard,
                      customTimePickerKind === 'end' ? styles.customTimeColCardActive : null,
                    ]}
                    onPress={() => setCustomTimePickerKind('end')}
                  >
                    <Text
                      style={[
                        styles.customTimeLabel,
                        customTimePickerKind === 'end' ? styles.customTimeLabelActive : null,
                      ]}
                    >
                      Shift End
                    </Text>
                    <View style={styles.customTimeBoxInner}>
                      <Text style={styles.customTimeText}>
                        {formatTimeDisplay(customEndTime)}
                      </Text>
                      <Clock3
                        size={16}
                        color={customTimePickerKind === 'end' ? colors.brand.goldStrong : colors.primary}
                        strokeWidth={2.2}
                      />
                    </View>
                  </Pressable>
                </View>

                {customTimePickerKind ? (
                  <View style={styles.inlineTimePickerContainer}>
                    <Text style={styles.inlineTimePickerHeader}>
                      Selecting {customTimePickerKind === 'start' ? 'Shift Start Time' : 'Shift End Time'}:
                    </Text>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.timePresetsScrollView}
                      contentContainerStyle={styles.timePresetsScroll}
                    >
                      {(customTimePickerKind === 'start'
                        ? ['06:00', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '11:00', '12:00']
                        : ['15:00', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '20:00', '21:00']
                      ).map((timeVal) => {
                        const activeVal = customTimePickerKind === 'start' ? customStartTime : customEndTime;
                        const isSelected = activeVal === timeVal;
                        return (
                          <Pressable
                            key={timeVal}
                            style={[styles.presetTimePill, isSelected ? styles.presetTimePillActive : null]}
                            onPress={() => {
                              if (customTimePickerKind === 'start') {
                                setCustomStartTime(timeVal);
                              } else {
                                setCustomEndTime(timeVal);
                              }
                            }}
                          >
                            <Text style={[styles.presetTimeText, isSelected ? styles.presetTimeTextActive : null]}>
                              {formatTimeDisplay(timeVal)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.customSchedulePreviewBox}>
                  <Text style={styles.customSchedulePreviewLabel}>Preview Base Schedule</Text>
                  <Text style={styles.customSchedulePreviewValue}>
                    {getCustomSchedulePreview(customStartTime, customEndTime)}
                  </Text>
                </View>

                <View style={styles.customScheduleActions}>
                  <Pressable style={styles.cancelButton} onPress={() => setIsCustomScheduleOpen(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.submitButton} onPress={confirmCustomSchedule}>
                    <Text style={styles.submitText}>Apply Schedule</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        {activeTransactionSelectIndex !== null ? (
          <Modal transparent animationType="fade" visible onRequestClose={() => setActiveTransactionSelectIndex(null)}>
            <View style={styles.modalBackdrop}>
              <Pressable style={styles.modalDismissArea} onPress={() => setActiveTransactionSelectIndex(null)} />
              <View style={styles.optionSheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>Select Transaction Type(s)</Text>
                <Text style={styles.transactionModalSubtitle}>
                  Choose one or more transaction types for this request entry.
                </Text>
                {transactionOptions.map((option) => {
                  const currentTransStr = entries[activeTransactionSelectIndex]?.transaction || '';
                  const currentSelectedKeys = parseEntryTransactions(currentTransStr);
                  const selected = currentSelectedKeys.includes(option.key);
                  const isOtDisabled = option.key === 'ot' && !isOvertimeAllowedForPayroll(payrollClass);
                  const isConflictDisabled = !selected && isTransactionDisabled(option.key, currentSelectedKeys);
                  const disabled = isOtDisabled || isConflictDisabled;

                  return (
                    <Pressable
                      key={option.key}
                      disabled={disabled}
                      style={[
                        styles.optionRow,
                        selected ? styles.optionRowActive : null,
                        disabled ? styles.transactionOptionDisabled : null,
                      ]}
                      onPress={() => {
                        let newKeys: string[];
                        if (selected) {
                          newKeys = currentSelectedKeys.filter((k) => k !== option.key);
                        } else {
                          newKeys = [...currentSelectedKeys, option.key];
                        }
                        updateEntry(activeTransactionSelectIndex, { transaction: newKeys.join(',') });
                        setValidationErrors((current) => ({
                          ...current,
                          [`entry_${activeTransactionSelectIndex}_transaction`]: undefined,
                        }));
                      }}
                    >
                      <View style={styles.transactionOptionCheckRow}>
                        <View style={[styles.checkbox, selected ? styles.checkboxActive : null]}>
                          {selected ? <Check size={14} color="#0f172a" strokeWidth={3} /> : null}
                        </View>
                        <Text style={[styles.optionText, selected ? styles.optionTextActive : null]}>
                          {option.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={styles.transactionDoneButton}
                  onPress={() => setActiveTransactionSelectIndex(null)}
                >
                  <Text style={styles.submitText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}

        {activeDateChoiceIndex !== null ? (
          <DateRangePickerModal
            visible
            initialStartDate={entries[activeDateChoiceIndex]?.dateFrom || ''}
            initialEndDate={entries[activeDateChoiceIndex]?.dateTo || ''}
            onApply={(startYMD, endYMD) => {
              const idx = activeDateChoiceIndex;
              updateEntry(idx, { dateFrom: startYMD, dateTo: endYMD });
              setActiveDateChoiceIndex(null);
            }}
            onClose={() => setActiveDateChoiceIndex(null)}
          />
        ) : null}

        {activeScrollableTimePicker !== null ? (
          <ScrollableTimePickerModal
            visible
            title={activeScrollableTimePicker.field === 'time_from' ? 'Set Time From' : 'Set Time To'}
            initialTime={
              activeScrollableTimePicker.field === 'time_from'
                ? entries[activeScrollableTimePicker.index]?.timeFrom || '09:00'
                : entries[activeScrollableTimePicker.index]?.timeTo || '18:00'
            }
            onConfirm={(time24) => {
              const idx = activeScrollableTimePicker.index;
              if (activeScrollableTimePicker.field === 'time_from') {
                updateEntry(idx, { timeFrom: time24 });
              } else {
                updateEntry(idx, { timeTo: time24 });
              }
              setActiveScrollableTimePicker(null);
            }}
            onCancel={() => setActiveScrollableTimePicker(null)}
          />
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


      </ScrollView>
      </KeyboardAvoidingView>
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
    return { title: 'Select schedule', value: schedule, options: [...scheduleOptions, 'Custom schedule...'] };
  }
  if (activeSelect === 'day_off') {
    return { title: 'Select day off', value: dayOff, options: dayOffOptions };
  }
  if (activeSelect === 'payroll_class') {
    return { title: 'Select payroll class', value: payrollClass, options: payrollClassOptions };
  }
  return null;
}

function parseScheduleToTimes(scheduleText: string): { startTime: string; endTime: string } {
  const DEFAULT_START = '09:00';
  const DEFAULT_END = '18:00';
  if (!scheduleText || scheduleText === NO_SCHEDULE_LABEL) {
    return { startTime: DEFAULT_START, endTime: DEFAULT_END };
  }
  const parts = scheduleText.split('-');
  if (parts.length !== 2) {
    return { startTime: DEFAULT_START, endTime: DEFAULT_END };
  }
  const startMin = parse12HourToken(parts[0]);
  const endMin = parse12HourToken(parts[1]);
  if (startMin === null || endMin === null) {
    return { startTime: DEFAULT_START, endTime: DEFAULT_END };
  }
  const startH = String(Math.floor(startMin / 60)).padStart(2, '0');
  const startM = String(startMin % 60).padStart(2, '0');
  const endH = String(Math.floor((endMin % (24 * 60)) / 60)).padStart(2, '0');
  const endM = String(endMin % 60).padStart(2, '0');
  return { startTime: `${startH}:${startM}`, endTime: `${endH}:${endM}` };
}

function getCustomSchedulePreview(startTime: string, endTime: string): string {
  const formattedStart = formatTimeDisplay(startTime);
  const formattedEnd = formatTimeDisplay(endTime);
  return normalizeSchedule(`${formattedStart} - ${formattedEnd}`);
}

function parseEntryTransactions(transactionStr?: string | null): string[] {
  if (!transactionStr) return [];
  return transactionStr.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseTransactionStringToKeys(rawStr?: string | null, requestTypeCode?: string | null): string {
  if (!rawStr || !rawStr.trim()) {
    if (requestTypeCode === 'offset_earn') return 'offset';
    if (requestTypeCode === 'use_offset') return 'use_offset';
    if (requestTypeCode === 'overtime') return 'ot';
    return '';
  }

  const parts = rawStr.split(/[,/]+/).map((s) => s.trim()).filter(Boolean);
  const matchedKeys: string[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'use_offset' || lower === 'use offset' || lower.includes('use offset')) {
      if (!matchedKeys.includes('use_offset')) matchedKeys.push('use_offset');
    } else if (lower.includes('offset')) {
      if (!matchedKeys.includes('offset')) matchedKeys.push('offset');
    } else if (lower.includes('undertime') || lower === 'ut' || lower.includes('(ut)')) {
      if (!matchedKeys.includes('ut')) matchedKeys.push('ut');
    } else if (lower.includes('overtime') || lower === 'ot' || lower.includes('(ot)')) {
      if (!matchedKeys.includes('ot')) matchedKeys.push('ot');
    } else if (lower.includes('failure') || lower.includes('punch') || lower === 'fio' || lower.includes('(fio)')) {
      if (!matchedKeys.includes('fio')) matchedKeys.push('fio');
    } else if (lower.includes('official') || lower.includes('business') || lower === 'ob' || lower.includes('(ob)')) {
      if (!matchedKeys.includes('ob')) matchedKeys.push('ob');
    }
  }

  if (matchedKeys.length > 0) {
    return matchedKeys.join(',');
  }

  if (requestTypeCode === 'offset_earn') return 'offset';
  if (requestTypeCode === 'use_offset') return 'use_offset';
  if (requestTypeCode === 'overtime') return 'ot';

  return rawStr;
}

export function formatEsarfDateRange(dateFromStr?: string | null, dateToStr?: string | null): string {
  if (!dateFromStr) return 'mm/dd-dd/yyyy';

  const fromParts = dateFromStr.split('-').map(Number);
  if (fromParts.length !== 3 || fromParts.some(Number.isNaN)) return 'mm/dd-dd/yyyy';

  const [y1, m1, d1] = fromParts;
  const m1Str = String(m1).padStart(2, '0');
  const d1Str = String(d1).padStart(2, '0');
  const y1Short = String(y1).slice(-2);

  const actualDateTo = dateToStr || dateFromStr;
  const toParts = actualDateTo.split('-').map(Number);

  if (toParts.length !== 3 || toParts.some(Number.isNaN)) {
    return `${m1Str}/${d1Str}-${d1Str}/${y1Short}`;
  }

  const [y2, m2, d2] = toParts;
  const m2Str = String(m2).padStart(2, '0');
  const d2Str = String(d2).padStart(2, '0');
  const y2Short = String(y2).slice(-2);

  if (y1 === y2 && m1 === m2) {
    return `${m1Str}/${d1Str}-${d2Str}/${y1Short}`;
  }

  if (y1 === y2) {
    return `${m1Str}/${d1Str}-${m2Str}/${d2Str}/${y1Short}`;
  }

  return `${m1Str}/${d1Str}/${y1Short}-${m2Str}/${d2Str}/${y2Short}`;
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
  if (!value || value === NO_DAY_OFF_LABEL) {
    return value === NO_DAY_OFF_LABEL;
  }
  return parseDayOffList(value).length > 0 || dayOffOptions.includes(value);
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
  return value.trim().match(/^\d{1,2}(?::\d{2})?\s?(AM|PM)\s-\s\d{1,2}(?::\d{2})?\s?(AM|PM)$/i);
}

function normalizeSchedule(value?: string | null): string {
  if (!value) return NO_SCHEDULE_LABEL;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'no schedule' || lower === 'no_schedule' || lower === '') {
    return NO_SCHEDULE_LABEL;
  }
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (match) {
    const startHour = match[1];
    const startMin = match[2] || '00';
    const startAmPm = match[3].toUpperCase();
    const endHour = match[4];
    const endMin = match[5] || '00';
    const endAmPm = match[6].toUpperCase();
    return `${startHour}:${startMin}${startAmPm} - ${endHour}:${endMin}${endAmPm}`;
  }
  return trimmed;
}

function normalizeDayOff(value?: string | null): string {
  if (!value) return NO_DAY_OFF_LABEL;
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'NO DAY OFF' || upper === 'NO_DAY_OFF' || upper === '' || upper === 'NONE') {
    return NO_DAY_OFF_LABEL;
  }
  const parsed = parseDayOffList(trimmed);
  if (parsed.length > 0) {
    return parsed.join(', ');
  }
  return trimmed;
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
  type = 'date',
  error,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
  webValue?: string;
  onWebChange?: (value: string) => void;
  type?: 'date' | 'time';
  error?: string;
}) {
  const useWebNativeDate = Platform.OS === 'web' && onWebChange && !disabled;

  return (
    <View style={styles.textFieldWrap}>
      <FieldLabel label={label} />
      <Pressable disabled={disabled} style={[styles.selectButton, disabled ? styles.selectButtonDisabled : null, error ? styles.inputError : null]} onPress={useWebNativeDate ? undefined : onPress}>
        <Text style={[styles.selectButtonText, disabled ? styles.selectButtonTextDisabled : null, !value ? styles.placeholderText : null]}>{value || placeholder}</Text>
        {disabled ? null : <ChevronDown size={16} color={error ? colors.semantic.danger : '#94a3b8'} strokeWidth={2.4} />}
        {useWebNativeDate ? <WebNativeDateInput value={webValue ?? ''} label={label} onChange={onWebChange} type={type} /> : null}
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
  keyboardAvoider: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
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
  scheduleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  scheduleCardInvalid: {
    borderColor: colors.semantic.danger,
  },
  scheduleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.md,
  },
  scheduleCardTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
  },
  scheduleFieldGroup: {
    marginBottom: spacing.md,
  },
  scheduleFieldLabel: {
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    marginBottom: 6,
  },
  scheduleInputBox: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 8,
  },
  scheduleInputText: {
    flex: 1,
    color: '#334155',
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
  scheduleIconButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleTwoColumnRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  scheduleColumnField: {
    flex: 1,
  },
  entriesSectionContainer: {
    marginBottom: spacing.md,
  },
  entriesSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  entriesSectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
  },
  addEntryButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#eab308',
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
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
  underlineRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  underlineField: {
    flex: 1,
  },
  underlineFieldFull: {
    marginBottom: spacing.md,
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
  underlineText: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
  underlineTextPlaceholder: {
    color: '#94a3b8',
  },
  underlineLabel: {
    color: '#334155',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    marginTop: 4,
  },
  underlineTextInput: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 4,
    minHeight: 38,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: fontWeights.bold,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as any) : {}),
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
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
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
  scheduleInputTouchable: {
    flex: 1,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  scheduleActionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  customOptionRow: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  customOptionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  customOptionText: {
    color: colors.primary,
  },
  customScheduleModalPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  customScheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.md,
  },
  customScheduleIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#eab308',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customScheduleTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: fontWeights.heavy,
  },
  customScheduleSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  customTimeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  customTimeCol: {
    flex: 1,
  },
  customTimeLabel: {
    color: '#0f172a',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
    marginBottom: 6,
  },
  customTimeBox: {
    position: 'relative',
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  customTimeText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  customTimeColCard: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 10,
    justifyContent: 'center',
  },
  customTimeColCardActive: {
    borderColor: '#eab308',
    backgroundColor: '#fffbeb',
  },
  customTimeLabelActive: {
    color: '#92400e',
  },
  customTimeBoxInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inlineTimePickerContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 12,
    marginBottom: spacing.md,
    overflow: 'hidden',
    width: '100%',
  },
  inlineTimePickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 6,
    width: '100%',
  },
  inlineTimePickerHeader: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: '#475569',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  webTimePickerRow: {
    marginBottom: 10,
    alignItems: 'center',
  },
  timePresetsScrollView: {
    width: '100%',
  },
  timePresetsScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  presetTimePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: colors.surface,
  },
  presetTimePillActive: {
    borderColor: '#eab308',
    backgroundColor: '#eab308',
  },
  presetTimeText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#334155',
  },
  presetTimeTextActive: {
    color: '#0f172a',
  },
  customSchedulePreviewBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    padding: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  customSchedulePreviewLabel: {
    color: '#b45309',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  customSchedulePreviewValue: {
    color: '#92400e',
    fontSize: 20,
    lineHeight: 25,
    fontWeight: fontWeights.heavy,
    marginTop: 2,
  },
  customScheduleActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  transactionModalSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  transactionOptionCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  transactionDoneButton: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
});
