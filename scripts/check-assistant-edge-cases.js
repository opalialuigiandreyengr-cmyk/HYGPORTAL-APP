const fs = require('fs');
const path = require('path');
const typescript = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2019,
    },
  }).outputText;
  module._compile(output, filename);
};

const { createAssistantReply } = require(path.join('..', 'src', 'services', 'assistant.ts'));
const { calculateRequestHours } = require(path.join('..', 'src', 'utils', 'requestCalculations.ts'));
const { calculateLeaveDays } = require(path.join('..', 'src', 'utils', 'dateTime.ts'));
const { getDisabledLeaveTypes, getLeaveBreakdown } = require(path.join('..', 'src', 'utils', 'requestCalculations.ts'));

const context = {
  leaveCreditRemaining: 1,
  offsetBalance: 2,
};

const failures = [];

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(label, actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    failures.push(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function getDraft(input) {
  const reply = createAssistantReply(input, context);
  if (reply.type !== 'draft') {
    failures.push(`${input}: expected draft reply, got ${reply.type}`);
    return null;
  }
  return reply.draft;
}

const overnightMonthDraft = getDraft('file overtime may 5 8am to may 6 3am because inventory');
if (overnightMonthDraft?.intent === 'draft_esarf_request') {
  assertDeepEqual('overnight month date ESARF fields', overnightMonthDraft.fields, {
    schedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
    payrollClass: 'Rank and File',
    transactions: ['ot'],
    dateFrom: '2026-05-05',
    dateTo: '2026-05-06',
    timeFrom: '08:00',
    timeTo: '03:00',
    reason: 'Inventory',
  });
}

const explicitDateDraft = getDraft('file overtime 2026-05-05 8am to 3am because inventory');
if (explicitDateDraft?.intent === 'draft_esarf_request') {
  assertEqual('explicit date timeFrom', explicitDateDraft.fields.timeFrom, '08:00');
  assertEqual('explicit date timeTo', explicitDateDraft.fields.timeTo, '03:00');
}

const useOffsetDraft = getDraft('gamit offset may 20 8am to 10am because personal');
if (useOffsetDraft?.intent === 'draft_esarf_request') {
  assertDeepEqual('use offset transaction', useOffsetDraft.fields.transactions, ['use_offset']);
}

assertEqual(
  'use offset selected range counts full hours',
  calculateRequestHours({
    requestType: 'use_offset',
    dateFrom: '2026-05-20',
    timeFrom: '08:00',
    timeTo: '10:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
  }),
  2,
);

assertEqual(
  'overtime selected range counts outside schedule only',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-05-20',
    timeFrom: '08:00',
    timeTo: '10:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
  }),
  1,
);

assertEqual(
  'overtime 6am to 6pm with official working hours 9am to 6pm yields 3 hours',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-05-20',
    timeFrom: '06:00',
    timeTo: '18:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
  }),
  3,
);

assertEqual(
  'overtime 7am to 8pm with official working hours 9am to 6pm yields 4 hours',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-05-20',
    timeFrom: '07:00',
    timeTo: '20:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
    isFullHours: false,
  }),
  4,
);

assertEqual(
  'fio or ob without overtime counts full time range including break time',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-05-20',
    timeFrom: '06:00',
    timeTo: '18:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
    isFullHours: true,
  }),
  12,
);

assertEqual(
  'undertime 9am to 3pm counts rendered time including break time',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-05-20',
    timeFrom: '09:00',
    timeTo: '15:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
    isFullHours: true,
  }),
  6,
);

assertEqual(
  'undertime 9am to 12pm has no lunch overlap and yields 3 hours',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-05-20',
    timeFrom: '09:00',
    timeTo: '12:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sun',
    isFullHours: true,
  }),
  3,
);

assertEqual('overnight request range', calculateRequestHours({
  requestType: 'use_offset',
  dateFrom: '2026-05-20',
  timeFrom: '20:00',
  timeTo: '03:00',
  timeSchedule: '9:00AM - 6:00PM',
  dayOff: 'Sun',
}), 7);

const { parseDayOffList, isDateDayOff } = require(path.join('..', 'src', 'utils', 'requestCalculations.ts'));

assertDeepEqual('parse multi-day off Saturday, Sunday', parseDayOffList('Saturday, Sunday'), ['Sat', 'Sun']);
assertDeepEqual('parse multi-day off Sat / Sun', parseDayOffList('Sat / Sun'), ['Sat', 'Sun']);
assertDeepEqual('parse multi-day off Sat & Sun', parseDayOffList('Sat & Sun'), ['Sat', 'Sun']);

assertEqual(
  'Saturday overtime 9am to 6pm with Saturday, Sunday dayOff credits 9 full worked hours',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-08-15', // Saturday
    timeFrom: '09:00',
    timeTo: '18:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Saturday, Sunday',
  }),
  9,
);

assertEqual(
  'Sunday offset 9am to 6pm with Sat / Sun dayOff credits 9 full worked hours',
  calculateRequestHours({
    requestType: 'offset_earn',
    dateFrom: '2026-08-16', // Sunday
    timeFrom: '09:00',
    timeTo: '18:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Sat / Sun',
  }),
  9,
);

assertEqual(
  'Monday overtime with Saturday, Sunday dayOff deducts regular schedule hours',
  calculateRequestHours({
    requestType: 'overtime',
    dateFrom: '2026-08-17', // Monday
    timeFrom: '09:00',
    timeTo: '18:00',
    timeSchedule: '9:00AM - 6:00PM',
    dayOff: 'Saturday, Sunday',
  }),
  0,
);

assertEqual('inclusive leave days', calculateLeaveDays('2026-05-20', '2026-05-21'), 2);
assertDeepEqual('leave credits disable paid options', getDisabledLeaveTypes(2, context.leaveCreditRemaining), ['With Pay']);

const bothBreakdown = getLeaveBreakdown('Both', 2, '1', '1');
assertDeepEqual('both leave split', bothBreakdown, {
  paidDays: 1,
  unpaidDays: 1,
  isValid: true,
});

const offsetAnswer = createAssistantReply('can i still use offset?', context);
assertEqual('offset answer type', offsetAnswer.type, 'answer');

if (failures.length) {
  console.error('Assistant edge-case checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Assistant edge-case checks passed.');
