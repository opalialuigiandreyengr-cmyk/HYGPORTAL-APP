import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';

export type BadgeCatalogItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  iconData: string;
  customImagePath: string | null;
  iconBgColor: string;
  iconColor: string;
  points: number;
  awardedCount: number;
  status: string;
};

export type EarnedBadgeItem = {
  id: string;
  badgeId: string;
  title: string;
  description: string;
  category: string;
  iconData: string;
  customImagePath: string | null;
  iconBgColor: string;
  iconColor: string;
  awardedBy: string;
  awardedAt: string;
  note: string;
  pointsAwarded: number;
};

export type EmployeeBadgesData = {
  earned: EarnedBadgeItem[];
  locked: BadgeCatalogItem[];
  catalog: BadgeCatalogItem[];
  totalCatalogCount: number;
};

export type DepartmentBadgeRecipient = {
  employeeId: string;
  employeeNo: string | null;
  fullName: string;
  departmentName: string;
  positionName: string | null;
  photoUrl: string | null;
};

export type BadgeAwardRequisitionItem = {
  id: string;
  badgeId: string | null;
  badgeTitle: string;
  badgeIcon: string;
  customImagePath: string | null;
  badgeIconBgColor: string;
  badgeIconColor: string;
  points: number;
  employeeId: string;
  employeeName: string;
  employeeDepartment: string;
  employeePhotoUrl: string | null;
  requestedById: string | null;
  requestedByName: string;
  requestedByRole: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  createdAt: string;
};

type BadgeRow = {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  icon_data: string | null;
  custom_image_path: string | null;
  icon_bg_color: string | null;
  icon_color: string | null;
  points: number | string | null;
  awarded_count: number | string | null;
  status: string | null;
};

type AwardedBadgeRow = {
  id: string;
  badge_id: string | null;
  badge_title: string | null;
  badge_icon: string | null;
  custom_image_path: string | null;
  badge_icon_bg_color: string | null;
  badge_icon_color: string | null;
  employee_id: string | null;
  awarded_by: string | null;
  awarded_at: string | null;
  note: string | null;
  points_awarded: number | string | null;
  created_at: string | null;
};

export function emptyEmployeeBadgesData(): EmployeeBadgesData {
  return {
    earned: [],
    locked: [],
    catalog: [],
    totalCatalogCount: 0,
  };
}

const BADGES_CACHE_TTL_MS = 5 * 60 * 1000;
const RECIPIENTS_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUISITIONS_CACHE_TTL_MS = 5 * 60 * 1000;

function getRecipientsCacheKey(managerEmployeeId: string) {
  return `badge_award_recipients_v1_${managerEmployeeId}`;
}

function getRequisitionsCacheKey(managerEmployeeId: string) {
  return `badge_award_requisitions_v1_${managerEmployeeId}`;
}

export async function loadEmployeeBadges(
  userId?: string,
  employeeId?: string,
  employeeCode?: string,
  options?: { forceRefresh?: boolean },
): Promise<EmployeeBadgesData> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return emptyEmployeeBadgesData();
  }

  const cacheKey = `employee_badges_v1_${currentUserId}`;

  if (!options?.forceRefresh) {
    const freshCached = await getCacheJSON<EmployeeBadgesData>(cacheKey, BADGES_CACHE_TTL_MS);
    if (freshCached && Array.isArray(freshCached.catalog)) {
      return freshCached;
    }
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

  const candidateEmpIds = Array.from(
    new Set([empId, employeeCode].map((v) => v?.trim()).filter((v): v is string => Boolean(v))),
  );

  try {
    const [catalogRes, awardedRes] = await Promise.all([
      supabase
        .from('badges')
        .select('id, title, description, category, icon_data, custom_image_path, icon_bg_color, icon_color, points, awarded_count, status')
        .order('created_at', { ascending: false }),
      candidateEmpIds.length > 0
        ? supabase
            .from('awarded_badges')
            .select('id, badge_id, badge_title, badge_icon, custom_image_path, badge_icon_bg_color, badge_icon_color, employee_id, awarded_by, awarded_at, note, points_awarded, created_at')
            .in('employee_id', candidateEmpIds)
            .order('awarded_at', { ascending: false })
        : Promise.resolve({ data: [] as AwardedBadgeRow[], error: null }),
    ]);

    if (catalogRes.error) {
      throw catalogRes.error;
    }
    if (awardedRes.error) {
      throw awardedRes.error;
    }

    const catalogRows = (catalogRes.data ?? []) as BadgeRow[];
    const activeCatalog: BadgeCatalogItem[] = catalogRows
      .filter((row) => (row.status ?? 'Active').trim().toLowerCase() === 'active')
      .map((row) => ({
        id: row.id,
        title: row.title?.trim() || 'Badge',
        description: row.description?.trim() || '',
        category: row.category?.trim() || 'Milestones',
        iconData: row.icon_data?.trim() || 'star',
        customImagePath: row.custom_image_path || null,
        iconBgColor: row.icon_bg_color?.trim() || '#FEF3C7',
        iconColor: row.icon_color?.trim() || '#D97706',
        points: Number(row.points ?? 0),
        awardedCount: Number(row.awarded_count ?? 0),
        status: row.status?.trim() || 'Active',
      }));

    const catalogById = new Map(activeCatalog.map((b) => [b.id, b]));
    const awardedRows = (awardedRes.data ?? []) as AwardedBadgeRow[];

    const earned: EarnedBadgeItem[] = awardedRows.map((row) => {
      const catalogMatch = row.badge_id ? catalogById.get(row.badge_id) : undefined;
      return {
        id: row.id,
        badgeId: row.badge_id || row.id,
        title: row.badge_title?.trim() || catalogMatch?.title || 'Badge',
        description: catalogMatch?.description || '',
        category: catalogMatch?.category || 'Achievement',
        iconData: row.badge_icon?.trim() || catalogMatch?.iconData || 'star',
        customImagePath: row.custom_image_path || catalogMatch?.customImagePath || null,
        iconBgColor: row.badge_icon_bg_color?.trim() || catalogMatch?.iconBgColor || '#FEF3C7',
        iconColor: row.badge_icon_color?.trim() || catalogMatch?.iconColor || '#D97706',
        awardedBy: row.awarded_by?.trim() || 'Super Admin',
        awardedAt: row.awarded_at || row.created_at || new Date().toISOString(),
        note: row.note?.trim() || '',
        pointsAwarded: Number(row.points_awarded ?? catalogMatch?.points ?? 0),
      };
    });

    const earnedBadgeIds = new Set(earned.map((item) => item.badgeId));
    const locked = activeCatalog.filter((badge) => !earnedBadgeIds.has(badge.id));

    const result: EmployeeBadgesData = {
      earned,
      locked,
      catalog: activeCatalog,
      totalCatalogCount: activeCatalog.length,
    };

    await setCacheJSON(cacheKey, result);
    return result;
  } catch (error) {
    const cached = await getCacheJSON<EmployeeBadgesData>(cacheKey);
    if (cached) {
      return {
        ...cached,
        catalog: cached.catalog ?? [],
      };
    }
    throw error;
  }
}

export async function loadDepartmentEmployeesForBadgeAward(
  managerEmployeeId: string,
  managerDepartmentName?: string | null,
  options?: { forceRefresh?: boolean },
): Promise<DepartmentBadgeRecipient[]> {
  if (!managerEmployeeId) return [];

  const cacheKey = getRecipientsCacheKey(managerEmployeeId);
  if (!options?.forceRefresh) {
    const cached = await getCacheJSON<DepartmentBadgeRecipient[]>(cacheKey, RECIPIENTS_CACHE_TTL_MS);
    if (cached && cached.length > 0) {
      return cached;
    }
  }

  try {
    // Primary: SECURITY DEFINER RPC that resolves department / cluster / area / approval-route scope
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'manager_badge_award_recipients',
    );

    if (!rpcError && Array.isArray(rpcData)) {
      const recipients = (rpcData as any[])
        .filter((row) => row?.employee_id && row.employee_id !== managerEmployeeId)
        .map((row) => ({
          employeeId: String(row.employee_id),
          employeeNo: row.employee_no ?? null,
          fullName: String(row.full_name || '').trim(),
          departmentName: String(row.department_name || managerDepartmentName || 'General'),
          positionName: row.position_name ?? null,
          photoUrl: row.photo_url ?? null,
        }))
        .filter((emp) => emp.fullName.length > 0)
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

      await setCacheJSON(cacheKey, recipients);
      return recipients;
    }

    // Fallback if RPC is not yet deployed: query employee_assignments directly
    const { data: mgrAssignments } = await supabase
      .from('employee_assignments')
      .select('department_id, cluster_id, area_id, departments(name), positions(name)')
      .eq('employee_id', managerEmployeeId)
      .order('is_primary', { ascending: false })
      .order('effective_from', { ascending: false })
      .limit(5);

    let departmentId: string | null = null;
    let clusterId: string | null = null;
    let areaId: string | null = null;
    let posNameLower = '';
    let resolvedDeptName = managerDepartmentName?.trim() || 'General';

    if (Array.isArray(mgrAssignments) && mgrAssignments.length > 0) {
      const first = mgrAssignments[0] as any;
      departmentId = first?.department_id ?? null;
      clusterId = first?.cluster_id ?? null;
      areaId = first?.area_id ?? null;
      const deptObj = Array.isArray(first?.departments) ? first.departments[0] : first?.departments;
      const posObj = Array.isArray(first?.positions) ? first.positions[0] : first?.positions;
      if (deptObj?.name) resolvedDeptName = deptObj.name;
      if (posObj?.name) posNameLower = String(posObj.name).trim().toLowerCase();
    }

    if (!departmentId && managerDepartmentName?.trim()) {
      const { data: deptRow } = await supabase
        .from('departments')
        .select('id, name')
        .ilike('name', managerDepartmentName.trim())
        .limit(1)
        .maybeSingle<{ id: string; name: string }>();
      if (deptRow?.id) {
        departmentId = deptRow.id;
        resolvedDeptName = deptRow.name || resolvedDeptName;
      }
    }

    const isClusterMgr = posNameLower.includes('cluster') && Boolean(clusterId);
    const isAreaMgr = posNameLower.includes('area') && Boolean(areaId);

    if (!isClusterMgr && !isAreaMgr && !departmentId) {
      return [];
    }

    let query = supabase
      .from('employee_assignments')
      .select(`
        employee_id,
        effective_to,
        departments(name),
        positions(name),
        employees!inner(
          id,
          employee_no,
          first_name,
          middle_name,
          last_name,
          suffix,
          photo_url,
          employment_status
        )
      `)
      .eq('is_primary', true);

    if (isClusterMgr && clusterId) {
      query = query.eq('cluster_id', clusterId);
    } else if (isAreaMgr && areaId) {
      query = query.eq('area_id', areaId);
    } else if (departmentId) {
      query = query.eq('department_id', departmentId);
    }

    const { data: rows, error } = await query;

    if (error) {
      throw new Error(error.message || 'Failed to load department employees.');
    }

    const today = new Date().toISOString().slice(0, 10);
    const byEmployeeId = new Map<string, DepartmentBadgeRecipient>();
    for (const raw of (rows ?? []) as any[]) {
      if (raw.effective_to && String(raw.effective_to) < today) continue;
      const emp = Array.isArray(raw.employees) ? raw.employees[0] : raw.employees;
      if (!emp?.id || emp.id === managerEmployeeId) continue;

      const statusLower = String(emp.employment_status || '').toLowerCase();
      if (
        statusLower.includes('resign') ||
        statusLower.includes('terminat') ||
        statusLower.includes('inactive') ||
        statusLower.includes('separated')
      ) {
        continue;
      }

      const fullName = [emp.first_name, emp.middle_name, emp.last_name, emp.suffix]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!fullName) continue;

      const deptObj = Array.isArray(raw.departments) ? raw.departments[0] : raw.departments;
      const posObj = Array.isArray(raw.positions) ? raw.positions[0] : raw.positions;

      byEmployeeId.set(emp.id, {
        employeeId: emp.id,
        employeeNo: emp.employee_no ?? null,
        fullName,
        departmentName: deptObj?.name || resolvedDeptName,
        positionName: posObj?.name ?? null,
        photoUrl: emp.photo_url ?? null,
      });
    }

    const result = Array.from(byEmployeeId.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName),
    );
    await setCacheJSON(cacheKey, result);
    return result;
  } catch (error) {
    const stale = await getCacheJSON<DepartmentBadgeRecipient[]>(cacheKey);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

export async function submitBadgeAwardRequisition(input: {
  badge: BadgeCatalogItem;
  recipient: DepartmentBadgeRecipient;
  requestedById: string;
  requestedByName: string;
  requestedByRole?: string | null;
  reason: string;
}): Promise<BadgeAwardRequisitionItem> {
  const { badge, recipient, requestedById, requestedByName, requestedByRole, reason } = input;
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error('Please provide a reason for awarding this badge.');
  }

  const payload = {
    badge_id: badge.id,
    badge_title: badge.title,
    badge_icon: badge.iconData || 'star',
    custom_image_path: badge.customImagePath ?? null,
    badge_icon_bg_color: badge.iconBgColor || '#FEF3C7',
    badge_icon_color: badge.iconColor || '#D97706',
    points: badge.points ?? 0,
    employee_id: recipient.employeeId,
    employee_name: recipient.fullName,
    employee_department: recipient.departmentName || 'General',
    employee_avatar_color: '#2563EB',
    employee_photo_url: recipient.photoUrl ?? null,
    requested_by_id: requestedById,
    requested_by_name: requestedByName,
    requested_by_role: requestedByRole ?? null,
    reason: trimmedReason,
    status: 'pending',
  };

  const { data, error } = await supabase
    .from('badge_award_requisitions')
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to submit badge award requisition.');
  }

  const created = mapRequisitionRow(data);

  try {
    const cacheKey = getRequisitionsCacheKey(requestedById);
    const existing = (await getCacheJSON<BadgeAwardRequisitionItem[]>(cacheKey)) ?? [];
    await setCacheJSON(cacheKey, [created, ...existing.filter((r) => r.id !== created.id)].slice(0, 50));
  } catch {
    // ignore cache update error
  }

  return created;
}

export async function loadMyBadgeAwardRequisitions(
  managerEmployeeId: string,
  options?: { forceRefresh?: boolean },
): Promise<BadgeAwardRequisitionItem[]> {
  if (!managerEmployeeId) return [];

  const cacheKey = getRequisitionsCacheKey(managerEmployeeId);
  if (!options?.forceRefresh) {
    const cached = await getCacheJSON<BadgeAwardRequisitionItem[]>(cacheKey, REQUISITIONS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  try {
    const { data, error } = await supabase
      .from('badge_award_requisitions')
      .select('*')
      .eq('requested_by_id', managerEmployeeId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(error.message || 'Failed to load badge award requisitions.');
    }

    const result = (data ?? []).map(mapRequisitionRow);
    await setCacheJSON(cacheKey, result);
    return result;
  } catch (error) {
    const stale = await getCacheJSON<BadgeAwardRequisitionItem[]>(cacheKey);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

function mapRequisitionRow(row: any): BadgeAwardRequisitionItem {
  const rawStatus = String(row?.status || 'pending').toLowerCase();
  const status: 'pending' | 'approved' | 'rejected' =
    rawStatus === 'approved' ? 'approved' : rawStatus === 'rejected' ? 'rejected' : 'pending';

  return {
    id: String(row?.id || ''),
    badgeId: row?.badge_id ?? null,
    badgeTitle: String(row?.badge_title || 'Badge'),
    badgeIcon: String(row?.badge_icon || 'star'),
    customImagePath: row?.custom_image_path ?? null,
    badgeIconBgColor: String(row?.badge_icon_bg_color || '#FEF3C7'),
    badgeIconColor: String(row?.badge_icon_color || '#D97706'),
    points: Number(row?.points ?? 0),
    employeeId: String(row?.employee_id || ''),
    employeeName: String(row?.employee_name || 'Employee'),
    employeeDepartment: String(row?.employee_department || 'General'),
    employeePhotoUrl: row?.employee_photo_url ?? null,
    requestedById: row?.requested_by_id ?? null,
    requestedByName: String(row?.requested_by_name || 'Manager'),
    requestedByRole: row?.requested_by_role ?? null,
    reason: String(row?.reason || ''),
    status,
    reviewNote: row?.review_note ?? null,
    createdAt: String(row?.created_at || new Date().toISOString()),
  };
}
