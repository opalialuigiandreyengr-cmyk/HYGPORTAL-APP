import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

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
  store: string;
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
  documentRefs?: Record<string, unknown> | null;
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

export type EmployeeStoreOption = {
  store_name: string;
  company_name: string;
};

function optionalDate(value: string) {
  return value.trim() || null;
}

export async function createEmployeeProfile(input: CreateEmployeeProfileInput) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('create_employee_profile_with_store', {
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
    p_store: input.store.trim(),
    p_position: 'UNASSIGNED',
    p_date_hired: today,
    p_employee_type: null,
    p_tin: input.tin.trim(),
    p_sss: input.sss.trim(),
    p_pagibig: input.pagibig.trim(),
    p_philhealth: input.philhealth.trim(),
    p_bank_type: input.bankType.trim(),
    p_account_no: input.accountNo.trim(),
    p_education: input.education.trim(),
    p_present_address: input.presentAddress.trim(),
    p_emergency_contact: input.emergencyContact.trim(),
    p_emergency_contact_no: input.emergencyContactNo.trim(),
    p_document_refs: input.documentRefs ?? null,
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
  const cacheKey = 'employee_assignment_options_v1';
  const { data, error } = await supabase.rpc('employee_assignment_options');

  if (error) {
    const cached = await getCacheJSON<EmployeeAssignmentOption[]>(cacheKey);
    if (cached) {
      return cached;
    }
    throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' '));
  }

  const items = (data ?? []) as EmployeeAssignmentOption[];
  await setCacheJSON(cacheKey, items);
  return items;
}

export async function loadEmployeeCompanyOptions() {
  const cacheKey = 'employee_company_options_v1';
  const { data, error } = await supabase.rpc('employee_company_options');

  if (!error) {
    const items = (data ?? []) as EmployeeCompanyOption[];
    await setCacheJSON(cacheKey, items);
    return items;
  }

  const fallback = await supabase
    .from('companies')
    .select('name')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (fallback.error) {
    const cached = await getCacheJSON<EmployeeCompanyOption[]>(cacheKey);
    if (cached) {
      return cached;
    }
    throw new Error([
      error.message,
      error.details,
      error.hint,
      fallback.error.message,
      fallback.error.details,
      fallback.error.hint,
    ].filter(Boolean).join(' '));
  }

  const items = (fallback.data ?? []).map((company) => ({ company_name: company.name })) as EmployeeCompanyOption[];
  await setCacheJSON(cacheKey, items);
  return items;
}

export async function loadEmployeeStoreOptions() {
  const cacheKey = 'employee_store_options_v1';
  const { data, error } = await supabase.rpc('employee_store_options');

  if (error) {
    const cached = await getCacheJSON<EmployeeStoreOption[]>(cacheKey);
    if (cached) {
      return cached;
    }
    throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' '));
  }

  const items = (data ?? []) as EmployeeStoreOption[];
  await setCacheJSON(cacheKey, items);
  return items;
}
