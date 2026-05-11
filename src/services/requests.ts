import { supabase } from '../lib/supabase';

export type RequestApprovalSummary = {
  step_order: number;
  required_level: number;
  status: string;
  acted_at: string | null;
  remarks: string | null;
  skipped_reason: string | null;
  approver_name: string | null;
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
  total_hours: number | null;
  leave_type: string | null;
  leave_category: string | null;
  start_date: string | null;
  end_date: string | null;
  total_days: number | null;
  paid_days: number | null;
  unpaid_days: number | null;
  reason: string | null;
  approval_summary: RequestApprovalSummary[];
};

export async function loadMyRequests() {
  const { data, error } = await supabase.rpc('get_my_requests');

  if (error) {
    throw error;
  }

  return (data ?? []) as MyRequest[];
}
