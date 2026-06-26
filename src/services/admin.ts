import { supabase } from '../lib/supabase';

export type AuthorityCandidate = {
  employee_id: string;
  employee_no: string | null;
  full_name: string;
  position_id: string;
  position_name: string;
  position_level: number;
  function_id: string;
  function_name: string;
  company_id: string;
  company_name: string;
  department_id: string | null;
  department_name: string | null;
  current_authority_level: number | null;
};

export type PositionAuthorityLevel = {
  position_id: string;
  position_name: string;
  authority_level: number | null;
  employee_count: number;
};

export type DepartmentPositionCatalogRow = {
  department_id: string;
  department_name: string;
  position_id: string | null;
  position_name: string | null;
  authority_level: number | null;
  employee_count: number;
};

export type AdminPositionCatalogRow = {
  position_id: string;
  position_name: string;
  employee_count: number;
};

export type DepartmentApprovalLadderRow = {
  department_id: string;
  department_name: string;
  route_levels: number[];
  route_roles?: Record<string, { position_id: string; position_name: string }>;
  route_approvers?: Record<string, string[]>;
};

export type AdminClusterRow = {
  cluster_id: string;
  cluster_name: string;
  company_id: string;
  company_name: string;
  area_id: string | null;
  area_name: string | null;
  store_count: number;
  is_active: boolean;
};

export type AdminStoreClusterRow = {
  store_id: string;
  store_name: string;
  company_id: string;
  company_name: string;
  cluster_id: string | null;
  cluster_name: string | null;
  area_id: string | null;
  area_name: string | null;
};

function messageFromError(error: { message?: string; details?: string | null; hint?: string | null }) {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ');
}

export async function loadAuthorityCandidates() {
  const { data, error } = await supabase.rpc('admin_authority_candidates');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as AuthorityCandidate[];
}

export async function setAuthorityAssignment(employeeId: string, functionId: string, authorityLevel: number) {
  const { data, error } = await supabase.rpc('admin_set_authority_assignment', {
    p_employee_id: employeeId,
    p_function_id: functionId,
    p_authority_level: authorityLevel,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function loadPositionAuthorityLevels() {
  const { data, error } = await supabase.rpc('admin_position_authority_levels');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as PositionAuthorityLevel[];
}

export async function setPositionAuthorityLevel(positionId: string, authorityLevel: number) {
  const { data, error } = await supabase.rpc('admin_set_position_authority_level', {
    p_position_id: positionId,
    p_authority_level: authorityLevel,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function clearPositionAuthorityLevel(positionId: string) {
  const { data, error } = await supabase.rpc('admin_clear_position_authority_level', {
    p_position_id: positionId,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function loadDepartmentPositionCatalog() {
  const { data, error } = await supabase.rpc('admin_department_position_catalog');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as DepartmentPositionCatalogRow[];
}

export async function loadAdminPositionCatalog() {
  const { data, error } = await supabase.rpc('admin_position_catalog');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as AdminPositionCatalogRow[];
}

export async function createAdminDepartment(name: string) {
  const { data, error } = await supabase.rpc('admin_create_department', {
    p_name: name,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function createAdminPosition(name: string) {
  const { data, error } = await supabase.rpc('admin_create_position', {
    p_name: name,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function assignDepartmentPosition(departmentId: string, positionId: string) {
  const { data, error } = await supabase.rpc('admin_assign_department_position', {
    p_department_id: departmentId,
    p_position_id: positionId,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function removeDepartmentPosition(departmentId: string, positionId: string) {
  const { data, error } = await supabase.rpc('admin_remove_department_position', {
    p_department_id: departmentId,
    p_position_id: positionId,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function loadDepartmentApprovalLadders() {
  const { data, error } = await supabase.rpc('admin_department_approval_ladders');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as DepartmentApprovalLadderRow[];
}

export async function setDepartmentApprovalLadder(
  departmentId: string,
  levels: number[],
  roles: Record<number, string> = {},
) {
  const { data, error } = await supabase.rpc('admin_set_department_approval_ladder', {
    p_department_id: departmentId,
    p_levels: levels,
    p_roles: Object.fromEntries(Object.entries(roles).map(([level, positionId]) => [level, positionId])),
  });

  if (error?.code === 'PGRST202' && !Object.keys(roles).length) {
    const fallback = await supabase.rpc('admin_set_department_approval_ladder', {
      p_department_id: departmentId,
      p_levels: levels,
    });

    if (fallback.error) {
      throw new Error(messageFromError(fallback.error));
    }

    return fallback.data as string;
  }

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function loadAdminClusters() {
  const { data, error } = await supabase.rpc('admin_cluster_directory');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as AdminClusterRow[];
}

export async function loadAdminStoreClusterCatalog() {
  const { data, error } = await supabase.rpc('admin_store_cluster_catalog');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as AdminStoreClusterRow[];
}

export async function createAdminCluster(companyName: string, name: string) {
  const { data, error } = await supabase.rpc('admin_create_cluster', {
    p_company_name: companyName,
    p_name: name,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function assignStoreCluster(storeId: string, clusterId: string | null) {
  const { data, error } = await supabase.rpc('admin_assign_store_cluster', {
    p_store_id: storeId,
    p_cluster_id: clusterId,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}

export async function setEmployeeClusterScope(employeeId: string, clusterId: string) {
  const { data, error } = await supabase.rpc('admin_set_employee_cluster_scope', {
    p_employee_id: employeeId,
    p_cluster_id: clusterId,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return data as string;
}
