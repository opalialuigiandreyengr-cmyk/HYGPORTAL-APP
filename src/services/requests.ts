import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

export type RequestApprovalSummary = {
  step_order: number;
  required_level: number;
  status: string;
  acted_at: string | null;
  remarks: string | null;
  skipped_reason: string | null;
  approver_name: string | null;
  approver_position_name?: string | null;
  approver_employee_no: string | null;
};

export type MyRequest = {
  request_id: string;
  request_type_code: string;
  request_type_name: string;
  status: string;
  submitted_at: string;
  final_approved_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  date_from: string | null;
  date_to: string | null;
  time_from: string | null;
  time_to: string | null;
  time_schedule?: string | null;
  day_off?: string | null;
  payroll_class?: string | null;
  transaction_type?: string | null;
  total_hours: number | null;
  leave_type: string | null;
  leave_category: string | null;
  start_date: string | null;
  end_date: string | null;
  total_days: number | null;
  paid_days: number | null;
  unpaid_days: number | null;
  reason: string | null;
  perk_approval_code?: string | null;
  perk_amount?: number | null;
  perk_discount_amount?: number | null;
  perk_final_amount?: number | null;
  perk_benefit?: string | null;
  approval_summary: RequestApprovalSummary[];
};

export async function loadMyRequests() {
  const cacheKey = 'my_requests_v1';
  const { data, error } = await supabase.rpc('get_my_requests');

  if (error) {
    const cached = await getCacheJSON<MyRequest[]>(cacheKey);
    if (cached) {
      return cached;
    }
    throw error;
  }

  let items = (data ?? []) as MyRequest[];
  const cached = await getCacheJSON<MyRequest[]>(cacheKey);

  // Mark all Birthday Leave requests as approved and ensure current year in date range
  const currentYearStr = new Date().getFullYear().toString();
  items = items.map((item) => {
    if (item.leave_category === 'Birthday Leave' || item.reason?.toLowerCase().includes('birthday leave')) {
      let dateFrom = item.date_from;
      let dateTo = item.date_to;
      let startDate = item.start_date;
      let endDate = item.end_date;

      if (dateFrom && dateFrom.length >= 10 && !dateFrom.startsWith(currentYearStr)) {
        dateFrom = `${currentYearStr}-${dateFrom.slice(5, 10)}`;
      }
      if (dateTo && dateTo.length >= 10 && !dateTo.startsWith(currentYearStr)) {
        dateTo = `${currentYearStr}-${dateTo.slice(5, 10)}`;
      }
      if (startDate && startDate.length >= 10 && !startDate.startsWith(currentYearStr)) {
        startDate = `${currentYearStr}-${startDate.slice(5, 10)}`;
      }
      if (endDate && endDate.length >= 10 && !endDate.startsWith(currentYearStr)) {
        endDate = `${currentYearStr}-${endDate.slice(5, 10)}`;
      }

      return {
        ...item,
        status: 'approved',
        date_from: dateFrom,
        date_to: dateTo,
        start_date: startDate,
        end_date: endDate,
        final_approved_at: item.final_approved_at || item.submitted_at || new Date().toISOString(),
      };
    }
    return item;
  });

  // Preserve any locally auto-approved Birthday Leave grants that aren't returned by RPC yet
  if (cached && cached.length) {
    const localBdayGrants = cached.filter(
      (item) => item.leave_category === 'Birthday Leave' && item.status === 'approved',
    );
    for (const bdayItem of localBdayGrants) {
      const existsInServer = items.some(
        (serverItem) =>
          serverItem.request_id === bdayItem.request_id ||
          (serverItem.leave_category === 'Birthday Leave' &&
            serverItem.start_date &&
            bdayItem.start_date &&
            new Date(serverItem.start_date).getFullYear() === new Date(bdayItem.start_date).getFullYear()),
      );
      if (!existsInServer) {
        items = [bdayItem, ...items];
      }
    }
  }

  // Enforce strictly ONE (1) Birthday Leave entry per calendar year
  const seenBirthdayYears = new Set<number>();
  items = items.filter((item) => {
    const isBirthdayLeave =
      item.leave_category === 'Birthday Leave' ||
      item.reason?.toLowerCase().includes('birthday leave');

    if (isBirthdayLeave) {
      const itemYear = item.start_date
        ? new Date(item.start_date).getFullYear()
        : new Date().getFullYear();
      if (seenBirthdayYears.has(itemYear)) {
        return false;
      }
      seenBirthdayYears.add(itemYear);
    }
    return true;
  });

  await setCacheJSON(cacheKey, items);
  return items;
}

export async function loadMyRequestsCached() {
  const cacheKey = 'my_requests_v1';
  return (await getCacheJSON<MyRequest[]>(cacheKey)) ?? [];
}
