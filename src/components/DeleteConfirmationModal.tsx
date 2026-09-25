import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, CalendarDays, FileText, Trash2, X } from 'lucide-react-native';

import { colors, fontWeights, radius, spacing } from '../theme';
import { formatUnifiedRequestCode, formatUnifiedRequestType } from './EsarfDetailsView';
import type { MyRequest } from '../services/requests';

type DeleteConfirmationModalProps = {
  visible: boolean;
  request: MyRequest | null;
  sequence?: number;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteConfirmationModal({
  visible,
  request,
  sequence = 1,
  isDeleting = false,
  onConfirm,
  onCancel,
}: DeleteConfirmationModalProps) {
  if (!visible || !request) return null;

  const requestCode = formatUnifiedRequestCode(request, sequence);
  const requestType = formatUnifiedRequestType(request);
  const requestDate = request.date_from || request.start_date || request.submitted_at || null;
  const reason = request.reason?.trim() || null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={isDeleting ? undefined : onCancel} />

        <View style={styles.card}>
          {/* Close button */}
          <Pressable
            style={styles.closeBtn}
            onPress={isDeleting ? undefined : onCancel}
            hitSlop={12}
            accessibilityLabel="Close confirmation"
          >
            <X size={16} color="#94a3b8" />
          </Pressable>

          {/* Red Trash Icon Header */}
          <View style={styles.iconWrapper}>
            <View style={styles.iconOuterRing}>
              <View style={styles.iconInnerCircle}>
                <Trash2 size={24} color="#dc2626" strokeWidth={2.4} />
              </View>
            </View>
          </View>

          {/* Badge & Title */}
          <View style={styles.headerBlock}>
            <View style={styles.badge}>
              <AlertTriangle size={12} color="#b91c1c" strokeWidth={2.4} />
              <Text style={styles.badgeText}>DELETE CONFIRMATION</Text>
            </View>
            <Text style={styles.title}>Delete Pending Request?</Text>
            <Text style={styles.description}>
              Are you sure you want to delete this pending request? This action cannot be undone.
            </Text>
          </View>

          {/* Request Info Card */}
          <View style={styles.requestCard}>
            <View style={styles.cardTopRow}>
              <View style={styles.codePill}>
                <FileText size={12} color="#1d4ed8" strokeWidth={2.2} />
                <Text style={styles.codePillText} numberOfLines={1}>
                  {requestCode}
                </Text>
              </View>
              <View style={styles.typePill}>
                <Text style={styles.typePillText} numberOfLines={1}>
                  {requestType}
                </Text>
              </View>
            </View>

            {requestDate ? (
              <View style={styles.dateRow}>
                <CalendarDays size={13} color={colors.muted} strokeWidth={2.2} />
                <Text style={styles.dateText} numberOfLines={1}>
                  {requestDate}
                </Text>
              </View>
            ) : null}

            {reason ? (
              <Text style={styles.reasonText} numberOfLines={2}>
                "{reason}"
              </Text>
            ) : null}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <Pressable
              disabled={isDeleting}
              style={[styles.cancelBtn, isDeleting ? styles.btnDisabled : null]}
              onPress={onCancel}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              disabled={isDeleting}
              style={[styles.deleteBtn, isDeleting ? styles.deleteBtnLoading : null]}
              onPress={onConfirm}
            >
              {isDeleting ? (
                <>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.deleteBtnText}>Deleting...</Text>
                </>
              ) : (
                <>
                  <Trash2 size={16} color="#ffffff" strokeWidth={2.4} />
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  dismissArea: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    shadowColor: '#071426',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 12,
    position: 'relative',
    alignItems: 'center',
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  iconWrapper: {
    marginBottom: 10,
    alignItems: 'center',
  },
  iconOuterRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  iconInnerCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: 14,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    marginBottom: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: fontWeights.heavy,
    color: '#b91c1c',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 6,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  requestCard: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 16,
    gap: 6,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  codePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  codePillText: {
    fontSize: 12,
    fontWeight: fontWeights.heavy,
    color: '#1d4ed8',
  },
  typePill: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  typePillText: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#334155',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  dateText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  reasonText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#475569',
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#475569',
  },
  deleteBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  deleteBtnLoading: {
    opacity: 0.75,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
