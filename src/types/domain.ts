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
  employeeNo?: string | null;
  email?: string | null;
  employmentStatus: string;
  companyName?: string | null;
  areaName?: string | null;
  clusterName?: string | null;
  storeName?: string | null;
  departmentName?: string | null;
  positionName?: string | null;
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
