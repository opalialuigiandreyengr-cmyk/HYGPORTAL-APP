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
  ListChecks,
  WalletCards,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import type { AppToastMessage } from '../components/AppToast';
import { leaveCategoryOptions, leaveTypeOptions } from '../constants/requestOptions';
import { supabase } from '../lib/supabase';
import { colors, fontWeights, radius, spacing } from '../theme';
import { calculateLeaveDays, dateStringToDate, formatDateInput } from '../utils/dateTime';
import { getDisabledLeaveTypes, getLeaveBreakdown } from '../utils/requestCalculations';

type ValidationKey = 'dateFrom' | 'dateTo' | 'leaveType' | 'leaveCategory' | 'leaveDays' | 'split' | 'reason';
type SectionKey = 'dates' | 'details' | 'reason';

type RequestLeaveProps = {
  name?: string | null;
  photoUrl?: string | null;
  leaveCreditRemaining?: number;
  onBack?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSubmitted?: () => void | Promise<void>;
};

const today = formatDateInput(new Date());

const RequestLeave = ({
  name,
  photoUrl,
  leaveCreditRemaining = 7,
  onBack,
  onToast,
  onSubmitted,
}: RequestLeaveProps) => {
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [leaveType, setLeaveType] = useState('With Pay');
  const [leaveCategory, setLeaveCategory] = useState('Vacation Leave');
  const [paidLeaveDays, setPaidLeaveDays] = useState('1');
  const [unpaidLeaveDays, setUnpaidLeaveDays] = useState('0');
  const [reason, setReason] = useState('');
  const [activePicker, setActivePicker] = useState<'date_from' | 'date_to' | null>(null);
  const [activeSelect, setActiveSelect] = useState<'leave_type' | 'leave_category' | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [validationErrors, setValidationErrors] = useState<Partial<Record<ValidationKey, string>>>({});
  const [showReasonComposer, setShowReasonComposer] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const reasonComposerInputRef = useRef<TextInput | null>(null);
  const reasonFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionY = useRef<Record<SectionKey, number>>({ dates: 0, details: 0, reason: 0 });

  const totalLeaveDays = calculateLeaveDays(dateFrom, dateTo);
  const disabledLeaveTypes = getDisabledLeaveTypes(totalLeaveDays, leaveCreditRemaining);
  const leaveBreakdown = getLeaveBreakdown(leaveType, totalLeaveDays, paidLeaveDays, unpaidLeaveDays);
  const creditUsedPercent =
    leaveCreditRemaining > 0
      ? Math.min(100, Math.round((leaveBreakdown.paidDays / leaveCreditRemaining) * 100))
      : 0;

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
    if (!disabledLeaveTypes.includes(leaveType)) {
      return;
    }

    setLeaveType(disabledLeaveTypes.includes('Both') ? 'Without Pay' : 'Both');
  }, [disabledLeaveTypes, leaveType]);

  useEffect(() => {
    if (leaveType !== 'Both' || totalLeaveDays <= 0) {
      return;
    }

    const safePaidDays = Math.min(totalLeaveDays, Math.max(0, leaveCreditRemaining));
    setPaidLeaveDays(String(safePaidDays));
    setUnpaidLeaveDays(String(Math.round((totalLeaveDays - safePaidDays) * 100) / 100));
  }, [leaveCreditRemaining, leaveType, totalLeaveDays]);

  function valueForPicker(kind: 'date_from' | 'date_to') {
    return kind === 'date_to' ? dateStringToDate(dateTo) : dateStringToDate(dateFrom);
  }

  function openPicker(kind: 'date_from' | 'date_to') {
    setTempPickerDate(valueForPicker(kind));
    setActivePicker(kind);
  }

  function applyPickerValue(kind: 'date_from' | 'date_to', selectedDate: Date) {
    const value = formatDateInput(selectedDate);
    if (kind === 'date_from') {
      setDateFrom(value);
      setValidationErrors((current) => ({ ...current, dateFrom: undefined, dateTo: undefined, leaveDays: undefined }));
    } else {
      setDateTo(value);
      setValidationErrors((current) => ({ ...current, dateTo: undefined, leaveDays: undefined }));
    }
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
    if (activeSelect === 'leave_type') {
      setLeaveType(value);
      setValidationErrors((current) => ({ ...current, leaveType: undefined, split: undefined }));
    } else if (activeSelect === 'leave_category') {
      setLeaveCategory(value);
      setValidationErrors((current) => ({ ...current, leaveCategory: undefined }));
    }
    setActiveSelect(null);
  }

  function openReasonComposer() {
    setShowReasonComposer(true);
  }

  async function submit() {
    if (isSubmitting) {
      return;
    }

    const nextErrors = validateLeaveForm({
      dateFrom,
      dateTo,
      leaveType,
      leaveCategory,
      totalLeaveDays,
      leaveBreakdown,
      leaveCreditRemaining,
      reason,
    });
    setValidationErrors(nextErrors);

    const firstSection = getFirstInvalidSection(nextErrors);
    if (firstSection) {
      scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[firstSection] - 12), animated: true });
      if (firstSection === 'reason') {
        setTimeout(() => setShowReasonComposer(true), 260);
      }
      setSubmitStatus('Please complete all required fields.');
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('Submitting leave request...');

    try {
      const { data, error } = await supabase.rpc('submit_leave_request', {
        p_leave_type: leaveType.trim(),
        p_leave_category: leaveCategory.trim(),
        p_start_date: dateFrom,
        p_end_date: dateTo,
        p_paid_days: leaveBreakdown.paidDays,
        p_unpaid_days: leaveBreakdown.unpaidDays,
        p_reason: reason.trim(),
      });

      if (error) {
        throw new Error(error.message);
      }

      setSubmitStatus(`Submitted. Request ID: ${data}`);
      onToast?.({
        tone: 'success',
        title: 'Leave submitted',
        message: 'Your leave request was sent for approval.',
      });
      await onSubmitted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit leave request.';
      setSubmitStatus(`Failed: ${message}`);
      onToast?.({
        tone: 'error',
        title: 'Leave failed',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectSheet = getSelectSheet(activeSelect, leaveType, leaveCategory, disabledLeaveTypes);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar name={name} photoUrl={photoUrl} />
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
            <Text style={styles.title}>Request Leave</Text>
          </View>
        </View>

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
            This request uses {leaveBreakdown.paidDays.toFixed(2)} paid day(s) and{' '}
            {leaveBreakdown.unpaidDays.toFixed(2)} unpaid day(s).
          </Text>
        </View>

        <Section
          number="1"
          title="Date Range"
          icon={<CalendarDays size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'dates')}
          onLayoutY={(y) => {
            sectionY.current.dates = y;
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

          <FieldLabel label="Total No of Days" />
          <View style={[styles.disabledInput, validationErrors.leaveDays ? styles.inputError : null]}>
            <Text style={styles.disabledInputText}>{totalLeaveDays.toFixed(2)} day(s)</Text>
          </View>
          {validationErrors.leaveDays ? <Text style={styles.fieldError}>{validationErrors.leaveDays}</Text> : null}
        </Section>

        <Section
          number="2"
          title="Leave Details"
          icon={<ListChecks size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'details')}
          onLayoutY={(y) => {
            sectionY.current.details = y;
          }}
        >
          <PickerButton
            label="Leave type"
            value={leaveType}
            placeholder="Select leave type"
            onPress={() => setActiveSelect('leave_type')}
            error={validationErrors.leaveType}
          />
          <PickerButton
            label="Leave category"
            value={leaveCategory}
            placeholder="Select leave category"
            onPress={() => setActiveSelect('leave_category')}
            error={validationErrors.leaveCategory}
          />

          {leaveType === 'Both' ? (
            <View style={styles.twoColumn}>
              <TextField
                label="With Pay Days"
                value={paidLeaveDays}
                onChangeText={(value) => {
                  setPaidLeaveDays(value);
                  setValidationErrors((current) => ({ ...current, split: undefined }));
                }}
                placeholder="0"
                keyboardType="decimal-pad"
              />
              <TextField
                label="Without Pay Days"
                value={unpaidLeaveDays}
                onChangeText={(value) => {
                  setUnpaidLeaveDays(value);
                  setValidationErrors((current) => ({ ...current, split: undefined }));
                }}
                placeholder="0"
                keyboardType="decimal-pad"
              />
            </View>
          ) : null}

          <View style={[styles.summaryBox, validationErrors.split ? styles.inputError : null]}>
            <Text style={styles.summaryText}>
              With Pay {leaveBreakdown.paidDays.toFixed(2)}d | Without Pay {leaveBreakdown.unpaidDays.toFixed(2)}d
            </Text>
            <Text style={styles.summaryHint}>With Pay deducts credits after final approval.</Text>
          </View>
          {validationErrors.split ? <Text style={styles.fieldError}>{validationErrors.split}</Text> : null}
        </Section>

        <Section
          number="3"
          title="Reason"
          icon={<FileText size={18} color={colors.primary} />}
          invalid={hasSectionError(validationErrors, 'reason')}
          onLayoutY={(y) => {
            sectionY.current.reason = y;
          }}
        >
          <FieldLabel label="Reason for leave" />
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
      </ScrollView>

      {activePicker && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setActivePicker(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.iosPickerPanel}>
              <DateTimePicker
                value={tempPickerDate}
                mode="date"
                display="spinner"
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
        <DateTimePicker value={valueForPicker(activePicker)} mode="date" display="default" onChange={handlePickerChange} />
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
                    <Text
                      style={[
                        styles.optionText,
                        selected ? styles.optionTextActive : null,
                        disabled ? styles.optionTextDisabled : null,
                      ]}
                    >
                      {option}
                    </Text>
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
    </View>
  );
};

export default RequestLeave;

function validateLeaveForm({
  dateFrom,
  dateTo,
  leaveType,
  leaveCategory,
  totalLeaveDays,
  leaveBreakdown,
  leaveCreditRemaining,
  reason,
}: {
  dateFrom: string;
  dateTo: string;
  leaveType: string;
  leaveCategory: string;
  totalLeaveDays: number;
  leaveBreakdown: { paidDays: number; unpaidDays: number; isValid: boolean };
  leaveCreditRemaining: number;
  reason: string;
}) {
  const errors: Partial<Record<ValidationKey, string>> = {};

  if (!dateFrom) errors.dateFrom = 'Required';
  if (!dateTo) errors.dateTo = 'Required';
  if (dateFrom && dateTo && dateStringToDate(dateTo).getTime() < dateStringToDate(dateFrom).getTime()) {
    errors.dateTo = 'Date To cannot be earlier than Date From';
  }
  if (totalLeaveDays <= 0) errors.leaveDays = 'Required';
  if (!leaveTypeOptions.includes(leaveType)) errors.leaveType = 'Required';
  if (!leaveCategoryOptions.includes(leaveCategory)) errors.leaveCategory = 'Required';
  if (!leaveBreakdown.isValid) errors.split = `Paid and unpaid days must equal ${totalLeaveDays.toFixed(2)} day(s).`;
  if (leaveBreakdown.paidDays > leaveCreditRemaining) {
    errors.split = `Available paid leave is ${leaveCreditRemaining.toFixed(2)} day(s).`;
  }
  if (!reason.trim()) errors.reason = 'Required';

  return errors;
}

function getFirstInvalidSection(errors: Partial<Record<ValidationKey, string>>): SectionKey | null {
  if (errors.dateFrom || errors.dateTo || errors.leaveDays) return 'dates';
  if (errors.leaveType || errors.leaveCategory || errors.split) return 'details';
  if (errors.reason) return 'reason';
  return null;
}

function hasSectionError(errors: Partial<Record<ValidationKey, string>>, section: SectionKey) {
  return getFirstInvalidSection(
    section === 'dates'
      ? { dateFrom: errors.dateFrom, dateTo: errors.dateTo, leaveDays: errors.leaveDays }
      : section === 'details'
        ? { leaveType: errors.leaveType, leaveCategory: errors.leaveCategory, split: errors.split }
        : { reason: errors.reason },
  ) !== null;
}

function getSelectSheet(
  activeSelect: 'leave_type' | 'leave_category' | null,
  leaveType: string,
  leaveCategory: string,
  disabledLeaveTypes: string[],
) {
  if (activeSelect === 'leave_type') {
    return { title: 'Select leave type', value: leaveType, options: leaveTypeOptions, disabledOptions: disabledLeaveTypes };
  }
  if (activeSelect === 'leave_category') {
    return { title: 'Select leave category', value: leaveCategory, options: leaveCategoryOptions, disabledOptions: [] };
  }
  return null;
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

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={styles.textFieldWrap}>
      <FieldLabel label={label} />
      <View style={styles.inputShell}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          keyboardType={keyboardType}
          style={styles.textInput}
        />
      </View>
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
  title: {
    fontSize: 21,
    lineHeight: 26,
    color: colors.text,
    fontWeight: fontWeights.heavy,
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
  inputShell: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    marginBottom: spacing.md,
  },
  textInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
    minWidth: 0,
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
  optionRowDisabled: {
    opacity: 0.45,
    backgroundColor: '#f1f5f9',
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
  optionTextDisabled: {
    color: '#94a3b8',
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
