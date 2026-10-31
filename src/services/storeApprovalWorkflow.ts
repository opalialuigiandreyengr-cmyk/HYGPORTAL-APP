import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { isAppOnline } from './network';
import { lookupPositionAuthorityLevel, resolveApproverLevel } from './positions';

export type PortalStore = {
  id: string;
  name: string;
  company_id?: string | null;
  company_name?: string | null;
  cluster_id?: string | null;
  cluster_name?: string | null;
  area_id?: string | null;
  area_name?: string | null;
  is_active?: boolean;
};

export type WorkflowStep = {
  step_order: number;
  required_level: number;
  role_name: string;
  approver_employee_id: string | null;
  approver_name: string;
  approver_position_name?: string | null;
  approver_employee_no?: string | null;
  status: string;
  store_id?: string | null;
  store_name?: string | null;
  is_reassigned?: boolean;
  approver_level?: number | null;
  position_level?: number | null;
};

export type ApproverCandidate = {
  employee_id: string;
  full_name: string;
  employee_no?: string | null;
  position_name?: string | null;
  department_name?: string | null;
  store_name?: string | null;
  company_name?: string | null;
  authority_level?: number;
  photo_url?: string | null;
};

// ============================================================================
// SWR (Stale-While-Revalidate) & Request Deduplication Engine
// ============================================================================

type SWRCacheEntry<T> = {
  data: T;
  timestamp: number;
};

// L1 in-memory cache for 0ms instantaneous reads
const swrMemoryCache = new Map<string, SWRCacheEntry<any>>();

// In-flight promise tracker to deduplicate identical concurrent database queries
const inFlightRequests = new Map<string, Promise<any>>();

function withTimeout<T = any>(promise: PromiseLike<any>, timeoutMs = 2500): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), timeoutMs),
    ),
  ]);
}

/**
 * Deduplicates in-flight promises so multiple simultaneous calls to the same
 * key execute only ONE single network/database request.
 */
function dedupeRequest<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      inFlightRequests.delete(key);
    }
  })();
  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * Generic Stale-While-Revalidate (SWR) fetcher:
 * 1. Returns fresh data immediately from memory/local storage (0ms, 0 database queries).
 * 2. If data is stale, returns stale data immediately and revalidates in the background (non-blocking).
 * 3. Cold start (no cache): executes deduplicated fetch with timeout guard.
 */
async function fetchWithSWR<T>(
  key: string,
  fetcher: () => Promise<T | null>,
  freshDurationMs: number,
  validator?: (data: T) => boolean,
): Promise<{ data: T | null; isStale: boolean }> {
  const now = Date.now();

  // 1. Check L1 Memory Cache
  let entry = swrMemoryCache.get(key) as SWRCacheEntry<T> | undefined;

  // 2. Check L2 Storage Cache if not in memory
  if (!entry) {
    try {
      const stored = await getCacheJSON<SWRCacheEntry<T>>(key);
      if (stored && stored.data != null) {
        entry = stored;
        swrMemoryCache.set(key, entry);
      }
    } catch {
      // non-fatal
    }
  }

  const hasData = entry != null && entry.data != null;
  const isValid = Boolean(entry && hasData && (!validator || validator(entry.data)));
  const isFresh = Boolean(entry && hasData && now - entry.timestamp < freshDurationMs);

  // Case A: Cache is fresh and valid -> Return immediately (ZERO network queries)
  if (entry && isValid && isFresh) {
    return { data: entry.data, isStale: false };
  }

  // Case B: Cache exists but is stale -> Return STALE immediately, revalidate in background
  if (entry && isValid && !isFresh) {
    if (isAppOnline()) {
      dedupeRequest(`bg_${key}`, async () => {
        try {
          const freshData = await fetcher();
          if (freshData && (!validator || validator(freshData))) {
            const updatedEntry: SWRCacheEntry<T> = { data: freshData, timestamp: Date.now() };
            swrMemoryCache.set(key, updatedEntry);
            await setCacheJSON(key, updatedEntry);
          }
        } catch {
          // Silently ignore background revalidation errors
        }
      }).catch(() => {});
    }
    return { data: entry.data, isStale: true };
  }

  // Case C: Cold start (no valid cache) -> must fetch once (deduplicated)
  if (isAppOnline()) {
    try {
      const freshData = await dedupeRequest(`cold_${key}`, fetcher);
      if (freshData && (!validator || validator(freshData))) {
        const updatedEntry: SWRCacheEntry<T> = { data: freshData, timestamp: Date.now() };
        swrMemoryCache.set(key, updatedEntry);
        await setCacheJSON(key, updatedEntry);
        return { data: freshData, isStale: false };
      }
    } catch {
      // ignore
    }
  }

  return { data: entry?.data ?? null, isStale: true };
}

// Cache keys
const SWR_KEY_STORES = 'swr_portal_active_stores_v2';
const SWR_KEY_CANDIDATES = 'swr_portal_candidates_master_v3';
const SWR_PREFIX_WORKFLOW = 'swr_portal_store_workflow_v2_';

// Pre-hydrate in-memory candidates cache from local storage on startup for 0ms offline lookups
getCacheJSON<SWRCacheEntry<ApproverCandidate[]>>(SWR_KEY_CANDIDATES)
  .then((stored) => {
    if (stored?.data && Array.isArray(stored.data)) {
      swrMemoryCache.set(SWR_KEY_CANDIDATES, stored);
    }
  })
  .catch(() => {});

// ============================================================================
// Helper: Format Approver Display Name & Real Approver Detection
// ============================================================================

/**
 * Checks if a name is a genuine employee name and not a generic role placeholder
 * like "Store Manager", "Goldilocks Carigara Store Manager", "Area Operations Manager", "Approver".
 */
export function isRealApproverName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  if (
    !n ||
    n === 'approver' ||
    /^approver(\s+\d+)?$/i.test(n) ||
    /^level\s+\d+(\s+approver)?$/i.test(n) ||
    n.includes('local device queue') ||
    n === 'sys-local'
  ) return false;
  const genericTerms = [
    'store manager',
    'branch manager',
    'area operations manager',
    'area manager',
    'operations manager',
    'cluster manager',
    'cluster head',
    'immediate supervisor',
    'store supervisor',
    'supervisor',
    'general manager',
    'system admin',
    'hyg portal system',
    'pending',
  ];
  return !genericTerms.some((t) => n.includes(t));
}

/**
 * Formats a person's name with middle initial for clean display (e.g. "JUAN M. DELA CRUZ").
 * Protects role titles, placeholders, and system labels from being distorted into middle initials.
 */
export function formatApproverDisplayName(
  rawName?: string | null,
  position?: string | null,
  level?: number,
): string {
  if (!rawName || !isRealApproverName(rawName)) {
    return (position || (level ? `Level ${level} Approver` : 'Approver')).toUpperCase();
  }
  const clean = rawName.trim();
  const lower = clean.toLowerCase();

  // If this is a position title, generic placeholder, or system name, do not split into middle initials!
  const titleKeywords = [
    'store manager',
    'branch manager',
    'area operations manager',
    'area manager',
    'operations manager',
    'cluster manager',
    'cluster head',
    'supervisor',
    'immediate supervisor',
    'store head',
    'general manager',
    'officer in charge',
    'system',
    'admin',
    'approver',
    'pending',
  ];
  if (
    titleKeywords.some((w) => lower.includes(w)) ||
    lower.endsWith('manager') ||
    lower.endsWith('supervisor')
  ) {
    return clean.toUpperCase();
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return clean.toUpperCase();
  const [first, middle, ...rest] = parts;
  const maybeInitial = middle.replace('.', '');
  const middleText = maybeInitial.length === 1 ? `${maybeInitial}.` : `${maybeInitial[0]}.`;
  return [first, middleText, ...rest].join(' ').toUpperCase();
}

/**
 * Synchronously looks up a cached approver candidate's full name by employee ID.
 * Works completely offline using the in-memory or persisted SWR candidates cache.
 */
export function lookupCachedApproverName(employeeId?: string | null): string | null {
  if (!employeeId) return null;
  const mem = swrMemoryCache.get(SWR_KEY_CANDIDATES)?.data;
  if (Array.isArray(mem)) {
    const cand = mem.find((c: ApproverCandidate) => c.employee_id === employeeId);
    if (cand && cand.full_name) {
      return formatApproverDisplayName(cand.full_name, cand.position_name, cand.authority_level);
    }
  }
  return null;
}

/**
 * Synchronously looks up a real approver candidate's name by authority level and optional department.
 * Ensures the Approval Timeline displays real employee names instead of generic 'Approver #' or 'Level # Approver'.
 */
export function lookupCachedApproverByLevel(
  level?: number | null,
  departmentName?: string | null,
): string | null {
  if (!level) return null;
  const mem = swrMemoryCache.get(SWR_KEY_CANDIDATES)?.data;
  if (Array.isArray(mem) && mem.length > 0) {
    if (departmentName && departmentName.trim()) {
      const depLower = departmentName.trim().toLowerCase();
      const depMatch = mem.find(
        (c: ApproverCandidate) =>
          c.authority_level === level &&
          c.department_name?.trim().toLowerCase() === depLower &&
          isRealApproverName(c.full_name),
      );
      if (depMatch && depMatch.full_name) {
        return formatApproverDisplayName(depMatch.full_name, depMatch.position_name, level);
      }
    }
    const levelMatch = mem.find(
      (c: ApproverCandidate) => c.authority_level === level && isRealApproverName(c.full_name),
    );
    if (levelMatch && levelMatch.full_name) {
      return formatApproverDisplayName(levelMatch.full_name, levelMatch.position_name, level);
    }
  }
  return null;
}

// ============================================================================
// 1. SWR: Load Portal Stores
// ============================================================================

/**
 * Loads all active portal stores with company, cluster, and area metadata.
 * Uses SWR caching (30-minute fresh TTL, background revalidation).
 */
export async function loadPortalStores(): Promise<PortalStore[]> {
  const { data } = await fetchWithSWR<PortalStore[]>(
    SWR_KEY_STORES,
    async () => {
      // Primary: get_portal_stores RPC
      try {
        const res: any = await withTimeout(supabase.rpc('get_portal_stores'), 2500);
        if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
          return res.data as PortalStore[];
        }
      } catch {
        // ignore
      }

      // Secondary fallback: Direct stores table
      try {
        const res: any = await withTimeout(
          supabase
            .from('stores')
            .select('id, name, company_id, cluster_id, area_id, is_active, companies(name), clusters(name), areas(name)')
            .eq('is_active', true)
            .order('name'),
          2500,
        );

        if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
          return res.data.map((s: any) => ({
            id: s.id,
            name: s.name,
            company_id: s.company_id,
            company_name: s.companies?.name || null,
            cluster_id: s.cluster_id,
            cluster_name: s.clusters?.name || null,
            area_id: s.area_id,
            area_name: s.areas?.name || null,
            is_active: s.is_active,
          }));
        }
      } catch {
        // ignore
      }

      return null;
    },
    30 * 60 * 1000, // 30 mins fresh
    (stores) => Array.isArray(stores) && stores.length > 0,
  );

  return data || [];
}

// ============================================================================
// Helper: Store Name Matching & Offline Candidate Resolution
// ============================================================================

/**
 * Matches candidate store name against selected duty store name,
 * ignoring common store/brand noise tokens like "Goldilocks", "Store", "Branch", "HYG".
 * Supports multi-store comma-separated lists from employee_store_assignments.
 */
export function isStoreNameMatch(candidateStore?: string | null, targetStore?: string | null): boolean {
  if (!candidateStore || !targetStore) return false;
  const c = candidateStore.trim().toLowerCase();
  const t = targetStore.trim().toLowerCase();
  if (c === t) return true;
  if (c.includes(t) || t.includes(c)) return true;

  // Handle multi-store comma-separated strings (e.g. "Goldilocks Carigara, Goldilocks Tacloban")
  if (candidateStore.includes(',')) {
    const stores = candidateStore.split(',').map((s) => s.trim());
    if (stores.some((s) => isStoreNameMatch(s, targetStore))) {
      return true;
    }
  }

  const stripNoise = (str: string) =>
    str
      .replace(/\b(goldilocks|hyg|store|branch|bldg|building|mall)\b/gi, '')
      .replace(/[^a-z0-9]/gi, '')
      .trim()
      .toLowerCase();

  const cClean = stripNoise(c);
  const tClean = stripNoise(t);

  if (cClean.length >= 3 && tClean.length >= 3) {
    if (cClean === tClean || cClean.includes(tClean) || tClean.includes(cClean)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves store approval steps from cached approver candidates (offline/instant fallback).
 * Follows the Operations approval ladder (L2 -> L4 -> L5 -> L7 -> L8).
 * If a level in the approval ladder has no approver tagged for the selected store,
 * it automatically proceeds to the next available approver in the ladder so that
 * exactly 2 approvers are assigned with accurate authority levels and real names.
 */
export async function resolveStoreWorkflowFromCandidates(
  storeId?: string | null,
  fallbackStoreName?: string | null,
  employeeId?: string | null,
  isOperations = true,
): Promise<WorkflowStep[]> {
  let storeLabel = (fallbackStoreName || '').trim();
  let employeeDept: string | null = null;
  let employeeLevel = 1;
  let candidates: ApproverCandidate[] = [];

  try {
    const mem = swrMemoryCache.get(SWR_KEY_CANDIDATES)?.data;
    if (Array.isArray(mem) && mem.length > 0) {
      candidates = mem;
    } else {
      const stored = await getCacheJSON<SWRCacheEntry<ApproverCandidate[]>>(SWR_KEY_CANDIDATES);
      if (stored && Array.isArray(stored.data) && stored.data.length > 0) {
        candidates = stored.data;
      } else {
        const legacy = await getCacheJSON<SWRCacheEntry<ApproverCandidate[]>>('swr_portal_candidates_master_v2');
        if (legacy && Array.isArray(legacy.data) && legacy.data.length > 0) {
          candidates = legacy.data;
        }
      }
    }
  } catch {
    // non-fatal
  }

  // If candidate cache was empty, load candidates
  if (candidates.length === 0) {
    try {
      candidates = await loadApproverCandidates();
    } catch {
      // non-fatal
    }
  }

  if (employeeId && candidates.length > 0) {
    const requester = candidates.find((c) => c.employee_id === employeeId);
    if (requester) {
      if (!storeLabel && requester.store_name) {
        storeLabel = requester.store_name;
      }
      employeeDept = requester.department_name || null;
      employeeLevel = requester.authority_level ?? (lookupPositionAuthorityLevel(requester.position_name) ?? 1);
    }
  }

  // Filter out the requester so they never approve their own request
  const validCandidates = candidates.filter((c) => !employeeId || c.employee_id !== employeeId);

  // Retrieve store metadata (cluster name, area name) for accurate ladder scoping
  let clusterName: string | null = null;
  let areaName: string | null = null;
  try {
    const memStores = swrMemoryCache.get(SWR_KEY_STORES)?.data;
    const storeList: PortalStore[] = Array.isArray(memStores)
      ? memStores
      : (await getCacheJSON<SWRCacheEntry<PortalStore[]>>(SWR_KEY_STORES))?.data || [];
    if (Array.isArray(storeList) && storeList.length > 0) {
      const matchedStore = storeList.find(
        (s) => (storeId && s.id === storeId) || isStoreNameMatch(s.name, storeLabel),
      );
      if (matchedStore) {
        clusterName = matchedStore.cluster_name || null;
        areaName = matchedStore.area_name || null;
      }
    }
  } catch {
    // non-fatal
  }

  // Ladder Finder 1: Store-level approver (Level 2 / 3 - Store Supervisor / Store Manager)
  function findStoreCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (storeLabel && validCandidates.length > 0) {
      const storeMatches = validCandidates.filter(
        (c) => !usedIds.has(c.employee_id) && isStoreNameMatch(c.store_name, storeLabel),
      );
      if (storeMatches.length > 0) {
        storeMatches.sort((a, b) => {
          const aLevel = a.authority_level ?? (lookupPositionAuthorityLevel(a.position_name) ?? 2);
          const bLevel = b.authority_level ?? (lookupPositionAuthorityLevel(b.position_name) ?? 2);
          const aIsStore = aLevel === 2 || aLevel === 3 ? 0 : 1;
          const bIsStore = bLevel === 2 || bLevel === 3 ? 0 : 1;
          if (aIsStore !== bIsStore) return aIsStore - bIsStore;
          return aLevel - bLevel;
        });
        return storeMatches[0];
      }

      const cleanStoreKey = storeLabel
        .replace(/\b(goldilocks|hyg|store|branch|bldg|building|mall)\b/gi, '')
        .trim()
        .toLowerCase();
      if (cleanStoreKey.length >= 3) {
        const keywordMatches = validCandidates.filter((c) => {
          if (usedIds.has(c.employee_id)) return false;
          const s = (c.store_name || '').toLowerCase();
          const d = (c.department_name || '').toLowerCase();
          const p = (c.position_name || '').toLowerCase();
          return s.includes(cleanStoreKey) || d.includes(cleanStoreKey) || p.includes(cleanStoreKey);
        });
        if (keywordMatches.length > 0) {
          keywordMatches.sort((a, b) => {
            const aLevel = a.authority_level ?? (lookupPositionAuthorityLevel(a.position_name) ?? 2);
            const bLevel = b.authority_level ?? (lookupPositionAuthorityLevel(b.position_name) ?? 2);
            return aLevel - bLevel;
          });
          return keywordMatches[0];
        }
      }
    }

    // If not found in store or non-store department, find higher-level supervisor in same department
    if (employeeDept && validCandidates.length > 0) {
      const deptMatches = validCandidates.filter(
        (c) =>
          !usedIds.has(c.employee_id) &&
          c.department_name &&
          c.department_name.toLowerCase() === employeeDept!.toLowerCase() &&
          (c.authority_level ?? 2) > employeeLevel &&
          (c.authority_level ?? 2) <= 4,
      );
      if (deptMatches.length > 0) {
        deptMatches.sort((a, b) => (a.authority_level ?? 2) - (b.authority_level ?? 2));
        return deptMatches[0];
      }
    }

    return null;
  }

  // Ladder Finder 2: Cluster-level approver (Level 4 - Cluster Manager / Cluster Head)
  function findClusterCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (validCandidates.length === 0) return null;
    const clusterMatches = validCandidates.filter((c) => {
      if (usedIds.has(c.employee_id)) return false;
      const pos = (c.position_name || '').toLowerCase();
      const store = (c.store_name || '').toLowerCase();
      const isClusterTitle = pos.includes('cluster manager') || pos.includes('cluster head');
      const matchesCluster = clusterName && (store.includes(clusterName.toLowerCase()) || pos.includes(clusterName.toLowerCase()));
      const isLevel4 = (c.authority_level ?? lookupPositionAuthorityLevel(c.position_name)) === 4;
      return isClusterTitle || (isLevel4 && matchesCluster);
    });
    if (clusterMatches.length > 0) {
      clusterMatches.sort((a, b) => {
        const aPos = (a.position_name || '').toLowerCase();
        const bPos = (b.position_name || '').toLowerCase();
        const aIsCluster = aPos.includes('cluster') ? 0 : 1;
        const bIsCluster = bPos.includes('cluster') ? 0 : 1;
        if (aIsCluster !== bIsCluster) return aIsCluster - bIsCluster;
        return (a.authority_level ?? 4) - (b.authority_level ?? 4);
      });
      return clusterMatches[0];
    }
    return null;
  }

  // Ladder Finder 3: Area-level approver (Level 5 / 6 - Area Operations Manager / Senior Ops Manager)
  function findAreaCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (validCandidates.length === 0) return null;
    const areaMatches = validCandidates.filter((c) => {
      if (usedIds.has(c.employee_id)) return false;
      const pos = (c.position_name || '').toLowerCase();
      const dept = (c.department_name || '').toLowerCase();
      const store = (c.store_name || '').toLowerCase();
      const isAom =
        pos.includes('area operations') ||
        pos.includes('area manager') ||
        pos.includes('operations manager') ||
        pos.includes('operations head') ||
        pos.includes('aom') ||
        pos.includes('ops manager');
      const matchesArea = areaName && (store.includes(areaName.toLowerCase()) || pos.includes(areaName.toLowerCase()));
      const isOpsLevel5 = dept.includes('operation') && (c.authority_level ?? 0) >= 5;
      const isLevel5 = (c.authority_level ?? lookupPositionAuthorityLevel(c.position_name)) === 5;
      return isAom || matchesArea || isOpsLevel5 || isLevel5;
    });
    if (areaMatches.length > 0) {
      areaMatches.sort((a, b) => {
        const aPos = (a.position_name || '').toLowerCase();
        const bPos = (b.position_name || '').toLowerCase();
        const aPriority = aPos.includes('area operations') || aPos.includes('aom') ? 0 : aPos.includes('area manager') ? 1 : aPos.includes('operations manager') ? 2 : 3;
        const bPriority = bPos.includes('area operations') || bPos.includes('aom') ? 0 : bPos.includes('area manager') ? 1 : bPos.includes('operations manager') ? 2 : 3;
        if (aPriority !== bPriority) return aPriority - bPriority;
        const aLevel = a.authority_level ?? (lookupPositionAuthorityLevel(a.position_name) ?? 5);
        const bLevel = b.authority_level ?? (lookupPositionAuthorityLevel(b.position_name) ?? 5);
        return aLevel - bLevel;
      });
      return areaMatches[0];
    }
    return null;
  }

  // Ladder Finder 4: Department Head approver (Level 7 - Operations Head / HR Manager)
  function findHeadCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (validCandidates.length === 0) return null;
    const headMatches = validCandidates.filter((c) => {
      if (usedIds.has(c.employee_id)) return false;
      const level = c.authority_level ?? (lookupPositionAuthorityLevel(c.position_name) ?? 0);
      return level === 7;
    });
    if (headMatches.length > 0) {
      headMatches.sort((a, b) => {
        const aDept = (a.department_name || '').toLowerCase();
        const bDept = (b.department_name || '').toLowerCase();
        const aIsOps = aDept.includes('operation') ? 0 : 1;
        const bIsOps = bDept.includes('operation') ? 0 : 1;
        return aIsOps - bIsOps;
      });
      return headMatches[0];
    }
    return null;
  }

  // Ladder Finder 5: Executive approver (Level 8 - General Manager)
  function findGmCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (validCandidates.length === 0) return null;
    const gmMatches = validCandidates.filter((c) => {
      if (usedIds.has(c.employee_id)) return false;
      const level = c.authority_level ?? (lookupPositionAuthorityLevel(c.position_name) ?? 0);
      const pos = (c.position_name || '').toLowerCase();
      return level >= 8 || pos.includes('general manager') || pos.includes('gm');
    });
    if (gmMatches.length > 0) {
      return gmMatches[0];
    }
    return null;
  }

  // Progress through the approval ladder sequentially (L2 -> L4 -> L5 -> L7 -> L8)
  // If a level has no candidate tagged for the store, it automatically advances to the next level
  const chosenSteps: WorkflowStep[] = [];
  const usedEmployeeIds = new Set<string>();
  if (employeeId) usedEmployeeIds.add(employeeId);

  // Ladder Step 1: Check Level 2 / 3 (Store Supervisor / Store Manager)
  const storeCand = findStoreCandidate(usedEmployeeIds);
  if (storeCand) {
    usedEmployeeIds.add(storeCand.employee_id);
    const effLevel = storeCand.authority_level ?? (lookupPositionAuthorityLevel(storeCand.position_name) ?? 2);
    chosenSteps.push({
      step_order: chosenSteps.length + 1,
      required_level: effLevel,
      approver_level: effLevel,
      position_level: effLevel,
      role_name: storeCand.position_name || 'Store Supervisor',
      approver_employee_id: storeCand.employee_id,
      approver_name: formatApproverDisplayName(storeCand.full_name, storeCand.position_name, effLevel),
      approver_position_name: storeCand.position_name || 'Store Supervisor / Manager',
      approver_employee_no: storeCand.employee_no || null,
      status: chosenSteps.length === 0 ? 'Pending to approve' : 'Not yet processed',
      store_id: storeId || null,
      store_name: storeLabel || storeCand.store_name || null,
    });
  }

  // Ladder Step 2: Check Level 4 (Cluster Manager)
  if (chosenSteps.length < 2) {
    const clusterCand = findClusterCandidate(usedEmployeeIds);
    if (clusterCand) {
      usedEmployeeIds.add(clusterCand.employee_id);
      const effLevel = clusterCand.authority_level ?? (lookupPositionAuthorityLevel(clusterCand.position_name) ?? 4);
      chosenSteps.push({
        step_order: chosenSteps.length + 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: clusterCand.position_name || 'Cluster Manager',
        approver_employee_id: clusterCand.employee_id,
        approver_name: formatApproverDisplayName(clusterCand.full_name, clusterCand.position_name, effLevel),
        approver_position_name: clusterCand.position_name || 'Cluster Manager',
        approver_employee_no: clusterCand.employee_no || null,
        status: chosenSteps.length === 0 ? 'Pending to approve' : 'Not yet processed',
        store_id: storeId || null,
        store_name: storeLabel || null,
      });
    }
  }

  // Ladder Step 3: Check Level 5 / 6 (Area Operations Manager)
  if (chosenSteps.length < 2) {
    const areaCand = findAreaCandidate(usedEmployeeIds);
    if (areaCand) {
      usedEmployeeIds.add(areaCand.employee_id);
      const effLevel = areaCand.authority_level ?? (lookupPositionAuthorityLevel(areaCand.position_name) ?? 5);
      chosenSteps.push({
        step_order: chosenSteps.length + 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: areaCand.position_name || 'Area Operations Manager',
        approver_employee_id: areaCand.employee_id,
        approver_name: formatApproverDisplayName(areaCand.full_name, areaCand.position_name, effLevel),
        approver_position_name: areaCand.position_name || 'Area Operations Manager',
        approver_employee_no: areaCand.employee_no || null,
        status: chosenSteps.length === 0 ? 'Pending to approve' : 'Not yet processed',
        store_id: storeId || null,
        store_name: storeLabel || null,
      });
    }
  }

  // Ladder Step 4: Check Level 7 (Operations Head / HR Manager)
  if (chosenSteps.length < 2) {
    const headCand = findHeadCandidate(usedEmployeeIds);
    if (headCand) {
      usedEmployeeIds.add(headCand.employee_id);
      const effLevel = headCand.authority_level ?? (lookupPositionAuthorityLevel(headCand.position_name) ?? 7);
      chosenSteps.push({
        step_order: chosenSteps.length + 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: headCand.position_name || 'Operations Head',
        approver_employee_id: headCand.employee_id,
        approver_name: formatApproverDisplayName(headCand.full_name, headCand.position_name, effLevel),
        approver_position_name: headCand.position_name || 'Operations Head',
        approver_employee_no: headCand.employee_no || null,
        status: chosenSteps.length === 0 ? 'Pending to approve' : 'Not yet processed',
        store_id: storeId || null,
        store_name: storeLabel || null,
      });
    }
  }

  // Ladder Step 5: Check Level 8 (General Manager)
  if (chosenSteps.length < 2) {
    const gmCand = findGmCandidate(usedEmployeeIds);
    if (gmCand) {
      usedEmployeeIds.add(gmCand.employee_id);
      const effLevel = gmCand.authority_level ?? (lookupPositionAuthorityLevel(gmCand.position_name) ?? 8);
      chosenSteps.push({
        step_order: chosenSteps.length + 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: gmCand.position_name || 'General Manager',
        approver_employee_id: gmCand.employee_id,
        approver_name: formatApproverDisplayName(gmCand.full_name, gmCand.position_name, effLevel),
        approver_position_name: gmCand.position_name || 'General Manager',
        approver_employee_no: gmCand.employee_no || null,
        status: chosenSteps.length === 0 ? 'Pending to approve' : 'Not yet processed',
        store_id: storeId || null,
        store_name: storeLabel || null,
      });
    }
  }

  // If 2 steps were successfully resolved, return them
  if (chosenSteps.length >= 2) {
    return chosenSteps.slice(0, 2);
  }

  // Fallback if candidates were insufficient
  if (chosenSteps.length === 1) {
    chosenSteps.push({
      step_order: 2,
      required_level: 8,
      approver_level: 8,
      position_level: 8,
      role_name: 'General Manager',
      approver_employee_id: null,
      approver_name: 'GENERAL MANAGER',
      approver_position_name: 'General Manager',
      approver_employee_no: null,
      status: 'Not yet processed',
      store_id: storeId || null,
      store_name: storeLabel || null,
    });
    return chosenSteps;
  }

  return [
    {
      step_order: 1,
      required_level: 2,
      approver_level: 2,
      position_level: 2,
      role_name: 'Store Manager',
      approver_employee_id: null,
      approver_name: storeLabel ? `${storeLabel} STORE MANAGER` : 'STORE MANAGER',
      approver_position_name: 'Store Supervisor / Manager',
      approver_employee_no: null,
      status: 'Pending to approve',
      store_id: storeId || null,
      store_name: storeLabel || null,
    },
    {
      step_order: 2,
      required_level: 5,
      approver_level: 5,
      position_level: 5,
      role_name: 'Area Operations Manager',
      approver_employee_id: null,
      approver_name: 'AREA OPERATIONS MANAGER',
      approver_position_name: 'Area Operations Manager',
      approver_employee_no: null,
      status: 'Not yet processed',
      store_id: storeId || null,
      store_name: storeLabel || null,
    },
  ];
}

// ============================================================================
// 2. SWR: Load Store Approval Workflow
// ============================================================================

/**
 * Resolves the approval workflow timeline for a selected store and requester.
 * Uses SWR caching (15-minute fresh TTL, background revalidation, local cache fallback).
 * Fully works online and offline:
 * - Online: Uses get_store_approval_route RPC with automatic candidate fallback for missing steps.
 * - Offline: Resolves real approvers directly from cached approver candidates.
 */
export async function loadStoreApprovalWorkflow(
  storeId?: string | null,
  employeeId?: string | null,
  fallbackStoreName?: string | null,
  isOperations = false,
): Promise<WorkflowStep[]> {
  const cacheKey = `${SWR_PREFIX_WORKFLOW}${storeId || 'original'}_${employeeId || 'me'}`;

  const { data } = await fetchWithSWR<WorkflowStep[]>(
    cacheKey,
    async () => {
      // 1. If storeId is provided, resolve for this specific duty store
      if (storeId) {
        // Try RPC get_store_approval_route
        try {
          const res: any = await withTimeout(
            supabase.rpc('get_store_approval_route', {
              p_store_id: storeId,
              p_employee_id: employeeId || null,
            }),
            2500,
          );

          if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
            let steps = (res.data as any[]).map((st) => {
              const effLevel = resolveApproverLevel({
                approver_level: st.approver_level,
                position_level: st.position_level,
                required_level: st.required_level,
                approver_position_name: st.approver_position_name,
                role_name: st.role_name,
              });
              return {
                ...st,
                required_level: effLevel,
                approver_level: st.approver_level ?? effLevel,
                position_level: st.position_level ?? effLevel,
                approver_name: formatApproverDisplayName(st.approver_name, st.approver_position_name || st.role_name, effLevel),
              } as WorkflowStep;
            });

            // Check if Step 1 and Step 2 have real approver employees
            const step1 = steps.find((s) => s.step_order === 1);
            const step2 = steps.find((s) => s.step_order === 2);
            const step1HasRealEmp = Boolean(step1?.approver_employee_id && isRealApproverName(step1?.approver_name));
            const step2HasRealEmp = Boolean(step2?.approver_employee_id && isRealApproverName(step2?.approver_name));

            if (step1HasRealEmp && step2HasRealEmp) {
              return steps;
            }

            // If either step is missing a real employee, use the ladder-resolved candidate workflow
            const candidateSteps = await resolveStoreWorkflowFromCandidates(
              storeId,
              fallbackStoreName,
              employeeId,
              isOperations,
            );

            if (candidateSteps && candidateSteps.length > 0 && candidateSteps.some((s) => s.approver_employee_id)) {
              return candidateSteps;
            }

            const hasAnyRealName = steps.some((s) => s.approver_employee_id && isRealApproverName(s.approver_name));
            if (hasAnyRealName) {
              return steps;
            }
          }
        } catch {
          // ignore
        }

        // 2. Direct Candidate Resolution Fallback for this store
        const candidateResolved = await resolveStoreWorkflowFromCandidates(
          storeId,
          fallbackStoreName,
          employeeId,
          isOperations,
        );
        if (candidateResolved && candidateResolved.length > 0 && candidateResolved.some((s) => s.approver_employee_id)) {
          return candidateResolved;
        }
      }

      // 4. Default workflow when storeId is not provided (requester's home route)
      if (!storeId) {
        // Query database get_store_approval_route RPC which resolves the ladder via approval_level_routes & find_request_approver
        try {
          const res: any = await withTimeout(
            supabase.rpc('get_store_approval_route', {
              p_store_id: null,
              p_employee_id: employeeId || null,
            }),
            2500,
          );

          if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
            const steps = (res.data as any[]).map((st) => {
              const effLevel = resolveApproverLevel({
                approver_level: st.approver_level,
                position_level: st.position_level,
                required_level: st.required_level,
                approver_position_name: st.approver_position_name,
                role_name: st.role_name,
              });
              return {
                ...st,
                required_level: effLevel,
                approver_level: st.approver_level ?? effLevel,
                position_level: st.position_level ?? effLevel,
                approver_name: formatApproverDisplayName(st.approver_name, st.approver_position_name || st.role_name, effLevel),
              } as WorkflowStep;
            });

            const hasValidRealNames = steps.some(
              (s) => s.approver_name && s.approver_name.trim().toUpperCase() !== 'APPROVER',
            );
            if (hasValidRealNames) {
              return steps;
            }
          }
        } catch {
          // ignore
        }

        // Offline / fallback: resolve from approver candidates following the ladder
        const candidateResolved = await resolveStoreWorkflowFromCandidates(
          null,
          fallbackStoreName,
          employeeId,
          isOperations,
        );
        if (candidateResolved && candidateResolved.length > 0 && candidateResolved.some((s) => s.approver_employee_id)) {
          return candidateResolved;
        }
      }

      return null;
    },
    15 * 60 * 1000, // 15 mins fresh
    (steps) =>
      Array.isArray(steps) &&
      steps.length > 0 &&
      steps.some((s) => s.approver_name && s.approver_name.trim().toUpperCase() !== 'APPROVER'),
  );

  if (data && data.length > 0) {
    return data;
  }

  // Offline / cold-start fallback
  const candidateResolved = await resolveStoreWorkflowFromCandidates(
    storeId,
    fallbackStoreName,
    employeeId,
    isOperations,
  );
  if (candidateResolved && candidateResolved.length > 0 && candidateResolved.some((s) => s.approver_employee_id)) {
    const entry: SWRCacheEntry<WorkflowStep[]> = { data: candidateResolved, timestamp: Date.now() };
    swrMemoryCache.set(cacheKey, entry);
    setCacheJSON(cacheKey, entry).catch(() => {});
    return candidateResolved;
  }

  // Graceful default offline fallback for home route
  const defaultSteps: WorkflowStep[] = [
    {
      step_order: 1,
      required_level: 2,
      approver_level: 2,
      position_level: 2,
      role_name: 'Store Manager',
      approver_employee_id: null,
      approver_name: 'STORE MANAGER / IMMEDIATE SUPERVISOR',
      approver_position_name: 'Branch Manager / Store Supervisor',
      status: 'Pending to approve',
      store_id: null,
      store_name: null,
    },
    {
      step_order: 2,
      required_level: 5,
      approver_level: 5,
      position_level: 5,
      role_name: isOperations ? 'Area Operations Manager' : 'General Manager',
      approver_employee_id: null,
      approver_name: isOperations ? 'AREA OPERATIONS MANAGER' : 'GENERAL MANAGER',
      approver_position_name: isOperations ? 'Area Operations Manager' : 'Executive Management',
      status: 'Not yet processed',
      store_id: null,
      store_name: null,
    },
  ];

  return defaultSteps;
}

// ============================================================================
// 3. SWR: Load Approver Candidates
// ============================================================================

/**
 * Loads employee candidates for approver reassignment (similar to admin requests screen).
 * Excludes level 1 rank-and-file employees at both database and client layers for lightweight payloads.
 * Uses SWR caching (45-minute fresh TTL on master list, instant client-side filtering, offline local cache).
 */
export async function loadApproverCandidates(searchQuery?: string): Promise<ApproverCandidate[]> {
  const { data } = await fetchWithSWR<ApproverCandidate[]>(
    SWR_KEY_CANDIDATES,
    async () => {
      // Primary: get_approver_candidates RPC with p_min_authority_level = 2 (skips heavy level 1 payload)
      try {
        const res: any = await withTimeout(
          supabase.rpc('get_approver_candidates', { p_search: null, p_min_authority_level: 2 }),
          2500,
        );

        if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
          return (res.data as ApproverCandidate[]).filter((c) => (c.authority_level ?? 0) > 1);
        }
      } catch {
        // fallback
      }

      // Secondary fallback: without p_min_authority_level in case backend has older signature
      try {
        const res: any = await withTimeout(
          supabase.rpc('get_approver_candidates', { p_search: null }),
          2500,
        );

        if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
          return (res.data as ApproverCandidate[]).filter((c) => (c.authority_level ?? 0) > 1);
        }
      } catch {
        // fallback
      }

      // Tertiary fallback: Read from legacy local cache if available and filter
      try {
        const legacy = await getCacheJSON<SWRCacheEntry<ApproverCandidate[]>>('swr_portal_candidates_master_v2');
        if (legacy && Array.isArray(legacy.data) && legacy.data.length > 0) {
          return legacy.data.filter((c) => (c.authority_level ?? 0) > 1);
        }
      } catch {
        // ignore
      }

      return null;
    },
    45 * 60 * 1000, // 45 mins fresh
    (candidates) => Array.isArray(candidates) && candidates.length > 0,
  );

  let allCandidates = data || [];

  // If offline cold start with empty v3 cache, check legacy v2 local cache
  if (allCandidates.length === 0) {
    try {
      const legacy = await getCacheJSON<SWRCacheEntry<ApproverCandidate[]>>('swr_portal_candidates_master_v2');
      if (legacy && Array.isArray(legacy.data) && legacy.data.length > 0) {
        allCandidates = legacy.data.filter((c) => (c.authority_level ?? 0) > 1);
      }
    } catch {
      // ignore
    }
  }

  // Strict guarantee: Exclude all level 1 employees
  const approversOnly = allCandidates.filter((c) => (c.authority_level ?? 0) > 1);

  // Instant client-side filtering (0 database queries, 0ms latency)
  if (!searchQuery || !searchQuery.trim()) {
    return approversOnly;
  }

  const q = searchQuery.toLowerCase().trim();
  return approversOnly.filter(
    (c) =>
      c.full_name.toLowerCase().includes(q) ||
      (c.employee_no && c.employee_no.toLowerCase().includes(q)) ||
      (c.position_name && c.position_name.toLowerCase().includes(q)) ||
      (c.department_name && c.department_name.toLowerCase().includes(q)) ||
      (c.store_name && c.store_name.toLowerCase().includes(q)) ||
      (c.company_name && c.company_name.toLowerCase().includes(q)),
  );
}

// ============================================================================
// 4. Mutation: Reassign Request Approver
// ============================================================================

/**
 * Reassigns an approver on an existing request step using the admin_reassign_request_approver RPC.
 * Automatically invalidates relevant SWR memory cache entries.
 */
export async function reassignRequestApprover(
  requestId: string,
  newApproverEmployeeId: string,
  stepId?: string | null,
): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('admin_reassign_request_approver', {
      p_request_id: requestId,
      p_new_approver_employee_id: newApproverEmployeeId,
      p_step_id: stepId || null,
    });

    if (error) {
      throw new Error(error.message);
    }

    // Invalidate in-memory workflow cache so fresh data is loaded on subsequent views
    swrMemoryCache.clear();

    return (data as string) || 'Approver reassigned successfully.';
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to reassign approver.');
  }
}

/**
 * Purges cached workflow entries to force a fresh ladder resolution from the database.
 */
export function invalidateApprovalWorkflowCache(): void {
  for (const key of Array.from(swrMemoryCache.keys())) {
    if (key.startsWith(SWR_PREFIX_WORKFLOW)) {
      swrMemoryCache.delete(key);
    }
  }
}
