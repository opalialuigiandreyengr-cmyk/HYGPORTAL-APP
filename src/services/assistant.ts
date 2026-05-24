import { formatDateInput } from '../utils/dateTime';
import { assistantDefaults, assistantFallbacks, assistantFaqRules } from '../constants/assistantKnowledge';

export type AssistantIntent =
  | 'draft_esarf_request'
  | 'draft_leave_request'
  | 'draft_perk_request'
  | 'check_leave_credits'
  | 'check_offset_balance'
  | 'check_request_status'
  | 'explain_request_type'
  | 'unknown';

export type AssistantDraft =
  | {
      intent: 'draft_leave_request';
      confidence: number;
      fields: {
        startDate?: string;
        endDate?: string;
        leaveType?: string;
        leaveCategory?: string;
        reason?: string;
      };
      missingFields: string[];
      summary: string;
    }
  | {
      intent: 'draft_esarf_request';
      confidence: number;
      fields: {
        schedule?: string;
        dayOff?: string;
        payrollClass?: string;
        transactions?: string[];
        dateFrom?: string;
        dateTo?: string;
        timeFrom?: string;
        timeTo?: string;
        reason?: string;
      };
      missingFields: string[];
      summary: string;
    }
  | {
      intent: 'draft_perk_request';
      confidence: number;
      fields: {
        mode?: 'cash' | 'charge';
        transactionDate?: string;
        productName?: string;
        quantity?: string;
        unitPrice?: string;
      };
      missingFields: string[];
      summary: string;
    };

export type AssistantReply =
  | {
      type: 'draft';
      message: string;
      draft: AssistantDraft;
    }
  | {
      type: 'answer';
      intent: Exclude<AssistantIntent, 'draft_esarf_request' | 'draft_leave_request' | 'draft_perk_request'>;
      message: string;
    };

export function createAssistantReply(input: string, context: { leaveCreditRemaining: number; offsetBalance: number }): AssistantReply {
  const text = input.trim();
  const normalized = text.toLowerCase();

  if (!text) {
    return {
      type: 'answer',
      intent: 'unknown',
      message: assistantFallbacks.empty,
    };
  }

  const faqAnswer = findFaqAnswer(normalized, context);
  if (faqAnswer) {
    return {
      type: 'answer',
      intent: 'explain_request_type',
      message: faqAnswer,
    };
  }

  if (containsAny(normalized, ['leave credit', 'leave balance', 'credits', 'available leave', 'ilang leave', 'ilan leave'])) {
    return {
      type: 'answer',
      intent: 'check_leave_credits',
      message: `You have ${context.leaveCreditRemaining.toFixed(2)} paid leave day(s) available.`,
    };
  }

  if (
    containsAny(normalized, [
      'offset balance',
      'offset credit',
      'how many offset',
      'can i still use offset',
      'ilang offset',
      'ilan offset',
      'may offset',
    ])
  ) {
    const balance = context.offsetBalance;
    return {
      type: 'answer',
      intent: 'check_offset_balance',
      message:
        balance > 0
          ? `You have ${balance.toFixed(2)} offset hour(s) available. You can use offset up to this balance.`
          : 'You do not have offset hours available right now.',
    };
  }

  if (containsAny(normalized, ['status', 'pending', 'approved', 'approval', 'where is my request'])) {
    return {
      type: 'answer',
      intent: 'check_request_status',
      message: 'Open Requests to see submitted items, or Approvals if you are checking items waiting for your action.',
    };
  }

  if (containsAny(normalized, ['discount', 'charge', 'perk', 'employee purchase', 'employee discount', 'employee charge'])) {
    const date = extractDate(normalized);
    const amount = extractAmount(normalized);
    const mode = containsAny(normalized, ['charge', 'credit']) ? 'charge' : 'cash';
    const draft: AssistantDraft = {
      intent: 'draft_perk_request',
      confidence: 0.72,
      fields: {
        mode,
        transactionDate: date,
        unitPrice: amount,
      },
      missingFields: ['product name', 'quantity'],
      summary: `${mode === 'cash' ? 'Cash discount' : 'Employee charge'}${date ? ` on ${date}` : ''}.`,
    };
    return {
      type: 'draft',
      message: 'I made a perk request draft. Product details still need checking.',
      draft,
    };
  }

  if (
    containsAny(normalized, [
      'leave',
      'vacation',
      'sick',
      'emergency',
      'maternity',
      'paternity',
      'bereavement',
      'absent',
      'mag leave',
      'mag-leave',
      'sakit',
      'may sakit',
      'lagnat',
    ])
  ) {
    const dates = extractDateRange(normalized);
    const reason = extractReason(text);
    const category = inferLeaveCategory(normalized);
    const missingFields = [];
    if (!dates.startDate) missingFields.push('start date');
    if (!reason) missingFields.push('reason');

    const draft: AssistantDraft = {
      intent: 'draft_leave_request',
      confidence: missingFields.length ? 0.78 : 0.9,
      fields: {
        startDate: dates.startDate,
        endDate: dates.endDate ?? dates.startDate,
        leaveType: 'With Pay',
        leaveCategory: category,
        reason,
      },
      missingFields,
      summary: `${category}${dates.startDate ? ` from ${dates.startDate}` : ''}${
        dates.endDate && dates.endDate !== dates.startDate ? ` to ${dates.endDate}` : ''
      }.`,
    };
    return {
      type: 'draft',
      message: missingFields.length ? 'I started a leave draft. Please complete the missing details.' : 'I made a leave draft for review.',
      draft,
    };
  }

  if (
    containsAny(normalized, [
      'esarf',
      'overtime',
      ' ot',
      'offset',
      'undertime',
      ' ut',
      'fio',
      'official business',
      ' ob',
      'mag ot',
      'mag-ot',
      'nag overtime',
      'gamit offset',
      'use offset',
    ])
  ) {
    const dates = extractDateRange(normalized);
    const timeRange = extractTimeRange(normalized);
    const transactions = inferEsarfTransactions(normalized);
    const reason = extractReason(text);
    const missingFields = [];
    if (!transactions.length) missingFields.push('transaction type');
    if (!dates.startDate) missingFields.push('date');
    if (!timeRange.timeFrom) missingFields.push('time from');
    if (!timeRange.timeTo) missingFields.push('time to');
    if (!reason) missingFields.push('reason');

    const draft: AssistantDraft = {
      intent: 'draft_esarf_request',
      confidence: missingFields.length ? 0.74 : 0.89,
      fields: {
        schedule: assistantDefaults.esarfSchedule,
        dayOff: assistantDefaults.esarfDayOff,
        payrollClass: assistantDefaults.esarfPayrollClass,
        transactions,
        dateFrom: dates.startDate,
        dateTo: dates.endDate ?? dates.startDate,
        timeFrom: timeRange.timeFrom,
        timeTo: timeRange.timeTo,
        reason,
      },
      missingFields,
      summary: `${transactions.length ? transactions.join(', ') : 'ESARF'}${dates.startDate ? ` on ${dates.startDate}` : ''}${
        dates.endDate && dates.endDate !== dates.startDate ? ` to ${dates.endDate}` : ''
      }${
        timeRange.timeFrom && timeRange.timeTo ? `, ${timeRange.timeFrom} to ${timeRange.timeTo}` : ''
      }.`,
    };
    return {
      type: 'draft',
      message: missingFields.length ? 'I started an ESARF draft. Please complete the missing details.' : 'I made an ESARF draft for review.',
      draft,
    };
  }

  return {
    type: 'answer',
    intent: 'explain_request_type',
    message: assistantFallbacks.unknown,
  };
}

function findFaqAnswer(text: string, context: { leaveCreditRemaining: number; offsetBalance: number }) {
  const hasRequestDetails = Boolean(extractDateRange(text).startDate || extractTimeRange(text).timeFrom);

  if (containsAny(text, ['use offset', 'gamit offset', 'offset gamitin']) && !hasRequestDetails) {
    return context.offsetBalance > 0
      ? `Use Offset lets you consume approved offset hours. You currently have ${context.offsetBalance.toFixed(2)} hour(s), and your request cannot exceed that balance.`
      : 'Use Offset lets you consume approved offset hours, but you currently have no available offset balance.';
  }

  if (containsAny(text, ['paid leave', 'with pay', 'without pay', 'leave with pay'])) {
    return `With Pay leave uses available leave credits after approval. You currently have ${context.leaveCreditRemaining.toFixed(2)} paid leave day(s). Without Pay does not use leave credits.`;
  }

  const faqRule = assistantFaqRules.find((rule) => containsAny(text, rule.keywords));
  if (faqRule) {
    return faqRule.answer;
  }

  return '';
}

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function extractDateRange(text: string) {
  const explicitDates = Array.from(text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)).map((match) =>
    formatDateParts(Number(match[1]), Number(match[2]), Number(match[3])),
  );
  if (explicitDates.length) {
    return { startDate: explicitDates[0], endDate: explicitDates[1] ?? explicitDates[0] };
  }

  const monthDateRange = extractMonthDateRange(text);
  if (monthDateRange.startDate) {
    return monthDateRange;
  }

  const relative = extractDate(text);
  return { startDate: relative, endDate: relative };
}

function extractDate(text: string) {
  const explicit = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (explicit) {
    return formatDateParts(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]));
  }

  const monthDateRange = extractMonthDateRange(text);
  if (monthDateRange.startDate) {
    return monthDateRange.startDate;
  }

  const today = startOfToday();
  if (text.includes('yesterday')) return formatDateInput(addDays(today, -1));
  if (text.includes('tomorrow')) return formatDateInput(addDays(today, 1));
  if (text.includes('today')) return formatDateInput(today);

  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].find((day) =>
    text.includes(day),
  );
  if (weekday) {
    return formatDateInput(nextWeekday(today, weekday));
  }

  return undefined;
}

function extractMonthDateRange(text: string) {
  const monthDates = Array.from(
    text.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/g,
    ),
  )
    .map((match) => ({
      month: monthIndex(match[1]),
      day: Number(match[2]),
      year: match[3] ? Number(match[3]) : new Date().getFullYear(),
    }))
    .filter((item) => item.month >= 0 && item.day >= 1 && item.day <= 31);

  if (monthDates.length >= 2) {
    const start = monthDates[0];
    const end = normalizeEndDate(start, monthDates[1]);
    return {
      startDate: formatDateParts(start.year, start.month + 1, start.day),
      endDate: formatDateParts(end.year, end.month + 1, end.day),
    };
  }

  const compactRange = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\s+(?:to|until|-)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/,
  );
  if (compactRange) {
    const month = monthIndex(compactRange[1]);
    const year = compactRange[4] ? Number(compactRange[4]) : new Date().getFullYear();
    const start = { month, day: Number(compactRange[2]), year };
    const end = normalizeEndDate(start, { month, day: Number(compactRange[3]), year });
    return {
      startDate: formatDateParts(start.year, start.month + 1, start.day),
      endDate: formatDateParts(end.year, end.month + 1, end.day),
    };
  }

  if (monthDates.length === 1) {
    const date = monthDates[0];
    return {
      startDate: formatDateParts(date.year, date.month + 1, date.day),
      endDate: formatDateParts(date.year, date.month + 1, date.day),
    };
  }

  return { startDate: undefined, endDate: undefined };
}

function extractTimeRange(text: string) {
  const dateNumberSpans = getDateNumberSpans(text);
  const matches = Array.from(text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g))
    .map((match) => ({
      raw: match[0],
      hour: Number(match[1]),
      minute: Number(match[2] ?? 0),
      meridiem: match[3] as 'am' | 'pm' | undefined,
      index: match.index ?? 0,
    }))
    .filter((match) => {
      const numberEndIndex = match.index + String(match.hour).length;
      return (
        match.hour >= 1 &&
        match.hour <= 12 &&
        !/20\d{2}/.test(match.raw) &&
        !dateNumberSpans.some((span) => match.index >= span.start && numberEndIndex <= span.end)
      );
    });

  if (matches.length < 2) {
    return {};
  }

  const [first, second] = matches;
  const fallbackMeridiem = second.meridiem ?? first.meridiem;
  return {
    timeFrom: formatTime(first.hour, first.minute, first.meridiem ?? fallbackMeridiem),
    timeTo: formatTime(second.hour, second.minute, second.meridiem ?? fallbackMeridiem),
  };
}

function getDateNumberSpans(text: string) {
  const spans: { start: number; end: number }[] = [];

  for (const match of text.matchAll(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length });
  }

  const monthDatePattern =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/g;
  for (const match of text.matchAll(monthDatePattern)) {
    const matchStart = match.index ?? 0;
    const dayOffset = match[0].indexOf(match[2]);
    if (dayOffset >= 0) {
      spans.push({ start: matchStart + dayOffset, end: matchStart + dayOffset + match[2].length });
    }
  }

  const compactPattern =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\s+(?:to|until|-)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/g;
  for (const match of text.matchAll(compactPattern)) {
    const matchStart = match.index ?? 0;
    const dayOneOffset = match[0].indexOf(match[2]);
    const dayTwoOffset = match[0].lastIndexOf(match[3]);
    if (dayOneOffset >= 0) {
      spans.push({ start: matchStart + dayOneOffset, end: matchStart + dayOneOffset + match[2].length });
    }
    if (dayTwoOffset >= 0) {
      spans.push({ start: matchStart + dayTwoOffset, end: matchStart + dayTwoOffset + match[3].length });
    }
  }

  return spans;
}

function inferEsarfTransactions(text: string) {
  const transactions: string[] = [];
  if (containsAny(text, ['undertime', ' ut ', 'late out'])) transactions.push('ut');
  if (containsAny(text, ['overtime', ' ot ', 'mag ot', 'mag-ot', 'nag overtime'])) transactions.push('ot');
  if (containsAny(text, ['failure to punch', 'fio'])) transactions.push('fio');
  if (containsAny(text, ['official business', ' ob '])) transactions.push('ob');
  if (containsAny(text, ['use offset', 'gamit offset', 'use my offset'])) transactions.push('use_offset');
  else if (text.includes('offset')) transactions.push('offset');
  return transactions.length ? transactions : ['ot'];
}

function inferLeaveCategory(text: string) {
  if (containsAny(text, ['sick', 'sakit', 'may sakit', 'lagnat', 'fever'])) return 'Sick Leave';
  if (text.includes('emergency')) return 'Emergency Leave';
  if (text.includes('maternity')) return 'Maternity Leave';
  if (text.includes('paternity')) return 'Paternity Leave';
  if (text.includes('bereavement')) return 'Bereavement Leave';
  if (text.includes('birthday')) return 'Birthday Leave';
  return 'Vacation Leave';
}

function extractReason(text: string) {
  const match = text.match(/\b(?:because|reason is|for)\s+(.+)$/i);
  if (!match?.[1]) return '';
  return sentenceCase(match[1].trim().replace(/[.]+$/, ''));
}

function extractAmount(text: string) {
  const match = text.match(/\b(?:php|p)?\s*(\d+(?:\.\d{1,2})?)\b/i);
  return match?.[1];
}

function formatDateParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthIndex(value: string) {
  const month = value.slice(0, 3).toLowerCase();
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(month);
}

function normalizeEndDate(
  start: { year: number; month: number; day: number },
  end: { year: number; month: number; day: number },
) {
  const startDate = new Date(start.year, start.month, start.day);
  const endDate = new Date(end.year, end.month, end.day);
  if (endDate.getTime() >= startDate.getTime()) {
    return end;
  }

  return { ...end, year: end.year + 1 };
}

function formatTime(hour: number, minute: number, meridiem: 'am' | 'pm' | undefined) {
  let normalizedHour = hour;
  if (meridiem === 'pm' && normalizedHour < 12) normalizedHour += 12;
  if (meridiem === 'am' && normalizedHour === 12) normalizedHour = 0;
  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextWeekday(date: Date, weekday: string) {
  const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekday);
  const current = date.getDay();
  const diff = (target - current + 7) % 7 || 7;
  return addDays(date, diff);
}

function sentenceCase(value: string) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
