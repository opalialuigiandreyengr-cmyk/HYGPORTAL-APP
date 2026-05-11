import { supabase } from '../lib/supabase';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type UserProfileRow = {
  id: string;
  app_role: string;
  employee_id: string | null;
};

type EmployeeRow = {
  id: string;
  employee_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  email: string | null;
  employment_status: string;
};

type AssignmentRow = {
  company_id: string;
  area_id: string | null;
  cluster_id: string | null;
  store_id: string | null;
  position_id: string;
  function_id: string;
};

type NameRow = {
  name: string;
};

type PositionRow = {
  name: string;
  authority_level: number;
};

function fullName(employee: EmployeeRow) {
  return [
    employee.first_name,
    employee.middle_name,
    employee.last_name,
    employee.suffix,
  ]
    .filter(Boolean)
    .join(' ');
}

function isMissingSchemaMessage(message: string) {
  return (
    message.includes('relation') ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

async function getName(table: string, id?: string | null) {
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from(table)
    .select('name')
    .eq('id', id)
    .maybeSingle<NameRow>();

  if (error) {
    throw error;
  }

  return data?.name ?? null;
}

export async function loadEmployeeProfile(authUserId: string): Promise<ProfileLoadResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profileResponse = await supabase
    .from('user_profiles')
    .select('id, app_role, employee_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle<UserProfileRow>();

  if (profileResponse.error) {
    if (isMissingSchemaMessage(profileResponse.error.message)) {
      return {
        status: 'schema_missing',
        message: 'Supabase tables are not created yet. Run the initial schema migration first.',
      };
    }

    return {
      status: 'error',
      message: profileResponse.error.message,
      debug: `authUserId=${authUserId}`,
    };
  }

  let userProfile = profileResponse.data;
  let fallbackDebug = `authUserId=${authUserId}; profileByAuth=${userProfile ? 'found' : 'not found'}`;

  if (!userProfile && user?.email) {
    fallbackDebug += `; authEmail=${user.email}`;
    const employeeByEmailResponse = await supabase
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .maybeSingle<{ id: string }>();

    if (employeeByEmailResponse.error) {
      return {
        status: 'error',
        message: employeeByEmailResponse.error.message,
        debug: fallbackDebug,
      };
    }

    fallbackDebug += `; employeeByEmail=${employeeByEmailResponse.data?.id ?? 'not found'}`;

    if (employeeByEmailResponse.data?.id) {
      const upsertResponse = await supabase
        .from('user_profiles')
        .upsert(
          {
            auth_user_id: authUserId,
            employee_id: employeeByEmailResponse.data.id,
            app_role: 'employee',
          },
          { onConflict: 'auth_user_id' },
        )
        .select('id, app_role, employee_id')
        .maybeSingle<UserProfileRow>();

      if (upsertResponse.error) {
        return {
          status: 'error',
          message: upsertResponse.error.message,
          debug: fallbackDebug,
        };
      }

      userProfile = upsertResponse.data;
      fallbackDebug += `; upsertProfile=${userProfile ? 'ok' : 'empty'}`;
    }
  } else if (!userProfile) {
    fallbackDebug += '; authEmail=not available';
  }

  if (!userProfile || !userProfile.employee_id) {
    return {
      status: 'not_linked',
      message: 'This login exists, but it is not linked to an employee record yet.',
      debug: fallbackDebug,
    };
  }

  const employeeResponse = await supabase
    .from('employees')
    .select('id, employee_no, first_name, middle_name, last_name, suffix, email, employment_status')
    .eq('id', userProfile.employee_id)
    .maybeSingle<EmployeeRow>();

  if (employeeResponse.error) {
    return {
      status: 'error',
      message: employeeResponse.error.message,
    };
  }

  if (!employeeResponse.data) {
    return {
      status: 'not_linked',
      message: 'The linked employee record was not found.',
    };
  }

  const employee = employeeResponse.data;
  const assignmentResponse = await supabase
    .from('employee_assignments')
    .select('company_id, area_id, cluster_id, store_id, position_id, function_id')
    .eq('employee_id', employee.id)
    .eq('is_primary', true)
    .is('effective_to', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<AssignmentRow>();

  if (assignmentResponse.error) {
    return {
      status: 'error',
      message: assignmentResponse.error.message,
    };
  }

  let assignmentDetails: Partial<EmployeeProfileSummary> = {};

  if (assignmentResponse.data) {
    const assignment = assignmentResponse.data;
    const positionResponse = await supabase
      .from('positions')
      .select('name, authority_level')
      .eq('id', assignment.position_id)
      .maybeSingle<PositionRow>();

    if (positionResponse.error) {
      return {
        status: 'error',
        message: positionResponse.error.message,
      };
    }

    assignmentDetails = {
      companyName: await getName('companies', assignment.company_id),
      areaName: await getName('areas', assignment.area_id),
      clusterName: await getName('clusters', assignment.cluster_id),
      storeName: await getName('stores', assignment.store_id),
      functionName: await getName('functions', assignment.function_id),
      positionName: positionResponse.data?.name ?? null,
      authorityLevel: (positionResponse.data?.authority_level ?? null) as EmployeeProfileSummary['authorityLevel'],
    };
  }

  return {
    status: 'linked',
    profile: {
      profileId: userProfile.id,
      appRole: userProfile.app_role,
      employeeId: employee.id,
      fullName: fullName(employee),
      employeeNo: employee.employee_no,
      email: employee.email,
      employmentStatus: employee.employment_status,
      ...assignmentDetails,
    },
  };
}
