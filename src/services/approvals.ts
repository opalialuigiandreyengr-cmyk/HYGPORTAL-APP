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
  time_schedule?: string | null;
  day_off?: string | null;
  payroll_class?: string | null;
  transaction_type?: string | null;
  submitted_at: string;
  approval_summary: PendingApprovalStep[];
};

function formatTimeDisplay(timeStr: string | null): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hStr = hours < 10 ? `0${hours}` : `${hours}`;
  return `${hStr}:${minutes}${ampm}`;
}

function getWeekdayFromDateStr(dateStr: string | null): string {
  if (!dateStr) return 'Sun';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[dt.getDay()] || 'Sun';
  }
  return 'Sun';
}

export async function loadPendingApprovals() {
  const { data, error } = await supabase.rpc('get_my_pending_approvals');

  if (error) {
    throw error;
  }

  const items = (data ?? []) as PendingApproval[];

  const enhancedItems = await Promise.all(
    items.map(async (item) => {
      if (item.request_type_code === 'leave') return item;

      let timeSchedule = item.time_schedule;
      let dayOff = item.day_off;
      let payrollClass = item.payroll_class;
      let transactionType = item.transaction_type;

      if (!timeSchedule || !dayOff || !payrollClass) {
        try {
          const { data: rpcData } = await supabase.rpc('get_request_details_by_id', {
            p_request_id: item.request_id,
          });

          if (rpcData && rpcData.length > 0) {
            timeSchedule = timeSchedule || rpcData[0].time_schedule;
            dayOff = dayOff || rpcData[0].day_off;
            payrollClass = payrollClass || rpcData[0].payroll_class;
            transactionType = transactionType || rpcData[0].transaction_type;
          }
        } catch {
          // ignore
        }
      }

      if (!timeSchedule || !dayOff || !payrollClass) {
        try {
          const { data: tableData } = await supabase
            .from('time_request_details')
            .select('time_schedule, day_off, payroll_class, transaction_type')
            .eq('request_id', item.request_id)
            .maybeSingle();

          if (tableData) {
            timeSchedule = timeSchedule || tableData.time_schedule;
            dayOff = dayOff || tableData.day_off;
            payrollClass = payrollClass || tableData.payroll_class;
            transactionType = transactionType || tableData.transaction_type;
          }
        } catch {
          // ignore
        }
      }

      return {
        ...item,
        time_schedule: timeSchedule ?? item.time_schedule ?? null,
        day_off: dayOff ?? item.day_off ?? null,
        payroll_class: payrollClass ?? item.payroll_class ?? null,
        transaction_type: transactionType ?? item.transaction_type ?? null,
      };
    }),
  );

  return enhancedItems;
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
