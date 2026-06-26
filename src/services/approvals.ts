import { supabase } from '../lib/supabase';

export type PendingApprovalStep = {
  step_order: number;
  required_level: number;
  status: string;
  acted_at: string | null;
  skipped_reason: string | null;
  approver_name: string | null;
  approver_position_name?: string | null;
};

export type PendingApproval = {
  step_id: string;
  request_id: string;
  step_order: number;
  request_type_code: string;
  request_type_name: string;
  requester_name: string;
  requester_employee_no: string | null;
  requester_photo_url?: string | null;
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
  submitted_at: string;
  approval_summary: PendingApprovalStep[];
};

export async function loadPendingApprovals() {
  const { data, error } = await supabase.rpc('get_my_pending_approvals');

  if (error) {
    throw error;
  }

  return (data ?? []) as PendingApproval[];
}

export async function decideApprovalStep(stepId: string, decision: 'approved' | 'rejected', remarks?: string) {
  const { data, error } = await supabase.rpc('decide_approval_step', {
    p_step_id: stepId,
    p_decision: decision,
    p_remarks: remarks ?? null,
  });

  if (error) {
    throw error;
  }

  return data as string;
}
