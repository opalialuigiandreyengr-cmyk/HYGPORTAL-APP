import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import {
  Award,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Heart,
  Lightbulb,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Star,
  Trophy,
  UserCheck,
  X,
} from 'lucide-react-native';

import {
  loadDepartmentEmployeesForBadgeAward,
  loadMyBadgeAwardRequisitions,
  submitBadgeAwardRequisition,
  type BadgeAwardRequisitionItem,
  type BadgeCatalogItem,
  type DepartmentBadgeRecipient,
} from '../services/badges';
import { colors, spacing } from '../theme';
import type { AppToastMessage } from './AppToast';

type AwardBadgeModalProps = {
  visible: boolean;
  onClose: () => void;
  catalog: BadgeCatalogItem[];
  managerEmployeeId: string;
  managerName: string;
  managerPositionName?: string | null;
  managerDepartmentName?: string | null;
  onToast?: (toast: AppToastMessage) => void;
};

export function AwardBadgeModal({
  visible,
  onClose,
  catalog,
  managerEmployeeId,
  managerName,
  managerPositionName,
  managerDepartmentName,
  onToast,
}: AwardBadgeModalProps) {
  const [activeTab, setActiveTab] = useState<'award' | 'requisitions'>('award');
  const [employees, setEmployees] = useState<DepartmentBadgeRecipient[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [employeesError, setEmployeesError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedEmployees, setSelectedEmployees] = useState<DepartmentBadgeRecipient[]>([]);
  const [isEmployeeDropdownOpen, setIsEmployeeDropdownOpen] = useState(false);
  const [selectedBadges, setSelectedBadges] = useState<BadgeCatalogItem[]>([]);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [requisitions, setRequisitions] = useState<BadgeAwardRequisitionItem[]>([]);
  const [isLoadingRequisitions, setIsLoadingRequisitions] = useState(false);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!managerEmployeeId) return;
    setIsLoadingEmployees(true);
    setEmployeesError('');
    setIsLoadingRequisitions(true);

    try {
      const [deptEmployees, myReqs] = await Promise.all([
        loadDepartmentEmployeesForBadgeAward(managerEmployeeId, managerDepartmentName, { forceRefresh }),
        loadMyBadgeAwardRequisitions(managerEmployeeId, { forceRefresh }).catch(() => [] as BadgeAwardRequisitionItem[]),
      ]);
      setEmployees(deptEmployees);
      setRequisitions(myReqs);
    } catch (err) {
      setEmployeesError(err instanceof Error ? err.message : 'Unable to load department employees.');
    } finally {
      setIsLoadingEmployees(false);
      setIsLoadingRequisitions(false);
    }
  }, [managerEmployeeId, managerDepartmentName]);

  useEffect(() => {
    if (!visible) return;
    setActiveTab('award');
    setIsEmployeeDropdownOpen(false);
    setSubmitError('');
    void loadData(false);
  }, [visible, loadData]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (emp) =>
        emp.fullName.toLowerCase().includes(q) ||
        (emp.positionName && emp.positionName.toLowerCase().includes(q)) ||
        (emp.employeeNo && emp.employeeNo.toLowerCase().includes(q)),
    );
  }, [employees, searchQuery]);

  const selectedEmployeeIds = useMemo(
    () => new Set(selectedEmployees.map((e) => e.employeeId)),
    [selectedEmployees],
  );

  const selectedBadgeIds = useMemo(
    () => new Set(selectedBadges.map((b) => b.id)),
    [selectedBadges],
  );

  const toggleEmployee = useCallback((emp: DepartmentBadgeRecipient) => {
    setSelectedEmployees((prev) => {
      const exists = prev.some((e) => e.employeeId === emp.employeeId);
      if (exists) {
        return prev.filter((e) => e.employeeId !== emp.employeeId);
      }
      return [...prev, emp];
    });
  }, []);

  const toggleBadge = useCallback((badge: BadgeCatalogItem) => {
    setSelectedBadges((prev) => {
      const exists = prev.some((b) => b.id === badge.id);
      if (exists) {
        return prev.filter((b) => b.id !== badge.id);
      }
      return [...prev, badge];
    });
  }, []);

  const pendingCount = useMemo(
    () => requisitions.filter((r) => r.status === 'pending').length,
    [requisitions],
  );

  const totalRequisitionsToCreate = selectedEmployees.length * selectedBadges.length;

  const canSubmit = Boolean(
    selectedEmployees.length > 0 &&
      selectedBadges.length > 0 &&
      reason.trim().length > 0 &&
      !isSubmitting,
  );

  const handleSubmit = async () => {
    if (
      selectedEmployees.length === 0 ||
      selectedBadges.length === 0 ||
      !reason.trim() ||
      isSubmitting
    ) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const trimmedReason = reason.trim();
      const tasks: Promise<BadgeAwardRequisitionItem>[] = [];
      for (const recipient of selectedEmployees) {
        for (const badge of selectedBadges) {
          tasks.push(
            submitBadgeAwardRequisition({
              badge,
              recipient,
              requestedById: managerEmployeeId,
              requestedByName: managerName,
              requestedByRole: managerPositionName,
              reason: trimmedReason,
            }),
          );
        }
      }
      const createdList = await Promise.all(tasks);
      setRequisitions((prev) => [...createdList, ...prev]);
      setSelectedEmployees([]);
      setSelectedBadges([]);
      setIsEmployeeDropdownOpen(false);
      setReason('');
      setSearchQuery('');
      onToast?.({
        tone: 'success',
        title: createdList.length === 1 ? 'Requisition Submitted' : 'Requisitions Submitted',
        message:
          createdList.length === 1
            ? `Award request for ${createdList[0].employeeName} (${createdList[0].badgeTitle}) has been sent for approval.`
            : `${createdList.length} badge award requisitions have been sent for approval.`,
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit badge award requisition.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrapper}
        >
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.headerIcon}>
                  <Award size={20} color="#2563eb" strokeWidth={2.3} />
                </View>
                <View style={styles.headerTextWrap}>
                  <Text style={styles.headerTitle}>Award Badge</Text>
                  <Text style={styles.headerSub} numberOfLines={1}>
                    {managerDepartmentName ? `${managerDepartmentName} Department` : 'Department Team'}
                  </Text>
                </View>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  style={styles.closeBtn}
                  onPress={() => void loadData(true)}
                  disabled={isLoadingEmployees || isLoadingRequisitions}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh employees and requisitions"
                >
                  <RefreshCw size={15} color={colors.muted} strokeWidth={2.3} />
                </Pressable>
                <Pressable
                  style={styles.closeBtn}
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close award badge modal"
                >
                  <X size={18} color={colors.muted} strokeWidth={2.4} />
                </Pressable>
              </View>
            </View>

            {/* Tabs */}
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tabBtn, activeTab === 'award' && styles.tabBtnActive]}
                onPress={() => setActiveTab('award')}
              >
                <Text style={[styles.tabText, activeTab === 'award' && styles.tabTextActive]}>
                  New Requisition
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, activeTab === 'requisitions' && styles.tabBtnActive]}
                onPress={() => setActiveTab('requisitions')}
              >
                <Text style={[styles.tabText, activeTab === 'requisitions' && styles.tabTextActive]}>
                  Submitted {requisitions.length > 0 ? `(${requisitions.length})` : ''}
                </Text>
                {pendingCount > 0 ? (
                  <View style={styles.pendingDot} />
                ) : null}
              </Pressable>
            </View>

            {activeTab === 'award' ? (
              <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Step 1: Select Employee(s) Dropdown */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel}>1. Select Employee(s)</Text>
                  {selectedEmployees.length > 0 ? (
                    <Text style={styles.selectedCountText}>
                      {selectedEmployees.length} selected
                    </Text>
                  ) : null}
                </View>

                <Pressable
                  style={[
                    styles.dropdownTrigger,
                    isEmployeeDropdownOpen && styles.dropdownTriggerOpen,
                  ]}
                  onPress={() => setIsEmployeeDropdownOpen((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle employee selection dropdown"
                >
                  <Text
                    style={[
                      styles.dropdownTriggerText,
                      selectedEmployees.length === 0 && styles.dropdownPlaceholderText,
                    ]}
                    numberOfLines={1}
                  >
                    {selectedEmployees.length === 0
                      ? 'Select employee(s)...'
                      : selectedEmployees.length === 1
                        ? selectedEmployees[0].fullName
                        : `${selectedEmployees.length} employees selected`}
                  </Text>
                  {isEmployeeDropdownOpen ? (
                    <ChevronUp size={18} color={colors.muted} strokeWidth={2.2} />
                  ) : (
                    <ChevronDown size={18} color={colors.muted} strokeWidth={2.2} />
                  )}
                </Pressable>

                {isEmployeeDropdownOpen ? (
                  <View style={styles.dropdownPanel}>
                    <View style={styles.searchBox}>
                      <Search size={15} color={colors.muted} strokeWidth={2.2} />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search employee name or position..."
                        placeholderTextColor="#94a3b8"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                      />
                      {searchQuery.length > 0 ? (
                        <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                          <X size={14} color={colors.muted} />
                        </Pressable>
                      ) : null}
                    </View>

                    {isLoadingEmployees ? (
                      <View style={styles.inlineStateBox}>
                        <ActivityIndicator size="small" color="#2563eb" />
                        <Text style={styles.inlineStateText}>Loading department employees...</Text>
                      </View>
                    ) : employeesError ? (
                      <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{employeesError}</Text>
                      </View>
                    ) : filteredEmployees.length === 0 ? (
                      <View style={styles.inlineStateBox}>
                        <Text style={styles.inlineStateText}>
                          {employees.length === 0
                            ? 'No employees found under your department.'
                            : 'No matching employees found.'}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.dropdownActionsRow}>
                          <Pressable
                            onPress={() => {
                              setSelectedEmployees((prev) => {
                                const byId = new Map(prev.map((e) => [e.employeeId, e]));
                                for (const emp of filteredEmployees) {
                                  byId.set(emp.employeeId, emp);
                                }
                                return Array.from(byId.values());
                              });
                            }}
                          >
                            <Text style={styles.dropdownActionLink}>Select all</Text>
                          </Pressable>
                          {selectedEmployees.length > 0 ? (
                            <Pressable onPress={() => setSelectedEmployees([])}>
                              <Text style={styles.dropdownActionClear}>Clear</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        <ScrollView
                          style={styles.employeeList}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                        >
                          {filteredEmployees.map((emp) => {
                            const isSelected = selectedEmployeeIds.has(emp.employeeId);
                            return (
                              <Pressable
                                key={emp.employeeId}
                                style={[
                                  styles.employeeRow,
                                  isSelected && styles.employeeRowSelected,
                                ]}
                                onPress={() => toggleEmployee(emp)}
                              >
                                {emp.photoUrl ? (
                                  <Image source={{ uri: emp.photoUrl }} style={styles.empAvatar} />
                                ) : (
                                  <View style={styles.empAvatarFallback}>
                                    <Text style={styles.empAvatarInitials}>
                                      {getInitials(emp.fullName)}
                                    </Text>
                                  </View>
                                )}
                                <View style={styles.empInfo}>
                                  <Text style={styles.empName} numberOfLines={1}>
                                    {emp.fullName}
                                  </Text>
                                  <Text style={styles.empMeta} numberOfLines={1}>
                                    {[emp.positionName, emp.employeeNo].filter(Boolean).join(' • ') || emp.departmentName}
                                  </Text>
                                </View>
                                <View
                                  style={[
                                    styles.checkboxBox,
                                    isSelected && styles.checkboxBoxSelected,
                                  ]}
                                >
                                  {isSelected ? (
                                    <Check size={13} color="#ffffff" strokeWidth={3} />
                                  ) : null}
                                </View>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      </>
                    )}
                  </View>
                ) : null}

                {/* Step 2: Select Badge(s) */}
                <View style={[styles.sectionHeaderRow, { marginTop: spacing.md }]}>
                  <Text style={styles.sectionLabel}>2. Select Badge(s)</Text>
                  {selectedBadges.length > 0 ? (
                    <View style={styles.badgeHeaderMeta}>
                      <Text style={styles.selectedCountText}>
                        {selectedBadges.length} selected
                      </Text>
                      <Pressable
                        onPress={() => setSelectedBadges([])}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Clear selected badges"
                      >
                        <Text style={styles.dropdownActionClear}>Clear</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                {catalog.length === 0 ? (
                  <View style={styles.inlineStateBox}>
                    <Text style={styles.inlineStateText}>No active badges available.</Text>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.badgePickerRow}
                  >
                    {catalog.map((badge) => {
                      const isSelected = selectedBadgeIds.has(badge.id);
                      const isImageUrl = Boolean(
                        badge.customImagePath &&
                          (badge.customImagePath.startsWith('http://') ||
                            badge.customImagePath.startsWith('https://') ||
                            badge.customImagePath.startsWith('data:image/')),
                      );
                      return (
                        <Pressable
                          key={badge.id}
                          style={[
                            styles.badgeOptionCard,
                            isSelected && styles.badgeOptionCardSelected,
                          ]}
                          onPress={() => toggleBadge(badge)}
                        >
                          {isSelected ? (
                            <View style={styles.badgeOptionCheck}>
                              <Check size={11} color="#ffffff" strokeWidth={3} />
                            </View>
                          ) : null}
                          <View style={styles.badgeOptionVisual}>
                            {isImageUrl && badge.customImagePath ? (
                              <Image
                                source={{ uri: badge.customImagePath }}
                                style={styles.badgeOptionImg}
                                resizeMode="contain"
                              />
                            ) : (
                              renderModalBadgeIcon(
                                badge.iconData,
                                badge.iconColor?.trim() || '#d97706',
                              )
                            )}
                          </View>
                          <Text style={styles.badgeOptionTitle} numberOfLines={2}>
                            {badge.title}
                          </Text>
                          {badge.points > 0 ? (
                            <Text style={styles.badgeOptionPts}>+{badge.points} pts</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}

                {/* Step 3: Reason */}
                <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
                  3. Reason / Commendation
                </Text>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Write why this employee deserves the badge..."
                  placeholderTextColor="#94a3b8"
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                {submitError ? (
                  <View style={[styles.errorBox, { marginTop: spacing.sm }]}>
                    <Text style={styles.errorText}>{submitError}</Text>
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    !canSubmit && styles.submitBtnDisabled,
                    pressed && canSubmit && styles.submitBtnPressed,
                  ]}
                  onPress={() => void handleSubmit()}
                  disabled={!canSubmit}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Send size={16} color="#ffffff" strokeWidth={2.3} />
                      <Text style={styles.submitBtnText}>
                        {totalRequisitionsToCreate > 1
                          ? `Submit ${totalRequisitionsToCreate} Requisitions`
                          : 'Submit Award Requisition'}
                      </Text>
                    </>
                  )}
                </Pressable>
              </ScrollView>
            ) : (
              <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator={false}
              >
                {isLoadingRequisitions ? (
                  <View style={styles.inlineStateBox}>
                    <ActivityIndicator size="small" color="#2563eb" />
                    <Text style={styles.inlineStateText}>Loading submitted requisitions...</Text>
                  </View>
                ) : requisitions.length === 0 ? (
                  <View style={styles.inlineStateBox}>
                    <UserCheck size={24} color="#94a3b8" />
                    <Text style={styles.inlineStateText}>
                      You haven't submitted any badge award requisitions yet.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.reqList}>
                    {requisitions.map((req) => (
                      <View key={req.id} style={styles.reqCard}>
                        <View style={styles.reqTopRow}>
                          <Text style={styles.reqBadgeTitle} numberOfLines={1}>
                            {req.badgeTitle}
                          </Text>
                          <View
                            style={[
                              styles.reqStatusPill,
                              req.status === 'approved'
                                ? styles.reqStatusApproved
                                : req.status === 'rejected'
                                  ? styles.reqStatusRejected
                                  : styles.reqStatusPending,
                            ]}
                          >
                            <Text
                              style={[
                                styles.reqStatusText,
                                req.status === 'approved'
                                  ? styles.reqStatusTextApproved
                                  : req.status === 'rejected'
                                    ? styles.reqStatusTextRejected
                                    : styles.reqStatusTextPending,
                              ]}
                            >
                              {req.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.reqRecipient}>
                          For: <Text style={styles.reqRecipientBold}>{req.employeeName}</Text>
                          {req.points > 0 ? ` • +${req.points} pts` : ''}
                        </Text>
                        <Text style={styles.reqReason}>"{req.reason}"</Text>
                        {req.reviewNote ? (
                          <Text style={styles.reqReviewNote}>Review note: {req.reviewNote}</Text>
                        ) : null}
                        <View style={styles.reqDateRow}>
                          <Clock3 size={11} color={colors.muted} />
                          <Text style={styles.reqDateText}>{formatShortDate(req.createdAt)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function formatShortDate(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function renderModalBadgeIcon(iconData: string, color: string) {
  const size = 30;
  const strokeWidth = 2.2;
  switch (iconData) {
    case 'emoji_events':
      return <Trophy size={size} color={color} strokeWidth={strokeWidth} />;
    case 'rocket_launch':
      return <Rocket size={size} color={color} strokeWidth={strokeWidth} />;
    case 'menu_book':
      return <BookOpen size={size} color={color} strokeWidth={strokeWidth} />;
    case 'workspace_premium':
      return <Award size={size} color={color} strokeWidth={strokeWidth} />;
    case 'favorite':
      return <Heart size={size} color={color} strokeWidth={strokeWidth} />;
    case 'verified':
      return <BadgeCheck size={size} color={color} strokeWidth={strokeWidth} />;
    case 'lightbulb_outline':
      return <Lightbulb size={size} color={color} strokeWidth={strokeWidth} />;
    case 'star':
    default:
      return <Star size={size} color={color} strokeWidth={strokeWidth} />;
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheetWrapper: {
    maxHeight: '88%',
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm + 2,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  headerSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    marginBottom: spacing.sm + 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.text,
  },
  pendingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#f59e0b',
  },
  bodyScroll: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingBottom: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  selectedCountText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '700',
  },
  badgeHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dropdownTriggerOpen: {
    borderColor: '#2563eb',
    backgroundColor: '#ffffff',
  },
  dropdownTriggerText: {
    flex: 1,
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '600',
  },
  dropdownPlaceholderText: {
    color: '#94a3b8',
    fontWeight: '500',
  },
  selectedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  selectedChipText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  dropdownPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    padding: 8,
  },
  dropdownActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  dropdownActionLink: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '700',
  },
  dropdownActionClear: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '700',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    padding: 0,
  },
  employeeList: {
    maxHeight: 165,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
  },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  employeeRowSelected: {
    backgroundColor: '#eff6ff',
  },
  empAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  empAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empAvatarInitials: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
  },
  empInfo: {
    flex: 1,
    minWidth: 0,
  },
  empName: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  empMeta: {
    color: colors.muted,
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 1,
  },
  selectedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePickerRow: {
    gap: 10,
    paddingVertical: 2,
  },
  badgeOptionCard: {
    width: 112,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    padding: 10,
    alignItems: 'center',
    position: 'relative',
  },
  badgeOptionCardSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  badgeOptionCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  badgeOptionVisual: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  badgeOptionImg: {
    width: 44,
    height: 44,
  },
  badgeOptionTitle: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  badgeOptionPts: {
    color: '#16a34a',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
  },
  reasonInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13.5,
    minHeight: 78,
  },
  submitBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 13,
  },
  submitBtnDisabled: {
    backgroundColor: '#94a3b8',
  },
  submitBtnPressed: {
    opacity: 0.88,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '800',
  },
  inlineStateBox: {
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
  },
  inlineStateText: {
    color: colors.muted,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12.5,
    fontWeight: '600',
  },
  reqList: {
    gap: 10,
  },
  reqCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  reqTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reqBadgeTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  reqStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  reqStatusPending: {
    backgroundColor: '#fef3c7',
  },
  reqStatusApproved: {
    backgroundColor: '#dcfce7',
  },
  reqStatusRejected: {
    backgroundColor: '#fee2e2',
  },
  reqStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  reqStatusTextPending: {
    color: '#b45309',
  },
  reqStatusTextApproved: {
    color: '#15803d',
  },
  reqStatusTextRejected: {
    color: '#b91c1c',
  },
  reqRecipient: {
    color: colors.muted,
    fontSize: 12.5,
    marginTop: 4,
  },
  reqRecipientBold: {
    color: colors.text,
    fontWeight: '700',
  },
  reqReason: {
    color: colors.text,
    fontSize: 12.5,
    fontStyle: 'italic',
    marginTop: 6,
  },
  reqReviewNote: {
    color: '#b91c1c',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 4,
  },
  reqDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  reqDateText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
});
