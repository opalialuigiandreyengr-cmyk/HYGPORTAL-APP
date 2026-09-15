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

