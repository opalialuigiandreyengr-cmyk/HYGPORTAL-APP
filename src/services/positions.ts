import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

const DEFAULT_POSITION_AUTHORITIES: Record<string, number> = {
  'store supervisor': 2,
  'immediate supervisor': 2,
  'supervisor': 2,
  'team lead': 2,
  'store head': 2,
  'officer-in-charge': 2,
  'oic': 2,
  'store manager': 2,
  'branch manager': 3,
  'assistant store manager': 2,
  'cluster head': 4,
  'cluster manager': 4,
  'area operations manager': 5,
  'area manager': 5,
  'operations manager': 5,
  'field operations manager': 5,
  'retail operations manager': 5,
  'operations head': 6,
  'senior operations manager': 6,
  'senior manager': 6,
  'hr manager': 7,
  'human resources manager': 7,
  'general manager': 8,
  'president': 8,
  'chief executive officer': 8,
  'ceo': 8,
};

const POSITION_AUTHORITY_CACHE_KEY = 'position_authorities_v1';
const positionAuthorityMap: Record<string, number> = { ...DEFAULT_POSITION_AUTHORITIES };
let isPositionsLoaded = false;

/**
 * Loads and caches position authority levels from public.positions table.
 */
export async function loadPositionAuthorities(): Promise<Record<string, number>> {
  if (isPositionsLoaded && Object.keys(positionAuthorityMap).length > Object.keys(DEFAULT_POSITION_AUTHORITIES).length) {
    return positionAuthorityMap;
  }

  // Load from local storage cache first
  try {
    const cached = await getCacheJSON<Record<string, number>>(POSITION_AUTHORITY_CACHE_KEY);
    if (cached && Object.keys(cached).length > 0) {
      Object.assign(positionAuthorityMap, cached);
      isPositionsLoaded = true;
    }
  } catch {
    // ignore
  }

  // Fetch latest from supabase
  try {
    const { data, error } = await supabase
      .from('positions')
      .select('name, authority_level')
      .eq('is_active', true);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (row.name && typeof row.authority_level === 'number' && row.authority_level > 0) {
          positionAuthorityMap[row.name.trim().toLowerCase()] = row.authority_level;
        }
      }
      isPositionsLoaded = true;
      await setCacheJSON(POSITION_AUTHORITY_CACHE_KEY, positionAuthorityMap);
    }
  } catch {
    // ignore
  }

  return positionAuthorityMap;
}

/**
 * Looks up the authority level of a position by position name (matching admin PositionDirectoryService).
 */
export function lookupPositionAuthorityLevel(positionName?: string | null): number | null {
  if (!positionName) return null;
  const key = positionName.trim().toLowerCase();
  if (!key) return null;

  const exact = positionAuthorityMap[key];
  if (exact !== undefined && exact > 0) return exact;

  for (const [name, level] of Object.entries(positionAuthorityMap)) {
    if (name === key || key.includes(name) || name.includes(key)) {
      return level;
    }
  }

  return null;
}

/**
 * Resolves the accurate approver authority level matching the admin side.
 * Priority: position_level -> approver_level -> position directory lookup -> level -> required_level
 */
export function resolveApproverLevel(step: {
  position_level?: number | null;
  approver_level?: number | null;
  level?: number | null;
  required_level?: number | null;
  approver_position_name?: string | null;
  role_name?: string | null;
}): number {
  if (typeof step.position_level === 'number' && step.position_level > 0) {
    return step.position_level;
  }

  if (typeof step.approver_level === 'number' && step.approver_level > 0) {
    return step.approver_level;
  }

  const lookedUp = lookupPositionAuthorityLevel(step.approver_position_name || step.role_name);
  if (typeof lookedUp === 'number' && lookedUp > 0) {
    return lookedUp;
  }

  if (typeof step.level === 'number' && step.level > 0) {
    return step.level;
  }

  if (typeof step.required_level === 'number' && step.required_level > 0) {
    return step.required_level;
  }

  return 1;
}
