import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights, spacing, radius } from '../theme';
import { TopBar } from '../components/TopBar';
import { loadMyRequests, type MyRequest } from '../services/requests';

export function RequestsTabScreen() {
  const [items, setItems] = useState<MyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');

  async function refresh() {
    setIsLoading(true);
    setStatus('Loading...');
    try {
      const requests = await loadMyRequests();
      setItems(requests);
      setStatus(requests.length ? '' : 'No requests yet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load requests.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>My Requests</Text>
        <Text style={styles.subtitle}>Track status and approval progress.</Text>

        <Pressable disabled={isLoading} style={styles.refreshBtn} onPress={refresh}>
          <Text style={styles.refreshText}>{isLoading ? 'Loading...' : 'Refresh'}</Text>
        </Pressable>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {items.map((item) => (
          <View key={item.request_id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.request_type_name}</Text>
              <Text style={[styles.pill, pillStyle(item.status)]}>{item.status}</Text>
            </View>
            <Text style={styles.cardMuted}>
              {item.request_type_code === 'leave'
                ? `${item.start_date} → ${item.end_date} | ${item.total_days ?? 0}d`
                : `${item.date_from} ${item.time_from}–${item.time_to} | ${item.total_hours ?? 0}h`}
            </Text>
            <Text style={styles.cardMuted}>{item.reason || 'No reason provided.'}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function pillStyle(status: string) {
  if (status === 'approved') return { backgroundColor: '#dcfce7', color: '#15803d' };
  if (status === 'rejected') return { backgroundColor: '#fee2e2', color: '#b91c1c' };
  return { backgroundColor: '#dbeafe', color: '#1d4ed8' };
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  pill: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
    textTransform: 'capitalize',
  },
  cardMuted: {
    fontSize: 13,
    color: colors.muted,
  },
});
