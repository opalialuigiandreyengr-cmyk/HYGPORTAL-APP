import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, Clock3 } from 'lucide-react-native';

import { fetchOffsetHistory, type BalanceHistoryItem } from '../services/balanceHistory';

type OffsetExpiryAlertModalProps = {
  userId?: string | null;
  employeeId?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return 'soon';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function getTone(remainingDays: number) {
  if (remainingDays <= 7) {
    return { color: '#dc2626', tint: '#fef2f2', label: 'Expiring very soon' };
  }
  return { color: '#d97706', tint: '#fffbeb', label: 'Expiring soon' };
}

export function OffsetExpiryAlertModal({ userId, employeeId }: OffsetExpiryAlertModalProps) {
  const [credit, setCredit] = useState<BalanceHistoryItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setCredit(null);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const history = await fetchOffsetHistory(userId, employeeId ?? undefined);
        const expiringCredit = history
          .filter((item) => (
            item.amount > 0 &&
            (item.remainingAmount ?? item.amount) > 0 &&
            item.expiresAt &&
            typeof item.remainingDays === 'number' &&
            item.remainingDays <= 30
          ))
          .sort((left, right) => (left.remainingDays ?? 999) - (right.remainingDays ?? 999))[0] ?? null;

        if (!cancelled) setCredit(expiringCredit);
      } catch {
        if (!cancelled) setCredit(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, employeeId]);

  if (!credit || !credit.expiresAt || credit.remainingDays === undefined || credit.remainingDays === null) {
    return null;
  }

  const tone = getTone(credit.remainingDays);
  const remainingHours = credit.remainingAmount ?? credit.amount;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setCredit(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={[styles.icon, { backgroundColor: tone.tint }]}>
              <CalendarDays size={20} color={tone.color} strokeWidth={2.2} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>Offset balance reminder</Text>
              <Text style={styles.title}>{tone.label}</Text>
            </View>
          </View>
          <Text style={styles.message}>
            Your {remainingHours.toFixed(1)}h offset credit expires on {formatDate(credit.expiresAt)}.
          </Text>

          <View style={[styles.expiryRow, { backgroundColor: tone.tint }]}>
            <Clock3 size={16} color={tone.color} strokeWidth={2.2} />
            <Text style={[styles.expiryText, { color: tone.color }]}>
              {credit.remainingDays <= 0 ? 'Expired' : `${credit.remainingDays} days remaining`}
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <Pressable style={[styles.primaryButton, { backgroundColor: tone.color }]} onPress={() => setCredit(null)}>
              <Text style={styles.primaryButtonText}>Got it</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setCredit(null)}>
              <Text style={styles.secondaryButtonText}>Remind me later</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    padding: 22,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 15,
    color: '#64748b',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    marginTop: 2,
    fontSize: 20,
    lineHeight: 25,
    color: '#0f172a',
    fontWeight: '800',
  },
  message: {
    marginTop: 9,
    fontSize: 14,
    lineHeight: 21,
    color: '#475569',
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    padding: 12,
    borderRadius: 10,
  },
  expiryText: {
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginTop: 18,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 18,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  secondaryButtonText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
