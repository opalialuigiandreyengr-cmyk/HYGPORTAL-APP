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

assertEqual('overnight request range', calculateRequestHours({
  requestType: 'use_offset',
  dateFrom: '2026-05-20',
  timeFrom: '20:00',
  timeTo: '03:00',
  timeSchedule: '9:00AM - 6:00PM',
  dayOff: 'Sun',
}), 7);

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
