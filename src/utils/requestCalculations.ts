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

export function calculateRequestHours({
  requestType,
  dateFrom,
  timeFrom,
  timeTo,
  timeSchedule,
  dayOff,
}: {
  requestType: RequestTypeCode;
  dateFrom: string;
  timeFrom: string;
  timeTo: string;
  timeSchedule: string;
  dayOff: string;
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

  if (requestType === 'use_offset' || isDateDayOff(dateFrom, dayOff)) {
    return roundHours(workedMinutes);
  }

  const scheduleRange = parseScheduleRange(timeSchedule);
  if (!scheduleRange) {
    return roundHours(workedMinutes);
  }

  return roundHours(computeOvertimeMinutes(scheduleRange, workStart, workEnd));
}

export function getHoursHint(requestType: RequestTypeCode, dateFrom: string, dayOff: string) {
  if (requestType === 'use_offset') {
    return 'Use Offset counts the selected time range.';
  }

  if (isDateDayOff(dateFrom, dayOff)) {
    return 'Day off date: full worked hours are counted.';
  }

  return 'Regular scheduled day: only hours outside the schedule are counted.';
}

function parseDayNumber(value: string) {
  const parsed = Number(value.replace(',', '.'));
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function parseTimeToMinutes(value: string) {
  const [rawHour, rawMinute] = value.split(':').map(Number);
  if (
    Number.isNaN(rawHour) ||
    Number.isNaN(rawMinute) ||
    rawHour < 0 ||
    rawHour > 23 ||
    rawMinute < 0 ||
    rawMinute > 59
  ) {
    return null;
  }

  return rawHour * 60 + rawMinute;
}

function parse12HourToken(token: string) {
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

function isDateDayOff(dateValue: string, dayOff: string) {
  const selectedDayOff = normalizeDayCode(dayOff);
  const selectedDateDay = getDayCodeFromDate(dateValue);

  return Boolean(selectedDayOff && selectedDateDay && selectedDayOff === selectedDateDay);
}

function normalizeDayCode(value: string) {
  const dayMap: Record<string, string> = {
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

  return dayMap[value.trim().toUpperCase()] ?? null;
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
  return Math.round((minutes / 60) * 100) / 100;
}
