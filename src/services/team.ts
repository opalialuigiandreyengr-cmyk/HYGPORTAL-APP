import { supabase } from '../lib/supabase';

export type MyTeamEmployee = {
  employee_id: string;
  employee_no: string | null;
  full_name: string | null;
  photo_url: string | null;
  employment_status: string | null;
  department_name: string | null;
  position_name: string | null;
  time_schedule: string | null;
  day_off: string | null;
};

export type MyTeamSchedule = {
  id: string;
  schedule_date: string;
  employee_id: string;
  employee_name: string | null;
  from_time: string | null;
  to_time: string | null;
  is_day_off: boolean;
  notes: string | null;
};

export type MyFlexibleSchedule = {
  id: string;
  schedule_date: string;
  from_time: string | null;
  to_time: string | null;
  is_day_off: boolean;
  notes: string | null;
  previous_from_time: string | null;
  previous_to_time: string | null;
  previous_day_off_date: string | null;
};

function messageFromError(error: { message?: string; details?: string | null; hint?: string | null }) {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ');
}

export async function loadMyTeamEmployees() {
  const { data, error } = await supabase.rpc('manager_my_team_directory');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as MyTeamEmployee[];
}

export async function loadMyTeamSchedules() {
  const { data, error } = await supabase.rpc('manager_my_team_schedules');

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as MyTeamSchedule[];
}

export async function saveMyTeamSchedules(input: {
  employeeIds: string[];
  scheduleDate: string;
  fromTime: string;
  toTime: string;
  isDayOff: boolean;
  notes: string;
}) {
  const { data, error } = await supabase.rpc('manager_save_team_schedules', {
    p_employee_ids: input.employeeIds,
    p_schedule_date: input.scheduleDate,
    p_from_time: input.fromTime,
    p_to_time: input.toTime,
    p_is_day_off: input.isDayOff,
    p_notes: input.notes,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  return (data ?? []) as MyTeamSchedule[];
}

export async function deleteMyTeamSchedule(scheduleId: string) {
  const { error } = await supabase.rpc('manager_delete_team_schedule', {
    p_schedule_id: scheduleId,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }
}

export async function loadMyFlexibleSchedule(scheduleDate: string) {
  const { data, error } = await supabase.rpc('employee_my_flexible_schedule', {
    p_schedule_date: scheduleDate,
  });

  if (error) {
    throw new Error(messageFromError(error));
  }

  const rows = (data ?? []) as MyFlexibleSchedule[];
  return rows[0] ?? null;
}
