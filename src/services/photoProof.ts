import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';

export type PhotoProofItem = {
  id: string;
  photoUri: string;
  timestamp: string;
  timeDigits: string; // e.g. "10:35"
  timePeriod: string; // e.g. "AM" | "PM"
  dateFormatted: string; // e.g. "Sept. 01, 2026"
  dayFormatted: string; // e.g. "Thu"
  locationText: string; // Real full address
  latitude?: number;
  longitude?: number;
  employeeId?: string | null;
  employeeName?: string | null;
  userEmail?: string | null;
  storeName?: string | null;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  syncedToCloud?: boolean;
};

const PHOTO_PROOFS_KEY = 'hyg_photo_proofs_list';

const GDRIVE_ROOT_FOLDER_ID = '1fxy0CgT7CfmLvAPOfs648AnSomZyadyR';
const GDRIVE_CLIENT_EMAIL = 'hygportalapp@hyg-portal-app.iam.gserviceaccount.com';
const GDRIVE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDVteDrZytHALK8\nz9o8c3/9JvlFL5vO4rHj2Z7qXfhzziNThHO4Icmkapme/MmS6Nxu8sm80shpKyJJ\nfBC2y5Js6TYoX/BpntzNBwWWB9WNnLtSZ/Ce6h4uAmFO+yAwrGlUryos0nqJZv1N\nxQB5+XaiiwdNcQXfun7QUce/2bDnfqOLs/9vgfCebAINlQS78niyn1+DuIL7dSp0\n8DhQMjqnsw1PyCp+MJpHaR2IlKcgE86PNOfqJNgSGECPt4B6SZDKKcK5Q9o9luuV\nT3LiaNLxShFHGhWkuWoWGSqApqV2nKlsa6g01heSG+8lOWi71GorFoHHNGSxgopC\nlFGZ86H/AgMBAAECggEADuaXD6LKZDF6xOpzK3rcJjEE+Vt38CVjROFEENBLhfuO\nAAFAtkp4zkN2gZzbiyg8UmoQQd+qhJay1c/WNICeLYTXN1p1H1Ap0gvWyl6yd6TB\ndN31a4ckYo3c7g5ZcLtcvsBV3vkv/QuWxsjhHyATMwMhl7c1MyPEOs8w78IEcSeF\nIcRDc5YND/aHstzIHbLUMYv5g8hjiMjj4Sz2XSXl2FRh13M4fhBOxYHwAxpIhKmE\nkLqu31VIBNoW2huCjxGbKHwldbPmcVStq55pKVewV2OB8eY759c/W5blmbZGBdem\nwwdJkysZBQb08vqBxWmk2wGPpjmqdDML88mX/GpRBQKBgQD3PRKAPASO90nk3jUu\n3slVrskragwkuznB/8WY5zCTfnP7cUT7QMTFcofQXEOhYpIub20qCaHw/pobzYmO\nfTIglOWLn+EpCKGajPRGWAtL5M9fn+T9u2zoh5H1ZGuvO3Du8UZ5Wp3J1vskIlIi\nxsoZOKVgqcMrl16f13+KieK/awKBgQDdSKRl295gyKFVqbP77t4D33ChFHDE7rjO\nx/pwricpQ2WMZvuGyfe7S43v62WFMnQjmQeMA9qIKiXzclqAtFXrgtBq35rgMqBi\nd6R+Q8iwwQYeO2+XzyCSioIZQqtqh5r1ILE8fyTTLBngG5y/cu4fDLGTakn/GOE2\nCA6LLEjwvQKBgGNnzL5+Yx7QUoeQyDVWIgEvS3cHJmbGWEyl996oZaGH4D4ipqeW\nvQbeK7kcv5xts3S0HGIgiVoKJBA1ra76q2LqOvjOiYskC0XGkpiN4czb7Hz4Huvd\npcZAa/EMNTe5YIjRvZIhWvvCUiuPGRMedjd5zRR2bSBjtgnybTdYhTCNAoGAF0p4\nE0iLJYC4in2sNg40TBAOmMXAANpnlUwzLf0Gni871wVX4B4N9ybCr8gFDXn8A2su\nAiy9qatWB0O4Buf0Sy+fpEAY2xQ5EWQqaifUTdZjQHddDYt9kC8H9oSv6iyPwNFK\nFmYDiD6SEqaVXwlHyvjZD/0WAMWrnrZGYZutqbkCgYAaymbfrqptu1CwDD7Oo5b3\nO455u15yMzRSIGPdnFdyG9GAOH/nBTqF7jBqrUBqw+sttw1tgVpZst0mIulpOVLy\nzv4U3h9uFzeUTUHbhrNRAGhPTCB9eQlNMmPC2CNxdWBtDhcB1r8doDuUfcI9J6eQ\nkofGEQQ/zU9IWQHti8uiJA==\n-----END PRIVATE KEY-----\n`;

async function generateGoogleAccessToken(): Promise<string | null> {
  try {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: GDRIVE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const b64Url = (str: string | Uint8Array) => {
      let b64 = typeof str === 'string' ? btoa(str) : btoa(String.fromCharCode(...str));
      return b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    };

    const cleanPem = GDRIVE_PRIVATE_KEY
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replaceAll('\n', '')
      .replaceAll('\r', '')
      .trim();

    const binaryDer = Uint8Array.from(atob(cleanPem), (c) => c.charCodeAt(0));

    if (globalThis.crypto?.subtle) {
      const importedKey = await globalThis.crypto.subtle.importKey(
        'pkcs8',
        binaryDer.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signatureInput = `${b64Url(JSON.stringify(header))}.${b64Url(JSON.stringify(claim))}`;
      const signatureBuffer = await globalThis.crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        importedKey,
        new TextEncoder().encode(signatureInput),
      );
      const signature = b64Url(new Uint8Array(signatureBuffer));
      const jwt = `${signatureInput}.${signature}`;

      const params = new URLSearchParams();
      params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      params.append('assertion', jwt);

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await res.json();
      if (data.access_token) return data.access_token;
    }
  } catch (err) {
    console.warn('[PhotoProofGDrive] Google Drive OAuth token generation failed:', err);
  }
  return null;
}

async function getOrCreateDriveFolderClient(token: string, name: string, parentId: string): Promise<string> {
  try {
    const q = `name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.files && data.files.length > 0) return data.files[0].id;

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    const folder = await createRes.json();
    return folder.id || parentId;
  } catch {
    return parentId;
  }
}

export async function uploadDirectToGoogleDrive(
  item: PhotoProofItem,
  base64Data?: string,
): Promise<{ driveFileId: string; driveWebViewLink: string; photoUrl: string } | null> {
  try {
    const token = await generateGoogleAccessToken();
    if (!token) {
      console.warn('[PhotoProofGDrive] Direct Google token not available on this platform');
      return null;
    }

    const dateStr = item.dateFormatted.replaceAll('.', '').replaceAll(',', '').replaceAll(' ', '_');
    const storeStr = (item.storeName || item.employeeName || 'General').replaceAll(/[^a-zA-Z0-9_-]/g, '_');

    const dateFolderId = await getOrCreateDriveFolderClient(token, dateStr, GDRIVE_ROOT_FOLDER_ID);
    const targetFolderId = await getOrCreateDriveFolderClient(token, storeStr, dateFolderId);

    const fileName = `${(item.employeeName || 'Employee').replaceAll(' ', '_')}_${item.timeDigits.replace(':', '')}_${item.timePeriod}.jpg`;

    let cleanBase64 = base64Data || item.photoUri;
    if (Platform.OS !== 'web' && cleanBase64.startsWith('file://')) {
      try {
        cleanBase64 = await FileSystem.readAsStringAsync(cleanBase64, {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });
      } catch (readErr) {
        console.warn('Failed to read file as base64 for Google Drive:', readErr);
      }
    }
    if (cleanBase64.includes(',')) cleanBase64 = cleanBase64.split(',')[1];

    const metadata = { name: fileName, parents: [targetFolderId] };
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metaHeader = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
    const fileHeader = `${delimiter}Content-Type: image/jpeg\r\nContent-Transfer-Encoding: base64\r\n\r\n`;

    const enc = new TextEncoder();
    const metaBytes = enc.encode(metaHeader);
    const fileBytes = enc.encode(fileHeader);
    const closeBytes = enc.encode(closeDelimiter);
    const contentBytes = enc.encode(cleanBase64);

    const bodyBytes = new Uint8Array(metaBytes.length + fileBytes.length + contentBytes.length + closeBytes.length);
    let offset = 0;
    bodyBytes.set(metaBytes, offset); offset += metaBytes.length;
    bodyBytes.set(fileBytes, offset); offset += fileBytes.length;
    bodyBytes.set(contentBytes, offset); offset += contentBytes.length;
    bodyBytes.set(closeBytes, offset);

    console.log('[PhotoProofGDrive] Uploading multipart image to Google Drive folder:', storeStr);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: bodyBytes,
      },
    );

    const file = await uploadRes.json();
    console.log('[PhotoProofGDrive] Google Drive upload completed:', file);

    if (file?.id) {
      // Set read permission for anyone with link
      void fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }).catch(() => {});

      const directImageLink = `https://lh3.googleusercontent.com/d/${file.id}`;
      const webViewLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
      return { driveFileId: file.id, driveWebViewLink: webViewLink, photoUrl: directImageLink };
    }
  } catch (err) {
    console.warn('[PhotoProofGDrive] Direct Google Drive upload error:', err);
  }
  return null;
}

export function isProofOwnedByUser(
  item: PhotoProofItem,
  user?: {
    employeeId?: string | null;
    employeeName?: string | null;
    userEmail?: string | null;
  }
): boolean {
  if (!user) return true;

  const clean = (s?: string | null) => (s ? s.trim().toLowerCase() : '');

  const targetEmpId = clean(user.employeeId);
  const targetName = clean(user.employeeName);
  const targetEmail = clean(user.userEmail);

  // If no user filter criteria were provided at all, allow all
  if (!targetEmpId && !targetName && !targetEmail) return true;

  const itemEmpId = clean(item.employeeId);
  const itemName = clean(item.employeeName);
  const itemEmail = clean(item.userEmail);
  const itemStore = clean(item.storeName);

  // 1. Direct Employee ID match
  if (targetEmpId && itemEmpId && targetEmpId === itemEmpId) {
    return true;
  }

  // 2. Direct Email match (against item.userEmail, item.employeeName, or item.storeName)
  if (targetEmail) {
    if (itemEmail && targetEmail === itemEmail) return true;
    if (itemName && targetEmail === itemName) return true;
    if (itemStore && itemStore.includes(targetEmail)) return true;
  }

  // 3. Employee Name match (ignore generic "employee" placeholder)
  if (
    targetName &&
    targetName !== 'employee' &&
    itemName &&
    itemName !== 'employee' &&
    targetName === itemName
  ) {
    return true;
  }

  return false;
}

export async function loadPhotoProofs(userFilter?: {
  employeeId?: string | null;
  employeeName?: string | null;
  userEmail?: string | null;
}): Promise<PhotoProofItem[]> {
  let localList: PhotoProofItem[] = [];
  try {
    const list = await getCacheJSON<PhotoProofItem[]>(PHOTO_PROOFS_KEY);
    if (list && Array.isArray(list)) {
      localList = list;
    }
  } catch (err) {
    console.error('Failed to load local photo proofs:', err);
  }

  try {
    const { data, error } = await supabase
      .from('photo_proofs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    if (!error && data && data.length > 0) {
      const cloudItems: PhotoProofItem[] = data.map((row: any) => {
        const driveImage = row.drive_file_id ? `https://lh3.googleusercontent.com/d/${row.drive_file_id}` : '';
        return {
          id: row.id,
          photoUri: row.photo_url || driveImage || row.drive_web_view_link || '',
          timestamp: row.timestamp,
          timeDigits: row.time_digits,
          timePeriod: row.time_period,
          dateFormatted: row.date_formatted,
          dayFormatted: row.day_formatted,
          locationText: row.location_text,
          latitude: row.latitude,
          longitude: row.longitude,
          employeeId: row.employee_id,
          employeeName: row.employee_name,
          storeName: row.store_name,
          driveFileId: row.drive_file_id,
          driveWebViewLink: row.drive_web_view_link,
          syncedToCloud: true,
        };
      });

      const localById = new Map<string, PhotoProofItem>();
      for (const loc of localList) {
        localById.set(loc.id, loc);
      }

      const merged: PhotoProofItem[] = [];
      const matchedLocalIds = new Set<string>();

      for (const cloud of cloudItems) {
        let matched = localById.get(cloud.id);
        if (!matched) {
          const cloudTime = Date.parse(cloud.timestamp);
          for (const loc of localList) {
            if (!matchedLocalIds.has(loc.id)) {
              const locTime = Date.parse(loc.timestamp);
              if (Math.abs(cloudTime - locTime) < 90000 && loc.employeeName === cloud.employeeName) {
                matched = loc;
                break;
              }
            }
          }
        }

        if (matched) {
          matchedLocalIds.add(matched.id);
          // Preserve valid local photo URI if cloud image URL is empty
          merged.push({
            ...matched,
            ...cloud,
            photoUri: cloud.photoUri || matched.photoUri,
            syncedToCloud: true,
          });
        } else {
          merged.push(cloud);
        }
      }

      // Keep any local proofs that have not yet synced or are awaiting upload
      for (const loc of localList) {
        if (!matchedLocalIds.has(loc.id)) {
          merged.push(loc);
        }
      }

      const sorted = merged.sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      );

      if (userFilter) {
        return sorted.filter((item) => isProofOwnedByUser(item, userFilter));
      }
      return sorted;
    }
  } catch {
    // Offline or table pending
  }

  const sortedLocal = localList.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (userFilter) {
    return sortedLocal.filter((item) => isProofOwnedByUser(item, userFilter));
  }
  return sortedLocal;
}

export async function syncPhotoProofToCloud(item: PhotoProofItem): Promise<boolean> {
  let base64Photo = item.photoUri;

  // 1. Convert local file:/// URI to base64 string on native mobile devices
  if (Platform.OS !== 'web' && item.photoUri && !item.photoUri.startsWith('data:')) {
    try {
      base64Photo = await FileSystem.readAsStringAsync(item.photoUri, {
        encoding: FileSystem.EncodingType?.Base64 || 'base64',
      });
    } catch (readErr) {
      console.warn('Failed to read photo file as base64:', readErr);
    }
  }

  // 1. Resolve employeeId upfront
  let resolvedEmployeeId = item.employeeId || null;
  if (!resolvedEmployeeId) {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const authUserId = userRes?.user?.id;
      if (authUserId) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('employee_id')
          .eq('auth_user_id', authUserId)
          .maybeSingle();

        resolvedEmployeeId = prof?.employee_id || authUserId;
      }
    } catch {
      // ignore
    }
  }

  const isUUID = resolvedEmployeeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedEmployeeId);

  // 2. Attempt Direct Google Drive Upload first
  let driveResult = await uploadDirectToGoogleDrive(item, base64Photo);
  let cloudRecordId: string | null = null;

  // 3. Fallback to Supabase Edge Function if direct upload failed
  if (!driveResult) {
    try {
      console.log('[PhotoProofSync] Attempting Supabase Edge Function upload fallback...');
      const { data: funcData, error: funcError } = await supabase.functions.invoke('upload-photo-proof', {
        body: {
          photoBase64: base64Photo,
          employeeId: isUUID ? resolvedEmployeeId : null,
          employee_id: isUUID ? resolvedEmployeeId : null,
          employeeName: item.employeeName || 'Employee',
          storeName: item.storeName || item.userEmail || undefined,
          timestamp: item.timestamp,
          timeDigits: item.timeDigits,
          timePeriod: item.timePeriod,
          dateFormatted: item.dateFormatted,
          dayFormatted: item.dayFormatted,
          locationText: item.locationText,
          latitude: item.latitude,
          longitude: item.longitude,
        },
      });

      console.log('[PhotoProofSync] Edge Function response:', { funcData, funcError });

      if (!funcError && funcData?.driveFileId) {
        driveResult = {
          driveFileId: funcData.driveFileId,
          driveWebViewLink: funcData.driveWebViewLink || `https://drive.google.com/file/d/${funcData.driveFileId}/view`,
          photoUrl: funcData.photoUrl || `https://lh3.googleusercontent.com/d/${funcData.driveFileId}`,
        };
      }

      if (funcData?.record?.id) {
        cloudRecordId = funcData.record.id;
      }
    } catch (err) {
      console.warn('Google Drive edge function sync error:', err);
    }
  }

  if (driveResult) {
    item.driveFileId = driveResult.driveFileId;
    item.driveWebViewLink = driveResult.driveWebViewLink;
    if (driveResult.photoUrl && (!item.photoUri || item.photoUri.startsWith('data:'))) {
      item.photoUri = driveResult.photoUrl;
    }
    item.syncedToCloud = true;

    try {
      const current = await loadPhotoProofs();
      const updated = current.map((p) => (p.id === item.id ? { ...p, ...item } : p));
      await setCacheJSON(PHOTO_PROOFS_KEY, updated);
    } catch {
      // ignore
    }
  }

  // 4. Save or update metadata row in Supabase photo_proofs table
  try {
    console.log('[PhotoProofSync] Syncing photo proof with employee_id:', resolvedEmployeeId, 'name:', item.employeeName);

    // If the Edge Function already created a record in Supabase Cloud, attempt to update it
    if (cloudRecordId) {
      console.log('[PhotoProofSync] Edge function created record', cloudRecordId, '- updating employee_id:', resolvedEmployeeId);
      const { data: updatedRows, error: updateErr } = await supabase
        .from('photo_proofs')
        .update({
          employee_id: isUUID ? resolvedEmployeeId : null,
          employee_name: item.employeeName || 'Employee',
          store_name: item.storeName || item.userEmail || undefined,
        })
        .eq('id', cloudRecordId)
        .select();

      console.log('[PhotoProofSync] Update attempt result:', { updatedRows, updateErr });

      if (!updateErr && updatedRows && updatedRows.length > 0) {
        const current = await loadPhotoProofs();
        const updated = current.map((p) =>
          p.id === item.id ? { ...p, id: cloudRecordId!, employeeId: isUUID ? resolvedEmployeeId : null, syncedToCloud: true } : p,
        );
        await setCacheJSON(PHOTO_PROOFS_KEY, updated);
        return true;
      }

      // If update was blocked (e.g. by RLS or foreign key), delete the incomplete record from the Edge Function so we don't leave a NULL row
      console.warn('[PhotoProofSync] Update failed or blocked by RLS. Replacing incomplete cloud record with clean insert...');
      await supabase.from('photo_proofs').delete().eq('id', cloudRecordId);
    }

    // Otherwise, perform the single insert
    const { data: insertedData, error: insertErr } = await supabase
      .from('photo_proofs')
      .insert({
        employee_id: isUUID ? resolvedEmployeeId : null,
        employee_name: item.employeeName || 'Employee',
        store_name: item.storeName || item.userEmail || undefined,
        timestamp: item.timestamp,
        time_digits: item.timeDigits,
        time_period: item.timePeriod,
        date_formatted: item.dateFormatted,
        day_formatted: item.dayFormatted,
        location_text: item.locationText,
        latitude: item.latitude,
        longitude: item.longitude,
        photo_url: driveResult?.photoUrl || (item.photoUri.startsWith('http') ? item.photoUri : null),
        drive_file_id: item.driveFileId || null,
        drive_web_view_link: item.driveWebViewLink || null,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.warn('[PhotoProofSync] Primary insert error:', insertErr);
      if (insertErr.message?.includes('foreign key') || insertErr.code === '23503') {
        const fallbackUserId = (await supabase.auth.getUser()).data?.user?.id ?? null;
        console.log('[PhotoProofSync] Foreign key failed. Retrying with auth user ID fallback:', fallbackUserId);
        const retry = await supabase
          .from('photo_proofs')
          .insert({
            employee_id: fallbackUserId,
            employee_name: item.employeeName || 'Employee',
            store_name: item.storeName || item.userEmail || undefined,
            timestamp: item.timestamp,
            time_digits: item.timeDigits,
            time_period: item.timePeriod,
            date_formatted: item.dateFormatted,
            day_formatted: item.dayFormatted,
            location_text: item.locationText,
            latitude: item.latitude,
            longitude: item.longitude,
            photo_url: driveResult?.photoUrl || (item.photoUri.startsWith('http') ? item.photoUri : null),
            drive_file_id: item.driveFileId || null,
            drive_web_view_link: item.driveWebViewLink || null,
          })
          .select('id')
          .single();

        if (!retry.error && retry.data?.id) {
          const current = await loadPhotoProofs();
          const updated = current.map((p) => (p.id === item.id ? { ...p, id: retry.data.id, syncedToCloud: true } : p));
          await setCacheJSON(PHOTO_PROOFS_KEY, updated);
          return true;
        }
      }
    }

    if (!insertErr && insertedData?.id) {
      // Sync local item ID to match cloud row UUID
      const current = await loadPhotoProofs();
      const updated = current.map((p) => (p.id === item.id ? { ...p, id: insertedData.id, employeeId: isUUID ? resolvedEmployeeId : null, syncedToCloud: true } : p));
      await setCacheJSON(PHOTO_PROOFS_KEY, updated);
      return true;
    }
  } catch (dbErr) {
    console.warn('Supabase photo_proofs table insert error:', dbErr);
  }

  return Boolean(item.driveFileId || item.driveWebViewLink);
}



export async function savePhotoProof(item: PhotoProofItem): Promise<void> {
  try {
    const current = await loadPhotoProofs();
    const updated = [item, ...current.filter((p) => p.id !== item.id)];
    await setCacheJSON(PHOTO_PROOFS_KEY, updated);

    // Sync to Supabase cloud table in background
    void syncPhotoProofToCloud(item);
  } catch (err) {
    console.error('Failed to save photo proof:', err);
    throw err;
  }
}

export async function deletePhotoProof(itemOrId: PhotoProofItem | string): Promise<void> {
  const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
  let targetItem: PhotoProofItem | undefined;

  try {
    const current = await loadPhotoProofs();
    targetItem = current.find((p) => p.id === id);
    if (!targetItem && typeof itemOrId === 'object') {
      targetItem = itemOrId;
    }

    // 1. Remove from local SQLite/AsyncStorage cache immediately
    const updated = current.filter((p) => p.id !== id);
    await setCacheJSON(PHOTO_PROOFS_KEY, updated);

    // 2. Delete from Supabase photo_proofs table
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let res;
      if (isUUID) {
        res = await supabase.from('photo_proofs').delete().eq('id', id).select();
      } else if (targetItem?.timestamp) {
        res = await supabase.from('photo_proofs').delete().eq('timestamp', targetItem.timestamp).select();
      }

      console.log('[PhotoProofDelete] Supabase delete result:', { id, deletedRows: res?.data, error: res?.error });
      if (res?.error) {
        console.warn('Supabase delete photo_proof error:', res.error);
      }
      if (res?.data && res.data.length === 0) {
        console.warn('[PhotoProofDelete] 0 rows deleted in Supabase. Check RLS DELETE policy on photo_proofs table.');
      }
    } catch (dbErr) {
      console.warn('Supabase delete photo_proof exception:', dbErr);
    }

    // 3. Delete from Google Drive if file ID exists
    const driveFileId = targetItem?.driveFileId || (typeof itemOrId === 'object' ? itemOrId.driveFileId : null);
    if (driveFileId) {
      try {
        const token = await generateGoogleAccessToken();
        if (token) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          console.log('[PhotoProofGDrive] Successfully deleted file from Google Drive:', driveFileId);
        }
      } catch (gErr) {
        console.warn('Google Drive file deletion error:', gErr);
      }
    }
  } catch (err) {
    console.error('Failed to delete photo proof:', err);
    throw err;
  }
}

export async function requestCameraAndLocationPermissions(): Promise<{
  cameraGranted: boolean;
  locationGranted: boolean;
}> {
  let cameraGranted = false;
  let locationGranted = false;

  // 1. Camera permission
  try {
    let cameraStatus = await ImagePicker.getCameraPermissionsAsync();
    if (!cameraStatus.granted && cameraStatus.canAskAgain) {
      cameraStatus = await ImagePicker.requestCameraPermissionsAsync();
    }
    cameraGranted = cameraStatus.granted;
  } catch {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.mediaDevices) {
      cameraGranted = true;
    }
  }

  // 2. High-Accuracy GPS Location permission & prompt (Expo Go Native + Web)
  try {
    if (Platform.OS !== 'web') {
      const locStatus = await Location.requestForegroundPermissionsAsync();
      locationGranted = locStatus.status === 'granted';
      if (!locationGranted) {
        Alert.alert(
          'Location Permission Needed',
          'Please allow location access in Expo Go to record accurate GPS address stamps on photo proofs.',
        );
      }
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      locationGranted = await new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              Alert.alert(
                'Location Access Blocked',
                'GPS location access is blocked in your browser. Please allow location access for accurate GPS photo proof.',
              );
              resolve(false);
            } else {
              resolve(true);
            }
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
        );
      });
    } else {
      locationGranted = true;
    }
  } catch {
    locationGranted = true;
  }

  return { cameraGranted, locationGranted };
}

/**
 * Reverse geocodes coordinates to a full, human-readable address.
 */
export async function reverseGeocodeCoordinates(
  lat: number,
  lon: number,
): Promise<string | null> {
  // Provider 1: OpenStreetMap Nominatim with full address components
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'HYGPortalMobile/1.0',
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};

      const building = addr.amenity || addr.shop || addr.building || addr.office || addr.tourism || addr.commercial || '';
      const streetNum = addr.house_number || '';
      const road = addr.road || addr.street || addr.pedestrian || addr.footway || addr.path || '';
      const streetPart = [streetNum, road].filter(Boolean).join(' ');

      const barangay =
        addr.neighbourhood ||
        addr.suburb ||
        addr.quarter ||
        addr.residential ||
        addr.village ||
        addr.hamlet ||
        '';

      const city =
        addr.city ||
        addr.town ||
        addr.municipality ||
        addr.city_district ||
        addr.county ||
        '';

      const province = addr.state || addr.province || addr.region || '';
      const postcode = addr.postcode || '';

      const parts: string[] = [];
      if (building) parts.push(building);
      if (streetPart) parts.push(streetPart);
      if (barangay) parts.push(barangay);
      if (city) parts.push(city);
      if (province && province !== city) parts.push(province);
      if (postcode) parts.push(postcode);

      if (parts.length >= 2) {
        return parts.join(', ');
      } else if (data.display_name) {
        return data.display_name;
      }
    }
  } catch {
    // fallback
  }

  // Provider 2: BigDataCloud Reverse Geocoding Client (Fast & CORS friendly)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const parts: string[] = [];

      if (data.localityInfo?.administrative && Array.isArray(data.localityInfo.administrative)) {
        const adminList = data.localityInfo.administrative;
        for (let i = adminList.length - 1; i >= 0; i--) {
          const item = adminList[i];
          if (item && item.name && item.order >= 4 && !parts.includes(item.name)) {
            parts.push(item.name);
          }
        }
      }

      if (data.locality && !parts.includes(data.locality)) parts.push(data.locality);
      if (data.city && !parts.includes(data.city)) parts.push(data.city);
      if (data.principalSubdivision && !parts.includes(data.principalSubdivision)) parts.push(data.principalSubdivision);
      if (data.postcode && !parts.includes(data.postcode)) parts.push(data.postcode);

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }
  } catch {
    // fallback
  }

  return null;
}

/**
 * Fallback to IP Geolocation when GPS hardware is unavailable or disabled on desktop.
 */
export async function getIpLocation(): Promise<{
  locationText: string;
  latitude?: number;
  longitude?: number;
} | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.latitude && data.longitude) {
        const fullAddr = await reverseGeocodeCoordinates(data.latitude, data.longitude);
        if (fullAddr) {
          return {
            locationText: fullAddr,
            latitude: data.latitude,
            longitude: data.longitude,
          };
        }
        const parts = [data.city, data.region, data.postal, data.country].filter(Boolean);
        return {
          locationText: parts.join(', '),
          latitude: data.latitude,
          longitude: data.longitude,
        };
      }
    }
  } catch {
    // fallback
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://freeipapi.com/api/json', { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.latitude && data.longitude) {
        const fullAddr = await reverseGeocodeCoordinates(data.latitude, data.longitude);
        if (fullAddr) {
          return {
            locationText: fullAddr,
            latitude: data.latitude,
            longitude: data.longitude,
          };
        }
        const parts = [data.cityName, data.regionName, data.zipCode, data.countryName].filter(Boolean);
        return {
          locationText: parts.join(', '),
          latitude: data.latitude,
          longitude: data.longitude,
        };
      }
    }
  } catch {
    // fallback
  }

  return null;
}

/**
 * Gets high accuracy GPS coordinates with robust fallback.
 */
export async function getAccurateGPSCoordinates(): Promise<{
  latitude: number;
  longitude: number;
  accuracy?: number;
} | null> {
  // 1. Native Expo Go / Mobile location detection (Highest Hardware Satellite Accuracy)
  if (Platform.OS !== 'web') {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      if (loc?.coords) {
        return {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy ?? undefined,
        };
      }
    } catch {
      try {
        const lastLoc = await Location.getLastKnownPositionAsync({
          maxAge: 30000,
        });
        if (lastLoc?.coords) {
          return {
            latitude: lastLoc.coords.latitude,
            longitude: lastLoc.coords.longitude,
            accuracy: lastLoc.coords.accuracy ?? undefined,
          };
        }
      } catch {
        // fallback
      }
    }
  }

  // 2. Web Geolocation API (Browser GPS / WiFi triangulation)
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const highAccuracyPromise = new Promise<{ latitude: number; longitude: number; accuracy?: number } | null>(
      (resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 },
        );
      },
    );

    const res1 = await highAccuracyPromise;
    if (res1) return res1;
  }

  return null;
}

/**
 * Retrieves the real full current address based strictly on hardware device GPS.
 */
export async function getCurrentLocationInfo(defaultHint?: string | null): Promise<{
  locationText: string;
  latitude?: number;
  longitude?: number;
}> {
  // 1. Try Pin-Point Hardware Device GPS
  const coords = await getAccurateGPSCoordinates();
  if (coords) {
    const resolvedAddress = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
    if (resolvedAddress) {
      return { locationText: resolvedAddress, latitude: coords.latitude, longitude: coords.longitude };
    }
    return {
      locationText: `Lat: ${coords.latitude.toFixed(5)}, Lon: ${coords.longitude.toFixed(5)}`,
      latitude: coords.latitude,
      longitude: coords.longitude,
    };
  }

  // 2. Only use IP Geolocation on Web desktop browsers if hardware GPS is entirely unavailable
  if (Platform.OS === 'web') {
    const ipResult = await getIpLocation();
    if (ipResult) {
      return ipResult;
    }
  }

  // 3. Fallback to store hint or standard default
  const cleanHint = defaultHint?.trim();
  if (cleanHint && cleanHint.toLowerCase() !== 'it' && cleanHint.toLowerCase() !== 'it department' && cleanHint.length > 3) {
    return { locationText: cleanHint };
  }

  return { locationText: 'Tacloban City, Leyte, 6500' };
}

export function formatProofTimestamp(date: Date = new Date()) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours);
  const minStr = minutes < 10 ? `0${minutes}` : String(minutes);
  const timeDigits = `${hoursStr}:${minStr}`;

  const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const monthStr = months[date.getMonth()];
  const dayNum = date.getDate() < 10 ? `0${date.getDate()}` : `${date.getDate()}`;
  const year = date.getFullYear();
  const dateFormatted = `${monthStr} ${dayNum}, ${year}`;
  const dayFormatted = days[date.getDay()];

  return {
    timeDigits,
    timePeriod: period,
    dateFormatted,
    dayFormatted,
  };
}
