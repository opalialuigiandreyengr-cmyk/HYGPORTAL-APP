import { supabase } from '../lib/supabase';

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function getMyRequestsCacheKey(userId?: string): Promise<string> {
  const uid = userId || (await getCurrentUserId());
  return uid ? `my_requests_v2_${uid}` : 'my_requests_v1';
}

export async function getPerkUsageCacheKey(userId?: string): Promise<string> {
  const uid = userId || (await getCurrentUserId());
  return uid ? `my_perk_usage_v2_${uid}` : 'my_perk_usage_v1';
}
