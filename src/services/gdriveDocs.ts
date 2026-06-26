import { env } from '../lib/env';
import { supabase } from '../lib/supabase';

export type EmployeeDocType = 'tin' | 'sss' | 'pagibig' | 'philhealth' | 'bank';

export type UploadedDocRef = {
  docType: EmployeeDocType;
  fileId: string;
  webViewLink?: string | null;
  webContentLink?: string | null;
  drivePath?: string | null;
  detectedNumber?: string | null;
  isClear?: boolean | null;
};

type UploadPayload = {
  rootFolderId: string;
  company: string;
  department: string;
  docType: EmployeeDocType;
  fileName: string;
  mimeType: string;
  base64Data: string;
};

type UploadResponse = {
  ok?: boolean;
  fileId?: string;
  webViewLink?: string;
  webContentLink?: string;
  drivePath?: string;
  detectedNumber?: string;
  isClear?: boolean;
  error?: string;
};

export function sanitizePathSegment(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_');
}

export async function uploadEmployeeDocumentToDrive(payload: UploadPayload) {
  try {
    return await uploadToGoogleDrive(payload);
  } catch (error) {
    if (!isNetworkFetchError(error)) {
      throw error;
    }

    return uploadToSupabaseStorage(payload);
  }
}

async function uploadToGoogleDrive(payload: UploadPayload) {
  if (!env.googleDriveScriptUrl.trim()) {
    throw new TypeError('Google Drive upload is not configured. Set EXPO_PUBLIC_GDRIVE_SCRIPT_URL.');
  }

  const response = await fetch(env.googleDriveScriptUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => ({}))) as UploadResponse;
  if (!response.ok || !json?.ok || !json.fileId) {
    throw new Error(json?.error || 'Google Drive upload failed.');
  }

  const result: UploadedDocRef = {
    docType: payload.docType,
    fileId: json.fileId,
    webViewLink: json.webViewLink ?? null,
    webContentLink: json.webContentLink ?? null,
    drivePath: json.drivePath ?? null,
    detectedNumber: json.detectedNumber ?? null,
    isClear: json.isClear ?? null,
  };
  return result;
}

async function uploadToSupabaseStorage(payload: UploadPayload) {
  const path = [
    sanitizePathSegment(payload.company || 'COMPANY'),
    sanitizePathSegment(payload.department || 'DEPARTMENT'),
    sanitizePathSegment(payload.docType.toUpperCase()),
    `${Date.now()}_${sanitizePathSegment(payload.fileName || `${payload.docType}.jpg`)}`,
  ].join('/');
  const bytes = base64ToUint8Array(payload.base64Data);

  const { error } = await supabase.storage
    .from('employee-documents')
    .upload(path, bytes, {
      contentType: payload.mimeType || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw new Error(`Document upload failed: ${error.message}`);
  }

  return {
    docType: payload.docType,
    fileId: path,
    webViewLink: null,
    webContentLink: null,
    drivePath: path,
    detectedNumber: null,
    isClear: null,
  };
}

function isNetworkFetchError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error instanceof TypeError || message.includes('failed to fetch') || message.includes('network request failed');
}

function base64ToUint8Array(base64Data: string) {
  const cleanBase64 = base64Data.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const outputLength = Math.floor((cleanBase64.length * 3) / 4) - (cleanBase64.endsWith('==') ? 2 : cleanBase64.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(Math.max(outputLength, 0));
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;

  for (let index = 0; index < cleanBase64.length; index += 1) {
    const value = chars.indexOf(cleanBase64[index]);
    if (value < 0) {
      continue;
    }

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      if (byteIndex < bytes.length) {
        bytes[byteIndex] = (buffer >> bits) & 0xff;
        byteIndex += 1;
      }
    }
  }

  return bytes;
}
