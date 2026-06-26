import { StatusBar } from 'expo-status-bar';
import { createElement, useState, type CSSProperties } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarDays, CheckCircle2, ChevronLeft, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react-native';

import { AppScreen, Card } from '../components/ui';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  normalizeUsername,
  registerEmployeeLoginAccount,
  verifyEmployeeForRegistration,
  type EmployeeRegistrationVerification,
} from '../services/registerAccount';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { dateStringToDate, formatDateInput } from '../utils/dateTime';

const hygLogo = require('../../assets/HYG LOGO.png');

type RegisterAccountScreenProps = {
  onBack: () => void;
};

type VerifyForm = {
  firstName: string;
  lastName: string;
  middleName: string;
  birthDate: string;
  email: string;
};

type AccountForm = {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
};

const initialVerifyForm: VerifyForm = {
  firstName: '',
  lastName: '',
  middleName: '',
  birthDate: '',
  email: '',
};

const initialAccountForm: AccountForm = {
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  termsAccepted: false,
};

export function RegisterAccountScreen({ onBack }: RegisterAccountScreenProps) {
  const [step, setStep] = useState<0 | 1>(0);
  const [verifyForm, setVerifyForm] = useState(initialVerifyForm);
  const [accountForm, setAccountForm] = useState(initialAccountForm);
  const [showVerifyErrors, setShowVerifyErrors] = useState(false);
  const [showAccountErrors, setShowAccountErrors] = useState(false);
  const [verifiedEmployee, setVerifiedEmployee] = useState<EmployeeRegistrationVerification | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [busyTitle, setBusyTitle] = useState('');
  const [successVisible, setSuccessVisible] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState('');
  const [activeDatePicker, setActiveDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const verifyMissing = !verifyForm.firstName.trim() || !verifyForm.lastName.trim() || !verifyForm.birthDate.trim();
  const accountMissing =
    !accountForm.username.trim() ||
    !accountForm.email.trim() ||
    !accountForm.password ||
    accountForm.password !== accountForm.confirmPassword ||
    !accountForm.termsAccepted;

  function updateVerifyField(field: keyof VerifyForm, value: string) {
    setVerifyForm((current) => ({ ...current, [field]: value }));
  }

  function updateAccountField(field: keyof AccountForm, value: string | boolean) {
    setAccountForm((current) => ({ ...current, [field]: value }));
  }

  function openBirthDatePicker() {
    setTempDate(dateStringToDate(verifyForm.birthDate || formatDateInput(new Date())));
    setActiveDatePicker(true);
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setActiveDatePicker(false);
      return;
    }

    if (!selectedDate) {
      return;
    }

    if (Platform.OS === 'ios') {
      setTempDate(selectedDate);
      return;
    }

    setVerifyForm((current) => ({ ...current, birthDate: formatDateInput(selectedDate) }));
    setActiveDatePicker(false);
  }

  function confirmIosDate() {
    setVerifyForm((current) => ({ ...current, birthDate: formatDateInput(tempDate) }));
    setActiveDatePicker(false);
  }

  async function verifyEmployee() {
    setShowVerifyErrors(true);
    if (verifyMissing) {
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert('Supabase is not configured', 'Check the mobile .env file.');
      return;
    }

    setIsBusy(true);
    setBusyTitle('Verifying employee');
    setVerifyStatus('');

    try {
      const result = await verifyEmployeeForRegistration(normalizeVerifyFormForSubmit(verifyForm));
      if (!result.verified || !result.employee_id) {
        setVerifyStatus(result.message || 'No employee profile matched the details entered.');
        return;
      }

      setVerifiedEmployee(result);
      setStep(1);
    } catch (error) {
      Alert.alert('Verification failed', error instanceof Error ? error.message : 'Unable to verify employee profile.');
    } finally {
      setIsBusy(false);
    }
  }

  async function registerAccount() {
    setShowAccountErrors(true);
    if (accountMissing || !verifiedEmployee?.employee_id) {
      return;
    }

    if (!normalizeUsername(accountForm.username)) {
      Alert.alert('Check username', 'Use letters or numbers in your username.');
      return;
    }

    setIsBusy(true);
    setBusyTitle('Creating account');

    try {
      await registerEmployeeLoginAccount({
        employeeId: verifiedEmployee.employee_id,
        username: accountForm.username,
        email: accountForm.email,
        password: accountForm.password,
        termsAccepted: accountForm.termsAccepted,
      });
      setSuccessVisible(true);
    } catch (error) {
      Alert.alert('Registration failed', error instanceof Error ? error.message : 'Unable to create login account.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AppScreen variant="dark" keyboardAware>
      <StatusBar style="light" />
      <Pressable style={styles.backButton} onPress={step === 0 ? onBack : () => setStep(0)}>
        <ChevronLeft size={18} color="#94a3b8" strokeWidth={2.6} />
        <Text style={styles.backText}>{step === 0 ? 'Sign In' : 'Back'}</Text>
      </Pressable>

      <Card variant="brand">
        <View style={styles.brandRow}>
          <View style={styles.logoFrame}>
            <Image source={hygLogo} style={styles.logo} resizeMode="contain" />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.kicker}>Employee Account</Text>
            <Text style={styles.heroTitle}>{step === 0 ? 'Verify your employee profile.' : 'Create your login account.'}</Text>
          </View>
        </View>
        <Text style={styles.heroCopy}>
          {step === 0
            ? 'Enter the details from your existing employee profile.'
            : 'Use these credentials when signing in to the portal.'}
        </Text>
      </Card>

      <View style={styles.formOffset}>
        <Card>
          {step === 0 ? (
            <>
              <FormTextField
                label="First Name *"
                value={verifyForm.firstName}
                onChangeText={(value) => updateVerifyField('firstName', value)}
                autoCapitalize="words"
                autoCorrect={false}
                error={showVerifyErrors && !verifyForm.firstName.trim() ? 'Required' : ''}
              />
              <FormTextField
                label="Last Name *"
                value={verifyForm.lastName}
                onChangeText={(value) => updateVerifyField('lastName', value)}
                autoCapitalize="words"
                autoCorrect={false}
                error={showVerifyErrors && !verifyForm.lastName.trim() ? 'Required' : ''}
              />
              <FormTextField
                label="Middle Name"
                value={verifyForm.middleName}
                onChangeText={(value) => updateVerifyField('middleName', value)}
                autoCapitalize="words"
                autoCorrect={false}
              />
              <Text style={styles.inputLabel}>Birthday *</Text>
              {Platform.OS === 'web' ? (
                <WebDateInput
                  value={verifyForm.birthDate}
                  hasError={showVerifyErrors && !verifyForm.birthDate.trim()}
                  onChange={(value) => setVerifyForm((current) => ({ ...current, birthDate: value }))}
                />
              ) : (
                <Pressable
                  style={[
                    styles.dateButton,
                    showVerifyErrors && !verifyForm.birthDate.trim() ? styles.inputInvalid : null,
                    showVerifyErrors && !verifyForm.birthDate.trim() ? styles.inputWithError : null,
                  ]}
                  onPress={openBirthDatePicker}
                >
                  <CalendarDays size={16} color={colors.muted} strokeWidth={2.5} />
                  <Text style={[styles.dateButtonText, !verifyForm.birthDate ? styles.placeholderText : null]}>
                    {verifyForm.birthDate || 'Select birthday'}
                  </Text>
                </Pressable>
              )}
              {showVerifyErrors && !verifyForm.birthDate.trim() ? <Text style={styles.fieldError}>Required</Text> : null}
              <FormTextField
                label="Email Address"
                value={verifyForm.email}
                onChangeText={(value) => setVerifyForm((current) => ({ ...current, email: value }))}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Pressable disabled={isBusy} style={[styles.primaryButton, isBusy ? styles.disabledAction : null]} onPress={verifyEmployee}>
                <UserRound size={17} color={colors.brand.ink} strokeWidth={2.7} />
                <Text style={styles.primaryButtonText}>Verify</Text>
              </Pressable>
              {verifyStatus ? <InlineStatus message={verifyStatus} /> : null}
            </>
          ) : (
            <>
              <View style={styles.verifiedBox}>
                <CheckCircle2 size={18} color={colors.semantic.success} strokeWidth={2.6} />
                <Text style={styles.verifiedText}>{verifiedEmployee?.full_name || 'Employee verified'}</Text>
              </View>
              <FormTextField
                label="Username *"
                icon={<UserRound size={16} color={colors.muted} strokeWidth={2.5} />}
                value={accountForm.username}
                onChangeText={(value) => updateAccountField('username', value)}
                keyboardType="default"
                autoCapitalize="none"
                error={showAccountErrors && !accountForm.username.trim() ? 'Required' : ''}
              />
              <FormTextField
                label="Email Address *"
                icon={<Mail size={16} color={colors.muted} strokeWidth={2.5} />}
                value={accountForm.email}
                onChangeText={(value) => updateAccountField('email', value)}
                keyboardType="email-address"
                autoCapitalize="none"
                error={showAccountErrors && !accountForm.email.trim() ? 'Required' : ''}
              />
              <FormTextField
                label="Password *"
                icon={<LockKeyhole size={16} color={colors.muted} strokeWidth={2.5} />}
                rightIcon={
                  <Pressable style={styles.eyeButton} onPress={() => setShowPassword((current) => !current)} hitSlop={8}>
                    {showPassword ? (
                      <EyeOff size={17} color={colors.muted} strokeWidth={2.5} />
                    ) : (
                      <Eye size={17} color={colors.muted} strokeWidth={2.5} />
                    )}
                  </Pressable>
                }
                value={accountForm.password}
                onChangeText={(value) => updateAccountField('password', value)}
                secureTextEntry={!showPassword}
                error={showAccountErrors && !accountForm.password ? 'Required' : ''}
              />
              <FormTextField
                label="Confirm Password *"
                icon={<LockKeyhole size={16} color={colors.muted} strokeWidth={2.5} />}
                rightIcon={
                  <Pressable style={styles.eyeButton} onPress={() => setShowConfirmPassword((current) => !current)} hitSlop={8}>
                    {showConfirmPassword ? (
                      <EyeOff size={17} color={colors.muted} strokeWidth={2.5} />
                    ) : (
                      <Eye size={17} color={colors.muted} strokeWidth={2.5} />
                    )}
                  </Pressable>
                }
                value={accountForm.confirmPassword}
                onChangeText={(value) => updateAccountField('confirmPassword', value)}
                secureTextEntry={!showConfirmPassword}
                error={passwordMatchMessage(accountForm)}
              />
              <Pressable
                style={styles.termsRow}
                onPress={() => updateAccountField('termsAccepted', !accountForm.termsAccepted)}
              >
                <View style={[styles.checkbox, accountForm.termsAccepted ? styles.checkboxActive : null]}>
                  {accountForm.termsAccepted ? <CheckCircle2 size={14} color={colors.brand.ink} strokeWidth={3} /> : null}
                </View>
                <Text style={styles.termsText}>I accept the terms and conditions.</Text>
              </Pressable>
              {showAccountErrors && !accountForm.termsAccepted ? <Text style={styles.fieldError}>Required</Text> : null}
              <Pressable disabled={isBusy} style={[styles.primaryButton, isBusy ? styles.disabledAction : null]} onPress={registerAccount}>
                <Text style={styles.primaryButtonText}>Register Account</Text>
              </Pressable>
            </>
          )}
        </Card>
      </View>

      <DatePickerModal
        visible={activeDatePicker}
        value={Platform.OS === 'ios' ? tempDate : dateStringToDate(verifyForm.birthDate || formatDateInput(new Date()))}
        onChange={handleDateChange}
        onCancel={() => setActiveDatePicker(false)}
        onDone={confirmIosDate}
      />
      <LoadingOverlay visible={isBusy} title={busyTitle} />
      <SuccessModal
        visible={successVisible}
        onDone={() => {
          setSuccessVisible(false);
          onBack();
        }}
      />
    </AppScreen>
  );
}

function FormTextField({
  label,
  icon,
  rightIcon,
  error,
  style,
  ...inputProps
}: TextInputProps & { label: string; icon?: React.ReactNode; rightIcon?: React.ReactNode; error?: string }) {
  return (
    <>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={[styles.inputShell, error ? styles.inputInvalid : null, error ? styles.inputWithError : null]}>
        {icon}
        <TextInput
          placeholderTextColor="#94a3b8"
          {...inputProps}
          style={[styles.input, icon ? styles.inputWithIcon : null, style]}
        />
        {rightIcon}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </>
  );
}

function passwordMatchMessage(accountForm: AccountForm) {
  if (!accountForm.confirmPassword) {
    return '';
  }

  return accountForm.password === accountForm.confirmPassword ? '' : 'Passwords do not match';
}

function normalizeVerifyFormForSubmit(form: VerifyForm): VerifyForm {
  return {
    ...form,
    firstName: normalizeRegistrationNamePart(form.firstName),
    lastName: normalizeRegistrationNamePart(form.lastName),
    middleName: normalizeRegistrationNamePart(form.middleName),
    email: form.email.trim().toLowerCase(),
  };
}

function normalizeRegistrationNamePart(value: string) {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

function DatePickerModal({
  visible,
  value,
  onChange,
  onCancel,
  onDone,
}: {
  visible: boolean;
  value: Date;
  onChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  if (!visible) {
    return null;
  }

  if (Platform.OS !== 'ios') {
    return <DateTimePicker value={value} mode="date" display="default" onChange={onChange} />;
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.optionSheet}>
          <DateTimePicker value={value} mode="date" display="spinner" onChange={onChange} style={styles.iosWheelPicker} />
          <View style={styles.dateActions}>
            <Pressable style={styles.dateCancel} onPress={onCancel}>
              <Text style={styles.dateCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.dateDone} onPress={onDone}>
              <Text style={styles.dateDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WebDateInput({
  value,
  hasError,
  onChange,
}: {
  value: string;
  hasError?: boolean;
  onChange: (value: string) => void;
}) {
  return createElement('input', {
    type: 'date',
    value,
    max: formatDateInput(new Date()),
    onChange: (event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value),
    style: {
      ...webDateInputStyle,
      ...(hasError ? webDateInputErrorStyle : null),
    },
  });
}

const webDateInputStyle: CSSProperties = {
  minHeight: 46,
  width: '100%',
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surface,
  color: colors.text,
  fontSize: 15,
  fontWeight: fontWeights.bold,
  marginBottom: spacing.sm,
  padding: `0 ${spacing.md}px`,
  boxSizing: 'border-box',
  outline: 'none',
};

const webDateInputErrorStyle: CSSProperties = {
  borderColor: colors.semantic.danger,
  marginBottom: 4,
};

function LoadingOverlay({ visible, title }: { visible: boolean; title: string }) {
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.loadingBackdrop}>
        <View style={styles.loadingPanel}>
          <ActivityIndicator size="large" color={colors.brand.gold} />
          <Text style={styles.loadingTitle}>{title}</Text>
          <Text style={styles.loadingText}>Please wait while we process your registration.</Text>
        </View>
      </View>
    </Modal>
  );
}

function SuccessModal({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDone}>
      <View style={styles.successBackdrop}>
        <View style={styles.successPanel}>
          <View style={styles.successIcon}>
            <Image source={hygLogo} style={styles.successLogo} resizeMode="contain" />
          </View>
          <Text style={styles.successTitle}>Account registered</Text>
          <Text style={styles.successText}>Your login account has been created successfully.</Text>
          <Pressable style={styles.successButton} onPress={onDone}>
            <Text style={styles.successButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function InlineStatus({ message }: { message: string }) {
  return (
    <View style={styles.inlineStatus}>
      <Text style={styles.inlineStatusTitle}>Employee not verified</Text>
      <Text style={styles.inlineStatusText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    marginBottom: spacing.sm,
  },
  backText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logoFrame: {
    width: 82,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.brand.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    overflow: 'hidden',
  },
  logo: {
    width: 76,
    height: 52,
  },
  brandText: {
    flex: 1,
  },
  kicker: {
    ...typography.label,
    color: colors.brand.gold,
    fontSize: 11,
    marginBottom: 3,
  },
  heroTitle: {
    ...typography.hero,
    color: '#f8fafc',
  },
  heroCopy: {
    ...typography.body,
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
  },
  formOffset: {
    marginTop: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  inputShell: {
    minHeight: 46,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  inputWithIcon: {
    paddingLeft: spacing.sm,
  },
  eyeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputInvalid: {
    borderColor: colors.semantic.danger,
  },
  inputWithError: {
    marginBottom: 4,
  },
  fieldError: {
    color: colors.semantic.danger,
    fontSize: 11,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.sm,
  },
  dateButton: {
    minHeight: 46,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dateButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
    marginLeft: spacing.xs,
  },
  placeholderText: {
    color: colors.muted,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: colors.brand.ink,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
    marginLeft: spacing.xs,
  },
  disabledAction: {
    opacity: 0.7,
  },
  inlineStatus: {
    borderRadius: radius.md,
    borderColor: '#fecaca',
    borderWidth: 1,
    backgroundColor: '#fef2f2',
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  inlineStatusTitle: {
    color: colors.semantic.danger,
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    marginBottom: 3,
  },
  inlineStatusText: {
    color: '#991b1b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.semibold,
  },
  verifiedBox: {
    borderRadius: radius.md,
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  verifiedText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: fontWeights.bold,
    marginLeft: spacing.xs,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  checkboxActive: {
    backgroundColor: colors.brand.gold,
    borderColor: colors.brand.gold,
  },
  termsText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.semibold,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    padding: spacing.md,
  },
  optionSheet: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: 'hidden',
  },
  iosWheelPicker: {
    height: 178,
  },
  dateActions: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.sm,
  },
  dateCancel: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  dateCancelText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
  dateDone: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginLeft: spacing.xs,
  },
  dateDoneText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
  loadingBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    padding: spacing.lg,
  },
  loadingPanel: {
    width: '100%',
    maxWidth: 320,
    borderRadius: radius.md,
    backgroundColor: colors.brand.panel,
    borderColor: colors.brand.line,
    borderWidth: 1,
    alignItems: 'center',
    padding: spacing.lg,
  },
  loadingTitle: {
    color: colors.brand.white,
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    marginTop: spacing.md,
  },
  loadingText: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  successBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    padding: spacing.lg,
  },
  successPanel: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    padding: spacing.lg,
  },
  successIcon: {
    width: 92,
    height: 66,
    borderRadius: radius.md,
    backgroundColor: colors.brand.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  successLogo: {
    width: 86,
    height: 58,
  },
  successTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
  },
  successText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  successButton: {
    alignSelf: 'stretch',
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  successButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
});
