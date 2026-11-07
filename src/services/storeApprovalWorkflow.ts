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
const SWR_PREFIX_WORKFLOW = 'swr_portal_store_workflow_v4_';
const AUTH_WORKFLOW_STORAGE_PREFIX = 'auth_portal_workflow_v1_';

/**
 * Loads the persisted authoritative workflow for an employee and store.
 * Checked first on cold starts or network failures so the default timeline
 * approvers remain rock-solid and never change to random candidates.
 */
export async function getAuthoritativeCachedWorkflow(
  employeeId?: string | null,
  storeId?: string | null,
): Promise<WorkflowStep[] | null> {
  const key = `${AUTH_WORKFLOW_STORAGE_PREFIX}${employeeId || 'me'}_${storeId || 'home'}`;
  const mem = swrMemoryCache.get(key)?.data;
  if (Array.isArray(mem) && mem.length > 0) {
    return mem;
  }
  try {
    const stored = await getCacheJSON<SWRCacheEntry<WorkflowStep[]>>(key);
    if (stored?.data && Array.isArray(stored.data) && stored.data.length > 0) {
      swrMemoryCache.set(key, stored);
      return stored.data;
    }
  } catch {
    // non-fatal
  }
  return null;
}

/**
 * Saves a verified authoritative workflow to both L1 memory and L2 persistent storage.
 */
export async function saveAuthoritativeCachedWorkflow(
  employeeId: string | null | undefined,
  storeId: string | null | undefined,
  steps: WorkflowStep[],
): Promise<void> {
  if (!Array.isArray(steps) || steps.length === 0) return;
  const key = `${AUTH_WORKFLOW_STORAGE_PREFIX}${employeeId || 'me'}_${storeId || 'home'}`;
  const entry: SWRCacheEntry<WorkflowStep[]> = { data: steps, timestamp: Date.now() };
  swrMemoryCache.set(key, entry);
  try {
    await setCacheJSON(key, entry);
  } catch {
    // non-fatal
  }
}

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
  fallbackDepartmentName?: string | null,
): Promise<WorkflowStep[]> {
  let storeLabel = (fallbackStoreName || '').trim();
  let employeeDept: string | null = fallbackDepartmentName?.trim() || null;
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
      if (!employeeDept && requester.department_name) {
        employeeDept = requester.department_name;
      }
      employeeLevel = requester.authority_level ?? (lookupPositionAuthorityLevel(requester.position_name) ?? 1);
    }
  }

  // Filter out the requester so they never approve their own request
  const validCandidates = candidates.filter((c) => !employeeId || c.employee_id !== employeeId);

  const isOps = Boolean(
    isOperations ||
    (employeeDept && employeeDept.toLowerCase().includes('operation')) ||
    storeLabel ||
    storeId,
  );

  // Retrieve store metadata (cluster name, area name) for accurate ladder scoping
  let clusterName: string | null = null;
  let areaName: string | null = null;
  if (isOps) {
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
  }

  // ==========================================================================
  // Branch A: Non-Operations Department (HR, Accounting, IT, Training, Admin, etc.)
  // Must follow department ladder rather than store/cluster/area operations ladder
  // ==========================================================================
  if (!isOps && employeeDept) {
    const deptLower = employeeDept.toLowerCase();
    const chosenSteps: WorkflowStep[] = [];
    const usedEmployeeIds = new Set<string>();
    if (employeeId) usedEmployeeIds.add(employeeId);

    // Step 1: Supervisor or Manager in the same department
    const deptMatches = validCandidates.filter(
      (c) =>
        !usedEmployeeIds.has(c.employee_id) &&
        c.department_name &&
        c.department_name.toLowerCase() === deptLower &&
        (c.authority_level ?? (lookupPositionAuthorityLevel(c.position_name) ?? 2)) > employeeLevel &&
        (c.authority_level ?? (lookupPositionAuthorityLevel(c.position_name) ?? 2)) <= 7,
    );
    deptMatches.sort((a, b) => {
      const aL = a.authority_level ?? (lookupPositionAuthorityLevel(a.position_name) ?? 2);
      const bL = b.authority_level ?? (lookupPositionAuthorityLevel(b.position_name) ?? 2);
      return aL - bL;
    });

    if (deptMatches.length > 0) {
      const step1Cand = deptMatches[0];
      usedEmployeeIds.add(step1Cand.employee_id);
      const effLevel = step1Cand.authority_level ?? (lookupPositionAuthorityLevel(step1Cand.position_name) ?? 3);
      chosenSteps.push({
        step_order: 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: step1Cand.position_name || 'Department Supervisor',
        approver_employee_id: step1Cand.employee_id,
        approver_name: formatApproverDisplayName(step1Cand.full_name, step1Cand.position_name, effLevel),
        approver_position_name: step1Cand.position_name || 'Department Supervisor',
        approver_employee_no: step1Cand.employee_no || null,
        status: 'Pending to approve',
        store_id: null,
        store_name: null,
      });
    } else {
      chosenSteps.push({
        step_order: 1,
        required_level: 3,
        approver_level: 3,
        position_level: 3,
        role_name: `${employeeDept} Supervisor`,
        approver_employee_id: null,
        approver_name: `${employeeDept.toUpperCase()} SUPERVISOR`,
        approver_position_name: `${employeeDept} Supervisor`,
        approver_employee_no: null,
        status: 'Pending to approve',
        store_id: null,
        store_name: null,
      });
    }

    // Step 2: Department Head (Level 7) in the same department or General Manager (Level 8)
    const headMatches = validCandidates.filter(
      (c) =>
        !usedEmployeeIds.has(c.employee_id) &&
        ((c.department_name && c.department_name.toLowerCase() === deptLower && (c.authority_level ?? (lookupPositionAuthorityLevel(c.position_name) ?? 0)) >= 7) ||
          (c.authority_level ?? (lookupPositionAuthorityLevel(c.position_name) ?? 0)) >= 8 ||
          (c.position_name || '').toLowerCase().includes('general manager')),
    );
    headMatches.sort((a, b) => {
      const aIsSameDept = a.department_name && a.department_name.toLowerCase() === deptLower ? 0 : 1;
      const bIsSameDept = b.department_name && b.department_name.toLowerCase() === deptLower ? 0 : 1;
      if (aIsSameDept !== bIsSameDept) return aIsSameDept - bIsSameDept;
      const aL = a.authority_level ?? (lookupPositionAuthorityLevel(a.position_name) ?? 8);
      const bL = b.authority_level ?? (lookupPositionAuthorityLevel(b.position_name) ?? 8);
      return aL - bL;
    });

    if (headMatches.length > 0) {
      const step2Cand = headMatches[0];
      usedEmployeeIds.add(step2Cand.employee_id);
      const effLevel = step2Cand.authority_level ?? (lookupPositionAuthorityLevel(step2Cand.position_name) ?? 8);
      chosenSteps.push({
        step_order: 2,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: step2Cand.position_name || 'General Manager',
        approver_employee_id: step2Cand.employee_id,
        approver_name: formatApproverDisplayName(step2Cand.full_name, step2Cand.position_name, effLevel),
        approver_position_name: step2Cand.position_name || 'General Manager',
        approver_employee_no: step2Cand.employee_no || null,
        status: 'Not yet processed',
        store_id: null,
        store_name: null,
      });
    } else {
      chosenSteps.push({
        step_order: 2,
        required_level: 8,
        approver_level: 8,
        position_level: 8,
        role_name: 'General Manager',
        approver_employee_id: null,
        approver_name: 'GENERAL MANAGER',
        approver_position_name: 'Executive Management',
        approver_employee_no: null,
        status: 'Not yet processed',
        store_id: null,
        store_name: null,
      });
    }

    return chosenSteps;
  }

  // ==========================================================================
  // Branch B: Operations Department (Store / Branch / Cluster / Area)
  // Ladder:
  // Step 1: Store Manager (L2/L3) -> Fallback: Cluster Manager (L4, matching cluster)
  // Step 2: Area Operations Manager (L5, strictly matching area) -> Fallback: Ops Head (L7) / GM (L8)
  // If requester is Level 4 (Cluster Manager):
  // Step 1: Area Operations Manager (L5)
  // Step 2: Operations Head (L7) / General Manager (L8)
  // ==========================================================================

  // Finder 1: Store-level approver (Level 2 / 3 - Store Supervisor / Store Manager)
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
    return null;
  }

  // Finder 2: Cluster-level approver (Level 4 - Cluster Manager strictly scoped to clusterName)
  function findClusterCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (validCandidates.length === 0) return null;
    const clusterMatches = validCandidates.filter((c) => {
      if (usedIds.has(c.employee_id)) return false;
      const pos = (c.position_name || '').toLowerCase();
      const store = (c.store_name || '').toLowerCase();
      const isLevel4 = (c.authority_level ?? lookupPositionAuthorityLevel(c.position_name)) === 4;
      const isCluster = isLevel4 || pos.includes('cluster manager') || pos.includes('cluster head');
      if (!isCluster) return false;
      // Strictly require matching cluster if clusterName is known!
      if (clusterName) {
        return store.includes(clusterName.toLowerCase()) || pos.includes(clusterName.toLowerCase());
      }
      return true;
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

  // Finder 3: Area-level approver (Level 5 - Area Operations Manager strictly scoped to areaName)
  function findAreaCandidate(usedIds: Set<string>): ApproverCandidate | null {
    if (validCandidates.length === 0) return null;
    const areaMatches = validCandidates.filter((c) => {
      if (usedIds.has(c.employee_id)) return false;
      const pos = (c.position_name || '').toLowerCase();
      const dept = (c.department_name || '').toLowerCase();
      const store = (c.store_name || '').toLowerCase();
      const isLevel5 = (c.authority_level ?? lookupPositionAuthorityLevel(c.position_name)) === 5;
      const isAom =
        isLevel5 ||
        pos.includes('area operations') ||
        pos.includes('area manager') ||
        pos.includes('operations manager') ||
        pos.includes('operations head') ||
        pos.includes('aom');
      if (!isAom) return false;
      // Strictly require matching area if areaName is known!
      if (areaName) {
        return store.includes(areaName.toLowerCase()) || pos.includes(areaName.toLowerCase());
      }
      return dept.includes('operation') || isLevel5;
    });
    if (areaMatches.length > 0) {
      areaMatches.sort((a, b) => {
        const aPos = (a.position_name || '').toLowerCase();
        const bPos = (b.position_name || '').toLowerCase();
        const aPriority = aPos.includes('area operations') || aPos.includes('aom') ? 0 : aPos.includes('area manager') ? 1 : 2;
        const bPriority = bPos.includes('area operations') || bPos.includes('aom') ? 0 : bPos.includes('area manager') ? 1 : 2;
        if (aPriority !== bPriority) return aPriority - bPriority;
        const aLevel = a.authority_level ?? (lookupPositionAuthorityLevel(a.position_name) ?? 5);
        const bLevel = b.authority_level ?? (lookupPositionAuthorityLevel(b.position_name) ?? 5);
        return aLevel - bLevel;
      });
      return areaMatches[0];
    }
    return null;
  }

  // Finder 4: Department Head approver (Level 7 - Operations Head)
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

  // Finder 5: Executive approver (Level 8 - General Manager)
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

  const chosenSteps: WorkflowStep[] = [];
  const usedEmployeeIds = new Set<string>();
  if (employeeId) usedEmployeeIds.add(employeeId);

  // Case 1: Requester is a Cluster Manager (Level 4)
  if (employeeLevel === 4) {
    const areaCand = findAreaCandidate(usedEmployeeIds);
    if (areaCand) {
      usedEmployeeIds.add(areaCand.employee_id);
      const effLevel = areaCand.authority_level ?? (lookupPositionAuthorityLevel(areaCand.position_name) ?? 5);
      chosenSteps.push({
        step_order: 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: areaCand.position_name || 'Area Operations Manager',
        approver_employee_id: areaCand.employee_id,
        approver_name: formatApproverDisplayName(areaCand.full_name, areaCand.position_name, effLevel),
        approver_position_name: areaCand.position_name || 'Area Operations Manager',
        approver_employee_no: areaCand.employee_no || null,
        status: 'Pending to approve',
        store_id: null,
        store_name: null,
      });
    } else {
      chosenSteps.push({
        step_order: 1,
        required_level: 5,
        approver_level: 5,
        position_level: 5,
        role_name: 'Area Operations Manager',
        approver_employee_id: null,
        approver_name: areaName ? `${areaName.toUpperCase()} OPERATIONS MANAGER` : 'AREA OPERATIONS MANAGER',
        approver_position_name: 'Area Operations Manager',
        approver_employee_no: null,
        status: 'Pending to approve',
        store_id: null,
        store_name: null,
      });
    }

    const headCand = findHeadCandidate(usedEmployeeIds) || findGmCandidate(usedEmployeeIds);
    if (headCand) {
      const effLevel = headCand.authority_level ?? (lookupPositionAuthorityLevel(headCand.position_name) ?? 7);
      chosenSteps.push({
        step_order: 2,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: headCand.position_name || 'Operations Head',
        approver_employee_id: headCand.employee_id,
        approver_name: formatApproverDisplayName(headCand.full_name, headCand.position_name, effLevel),
        approver_position_name: headCand.position_name || 'Operations Head',
        approver_employee_no: headCand.employee_no || null,
        status: 'Not yet processed',
        store_id: null,
        store_name: null,
      });
    } else {
      chosenSteps.push({
        step_order: 2,
        required_level: 7,
        approver_level: 7,
        position_level: 7,
        role_name: 'Operations Head',
        approver_employee_id: null,
        approver_name: 'OPERATIONS HEAD / DIRECTOR',
        approver_position_name: 'Operations Head',
        approver_employee_no: null,
        status: 'Not yet processed',
        store_id: null,
        store_name: null,
      });
    }
    return chosenSteps;
  }

  // Case 2: Standard Store / Branch Employee (Level 1, 2, or 3)
  // Step 1: Store Supervisor / Store Manager (Level 2/3)
  const storeCand = findStoreCandidate(usedEmployeeIds);
  if (storeCand) {
    usedEmployeeIds.add(storeCand.employee_id);
    const effLevel = storeCand.authority_level ?? (lookupPositionAuthorityLevel(storeCand.position_name) ?? 2);
    chosenSteps.push({
      step_order: 1,
      required_level: effLevel,
      approver_level: effLevel,
      position_level: effLevel,
      role_name: storeCand.position_name || 'Store Supervisor',
      approver_employee_id: storeCand.employee_id,
      approver_name: formatApproverDisplayName(storeCand.full_name, storeCand.position_name, effLevel),
      approver_position_name: storeCand.position_name || 'Store Supervisor / Manager',
      approver_employee_no: storeCand.employee_no || null,
      status: 'Pending to approve',
      store_id: storeId || null,
      store_name: storeLabel || storeCand.store_name || null,
    });
  } else {
    // If no specific store candidate, check if Cluster Manager exists for this store's cluster
    const clusterCand = findClusterCandidate(usedEmployeeIds);
    if (clusterCand && clusterName) {
      usedEmployeeIds.add(clusterCand.employee_id);
      const effLevel = clusterCand.authority_level ?? (lookupPositionAuthorityLevel(clusterCand.position_name) ?? 4);
      chosenSteps.push({
        step_order: 1,
        required_level: effLevel,
        approver_level: effLevel,
        position_level: effLevel,
        role_name: clusterCand.position_name || 'Cluster Manager',
        approver_employee_id: clusterCand.employee_id,
        approver_name: formatApproverDisplayName(clusterCand.full_name, clusterCand.position_name, effLevel),
        approver_position_name: clusterCand.position_name || 'Cluster Manager',
        approver_employee_no: clusterCand.employee_no || null,
        status: 'Pending to approve',
        store_id: storeId || null,
        store_name: storeLabel || null,
      });
    } else {
      chosenSteps.push({
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
      });
    }
  }

  // Step 2: Area Operations Manager (Level 5) strictly scoped to area
  const areaCand = findAreaCandidate(usedEmployeeIds);
  if (areaCand) {
    usedEmployeeIds.add(areaCand.employee_id);
    const effLevel = areaCand.authority_level ?? (lookupPositionAuthorityLevel(areaCand.position_name) ?? 5);
    chosenSteps.push({
      step_order: 2,
      required_level: effLevel,
      approver_level: effLevel,
      position_level: effLevel,
      role_name: areaCand.position_name || 'Area Operations Manager',
      approver_employee_id: areaCand.employee_id,
      approver_name: formatApproverDisplayName(areaCand.full_name, areaCand.position_name, effLevel),
      approver_position_name: areaCand.position_name || 'Area Operations Manager',
      approver_employee_no: areaCand.employee_no || null,
      status: 'Not yet processed',
      store_id: storeId || null,
      store_name: storeLabel || null,
    });
  } else {
    chosenSteps.push({
      step_order: 2,
      required_level: 5,
      approver_level: 5,
      position_level: 5,
      role_name: 'Area Operations Manager',
      approver_employee_id: null,
      approver_name: areaName ? `${areaName.toUpperCase()} OPERATIONS MANAGER` : 'AREA OPERATIONS MANAGER',
      approver_position_name: 'Area Operations Manager',
      approver_employee_no: null,
      status: 'Not yet processed',
      store_id: storeId || null,
      store_name: storeLabel || null,
    });
  }

  return chosenSteps;
}

// ============================================================================
// 2. SWR: Load Store Approval Workflow
// ============================================================================

/**
 * Resolves the approval workflow timeline for a selected store and requester.
 * Uses persistent authoritative caching (2-hour fresh TTL, background revalidation, local cache fallback).
 * Fully works online and offline:
 * - Online: Uses get_store_approval_route RPC which follows approval_level_routes and find_request_approver,
 *   persisting verified authoritative steps so future connection issues never change default approvers.
 * - Offline / Connection Issue: Serves the last known authoritative route directly from persistent storage,
 *   preventing default approvers from changing to random employees during database hiccups.
 * - Strict Last Resort: Candidate resolution is ONLY invoked if the device is a fresh install with zero cached route.
 */
export async function loadStoreApprovalWorkflow(
  storeId?: string | null,
  employeeId?: string | null,
  fallbackStoreName?: string | null,
  isOperations = false,
  fallbackDepartmentName?: string | null,
): Promise<WorkflowStep[]> {
  const targetStoreId = storeId ? String(storeId) : null;
  const targetEmployeeId = employeeId && employeeId !== 'N/A' ? String(employeeId) : null;
  const cacheKey = `${SWR_PREFIX_WORKFLOW}${targetStoreId || 'original'}_${targetEmployeeId || 'me'}_${fallbackStoreName || 'nostore'}_${fallbackDepartmentName || 'nodept'}`;

  const { data } = await fetchWithSWR<WorkflowStep[]>(
    cacheKey,
    async () => {
      // Query database get_store_approval_route RPC which resolves the ladder via approval_level_routes & find_request_approver
      try {
        const res: any = await withTimeout(
          supabase.rpc('get_store_approval_route', {
            p_store_id: targetStoreId,
            p_employee_id: targetEmployeeId,
          }),
          10000,
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
              is_reassigned: Boolean(st.is_reassigned),
            } as WorkflowStep;
          });

          if (steps.length > 0) {
            // Persist as the authoritative source of truth for this employee & store
            saveAuthoritativeCachedWorkflow(targetEmployeeId, targetStoreId, steps).catch(() => {});
            return steps;
          }
        }
      } catch (err) {
        // Silently catch network / timeout / DB issues.
        // CRITICAL: We do NOT fall back to candidate guessing inside the SWR fetcher.
        // Returning null tells SWR that revalidation could not fetch fresh data,
        // which prevents SWR from overwriting the good authoritative cache with random candidates!
        console.warn('[storeApprovalWorkflow] get_store_approval_route connection issue or timeout:', err);
      }

      return null;
    },
    2 * 60 * 60 * 1000, // 2 hours fresh TTL
    (steps) => Array.isArray(steps) && steps.length > 0,
  );

  // 1. If SWR returned cached or freshly verified steps, return immediately
  if (data && data.length > 0) {
    return data;
  }

  // 2. Offline / cold start: check if we have a persisted authoritative route from a previous session
  const authoritativeSteps = await getAuthoritativeCachedWorkflow(targetEmployeeId, targetStoreId);
  if (authoritativeSteps && authoritativeSteps.length > 0) {
    const entry: SWRCacheEntry<WorkflowStep[]> = { data: authoritativeSteps, timestamp: Date.now() };
    swrMemoryCache.set(cacheKey, entry);
    setCacheJSON(cacheKey, entry).catch(() => {});
    return authoritativeSteps;
  }

  // 3. Strict last-resort fallback: only for brand-new install with zero cached route and no connection
  const candidateResolved = await resolveStoreWorkflowFromCandidates(
    storeId,
    fallbackStoreName,
    employeeId,
    isOperations,
    fallbackDepartmentName,
  );
  if (candidateResolved && candidateResolved.length > 0) {
    return candidateResolved;
  }

  // 4. Graceful default offline fallback for home route
  const defaultSteps: WorkflowStep[] = [
    {
      step_order: 1,
      required_level: 2,
      approver_level: 2,
      position_level: 2,
      role_name: 'Store Manager',
      approver_employee_id: null,
      approver_name: fallbackStoreName ? `${fallbackStoreName.toUpperCase()} STORE MANAGER` : 'STORE MANAGER',
      approver_position_name: 'Branch Manager / Store Supervisor',
      status: 'Pending to approve',
      store_id: null,
      store_name: fallbackStoreName || null,
      is_reassigned: false,
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
      is_reassigned: false,
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
    if (key.startsWith(SWR_PREFIX_WORKFLOW) || key.startsWith(AUTH_WORKFLOW_STORAGE_PREFIX)) {
      swrMemoryCache.delete(key);
    }
  }
}
