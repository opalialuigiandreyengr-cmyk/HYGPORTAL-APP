export function dateStringToDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

export function timeStringToDate(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(Number.isNaN(hour) ? 0 : hour, Number.isNaN(minute) ? 0 : minute, 0, 0);
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
  return `${hour}:${minute}`;
}

export function formatTimeDisplay(value: string) {
  const [rawHour, rawMinute] = value.split(':').map(Number);
  if (Number.isNaN(rawHour) || Number.isNaN(rawMinute)) {
    return value;
  }
  const period = rawHour >= 12 ? 'PM' : 'AM';
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(rawMinute).padStart(2, '0')} ${period}`;
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
