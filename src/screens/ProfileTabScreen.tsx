import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import {
  Baby,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  ChevronDown,
  Contact,
  Edit3,
  GraduationCap,
  Hash,
  Heart,
  Landmark,
  LogOut,
  Pencil,
  Save,
  User,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react-native';

import { colors, fontWeights, spacing } from '../theme';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';
import { supabase } from '../lib/supabase';
import { updateEmployeeProfile, uploadEmployeeProfilePhoto, type UpdateEmployeeProfileInput } from '../services/profile';
import { loadEmployeeCompanyOptions } from '../services/createProfile';
import { normalizeUsername } from '../services/registerAccount';

type Props = {
  email: string;
  username: string;
  isLoading: boolean;
  result: ProfileLoadResult | null;
  onToast?: (toast: ProfileToast) => void;
  onSignOut: () => void;
};

type ProfileToast = {
  tone: 'success' | 'error' | 'warning';
  title: string;
  message: string;
};

type ProfileSectionKey =
  | 'personal'
  | 'contact'
  | 'employment'
  | 'governmentBank'
  | 'education'
  | 'family'
  | 'spouse'
  | 'children';

type ProfileSection = {
  key: ProfileSectionKey;
  label: string;
  description: string;
  rows: ProfileRow[];
  emptyText?: string;
};

type ProfileRow = {
  label: string;
  value?: string | null;
  fullWidth?: boolean;
  field?: keyof UpdateEmployeeProfileInput;
  multiline?: boolean;
  editor?: 'text' | 'date' | 'select';
  options?: string[];
};

const CIVIL_STATUS_OPTIONS = ['Single', 'Married', 'Widowed', 'Separated', 'Divorced'];
const GENDER_OPTIONS = ['Male', 'Female'];
const FALLBACK_COMPANY_OPTIONS = [
  'Cakes Haven Incorporation',
  'Cakes and Occasions Corporation',
  'Chatime',
  'Chawnah Foods INC.',
  'DU99 7-Eleven',
  'Fresh Berry Foods Corporation',
  'Icebergs',
  'Taters',
];

type InlineSelectConfig = {
  title: string;
  field: keyof UpdateEmployeeProfileInput;
  options: string[];
};

const PROFILE_SECTION_TABS: {
  key: ProfileSectionKey;
  label: string;
  icon: typeof UserRound;
  color: string;
}[] = [
  { key: 'personal', label: 'Personal', icon: UserRound, color: '#ca8a04' },
  { key: 'contact', label: 'Contact', icon: Contact, color: '#0891b2' },
  { key: 'employment', label: 'Employment', icon: Building2, color: '#c2410c' },
  { key: 'governmentBank', label: 'Government and Bank', icon: Landmark, color: '#64748b' },
  { key: 'education', label: 'Education', icon: GraduationCap, color: '#92400e' },
  { key: 'family', label: 'Family', icon: UsersRound, color: '#c2410c' },
  { key: 'spouse', label: 'Spouse', icon: Heart, color: '#e11d48' },
  { key: 'children', label: 'Children', icon: Baby, color: '#f97316' },
];

export function ProfileTabScreen({ email, username, isLoading, result, onToast, onSignOut }: Props) {
  const resultProfile = result?.status === 'linked' ? result.profile : null;
  const [localProfile, setLocalProfile] = useState<EmployeeProfileSummary | null>(resultProfile);
  const profile = localProfile;
  const displayName = profile?.fullName || username || 'Employee';

  const [showModal, setShowModal] = useState(false);
  const [inlineEditSection, setInlineEditSection] = useState<ProfileSectionKey | null>(null);
  const [activeProfileSection, setActiveProfileSection] = useState<ProfileSectionKey>('personal');
  const [form, setForm] = useState<UpdateEmployeeProfileInput>(() => profileToForm(profile, username));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [activeDateField, setActiveDateField] = useState<keyof UpdateEmployeeProfileInput | null>(null);
  const [tempDate, setTempDate] = useState(() => new Date());
  const [activeSelect, setActiveSelect] = useState<InlineSelectConfig | null>(null);
  const [tempSelectValue, setTempSelectValue] = useState('');
  const [companyOptions, setCompanyOptions] = useState<string[]>(FALLBACK_COMPANY_OPTIONS);
  const scrollRef = useRef<ScrollView>(null);
  const sectionPanelY = useRef(0);
  const detailGridY = useRef(0);
  const detailRowY = useRef<Record<string, number>>({});
  const profileSections = getProfileSections(profile, username, form, companyOptions);
  const activeSection = profileSections.find((section) => section.key === activeProfileSection) ?? profileSections[0];
  const activeTab = PROFILE_SECTION_TABS.find((tab) => tab.key === activeProfileSection) ?? PROFILE_SECTION_TABS[0];
  const ActiveSectionIcon = activeTab.icon;
  const isInlineEditing = inlineEditSection === activeProfileSection;

  useEffect(() => {
    setLocalProfile(resultProfile);
  }, [resultProfile]);

  useEffect(() => {
    if (!showModal) {
      setForm(profileToForm(profile, username));
    }
  }, [profile, showModal, username]);

  useEffect(() => {
    let isMounted = true;

    loadEmployeeCompanyOptions()
      .then((options) => {
        if (!isMounted) {
          return;
        }

        const optionNames = options.map((option) => option.company_name).filter(Boolean);
        setCompanyOptions(uniqueOptions([profile?.companyName ?? '', ...optionNames, ...FALLBACK_COMPANY_OPTIONS]));
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setCompanyOptions(uniqueOptions([profile?.companyName ?? '', ...FALLBACK_COMPANY_OPTIONS]));
        onToast?.({
          tone: 'warning',
          title: 'Companies unavailable',
          message: error instanceof Error ? error.message : 'Unable to load company options.',
        });
      });

    return () => {
      isMounted = false;
    };
  }, [profile?.companyName, onToast]);

  function updateField(field: keyof UpdateEmployeeProfileInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function focusDetailRow(rowKey: string) {
    const targetY = sectionPanelY.current + detailGridY.current + (detailRowY.current[rowKey] ?? 0) - 300;
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, targetY), animated: true });
    }, 80);
  }

  function openModal() {
    setForm(profileToForm(profile, username));
    setNewPassword('');
    setConfirmPassword('');
    setShowModal(true);
  }

  async function pickProfilePhoto() {
    if (!profile?.employeeId || isUploadingPhoto) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onToast?.({
        tone: 'warning',
        title: 'Permission needed',
        message: 'Allow gallery access to choose a profile photo.',
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    if (!asset.base64) {
      onToast?.({
        tone: 'error',
        title: 'Upload failed',
        message: 'Unable to read the selected image.',
      });
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const photoUrl = await uploadEmployeeProfilePhoto({
        employeeId: profile.employeeId,
        base64: asset.base64,
        mimeType: asset.mimeType,
        uri: asset.uri,
      });

      setLocalProfile((current) => current ? { ...current, photoUrl } : current);
      onToast?.({
        tone: 'success',
        title: 'Photo updated',
        message: 'Profile photo saved.',
      });
    } catch (error) {
      onToast?.({
        tone: 'error',
        title: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unable to update profile photo.',
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  function startInlineEdit() {
    setForm(profileToForm(profile, username));
    setInlineEditSection(activeProfileSection);
  }

  function cancelInlineEdit() {
    setForm(profileToForm(profile, username));
    setInlineEditSection(null);
    setActiveDateField(null);
    setActiveSelect(null);
  }

  function openInlineDate(field: keyof UpdateEmployeeProfileInput, value?: string | null) {
    setTempDate(parseProfileDate(value));
    setActiveDateField(field);
  }

  function handleInlineDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
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

    updateField(activeDateField, formatProfileDate(selectedDate));
    setActiveDateField(null);
  }

  function confirmInlineDate() {
    if (activeDateField) {
      updateField(activeDateField, formatProfileDate(tempDate));
    }
    setActiveDateField(null);
  }

  function openInlineSelect(title: string, field: keyof UpdateEmployeeProfileInput, options: string[], value?: string | null) {
    setTempSelectValue(value || options[0] || '');
    setActiveSelect({ title, field, options });
  }

  function confirmInlineSelect() {
    if (activeSelect) {
      updateField(activeSelect.field, tempSelectValue || activeSelect.options[0] || '');
    }
    setActiveSelect(null);
  }

  async function saveProfile({ closeModal = true } = {}) {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.username.trim()) {
      onToast?.({
        tone: 'warning',
        title: 'Missing information',
        message: 'First name, last name, and username are required.',
      });
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      onToast?.({
        tone: 'warning',
        title: 'Check password',
        message: 'New password and confirm password do not match.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const savedForm = { ...form, username: normalizeUsername(form.username) };
      await updateEmployeeProfile(savedForm);
      if (newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
          throw new Error(error.message);
        }
      }
      if (closeModal) {
        setShowModal(false);
        setNewPassword('');
        setConfirmPassword('');
      }
      setInlineEditSection(null);
      setLocalProfile((current) => formToProfile(current, savedForm));
      setForm(savedForm);
      onToast?.({
        tone: 'success',
        title: 'Updated',
        message: 'Saved successfully.',
      });
    } catch (error) {
      onToast?.({
        tone: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Unable to update profile.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <TopBar name={displayName} photoUrl={profile?.photoUrl} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#eab308" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      style={styles.root}
    >
      <StatusBar style="dark" />
      <TopBar name={displayName} photoUrl={profile?.photoUrl} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.card}>
          <View style={styles.cardBody}>
            <View style={styles.avatarOuter}>
              <Pressable
                disabled={!profile || isUploadingPhoto}
                onPress={pickProfilePhoto}
                style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}
              >
                <Avatar
                  name={displayName}
                  photoUrl={profile?.photoUrl}
                  size={78}
                  textSize={27}
                  borderRadius={6}
                  textColor={colors.brand.gold}
                />
                <View style={styles.cameraBtn}>
                  {isUploadingPhoto ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Camera size={14} color="#fff" strokeWidth={2.5} />
                  )}
                </View>
              </Pressable>
            </View>

            <View style={styles.infoSide}>
              <Text style={styles.name}>{displayName}</Text>
              <View style={styles.positionRow}>
                <Briefcase size={12} color="#eab308" strokeWidth={2.5} />
                <Text style={styles.positionText}>{profile?.positionName ?? 'Employee'}</Text>
                <Building2 size={12} color="#eab308" strokeWidth={2.5} />
                <Text style={styles.positionText}>{profile?.departmentName ?? profile?.storeName ?? 'N/A'}</Text>
              </View>

              {/* Pills */}
              <View style={styles.pillRow}>
                <View style={styles.pillActive}>
                  <Text style={styles.pillActiveText}>ACTIVE</Text>
                </View>
                <View style={styles.pillInfo}>
                  <User size={11} color="#94a3b8" strokeWidth={2.5} />
                  <Text style={styles.pillInfoText}>Username: {username}</Text>
                </View>
              </View>

              <View style={styles.pillRow}>
                <View style={styles.pillInfo}>
                  <Hash size={11} color="#94a3b8" strokeWidth={2.5} />
                  <Text style={styles.pillInfoText}>ID: {profile?.employeeNo ?? 'N/A'}</Text>
                </View>
                <View style={styles.pillInfo}>
                  <Briefcase size={11} color="#94a3b8" strokeWidth={2.5} />
                  <Text style={styles.pillInfoText}>{profile?.departmentName ?? profile?.storeName ?? 'N/A'}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.profileActionRow}>
            <Pressable style={styles.updateBtn} onPress={openModal}>
              <Edit3 size={14} color="#111827" strokeWidth={2.7} />
              <Text style={styles.updateBtnText}>UPDATE INFORMATION</Text>
            </Pressable>
            <Pressable style={styles.profileSignOutBtn} onPress={onSignOut}>
              <LogOut size={15} color="#ffffff" strokeWidth={2.5} />
              <Text style={styles.profileSignOutText}>SIGN OUT</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.tabsCard}>
          <View style={styles.sectionTabs}>
            {PROFILE_SECTION_TABS.map((tab) => {
              const isActive = activeProfileSection === tab.key;
              const TabIcon = tab.icon;
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.sectionTab, isActive ? styles.sectionTabActive : null]}
                  onPress={() => {
                    setActiveProfileSection(tab.key);
                    setInlineEditSection(null);
                    setForm(profileToForm(profile, username));
                  }}
                >
                  <TabIcon size={14} color={isActive ? '#2563eb' : tab.color} strokeWidth={2.6} />
                  <Text style={[styles.sectionTabText, isActive ? styles.sectionTabTextActive : null]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={styles.sectionPanel}
          onLayout={(event) => {
            sectionPanelY.current = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionIntro}>
            <View style={[styles.sectionMark, { backgroundColor: `${activeTab.color}18` }]}>
              <ActiveSectionIcon size={20} color={activeTab.color} strokeWidth={2.7} />
            </View>
            <View style={styles.sectionIntroText}>
              <Text style={styles.sectionTitle}>{activeSection.label}</Text>
            </View>
            {isInlineEditing ? (
              <View style={styles.sectionEditActions}>
                <Pressable
                  disabled={isSaving}
                  style={({ pressed }) => [styles.sectionEditBtn, pressed ? styles.iconButtonPressed : null]}
                  onPress={cancelInlineEdit}
                >
                  <X size={16} color="#dc2626" strokeWidth={2.4} />
                </Pressable>
                <Pressable
                  disabled={isSaving}
                  style={({ pressed }) => [
                    styles.sectionSaveBtn,
                    isSaving ? styles.modalSaveBtnDisabled : null,
                    pressed ? styles.iconButtonPressed : null,
                  ]}
                  onPress={() => saveProfile({ closeModal: false })}
                >
                  <Save size={16} color="#16a34a" strokeWidth={2.4} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.sectionEditBtn, pressed ? styles.iconButtonPressed : null]}
                onPress={startInlineEdit}
              >
                <Pencil size={16} color="#334155" strokeWidth={2.4} />
              </Pressable>
            )}
          </View>
          {activeSection.rows.length > 0 ? (
            <View
              style={styles.detailGrid}
              onLayout={(event) => {
                detailGridY.current = event.nativeEvent.layout.y;
              }}
            >
              {activeSection.rows.map((row) => (
                <DetailRow
                  key={`${activeSection.key}-${row.label}`}
                  rowKey={`${activeSection.key}-${row.label}`}
                  label={row.label}
                  value={row.value}
                  fullWidth={row.fullWidth}
                  field={row.field}
                  multiline={row.multiline}
                  editor={row.editor}
                  options={row.options}
                  isEditing={isInlineEditing}
                  onChange={updateField}
                  onOpenDate={openInlineDate}
                  onOpenSelect={openInlineSelect}
                  onFocusRow={focusDetailRow}
                  onLayoutRow={(rowKey, y) => {
                    detailRowY.current[rowKey] = y;
                  }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.sectionMark, { backgroundColor: `${activeTab.color}18` }]}>
                <ActiveSectionIcon size={20} color={activeTab.color} strokeWidth={2.7} />
              </View>
              <Text style={styles.emptySectionText}>{activeSection.emptyText ?? 'No information added yet.'}</Text>
            </View>
          )}
        </View>

      </ScrollView>

      {/* Update Information Modal */}
      <Modal visible={showModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
            style={styles.modalKeyboardView}
          >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Update Information</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <X size={22} color="#334155" strokeWidth={2.5} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {/* Profile Photo */}
              <View style={styles.modalPhotoRow}>
                <View style={styles.modalAvatar}>
                  <Avatar
                    name={displayName}
                    photoUrl={profile?.photoUrl}
                    size={56}
                    textSize={20}
                    borderRadius={10}
                    textColor={colors.brand.gold}
                  />
                </View>
                <View>
                  <Text style={styles.modalPhotoLabel}>Profile Photo</Text>
                  <Text style={styles.modalPhotoHint}>Click photo to change</Text>
                </View>
              </View>

              {/* Name Fields */}
              <View style={styles.modalRow}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>First Name</Text>
                  <TextInput style={styles.modalInput} value={form.firstName} onChangeText={(value) => updateField('firstName', value)} placeholder="First Name" placeholderTextColor="#94a3b8" />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Last Name</Text>
                  <TextInput style={styles.modalInput} value={form.lastName} onChangeText={(value) => updateField('lastName', value)} placeholder="Last Name" placeholderTextColor="#94a3b8" />
                </View>
              </View>

              <View style={styles.modalRow}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Middle Name</Text>
                  <TextInput style={styles.modalInput} value={form.middleName} onChangeText={(value) => updateField('middleName', value)} placeholder="Middle Name" placeholderTextColor="#94a3b8" />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Username</Text>
                  <TextInput style={styles.modalInput} value={form.username} onChangeText={(value) => updateField('username', value)} placeholder="Username" placeholderTextColor="#94a3b8" autoCapitalize="none" />
                </View>
              </View>

              {/* Password */}
              <Text style={styles.modalHint}>Leave password blank if you don't want to change it.</Text>

              <Text style={styles.modalLabel}>New Password</Text>
              <TextInput style={styles.modalInput} value={newPassword} onChangeText={setNewPassword} placeholder="Enter new password" placeholderTextColor="#94a3b8" secureTextEntry />

              <Text style={styles.modalLabel}>Confirm Password</Text>
              <TextInput style={styles.modalInput} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm new password" placeholderTextColor="#94a3b8" secureTextEntry />

              {/* Actions */}
              <View style={styles.modalActions}>
                <Pressable disabled={isSaving} style={styles.modalCancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={styles.modalCancelText}>CANCEL</Text>
                </Pressable>
                <Pressable disabled={isSaving} style={[styles.modalSaveBtn, isSaving ? styles.modalSaveBtnDisabled : null]} onPress={() => saveProfile()}>
                  <Text style={styles.modalSaveText}>{isSaving ? 'SAVING...' : 'SAVE CHANGES'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <DatePickerModal
        visible={Boolean(activeDateField)}
        value={tempDate}
        onChange={handleInlineDateChange}
        onCancel={() => setActiveDateField(null)}
        onDone={confirmInlineDate}
      />
      <SelectModal
        config={activeSelect}
        value={tempSelectValue}
        onValueChange={setTempSelectValue}
        onClose={() => setActiveSelect(null)}
        onDone={confirmInlineSelect}
      />
    </KeyboardAvoidingView>
  );
}

function DetailRow({
  rowKey,
  label,
  value,
  fullWidth,
  field,
  multiline,
  editor = 'text',
  options = [],
  isEditing,
  onChange,
  onOpenDate,
  onOpenSelect,
  onFocusRow,
  onLayoutRow,
}: ProfileRow & {
  rowKey: string;
  isEditing?: boolean;
  onChange?: (field: keyof UpdateEmployeeProfileInput, value: string) => void;
  onOpenDate?: (field: keyof UpdateEmployeeProfileInput, value?: string | null) => void;
  onOpenSelect?: (title: string, field: keyof UpdateEmployeeProfileInput, options: string[], value?: string | null) => void;
  onFocusRow?: (rowKey: string) => void;
  onLayoutRow?: (rowKey: string, y: number) => void;
}) {
  const hasValue = Boolean(value);
  const canEdit = Boolean(isEditing && field && onChange);

  return (
    <View
      style={[styles.detailTile, fullWidth ? styles.detailTileFull : null]}
      onLayout={(event) => onLayoutRow?.(rowKey, event.nativeEvent.layout.y)}
    >
      <Text style={styles.detailLabel}>{label}</Text>
      {canEdit && editor === 'date' ? (
        <Pressable
          style={[styles.detailValueBox, styles.detailPickerInput, !hasValue ? styles.detailTileEmpty : null]}
          onPress={() => field && onOpenDate?.(field, value)}
        >
          <Calendar size={16} color="#475569" strokeWidth={2.4} />
          <Text style={[styles.detailPickerText, !value ? styles.detailValueEmpty : null]}>{value || 'Select date'}</Text>
        </Pressable>
      ) : canEdit && editor === 'select' ? (
        <Pressable
          style={[styles.detailValueBox, styles.detailPickerInput, !hasValue ? styles.detailTileEmpty : null]}
          onPress={() => field && onOpenSelect?.(label, field, options, value)}
        >
          <Text style={[styles.detailPickerText, !value ? styles.detailValueEmpty : null]}>{value || 'Select'}</Text>
          <ChevronDown size={16} color="#475569" strokeWidth={2.4} />
        </Pressable>
      ) : canEdit ? (
        <TextInput
          style={[styles.detailValueBox, styles.detailInput, multiline ? styles.detailInputMultiline : null, !hasValue ? styles.detailTileEmpty : null]}
          value={value ?? ''}
          onFocus={() => onFocusRow?.(rowKey)}
          onChangeText={(nextValue) => {
            if (field && onChange) {
              onChange(field, nextValue);
            }
          }}
          placeholder="N/A"
          placeholderTextColor="#94a3b8"
          multiline={multiline}
        />
      ) : (
        <View style={[styles.detailValueBox, !hasValue ? styles.detailTileEmpty : null]}>
          <Text style={[styles.detailValue, !hasValue ? styles.detailValueEmpty : null]}>{value || 'N/A'}</Text>
        </View>
      )}
    </View>
  );
}

function parseProfileDate(value?: string | null) {
  if (!value) {
    return new Date();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatProfileDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function uniqueOptions(options: string[]) {
  return Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
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
    return <DateTimePicker value={value} mode="date" display="spinner" onChange={onChange} />;
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.optionSheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Birth Date</Text>
            <Pressable style={styles.sheetClose} onPress={onCancel}>
              <X size={18} color={colors.text} strokeWidth={2.6} />
            </Pressable>
          </View>
          <View style={styles.iosPickerFrame}>
            <DateTimePicker value={value} mode="date" display="spinner" onChange={onChange} style={styles.iosWheelPicker} />
          </View>
          <View style={styles.sheetActions}>
            <Pressable style={styles.sheetCancel} onPress={onCancel}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.sheetDone} onPress={onDone}>
              <Text style={styles.sheetDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SelectModal({
  config,
  value,
  onValueChange,
  onClose,
  onDone,
}: {
  config: InlineSelectConfig | null;
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const androidScrollRef = useRef<ScrollView>(null);
  const wheelItemHeight = 48;

  useEffect(() => {
    if (Platform.OS === 'ios' || !config) {
      return;
    }

    const selectedIndex = Math.max(0, config.options.indexOf(value || config.options[0]));
    requestAnimationFrame(() => {
      androidScrollRef.current?.scrollTo({ y: selectedIndex * wheelItemHeight, animated: false });
    });
  }, [config, value]);

  return (
    <Modal transparent animationType="fade" visible={Boolean(config)} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.optionSheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{config?.title}</Text>
            <Pressable style={styles.sheetClose} onPress={onClose}>
              <X size={18} color={colors.text} strokeWidth={2.6} />
            </Pressable>
          </View>
          {Platform.OS === 'ios' && config ? (
            <View style={styles.iosPickerFrame}>
              <Picker
                selectedValue={value || config.options[0]}
                onValueChange={(nextValue) => onValueChange(String(nextValue))}
                style={styles.iosWheelPicker}
                itemStyle={styles.iosPickerItem}
              >
                {config.options.map((option) => (
                  <Picker.Item key={option} label={option} value={option} />
                ))}
              </Picker>
            </View>
          ) : (
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
                  onValueChange(config.options[selectedIndex]);
                }}
              >
              {config?.options.map((option) => {
                const isSelected = (value || config.options[0]) === option;

                return (
                  <Pressable
                    key={option}
                    style={[styles.optionRow, isSelected ? styles.optionRowSelected : null]}
                    onPress={() => onValueChange(option)}
                    android_ripple={{ color: '#fde68a' }}
                  >
                    <Text style={[styles.optionText, isSelected ? styles.optionTextSelected : null]}>{option}</Text>
                  </Pressable>
                );
              })}
              </ScrollView>
            </View>
          )}
          <View style={styles.sheetActions}>
            <Pressable style={styles.sheetCancel} onPress={onClose}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.sheetDone} onPress={onDone}>
              <Text style={styles.sheetDoneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getProfileSections(
  profile: EmployeeProfileSummary | null,
  username: string,
  form: UpdateEmployeeProfileInput,
  companyOptions: string[],
): ProfileSection[] {
  return [
    {
      key: 'personal',
      label: 'Personal',
      description: 'Core identity and employment status.',
      rows: [
        { label: 'Birth Date', value: form.birthDate, field: 'birthDate', editor: 'date' },
        { label: 'Age', value: formatAge(form.birthDate) },
        { label: 'Gender', value: form.gender, field: 'gender', editor: 'select', options: GENDER_OPTIONS },
        { label: 'Religion', value: form.religion, field: 'religion' },
        { label: 'Birthplace', value: form.birthPlace, field: 'birthPlace', fullWidth: true },
        { label: 'Nationality', value: form.nationality, field: 'nationality' },
        { label: 'Civil Status', value: form.civilStatus, field: 'civilStatus', editor: 'select', options: CIVIL_STATUS_OPTIONS },
        { label: 'Height', value: form.height, field: 'height' },
        { label: 'Weight', value: form.weight, field: 'weight' },
        { label: 'Educational Attainment', value: form.education, field: 'education', fullWidth: true },
      ],
    },
    {
      key: 'contact',
      label: 'Contact and Address',
      description: 'Ways to reach the employee and account access.',
      rows: [
        { label: 'Email Address', value: form.email, field: 'email', fullWidth: true },
        { label: 'Phone Number', value: form.cellphone, field: 'cellphone' },
        { label: 'Other Phone No.', value: form.otherPhone, field: 'otherPhone' },
        { label: 'Social Media Type', value: form.socialMediaType, field: 'socialMediaType' },
        { label: 'Social Media Detail', value: form.socialMediaDetail, field: 'socialMediaDetail' },
        { label: 'Present Address', value: form.presentAddress, field: 'presentAddress', fullWidth: true, multiline: true },
        { label: 'Zip Code', value: form.zipCode, field: 'zipCode' },
        { label: 'Permanent Address', value: form.permanentAddress, field: 'permanentAddress', fullWidth: true, multiline: true },
      ],
    },
    {
      key: 'employment',
      label: 'Employment Details',
      description: 'Assignment, department, role, and approval level.',
      rows: [
        { label: 'Company', value: form.company, field: 'company', editor: 'select', options: companyOptions, fullWidth: true },
        { label: 'Employee Type', value: form.employeeType, field: 'employeeType' },
        { label: 'Username', value: form.username, field: 'username' },
        { label: 'Hired Date', value: profile?.dateHired },
        { label: 'Location', value: profile?.storeName ?? profile?.clusterName ?? profile?.areaName },
        { label: 'Department', value: profile?.departmentName },
        { label: 'Position', value: profile?.positionName },
      ],
    },
    {
      key: 'governmentBank',
      label: 'Government and Bank',
      description: 'Payroll, banking, and statutory identifiers.',
      rows: [
        { label: 'TIN No.', value: form.tin, field: 'tin' },
        { label: 'SSS No.', value: form.sss, field: 'sss' },
        { label: 'Pag-IBIG No.', value: form.pagibig, field: 'pagibig' },
        { label: 'PhilHealth No.', value: form.philhealth, field: 'philhealth' },
        { label: 'Bank Type', value: form.bankType, field: 'bankType' },
        { label: 'Account No.', value: form.accountNo, field: 'accountNo' },
      ],
    },
    {
      key: 'education',
      label: 'Education',
      description: 'Educational attainment currently on file.',
      rows: [
        { label: 'Elementary', value: form.elementarySchool, field: 'elementarySchool' },
        { label: 'Elementary Year', value: form.elementaryYear, field: 'elementaryYear' },
        { label: 'Secondary', value: form.secondarySchool, field: 'secondarySchool' },
        { label: 'Secondary Year', value: form.secondaryYear, field: 'secondaryYear' },
        { label: 'College', value: form.collegeSchool, field: 'collegeSchool' },
        { label: 'College Year', value: form.collegeYear, field: 'collegeYear' },
        { label: 'College Course', value: form.collegeCourse, field: 'collegeCourse', multiline: true },
        { label: 'Year Graduated', value: form.yearGraduated, field: 'yearGraduated' },
      ],
    },
    {
      key: 'family',
      label: 'Family',
      description: 'Emergency contact and family-related information.',
      rows: [
        { label: "Father's Name", value: form.fatherName, field: 'fatherName' },
        { label: "Father's Occupation", value: form.fatherOccupation, field: 'fatherOccupation' },
        { label: "Mother's Maiden Name", value: form.motherMaidenName, field: 'motherMaidenName' },
        { label: "Mother's Occupation", value: form.motherOccupation, field: 'motherOccupation' },
        { label: 'No. of Siblings', value: form.numberOfSiblings, field: 'numberOfSiblings' },
        { label: 'Birth Order', value: form.birthOrder, field: 'birthOrder' },
        { label: 'Emergency Contact', value: form.emergencyContact, field: 'emergencyContact', fullWidth: true },
      ],
    },
    {
      key: 'spouse',
      label: 'Spouse',
      description: 'Spouse details for employee records.',
      rows: [
        { label: 'Spouse Name', value: form.spouseName, field: 'spouseName' },
        { label: 'Occupation', value: form.spouseOccupation, field: 'spouseOccupation' },
        { label: 'Contact No.', value: form.spouseContact, field: 'spouseContact', fullWidth: true },
      ],
    },
    {
      key: 'children',
      label: 'Children',
      description: 'Child dependent details for employee records.',
      rows: [
        { label: 'No. of Children', value: form.childrenCount, field: 'childrenCount' },
        { label: 'Children Names', value: form.childrenNames, field: 'childrenNames', fullWidth: true, multiline: true },
      ],
    },
  ];
}

function formatAge(birthDate?: string | null) {
  if (!birthDate) {
    return null;
  }

  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());

  if (!hasBirthdayPassed) {
    years -= 1;
  }

  return years >= 0 ? `${years} yrs` : null;
}

function profileToForm(profile: EmployeeProfileSummary | null, username: string): UpdateEmployeeProfileInput {
  return {
    firstName: profile?.firstName ?? '',
    middleName: profile?.middleName ?? '',
    lastName: profile?.lastName ?? '',
    suffix: profile?.suffix ?? '',
    birthDate: profile?.birthDate ?? '',
    gender: profile?.gender ?? '',
    civilStatus: profile?.civilStatus ?? '',
    cellphone: profile?.cellphone ?? '',
    email: profile?.email ?? '',
    username: profile?.username ?? username,
    company: profile?.companyName ?? '',
    employeeType: profile?.employeeType ?? '',
    tin: profile?.tin ?? '',
    sss: profile?.sss ?? '',
    pagibig: profile?.pagibig ?? '',
    philhealth: profile?.philhealth ?? '',
    bankType: profile?.bankType ?? '',
    accountNo: profile?.accountNo ?? '',
    education: profile?.education ?? '',
    presentAddress: profile?.presentAddress ?? '',
    emergencyContact: profile?.emergencyContact ?? '',
    religion: profile?.religion ?? '',
    birthPlace: profile?.birthPlace ?? '',
    nationality: profile?.nationality ?? '',
    height: profile?.height ?? '',
    weight: profile?.weight ?? '',
    otherPhone: profile?.otherPhone ?? '',
    socialMediaType: profile?.socialMediaType ?? '',
    socialMediaDetail: profile?.socialMediaDetail ?? '',
    zipCode: profile?.zipCode ?? '',
    permanentAddress: profile?.permanentAddress ?? '',
    elementarySchool: profile?.elementarySchool ?? '',
    elementaryYear: profile?.elementaryYear ?? '',
    secondarySchool: profile?.secondarySchool ?? '',
    secondaryYear: profile?.secondaryYear ?? '',
    collegeSchool: profile?.collegeSchool ?? '',
    collegeYear: profile?.collegeYear ?? '',
    collegeCourse: profile?.collegeCourse ?? profile?.education ?? '',
    yearGraduated: profile?.yearGraduated ?? '',
    fatherName: profile?.fatherName ?? '',
    fatherOccupation: profile?.fatherOccupation ?? '',
    motherMaidenName: profile?.motherMaidenName ?? '',
    motherOccupation: profile?.motherOccupation ?? '',
    numberOfSiblings: profile?.numberOfSiblings ?? '',
    birthOrder: profile?.birthOrder ?? '',
    spouseName: profile?.spouseName ?? '',
    spouseOccupation: profile?.spouseOccupation ?? '',
    spouseContact: profile?.spouseContact ?? '',
    childrenNames: profile?.childrenNames ?? '',
    childrenCount: profile?.childrenCount ?? '',
  };
}

function formToProfile(
  profile: EmployeeProfileSummary | null,
  form: UpdateEmployeeProfileInput,
): EmployeeProfileSummary | null {
  if (!profile) {
    return profile;
  }

  const fullName = [
    form.firstName,
    form.middleName,
    form.lastName,
    form.suffix,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    ...profile,
    fullName,
    firstName: form.firstName,
    middleName: form.middleName || null,
    lastName: form.lastName,
    suffix: form.suffix || null,
    username: form.username,
    birthDate: form.birthDate || null,
    gender: form.gender || null,
    civilStatus: form.civilStatus || null,
    cellphone: form.cellphone,
    email: form.email || null,
    companyName: form.company || null,
    employeeType: form.employeeType || null,
    tin: form.tin || null,
    sss: form.sss || null,
    pagibig: form.pagibig || null,
    philhealth: form.philhealth || null,
    bankType: form.bankType || null,
    accountNo: form.accountNo || null,
    education: form.education || null,
    presentAddress: form.presentAddress || null,
    emergencyContact: form.emergencyContact || null,
    religion: form.religion || null,
    birthPlace: form.birthPlace || null,
    nationality: form.nationality || null,
    height: form.height || null,
    weight: form.weight || null,
    otherPhone: form.otherPhone || null,
    socialMediaType: form.socialMediaType || null,
    socialMediaDetail: form.socialMediaDetail || null,
    zipCode: form.zipCode || null,
    permanentAddress: form.permanentAddress || null,
    elementarySchool: form.elementarySchool || null,
    elementaryYear: form.elementaryYear || null,
    secondarySchool: form.secondarySchool || null,
    secondaryYear: form.secondaryYear || null,
    collegeSchool: form.collegeSchool || null,
    collegeYear: form.collegeYear || null,
    collegeCourse: form.collegeCourse || null,
    yearGraduated: form.yearGraduated || null,
    fatherName: form.fatherName || null,
    fatherOccupation: form.fatherOccupation || null,
    motherMaidenName: form.motherMaidenName || null,
    motherOccupation: form.motherOccupation || null,
    numberOfSiblings: form.numberOfSiblings || null,
    birthOrder: form.birthOrder || null,
    spouseName: form.spouseName || null,
    spouseOccupation: form.spouseOccupation || null,
    spouseContact: form.spouseContact || null,
    childrenNames: form.childrenNames || null,
    childrenCount: form.childrenCount || null,
  };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  scroll: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 100,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },

  // Card
  card: {
    backgroundColor: '#071426',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#173152',
    padding: 10,
    marginBottom: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 2,
  },
  cardBody: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },

  // Avatar
  avatarOuter: {
    position: 'relative',
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 6,
    backgroundColor: colors.brand.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    overflow: 'hidden',
  },
  avatarPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.97 }],
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eab308',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Info side
  infoSide: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'flex-start',
  },
  name: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  positionText: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: '#eab308',
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 7,
  },
  pillActive: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  pillActiveText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  pillInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#334155',
    maxWidth: '100%',
  },
  pillInfoText: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: '#94a3b8',
  },

  // Profile actions
  profileActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  updateBtn: {
    flex: 1.35,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#facc15',
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  updateBtnText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#111827',
    letterSpacing: 0,
  },
  profileSignOutBtn: {
    flex: 0.8,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b91c1c',
    backgroundColor: '#dc2626',
    paddingHorizontal: 8,
  },
  profileSignOutText: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
    letterSpacing: 0,
  },

  // Section tiles
  tabsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginBottom: 10,
  },
  sectionTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionTab: {
    width: '48.8%',
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  sectionTabActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#eff6ff',
  },
  sectionTabText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
  sectionTabTextActive: {
    color: '#1d4ed8',
  },
  sectionPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  sectionIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionMark: {
    width: 36,
    height: 36,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIntroText: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  sectionEditBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionEditActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.92 }],
  },
  sectionSaveBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 10,
  },
  detailTile: {
    width: '48.1%',
    minHeight: 76,
    justifyContent: 'flex-start',
  },
  detailTileFull: {
    width: '100%',
  },
  detailTileEmpty: {
    backgroundColor: '#f8fafc',
  },
  detailLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
    color: '#334155',
    marginBottom: 5,
  },
  detailValueBox: {
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  detailValue: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    lineHeight: 20,
    color: '#0f172a',
  },
  detailValueEmpty: {
    color: '#94a3b8',
  },
  detailInput: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  detailInputMultiline: {
    minHeight: 58,
    textAlignVertical: 'top',
  },
  detailPickerInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  detailPickerText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  emptySectionText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    color: '#64748b',
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalKeyboardView: {
    width: '100%',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    height: '84%',
    maxHeight: '88%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  modalScroll: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  modalPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.md,
  },
  modalAvatar: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.brand.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  modalPhotoLabel: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  modalPhotoHint: {
    fontSize: 14,
    color: colors.primary,
    marginTop: 2,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  modalField: {
    flex: 1,
  },
  modalLabel: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#64748b',
    marginBottom: 3,
    marginTop: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  modalInputDisabled: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: '#64748b',
    backgroundColor: '#e2e8f0',
  },
  modalTextArea: {
    minHeight: 76,
    textAlignVertical: 'top',
  },
  modalSectionTitle: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    marginTop: spacing.md,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  modalHint: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.md,
  },
  modalCancelBtn: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#334155',
  },
  modalSaveBtn: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#eab308',
  },
  modalSaveBtnDisabled: {
    opacity: 0.65,
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#111827',
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    padding: spacing.md,
  },
  optionSheet: {
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderColor: colors.border,
    borderWidth: 1,
    overflow: 'hidden',
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
    fontSize: 20,
    fontWeight: fontWeights.heavy,
  },
  sheetClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: 192,
    position: 'relative',
    overflow: 'hidden',
  },
  androidWheelSelection: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: 72,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
  },
  androidPickerFrame: {
    height: 192,
  },
  androidPickerContent: {
    paddingVertical: 72,
  },
  optionRow: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionRowSelected: {
    backgroundColor: '#fef3c7',
  },
  optionText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: fontWeights.bold,
  },
  optionTextSelected: {
    color: '#92400e',
    fontWeight: fontWeights.heavy,
  },
  sheetActions: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.sm,
  },
  sheetCancel: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  sheetCancelText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: fontWeights.bold,
  },
  sheetDone: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginLeft: spacing.xs,
  },
  sheetDoneText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: fontWeights.bold,
  },
});
