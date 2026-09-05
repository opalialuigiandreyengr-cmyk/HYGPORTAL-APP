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

export async function loadRewardsWallet(userId?: string, employeeId?: string): Promise<RewardsWallet> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return emptyRewardsWallet();
  }

  const userCacheKey = `rewards_wallet_v2_${currentUserId}`;

  try {
    await ensureMyHygPointGifts();
  } catch {
    // Non-blocking gift check
  }

  let empId = employeeId;
  if (!empId) {
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('employee_id')
      .eq('auth_user_id', currentUserId)
      .maybeSingle<{ employee_id: string | null }>();
    empId = userProfile?.employee_id ?? undefined;
  }

  let accountQuery = supabase
    .from('user_hyg_point_accounts')
    .select('balance');

  let transactionsQuery = supabase
    .from('user_hyg_point_transactions')
    .select('id, source, points, status, release_at, received_at, note, created_at');

  if (empId) {
    accountQuery = accountQuery.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${empId}`);
    transactionsQuery = transactionsQuery.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${empId}`);
  } else {
    accountQuery = accountQuery.eq('auth_user_id', currentUserId);
    transactionsQuery = transactionsQuery.eq('auth_user_id', currentUserId);
  }

  const [{ data: accountRows, error: accountError }, { data: transactionRows, error: transactionsError }] = await Promise.all([
    accountQuery.order('updated_at', { ascending: false }).limit(1),
    transactionsQuery.order('created_at', { ascending: false }),
  ]);

  if (accountError && transactionsError) {
    const cached = await getCacheJSON<RewardsWallet>(userCacheKey);
    return cached ?? emptyRewardsWallet();
  }

  const rows = transactionRows ?? [];
  const totalEarned = rows.reduce((sum, row) => {
    return row.status === 'claimed' ? sum + Number(row.points ?? 0) : sum;
  }, 0);

  const accountBalance = accountRows && accountRows.length > 0 && accountRows[0].balance !== null
    ? Number(accountRows[0].balance ?? 0)
    : null;

  const balance = accountBalance !== null ? accountBalance : totalEarned;
  const totalRedeemed = Math.max(0, totalEarned - balance);
  const history = rows.map(mapTransactionToHistoryItem);
  const wallet = {
    balance,
    totalEarned,
    totalRedeemed,
    history,
  } satisfies RewardsWallet;

  await setCacheJSON(userCacheKey, wallet);
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
