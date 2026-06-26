import { createElement, type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { BriefcaseBusiness, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Send, UserRound, X } from 'lucide-react-native';

import { AppScreen, Card, Divider } from '../components/ui';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  checkEmployeeProfileDuplicate,
  createEmployeeProfile,
  loadEmployeeAssignmentOptions,
  loadEmployeeCompanyOptions,
  loadEmployeeStoreOptions,
  type EmployeeAssignmentOption,
  type EmployeeStoreOption,
} from '../services/createProfile';
import { uploadEmployeeDocumentToDrive, type EmployeeDocType, type UploadedDocRef } from '../services/gdriveDocs';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { env } from '../lib/env';
import { dateStringToDate, formatDateInput } from '../utils/dateTime';

const hygLogo = require('../../assets/HYG LOGO.png');

type CreateEmployeeProfileScreenProps = {
  onBack: () => void;
};

type FormState = {
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  birthDate: string;
  gender: string;
  civilStatus: string;
  cellphone: string;
  email: string;
  company: string;
  workUnit: string;
  store: string;
  tin: string;
  sss: string;
  pagibig: string;
  philhealth: string;
  bankType: string;
  accountNo: string;
  education: string;
  presentAddress: string;
  emergencyContact: string;
  emergencyContactNo: string;
};

type DocumentCaptureState = {
  uploading: boolean;
  ref?: UploadedDocRef;
  error?: string;
  localUri?: string;
  pending?: {
    uri: string;
    base64: string;
    mimeType: string;
    fileName: string;
  };
};

const initialForm: FormState = {
  lastName: '',
  firstName: '',
  middleName: '',
  suffix: '',
  birthDate: '',
  gender: 'Male',
  civilStatus: 'Single',
  cellphone: '',
  email: '',
  company: '',
  workUnit: '',
  store: 'N/A',
  tin: '',
  sss: '',
  pagibig: '',
  philhealth: '',
  bankType: 'BDO',
  accountNo: '',
  education: 'College',
  presentAddress: '',
  emergencyContact: '',
  emergencyContactNo: '',
};

const genderOptions = ['Male', 'Female', 'Other'];
const civilStatusOptions = ['Single', 'Married', 'Separated', 'Widowed'];
const fallbackWorkUnitOptions = [
  'IT',
  'Maintenance',
  'Logistics',
  'ACCOUNTING AND INVENTORY',
  'Accounting',
  'Inventory',
  'Operations',
  'HR',
  'Marketing',
  'Admin',
  'Customer Service',
];
const bankOptions = ['BDO', 'BPI', 'Metrobank', 'LandBank', 'Security Bank', 'UnionBank', 'Other'];

function normalizedOption(value: string) {
  return value.trim().toLowerCase();
}

export function CreateEmployeeProfileScreen({ onBack }: CreateEmployeeProfileScreenProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [activeSelect, setActiveSelect] = useState<SelectConfig | null>(null);
  const [iosSelectValue, setIosSelectValue] = useState('');
  const [pressedOption, setPressedOption] = useState('');
  const [activeDateField, setActiveDateField] = useState<'birthDate' | null>(null);
  const [tempDate, setTempDate] = useState(new Date());
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);
  const [showAssignmentErrors, setShowAssignmentErrors] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [liveDuplicateMessage, setLiveDuplicateMessage] = useState('');
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [assignmentOptions, setAssignmentOptions] = useState<EmployeeAssignmentOption[]>([]);
  const [storeOptions, setStoreOptions] = useState<EmployeeStoreOption[]>([]);
  const [submitStatus, setSubmitStatus] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [savePhase, setSavePhase] = useState('Preparing...');
  const [docState, setDocState] = useState<Record<EmployeeDocType, DocumentCaptureState>>({
    tin: { uploading: false },
    sss: { uploading: false },
    pagibig: { uploading: false },
    philhealth: { uploading: false },
    bank: { uploading: false },
  });

  const age = useMemo(() => calculateAge(form.birthDate), [form.birthDate]);
  const workUnitOptions = useMemo(() => {
    const departmentNames = Array.from(new Set(assignmentOptions.map((option) => option.department_name).filter(Boolean)));
    return departmentNames.length ? departmentNames : fallbackWorkUnitOptions;
  }, [assignmentOptions]);
  const companyStoreOptions = useMemo(
    () => [
      'N/A',
      ...storeOptions
        .filter((option) => normalizedOption(option.company_name) === normalizedOption(form.company))
        .map((option) => option.store_name),
    ],
    [storeOptions, form.company],
  );
  const reviewName = useMemo(() => {
    const givenName = [form.firstName, form.middleName, form.suffix]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    return [form.lastName.trim(), givenName].filter(Boolean).join(', ');
  }, [form.lastName, form.firstName, form.middleName, form.suffix]);
  const requiredMissing = !form.lastName.trim() || !form.firstName.trim() || !form.cellphone.trim();
  const assignmentMissing = !form.company.trim() || !form.workUnit.trim() || !form.store.trim();

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateNameField(field: keyof FormState, value: string) {
    updateField(field, value);
  }

  useEffect(() => {
    const hasName = form.lastName.trim() && form.firstName.trim();
    if (!hasName || !isSupabaseConfigured) {
      setLiveDuplicateMessage('');
      return;
    }

    const timeout = setTimeout(() => {
      checkEmployeeProfileDuplicate(normalizeNameFieldsForSave(form))
        .then((duplicate) => {
          if (duplicate.duplicate_name) {
            setLiveDuplicateMessage('An employee profile with this full name already exists.');
            return;
          }

          setLiveDuplicateMessage('');
        })
        .catch(() => {
          setLiveDuplicateMessage('');
        });
    }, 450);

    return () => clearTimeout(timeout);
  }, [form.lastName, form.firstName, form.middleName, form.suffix, form.email]);

  function openSelect(config: SelectConfig) {
    setActiveSelect(config);
    setIosSelectValue(form[config.field]);
    setPressedOption('');
  }

  useEffect(() => {
    Promise.all([
      loadEmployeeCompanyOptions(),
      loadEmployeeAssignmentOptions(),
      loadEmployeeStoreOptions(),
    ])
      .then(([companies, assignments, stores]) => {
        const names = Array.from(new Set(companies.map((option) => option.company_name).filter(Boolean)));
        if (!names.length) {
          setCompanyOptions([]);
          setForm((current) => ({ ...current, company: '' }));
          return;
        }

        const companyNamesWithStores = new Set(stores.map((option) => normalizedOption(option.company_name)));
        const firstCompanyWithStores = names.find((name) => companyNamesWithStores.has(normalizedOption(name)));

        setCompanyOptions(names);
        setAssignmentOptions(assignments);
        setStoreOptions(stores);
        setForm((current) => {
          const currentCompanyHasStores = companyNamesWithStores.has(normalizedOption(current.company));
          return currentCompanyHasStores
            ? current
            : { ...current, company: firstCompanyWithStores || names[0], store: 'N/A' };
        });
      })
      .catch(() => {
        setCompanyOptions([]);
        setAssignmentOptions([]);
        setStoreOptions([]);
      });
  }, []);

  useEffect(() => {
    if (!companyStoreOptions.includes(form.store)) {
      setForm((current) => ({ ...current, store: 'N/A' }));
    }
  }, [form.company, companyStoreOptions, form.store]);

  function openDatePicker(field: 'birthDate') {
    setTempDate(dateStringToDate(form[field] || formatDateInput(new Date())));
    setActiveDateField(field);
  }

  function updateDocState(docType: EmployeeDocType, updater: (current: DocumentCaptureState) => DocumentCaptureState) {
    setDocState((current) => ({ ...current, [docType]: updater(current[docType]) }));
  }

  async function captureAndUploadDocument(docType: EmployeeDocType) {
    if (!form.company.trim() || !form.workUnit.trim()) {
      Alert.alert('Missing assignment', 'Please select company and department first in Employment step.');
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'Please allow camera access to capture document photos.');
      return;
    }

    const photo = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      allowsEditing: false,
      base64: true,
      exif: false,
    });
    if (photo.canceled || !photo.assets?.length) {
      return;
    }

    const asset = photo.assets[0];
    const capturedBase64 = asset.base64 ?? '';
    if (!capturedBase64 || !asset.uri) {
      Alert.alert('Capture failed', 'Unable to read captured image.');
      return;
    }

    const timestamp = Date.now();
    const fileExt = asset.mimeType?.includes('png') ? 'png' : 'jpg';
    const safeCompany = form.company.trim() || 'COMPANY';
    const safeDepartment = form.workUnit.trim() || 'DEPARTMENT';
    const fileName = `${docType}_${safeCompany}_${safeDepartment}_${timestamp}.${fileExt}`;

    try {
      updateDocState(docType, () => ({
        uploading: false,
        error: undefined,
        localUri: asset.uri,
        pending: {
          uri: asset.uri,
          base64: capturedBase64,
          mimeType: asset.mimeType || (fileExt === 'png' ? 'image/png' : 'image/jpeg'),
          fileName,
        },
      }));
      setSubmitStatus(`${docType.toUpperCase()} document attached. Will upload on submit.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.';
      updateDocState(docType, (current) => ({ ...current, uploading: false, error: message }));
      setSubmitStatus(`Upload failed: ${message}`);
      Alert.alert('Upload failed', message);
    }
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setActiveDateField(null);
      return;
    }

    if (!selectedDate || !activeDateField) {
      return;
    }

    if (Platform.OS === 'ios') {
      setTempDate(selectedDate);
      return;
    }

    updateField(activeDateField, formatDateInput(selectedDate));
    setActiveDateField(null);
  }

  function confirmIosDate() {
    if (activeDateField) {
      updateField(activeDateField, formatDateInput(tempDate));
    }
    setActiveDateField(null);
  }

  async function goNext() {
    if (step === 0 && requiredMissing) {
      setShowRequiredErrors(true);
      return;
    }

    if (step === 0) {
      if (!isSupabaseConfigured) {
        Alert.alert('Supabase is not configured', 'Check the mobile .env file.');
        return;
      }

      setIsCheckingDuplicate(true);
      try {
          const duplicate = await checkEmployeeProfileDuplicate(normalizeNameFieldsForSave(form));
        if (duplicate.duplicate_name || duplicate.duplicate_email) {
          const message = duplicate.duplicate_name && duplicate.duplicate_email
            ? 'An employee profile with this name and email address already exists.'
            : duplicate.duplicate_name
              ? 'An employee profile with this full name already exists.'
              : 'An employee profile with this email address already exists.';
          Alert.alert('Profile already exists', message);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to check for duplicate profiles.';
        Alert.alert('Duplicate check failed', message);
        return;
      } finally {
        setIsCheckingDuplicate(false);
      }
    }

    if (step === 1 && assignmentMissing) {
      setShowAssignmentErrors(true);
      return;
    }

    if (step === 0) {
      setShowRequiredErrors(false);
    }
    if (step === 1) {
      setShowAssignmentErrors(false);
    }

    setStep((current) => Math.min(current + 1, profileSteps.length - 1));
  }

  async function submitProfile() {
    if (!isSupabaseConfigured) {
      Alert.alert('Supabase is not configured', 'Check the mobile .env file.');
      return;
    }

    if (isSavingProfile) {
      return;
    }

    setIsSavingProfile(true);
    setSaveProgress(0);
    setSavePhase('Preparing...');
    setSubmitStatus('Saving employee profile...');

    try {
      const rootFolderId = env.googleDriveRootFolderId.trim();
      const docsToUpload = (Object.keys(docState) as EmployeeDocType[]).filter((docType) => docState[docType].pending);
      const uploadedRefs: Partial<Record<EmployeeDocType, UploadedDocRef>> = {};

      if (docsToUpload.length) {
        if (!env.googleDriveScriptUrl.trim()) {
          throw new Error('Google Drive upload is not configured. Set EXPO_PUBLIC_GDRIVE_SCRIPT_URL.');
        }
        let uploadedCount = 0;
        for (const docType of docsToUpload) {
          const pending = docState[docType].pending;
          if (!pending) continue;
          setSavePhase(`Uploading ${docType.toUpperCase()} document (${uploadedCount + 1}/${docsToUpload.length})...`);
          setSaveProgress(uploadedCount / (docsToUpload.length + 1));
          updateDocState(docType, (current) => ({ ...current, uploading: true, error: undefined }));

          const uploaded = await uploadEmployeeDocumentToDrive({
            rootFolderId,
            company: form.company.trim(),
            department: form.workUnit.trim(),
            docType,
            fileName: pending.fileName,
            mimeType: pending.mimeType,
            base64Data: pending.base64,
          });

          uploadedRefs[docType] = uploaded;
          uploadedCount += 1;
          updateDocState(docType, (current) => ({
            ...current,
            uploading: false,
            pending: undefined,
            ref: uploaded,
          }));
        }
      }

      setSavePhase('Saving employee profile...');
      setSaveProgress(docsToUpload.length ? docsToUpload.length / (docsToUpload.length + 1) : 0.8);
      const documentRefs = Object.fromEntries(
        (Object.keys(docState) as EmployeeDocType[])
          .map((docType) => [docType, uploadedRefs[docType] ?? docState[docType].ref] as const)
          .filter((entry) => Boolean(entry[1]?.fileId)),
      );

      await createEmployeeProfile({
        ...normalizeNameFieldsForSave(form),
        documentRefs: Object.keys(documentRefs).length ? documentRefs : null,
      });
      setSaveProgress(1);
      setSavePhase('Done');
      setProfileSaved(true);
      setSubmitStatus('Profile saved successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save employee profile.';
      setSubmitStatus(`Save failed: ${message}`);
      Alert.alert('Save failed', message);
    } finally {
      setIsSavingProfile(false);
      setTimeout(() => {
        setSaveProgress(0);
        setSavePhase('Preparing...');
      }, 400);
    }
  }

  return (
    <AppScreen variant="dark" keyboardAware>
      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={step === 0 ? onBack : () => setStep((current) => current - 1)}>
          <ChevronLeft size={18} color="#94a3b8" strokeWidth={2.6} />
          <Text style={styles.backText}>{step === 0 ? 'Sign In' : 'Back'}</Text>
        </Pressable>
      </View>

      <Card variant="brand">
        <View style={styles.compactHeader}>
          <View style={styles.headerIcon}>
            {step === 1 ? (
              <BriefcaseBusiness size={24} color={colors.brand.ink} strokeWidth={2.5} />
            ) : step === 3 ? (
              <CheckCircle2 size={24} color={colors.brand.ink} strokeWidth={2.5} />
            ) : (
              <UserRound size={24} color={colors.brand.ink} strokeWidth={2.5} />
            )}
          </View>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>Employee Profile</Text>
            <Text style={styles.title}>{profileSteps[step].title}</Text>
            <Text style={styles.subtitle}>{profileSteps[step].subtitle}</Text>
          </View>
        </View>
        <StepProgress step={step} total={profileSteps.length} />
      </Card>

      <View style={styles.formOffset}>
      <Card>
        {step === 0 ? (
          <>
            <SectionTitle title="Required identity" detail="Fast creation only needs the essentials." />
            <FieldRow>
              <FieldCell>
                <FormTextField
                  label="Last Name *"
                  value={form.lastName}
                  onChangeText={(value) => updateNameField('lastName', value)}
                  error={showRequiredErrors && !form.lastName.trim() ? 'Required' : ''}
                />
              </FieldCell>
              <FieldCell>
                <FormTextField
                  label="First Name *"
                  value={form.firstName}
                  onChangeText={(value) => updateNameField('firstName', value)}
                  error={showRequiredErrors && !form.firstName.trim() ? 'Required' : ''}
                />
              </FieldCell>
            </FieldRow>
            {liveDuplicateMessage ? <Text style={styles.liveDuplicateError}>{liveDuplicateMessage}</Text> : null}
            <FieldRow>
              <FieldCell><FormTextField label="Middle Name" value={form.middleName} onChangeText={(value) => updateNameField('middleName', value)} /></FieldCell>
              <FieldCell><FormTextField label="Suffix" value={form.suffix} onChangeText={(value) => updateNameField('suffix', value)} /></FieldCell>
            </FieldRow>
            <DateField
              label="Birth Date"
              value={form.birthDate || 'Select date'}
              rawValue={form.birthDate}
              meta={age ? `Age ${age}` : 'Age auto-calculates'}
              onPress={() => openDatePicker('birthDate')}
              onChangeValue={(value) => updateField('birthDate', value)}
            />
            <FieldRow>
              <FieldCell><SelectField label="Gender" value={form.gender} onPress={() => openSelect({ title: 'Gender', field: 'gender', options: genderOptions })} /></FieldCell>
              <FieldCell><SelectField label="Civil Status" value={form.civilStatus} onPress={() => openSelect({ title: 'Civil Status', field: 'civilStatus', options: civilStatusOptions })} /></FieldCell>
            </FieldRow>
            <FormTextField
              label="Cellphone No. *"
              value={form.cellphone}
              onChangeText={(value) => updateField('cellphone', value)}
              keyboardType="phone-pad"
              error={showRequiredErrors && !form.cellphone.trim() ? 'Required' : ''}
            />
            <FormTextField label="Email Address" value={form.email} onChangeText={(value) => updateField('email', value)} keyboardType="email-address" autoCapitalize="none" />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <SectionTitle title="Employment assignment" detail="This controls company, approver routing, and portal access." />
            <SelectField
              label="Company *"
              value={form.company || 'No companies available'}
              onPress={() => companyOptions.length ? openSelect({ title: 'Company', field: 'company', options: companyOptions }) : undefined}
              disabled={!companyOptions.length}
              error={showAssignmentErrors && !form.company.trim() ? 'Required' : ''}
            />
            <SelectField
              label="Department *"
              value={form.workUnit}
              onPress={() => openSelect({ title: 'Department', field: 'workUnit', options: workUnitOptions })}
              error={showAssignmentErrors && !form.workUnit.trim() ? 'Required' : ''}
            />
            <SelectField
              label="Store *"
              value={form.store || 'N/A'}
              onPress={() => openSelect({ title: 'Store', field: 'store', options: companyStoreOptions })}
              error={showAssignmentErrors && !form.store.trim() ? 'Required' : ''}
            />
            <Text style={styles.reviewNote}>
              Position, date hired, and employee type are assigned by HR after profile creation.
            </Text>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <SectionTitle title="Profile details and document scan" detail="Capture clear photos so OCR can auto-read ID numbers." />
            <FormTextField label="TIN No." value={form.tin} onChangeText={(value) => updateField('tin', value)} />
            <DocumentCaptureCard
              title="TIN Photo"
              subtitle="Take clear TIN card/document photo"
              state={docState.tin}
              onCapture={() => captureAndUploadDocument('tin')}
            />
            <FormTextField label="SSS No." value={form.sss} onChangeText={(value) => updateField('sss', value)} />
            <DocumentCaptureCard
              title="SSS Photo"
              subtitle="Take clear SSS card/document photo"
              state={docState.sss}
              onCapture={() => captureAndUploadDocument('sss')}
            />
            <FormTextField label="Pag-IBIG No." value={form.pagibig} onChangeText={(value) => updateField('pagibig', value)} />
            <DocumentCaptureCard
              title="Pag-IBIG Photo"
              subtitle="Take clear Pag-IBIG card/document photo"
              state={docState.pagibig}
              onCapture={() => captureAndUploadDocument('pagibig')}
            />
            <FormTextField label="PhilHealth No." value={form.philhealth} onChangeText={(value) => updateField('philhealth', value)} />
            <DocumentCaptureCard
              title="PhilHealth Photo"
              subtitle="Take clear PhilHealth card/document photo"
              state={docState.philhealth}
              onCapture={() => captureAndUploadDocument('philhealth')}
            />
            <SelectField label="Bank Type" value={form.bankType} onPress={() => openSelect({ title: 'Bank Type', field: 'bankType', options: bankOptions })} />
            <FormTextField label="Account No." value={form.accountNo} onChangeText={(value) => updateField('accountNo', value)} />
            <DocumentCaptureCard
              title="Bank Proof Photo"
              subtitle="Take clear bank passbook/card photo"
              state={docState.bank}
              onCapture={() => captureAndUploadDocument('bank')}
            />
            <FormTextField label="Present Address" value={form.presentAddress} onChangeText={(value) => updateField('presentAddress', value)} multiline />
            <FormTextField label="Emergency Contact" value={form.emergencyContact} onChangeText={(value) => updateField('emergencyContact', value)} />
            <FormTextField label="Emergency Contact No." value={form.emergencyContactNo} onChangeText={(value) => updateField('emergencyContactNo', value)} keyboardType="phone-pad" />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <SectionTitle title="Review" detail="HR will validate the profile before activation." />
            <ReviewLine label="Name" value={reviewName || 'Missing'} />
            <ReviewLine label="Contact" value={form.cellphone || 'Missing'} />
            <ReviewLine label="Company" value={form.company} />
            <ReviewLine label="Department" value={form.workUnit || 'Missing'} />
            <ReviewLine label="Store" value={form.store || 'Missing'} />
            <Divider />
            <Text style={styles.reviewNote}>
              Photo upload, family details, children, social media, valid IDs, and user account setup will be added as follow-up sections after the core profile is saved.
            </Text>
          </>
        ) : null}
      </Card>
      </View>

      <View style={styles.actions}>
        {step > 0 ? (
          <Pressable
            disabled={isSavingProfile}
            style={[styles.previousButton, isSavingProfile ? styles.disabledAction : null]}
            onPress={() => setStep((current) => Math.max(current - 1, 0))}
          >
            <ChevronLeft size={17} color={colors.surface} strokeWidth={2.8} />
            <Text style={styles.previousButtonText}>Previous</Text>
          </Pressable>
        ) : null}
        <View style={styles.primaryAction}>
          <Pressable
            disabled={isSavingProfile || isCheckingDuplicate}
            style={[styles.continueButton, isSavingProfile || isCheckingDuplicate ? styles.disabledAction : null]}
            onPress={step === profileSteps.length - 1 ? submitProfile : goNext}
          >
            <Text style={styles.continueButtonText}>
              {isSavingProfile ? 'Saving...' : isCheckingDuplicate ? 'Checking...' : step === profileSteps.length - 1 ? 'Submit' : 'Continue'}
            </Text>
            {step === profileSteps.length - 1 ? (
              <Send size={16} color={colors.brand.ink} strokeWidth={2.7} />
            ) : (
              <ChevronRight size={17} color={colors.brand.ink} strokeWidth={2.8} />
            )}
          </Pressable>
        </View>
      </View>
      {submitStatus ? <Text style={styles.submitStatus}>{submitStatus}</Text> : null}

      <SelectModal
        config={activeSelect}
        iosValue={iosSelectValue}
        pressedOption={pressedOption}
        onIosValueChange={setIosSelectValue}
        onPressIn={setPressedOption}
        onPressOut={() => setPressedOption('')}
        onClose={() => setActiveSelect(null)}
        onSelect={(field, value) => {
          updateField(field, value);
          setActiveSelect(null);
        }}
      />

      <DatePickerModal
        visible={Boolean(activeDateField)}
        value={Platform.OS === 'ios' ? tempDate : dateStringToDate(activeDateField ? form[activeDateField] || formatDateInput(new Date()) : formatDateInput(new Date()))}
        onChange={handleDateChange}
        onCancel={() => setActiveDateField(null)}
        onDone={confirmIosDate}
      />

      <LoadingOverlay
        visible={isSavingProfile || isCheckingDuplicate}
        title={isCheckingDuplicate ? 'Checking profile' : 'Saving profile'}
        detail={isCheckingDuplicate ? 'Checking for duplicate employee profile.' : savePhase}
        progress={isCheckingDuplicate ? 0.3 : saveProgress}
      />
      <SuccessModal
        visible={profileSaved}
        onDone={() => {
          setProfileSaved(false);
          onBack();
        }}
      />
    </AppScreen>
  );
}

type SelectConfig = {
  title: string;
  field: keyof FormState;
  options: string[];
};

const profileSteps = [
  {
    title: 'Basic Details',
    subtitle: 'Start with only the employee information needed to create a record.',
  },
  {
    title: 'Employment',
    subtitle: 'Tag the company and work unit; HR will complete employment details.',
  },
  {
    title: 'More Details',
    subtitle: 'Add government IDs, bank, education, and address details when available.',
  },
  {
    title: 'Review Profile',
    subtitle: 'Check the core details before sending this profile to HR validation.',
  },
];

function FormTextField({ label, multiline, style, error, ...inputProps }: TextInputProps & { label: string; error?: string }) {
  return (
    <>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="#94a3b8"
        {...inputProps}
        multiline={multiline}
        style={[
          styles.input,
          multiline ? styles.textArea : null,
          error ? styles.inputInvalid : null,
          error ? styles.inputWithError : null,
          style,
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </>
  );
}

function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldRow}>{children}</View>;
}

function FieldCell({ children }: { children: ReactNode }) {
  return <View style={styles.fieldCell}>{children}</View>;
}

function DateField({
  label,
  value,
  rawValue,
  meta,
  onPress,
  onChangeValue,
  error,
}: {
  label: string;
  value: string;
  rawValue?: string;
  meta?: string;
  onPress: () => void;
  onChangeValue?: (value: string) => void;
  error?: string;
}) {
  if (Platform.OS === 'web') {
    return (
      <>
        <Text style={styles.inputLabel}>{label}</Text>
        <View style={styles.webDateShell}>
          {createElement('input', {
            type: 'date',
            value: rawValue || '',
            onChange: (event: { currentTarget: { value: string } }) => onChangeValue?.(event.currentTarget.value),
            style: {
              ...webDateInputStyle,
              ...(error ? webDateInputErrorStyle : null),
            },
          })}
          {meta ? <Text style={styles.webDateMeta}>{meta}</Text> : null}
        </View>
        {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      </>
    );
  }

  return (
    <>
      <Text style={styles.inputLabel}>{label}</Text>
      <Pressable
        style={[styles.selectShell, error ? styles.inputInvalid : null, error ? styles.inputWithError : null]}
        onPress={onPress}
      >
        <CalendarDays size={16} color={colors.muted} strokeWidth={2.5} />
        <Text style={styles.selectValue}>{value}</Text>
        {meta ? <Text style={styles.selectMeta}>{meta}</Text> : null}
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </>
  );
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

function SelectField({
  label,
  value,
  onPress,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <Text style={styles.inputLabel}>{label}</Text>
      <Pressable
        style={[
          styles.selectShell,
          error ? styles.inputInvalid : null,
          error ? styles.inputWithError : null,
          disabled ? styles.disabledAction : null,
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        <Text style={[styles.selectValue, !value ? styles.selectPlaceholder : null]}>{value || 'Select'}</Text>
        <ChevronDown size={16} color={colors.muted} strokeWidth={2.5} />
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionHeading}>{title}</Text>
      <Text style={styles.sectionDetail}>{detail}</Text>
    </View>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewLine}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

function DocumentCaptureCard({
  title,
  subtitle,
  state,
  onCapture,
}: {
  title: string;
  subtitle: string;
  state: DocumentCaptureState;
  onCapture: () => void;
}) {
  return (
    <View style={styles.docCard}>
      <View style={styles.docCardHeader}>
        <View style={styles.docCardText}>
          <Text style={styles.docTitle}>{title}</Text>
          <Text style={styles.docSubtitle}>{subtitle}</Text>
        </View>
        <Pressable style={[styles.docCaptureButton, state.uploading ? styles.disabledAction : null]} disabled={state.uploading} onPress={onCapture}>
          <Text style={styles.docCaptureButtonText}>{state.uploading ? 'Uploading...' : 'Take Photo'}</Text>
        </Pressable>
      </View>
      {state.localUri ? <Image source={{ uri: state.localUri }} style={styles.docPreview} resizeMode="cover" /> : null}
      {state.ref?.fileId ? <Text style={styles.docOk}>Attached and saved to Drive</Text> : null}
      {state.ref?.detectedNumber ? <Text style={styles.docDetected}>Detected: {state.ref.detectedNumber}</Text> : null}
      {state.error ? <Text style={styles.docError}>{state.error}</Text> : null}
    </View>
  );
}

function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: total }).map((_, index) => (
        <View key={index} style={[styles.progressDot, index <= step && styles.progressDotActive]} />
      ))}
    </View>
  );
}

function SelectModal({
  config,
  iosValue,
  pressedOption,
  onIosValueChange,
  onPressIn,
  onPressOut,
  onClose,
  onSelect,
}: {
  config: SelectConfig | null;
  iosValue: string;
  pressedOption: string;
  onIosValueChange: (value: string) => void;
  onPressIn: (value: string) => void;
  onPressOut: () => void;
  onClose: () => void;
  onSelect: (field: keyof FormState, value: string) => void;
}) {
  const androidScrollRef = useRef<ScrollView>(null);
  const wheelItemHeight = 44;

  useEffect(() => {
    if (Platform.OS === 'ios' || !config) {
      return;
    }

    const selectedIndex = Math.max(0, config.options.indexOf(iosValue || config.options[0]));
    requestAnimationFrame(() => {
      androidScrollRef.current?.scrollTo({ y: selectedIndex * wheelItemHeight, animated: false });
    });
  }, [config, iosValue]);

  if (Platform.OS === 'ios') {
    return (
      <Modal transparent animationType="fade" visible={Boolean(config)} onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.optionSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{config?.title}</Text>
              <Pressable style={styles.sheetClose} onPress={onClose}>
                <X size={18} color={colors.text} strokeWidth={2.6} />
              </Pressable>
            </View>
            {config ? (
              <View style={styles.iosPickerFrame}>
                <Picker
                  selectedValue={iosValue || config.options[0]}
                  onValueChange={onIosValueChange}
                  style={styles.iosWheelPicker}
                  itemStyle={styles.iosPickerItem}
                >
                  {config.options.map((option) => (
                    <Picker.Item key={option} label={option} value={option} />
                  ))}
                </Picker>
              </View>
            ) : null}
            <View style={styles.dateActions}>
              <Pressable style={styles.dateCancel} onPress={onClose}>
                <Text style={styles.dateCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.dateDone}
                onPress={() => {
                  if (config) {
                    onSelect(config.field, iosValue || config.options[0]);
                  }
                }}
              >
                <Text style={styles.dateDoneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal transparent animationType="fade" visible={Boolean(config)} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.optionSheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{config?.title}</Text>
            <Pressable style={styles.sheetClose} onPress={onClose}>
              <X size={18} color={colors.text} strokeWidth={2.6} />
            </Pressable>
          </View>
          <View style={styles.androidWheelFrame}>
            <View pointerEvents="none" style={styles.androidWheelSelection} />
            <ScrollView
              ref={androidScrollRef}
              style={styles.androidPickerFrame}
              contentContainerStyle={styles.androidPickerContent}
              showsVerticalScrollIndicator={false}
              snapToInterval={wheelItemHeight}
              decelerationRate="fast"
              onMomentumScrollEnd={(event) => {
                if (!config) {
                  return;
                }

                const selectedIndex = Math.min(
                  config.options.length - 1,
                  Math.max(0, Math.round(event.nativeEvent.contentOffset.y / wheelItemHeight)),
                );
                onIosValueChange(config.options[selectedIndex]);
              }}
            >
            {config?.options.map((option) => {
              const selected = (iosValue || config.options[0]) === option;

              return (
                <Pressable
                  key={option}
                  style={[
                    styles.optionRow,
                    selected ? styles.optionRowSelected : null,
                    pressedOption === option ? styles.optionRowPressed : null,
                  ]}
                  onLongPress={() => onPressIn(option)}
                  onPressIn={() => onPressIn(option)}
                  onPressOut={onPressOut}
                  onPress={() => onIosValueChange(option)}
                  delayLongPress={120}
                  android_ripple={{ color: '#fde68a', borderless: false }}
                >
                  <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{option}</Text>
                </Pressable>
              );
            })}
            </ScrollView>
          </View>
          <View style={styles.dateActions}>
            <Pressable style={styles.dateCancel} onPress={onClose}>
              <Text style={styles.dateCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.dateDone}
              onPress={() => {
                if (config) {
                  onSelect(config.field, iosValue || config.options[0]);
                }
              }}
            >
              <Text style={styles.dateDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
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
    return (
      <DateTimePicker
        value={value}
        mode="date"
        display="spinner"
        onChange={onChange}
      />
    );
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.optionSheet}>
          <View style={styles.iosPickerFrame}>
            <DateTimePicker
              value={value}
              mode="date"
              display="spinner"
              onChange={onChange}
              style={styles.iosWheelPicker}
            />
          </View>
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

function LoadingOverlay({
  visible,
  title,
  detail,
  progress,
}: {
  visible: boolean;
  title: string;
  detail?: string;
  progress?: number;
}) {
  const clampedProgress = Math.max(0, Math.min(1, progress ?? 0));
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.loadingBackdrop}>
        <View style={styles.loadingPanel}>
          <ActivityIndicator size="large" color={colors.brand.gold} />
          <Text style={styles.loadingTitle}>{title}</Text>
          <Text style={styles.loadingText}>{detail || 'Please wait while we process your employee profile.'}</Text>
          <View style={styles.loadingProgressTrack}>
            <View style={[styles.loadingProgressFill, { width: `${Math.round(clampedProgress * 100)}%` }]} />
          </View>
          <Text style={styles.loadingProgressLabel}>{Math.round(clampedProgress * 100)}%</Text>
        </View>
      </View>
    </Modal>
  );
}

function SuccessModal({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDone}>
      <View style={styles.successBackdrop}>
        <View style={styles.successPanel}>
          <View style={styles.successIcon}>
            <Image source={hygLogo} style={styles.successLogo} resizeMode="contain" />
          </View>
          <Text style={styles.successTitle}>Profile saved</Text>
          <Text style={styles.successText}>Your employee profile has been submitted successfully and is now pending HR review. An employee number has been assigned automatically.</Text>
          <Pressable style={styles.successButton} onPress={onDone}>
            <Text style={styles.successButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function calculateAge(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return 0;
  }

  const birthDate = new Date(year, month - 1, day);
  if (Number.isNaN(birthDate.getTime())) {
    return 0;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hadBirthday =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  if (!hadBirthday) {
    age -= 1;
  }

  return age > 0 ? age : 0;
}

function normalizeNameFieldsForSave(form: FormState): FormState {
  return {
    ...form,
    lastName: normalizeNamePart(form.lastName),
    firstName: normalizeNamePart(form.firstName),
    middleName: normalizeNamePart(form.middleName),
    suffix: normalizeNamePart(form.suffix),
  };
}

function normalizeNamePart(value: string) {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

const styles = StyleSheet.create({
  topBar: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
  },
  backText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  kicker: {
    ...typography.label,
    color: colors.brand.gold,
    fontSize: 11,
    marginBottom: 3,
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: fontWeights.heavy,
    lineHeight: 30,
    marginBottom: 3,
  },
  subtitle: {
    ...typography.body,
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  progressRow: {
    flexDirection: 'row',
  },
  progressDot: {
    flex: 1,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#334155',
    marginRight: spacing.xs,
  },
  progressDotActive: {
    backgroundColor: colors.brand.gold,
  },
  formOffset: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
  },
  sectionHeading: {
    color: colors.text,
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    marginBottom: 3,
  },
  sectionDetail: {
    ...typography.body,
    color: colors.muted,
  },
  inputLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  fieldRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  fieldCell: {
    flex: 1,
    paddingHorizontal: 4,
  },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
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
  liveDuplicateError: {
    color: colors.semantic.danger,
    fontSize: 12,
    fontWeight: fontWeights.bold,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  selectShell: {
    minHeight: 46,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  selectValue: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: fontWeights.bold,
    marginLeft: spacing.xs,
  },
  selectPlaceholder: {
    color: colors.muted,
  },
  selectMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: fontWeights.semibold,
    marginLeft: spacing.xs,
  },
  textArea: {
    minHeight: 86,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  reviewLine: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  reviewLabel: {
    ...typography.label,
    color: colors.muted,
    marginBottom: 2,
  },
  reviewValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  reviewNote: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.md,
  },
  docCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: '#f8fafc',
  },
  docCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  docCardText: {
    flex: 1,
  },
  docTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.heavy,
  },
  docSubtitle: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  docCaptureButton: {
    minHeight: 36,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  docCaptureButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: fontWeights.heavy,
  },
  docPreview: {
    width: '100%',
    height: 120,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  docOk: {
    color: '#166534',
    fontSize: 11,
    fontWeight: fontWeights.bold,
    marginTop: spacing.xs,
  },
  docDetected: {
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: fontWeights.bold,
    marginTop: 2,
  },
  docError: {
    color: colors.semantic.danger,
    fontSize: 11,
    fontWeight: fontWeights.bold,
    marginTop: 2,
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  previousButton: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginRight: spacing.xs,
    marginTop: spacing.sm,
  },
  previousButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
    marginLeft: spacing.xs,
  },
  primaryAction: {
    flex: 1,
  },
  disabledAction: {
    opacity: 0.7,
  },
  continueButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    marginTop: spacing.sm,
  },
  continueButtonText: {
    color: colors.brand.ink,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
    marginRight: spacing.xs,
  },
  submitStatus: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: 'center',
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
  loadingProgressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  loadingProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.brand.gold,
  },
  loadingProgressLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: fontWeights.bold,
    marginTop: spacing.xs,
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
  iosPickerFrame: {
    height: 178,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iosWheelPicker: {
    height: 178,
  },
  iosPickerItem: {
    fontSize: 18,
  },
  androidWheelFrame: {
    height: 178,
    position: 'relative',
    overflow: 'hidden',
  },
  androidWheelSelection: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: 67,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
  },
  androidPickerFrame: {
    height: 178,
  },
  androidPickerContent: {
    paddingVertical: 67,
  },
  sheetHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: fontWeights.heavy,
  },
  sheetClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRow: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionRowPressed: {
    backgroundColor: '#fff7cc',
  },
  optionRowSelected: {
    backgroundColor: '#fef3c7',
  },
  optionText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  optionTextSelected: {
    color: '#92400e',
    fontWeight: fontWeights.heavy,
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
  webDateShell: {
    marginBottom: spacing.sm,
  },
  webDateMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: fontWeights.bold,
    marginTop: -4,
    marginBottom: spacing.xs,
  },
});
