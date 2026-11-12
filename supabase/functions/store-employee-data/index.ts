// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-secret-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const EXPECTED_SECRET =
  Deno.env.get('EMPLOYEE_API_SECRET') ||
  Deno.env.get('EMPLOYEE_API_KEY') ||
  'hyg_sec_6b829e1f4d3a';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Verify secret key from query parameter (?key=...) or headers
  const url = new URL(request.url);
  const queryKey =
    url.searchParams.get('key') ||
    url.searchParams.get('api_key') ||
    url.searchParams.get('secret') ||
    url.searchParams.get('token');

  const authHeader = request.headers.get('authorization') || '';
  const bearerKey = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const headerKey = request.headers.get('x-api-key') || request.headers.get('x-secret-key') || bearerKey;

  const providedKey = queryKey || headerKey;

  if (!providedKey || providedKey !== EXPECTED_SECRET) {
    return jsonResponse({
      error: 'Unauthorized',
      message: 'Access denied. A valid secret key is required to view this API. Example: ?key=YOUR_SECRET_KEY',
    }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: 'Supabase credentials not configured on server' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Try RPC get_store_employee_data first
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_store_employee_data');
      if (!rpcError && rpcData && Array.isArray(rpcData.employees)) {
        return jsonResponse(rpcData);
      }
    } catch (_) {
      // Proceed to direct query fallback
    }

    // 2. Fallback: Query employees directly if RPC is not yet applied
    const { data: employees, error: queryError } = await supabase
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

    if (queryError) {
      return jsonResponse({
        error: queryError.message,
        hint: 'Please ensure migration 0230_get_store_employee_data.sql is executed in your Supabase SQL Editor.',
      }, 500);
    }

    const formattedEmployees = (employees ?? [])
      .filter((emp: any) => {
        const status = (emp.employment_status || '').toLowerCase().trim();
        return !['resigned', 'terminated', 'banned', 'inactive'].includes(status);
      })
      .map((emp: any) => {
        const assignments = Array.isArray(emp.employee_assignments) ? emp.employee_assignments : [];
        const primaryAssignment =
          assignments.find((a: any) => a.is_primary) || assignments[0] || null;

        const details = Array.isArray(emp.employee_profile_details)
          ? emp.employee_profile_details[0]
          : emp.employee_profile_details;

        const fullName = [emp.first_name, emp.middle_name, emp.last_name, emp.suffix]
          .filter(Boolean)
          .join(' ');

        return {
          id: emp.id,
          employee_no: emp.employee_no || '',
          name: fullName || 'Unnamed',
          first_name: emp.first_name || '',
          middle_name: emp.middle_name || '',
          last_name: emp.last_name || '',
          suffix: emp.suffix || '',
          email: emp.email || '',
          phone: emp.phone || '',
          photo_url: emp.photo_url || '',
          employment_status: emp.employment_status || 'Active',
          birth_date: emp.birth_date || null,
          gender: emp.gender || '',
          civil_status: emp.civil_status || '',
          company_name: primaryAssignment?.companies?.name || '',
          department_name: primaryAssignment?.departments?.name || '',
          position_name: primaryAssignment?.positions?.name || '',
          store_name: primaryAssignment?.stores?.name || '',
          cluster_name: primaryAssignment?.clusters?.name || '',
          area_name: primaryAssignment?.areas?.name || '',
          date_hired: primaryAssignment?.effective_from || null,
          employee_type: details?.employee_type || '',
          payroll_class: details?.payroll_class || '',
          time_schedule: details?.time_schedule || '',
          day_off: details?.day_off || '',
          emergency_contact: details?.emergency_contact || '',
          emergency_contact_no: details?.emergency_contact_no || '',
        };
      });

    return jsonResponse({
      status: 'success',
      success: true,
      count: formattedEmployees.length,
      total_items: formattedEmployees.length,
      generated_at: new Date().toISOString(),
      employees: formattedEmployees,
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Internal server error' }, 500);
  }
});
