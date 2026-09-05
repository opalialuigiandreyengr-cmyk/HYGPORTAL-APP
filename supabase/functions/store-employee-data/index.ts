// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: 'Supabase credentials not configured on server' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Try RPC get_store_employee_data first
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_store_employee_data');

    if (!rpcError && rpcData) {
      return jsonResponse(rpcData);
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
      return jsonResponse({ error: queryError.message }, 500);
    }

    const formattedEmployees = (employees ?? []).map((emp: any) => {
      const primaryAssignment = Array.isArray(emp.employee_assignments)
        ? emp.employee_assignments.find((a: any) => a.is_primary) || emp.employee_assignments[0]
        : null;

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
      count: formattedEmployees.length,
      generated_at: new Date().toISOString(),
      employees: formattedEmployees,
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Internal server error' }, 500);
  }
});
