export function dateStringToDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

export function timeStringToDate(value: string) {
  const [hour, minute, second] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(
    Number.isNaN(hour) ? 0 : hour,
    Number.isNaN(minute) ? 0 : minute,
    Number.isNaN(second) ? 0 : second,
    0,
  );
  return date;
}

export function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimeInput(date: Date) {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${hour}:${minute}:${second}`;
}

export function formatTimeDisplay(value: string) {
  const parts = value.split(':').map(Number);
  const rawHour = parts[0];
  const rawMinute = parts[1];
  const rawSecond = parts.length > 2 ? parts[2] : undefined;
  if (Number.isNaN(rawHour) || Number.isNaN(rawMinute)) {
    return value;
  }
  const period = rawHour >= 12 ? 'PM' : 'AM';
  const hour = rawHour % 12 || 12;
  const minStr = String(rawMinute).padStart(2, '0');
  if (rawSecond !== undefined && !Number.isNaN(rawSecond)) {
    const secStr = String(rawSecond).padStart(2, '0');
    return `${hour}:${minStr}:${secStr} ${period}`;
  }
  return `${hour}:${minStr} ${period}`;
}

export function calculateLeaveDays(dateFrom: string, dateTo: string) {
  const start = dateStringToDate(dateFrom);
  const end = dateStringToDate(dateTo);
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
    return 0;
  }

  return Math.round(((endTime - startTime) / 86400000 + 1) * 100) / 100;
}

/**
 * Calculates the exact difference in calendar days between two YYYY-MM-DD date strings.
 * Returns 0 if same day, 1 if following consecutive day, negative if endDate is before startDate.
 */
export function getDaysBetweenYMD(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / 86400000);
}

/**
 * Validates that an ESARF date range is either a single day (0 days diff)
 * or two days that follow one another (1 day diff, e.g. overnight overtime).
 */
export function isValidEsarfDateRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  const diff = getDaysBetweenYMD(startDate, endDate);
  return diff === 0 || diff === 1;
}

/**
 * Parses formatted ESARF date strings (e.g. '09/22-23/26', '09/23-23/26', '09/23/2026',
 * '02/28-03/01/26', '12/31/26-01/01/27') back into YYYY-MM-DD dateFrom and dateTo.
 */
export function parseEsarfDateRangeStringToYMD(
  dateStr?: string | null,
  fallbackYear: number = new Date().getFullYear(),
): { dateFrom: string; dateTo: string } | null {
  if (!dateStr || dateStr === 'mm/dd-dd/yyyy' || dateStr === '--') return null;
  const s = dateStr.trim();

  const toFullYear = (yStr: string) => {
    const num = parseInt(yStr, 10);
    if (isNaN(num)) return fallbackYear;
    return yStr.length <= 2 ? 2000 + num : num;
  };

  // Cross year: MM/DD/YY-MM/DD/YY or MM/DD/YYYY-MM/DD/YYYY (with optional spaces around hyphen)
  const crossYear = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (crossYear) {
    const [, m1, d1, y1, m2, d2, y2] = crossYear;
    return {
      dateFrom: `${toFullYear(y1)}-${m1.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      dateTo: `${toFullYear(y2)}-${m2.padStart(2, '0')}-${d2.padStart(2, '0')}`,
    };
  }

  // Cross month: MM/DD-MM/DD/YY or MM/DD-MM/DD/YYYY
  const crossMonth = s.match(/^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (crossMonth) {
    const [, m1, d1, m2, d2, y] = crossMonth;
    const fullYear = toFullYear(y);
    return {
      dateFrom: `${fullYear}-${m1.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      dateTo: `${fullYear}-${m2.padStart(2, '0')}-${d2.padStart(2, '0')}`,
    };
  }

  // Same month: MM/DD-DD/YY or MM/DD-DD/YYYY
  const sameMonth = s.match(/^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{2,4})$/);
  if (sameMonth) {
    const [, m, d1, d2, y] = sameMonth;
    const fullYear = toFullYear(y);
    return {
      dateFrom: `${fullYear}-${m.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      dateTo: `${fullYear}-${m.padStart(2, '0')}-${d2.padStart(2, '0')}`,
    };
  }

  // Two full dates separated by dash: MM/DD/YYYY-MM/DD/YYYY
  const twoDates = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (twoDates) {
    const [, m1, d1, y1, m2, d2, y2] = twoDates;
    return {
      dateFrom: `${toFullYear(y1)}-${m1.padStart(2, '0')}-${d1.padStart(2, '0')}`,
      dateTo: `${toFullYear(y2)}-${m2.padStart(2, '0')}-${d2.padStart(2, '0')}`,
    };
  }

  // Single date: MM/DD/YY or MM/DD/YYYY
  const single = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (single) {
    const [, m, d, y] = single;
    const ymd = `${toFullYear(y)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return { dateFrom: ymd, dateTo: ymd };
  }

  return null;
}

/**
 * Parses 12-hour formatted time (e.g. '9:00 AM', '04:30 PM') to 24-hour 'HH:MM'.
 */
export function parse12HourDisplayTo24(timeStr?: string | null): string | null {
  if (!timeStr || timeStr === '--:--' || timeStr === '--') return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const period = match[3].toUpperCase();
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m}`;
}


