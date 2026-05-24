export const assistantDefaults = {
  esarfSchedule: '9:00AM - 6:00PM',
  esarfDayOff: 'Sun',
  esarfPayrollClass: 'Rank and File',
};

export const assistantFallbacks = {
  empty: 'Tell me what you want to apply or check.',
  unknown:
    'I can help draft Leave, ESARF, and Perk requests. Try: "File overtime today 6pm to 9pm because store closing."',
  welcome:
    'Tell me what you want to apply or check. HYG Assist can draft Leave, ESARF, Perk, and Use Offset requests, plus check your leave credits and offset balance.',
};

export const assistantRequestTemplates = [
  'Apply sick leave tomorrow because fever',
  'File overtime today 6pm to 9pm because store closing',
  'Can I still use offset?',
  'Check my leave credits',
];

export const assistantFaqQuestions = [
  'What is ESARF?',
  'I forgot to punch out',
  'Who approves my request?',
  'What is the ESARF cutoff?',
  'With pay vs without pay?',
  'What is Offset Earn?',
  'Can I still use offset?',
  'Where can I see my request?',
  'How do I file overtime?',
  'How do I file undertime?',
  'What is Official Business?',
  'What if my request is rejected?',
  'Can I edit a submitted request?',
  'How many leave credits do I have?',
  'What is employee discount?',
  'What is employee charge?',
  'Why is my approver missing?',
  'How do I update my profile?',
  'What if I selected the wrong date?',
  'What if I have no leave credits?',
];

export const assistantFaqRules = [
  {
    keywords: ['what is esarf', 'ano ang esarf', 'esarf meaning', 'meaning of esarf'],
    answer:
      'ESARF is used for time-related requests such as Overtime, Undertime, Failure to Punch In/Out, Official Business, Offset Earn, and Use Offset.',
  },
  {
    keywords: ['what should i file', 'ano dapat i file', 'worked beyond schedule', 'worked after schedule'],
    answer:
      'If you worked beyond your scheduled hours, file ESARF and choose Overtime. HYG Assist can draft it if you include the date, time range, and reason.',
  },
  {
    keywords: ['how do i file overtime'],
    answer:
      'To file overtime, use ESARF and choose Overtime. Include the work date, time from, time to, and reason. Example: "File overtime May 20 6pm to 9pm because store closing."',
  },
  {
    keywords: ['how do i file undertime'],
    answer: 'To file undertime, use ESARF and choose Undertime. Include the date, time range, and reason for the undertime.',
  },
  {
    keywords: ['forgot to punch', 'forgot punch', 'missed punch', 'no time in', 'no time out'],
    answer:
      'For a missed time-in or time-out, file ESARF and choose Failure to Punch In/Out (FIO). Include the date, missed punch, and reason.',
  },
  {
    keywords: ['official business', ' ob ', 'outside work', 'field work'],
    answer: 'For approved work outside the usual workplace or schedule, file ESARF and choose Official Business (OB).',
  },
  {
    keywords: ['earn offset', 'offset earn', 'earned offset'],
    answer: 'Use Offset Earn when you worked hours that should be added to your offset balance. After final approval, those hours are credited.',
  },
  {
    keywords: ['paid leave', 'with pay', 'without pay', 'leave with pay'],
    answer:
      'With Pay leave uses available leave credits after approval. Without Pay does not use leave credits.',
  },
  {
    keywords: ['approver missing', 'no approver', 'missing approver'],
    answer:
      'If an approver is missing, the approval engine should escalate to the next available higher approver. If no approver is found, the request may need admin review.',
  },
  {
    keywords: ['who approves', 'approver', 'approval route', 'sino mag approve'],
    answer:
      'Approval depends on your position, department, company, authority level, and request type. You can track the current approver from the Requests tab after submission.',
  },
  {
    keywords: ['request rejected', 'request is rejected', 'rejected request', 'if rejected'],
    answer:
      'If a request is rejected, check the rejection reason in Requests. You may need to submit a new corrected request.',
  },
  {
    keywords: ['edit submitted', 'change submitted', 'edit request', 'wrong date'],
    answer:
      'Submitted requests cannot be safely changed from HYG Assist. If the date or details are wrong, cancel or ask admin guidance if available, then submit a corrected request.',
  },
  {
    keywords: ['where to see request', 'my request', 'submitted request', 'track request'],
    answer: 'Open the Requests tab to track submitted requests, status, and approval steps.',
  },
  {
    keywords: ['deadline', 'cutoff', 'payroll cutoff', 'esarf cutoff'],
    answer: 'For ESARF, submit approved forms on or before the 5th and 20th payroll cutoffs.',
  },
  {
    keywords: ['what is employee charge', 'employee charge'],
    answer:
      'Employee Charge is a credit purchase request under Perks. It may require product details, amount validation, and email verification.',
  },
  {
    keywords: ['employee discount', 'cash discount', 'perk'],
    answer:
      'Perks include Employee Discount for cash purchases and Employee Charge for credit purchases. Product details and email verification are required before approval.',
  },
  {
    keywords: ['update my profile', 'change profile', 'profile photo', 'profile details'],
    answer:
      'Open the Profile tab to review or update your employee details. Some company or position details may require admin updates.',
  },
  {
    keywords: ['no leave credits', 'zero leave credits', 'not enough leave'],
    answer:
      'If you have no enough paid leave credits, choose Without Pay or Both when filing leave. Paid leave cannot exceed your available credits.',
  },
];
