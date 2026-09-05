// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GDRIVE_ROOT_FOLDER_ID =
  Deno.env.get('GDRIVE_ROOT_FOLDER_ID') || '1fxy0CgT7CfmLvAPOfs648AnSomZyadyR';
const GDRIVE_CLIENT_EMAIL =
  Deno.env.get('GDRIVE_CLIENT_EMAIL') || 'hygportalapp@hyg-portal-app.iam.gserviceaccount.com';
const GDRIVE_PRIVATE_KEY =
  Deno.env.get('GDRIVE_PRIVATE_KEY') ||
  `-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDVteDrZytHALK8\nz9o8c3/9JvlFL5vO4rHj2Z7qXfhzziNThHO4Icmkapme/MmS6Nxu8sm80shpKyJJ\nfBC2y5Js6TYoX/BpntzNBwWWB9WNnLtSZ/Ce6h4uAmFO+yAwrGlUryos0nqJZv1N\nxQB5+XaiiwdNcQXfun7QUce/2bDnfqOLs/9vgfCebAINlQS78niyn1+DuIL7dSp0\n8DhQMjqnsw1PyCp+MJpHaR2IlKcgE86PNOfqJNgSGECPt4B6SZDKKcK5Q9o9luuV\nT3LiaNLxShFHGhWkuWoWGSqApqV2nKlsa6g01heSG+8lOWi71GorFoHHNGSxgopC\nlFGZ86H/AgMBAAECggEADuaXD6LKZDF6xOpzK3rcJjEE+Vt38CVjROFEENBLhfuO\nAAFAtkp4zkN2gZzbiyg8UmoQQd+qhJay1c/WNICeLYTXN1p1H1Ap0gvWyl6yd6TB\ndN31a4ckYo3c7g5ZcLtcvsBV3vkv/QuWxsjhHyATMwMhl7c1MyPEOs8w78IEcSeF\nIcRDc5YND/aHstzIHbLUMYv5g8hjiMjj4Sz2XSXl2FRh13M4fhBOxYHwAxpIhKmE\nkLqu31VIBNoW2huCjxGbKHwldbPmcVStq55pKVewV2OB8eY759c/W5blmbZGBdem\nwwdJkysZBQb08vqBxWmk2wGPpjmqdDML88mX/GpRBQKBgQD3PRKAPASO90nk3jUu\n3slVrskragwkuznB/8WY5zCTfnP7cUT7QMTFcofQXEOhYpIub20qCaHw/pobzYmO\nfTIglOWLn+EpCKGajPRGWAtL5M9fn+T9u2zoh5H1ZGuvO3Du8UZ5Wp3J1vskIlIi\nxsoZOKVgqcMrl16f13+KieK/awKBgQDdSKRl295gyKFVqbP77t4D33ChFHDE7rjO\nx/pwricpQ2WMZvuGyfe7S43v62WFMnQjmQeMA9qIKiXzclqAtFXrgtBq35rgMqBi\nd6R+Q8iwwQYeO2+XzyCSioIZQqtqh5r1ILE8fyTTLBngG5y/cu4fDLGTakn/GOE2\nCA6LLEjwvQKBgGNnzL5+Yx7QUoeQyDVWIgEvS3cHJmbGWEyl996oZaGH4D4ipqeW\nvQbeK7kcv5xts3S0HGIgiVoKJBA1ra76q2LqOvjOiYskC0XGkpiN4czb7Hz4Huvd\npcZAa/EMNTe5YIjRvZIhWvvCUiuPGRMedjd5zRR2bSBjtgnybTdYhTCNAoGAF0p4\nE0iLJYC4in2sNg40TBAOmMXAANpnlUwzLf0Gni871wVX4B4N9ybCr8gFDXn8A2su\nAiy9qatWB0O4Buf0Sy+fpEAY2xQ5EWQqaifUTdZjQHddDYt9kC8H9oSv6iyPwNFK\nFmYDiD6SEqaVXwlHyvjZD/0WAMWrnrZGYZutqbkCgYAaymbfrqptu1CwDD7Oo5b3\nO455u15yMzRSIGPdnFdyG9GAOH/nBTqF7jBqrUBqw+sttw1tgVpZst0mIulpOVLy\nzv4U3h9uFzeUTUHbhrNRAGhPTCB9eQlNMmPC2CNxdWBtDhcB1r8doDuUfcI9J6eQ\nkofGEQQ/zU9IWQHti8uiJA==\n-----END PRIVATE KEY-----\n`;

function b64Url(str: string | Uint8Array) {
  const b64 = typeof str === 'string' ? btoa(str) : btoa(String.fromCharCode(...str));
  return b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: GDRIVE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const cleanPem = GDRIVE_PRIVATE_KEY
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replaceAll('\n', '')
      .replaceAll('\r', '')
      .trim();

    const binaryDer = Uint8Array.from(atob(cleanPem), (c) => c.charCodeAt(0));
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureInput = `${b64Url(JSON.stringify(header))}.${b64Url(JSON.stringify(claim))}`;
    const sigBuffer = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      importedKey,
      new TextEncoder().encode(signatureInput),
    );

    const jwt = `${signatureInput}.${b64Url(new Uint8Array(sigBuffer))}`;
    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.append('assertion', jwt);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.error('Failed to obtain Google access token:', err);
    return null;
  }
}

async function getOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      photoBase64,
      employeeName = 'Employee',
      storeName,
      timestamp = new Date().toISOString(),
      timeDigits = '',
      timePeriod = '',
      dateFormatted = '',
      dayFormatted = '',
      locationText = '',
      latitude,
      longitude,
    } = body;

    let driveFileId: string | null = null;
    let driveWebViewLink: string | null = null;
    let photoUrl: string | null = null;

    if (photoBase64) {
      const token = await getGoogleAccessToken();
      if (token) {
        const dateStr = (dateFormatted || 'General').replaceAll('.', '').replaceAll(',', '').replaceAll(' ', '_');
        const storeStr = (storeName || employeeName || 'Store').replaceAll(/[^a-zA-Z0-9_-]/g, '_');

        const dateFolderId = await getOrCreateFolder(token, dateStr, GDRIVE_ROOT_FOLDER_ID);
        const targetFolderId = await getOrCreateFolder(token, storeStr, dateFolderId);

        const fileName = `${employeeName.replaceAll(' ', '_')}_${timeDigits.replace(':', '')}_${timePeriod}.jpg`;

        let rawBase64 = photoBase64;
        if (rawBase64.includes(',')) rawBase64 = rawBase64.split(',')[1];

        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const metaHeader = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
          name: fileName,
          parents: [targetFolderId],
        })}`;
        const fileHeader = `${delimiter}Content-Type: image/jpeg\r\nContent-Transfer-Encoding: base64\r\n\r\n`;

        const enc = new TextEncoder();
        const metaBytes = enc.encode(metaHeader);
        const fileBytes = enc.encode(fileHeader);
        const closeBytes = enc.encode(closeDelimiter);
        const contentBytes = enc.encode(rawBase64);

        const bodyBytes = new Uint8Array(metaBytes.length + fileBytes.length + contentBytes.length + closeBytes.length);
        let offset = 0;
        bodyBytes.set(metaBytes, offset); offset += metaBytes.length;
        bodyBytes.set(fileBytes, offset); offset += fileBytes.length;
        bodyBytes.set(contentBytes, offset); offset += contentBytes.length;
        bodyBytes.set(closeBytes, offset);

        const uploadRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: bodyBytes,
          },
        );

        const file = await uploadRes.json();
        if (file.id) {
          driveFileId = file.id;
          driveWebViewLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
          photoUrl = `https://lh3.googleusercontent.com/d/${file.id}`;

          // Set public read permission
          void fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'reader', type: 'anyone' }),
          }).catch(() => {});
        }
      }
    }

    // Note: The client performs the official insert into public.photo_proofs with the authenticated employee_id.
    // The edge function solely handles the Google Drive upload to avoid duplicate database rows.

    return new Response(
      JSON.stringify({
        success: Boolean(driveFileId),
        driveFileId,
        driveWebViewLink,
        photoUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
