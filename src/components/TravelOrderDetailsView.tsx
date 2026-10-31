import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Briefcase,
  Building2,
  Coins,
  Compass,
  Contact,
  CreditCard,
  Pencil,
  Users,
  X,
} from 'lucide-react-native';
import { Avatar } from './Avatar';
import { formatUnifiedRequestCode, type TimelineStep } from './EsarfDetailsView';
import {
  fetchTravelOrderDetails,
  type TravelOrderDetailsData,
} from '../services/travelOrder';
import type { MyRequest } from '../services/requests';
import type { PendingApproval, ApprovedApproval } from '../services/approvals';
import type { EmployeeProfileSummary } from '../types/domain';

export type TravelOrderDetailsViewProps = {
  item: MyRequest | PendingApproval | ApprovedApproval;
  sequence?: number;
  profile?: EmployeeProfileSummary | null;
  onClose: () => void;
  timelineRows?: TimelineStep[];
  footerActions?: React.ReactNode;
  onEdit?: (item: MyRequest) => void;
  canEdit?: boolean;
};

function formatMDY(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const y = d.getFullYear();
    return `${m}/${day}/${y}`;
  }
  return dateStr;
}

function formatDisplayTime(timeStr?: string | null): string {
  if (!timeStr) return 'N/A';
  const clean = timeStr.trim();
  if (/^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(clean)) {
    return clean.toUpperCase();
  }
  const parts = clean.split(':');
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }
  return clean;
}

function formatSubmittedDate(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatSubmittedTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${mins} ${ampm}`;
}

function formatCurrencyAmount(amount?: number | null): string {
  if (amount == null || amount === 0) return '';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TravelOrderDetailsContent({
  item,
  sequence = 1,
  profile,
  onClose,
  timelineRows = [],
  footerActions,
  onEdit,
  canEdit,
}: TravelOrderDetailsViewProps) {
  const [details, setDetails] = useState<TravelOrderDetailsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetchTravelOrderDetails(item, profile)
      .then((data) => {
        if (isMounted) {
          setDetails(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [item, profile]);

  const rawStatus = (item.status || (item as any).request_status || 'pending').toLowerCase();
  const isApproved = rawStatus === 'approved' || rawStatus === 'final_approved' || rawStatus === 'validated';
  const isRejected = rawStatus === 'rejected';
  const isPending = !isApproved && !isRejected;

  const canUserEdit = (canEdit !== undefined ? canEdit : isPending) && Boolean(onEdit);

  const statusLabel = isApproved ? 'APPROVED' : isRejected ? 'REJECTED' : 'PENDING';
  const statusPillStyle = isApproved
    ? styles.statusApproved
    : isRejected
    ? styles.statusRejected
    : styles.statusPending;

  const documentCode = formatUnifiedRequestCode(item, sequence);

  const displayName = details?.requesterName || (item as any).requester_name || profile?.fullName || 'Requester';
  const departmentName = details?.departmentName || (item as any).department_name || profile?.departmentName || profile?.storeName || 'IT';
  const photoUrl = details?.requesterPhotoUrl || (item as any).requester_photo_url || profile?.photoUrl;
  const submittedAt = item.submitted_at || (item as any).created_at;

  const employeeId = details?.employeeNo || (item as any).requester_employee_no || profile?.employeeNo || 'N/A';
  const homeBranch = details?.homeBranch || profile?.storeName || profile?.departmentName || 'Burgos HQ';
  const positionTitle = details?.positionTitle || profile?.positionName || 'Staff';

  const departureDate = formatMDY(details?.departureDate || item.date_from || (item as any).start_date);
  const departureTime = formatDisplayTime(details?.departureTime || item.time_from);
  const returnDate = formatMDY(details?.returnDate || item.date_to || (item as any).end_date || item.date_from);
  const returnTime = formatDisplayTime(details?.returnTime || item.time_to);

  const destinationStoresText =
    details?.destinationsText ||
    (details?.destinationStores && details.destinationStores.length > 0
      ? details.destinationStores.join(', ')
      : 'Not specified');

  const modeOfTransport = details?.transportMode || '';
  const purposeOfTravel = details?.purposeOfTravel || '';
  const plateNo = details?.plateNo || '';
  const operationalTasks = details?.purposeDetails || '';

  const isCompanyVehicle = modeOfTransport.toLowerCase().includes('company vehicle');
  const isOthersPurpose = purposeOfTravel.toLowerCase().includes('others');

  // Filter approval steps (skip the "Submitted" row for the stepper)
  const approvalSteps = timelineRows.filter(
    (s) => s.title.toLowerCase() !== 'submitted' && !s.subtitle.toLowerCase().includes('submitted'),
  );

  const rejectedReason = (item as any).rejected_reason;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* 1. Header with Title, Document Code, Status Pill, and Close 'X' */}
      <View style={styles.headerRow}>
        <View style={styles.headerTitleColumn}>
          <Text style={styles.mainTitle}>Official Travel Order</Text>
          <View style={styles.codeAndStatusRow}>
            <Text style={styles.documentCode}>{documentCode}</Text>
            <View style={[styles.statusBadge, statusPillStyle]}>
              <Text
                style={[
                  styles.statusBadgeText,
                  isApproved
                    ? styles.statusTextApproved
                    : isRejected
                    ? styles.statusTextRejected
                    : styles.statusTextPending,
                ]}
              >
                {statusLabel}
              </Text>
            </View>
            {canUserEdit && onEdit ? (
              <Pressable
                style={styles.headerEditBtn}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onEdit(item as MyRequest);
                  }, 50);
                }}
                hitSlop={6}
                accessibilityLabel="Edit travel order"
              >
                <Pencil size={11} color="#92400e" strokeWidth={2.4} />
                <Text style={styles.headerEditText}>Edit</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Pressable style={styles.closeIconButton} onPress={onClose} hitSlop={10}>
          <X size={20} color="#0f172a" strokeWidth={2.4} />
        </Pressable>
      </View>

      {/* 2. Requester Information Card */}
      <View style={styles.requesterCard}>
        <View style={styles.requesterLeft}>
          <Avatar name={displayName} photoUrl={photoUrl} size={42} textSize={14} />
          <View style={styles.requesterMeta}>
            <Text style={styles.requesterName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.requesterDept} numberOfLines={1}>
              {departmentName}
            </Text>
          </View>
        </View>
        <View style={styles.submittedRight}>
          <Text style={styles.submittedLabel}>{isApproved ? 'Approved on' : 'Submitted on'}</Text>
          <Text style={styles.submittedDate}>{formatSubmittedDate(submittedAt)}</Text>
          <Text style={styles.submittedTime}>{formatSubmittedTime(submittedAt)}</Text>
        </View>
      </View>

      {/* 3. Employee Profile Card */}
      <View style={styles.profileSection}>
        <View style={styles.sectionHeaderRow}>
          <Contact size={18} color="#0f172a" strokeWidth={2.2} />
          <Text style={styles.sectionTitle}>Employee Profile</Text>
        </View>
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.profileFieldLeft}>
              <CreditCard size={16} color="#64748b" strokeWidth={2} />
              <Text style={styles.profileFieldLabel}>Employee ID</Text>
            </View>
            <Text style={styles.profileFieldValue}>{employeeId}</Text>
          </View>

          <View style={styles.profileRow}>
            <View style={styles.profileFieldLeft}>
              <Building2 size={16} color="#64748b" strokeWidth={2} />
              <Text style={styles.profileFieldLabel}>Home Branch/Base</Text>
            </View>
            <Text style={styles.profileFieldValue}>{homeBranch}</Text>
          </View>

          <View style={[styles.profileRow, styles.noBorderBottom]}>
            <View style={styles.profileFieldLeft}>
              <Briefcase size={16} color="#64748b" strokeWidth={2} />
              <Text style={styles.profileFieldLabel}>Position/Title</Text>
            </View>
            <Text style={styles.profileFieldValue}>{positionTitle}</Text>
          </View>
        </View>
      </View>

      {/* 4. Travel Itinerary & Specific Work Intent Card */}
      <View style={styles.cardContainer}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardIconBadge}>
            <Compass size={14} color="#ffffff" strokeWidth={2.4} />
          </View>
          <Text style={styles.cardHeaderTitle}>Travel Itinerary & Specific Work Intent</Text>
        </View>
        <View style={styles.cardDivider} />

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Destination Store(s)</Text>
          <Text style={styles.fieldValueBold}>{destinationStoresText}</Text>
        </View>

        <View style={styles.twoColumnRow}>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Departure Date</Text>
            <Text style={styles.fieldValueBold}>{departureDate}</Text>
          </View>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Departure Time</Text>
            <Text style={styles.fieldValueBold}>{departureTime}</Text>
          </View>
        </View>

        <View style={styles.twoColumnRow}>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Return Date</Text>
            <Text style={styles.fieldValueBold}>{returnDate}</Text>
          </View>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Return Time</Text>
            <Text style={styles.fieldValueBold}>{returnTime}</Text>
          </View>
        </View>

        <View style={styles.twoColumnRow}>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Specific Mode of Transport</Text>
            <Text style={styles.fieldValueBold}>{modeOfTransport || 'Not specified'}</Text>
          </View>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Purpose of Travel</Text>
            <Text style={styles.fieldValueBold}>{purposeOfTravel || 'Not specified'}</Text>
          </View>
        </View>

        {/* Boxed Vehicle Plate No. - Only displayed if company vehicle is selected */}
        {isCompanyVehicle ? (
          <View style={styles.boxedContainer}>
            <Text style={styles.boxedLabel}>Vehicle Plate No. *</Text>
            <View style={styles.boxedInputLike}>
              <Text style={plateNo ? styles.boxedInputText : styles.boxedPlaceholderText}>
                {plateNo || 'None specified'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Boxed Specific Detailed Operational Tasks - Only displayed if others is selected */}
        {isOthersPurpose ? (
          <View style={styles.boxedContainer}>
            <Text style={styles.boxedLabel}>Specific Detailed Operational Tasks*</Text>
            <View style={[styles.boxedInputLike, styles.boxedMultilineInput]}>
              <Text style={operationalTasks ? styles.boxedInputText : styles.boxedPlaceholderText}>
                {operationalTasks || 'No detailed tasks provided.'}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* 5. Financial Authorization & Per Diem Allowances Card */}
      <View style={styles.cardContainer}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardIconBadge}>
            <Coins size={14} color="#ffffff" strokeWidth={2.4} />
          </View>
          <Text style={styles.cardHeaderTitle}>Financial Authorization & Per Diem Allowances</Text>
        </View>
        <View style={styles.cardDivider} />

        <View style={styles.tableHeaderRow}>
          <Text style={styles.tableHeaderLeft}>Expense Classification</Text>
          <Text style={styles.tableHeaderRight}>Pre-authorized Budget</Text>
        </View>

        {/* Expense Row 1: Transport Costs */}
        <View style={styles.expenseRow}>
          <View style={styles.expenseClassificationCol}>
            <Text style={styles.expenseClassificationTitle}>Transport Costs</Text>
            <Text style={styles.expenseClassificationSubtitle}> (Fuel, Tolls, Commuter Fares)</Text>
          </View>
          <View style={styles.budgetAmountBox}>
            <Text style={styles.pesoSign}>₱</Text>
            <Text style={styles.budgetAmountText}>
              {formatCurrencyAmount(details?.transportBudget)}
            </Text>
          </View>
        </View>

        {/* Expense Row 2: Meal / Per Diem */}
        <View style={styles.expenseRow}>
          <View style={styles.expenseClassificationCol}>
            <Text style={styles.expenseClassificationTitle}>Meal / Per Diem Allowance</Text>
            <Text style={styles.expenseClassificationSubtitle}> (Standard Food Rate)</Text>
          </View>
          <View style={styles.budgetAmountBox}>
            <Text style={styles.pesoSign}>₱</Text>
            <Text style={styles.budgetAmountText}>
              {formatCurrencyAmount(details?.mealBudget)}
            </Text>
          </View>
        </View>

        {/* Expense Row 3: Emergency Out-of-Pocket */}
        <View style={styles.expenseRow}>
          <View style={styles.expenseClassificationCol}>
            <Text style={styles.expenseClassificationTitle}>Emergency Out-of-Pocket Expense</Text>
            <Text style={styles.expenseClassificationSubtitle}> (Capped Parts/Tools)</Text>
          </View>
          <View style={styles.budgetAmountBox}>
            <Text style={styles.pesoSign}>₱</Text>
            <Text style={styles.budgetAmountText}>
              {formatCurrencyAmount(details?.emergencyBudget)}
            </Text>
          </View>
        </View>

        <View style={styles.accountingSubHeaderContainer}>
          <Text style={styles.accountingSubHeaderText}>Accounting Fund Source & Control Codes</Text>
        </View>

        <View style={styles.twoColumnRow}>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Cost Center Code</Text>
            <Text style={styles.fieldValueBold}>{details?.costCenterCode || '000000'}</Text>
          </View>
          <View style={styles.columnHalf}>
            <Text style={styles.fieldLabel}>Charge to Store/Branch</Text>
            <Text style={styles.fieldValueBold}>{details?.chargeToStore || homeBranch}</Text>
          </View>
        </View>
      </View>

      {/* 6. Approval Timeline Card */}
      {approvalSteps.length > 0 ? (
        <View style={styles.cardContainer}>
          <View style={styles.cardHeaderRow}>
            <Users size={16} color="#64748b" strokeWidth={2.2} />
            <Text style={styles.cardHeaderTitle}>Approval Timeline</Text>
          </View>
          <View style={styles.cardDivider} />

          <View style={styles.stepperContainer}>
            {approvalSteps.length > 1 ? <View style={styles.stepperLineTrack} /> : null}

            <View style={styles.stepperColumnsRow}>
              {approvalSteps.map((step, idx) => {
                const isStepGreen = step.tone === 'approved' || step.tone === 'success';
                const isStepYellow = step.tone === 'pending' || step.tone === 'warning';
                const isStepRed = step.tone === 'rejected' || step.tone === 'danger';
                const dotColor = isStepGreen
                  ? '#22c55e'
                  : isStepYellow
                  ? '#eab308'
                  : isStepRed
                  ? '#ef4444'
                  : '#cbd5e1';

                return (
                  <View key={idx} style={styles.stepperColumn}>
                    <View style={[styles.stepperDot, { backgroundColor: dotColor }]} />
                    <Text style={styles.stepTitleText} numberOfLines={2}>
                      {step.title}
                    </Text>
                    <Text style={styles.stepSubtitleText} numberOfLines={1}>
                      {step.subtitle}
                    </Text>
                    {step.date ? (
                      <Text style={styles.stepDateText} numberOfLines={1}>
                        {step.date}
                      </Text>
                    ) : null}
                    {step.time ? (
                      <Text style={styles.stepTimeText} numberOfLines={1}>
                        {step.time}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      ) : null}

      {/* Rejection Alert if applicable */}
      {rejectedReason ? (
        <View style={styles.rejectedBox}>
          <Text style={styles.rejectedLabel}>Reason for Rejection</Text>
          <Text style={styles.rejectedText}>{rejectedReason}</Text>
        </View>
      ) : null}

      {/* 7. Action Buttons */}
      {footerActions ? (
        <View style={styles.footerActionsContainer}>{footerActions}</View>
      ) : canUserEdit && onEdit ? (
        <View style={styles.actionButtonsRow}>
          <Pressable
            style={styles.editFullButton}
            onPress={() => {
              onClose();
              setTimeout(() => {
                onEdit(item as MyRequest);
              }, 50);
            }}
          >
            <Pencil size={15} color="#92400e" strokeWidth={2.4} />
            <Text style={styles.editFullButtonText}>Edit</Text>
          </Pressable>
          <Pressable style={styles.closeHalfButton} onPress={onClose}>
            <Text style={styles.closeFullButtonText}>Close</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.closeFullButton} onPress={onClose}>
          <Text style={styles.closeFullButtonText}>Close</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export function TravelOrderDetailsModal({
  visible,
  item,
  sequence,
  profile,
  onClose,
  timelineRows,
  footerActions,
  onEdit,
  canEdit,
}: TravelOrderDetailsViewProps & { visible: boolean }) {
  if (!visible || !item) return null;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheetContainer}>
          <TravelOrderDetailsContent
            item={item}
            sequence={sequence}
            profile={profile}
            onClose={onClose}
            timelineRows={timelineRows}
            footerActions={footerActions}
            onEdit={onEdit}
            canEdit={canEdit}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    minHeight: '60%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
  scrollContainer: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  headerTitleColumn: {
    flex: 1,
    marginRight: 12,
  },
  mainTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  codeAndStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  documentCode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPending: {
    backgroundColor: '#fef3c7',
  },
  statusApproved: {
    backgroundColor: '#dcfce7',
  },
  statusRejected: {
    backgroundColor: '#fee2e2',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  statusTextPending: {
    color: '#b45309',
  },
  statusTextApproved: {
    color: '#15803d',
  },
  statusTextRejected: {
    color: '#b91c1c',
  },
  closeIconButton: {
    padding: 6,
    marginTop: -2,
    marginRight: -6,
  },

  // Requester Card
  requesterCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  requesterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  requesterMeta: {
    flex: 1,
  },
  requesterName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
  },
  requesterDept: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  submittedRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  submittedLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  submittedDate: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 1,
  },
  submittedTime: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },

  // Employee Profile
  profileSection: {
    marginBottom: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  profileCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  noBorderBottom: {
    borderBottomWidth: 0,
  },
  profileFieldLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileFieldLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  profileFieldValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },

  // Cards
  cardContainer: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#eab308',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginTop: 10,
    marginBottom: 12,
  },

  fieldBlock: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 2,
  },
  fieldValueBold: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  twoColumnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  columnHalf: {
    flex: 1,
  },

  // Boxed items
  boxedContainer: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#ffffff',
  },
  boxedLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  boxedInputLike: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  boxedMultilineInput: {
    minHeight: 52,
    justifyContent: 'flex-start',
  },
  boxedInputText: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '500',
  },
  boxedPlaceholderText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },

  // Financial Authorization
  tableHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tableHeaderLeft: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  tableHeaderRight: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'right',
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  expenseClassificationCol: {
    flex: 1.4,
    paddingRight: 6,
  },
  expenseClassificationTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  expenseClassificationSubtitle: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '400',
  },
  budgetAmountBox: {
    width: 125,
    height: 34,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  pesoSign: {
    fontSize: 13,
    color: '#64748b',
    marginRight: 4,
    fontWeight: '600',
  },
  budgetAmountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  accountingSubHeaderContainer: {
    marginTop: 6,
    marginBottom: 8,
  },
  accountingSubHeaderText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },

  // Approval Timeline Stepper
  stepperContainer: {
    marginTop: 4,
    paddingVertical: 2,
    position: 'relative',
  },
  stepperLineTrack: {
    position: 'absolute',
    top: 5,
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: '#e2e8f0',
    zIndex: 0,
  },
  stepperColumnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  stepperColumn: {
    flex: 1,
    alignItems: 'flex-start',
    paddingRight: 4,
  },
  stepperDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 6,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  stepTitleText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
  },
  stepSubtitleText: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  stepDateText: {
    fontSize: 9,
    color: '#94a3b8',
    marginTop: 2,
  },
  stepTimeText: {
    fontSize: 9,
    color: '#94a3b8',
  },

  rejectedBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  rejectedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b91c1c',
    marginBottom: 2,
  },
  rejectedText: {
    fontSize: 12,
    color: '#7f1d1d',
  },

  headerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  headerEditText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400e',
    letterSpacing: 0.3,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  editFullButton: {
    flex: 1,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  editFullButtonText: {
    color: '#92400e',
    fontSize: 14,
    fontWeight: '700',
  },
  closeHalfButton: {
    flex: 1,
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerActionsContainer: {
    marginBottom: 10,
  },
  closeFullButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  closeFullButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

