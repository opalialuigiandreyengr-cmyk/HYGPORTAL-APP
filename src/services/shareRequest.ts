import { Platform, Share } from 'react-native';
import type { EmployeeProfileSummary } from '../types/domain';
import type { MyRequest } from './requests';
import { formatUnifiedRequestCode, formatUnifiedRequestType } from '../components/EsarfDetailsView';
import { isAutoApprovedBirthdayGrant } from './birthdayLeave';

export const BASE_WEB_PORTAL_URL = 'https://hygportal.vercel.app';
export const APP_SCHEME = 'hygportal';

/**
 * Parses and extracts a requestId or request_id from incoming URLs
 * Supports:
 * - https://hygportal.vercel.app/?requestId=uuid
 * - https://hygportal.vercel.app/?action=approve&requestId=uuid
 * - hygportal://approval?requestId=uuid
 * - hygportal://request/uuid
 * - /approval/uuid or /request/uuid
 */
export function extractRequestIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cleanUrl = url.trim();
  if (!cleanUrl) return null;

  try {
    // 1. Regex check for query params ?requestId=... or ?request_id=... or ?id=...
    const queryMatch = cleanUrl.match(/[?&](?:requestId|request_id|id)=([a-zA-Z0-9_-]+)/i);
    if (queryMatch?.[1]) {
      return queryMatch[1].trim();
    }

    // 2. Normalize custom app scheme to HTTPS so standard URL parser can parse it safely
    const normalized = cleanUrl.startsWith('hygportal://')
      ? cleanUrl.replace('hygportal://', 'https://hygportal.vercel.app/')
      : cleanUrl;

    const urlObj = new URL(normalized);
    const paramId =
      urlObj.searchParams.get('requestId') ||
      urlObj.searchParams.get('request_id') ||
      urlObj.searchParams.get('id');
    if (paramId) return paramId.trim();

    // 3. Hash param check e.g. #/approval?requestId=...
    if (urlObj.hash) {
      const hashMatch = urlObj.hash.match(/[?&](?:requestId|request_id|id)=([a-zA-Z0-9_-]+)/i);
      if (hashMatch?.[1]) {
        return hashMatch[1].trim();
      }
    }

    // 4. Path parameter check e.g. /approval/:id or /request/:id
    const parts = urlObj.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && (parts[0] === 'approval' || parts[0] === 'request')) {
      const candidate = parts[parts.length - 1];
      if (candidate && candidate.length >= 8) {
        return candidate.trim();
      }
    }
  } catch {
    // Fallback regex
    const fallbackMatch = cleanUrl.match(/[?&](?:requestId|request_id|id)=([a-zA-Z0-9_-]+)/i);
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1].trim();
    }
  }
  return null;
}

export function generateShareUrl(requestId: string): string {
  return `${BASE_WEB_PORTAL_URL}/?requestId=${encodeURIComponent(requestId)}`;
}

export function generateAppSchemeUrl(requestId: string): string {
  return `${APP_SCHEME}://approval?requestId=${encodeURIComponent(requestId)}`;
}

export function formatShareMessage(
  item: MyRequest,
  profile?: EmployeeProfileSummary | null,
  sequence?: number
): { title: string; message: string; url: string } {
  const code = formatUnifiedRequestCode(item, sequence ?? 1);
  const type = isAutoApprovedBirthdayGrant(item) ? 'Birthday Leave Grant' : formatUnifiedRequestType(item);

  const parts = [
    profile?.firstName,
    profile?.middleName ? `${profile.middleName.trim()[0]}.` : null,
    profile?.lastName,
    profile?.suffix,
  ].filter(Boolean);
  const displayName = parts.length ? parts.join(' ') : profile?.fullName || 'Employee';
  const department = profile?.departmentName || profile?.storeName || '';

  const url = generateShareUrl(item.request_id);

  // Formatted date / schedule
  let scheduleStr = '';
  if (item.start_date || item.end_date) {
    scheduleStr = item.start_date || '';
    if (item.end_date && item.end_date !== item.start_date) {
      scheduleStr += ` to ${item.end_date}`;
    }
  } else if (item.date_from || item.date_to) {
    scheduleStr = item.date_from || '';
    if (item.date_to && item.date_to !== item.date_from) {
      scheduleStr += ` to ${item.date_to}`;
    }
  }

  if (item.time_from || item.time_to) {
    const time = `${item.time_from || ''}${item.time_to ? ` - ${item.time_to}` : ''}`;
    scheduleStr = scheduleStr ? `${scheduleStr} (${time})` : time;
  }

  const reason = item.reason ? item.reason.trim().replace(/\s+/g, ' ') : '';

  const messageLines = [
    `📋 HYG Portal - Approval Request`,
    `Ref Code: ${code}`,
    `Type: ${type}`,
    `Employee: ${displayName}${department ? ` (${department})` : ''}`,
    scheduleStr ? `Schedule: ${scheduleStr}` : null,
    reason ? `Reason: ${reason}` : null,
    ``,
    `👉 Review & Approve in HYG Portal:`,
    url,
  ].filter((line): line is string => line !== null);

  const message = messageLines.join('\n');
  const title = `HYG Portal: ${type} (${displayName})`;

  return { title, message, url };
}

export async function shareRequestViaMessenger(
  item: MyRequest,
  profile?: EmployeeProfileSummary | null,
  sequence?: number
): Promise<{ success: boolean; method: 'share' | 'clipboard'; error?: string }> {
  const { title, message, url } = formatShareMessage(item, profile, sequence);

  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function') {
      try {
        await (navigator as any).share({ title, text: message, url });
        return { success: true, method: 'share' };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return { success: false, method: 'share', error: 'User cancelled share' };
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message);
        return { success: true, method: 'clipboard' };
      } catch (err: any) {
        return { success: false, method: 'clipboard', error: err?.message || 'Could not copy to clipboard' };
      }
    }
    return { success: false, method: 'clipboard', error: 'Sharing not supported on this browser' };
  }

  // React Native Android & iOS
  try {
    const result = await Share.share(
      {
        title,
        message,
        url,
      },
      {
        dialogTitle: 'Share Request via Messenger',
        subject: title,
      }
    );

    if (result.action === Share.sharedAction) {
      return { success: true, method: 'share' };
    }
    return { success: false, method: 'share', error: 'Dismissed' };
  } catch (err: any) {
    return { success: false, method: 'share', error: err?.message || 'Share failed' };
  }
}

