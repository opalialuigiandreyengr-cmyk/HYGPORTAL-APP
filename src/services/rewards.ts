import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';
import { ensureMyHygPointGifts } from './notificationCenter';

export type RewardsWalletHistoryItem = {
  id: string;
  type: 'earned' | 'pending' | 'cancelled' | 'deducted';
  source: string;
  points: number;
  date: string;
};

export type RewardsWallet = {
  balance: number;
  totalEarned: number;
  totalRedeemed: number;
  history: RewardsWalletHistoryItem[];
};

const CACHE_KEY = 'rewards_wallet_v1';

type HygPointAccountRow = {
  balance: number | string | null;
};

type HygPointTransactionRow = {
  id: string;
  source: string;
  points: number | string | null;
  status: 'released' | 'claimed' | 'cancelled' | string;
  release_at: string | null;
  received_at: string | null;
  note: string | null;
  created_at: string | null;
};

export async function loadRewardsWallet() {
  const { data: sessionResult } = await supabase.auth.getSession();
  if (!sessionResult.session?.user) {
    return emptyRewardsWallet();
  }

  await ensureMyHygPointGifts();

  const [{ data: account, error: accountError }, { data: transactions, error: transactionsError }] = await Promise.all([
    supabase
      .from('user_hyg_point_accounts')
      .select('balance')
      .maybeSingle<HygPointAccountRow>(),
    supabase
      .from('user_hyg_point_transactions')
      .select('id, source, points, status, release_at, received_at, note, created_at')
      .order('created_at', { ascending: false })
      .returns<HygPointTransactionRow[]>(),
  ]);

  if (accountError || transactionsError) {
    const cached = await getCacheJSON<RewardsWallet>(CACHE_KEY);
    return cached ?? emptyRewardsWallet();
  }

  const balance = Number(account?.balance ?? 0);
  const rows = transactions ?? [];
  const totalEarned = rows.reduce((sum, row) => {
    return row.status === 'claimed' ? sum + Number(row.points ?? 0) : sum;
  }, 0);
  const totalRedeemed = Math.max(0, totalEarned - balance);
  const history = rows.map(mapTransactionToHistoryItem);
  const wallet = {
    balance,
    totalEarned,
    totalRedeemed,
    history,
  } satisfies RewardsWallet;

  await setCacheJSON(CACHE_KEY, wallet);
  return wallet;
}

function emptyRewardsWallet(): RewardsWallet {
  return {
    balance: 0,
    totalEarned: 0,
    totalRedeemed: 0,
    history: [],
  };
}

function mapTransactionToHistoryItem(row: HygPointTransactionRow): RewardsWalletHistoryItem {
  const status = row.status === 'claimed' || row.status === 'cancelled' ? row.status : 'released';
  const type = status === 'claimed' ? 'earned' : status === 'cancelled' ? 'cancelled' : 'pending';
  return {
    id: row.id,
    type,
    source: formatRewardSource(row.source, row.note, type),
    points: Number(row.points ?? 0),
    date: row.received_at ?? row.release_at ?? row.created_at ?? new Date().toISOString(),
  };
}

function formatRewardSource(source: string, note: string | null, type: RewardsWalletHistoryItem['type']) {
  if (source === 'launch_phase_1_profile_creation') {
    return type === 'pending' ? 'Phase 1 launch gift - waiting for claim' : 'Phase 1 launch gift';
  }
  if (source === 'profile_completion_100_percent') {
    return type === 'pending' ? 'Profile completion gift - waiting for claim' : 'Profile completion gift';
  }
  return note?.trim() || source.replace(/_/g, ' ');
}
