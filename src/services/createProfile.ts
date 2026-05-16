import { supabase } from '../lib/supabase';

export type CreateEmployeeProfileInput = {
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  birthDate: string;
  gender: string;
  civilStatus: string;
  cellphone: string;
  email: string;
  company: string;
  workUnit: string;
  position: string;
  dateHired: string;
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
};

export type DuplicateEmployeeProfileResult = {
  duplicate_name?: boolean;
  duplicate_email?: boolean;
};

export type EmployeeAssignmentOption = {
  department_name: string;
  position_name: string | null;
};

export type EmployeeCompanyOption = {
  company_name: string;
};

function optionalDate(value: string) {
  return value.trim() || null;
}

export async function createEmployeeProfile(input: CreateEmployeeProfileInput) {
  const { data, error } = await supabase.rpc('create_employee_profile', {
    p_last_name: input.lastName.trim(),
    p_first_name: input.firstName.trim(),
    p_middle_name: input.middleName.trim(),
    p_suffix: input.suffix.trim(),
    p_birth_date: optionalDate(input.birthDate),
    p_gender: input.gender.trim(),
    p_civil_status: input.civilStatus.trim(),
    p_cellphone: input.cellphone.trim(),
    p_email: input.email.trim(),
    p_company: input.company.trim(),
    p_work_unit: input.workUnit.trim(),
    p_position: input.position.trim(),
    p_date_hired: optionalDate(input.dateHired),
    p_employee_type: input.employeeType.trim(),
    p_tin: input.tin.trim(),
    p_sss: input.sss.trim(),
    p_pagibig: input.pagibig.trim(),
    p_philhealth: input.philhealth.trim(),
    p_bank_type: input.bankType.trim(),
    p_account_no: input.accountNo.trim(),
    p_education: input.education.trim(),
    p_present_address: input.presentAddress.trim(),
    p_emergency_contact: input.emergencyContact.trim(),
  });

  if (error) {
    throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' '));
  }

  return data as string;
}

export async function checkEmployeeProfileDuplicate(input: Pick<
  CreateEmployeeProfileInput,
  'lastName' | 'firstName' | 'middleName' | 'suffix' | 'email'
>) {
  const { data, error } = await supabase.rpc('check_employee_profile_duplicate', {
    p_last_name: input.lastName.trim(),
    p_first_name: input.firstName.trim(),
    p_middle_name: input.middleName.trim(),
    p_suffix: input.suffix.trim(),
    p_email: input.email.trim(),
  });

  if (error) {
    throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' '));
  }

  return data as DuplicateEmployeeProfileResult;
}

export async function loadEmployeeAssignmentOptions() {
  const { data, error } = await supabase.rpc('employee_assignment_options');

  if (error) {
    throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' '));
  }

  return (data ?? []) as EmployeeAssignmentOption[];
}

export async function loadEmployeeCompanyOptions() {
  const { data, error } = await supabase.rpc('employee_company_options');

  if (!error) {
    return (data ?? []) as EmployeeCompanyOption[];
  }

  const fallback = await supabase
    .from('companies')
    .select('name')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (fallback.error) {
    throw new Error([
      error.message,
      error.details,
      error.hint,
      fallback.error.message,
      fallback.error.details,
      fallback.error.hint,
    ].filter(Boolean).join(' '));
  }

  return (fallback.data ?? []).map((company) => ({ company_name: company.name })) as EmployeeCompanyOption[];
}
