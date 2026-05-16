import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
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
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Info,
  ListChecks,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { dayOffOptions, payrollClassOptions, scheduleOptions } from '../constants/requestOptions';
import { supabase } from '../lib/supabase';
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

export function ApplyEsarfScreen({
  initials,
  onBack,
  onSubmitted,
}: {
  initials?: string;
  onBack: () => void;
  onSubmitted?: () => void;
}) {
  const [schedule, setSchedule] = useState('Select schedule');
  const [dayOff, setDayOff] = useState('Select day');
  const [payrollClass, setPayrollClass] = useState('Select payroll class');
  const [transactions, setTransactions] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [reason, setReason] = useState('');
  const [activePicker, setActivePicker] = useState<'date_from' | 'date_to' | 'time_from' | 'time_to' | null>(null);
  const [activeSelect, setActiveSelect] = useState<'schedule' | 'day_off' | 'payroll_class' | null>(null);
  const [showSubmissionNotes, setShowSubmissionNotes] = useState(false);
  const [showReasonComposer, setShowReasonComposer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [validationErrors, setValidationErrors] = useState<Partial<Record<ValidationKey, string>>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const scrollRef = useRef<ScrollView | null>(null);
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

  function applyPickerValue(kind: 'date_from' | 'date_to' | 'time_from' | 'time_to', selectedDate: Date) {
    if (kind === 'date_from') {
      setDateFrom(formatDateInput(selectedDate));
      setValidationErrors((current) => ({ ...current, dateFrom: undefined, totalHours: undefined }));
    } else if (kind === 'date_to') {
      setDateTo(formatDateInput(selectedDate));
      setValidationErrors((current) => ({ ...current, dateTo: undefined }));
    } else if (kind === 'time_from') {
      setTimeFrom(formatTimeInput(selectedDate));
      setValidationErrors((current) => ({ ...current, timeFrom: undefined, totalHours: undefined }));
    } else if (kind === 'time_to') {
      setTimeTo(formatTimeInput(selectedDate));
      setValidationErrors((current) => ({ ...current, timeTo: undefined, totalHours: undefined }));
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
  const totalHours = calculateRequestHours({
    requestType: 'overtime',
    dateFrom,
    timeFrom,
    timeTo,
    timeSchedule: scheduleOptions.includes(schedule) ? schedule : '',
    dayOff: dayOffOptions.includes(dayOff) ? dayOff : '',
  });

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
      reason,
    });
    setValidationErrors(nextErrors);

    const firstSection = getFirstInvalidSection(nextErrors);
      if (firstSection) {
      scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[firstSection] - 12), animated: true });
      if (firstSection === 'datetime' && nextErrors.reason) {
        setTimeout(() => setShowReasonComposer(true), 260);
      }
      setSubmitStatus('Please complete all required fields.');
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

      setSubmitStatus(`Submitted ${requestIds.length} request(s).`);
      onSubmitted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit ESARF.';
      setSubmitStatus(`Failed: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar initials={initials} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onBack}>
            <ArrowLeft size={20} color={colors.text} strokeWidth={2.5} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Apply ESARF</Text>
          </View>
          <Pressable style={styles.notesButton} onPress={() => setShowSubmissionNotes(true)}>
            <Info size={18} color={colors.primary} strokeWidth={2.6} />
          </Pressable>
        </View>

        <Section
          number="1"
          title="Request Information"
          icon={<FileText size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'request')}
          onLayoutY={(y) => {
            sectionY.current.request = y;
          }}
        >
          <PickerButton
            label="Time schedule"
            value={schedule}
            placeholder="Select schedule"
            onPress={() => setActiveSelect('schedule')}
            error={validationErrors.schedule}
          />

          <PickerButton
            label="Day off"
            value={dayOff}
            placeholder="Select day"
            onPress={() => setActiveSelect('day_off')}
            error={validationErrors.dayOff}
          />

          <PickerButton
            label="Payroll class"
            value={payrollClass}
            placeholder="Select payroll class"
            onPress={() => setActiveSelect('payroll_class')}
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
              const disabled = !selected && isTransactionDisabled(option.key, transactions);
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
          <View style={styles.twoColumn}>
            <PickerButton
              label="Date from"
              value={formatDateDisplay(dateFrom)}
              placeholder="mm/dd/yyyy"
              onPress={() => openPicker('date_from')}
              error={validationErrors.dateFrom}
            />
            <PickerButton
              label="Date to"
              value={formatDateDisplay(dateTo)}
              placeholder="mm/dd/yyyy"
              onPress={() => openPicker('date_to')}
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

          <FieldLabel label="Reason" />
          <Pressable
            style={[styles.reasonInput, validationErrors.reason ? styles.inputError : null]}
            onPress={() => setShowReasonComposer(true)}
          >
            <Text style={reason ? styles.reasonPreviewText : styles.reasonPlaceholderText}>
              {reason || 'Enter reason'}
            </Text>
          </Pressable>
          {validationErrors.reason ? <Text style={styles.fieldError}>{validationErrors.reason}</Text> : null}
        </Section>

        <View style={styles.actions}>
          <Pressable disabled={isSubmitting} style={styles.cancelButton} onPress={onBack}>
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
        >
          <View style={styles.composerBackdrop}>
            <Pressable style={styles.composerDismissArea} onPress={() => setShowReasonComposer(false)} />
            <View style={[styles.reasonComposer, { marginBottom: keyboardHeight }]}>
              <TextInput
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
  reason,
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
  reason: string;
}) {
  const errors: Partial<Record<ValidationKey, string>> = {};

  if (!scheduleOptions.includes(schedule)) errors.schedule = 'Required';
  if (!dayOffOptions.includes(dayOff)) errors.dayOff = 'Required';
  if (!payrollClassOptions.includes(payrollClass)) errors.payrollClass = 'Required';
  if (!transactions.length) errors.transactions = 'Required';
  if (!dateFrom) errors.dateFrom = 'Required';
  if (!dateTo) errors.dateTo = 'Required';
  if (dateFrom && dateTo && dateStringToDate(dateTo).getTime() < dateStringToDate(dateFrom).getTime()) {
    errors.dateTo = 'Date To cannot be earlier than Date From';
  }
  if (!timeFrom) errors.timeFrom = 'Required';
  if (!timeTo) errors.timeTo = 'Required';
  if (dateFrom && timeFrom && timeTo && totalHours <= 0) errors.totalHours = 'Required';
  if (!reason.trim()) errors.reason = 'Required';

  return errors;
}

function getFirstInvalidSection(errors: Partial<Record<ValidationKey, string>>): SectionKey | null {
  if (errors.schedule || errors.dayOff || errors.payrollClass) return 'request';
  if (errors.transactions) return 'transactions';
  if (errors.dateFrom || errors.dateTo || errors.timeFrom || errors.timeTo || errors.totalHours || errors.reason) {
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
  error,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  error?: string;
}) {
  return (
    <View style={styles.textFieldWrap}>
      <FieldLabel label={label} />
      <Pressable style={[styles.selectButton, error ? styles.inputError : null]} onPress={onPress}>
        <Text style={[styles.selectButtonText, !value ? styles.placeholderText : null]}>{value || placeholder}</Text>
        <ChevronDown size={16} color={error ? colors.semantic.danger : '#94a3b8'} strokeWidth={2.4} />
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
    paddingBottom: 110,
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
    paddingBottom: 0,
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
