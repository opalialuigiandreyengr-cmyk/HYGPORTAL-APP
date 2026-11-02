import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LogOut, ShieldAlert, User, X } from 'lucide-react-native';

import { colors, fontWeights, radius, spacing } from '../theme';

export type SignOutConfirmationModalProps = {
  visible: boolean;
  isSigningOut?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function SignOutConfirmationModal({
  visible,
  isSigningOut = false,
  userName,
  userEmail,
  onConfirm,
  onCancel,
}: SignOutConfirmationModalProps) {
  if (!visible) return null;

  const hasUserInfo = Boolean(userName?.trim() || userEmail?.trim());
  const primaryName = userName?.trim() || userEmail?.trim() || 'Employee';
  const secondaryText = userName?.trim() && userEmail?.trim() ? userEmail.trim() : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isSigningOut ? undefined : onCancel}
    >
      <Pressable
        style={styles.backdrop}
        onPress={isSigningOut ? undefined : onCancel}
      >
        <Pressable
          style={styles.card}
          onPress={(e) => {
            e?.stopPropagation?.();
          }}
        >
          {/* Close button */}
          <Pressable
            style={styles.closeBtn}
            onPress={isSigningOut ? undefined : onCancel}
            disabled={isSigningOut}
            hitSlop={12}
            accessibilityLabel="Close sign out confirmation"
          >
            <X size={16} color="#94a3b8" />
          </Pressable>

          {/* Crimson Icon Header */}
          <View style={styles.iconWrapper}>
            <View style={styles.iconOuterRing}>
              <View style={styles.iconInnerCircle}>
                <LogOut size={22} color="#dc2626" strokeWidth={2.6} />
              </View>
            </View>
          </View>

          {/* Badge & Title */}
          <View style={styles.headerBlock}>
            <Text style={styles.title}>Sign Out of HYG Portal?</Text>
            <Text style={styles.description}>
              Are you sure you want to exit your account? You will need your login credentials to sign back in.
            </Text>
          </View>

          {/* User Account Card */}
          {hasUserInfo ? (
            <View style={styles.userCard}>
              <View style={styles.userAvatarCircle}>
                <User size={18} color="#071426" strokeWidth={2.4} />
              </View>
              <View style={styles.userInfoWrap}>
                <Text style={styles.userNameText} numberOfLines={1}>
                  {primaryName}
                </Text>
                {secondaryText ? (
                  <Text style={styles.userEmailText} numberOfLines={1}>
                    {secondaryText}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <Pressable
              disabled={isSigningOut}
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && !isSigningOut ? styles.cancelBtnPressed : null,
                isSigningOut ? styles.btnDisabled : null,
              ]}
              onPress={onCancel}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              disabled={isSigningOut}
              style={({ pressed }) => [
                styles.signOutBtn,
                pressed && !isSigningOut ? styles.signOutBtnPressed : null,
                isSigningOut ? styles.signOutBtnLoading : null,
              ]}
              onPress={onConfirm}
            >
              {isSigningOut ? (
                <>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.signOutBtnText}>Signing out...</Text>
                </>
              ) : (
                <>
                  <LogOut size={16} color="#ffffff" strokeWidth={2.5} />
                  <Text style={styles.signOutBtnText}>Sign Out</Text>
                </>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
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
  card: {
    width: '100%',
    maxWidth: 350,
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
    elevation: 24,
    position: 'relative',
    alignItems: 'center',
    overflow: 'hidden',
    zIndex: 10,
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
    backgroundColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f87171',
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: 14,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 8,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: fontWeights.heavy,
    letterSpacing: 0.8,
    color: '#b91c1c',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 18.5,
    fontWeight: fontWeights.heavy,
    color: '#071426',
    marginBottom: 6,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 6,
  },
  userCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 10,
  },
  userAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfoWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  userNameText: {
    fontSize: 13.5,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  userEmailText: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnPressed: {
    backgroundColor: '#e2e8f0',
    opacity: 0.9,
  },
  cancelBtnText: {
    fontSize: 13.5,
    fontWeight: fontWeights.bold,
    color: '#334155',
  },
  signOutBtn: {
    flex: 1.2,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  signOutBtnPressed: {
    backgroundColor: '#b91c1c',
    opacity: 0.92,
  },
  signOutBtnLoading: {
    opacity: 0.8,
  },
  signOutBtnText: {
    fontSize: 13.5,
    fontWeight: fontWeights.heavy,
    color: '#ffffff',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});

