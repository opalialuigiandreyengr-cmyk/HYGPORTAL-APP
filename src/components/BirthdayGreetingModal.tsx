import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Cake, CheckCircle2, Gift, Lock, PartyPopper, Sparkles, X } from 'lucide-react-native';

import { fontWeights, radius, spacing } from '../theme';

type Props = {
  visible: boolean;
  employeeName: string;
  onClose: () => void;
  onClaim?: () => void | Promise<void>;
  isClaimDisabled?: boolean;
  isClaiming?: boolean;
  hasCompletedOneYear?: boolean;
};

export function BirthdayGreetingModal({
  visible,
  employeeName,
  onClose,
  onClaim,
  isClaimDisabled = false,
  isClaiming = false,
  hasCompletedOneYear = true,
}: Props) {
  if (!visible) {
    return null;
  }

  const effectivelyDisabled = isClaimDisabled || !hasCompletedOneYear;

  const greetingMessage = hasCompletedOneYear
    ? `Wishing you a wonderful day filled with happiness, good health, and memorable moments. As a token of our appreciation for your hard work and dedication, we're delighted to grant you one (1) Birthday Leave, so you can celebrate your special day with your loved ones or simply take time to enjoy yourself. Thank you for being a valued member of our team. We hope your year ahead is filled with success, joy, and exciting opportunities. Have an amazing birthday!`
    : `Wishing you a wonderful day filled with happiness, good health, and memorable moments. Thank you for being a valued member of our team. We hope your year ahead is filled with success, joy, and exciting opportunities. Have an amazing birthday!`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Top Decorative Header */}
          <View style={styles.header}>
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Sparkles size={14} color="#facc15" />
                <Text style={styles.badgeText}>SPECIAL OCCASION</Text>
              </View>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <X size={20} color="#64748b" />
            </Pressable>
          </View>

          {/* Festive Banner Hero */}
          <View style={styles.heroSection}>
            <View style={styles.iconGroup}>
              <View style={styles.iconCircleSub}>
                <Gift size={22} color="#f43f5e" />
              </View>
              <View style={styles.iconCircleMain}>
                <PartyPopper size={34} color="#facc15" />
              </View>
              <View style={styles.iconCircleSub}>
                <Cake size={22} color="#8b5cf6" />
              </View>
            </View>
            <Text style={styles.headerTitle}>Happy Birthday!</Text>
            <Text style={styles.employeeHighlight} numberOfLines={1}>{employeeName}</Text>
          </View>

          {/* Message Body */}
          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.cardBox}>
              <Text style={styles.messageText}>{greetingMessage}</Text>

              {!hasCompletedOneYear ? (
                <View style={[styles.perkGrantCard, styles.perkGrantCardTenure]}>
                  <View style={[styles.perkIconBox, styles.perkIconBoxTenure]}>
                    <Lock size={18} color="#64748b" />
                  </View>
                  <View style={styles.perkTextGroup}>
                    <View style={styles.perkTitleRow}>
                      <Text style={styles.perkGrantTitle}>Birthday Leave Grant</Text>
                      <View style={styles.tenureBadge}>
                        <Text style={styles.tenureBadgeText}>1 Year Required</Text>
                      </View>
                    </View>
                    <Text style={styles.perkGrantSub}>
                      Paid Birthday Leave is available after 1 year of service. You may apply manually for Birthday Leave without pay in the Requests screen.
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.perkGrantCard, isClaimDisabled && styles.perkGrantCardClaimed]}>
                  <View style={[styles.perkIconBox, isClaimDisabled && styles.perkIconBoxClaimed]}>
                    <Cake size={20} color={isClaimDisabled ? '#059669' : '#0f172a'} />
                  </View>
                  <View style={styles.perkTextGroup}>
                    <View style={styles.perkTitleRow}>
                      <Text style={styles.perkGrantTitle}>1 Birthday Leave Granted</Text>
                      {isClaimDisabled && (
                        <View style={styles.claimedBadge}>
                          <CheckCircle2 size={11} color="#059669" />
                          <Text style={styles.claimedBadgeText}>Claimed</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.perkGrantSub}>
                      {isClaimDisabled
                        ? 'Already credited to your Requests screen.'
                        : 'Available in your Requests screen.'}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                effectivelyDisabled && styles.actionButtonDisabled,
                pressed && !effectivelyDisabled && !isClaiming && styles.actionButtonPressed,
              ]}
              onPress={effectivelyDisabled || isClaiming ? undefined : (onClaim ?? onClose)}
              disabled={effectivelyDisabled || isClaiming}
              accessibilityRole="button"
              accessibilityState={{ disabled: effectivelyDisabled || isClaiming }}
            >
              {isClaiming ? (
                <>
                  <ActivityIndicator size="small" color="#0f172a" />
                  <Text style={styles.actionButtonText}>Claiming...</Text>
                </>
              ) : !hasCompletedOneYear ? (
                <>
                  <Lock size={18} color="#64748b" />
                  <Text style={[styles.actionButtonText, styles.actionButtonTextDisabled]}>
                    Claim & Celebrate (Under 1 Year Service)
                  </Text>
                </>
              ) : isClaimDisabled ? (
                <>
                  <CheckCircle2 size={18} color="#64748b" />
                  <Text style={[styles.actionButtonText, styles.actionButtonTextDisabled]}>
                    Already Claimed
                  </Text>
                </>
              ) : (
                <>
                  <Sparkles size={18} color="#0f172a" />
                  <Text style={styles.actionButtonText}>Claim & Celebrate</Text>
                </>
              )}
            </Pressable>
            {!hasCompletedOneYear && (
              <Pressable
                style={({ pressed }) => [
                  styles.dismissButton,
                  pressed && styles.dismissButtonPressed,
                ]}
                onPress={onClose}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  container: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderColor: '#e2e8f0',
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 1)',
    borderColor: '#eab308',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    color: "#facc15",
    fontSize: 10,
    fontWeight: fontWeights.heavy,
    letterSpacing: 0.8,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  iconGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconCircleMain: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
    borderColor: '#eac808ff',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  iconCircleSub: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderColor: 'rgba(15, 23, 42, 0.1)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#0f172a',
    fontSize: 26,
    fontWeight: fontWeights.heavy,
    letterSpacing: -0.5,
  },
  employeeHighlight: {
    color: '#f0c000ff',
    fontSize: 18,
    fontWeight: fontWeights.bold,
    marginTop: 2,
  },
  scrollBody: {
    maxHeight: 320,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  cardBox: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.md,
  },
  messageText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '400',
    textAlign: 'justify',
  },
  perkGrantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: '#facc15',
    borderWidth: 1,
    backgroundColor: '#f8f8f8ff',
    borderRadius: 12,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  perkGrantCardClaimed: {
    borderColor: '#a7f3d0',
    backgroundColor: '#f0fdf4',
  },
  perkIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 217, 0, 1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkIconBoxClaimed: {
    backgroundColor: '#bbf7d0',
  },
  perkTextGroup: {
    flex: 1,
  },
  perkTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  claimedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  claimedBadgeText: {
    color: '#15803d',
    fontSize: 10,
    fontWeight: fontWeights.bold,
  },
  perkGrantTitle: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: fontWeights.heavy,
  },
  perkGrantSub: {
    color: '#334155',
    fontSize: 11,
    fontWeight: fontWeights.semibold,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: '#ffffff',
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#facc15',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonDisabled: {
    backgroundColor: '#e2e8f0',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
    opacity: 0.95,
  },
  actionButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  actionButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionButtonTextDisabled: {
    color: '#64748b',
    fontWeight: fontWeights.bold,
  },
  perkGrantCardTenure: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  perkIconBoxTenure: {
    backgroundColor: '#e2e8f0',
  },
  tenureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    borderColor: '#fde047',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tenureBadgeText: {
    color: '#854d0e',
    fontSize: 10,
    fontWeight: fontWeights.bold,
  },
  dismissButton: {
    marginTop: 8,
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  dismissButtonPressed: {
    opacity: 0.7,
  },
  dismissButtonText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: fontWeights.bold,
  },
});
