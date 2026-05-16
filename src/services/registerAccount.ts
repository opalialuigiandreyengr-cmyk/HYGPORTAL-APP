import { supabase } from '../lib/supabase';

export type EmployeeRegistrationVerification = {
  verified?: boolean;
  already_registered?: boolean;
  employee_id?: string;
  employee_no?: string | null;
  full_name?: string;
  message?: string;
};

export type VerifyEmployeeRegistrationInput = {
  firstName: string;
  lastName: string;
  middleName: string;
  birthDate: string;
  email: string;
};

function errorMessage(error: { message?: string; details?: string | null; hint?: string | null }) {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ');
}

export function normalizeUsername(username: string) {
  return username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
}

export async function resolveLoginEmail(username: string) {
  const loginIdentifier = normalizeUsername(username);
  if (!loginIdentifier) {
    throw new Error('Enter a valid username.');
  }

  const { data, error } = await supabase.rpc('resolve_login_email', {
    p_username: loginIdentifier,
  });

  if (error) {
    throw new Error(errorMessage(error));
  }

  if (!data) {
    throw new Error('No login account found for this username.');
  }

  return data as string;
}

export async function verifyEmployeeForRegistration(input: VerifyEmployeeRegistrationInput) {
  const { data, error } = await supabase.rpc('verify_employee_for_registration', {
    p_first_name: input.firstName.trim(),
    p_last_name: input.lastName.trim(),
    p_middle_name: input.middleName.trim(),
    p_birth_date: input.birthDate.trim() || null,
    p_email: input.email.trim(),
  });

  if (error) {
    throw new Error(errorMessage(error));
  }

  return data as EmployeeRegistrationVerification;
}

export async function registerEmployeeLoginAccount({
  employeeId,
  username,
  email,
  password,
  termsAccepted,
}: {
  employeeId: string;
  username: string;
  email: string;
  password: string;
  termsAccepted: boolean;
}) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error('Enter a valid username.');
  }

  const authEmail = email.trim().toLowerCase();
  if (!authEmail || !authEmail.includes('@')) {
    throw new Error('Enter a valid email address.');
  }

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: authEmail,
    password,
  });

  if (signUpError) {
    throw new Error(signUpError.message);
  }

  const authUserId = signUpData.user?.id;
  if (!authUserId) {
    throw new Error('Unable to create login account. Please try again.');
  }

  const { data, error } = await supabase.rpc('link_employee_login_account', {
    p_employee_id: employeeId,
    p_auth_user_id: authUserId,
    p_username: normalizedUsername,
    p_terms_accepted: termsAccepted,
  });

  if (error) {
    throw new Error(errorMessage(error));
  }

  return data as string;
}
