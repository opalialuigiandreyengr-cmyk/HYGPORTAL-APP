import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Cake, Gift, PartyPopper, Sparkles, X } from 'lucide-react-native';

import { fontWeights, radius, spacing } from '../theme';

type Props = {
  visible: boolean;
  employeeName: string;
  onClose: () => void;
};

export function BirthdayGreetingModal({ visible, employeeName, onClose }: Props) {
  if (!visible) {
    return null;
  }

  const greetingMessage = `Wishing you a wonderful day filled with happiness, good health, and memorable moments. As a token of our appreciation for your hard work and dedication, we're delighted to grant you one (1) Birthday Leave, so you can celebrate your special day with your loved ones or simply take time to enjoy yourself. Thank you for being a valued member of our team. We hope your year ahead is filled with success, joy, and exciting opportunities. Have an amazing birthday!`;

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

              <View style={styles.perkGrantCard}>
                <View style={styles.perkIconBox}>
                  <Cake size={20} color="#0f172a" />
                </View>
                <View style={styles.perkTextGroup}>
                  <Text style={styles.perkGrantTitle}>1 Birthday Leave Granted</Text>
                  <Text style={styles.perkGrantSub}>Available in your Requests screen.</Text>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footer}>
            <Pressable style={styles.actionButton} onPress={onClose}>
              <Sparkles size={18} color="#0f172a" />
              <Text style={styles.actionButtonText}>Claim & Celebrate</Text>
            </Pressable>
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
  perkIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 217, 0, 1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkTextGroup: {
    flex: 1,
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
  actionButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
