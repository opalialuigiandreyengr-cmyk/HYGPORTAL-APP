import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CheckCircle, XCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights, spacing, radius } from '../theme';
import { TopBar } from '../components/TopBar';
import { decideApprovalStep, loadPendingApprovals, type PendingApproval } from '../services/approvals';

export function NotificationsScreen() {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading...');
    try {
      const approvals = await loadPendingApprovals();
      setItems(approvals);
      setStatus(approvals.length ? '' : 'No pending approvals.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load approvals.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function decide(item: PendingApproval, decision: 'approved' | 'rejected') {
    setStatus(`Processing...`);
    try {
      await decideApprovalStep(
        item.step_id,
        decision,
        decision === 'rejected' ? 'Rejected from mobile.' : 'Approved from mobile.',
      );
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update.');
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Approvals</Text>
        <Text style={styles.subtitle}>Approve or reject requests assigned to you.</Text>

        <Pressable disabled={isLoading} style={styles.refreshBtn} onPress={refresh}>
          <Text style={styles.refreshText}>{isLoading ? 'Loading...' : 'Refresh'}</Text>
        </Pressable>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {items.map((item) => (
          <View key={item.step_id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.request_type_name}</Text>
            <Text style={styles.cardMuted}>
              {item.requester_name} {item.requester_employee_no ? `(${item.requester_employee_no})` : ''}
            </Text>
            {item.request_type_code === 'leave' ? (
              <Text style={styles.cardMuted}>
                {item.start_date} → {item.end_date} | {item.total_days ?? 0}d
              </Text>
            ) : (
              <Text style={styles.cardMuted}>
                {item.date_from} {item.time_from}–{item.time_to} | {item.total_hours ?? 0}h
              </Text>
            )}
            <View style={styles.actions}>
              <Pressable style={styles.approveBtn} onPress={() => decide(item, 'approved')}>
                <CheckCircle size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.approveBtnText}>Approve</Text>
              </Pressable>
              <Pressable style={styles.rejectBtn} onPress={() => decide(item, 'rejected')}>
                <XCircle size={16} color={colors.semantic.danger} strokeWidth={2.5} />
                <Text style={styles.rejectBtnText}>Reject</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: 90,
  },
  title: {
    fontSize: 22,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.md,
  },
  refreshBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  refreshText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  status: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  cardMuted: {
    fontSize: 13,
    color: colors.muted,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.sm,
  },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.semantic.success,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  approveBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: fontWeights.bold,
  },
  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.semantic.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rejectBtnText: {
    color: colors.semantic.danger,
    fontSize: 12,
    fontWeight: fontWeights.bold,
  },
});
