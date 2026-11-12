// @ts-nocheck
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dkabosehgvldiwtdmvxh.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrYWJvc2VoZ3ZsZGl3dGRtdnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MDUyMTMsImV4cCI6MjA5Mzk4MTIxM30.bWkX7qAPi4iRMZZ2Vf3oYuE2fHW3bBHWJ_8wuibzTUo';

// Configurable secret key (can be customized via Vercel env variable EMPLOYEE_API_SECRET or EMPLOYEE_API_KEY)
const EXPECTED_SECRET =
  process.env.EMPLOYEE_API_SECRET ||
  process.env.EMPLOYEE_API_KEY ||
  'hyg_sec_6b829e1f4d3a';

module.exports = async function handler(req, res) {
  // CORS configuration to allow access from external projects
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, apikey, x-api-key, x-secret-key'
  );
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Verify secret key from query parameter (?key=... or ?api_key=... or ?secret=...) or headers
  const host = req.headers?.host || 'localhost';
  let queryKey = req.query?.key || req.query?.api_key || req.query?.secret || req.query?.token;
  if (!queryKey && req.url) {
    try {
      const parsedUrl = new URL(req.url, `http://${host}`);
      queryKey =
        parsedUrl.searchParams.get('key') ||
        parsedUrl.searchParams.get('api_key') ||
        parsedUrl.searchParams.get('secret') ||
        parsedUrl.searchParams.get('token');
    } catch (_) {}
  }

  const headerAuth = req.headers?.authorization || '';
  const bearerKey = headerAuth.toLowerCase().startsWith('bearer ') ? headerAuth.slice(7).trim() : null;
  const headerKey = req.headers?.['x-api-key'] || req.headers?.['x-secret-key'] || bearerKey;

  const providedKey = queryKey || headerKey;

  if (!providedKey || providedKey !== EXPECTED_SECRET) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Access denied. A valid secret key is required to view this API. Example: ?key=YOUR_SECRET_KEY',
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 1. Try RPC get_store_employee_data first (fastest, security-definer, bypasses table RLS)
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_store_employee_data');
      if (!rpcError && rpcData && Array.isArray(rpcData.employees)) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(rpcData);
      }
    } catch (_) {
      // Proceed to direct query fallback
    }

    // 2. Direct table query fallback (works with SERVICE_ROLE_KEY or authenticated admin)
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
      return res.status(500).json({
        error: queryError.message,
        hint: 'Please ensure migration 0230_get_store_employee_data.sql is executed in your Supabase SQL Editor.',
      });
    }

    const formattedEmployees = (employees || [])
      .filter((emp) => {
        const status = (emp.employment_status || '').toLowerCase().trim();
        return !['resigned', 'terminated', 'banned', 'inactive'].includes(status);
      })
      .map((emp) => {
        const assignments = Array.isArray(emp.employee_assignments) ? emp.employee_assignments : [];
        const primaryAssignment =
          assignments.find((a) => a.is_primary) || assignments[0] || null;

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
          date_hired: primaryAssignment?.effective_from || null,
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
      success: true,
      count: formattedEmployees.length,
      total_items: formattedEmployees.length,
      generated_at: new Date().toISOString(),
      employees: formattedEmployees,
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
};
