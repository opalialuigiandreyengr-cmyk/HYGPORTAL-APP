import { supabase } from '../lib/supabase';
import type { EmployeeProfileSummary, ProfileLoadResult } from '../types/domain';

type UserProfileRow = {
  id: string;
  app_role: string;
  employee_id: string | null;
  username: string | null;
};

type EmployeeRow = {
  id: string;
  employee_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  birth_date: string | null;
  gender: string | null;
  civil_status: string | null;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  employment_status: string;
};

type AssignmentRow = {
  company_id: string;
  area_id: string | null;
  cluster_id: string | null;
  store_id: string | null;
  department_id: string | null;
  position_id: string;
  function_id: string;
  effective_from: string;
};

type ProfileDetailRow = {
  employee_type: string | null;
  payroll_class?: string | null;
  time_schedule?: string | null;
  day_off?: string | null;
  tin: string | null;
  sss: string | null;
  pagibig: string | null;
  philhealth: string | null;
  bank_type: string | null;
  account_no: string | null;
  education: string | null;
  present_address: string | null;
  emergency_contact: string | null;
  emergency_contact_no?: string | null;
  religion?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  height?: string | null;
  weight?: string | null;
  other_phone?: string | null;
  social_media_type?: string | null;
  social_media_detail?: string | null;
  zip_code?: string | null;
  permanent_address?: string | null;
  elementary_school?: string | null;
  elementary_year?: string | null;
  secondary_school?: string | null;
  secondary_year?: string | null;
  college_school?: string | null;
  college_year?: string | null;
  college_course?: string | null;
  year_graduated?: string | null;
  father_name?: string | null;
  father_occupation?: string | null;
  mother_maiden_name?: string | null;
  mother_occupation?: string | null;
  number_of_siblings?: string | null;
  birth_order?: string | null;
  spouse_name?: string | null;
  spouse_occupation?: string | null;
  spouse_contact?: string | null;
  children_names?: string | null;
  children_count?: string | null;
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
    message.includes('column') ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

async function loadProfileDetails(employeeId: string) {
  const fullSelect = `
    employee_type,
    payroll_class,
    time_schedule,
    day_off,
    tin,
    sss,
    pagibig,
    philhealth,
    bank_type,
    account_no,
    education,
    present_address,
    emergency_contact,
    emergency_contact_no,
    religion,
    birth_place,
    nationality,
    height,
    weight,
    other_phone,
    social_media_type,
    social_media_detail,
    zip_code,
    permanent_address,
    elementary_school,
    elementary_year,
    secondary_school,
    secondary_year,
    college_school,
    college_year,
    college_course,
    year_graduated,
    father_name,
    father_occupation,
    mother_maiden_name,
    mother_occupation,
    number_of_siblings,
    birth_order,
    spouse_name,
    spouse_occupation,
    spouse_contact,
    children_names,
    children_count
  `;

  const fullResponse = await supabase
    .from('employee_profile_details')
    .select(fullSelect)
    .eq('employee_id', employeeId)
    .maybeSingle<ProfileDetailRow>();

  if (!fullResponse.error) {
    return fullResponse;
  }

  if (!isMissingSchemaMessage(fullResponse.error.message)) {
    return fullResponse;
  }

  return supabase
    .from('employee_profile_details')
    .select('employee_type, payroll_class, time_schedule, day_off, tin, sss, pagibig, philhealth, bank_type, account_no, education, present_address, emergency_contact')
    .eq('employee_id', employeeId)
    .maybeSingle<ProfileDetailRow>();
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

  await supabase.rpc('ensure_own_employee_profile_link');

  const profileResponse = await supabase
    .from('user_profiles')
    .select('id, app_role, employee_id, username')
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
    .select('id, employee_no, first_name, middle_name, last_name, suffix, birth_date, gender, civil_status, email, phone, photo_url, employment_status')
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
  const today = new Date().toISOString().slice(0, 10);
  const assignmentResponse = await supabase
    .from('employee_assignments')
    .select('company_id, area_id, cluster_id, store_id, department_id, position_id, function_id, effective_from')
    .eq('employee_id', employee.id)
    .eq('is_primary', true)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
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
      departmentName: await getName('departments', assignment.department_id),
      functionName: await getName('functions', assignment.function_id),
      positionName: positionResponse.data?.name ?? null,
      dateHired: assignment.effective_from,
      authorityLevel: (positionResponse.data?.authority_level ?? null) as EmployeeProfileSummary['authorityLevel'],
    };
  }

  const detailsResponse = await loadProfileDetails(employee.id);

  if (detailsResponse.error) {
    return {
      status: 'error',
      message: detailsResponse.error.message,
    };
  }

  const profileDetails: Partial<EmployeeProfileSummary> = detailsResponse.data
    ? {
        employeeType: detailsResponse.data.employee_type,
        payrollClass: detailsResponse.data.payroll_class,
        timeSchedule: detailsResponse.data.time_schedule,
        dayOff: detailsResponse.data.day_off,
        tin: detailsResponse.data.tin,
        sss: detailsResponse.data.sss,
        pagibig: detailsResponse.data.pagibig,
        philhealth: detailsResponse.data.philhealth,
        bankType: detailsResponse.data.bank_type,
        accountNo: detailsResponse.data.account_no,
        education: detailsResponse.data.education,
        presentAddress: detailsResponse.data.present_address,
        emergencyContact: detailsResponse.data.emergency_contact,
        emergencyContactNo: detailsResponse.data.emergency_contact_no,
        religion: detailsResponse.data.religion,
        birthPlace: detailsResponse.data.birth_place,
        nationality: detailsResponse.data.nationality,
        height: detailsResponse.data.height,
        weight: detailsResponse.data.weight,
        otherPhone: detailsResponse.data.other_phone,
        socialMediaType: detailsResponse.data.social_media_type,
        socialMediaDetail: detailsResponse.data.social_media_detail,
        zipCode: detailsResponse.data.zip_code,
        permanentAddress: detailsResponse.data.permanent_address,
        elementarySchool: detailsResponse.data.elementary_school,
        elementaryYear: detailsResponse.data.elementary_year,
        secondarySchool: detailsResponse.data.secondary_school,
        secondaryYear: detailsResponse.data.secondary_year,
        collegeSchool: detailsResponse.data.college_school,
        collegeYear: detailsResponse.data.college_year,
        collegeCourse: detailsResponse.data.college_course,
        yearGraduated: detailsResponse.data.year_graduated,
        fatherName: detailsResponse.data.father_name,
        fatherOccupation: detailsResponse.data.father_occupation,
        motherMaidenName: detailsResponse.data.mother_maiden_name,
        motherOccupation: detailsResponse.data.mother_occupation,
        numberOfSiblings: detailsResponse.data.number_of_siblings,
        birthOrder: detailsResponse.data.birth_order,
        spouseName: detailsResponse.data.spouse_name,
        spouseOccupation: detailsResponse.data.spouse_occupation,
        spouseContact: detailsResponse.data.spouse_contact,
        childrenNames: detailsResponse.data.children_names,
        childrenCount: detailsResponse.data.children_count,
      }
    : {};

  return {
    status: 'linked',
    profile: {
      profileId: userProfile.id,
      appRole: userProfile.app_role,
      employeeId: employee.id,
      fullName: fullName(employee),
      firstName: employee.first_name,
      middleName: employee.middle_name,
      lastName: employee.last_name,
      suffix: employee.suffix,
      username: userProfile.username,
      employeeNo: employee.employee_no,
      email: employee.email,
      photoUrl: employee.photo_url,
      birthDate: employee.birth_date,
      gender: employee.gender,
      civilStatus: employee.civil_status,
      cellphone: employee.phone,
      employmentStatus: employee.employment_status,
      ...assignmentDetails,
      ...profileDetails,
    },
  };
}

export type UpdateEmployeeProfileInput = {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  birthDate: string;
  gender: string;
  civilStatus: string;
  cellphone: string;
  email: string;
  username: string;
  company: string;
  employeeType: string;
  tin: string;
  sss: string;
  pagibig: string;
  philhealth: string;
  bankType: string;
  accountNo: string;
  education: string;
  presentAddress: string;
  emergencyContact: string;
  emergencyContactNo: string;
  religion: string;
  birthPlace: string;
  nationality: string;
  height: string;
  weight: string;
  otherPhone: string;
  socialMediaType: string;
  socialMediaDetail: string;
  zipCode: string;
  permanentAddress: string;
  elementarySchool: string;
  elementaryYear: string;
  secondarySchool: string;
  secondaryYear: string;
  collegeSchool: string;
  collegeYear: string;
  collegeCourse: string;
  yearGraduated: string;
  fatherName: string;
  fatherOccupation: string;
  motherMaidenName: string;
  motherOccupation: string;
  numberOfSiblings: string;
  birthOrder: string;
  spouseName: string;
  spouseOccupation: string;
  spouseContact: string;
  childrenNames: string;
  childrenCount: string;
};

function optionalDate(value: string) {
  return value.trim() || null;
}

function errorMessage(error: { message?: string; details?: string | null; hint?: string | null }) {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ');
}

function isMissingFunctionMessage(message: string) {
  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes('could not find the function') || lowerMessage.includes('schema cache');
}

function isMissingStorageBucketMessage(message: string) {
  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes('bucket not found') || lowerMessage.includes('storage bucket not found');
}

export async function updateEmployeeProfile(input: UpdateEmployeeProfileInput) {
  const profilePayload: UpdateEmployeeProfileInput = {
    ...input,
    firstName: input.firstName.trim(),
    middleName: input.middleName.trim(),
    lastName: input.lastName.trim(),
    suffix: input.suffix.trim(),
    birthDate: optionalDate(input.birthDate) ?? '',
    gender: input.gender.trim(),
    civilStatus: input.civilStatus.trim(),
    cellphone: input.cellphone.trim(),
    email: input.email.trim(),
    username: input.username.trim(),
    company: input.company.trim(),
    employeeType: input.employeeType.trim(),
    tin: input.tin.trim(),
    sss: input.sss.trim(),
    pagibig: input.pagibig.trim(),
    philhealth: input.philhealth.trim(),
    bankType: input.bankType.trim(),
    accountNo: input.accountNo.trim(),
    education: input.education.trim(),
    presentAddress: input.presentAddress.trim(),
    emergencyContact: input.emergencyContact.trim(),
    emergencyContactNo: input.emergencyContactNo.trim(),
    religion: input.religion.trim(),
    birthPlace: input.birthPlace.trim(),
    nationality: input.nationality.trim(),
    height: input.height.trim(),
    weight: input.weight.trim(),
    otherPhone: input.otherPhone.trim(),
    socialMediaType: input.socialMediaType.trim(),
    socialMediaDetail: input.socialMediaDetail.trim(),
    zipCode: input.zipCode.trim(),
    permanentAddress: input.permanentAddress.trim(),
    elementarySchool: input.elementarySchool.trim(),
    elementaryYear: input.elementaryYear.trim(),
    secondarySchool: input.secondarySchool.trim(),
    secondaryYear: input.secondaryYear.trim(),
    collegeSchool: input.collegeSchool.trim(),
    collegeYear: input.collegeYear.trim(),
    collegeCourse: input.collegeCourse.trim(),
    yearGraduated: input.yearGraduated.trim(),
    fatherName: input.fatherName.trim(),
    fatherOccupation: input.fatherOccupation.trim(),
    motherMaidenName: input.motherMaidenName.trim(),
    motherOccupation: input.motherOccupation.trim(),
    numberOfSiblings: input.numberOfSiblings.trim(),
    birthOrder: input.birthOrder.trim(),
    spouseName: input.spouseName.trim(),
    spouseOccupation: input.spouseOccupation.trim(),
    spouseContact: input.spouseContact.trim(),
    childrenNames: input.childrenNames.trim(),
    childrenCount: input.childrenCount.trim(),
  };

  const { data, error } = await supabase.rpc('update_own_employee_profile_v2', {
    p_profile: profilePayload,
  });

  if (error) {
    if (isMissingFunctionMessage(errorMessage(error))) {
      throw new Error('Supabase profile update function is not installed yet. Run migrations 0027 and 0029, then refresh the Supabase schema cache.');
    }

    throw new Error(errorMessage(error));
  }

  return data as string;
}

function base64ToArrayBuffer(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleanBase64 = base64.replace(/=+$/, '').replace(/\s/g, '');
  const bytes = new Uint8Array(Math.floor((cleanBase64.length * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let index = 0; index < cleanBase64.length; index += 1) {
    const value = chars.indexOf(cleanBase64[index]);
    if (value === -1) {
      continue;
    }

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 0xff;
      byteIndex += 1;
    }
  }

  return bytes.slice(0, byteIndex).buffer;
}

function profilePhotoExtension(contentType: string, uri?: string | null) {
  if (contentType.includes('png')) {
    return 'png';
  }

  if (contentType.includes('webp')) {
    return 'webp';
  }

  const uriExtension = uri?.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (uriExtension === 'png' || uriExtension === 'webp' || uriExtension === 'jpg' || uriExtension === 'jpeg') {
    return uriExtension === 'jpeg' ? 'jpg' : uriExtension;
  }

  return 'jpg';
}

export async function uploadEmployeeProfilePhoto({
  employeeId,
  base64,
  mimeType,
  uri,
}: {
  employeeId: string;
  base64: string;
  mimeType?: string | null;
  uri?: string | null;
}) {
  const contentType = mimeType || 'image/jpeg';
  const extension = profilePhotoExtension(contentType, uri);
  const storagePath = `${employeeId}/profile-${Date.now()}.${extension}`;
  const photoBytes = base64ToArrayBuffer(base64);

  const { error: uploadError } = await supabase.storage
    .from('employee-profile-photos')
    .upload(storagePath, photoBytes, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    const message = errorMessage(uploadError);
    if (isMissingStorageBucketMessage(message)) {
      throw new Error('Profile photo storage is not installed yet. Run migration 0030_employee_profile_photos.sql, then try again.');
    }

    throw new Error(message);
  }

  const { data: publicUrlData } = supabase.storage
    .from('employee-profile-photos')
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData.publicUrl;
  const { data, error } = await supabase.rpc('update_own_employee_photo', {
    p_photo_url: publicUrl,
  });

  if (error) {
    throw new Error(errorMessage(error));
  }

  return (data as string | null) ?? publicUrl;
}
