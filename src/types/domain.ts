export type AuthorityLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type RequestTypeCode = 'overtime' | 'offset_earn' | 'use_offset' | 'leave';

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'needs_admin_review';

export type ApprovalStepStatus =
  | 'waiting'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'skipped'
  | 'cancelled'
  | 'admin_fallback';

export type EmployeeAssignment = {
  id: string;
  employeeId: string;
  companyId: string;
  areaId?: string | null;
  clusterId?: string | null;
  storeId?: string | null;
  positionId: string;
  functionId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type EmployeeProfileSummary = {
  profileId: string;
  appRole: string;
  employeeId: string;
  fullName: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  username?: string | null;
  employeeNo?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  religion?: string | null;
  birthPlace?: string | null;
  nationality?: string | null;
  civilStatus?: string | null;
  cellphone?: string | null;
  otherPhone?: string | null;
  socialMediaType?: string | null;
  socialMediaDetail?: string | null;
  employmentStatus: string;
  companyName?: string | null;
  areaName?: string | null;
  clusterName?: string | null;
  storeName?: string | null;
  departmentName?: string | null;
  positionName?: string | null;
  dateHired?: string | null;
  employeeType?: string | null;
  tin?: string | null;
  sss?: string | null;
  pagibig?: string | null;
  philhealth?: string | null;
  bankType?: string | null;
  accountNo?: string | null;
  education?: string | null;
  elementarySchool?: string | null;
  elementaryYear?: string | null;
  secondarySchool?: string | null;
  secondaryYear?: string | null;
  collegeSchool?: string | null;
  collegeYear?: string | null;
  collegeCourse?: string | null;
  yearGraduated?: string | null;
  height?: string | null;
  weight?: string | null;
  presentAddress?: string | null;
  zipCode?: string | null;
  permanentAddress?: string | null;
  emergencyContact?: string | null;
  fatherName?: string | null;
  fatherOccupation?: string | null;
  motherMaidenName?: string | null;
  motherOccupation?: string | null;
  numberOfSiblings?: string | null;
  birthOrder?: string | null;
  spouseName?: string | null;
  spouseOccupation?: string | null;
  spouseContact?: string | null;
  childrenNames?: string | null;
  childrenCount?: string | null;
  authorityLevel?: AuthorityLevel | null;
  functionName?: string | null;
};

export type ProfileLoadResult =
  | {
      status: 'linked';
      profile: EmployeeProfileSummary;
    }
  | {
      status: 'not_linked';
      message: string;
      debug?: string;
    }
  | {
      status: 'schema_missing';
      message: string;
    }
  | {
      status: 'error';
      message: string;
      debug?: string;
    };
