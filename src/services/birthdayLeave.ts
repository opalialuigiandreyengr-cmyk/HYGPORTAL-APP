import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';
import type { EmployeeProfileSummary, MyRequest } from '../types/domain';
import { formatDateInput } from '../utils/dateTime';

const CACHE_KEY_PREFIX = 'birthday_leave_granted_';
const RECORD_CACHE_PREFIX = 'birthday_leave_record_';
const MY_REQUESTS_CACHE_KEY = 'my_requests_v1';

export function isAutoApprovedBirthdayGrant(item: MyRequest | null | undefined): boolean {
  if (!item) return false;
  return (
    item.request_id?.startsWith('bday_leave_') === true ||
    item.reason === 'Auto-approved Birthday Leave Grant' ||
    item.leave_category === 'Birthday Leave Grant' ||
    (item.approval_summary?.[0]?.approver_name === 'HYG Portal System' &&
      (item.leave_category === 'Birthday Leave' || item.leave_category === 'Birthday Leave Grant')) ||
    (item.leave_category === 'Birthday Leave' &&
      item.status === 'approved' &&
      (item.total_days === 1 || (item.paid_days === 1 && (item.unpaid_days ?? 0) === 0)))
  );
}

export type BirthdayVerificationResult = {
  isVerified: boolean;
  birthdayThisYear?: string;
  monthDay?: string;
  reason?: 'NO_BIRTHDATE' | 'NO_DATE' | 'DATE_MISMATCH' | 'VALID';
  message?: string;
};

/**
 * Accurately extracts the month and day (MM-DD) from a birthDate string.
 * Supports "YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss", "MM-DD", etc.
 */
export function parseBirthMonthDay(
  birthDate: string | null | undefined,
): { month: string; day: string; monthDay: string } | null {
  if (!birthDate || birthDate.trim().length < 4) return null;
  const clean = birthDate.trim();

  // Match YYYY-MM-DD
  const ymdMatch = clean.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return { month: ymdMatch[1], day: ymdMatch[2], monthDay: `${ymdMatch[1]}-${ymdMatch[2]}` };
  }

  // Match MM-DD
  const mdMatch = clean.match(/^(\d{2})-(\d{2})/);
  if (mdMatch) {
    return { month: mdMatch[1], day: mdMatch[2], monthDay: `${mdMatch[1]}-${mdMatch[2]}` };
  }

  // Fallback: Date constructor
  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return { month: m, day, monthDay: `${m}-${day}` };
  }

  return null;
}

/**
 * Verify whether a chosen date or date range covers the employee's birthday.
 */
export function verifyEmployeeBirthday(
  dateFrom: string,
  dateTo: string,
  birthDate: string | null | undefined,
): BirthdayVerificationResult {
  const parsed = parseBirthMonthDay(birthDate);
  if (!parsed) {
    return {
      isVerified: false,
      reason: 'NO_BIRTHDATE',
      message: 'Birth date is not recorded on your profile. Please contact HR to update your birth date.',
    };
  }

  const monthDay = parsed.monthDay;
  const startYear = dateFrom ? dateFrom.slice(0, 4) : String(new Date().getFullYear());
  const endYear = dateTo ? dateTo.slice(0, 4) : startYear;
  const birthdayStartYear = `${startYear}-${monthDay}`;
  const birthdayEndYear = `${endYear}-${monthDay}`;

  if (!dateFrom || !dateTo) {
    return {
      isVerified: false,
      birthdayThisYear: birthdayStartYear,
      monthDay,
      reason: 'NO_DATE',
      message: 'Please set the date range for your Birthday Leave.',
    };
  }

  // Check if birthday falls between dateFrom and dateTo (inclusive)
  const isCovered =
    (birthdayStartYear >= dateFrom && birthdayStartYear <= dateTo) ||
    (birthdayEndYear >= dateFrom && birthdayEndYear <= dateTo) ||
    dateFrom.slice(5, 10) === monthDay ||
    dateTo.slice(5, 10) === monthDay;

  if (!isCovered) {
    return {
      isVerified: false,
      birthdayThisYear: birthdayStartYear,
      monthDay,
      reason: 'DATE_MISMATCH',
      message: `Selected date does not cover your birthday (${monthDay}). Birthday Leave must include your birthday.`,
    };
  }

  return {
    isVerified: true,
    birthdayThisYear: birthdayStartYear,
    monthDay,
    reason: 'VALID',
  };
}

export async function ensureBirthdayLeaveGrant(
  profile: EmployeeProfileSummary | null,
  userEmail: string,
): Promise<MyRequest | null> {
  const currentYear = new Date().getFullYear();
  const identityKey = profile?.employeeId || userEmail.trim().toLowerCase();
  const flagCacheKey = `${CACHE_KEY_PREFIX}${identityKey}_${currentYear}`;
  const recordCacheKey = `${RECORD_CACHE_PREFIX}${identityKey}_${currentYear}`;

  // 1. Check if already granted for this calendar year
  const alreadyGranted = await getCacheJSON<boolean>(flagCacheKey);
  const existingRecord = await getCacheJSON<MyRequest>(recordCacheKey);

  if (alreadyGranted && existingRecord) {
    await mergeIntoMyRequestsCache(existingRecord);
    return existingRecord;
  }

  // 2. Format dates using the CURRENT YEAR, not the birth year
  let birthdayThisYearStr = formatDateInput(new Date());
  const parsed = parseBirthMonthDay(profile?.birthDate);
  if (parsed) {
    birthdayThisYearStr = `${currentYear}-${parsed.monthDay}`;
  }

  // 3. Create the auto-approved Birthday Leave request object
  const bdayRequest: MyRequest = {
    request_id: `bday_leave_${identityKey}_${currentYear}`,
    request_type_code: 'leave',
    request_type_name: 'Leave',
    status: 'approved',
    submitted_at: new Date().toISOString(),
    final_approved_at: new Date().toISOString(),
    rejected_at: null,
    rejected_reason: null,
    date_from: birthdayThisYearStr,
    date_to: birthdayThisYearStr,
    start_date: birthdayThisYearStr,
    end_date: birthdayThisYearStr,
    time_from: null,
    time_to: null,
    total_hours: null,
    leave_type: 'With Pay',
    leave_category: 'Birthday Leave Grant',
    total_days: 1,
    paid_days: 1,
    unpaid_days: 0,
    reason: 'Auto-approved Birthday Leave Grant',
    approval_summary: [
      {
        step_order: 1,
        required_level: 1,
        status: 'approved',
        acted_at: new Date().toISOString(),
        remarks: 'System auto-approved Birthday Leave Grant',
        skipped_reason: null,
        approver_name: 'HYG Portal System',
        approver_position_name: 'Automated HR Perk System',
        approver_employee_no: 'SYS-001',
      },
    ],
  };

  // 4. Save persistent local flags and record
  await setCacheJSON(flagCacheKey, true);
  await setCacheJSON(recordCacheKey, bdayRequest);

  // 5. Try submitting to Supabase if connected so DB stays synced without deducting annual leave credits
  try {
    const { error } = await supabase.rpc('submit_leave_request', {
      p_leave_type: 'With Pay',
      p_leave_category: 'Birthday Leave Grant',
      p_start_date: birthdayThisYearStr,
      p_end_date: birthdayThisYearStr,
      p_paid_days: 0, // 0 deducted from standard annual leave credits
      p_unpaid_days: 0,
      p_reason: 'Auto-approved Birthday Leave Grant',
    });
    if (error) {
      console.warn('Auto Birthday Leave DB sync notice:', error.message);
    }
  } catch (err) {
    console.warn('Auto Birthday Leave RPC call skipped or failed:', err);
  }

  // 6. Merge into requests list cache
  await mergeIntoMyRequestsCache(bdayRequest);

  return bdayRequest;
}

export async function getBirthdayLeaveGrantForCurrentYear(
  identityKey: string,
): Promise<MyRequest | null> {
  const currentYear = new Date().getFullYear();
  const recordCacheKey = `${RECORD_CACHE_PREFIX}${identityKey}_${currentYear}`;
  return getCacheJSON<MyRequest>(recordCacheKey);
}

export async function mergeIntoMyRequestsCache(bdayRequest: MyRequest) {
  const cachedRequests = (await getCacheJSON<MyRequest[]>(MY_REQUESTS_CACHE_KEY)) ?? [];
  const exists = cachedRequests.some(
    (req) =>
      req.request_id === bdayRequest.request_id ||
      (isAutoApprovedBirthdayGrant(req) &&
        req.start_date &&
        new Date(req.start_date).getFullYear() === new Date().getFullYear()),
  );

  if (!exists) {
    const updated = [bdayRequest, ...cachedRequests];
    await setCacheJSON(MY_REQUESTS_CACHE_KEY, updated);
  }
}
