import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { env } from '../lib/env';

export type StoreEmployee = {
  id: string;
  employee_no: string;
  name: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  suffix?: string;
  email?: string;
  phone?: string;
  photo_url?: string;
  employment_status: string;
  birth_date?: string | null;
  gender?: string;
  civil_status?: string;
  company_name?: string;
  department_name?: string;
  position_name?: string;
  store_name?: string;
  cluster_name?: string;
  area_name?: string;
  employee_type?: string;
  payroll_class?: string;
  time_schedule?: string;
  day_off?: string;
  emergency_contact?: string;
  emergency_contact_no?: string;
};

export type StoreEmployeeDataPayload = {
  status: string;
  count: number;
  generated_at: string;
  employees: StoreEmployee[];
};

export const defaultEmployeeDataUrl = 'https://hygportal.vercel.app/employees/sync';
export const configuredEmployeeDataUrl = env.employeeDataUrl || defaultEmployeeDataUrl;
export const employeeDataUrl =
  Platform.OS === 'web' && configuredEmployeeDataUrl === defaultEmployeeDataUrl
    ? '/api/employees/store_employee_data'
    : configuredEmployeeDataUrl;

export const employeeCacheKey = 'store_employees_v1';

function fetchWithTimeout(url: string, timeoutMs = 12000, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}

/**
 * Parses and sanitizes raw JSON payload into normalized StoreEmployee items.
 * Accepts { employees: [...] }, { data: [...] }, or raw Array [...].
 */
export function parseStoreEmployees(payload: unknown): StoreEmployee[] {
  if (!payload) return [];

  const raw = payload as {
    employees?: unknown;
    data?: unknown;
  };

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(raw.employees)
      ? raw.employees
      : Array.isArray(raw.data)
        ? raw.data
        : [];

  const seen = new Set<string>();

  return rows
    .map((item) => {
      const row = item as Record<string, unknown>;
      const id = String(row.id || '').trim();
      const employeeNo = String(row.employee_no || row.employeeNo || '').trim();
      const firstName = String(row.first_name || row.firstName || '').trim();
      const middleName = String(row.middle_name || row.middleName || '').trim();
      const lastName = String(row.last_name || row.lastName || '').trim();
      const suffix = String(row.suffix || '').trim();

      const calculatedName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ');
      const name = String(row.name || row.full_name || calculatedName).trim();

      if (!id && !employeeNo && !name) {
        return null;
      }

      // Deduplicate by employee_no or id if available
      const dedupeKey = (employeeNo || id || name).toLowerCase();
      if (seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);

      return {
        id: id || dedupeKey,
        employee_no: employeeNo,
        name: name || 'Unnamed Employee',
        first_name: firstName,
        middle_name: middleName || undefined,
        last_name: lastName,
        suffix: suffix || undefined,
        email: typeof row.email === 'string' ? row.email.trim() : undefined,
        phone: typeof row.phone === 'string' ? row.phone.trim() : undefined,
        photo_url: typeof row.photo_url === 'string' ? row.photo_url.trim() : typeof row.photoUrl === 'string' ? row.photoUrl.trim() : undefined,
        employment_status: typeof row.employment_status === 'string' ? row.employment_status.trim() : 'Active',
        birth_date: typeof row.birth_date === 'string' ? row.birth_date : null,
        gender: typeof row.gender === 'string' ? row.gender : undefined,
        civil_status: typeof row.civil_status === 'string' ? row.civil_status : undefined,
        company_name: typeof row.company_name === 'string' ? row.company_name : typeof row.company === 'string' ? row.company : undefined,
        department_name: typeof row.department_name === 'string' ? row.department_name : typeof row.department === 'string' ? row.department : undefined,
        position_name: typeof row.position_name === 'string' ? row.position_name : typeof row.position === 'string' ? row.position : undefined,
        store_name: typeof row.store_name === 'string' ? row.store_name : typeof row.store === 'string' ? row.store : undefined,
        cluster_name: typeof row.cluster_name === 'string' ? row.cluster_name : undefined,
        area_name: typeof row.area_name === 'string' ? row.area_name : undefined,
        employee_type: typeof row.employee_type === 'string' ? row.employee_type : undefined,
        payroll_class: typeof row.payroll_class === 'string' ? row.payroll_class : undefined,
        time_schedule: typeof row.time_schedule === 'string' ? row.time_schedule : undefined,
        day_off: typeof row.day_off === 'string' ? row.day_off : undefined,
        emergency_contact: typeof row.emergency_contact === 'string' ? row.emergency_contact : undefined,
        emergency_contact_no: typeof row.emergency_contact_no === 'string' ? row.emergency_contact_no : undefined,
      } as StoreEmployee;
    })
    .filter((item): item is StoreEmployee => Boolean(item));
}

/**
 * Direct Supabase query fallback in case the Edge Function or RPC is unreachable.
 */
export async function fetchEmployeesDirectFromSupabase(): Promise<StoreEmployeeDataPayload> {
  // 1. Attempt RPC first
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_store_employee_data');
    if (!rpcErr && rpcData) {
      const parsed = parseStoreEmployees(rpcData);
      return {
        status: 'success',
        count: parsed.length,
        generated_at: (rpcData as { generated_at?: string })?.generated_at || new Date().toISOString(),
        employees: parsed,
      };
    }
  } catch (_) {
    // Continue to direct query fallback
  }

  // 2. Direct table select fallback
  const { data, error } = await supabase
    .from('employees')
    .select(`
      id,
      employee_no,
      first_name,
      middle_name,
      last_name,
      suffix,
      email,
      phone,
      photo_url,
      employment_status,
      birth_date,
      gender,
      civil_status,
      employee_assignments (
        is_primary,
        effective_from,
        effective_to,
        companies (name),
        departments (name),
        positions (name),
        stores (name),
        clusters (name),
        areas (name)
      ),
      employee_profile_details (
        employee_type,
        payroll_class,
        time_schedule,
        day_off,
        emergency_contact,
        emergency_contact_no
      )
    `)
    .order('last_name', { ascending: true });

  if (error) {
    throw error;
  }

  const employees = (data ?? []).map((emp: any) => {
    const assignments = Array.isArray(emp.employee_assignments) ? emp.employee_assignments : [];
    const primaryAssignment = assignments.find((a: any) => a.is_primary) || assignments[0] || null;
    const details = Array.isArray(emp.employee_profile_details) ? emp.employee_profile_details[0] : emp.employee_profile_details;

    const fullName = [emp.first_name, emp.middle_name, emp.last_name, emp.suffix].filter(Boolean).join(' ');

    return {
      id: emp.id,
      employee_no: emp.employee_no || '',
      name: fullName || 'Unnamed Employee',
      first_name: emp.first_name || '',
      middle_name: emp.middle_name || undefined,
      last_name: emp.last_name || '',
      suffix: emp.suffix || undefined,
      email: emp.email || undefined,
      phone: emp.phone || undefined,
      photo_url: emp.photo_url || undefined,
      employment_status: emp.employment_status || 'Active',
      birth_date: emp.birth_date || null,
      gender: emp.gender || undefined,
      civil_status: emp.civil_status || undefined,
      company_name: primaryAssignment?.companies?.name || undefined,
      department_name: primaryAssignment?.departments?.name || undefined,
      position_name: primaryAssignment?.positions?.name || undefined,
      store_name: primaryAssignment?.stores?.name || undefined,
      cluster_name: primaryAssignment?.clusters?.name || undefined,
      area_name: primaryAssignment?.areas?.name || undefined,
      employee_type: details?.employee_type || undefined,
      payroll_class: details?.payroll_class || undefined,
      time_schedule: details?.time_schedule || undefined,
      day_off: details?.day_off || undefined,
      emergency_contact: details?.emergency_contact || undefined,
      emergency_contact_no: details?.emergency_contact_no || undefined,
    } as StoreEmployee;
  });

  return {
    status: 'success',
    count: employees.length,
    generated_at: new Date().toISOString(),
    employees,
  };
}

/**
 * Loads employee data using the cache-then-network pattern, identical to store inventory products.
 */
export async function loadStoreEmployeeData(options?: {
  forceRefresh?: boolean;
}): Promise<{ employees: StoreEmployee[]; fromCache: boolean; error?: string }> {
  let cachedEmployees: StoreEmployee[] = [];

  // Step 1: Read local cache first for instant response
  if (!options?.forceRefresh) {
    try {
      const cached = await getCacheJSON<StoreEmployee[]>(employeeCacheKey);
      if (cached && cached.length > 0) {
        cachedEmployees = cached;
      }
    } catch (_) {}
  }

  // If we have cache and no forced refresh, return cache immediately while background updating
  if (cachedEmployees.length > 0 && !options?.forceRefresh) {
    // Background refresh
    refreshAndCacheEmployees().catch(() => undefined);
    return { employees: cachedEmployees, fromCache: true };
  }

  // Step 2: Fetch fresh data from network / Supabase
  try {
    const result = await refreshAndCacheEmployees();
    return { employees: result, fromCache: false };
  } catch (err: any) {
    if (cachedEmployees.length > 0) {
      return { employees: cachedEmployees, fromCache: true, error: err.message };
    }
    throw err;
  }
}

async function refreshAndCacheEmployees(): Promise<StoreEmployee[]> {
  let freshEmployees: StoreEmployee[] = [];

  // 1. Attempt fetching via the configured HTTP endpoint (Edge Function or Vercel rewrite)
  try {
    const res = await fetchWithTimeout(employeeDataUrl, 8000);
    if (res.ok) {
      const payload = await res.json();
      freshEmployees = parseStoreEmployees(payload);
    }
  } catch (_) {
    // Fall back to direct Supabase query if HTTP endpoint isn't deployed yet
  }

  // 2. If HTTP failed or returned 0, query Supabase client directly
  if (freshEmployees.length === 0) {
    const payload = await fetchEmployeesDirectFromSupabase();
    freshEmployees = payload.employees;
  }

  // 3. Save to local cache
  if (freshEmployees.length > 0) {
    await setCacheJSON(employeeCacheKey, freshEmployees);
  }

  return freshEmployees;
}

/**
 * Transmits / POSTs employee JSON to an external system's endpoint (or custom target URL).
 */
export async function transmitEmployeeData(
  targetUrl: string,
  customEmployees?: StoreEmployee[],
): Promise<{ success: boolean; status: number; message: string; responseData?: unknown }> {
  if (!targetUrl || !targetUrl.trim()) {
    throw new Error('Target transmission URL is required.');
  }

  const employees = customEmployees || (await loadStoreEmployeeData()).employees;

  const payload: StoreEmployeeDataPayload = {
    status: 'success',
    count: employees.length,
    generated_at: new Date().toISOString(),
    employees,
  };

  const response = await fetchWithTimeout(targetUrl.trim(), 15000, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  let responseData: unknown = null;
  try {
    responseData = await response.json();
  } catch (_) {
    responseData = null;
  }

  if (!response.ok) {
    throw new Error(`Target system returned HTTP ${response.status}.`);
  }

  return {
    success: true,
    status: response.status,
    message: `Successfully transmitted ${employees.length} employee record(s).`,
    responseData,
  };
}

/**
 * Returns formatted employee JSON string ready to export, send, or save.
 */
export async function getStoreEmployeeDataJSON(pretty = false): Promise<string> {
  const { employees } = await loadStoreEmployeeData();
  const payload: StoreEmployeeDataPayload = {
    status: 'success',
    count: employees.length,
    generated_at: new Date().toISOString(),
    employees,
  };

  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}
