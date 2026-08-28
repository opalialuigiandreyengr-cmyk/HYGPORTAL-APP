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

export type ApprovedApproval = PendingApproval & {
  approved_at?: string | null;
  status?: string;
  remarks?: string | null;
};

export async function loadApprovedApprovals(
  currentEmployeeNo?: string | null,
  currentFullName?: string | null,
): Promise<ApprovedApproval[]> {
  let items: ApprovedApproval[] = [];

  const normEmployeeNo = currentEmployeeNo?.trim().toLowerCase();
  const normFullName = currentFullName?.trim().toLowerCase();

  // Try RPC admin_get_all_requests first (supported by Supabase)
  try {
    const { data: allReqs, error: rpcErr } = await supabase.rpc('admin_get_all_requests');
    if (!rpcErr && Array.isArray(allReqs) && allReqs.length > 0) {
      items = allReqs
        .filter((raw: any) => {
          if (!Array.isArray(raw.approval_summary) || raw.approval_summary.length === 0) {
            return false;
          }

          // Strict filter: Check if THIS specific manager/approver approved a step in this request
          return raw.approval_summary.some((step: any) => {
            const isApprovedStep = step.status?.toLowerCase() === 'approved';
            if (!isApprovedStep) return false;

            if (!normEmployeeNo && !normFullName) {
              return true;
            }

            const stepEmpNo = step.approver_employee_no?.trim().toLowerCase();
            const stepName = step.approver_name?.trim().toLowerCase();

            const matchEmpNo = Boolean(normEmployeeNo && stepEmpNo && stepEmpNo === normEmployeeNo);
            const matchName = Boolean(
              normFullName &&
                stepName &&
                (stepName === normFullName || stepName.includes(normFullName) || normFullName.includes(stepName)),
            );

            return matchEmpNo || matchName;
          });
        })
        .map((raw: any) => {
          const approvedStep =
            (raw.approval_summary || []).find((s: any) => {
              if (s.status?.toLowerCase() !== 'approved') return false;
              if (!normEmployeeNo && !normFullName) return true;
              const stepEmpNo = s.approver_employee_no?.trim().toLowerCase();
              const stepName = s.approver_name?.trim().toLowerCase();
              return (
                (normEmployeeNo && stepEmpNo && stepEmpNo === normEmployeeNo) ||
                (normFullName &&
                  stepName &&
                  (stepName === normFullName || stepName.includes(normFullName) || normFullName.includes(stepName)))
              );
            }) || (raw.approval_summary || []).find((s: any) => s.status?.toLowerCase() === 'approved');

          return {
            step_id: approvedStep?.step_id || raw.request_id,
            request_id: raw.request_id,
            step_order: approvedStep?.step_order || 1,
            request_type_code: raw.request_type_code || 'esarf',
            request_type_name: raw.request_type_name || 'ESARF Request',
            requester_name: raw.employee_name || 'Employee',
            requester_employee_no: raw.employee_no || null,
            requester_photo_url: raw.employee_photo || null,
            date_from: raw.date_from || null,
            date_to: raw.date_to || null,
            time_from: raw.time_from || null,
            time_to: raw.time_to || null,
            total_hours: raw.total_hours ?? null,
            leave_type: raw.leave_type || null,
            leave_category: raw.leave_category || null,
            start_date: raw.start_date || null,
            end_date: raw.end_date || null,
            total_days: raw.total_days ?? null,
            paid_days: raw.paid_days ?? null,
            unpaid_days: raw.unpaid_days ?? null,
            reason: raw.reason || null,
            time_schedule: raw.time_schedule || null,
            day_off: raw.day_off || null,
            payroll_class: raw.payroll_class || null,
            transaction_type: raw.transaction_type || null,
            submitted_at: raw.submitted_at || new Date().toISOString(),
            approved_at: approvedStep?.acted_at || raw.final_approved_at || raw.submitted_at || null,
            status: 'approved',
            remarks: approvedStep?.remarks || null,
            approval_summary: (raw.approval_summary || []).map((step: any) => ({
              step_order: step.step_order || 1,
              required_level: step.required_level || 1,
              status: step.status || 'approved',
              acted_at: step.acted_at || null,
              skipped_reason: step.skipped_reason || null,
              approver_name: step.approver_name || 'Approver',
              approver_position_name: step.approver_position_name || null,
            })),
          };
        });
    }
  } catch (err) {
    console.warn('loadApprovedApprovals RPC error:', err);
  }


  // Fallback: Query requests directly if admin_get_all_requests returned no items
  if (!items || items.length === 0) {
    try {
      const { data: reqs } = await supabase
        .from('requests')
        .select('*')
        .eq('status', 'approved');

      if (reqs && reqs.length > 0) {
        items = await Promise.all(
          reqs.map(async (req) => {
            const { data: timeDetails } = await supabase
              .from('time_request_details')
              .select('*')
              .eq('request_id', req.id)
              .maybeSingle();

            const { data: leaveDetails } = await supabase
              .from('leave_request_details')
              .select('*')
              .eq('request_id', req.id)
              .maybeSingle();

            const { data: userProfile } = await supabase
              .from('user_profiles')
              .select('full_name, employee_no, photo_url')
              .eq('employee_id', req.submitted_by_employee_id)
              .maybeSingle();

            const isLeave = Boolean(leaveDetails) || req.request_type_code === 'leave';

            return {
              step_id: req.id,
              request_id: req.id,
              step_order: 1,
              request_type_code: req.request_type_code || (isLeave ? 'leave' : 'esarf'),
              request_type_name: isLeave ? 'Leave Request' : 'ESARF Request',
              requester_name: userProfile?.full_name || 'Employee',
              requester_employee_no: userProfile?.employee_no || null,
              requester_photo_url: userProfile?.photo_url || null,
              date_from: timeDetails?.date_from || null,
              date_to: timeDetails?.date_to || null,
              time_from: timeDetails?.time_from || null,
              time_to: timeDetails?.time_to || null,
              total_hours: timeDetails?.total_hours ?? null,
              leave_type: leaveDetails?.leave_type || null,
              leave_category: leaveDetails?.leave_category || null,
              start_date: leaveDetails?.start_date || null,
              end_date: leaveDetails?.end_date || null,
              total_days: leaveDetails?.total_days ?? null,
              paid_days: leaveDetails?.paid_days ?? null,
              unpaid_days: leaveDetails?.unpaid_days ?? null,
              reason: timeDetails?.reason || leaveDetails?.reason || req.reason || null,
              time_schedule: timeDetails?.time_schedule || null,
              day_off: timeDetails?.day_off || null,
              payroll_class: timeDetails?.payroll_class || null,
              transaction_type: timeDetails?.transaction_type || null,
              submitted_at: req.created_at || req.submitted_at || new Date().toISOString(),
              approved_at: req.updated_at || null,
              status: 'approved',
              approval_summary: [],
            };
          }),
        );
      }
    } catch {
      // ignore
    }
  }

  return items;
}

export type UpdateApprovedRequestParams = {
  requestId: string;
  stepId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  totalHours?: number | null;
  timeSchedule?: string | null;
  dayOff?: string | null;
  payrollClass?: string | null;
  transactionType?: string | null;
  leaveType?: string | null;
  leaveCategory?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalDays?: number | null;
  paidDays?: number | null;
  unpaidDays?: number | null;
  reason?: string | null;
  remarks?: string | null;
  rejectedIndices?: number[];
};

export async function updateApprovedRequest(params: UpdateApprovedRequestParams): Promise<void> {
  const { requestId } = params;
  if (!requestId) {
    throw new Error('Missing Request ID.');
  }

  let updated = false;
  let lastError: string | null = null;

  // 1. Try admin_update_request_data RPC
  try {
    const { error: rpcErr } = await supabase.rpc('admin_update_request_data', {
      p_request_id: requestId,
      p_is_perk: false,
      p_date_from: params.dateFrom || null,
      p_date_to: params.dateTo || null,
      p_time_from: params.timeFrom || null,
      p_time_to: params.timeTo || null,
      p_total_hours: params.totalHours ?? null,
      p_leave_type: params.leaveType || null,
      p_leave_category: params.leaveCategory || null,
      p_start_date: params.startDate || null,
      p_end_date: params.endDate || null,
      p_total_days: params.totalDays ?? null,
      p_reason: params.reason || null,
    });

    if (!rpcErr) {
      updated = true;
    } else {
      lastError = rpcErr.message;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'RPC call failed';
  }

  // 2. Direct table updates for time_request_details / leave_request_details if needed
  try {
    if (params.dateFrom || params.timeFrom || params.timeSchedule || params.transactionType) {
      await supabase
        .from('time_request_details')
        .update({
          ...(params.dateFrom ? { date_from: params.dateFrom } : {}),
          ...(params.dateTo ? { date_to: params.dateTo } : {}),
          ...(params.timeFrom ? { time_from: params.timeFrom } : {}),
          ...(params.timeTo ? { time_to: params.timeTo } : {}),
          ...(params.totalHours !== undefined && params.totalHours !== null ? { total_hours: params.totalHours } : {}),
          ...(params.timeSchedule ? { time_schedule: params.timeSchedule } : {}),
          ...(params.dayOff ? { day_off: params.dayOff } : {}),
          ...(params.payrollClass ? { payroll_class: params.payrollClass } : {}),
          ...(params.transactionType ? { transaction_type: params.transactionType } : {}),
          ...(params.reason ? { reason: params.reason } : {}),
        })
        .eq('request_id', requestId);
      updated = true;
    }

    if (params.leaveType || params.startDate) {
      await supabase
        .from('leave_request_details')
        .update({
          ...(params.leaveType ? { leave_type: params.leaveType } : {}),
          ...(params.leaveCategory ? { leave_category: params.leaveCategory } : {}),
          ...(params.startDate ? { start_date: params.startDate } : {}),
          ...(params.endDate ? { end_date: params.endDate } : {}),
          ...(params.totalDays !== undefined && params.totalDays !== null ? { total_days: params.totalDays } : {}),
          ...(params.paidDays !== undefined && params.paidDays !== null ? { paid_days: params.paidDays } : {}),
          ...(params.unpaidDays !== undefined && params.unpaidDays !== null ? { unpaid_days: params.unpaidDays } : {}),
          ...(params.reason ? { reason: params.reason } : {}),
        })
        .eq('request_id', requestId);
      updated = true;
    }
  } catch {
    // ignore
  }

  // 3. Handle ESARF entry rejections
  if (params.rejectedIndices !== undefined && params.rejectedIndices !== null) {
    try {
      await supabase.rpc('update_time_request_entry_rejections', {
        p_request_id: requestId,
        p_rejected_entry_indices: params.rejectedIndices,
      });
      updated = true;
    } catch {
      // ignore
    }
  }

  if (!updated && lastError) {
    throw new Error(lastError);
  }
}


