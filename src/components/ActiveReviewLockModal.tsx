import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock, ShieldAlert, UserCheck, X } from 'lucide-react-native';

import { colors, fontWeights, radius, spacing } from '../theme';

type ActiveReviewLockModalProps = {
  visible: boolean;
  approverName?: string | null;
  approverPosition?: string | null;
  onClose: () => void;
};

export function ActiveReviewLockModal({
  visible,
  approverName,
  approverPosition,
  onClose,
}: ActiveReviewLockModalProps) {
  if (!visible) return null;

  const displayName = approverName || 'Manager / Approver';
  const displayPosition = approverPosition || 'Manager / Approver';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />

        <View style={styles.card}>
          {/* Close button */}
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <X size={16} color="#94a3b8" />
          </Pressable>

          {/* Gold Icon Header */}
          <View style={styles.iconWrapper}>
            <View style={styles.iconOuterRing}>
              <View style={styles.iconInnerCircle}>
                <Lock size={22} color="#ca8a04" strokeWidth={2.4} />
              </View>
            </View>
          </View>

          {/* Gold Badge & Dark Navy Title */}
          <View style={styles.headerBlock}>
            <View style={styles.badge}>
              <ShieldAlert size={12} color="#854d0e" strokeWidth={2.4} />
              <Text style={styles.badgeText}>ACTIVE REVIEW LOCK</Text>
            </View>
            <Text style={styles.title}>Request Under Active Review</Text>
          </View>

          {/* Body Content */}
          <Text style={styles.leadText}>Currently being reviewed by:</Text>

          {/* Approver Gold Profile Card */}
          <View style={styles.approverCard}>
            <View style={styles.approverAvatarCircle}>
              <UserCheck size={18} color="#854d0e" strokeWidth={2.4} />
            </View>
            <View style={styles.approverInfo}>
              <Text style={styles.approverName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.approverPosition} numberOfLines={1}>
                {displayPosition}
              </Text>
            </View>
          </View>

          <Text style={styles.footerNoteText}>
            Editing is temporarily disabled while they are viewing it to prevent data conflicts. Please try again shortly.
          </Text>

          {/* Signature Gold Action Button */}
          <Pressable style={({ pressed }) => [styles.actionBtn, pressed ? styles.actionBtnPressed : null]} onPress={onClose}>
            <Text style={styles.actionBtnText}>Got It</Text>
          </Pressable>
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
    maxWidth: 350,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    borderWidth: 1.5,
    borderColor: '#fde047',
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
    backgroundColor: '#fef9c3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fde047',
  },
  iconInnerCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ca8a04',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef9c3',
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: radius.pill,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#fde047',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    color: '#854d0e',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    color: colors.brand.ink,
    textAlign: 'center',
  },
  leadText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: fontWeights.medium,
    marginBottom: 8,
    textAlign: 'center',
  },
  approverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fefce8',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '100%',
    borderWidth: 1,
    borderColor: '#fde047',
    marginBottom: 12,
  },
  approverAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fef08a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#facc15',
  },
  approverInfo: {
    flex: 1,
  },
  approverName: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: '#78350f',
    lineHeight: 18,
  },
  approverPosition: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#a16207',
    lineHeight: 15,
    marginTop: 1,
  },
  footerNoteText: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  actionBtn: {
    width: '100%',
    backgroundColor: colors.brand.goldStrong,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ca8a04',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  actionBtnText: {
    color: colors.brand.ink,
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    letterSpacing: 0.3,
  },
});
