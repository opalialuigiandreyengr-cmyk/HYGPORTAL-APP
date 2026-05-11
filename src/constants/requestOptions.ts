import type { RequestTypeCode } from '../types/domain';

export const requestLabels: Record<RequestTypeCode, string> = {
  overtime: 'Overtime',
  offset_earn: 'Offset Earn',
  use_offset: 'Use Offset',
  leave: 'Leave',
};

export const scheduleOptions = [
  '9:00AM - 6:00PM',
  '8:30AM - 5:30PM',
  '9:00AM - 7:00PM',
  '8:00AM - 6:00PM',
];

export const dayOffOptions = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const payrollClassOptions = ['Rank and File', 'Admin', 'Managerial'];

export const leaveTypeOptions = ['With Pay', 'Without Pay', 'Both'];

export const leaveCategoryOptions = [
  'Vacation Leave',
  'Sick Leave',
  'Emergency Leave',
  'Maternity Leave',
  'Paternity Leave',
  'Bereavement Leave',
  'Birthday Leave',
  'Solo Parent Leave',
  'Service Incentive Leave',
];
