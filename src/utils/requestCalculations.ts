import type { RequestTypeCode } from '../types/domain';

export function getLeaveBreakdown(leaveType: string, totalDays: number, paidValue: string, unpaidValue: string) {
  if (leaveType === 'With Pay') {
    return {
      paidDays: totalDays,
      unpaidDays: 0,
      isValid: totalDays > 0,
    };
  }

  if (leaveType === 'Without Pay') {
    return {
      paidDays: 0,
      unpaidDays: totalDays,
      isValid: totalDays > 0,
    };
  }

  const paidDays = parseDayNumber(paidValue);
  const unpaidDays = parseDayNumber(unpaidValue);
  const splitTotal = Math.round((paidDays + unpaidDays) * 100) / 100;

  return {
    paidDays,
    unpaidDays,
    isValid: totalDays > 0 && paidDays >= 0 && unpaidDays >= 0 && splitTotal === totalDays,
  };
}

export function getDisabledLeaveTypes(totalDays: number, leaveCreditRemaining: number) {
  const disabled: string[] = [];

  if (totalDays <= 0 || leaveCreditRemaining <= 0) {
    disabled.push('With Pay', 'Both');
    return disabled;
  }

  if (totalDays > leaveCreditRemaining) {
    disabled.push('With Pay');
  }

  return disabled;
}

const DEFAULT_OFFICIAL_SCHEDULE = '9:00AM - 6:00PM';

export function calculateRequestHours({
  requestType,
  dateFrom,
  timeFrom,
  timeTo,
  timeSchedule,
  dayOff,
  isFullHours = false,
}: {
  requestType: RequestTypeCode;
  dateFrom: string;
  timeFrom: string;
  timeTo: string;
  timeSchedule: string;
  dayOff: string;
  isFullHours?: boolean;
}) {
  const workStart = parseTimeToMinutes(timeFrom);
  const workEnd = parseTimeToMinutes(timeTo);
  if (workStart === null || workEnd === null) {
    return 0;
  }

  const workedMinutes = computeWorkedMinutes(workStart, workEnd);
  if (workedMinutes <= 0) {
    return 0;
  }

  if (requestType === 'use_offset' || isFullHours || isDateDayOff(dateFrom, dayOff)) {
    return roundHours(workedMinutes);
  }

  const scheduleRange = parseScheduleRange(timeSchedule) || parseScheduleRange(DEFAULT_OFFICIAL_SCHEDULE);
  if (!scheduleRange) {
    return roundHours(workedMinutes);
  }

  return roundHours(computeOvertimeMinutes(scheduleRange, workStart, workEnd));
}

export function getHoursHint(
  requestType: RequestTypeCode,
  dateFrom: string,
  dayOff: string,
  isFullHours: boolean = false,
) {
  if (requestType === 'use_offset' || isFullHours) {
    return 'Full selected time range will be counted.';
  }

  if (isDateDayOff(dateFrom, dayOff)) {
    return 'Day off date: full worked hours are counted.';
  }

  return 'Regular scheduled day: only hours outside official working hours (9:00 AM - 6:00 PM) are counted.';
}

function parseDayNumber(value: string) {
  const parsed = Number(value.replace(',', '.'));
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function parseTimeToMinutes(value: string) {
  const parts = value.split(':').map(Number);
  const rawHour = parts[0];
  const rawMinute = parts[1];
  const rawSecond = parts[2] || 0;
  if (
    Number.isNaN(rawHour) ||
    Number.isNaN(rawMinute) ||
    rawHour < 0 ||
    rawHour > 23 ||
    rawMinute < 0 ||
    rawMinute > 59 ||
    rawSecond < 0 ||
    rawSecond > 59
  ) {
    return null;
  }

  return rawHour * 60 + rawMinute + rawSecond / 60;
}

export function parse12HourToken(token: string) {
  const match = token.trim().toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (hour === 12) {
    hour = 0;
  }
  if (match[3] === 'PM') {
    hour += 12;
  }

  return hour * 60 + minute;
}

function parseScheduleRange(scheduleText: string) {
  const parts = scheduleText.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const scheduleStart = parse12HourToken(parts[0]);
  const scheduleEndBase = parse12HourToken(parts[1]);
  if (scheduleStart === null || scheduleEndBase === null) {
    return null;
  }

  let scheduleEnd = scheduleEndBase;
  if (scheduleEnd <= scheduleStart) {
    scheduleEnd += 24 * 60;
  }

  return { scheduleStart, scheduleEnd };
}

function computeWorkedMinutes(workStartBase: number, workEndBase: number) {
  let workEnd = workEndBase;

  if (workEnd <= workStartBase) {
    workEnd += 24 * 60;
  }

  return Math.max(0, workEnd - workStartBase);
}

function alignWorkAndScheduleRanges(
  scheduleRange: { scheduleStart: number; scheduleEnd: number },
  workStartBase: number,
  workEndBase: number,
) {
  let workStart = workStartBase;
  let workEnd = workEndBase;

  if (workEnd <= workStart) {
    workEnd += 24 * 60;
  }

  let scheduleStart = scheduleRange.scheduleStart;
  let scheduleEnd = scheduleRange.scheduleEnd;

  if (workStart >= scheduleEnd) {
    scheduleStart += 24 * 60;
    scheduleEnd += 24 * 60;
  } else if (workEnd <= scheduleStart) {
    workStart += 24 * 60;
    workEnd += 24 * 60;
  }

  return { workStart, workEnd, scheduleStart, scheduleEnd };
}

function computeOvertimeMinutes(
  scheduleRange: { scheduleStart: number; scheduleEnd: number },
  workStartBase: number,
  workEndBase: number,
) {
  const { workStart, workEnd, scheduleStart, scheduleEnd } = alignWorkAndScheduleRanges(
    scheduleRange,
    workStartBase,
    workEndBase,
  );
  const workDuration = workEnd - workStart;
  if (workDuration <= 0) {
    return 0;
  }

  const overlapStart = Math.max(workStart, scheduleStart);
  const overlapEnd = Math.min(workEnd, scheduleEnd);
  const scheduledOverlap = Math.max(0, overlapEnd - overlapStart);

  return Math.max(0, workDuration - scheduledOverlap);
}

const DAY_CODE_MAP: Record<string, string> = {
  MON: 'Mon',
  MONDAY: 'Mon',
  TUE: 'Tue',
  TUESDAY: 'Tue',
  WED: 'Wed',
  WEDNESDAY: 'Wed',
  THU: 'Thu',
  THURSDAY: 'Thu',
  FRI: 'Fri',
  FRIDAY: 'Fri',
  SAT: 'Sat',
  SATURDAY: 'Sat',
  SUN: 'Sun',
  SUNDAY: 'Sun',
};

export function parseDayOffList(value: string): string[] {
  if (!value) {
    return [];
  }

  const tokens = value
    .toUpperCase()
    .split(/[,/&+\s\-]+|\bAND\b/);

  const days: string[] = [];
  for (const token of tokens) {
    const cleaned = token.trim();
    if (cleaned && DAY_CODE_MAP[cleaned]) {
      const dayCode = DAY_CODE_MAP[cleaned];
      if (!days.includes(dayCode)) {
        days.push(dayCode);
      }
    }
  }

  return days;
}

export function isDateDayOff(dateValue: string, dayOff: string) {
  const dayOffList = parseDayOffList(dayOff);
  const selectedDateDay = getDayCodeFromDate(dateValue);

  return Boolean(selectedDateDay && dayOffList.includes(selectedDateDay));
}

function getDayCodeFromDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function roundHours(minutes: number) {
  if (Number.isNaN(minutes) || !Number.isFinite(minutes)) {
    return 0;
  }
  return Math.round((minutes / 60) * 100) / 100;
}
