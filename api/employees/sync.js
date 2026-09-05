// @ts-nocheck
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dkabosehgvldiwtdmvxh.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrYWJvc2VoZ3ZsZGl3dGRtdnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MDUyMTMsImV4cCI6MjA5Mzk4MTIxM30.bWkX7qAPi4iRMZZ2Vf3oYuE2fHW3bBHWJ_8wuibzTUo';

module.exports = async function handler(req, res) {
  // Enable CORS so external systems, browsers, and mobile/desktop clients can access it
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Try RPC get_store_employee_data first if migration was run
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_store_employee_data');
      if (!rpcError && rpcData) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(rpcData);
      }
    } catch (_) {
      // Proceed to direct query fallback
    }

    // 2. Direct table query fallback
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
      return res.status(500).json({ error: queryError.message });
    }

    const formattedEmployees = (employees || []).map((emp) => {
      const primaryAssignment = Array.isArray(emp.employee_assignments)
        ? emp.employee_assignments.find((a) => a.is_primary) || emp.employee_assignments[0]
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
        name: fullName || 'Unnamed Employee',
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

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      status: 'success',
      count: formattedEmployees.length,
      generated_at: new Date().toISOString(),
      employees: formattedEmployees,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
