import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { MyRequest } from './requests';
import type { PendingApproval, ApprovedApproval } from './approvals';
import type { EmployeeProfileSummary } from '../types/domain';

export type TravelOrderDetailsData = {
  requestId: string;
  destinationStores: string[];
  destinationsText: string;
  departureDate: string;
  returnDate: string;
  departureTime: string;
  returnTime: string;
  transportMode: string;
  plateNo: string;
  purposeOfTravel: string;
  purposeDetails: string;
  transportBudget: number;
  mealBudget: number;
  emergencyBudget: number;
  totalBudget: number;
  costCenterCode: string;
  chargeToStore: string;
  // Requester profile fields
  employeeNo: string;
  homeBranch: string;
  positionTitle: string;
  departmentName: string;
  requesterName: string;
  requesterPhotoUrl: string | null;
};

// In-memory cache for fast display
const travelDetailsCache = new Map<string, TravelOrderDetailsData>();

export function invalidateTravelOrderDetailsCache(requestId?: string) {
  if (requestId) {
    travelDetailsCache.delete(requestId);
  } else {
    travelDetailsCache.clear();
  }
}

export function parseFallbackFromReason(reasonText?: string | null): Partial<TravelOrderDetailsData> {
  if (!reasonText) return {};

  const result: Partial<TravelOrderDetailsData> = {};

  const destMatch = reasonText.match(/Destination:\s*([^|]+)/i);
  if (destMatch) {
    const rawDest = destMatch[1].trim();
    result.destinationsText = rawDest;
    result.destinationStores = rawDest.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const purposeMatch = reasonText.match(/Purpose:\s*([^(|]+)/i);
  if (purposeMatch) {
    result.purposeOfTravel = purposeMatch[1].trim();
  }

  const purposeDetailsMatch = reasonText.match(/\(([^)]+)\)/i);
  if (purposeDetailsMatch) {
    result.purposeDetails = purposeDetailsMatch[1].trim();
  }

  const transMatch = reasonText.match(/Transport:\s*([^[\n|]+)/i);
  if (transMatch) {
    result.transportMode = transMatch[1].trim();
  }

  const plateMatch = reasonText.match(/\[([^\]]+)\]/i);
  if (plateMatch) {
    result.plateNo = plateMatch[1].trim();
  }

  const budgetMatch = reasonText.match(/Budget:\s*(?:PHP)?\s*([\d,.]+)/i);
  if (budgetMatch) {
    const num = parseFloat(budgetMatch[1].replace(/,/g, ''));
    if (!isNaN(num)) {
      result.totalBudget = num;
    }
  }

  return result;
}

export async function fetchTravelOrderDetails(
  item: MyRequest | PendingApproval | ApprovedApproval,
  profile?: EmployeeProfileSummary | null
): Promise<TravelOrderDetailsData> {
  const reqId = item.request_id;
  const cached = travelDetailsCache.get(reqId);
  if (cached) {
    return cached;
  }

  // Initial defaults based on item and profile
  const fallback = parseFallbackFromReason(item.reason);
  const anyItem = item as any;

  const defaultData: TravelOrderDetailsData = {
    requestId: reqId,
    destinationStores: fallback.destinationStores || [],
    destinationsText: fallback.destinationsText || (fallback.destinationStores ? fallback.destinationStores.join(', ') : ''),
    departureDate: item.date_from || item.start_date || '',
    returnDate: item.date_to || item.end_date || item.date_from || item.start_date || '',
    departureTime: item.time_from || '',
    returnTime: item.time_to || '',
    transportMode: fallback.transportMode || '',
    plateNo: fallback.plateNo || '',
    purposeOfTravel: fallback.purposeOfTravel || '',
    purposeDetails: fallback.purposeDetails || '',
    transportBudget: 0,
    mealBudget: 0,
    emergencyBudget: 0,
    totalBudget: fallback.totalBudget || 0,
    costCenterCode: '000000',
    chargeToStore: profile?.storeName || profile?.departmentName || '',
    employeeNo: anyItem.requester_employee_no || profile?.employeeNo || '',
    homeBranch: profile?.storeName || profile?.departmentName || 'Burgos HQ',
    positionTitle: profile?.positionName || 'Staff',
    departmentName: anyItem.department_name || profile?.departmentName || profile?.storeName || 'Operations',
    requesterName: anyItem.requester_name || profile?.fullName || 'Requester',
    requesterPhotoUrl: anyItem.requester_photo_url || profile?.photoUrl || null,
  };

  if (!isSupabaseConfigured || !reqId) {
    travelDetailsCache.set(reqId, defaultData);
    return defaultData;
  }

  try {
    // 1. Fetch from travel_order_request_details
    const { data: detailsData, error: detailsErr } = await supabase
      .from('travel_order_request_details')
      .select('*')
      .eq('request_id', reqId)
      .maybeSingle();

    if (!detailsErr && detailsData) {
      if (Array.isArray(detailsData.destination_stores) && detailsData.destination_stores.length > 0) {
        defaultData.destinationStores = detailsData.destination_stores;
        defaultData.destinationsText = detailsData.destinations || detailsData.destination_stores.join(', ');
      } else if (detailsData.destinations) {
        defaultData.destinationsText = detailsData.destinations;
        defaultData.destinationStores = detailsData.destinations.split(',').map((s: string) => s.trim()).filter(Boolean);
      }

      if (detailsData.departure_date) defaultData.departureDate = detailsData.departure_date;
      if (detailsData.return_date) defaultData.returnDate = detailsData.return_date;
      if (detailsData.departure_time) defaultData.departureTime = detailsData.departure_time;
      if (detailsData.return_time) defaultData.returnTime = detailsData.return_time;
      if (detailsData.transport_mode) defaultData.transportMode = detailsData.transport_mode;
      if (detailsData.plate_no) defaultData.plateNo = detailsData.plate_no;
      if (detailsData.purpose_of_travel) defaultData.purposeOfTravel = detailsData.purpose_of_travel;
      if (detailsData.purpose_details) defaultData.purposeDetails = detailsData.purpose_details;

      defaultData.transportBudget = Number(detailsData.transport_budget || 0);
      defaultData.mealBudget = Number(detailsData.meal_budget || 0);
      defaultData.emergencyBudget = Number(detailsData.emergency_budget || 0);
      defaultData.totalBudget = Number(detailsData.total_budget || 0) || (defaultData.transportBudget + defaultData.mealBudget + defaultData.emergencyBudget);

      if (detailsData.cost_center_code) defaultData.costCenterCode = detailsData.cost_center_code;
      if (detailsData.charge_to_store) defaultData.chargeToStore = detailsData.charge_to_store;
    }

    // 2. If requester profile info is missing (e.g. viewed in ApprovalsScreen by an approver), fetch requester profile
    const empNo = anyItem.requester_employee_no || defaultData.employeeNo;
    const reqEmpId = anyItem.submitted_by_employee_id || anyItem.employee_id;

    if (empNo || reqEmpId) {
      let query = supabase.from('employees').select(`
        id,
        employee_no,
        first_name,
        last_name,
        photo_url,
        employee_assignments (
          positions (name),
          stores (name),
          departments (name)
        )
      `);

      if (empNo) {
        query = query.eq('employee_no', empNo);
      } else if (reqEmpId) {
        query = query.eq('id', reqEmpId);
      }

      const { data: empRecord } = await query.maybeSingle();

      if (empRecord) {
        if (empRecord.employee_no) defaultData.employeeNo = empRecord.employee_no;
        if (empRecord.photo_url && !defaultData.requesterPhotoUrl) {
          defaultData.requesterPhotoUrl = empRecord.photo_url;
        }

        const assignments = empRecord.employee_assignments as any[];
        if (assignments && assignments.length > 0) {
          const assign = assignments[0];
          if (assign?.stores?.name) defaultData.homeBranch = assign.stores.name;
          if (assign?.departments?.name) defaultData.departmentName = assign.departments.name;
          if (assign?.positions?.name) defaultData.positionTitle = assign.positions.name;
        }
      }
    }
  } catch (err) {
    console.warn('[fetchTravelOrderDetails] Non-fatal error loading travel order details:', err);
  }

  travelDetailsCache.set(reqId, defaultData);
  return defaultData;
}
