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

  if (leaveCreditRemaining <= 0) {
    disabled.push('With Pay', 'Both');
    return disabled;
  }

  if (totalDays > 0 && totalDays > leaveCreditRemaining) {
    disabled.push('With Pay');
  }

  if (totalDays === 1) {
    disabled.push('Both');
  }

  return disabled;
}

const DEFAULT_OFFICIAL_SCHEDULE = '9:00AM - 6:00PM';

export function calculateRequestHours({
  requestType,
  dateFrom,
  dateTo,
  timeFrom,
  timeTo,
  timeSchedule,
  dayOff,
  isFullHours = false,
}: {
  requestType: RequestTypeCode;
  dateFrom: string;
  dateTo?: string;
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
    return 'Full selected time range will be counted (12:00 PM - 1:00 PM lunch break is excluded).';
  }

  if (isDateDayOff(dateFrom, dayOff)) {
    return 'Day off date: full worked hours are counted (12:00 PM - 1:00 PM lunch break is excluded).';
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

export function parseTimeToMinutes(value: string): number | null {
  if (!value) return null;
  const clean = value.trim();

  // 12-hour format with AM/PM (e.g. "09:00:00 AM", "09:00 AM", "11:00:00 PM", "11:00 PM", "9:00 am")
  const ampmMatch = clean.toUpperCase().replace(/\s+/g, ' ').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2]);
    const sec = Number(ampmMatch[3] || 0);
    const ampm = ampmMatch[4];
    if (Number.isNaN(hour) || Number.isNaN(min) || hour < 1 || hour > 12 || min < 0 || min > 59) {
      return null;
    }
    if (hour === 12) hour = 0;
    if (ampm === 'PM') hour += 12;
    return hour * 60 + min + sec / 60;
  }

  const parts = clean.split(':').map(Number);
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

export const LUNCH_START_MINUTES = 12 * 60; // 12:00 PM (720 min)
export const LUNCH_END_MINUTES = 13 * 60;   // 1:00 PM (780 min)

export function computeLunchBreakOverlap(workStart: number, workEnd: number) {
  // Day 0 lunch break (12:00 PM - 1:00 PM)
  const day0Overlap = Math.max(0, Math.min(workEnd, LUNCH_END_MINUTES) - Math.max(workStart, LUNCH_START_MINUTES));
  // Day 1 lunch break (12:00 PM - 1:00 PM next day) if work spans overnight into next day
  const day1Start = LUNCH_START_MINUTES + 24 * 60;
  const day1End = LUNCH_END_MINUTES + 24 * 60;
  const day1Overlap = Math.max(0, Math.min(workEnd, day1End) - Math.max(workStart, day1Start));

  return day0Overlap + day1Overlap;
}

export function computeWorkedMinutes(workStartBase: number, workEndBase: number, deductLunch: boolean = true) {
  let workEnd = workEndBase;

  if (workEnd <= workStartBase) {
    workEnd += 24 * 60;
  }

  const grossMinutes = Math.max(0, workEnd - workStartBase);
  if (grossMinutes <= 0 || !deductLunch) {
    return grossMinutes;
  }

  const lunchOverlap = computeLunchBreakOverlap(workStartBase, workEnd);
  return Math.max(0, grossMinutes - lunchOverlap);
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

export const MIN_OFFSETABLE_HOURS = 4;
export const WHOLE_DAY_OFFSET_HOURS = 8;

/**
 * Calculates how many hours will be credited to an employee's offset balance
 * based on the offset transaction crediting rules:
 * - Minimum requirement is 4.00 hours (half day) and 8.00 hours (whole day).
 * - If total hours < 4: 0 hours credited (validation warning "Minimum Offset Hours Not Met" appears).
 * - If total hours is 4 to < 8 (e.g. 4, 5, 6, 7): only 4.00 hours credited (half day).
 * - If total hours is >= 8 (e.g. 8, 9, 10, 11+): only 8.00 hours credited (whole day).
 */
export function calculateCreditedOffsetHours(totalHours: number): number {
  if (totalHours < MIN_OFFSETABLE_HOURS) {
    return 0;
  }
  if (totalHours < WHOLE_DAY_OFFSET_HOURS) {
    return 4;
  }
  return 8;
}

/**
 * Computes actual overtime (OT) hours for an offset request, strictly excluding the scheduled shift.
 * If working on a scheduled workday, only hours outside the shift are counted.
 * If working on a day off, full worked hours are counted.
 */
export function computeOffsetOvertimeHours({
  timeFrom,
  timeTo,
  dateFrom,
  timeSchedule,
  dayOff,
}: {
  timeFrom?: string | null;
  timeTo?: string | null;
  dateFrom?: string | null;
  timeSchedule?: string | null;
  dayOff?: string | null;
}): number | null {
  if (!timeFrom || !timeTo) return null;

  const hours = calculateRequestHours({
    requestType: 'overtime',
    dateFrom: dateFrom || new Date().toISOString().slice(0, 10),
    timeFrom,
    timeTo,
    timeSchedule: timeSchedule && timeSchedule !== 'No Schedule' ? timeSchedule : DEFAULT_OFFICIAL_SCHEDULE,
    dayOff: dayOff && dayOff !== 'No Day Off' ? dayOff : '',
  });

  return hours > 0 ? hours : null;
}

export const HALF_DAY_OFFSET_HOURS = 4;

export function isValidUseOffsetHours(hours: number): boolean {
  return hours === HALF_DAY_OFFSET_HOURS || hours === WHOLE_DAY_OFFSET_HOURS;
}

export function getUseOffsetValidationWarning(hours: number): string | null {
  if (hours <= 0) {
    return 'Time From and Time To must result in a valid duration.';
  }
  if (hours < HALF_DAY_OFFSET_HOURS) {
    return `The minimum Use Offset duration is ${HALF_DAY_OFFSET_HOURS.toFixed(2)} hrs (half day). This request currently has ${hours.toFixed(2)} hrs.`;
  }
  if (hours > WHOLE_DAY_OFFSET_HOURS) {
    return `Use Offset cannot exceed ${WHOLE_DAY_OFFSET_HOURS.toFixed(2)} hrs (whole day / total working hours). This request currently has ${hours.toFixed(2)} hrs.`;
  }
  if (!isValidUseOffsetHours(hours)) {
    return `Use Offset must be set to ${HALF_DAY_OFFSET_HOURS.toFixed(2)} hrs (half day) or ${WHOLE_DAY_OFFSET_HOURS.toFixed(2)} hrs (whole day). This request currently has ${hours.toFixed(2)} hrs.`;
  }
  return null;
}
