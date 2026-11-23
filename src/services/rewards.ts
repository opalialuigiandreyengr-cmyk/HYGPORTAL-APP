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

export type RewardCatalogItem = {
  id: string;
  productName: string;
  category: string;
  stocks: number;
  pointsValue: number;
  status: string;
  imageUrl: string | null;
  createdAt: string | null;
};

export type RedeemedRewardItem = {
  id: string;
  rewardId: string | null;
  rewardName: string;
  category: string;
  imageUrl: string | null;
  pointsCost: number;
  status: string;
  redeemedAt: string;
};

const REWARDS_WALLET_TTL_MS = 5 * 60 * 1000;
const REWARDS_CATALOG_TTL_MS = 10 * 60 * 1000;
const REDEEMED_REWARDS_TTL_MS = 10 * 60 * 1000;
const INVENTORY_CATEGORIES_TTL_MS = 30 * 60 * 1000;
const INVENTORY_API_URL = 'https://luigiandreyopalia.pythonanywhere.com/inventory/store_inventory_data';

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

export async function loadRewardsWallet(
  userId?: string,
  employeeId?: string,
  options?: { forceRefresh?: boolean },
): Promise<RewardsWallet> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return emptyRewardsWallet();
  }

  const userCacheKey = `rewards_wallet_v2_${currentUserId}`;

  if (!options?.forceRefresh) {
    const cached = await getCacheJSON<RewardsWallet>(userCacheKey, REWARDS_WALLET_TTL_MS);
    if (cached) {
      return cached;
    }
  }

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

  let redemptionsQuery = supabase
    .from('reward_redemptions')
    .select('points_cost, status');

  if (empId) {
    accountQuery = accountQuery.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${empId}`);
    transactionsQuery = transactionsQuery.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${empId}`);
    redemptionsQuery = redemptionsQuery.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${empId}`);
  } else {
    accountQuery = accountQuery.eq('auth_user_id', currentUserId);
    transactionsQuery = transactionsQuery.eq('auth_user_id', currentUserId);
    redemptionsQuery = redemptionsQuery.eq('auth_user_id', currentUserId);
  }

  const [
    { data: accountRows, error: accountError },
    { data: transactionRows, error: transactionsError },
    { data: redemptionRows },
  ] = await Promise.all([
    accountQuery.order('updated_at', { ascending: false }).limit(1),
    transactionsQuery.order('created_at', { ascending: false }),
    redemptionsQuery,
  ]);

  if (accountError && transactionsError) {
    const cached = await getCacheJSON<RewardsWallet>(userCacheKey);
    return cached ?? emptyRewardsWallet();
  }

  const rows = transactionRows ?? [];
  const rawClaimed = rows.reduce((sum, row) => {
    if (row.source === 'Badge Revoked' || row.source === 'Reward Redemption') return sum;
    return row.status === 'claimed' ? sum + Number(row.points ?? 0) : sum;
  }, 0);
  const revokedPoints = rows.reduce((sum, row) => {
    return row.source === 'Badge Revoked' ? sum + Math.abs(Number(row.points ?? 0)) : sum;
  }, 0);
  const totalEarned = Math.max(0, rawClaimed - revokedPoints);

  const accountBalance = accountRows && accountRows.length > 0 && accountRows[0].balance !== null
    ? Number(accountRows[0].balance ?? 0)
    : null;

  const balance = accountBalance !== null ? accountBalance : totalEarned;
  const totalRedeemed = (redemptionRows ?? []).reduce((sum: number, row: any) => {
    const s = String(row?.status || '').toLowerCase();
    if (s === 'rejected' || s === 'cancelled') return sum;
    return sum + Number(row?.points_cost ?? 0);
  }, 0);
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
  if (row.source === 'Badge Revoked' || row.source === 'Reward Redemption') {
    return {
      id: row.id,
      type: 'deducted',
      source: formatRewardSource(row.source, row.note, 'deducted'),
      points: Math.abs(Number(row.points ?? 0)),
      date: row.received_at ?? row.release_at ?? row.created_at ?? new Date().toISOString(),
    };
  }
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

async function loadInventoryCategoryMap(
  forceRefresh = false,
): Promise<Record<string, string>> {
  const cacheKey = 'inventory_product_categories_v1';
  if (!forceRefresh) {
    const cached = await getCacheJSON<Record<string, string>>(cacheKey, INVENTORY_CATEGORIES_TTL_MS);
    if (cached && Object.keys(cached).length > 0) {
      return cached;
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(INVENTORY_API_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const list = Array.isArray(json?.inventories) ? json.inventories : [];
    const map: Record<string, string> = {};
    for (const item of list) {
      const name = String(item?.item_name || '').trim().toLowerCase();
      const cat = String(item?.category || '').trim();
      if (name && cat) {
        map[name] = cat;
      }
    }
    if (Object.keys(map).length > 0) {
      await setCacheJSON(cacheKey, map);
    }
    return map;
  } catch {
    const stale = await getCacheJSON<Record<string, string>>(cacheKey);
    return stale ?? {};
  }
}

export async function loadRewardsCatalog(
  options?: { forceRefresh?: boolean },
): Promise<RewardCatalogItem[]> {
  const cacheKey = 'rewards_catalog_v2';
  if (!options?.forceRefresh) {
    const cached = await getCacheJSON<RewardCatalogItem[]>(cacheKey, REWARDS_CATALOG_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  try {
    const [{ data, error }, categoryMap] = await Promise.all([
      supabase
        .from('rewards')
        .select('id, product_name, stocks, points_value, status, image_url, created_at')
        .order('created_at', { ascending: false }),
      loadInventoryCategoryMap(Boolean(options?.forceRefresh)),
    ]);

    let rows: any[] = [];
    if (!error && Array.isArray(data)) {
      rows = data;
    } else {
      const rpcRes = await supabase.rpc('admin_get_rewards');
      if (rpcRes.error) {
        throw new Error(rpcRes.error.message || error?.message || 'Unable to load rewards.');
      }
      rows = Array.isArray(rpcRes.data) ? rpcRes.data : [];
    }

    const activeRewards: RewardCatalogItem[] = rows
      .filter((row) => String(row?.status || 'Active').trim().toLowerCase() === 'active')
      .map((row) => {
        const productName = String(row.product_name || 'Reward').trim();
        const mappedCat =
          String(row?.category || '').trim() ||
          categoryMap[productName.toLowerCase()] ||
          'General';
        return {
          id: String(row.id),
          productName,
          category: mappedCat,
          stocks: Number(row.stocks ?? 0),
          pointsValue: Number(row.points_value ?? 0),
          status: String(row.status || 'Active').trim(),
          imageUrl: row.image_url ?? null,
          createdAt: row.created_at ?? null,
        };
      });

    await setCacheJSON(cacheKey, activeRewards);
    return activeRewards;
  } catch (error) {
    const stale = await getCacheJSON<RewardCatalogItem[]>(cacheKey);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

export async function loadRedeemedRewards(
  userId?: string,
  employeeId?: string,
  options?: { forceRefresh?: boolean },
): Promise<RedeemedRewardItem[]> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return [];
  }

  const cacheKey = `redeemed_rewards_v2_${currentUserId}`;
  if (!options?.forceRefresh) {
    const cached = await getCacheJSON<RedeemedRewardItem[]>(cacheKey, REDEEMED_REWARDS_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  try {
    let query = supabase
      .from('reward_redemptions')
      .select('id, reward_id, reward_name, image_url, points_cost, status, redeemed_at');

    if (employeeId) {
      query = query.or(`auth_user_id.eq.${currentUserId},employee_id.eq.${employeeId}`);
    } else {
      query = query.eq('auth_user_id', currentUserId);
    }

    const [{ data, error }, categoryMap] = await Promise.all([
      query.order('redeemed_at', { ascending: false }),
      loadInventoryCategoryMap(false),
    ]);
    if (error) {
      throw new Error(error.message || 'Unable to load redeemed rewards.');
    }

    const items: RedeemedRewardItem[] = (data ?? []).map((row: any) => {
      const rewardName = String(row.reward_name || 'Reward');
      return {
        id: String(row.id),
        rewardId: row.reward_id ?? null,
        rewardName,
        category: categoryMap[rewardName.trim().toLowerCase()] || 'General',
        imageUrl: row.image_url ?? null,
        pointsCost: Number(row.points_cost ?? 0),
        status: String(row.status || 'pending'),
        redeemedAt: String(row.redeemed_at || new Date().toISOString()),
      };
    });

    await setCacheJSON(cacheKey, items);
    return items;
  } catch (error) {
    const stale = await getCacheJSON<RedeemedRewardItem[]>(cacheKey);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

export async function redeemRewardItem(
  reward: RewardCatalogItem,
  userId?: string,
): Promise<{ item: RedeemedRewardItem; newBalance: number | null }> {
  const { data, error } = await supabase.rpc('redeem_reward', {
    p_reward_id: reward.id,
  });

  if (error) {
    throw new Error(error.message || 'Failed to redeem reward.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  const redeemedItem: RedeemedRewardItem = {
    id: String(row?.redemption_id || `red_${Date.now()}`),
    rewardId: row?.reward_id ?? reward.id,
    rewardName: String(row?.reward_name || reward.productName),
    category: reward.category || 'General',
    imageUrl: row?.image_url ?? reward.imageUrl ?? null,
    pointsCost: Number(row?.points_cost ?? reward.pointsValue),
    status: String(row?.status || 'pending'),
    redeemedAt: String(row?.redeemed_at || new Date().toISOString()),
  };
  const newBalance =
    row?.new_balance !== undefined && row?.new_balance !== null
      ? Number(row.new_balance)
      : null;

  // Update local caches immediately
  try {
    const catalogCached = await getCacheJSON<RewardCatalogItem[]>('rewards_catalog_v2');
    if (catalogCached) {
      await setCacheJSON(
        'rewards_catalog_v2',
        catalogCached.map((c) =>
          c.id === reward.id ? { ...c, stocks: Math.max(0, c.stocks - 1) } : c,
        ),
      );
    }

    const { data: sessionResult } = await supabase.auth.getSession();
    const currentUserId = userId || sessionResult.session?.user?.id;
    if (currentUserId) {
      const redCacheKey = `redeemed_rewards_v2_${currentUserId}`;
      const existingRed = (await getCacheJSON<RedeemedRewardItem[]>(redCacheKey)) ?? [];
      await setCacheJSON(redCacheKey, [redeemedItem, ...existingRed]);

      const walletCacheKey = `rewards_wallet_v2_${currentUserId}`;
      const existingWallet = await getCacheJSON<RewardsWallet>(walletCacheKey);
      if (existingWallet) {
        await setCacheJSON(walletCacheKey, {
          ...existingWallet,
          balance: typeof newBalance === 'number' ? newBalance : Math.max(0, existingWallet.balance - reward.pointsValue),
          totalRedeemed: existingWallet.totalRedeemed + reward.pointsValue,
        });
      }
    }
  } catch {
    // ignore cache update error
  }

  return { item: redeemedItem, newBalance };
}
