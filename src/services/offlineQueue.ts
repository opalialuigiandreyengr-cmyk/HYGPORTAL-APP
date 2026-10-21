import { DeviceEventEmitter } from 'react-native';
import { getCacheJSON, setCacheJSON, removeCacheItem } from '../lib/localCache';
import { supabase } from '../lib/supabase';
import { isAppOnline } from './network';
import {
  syncPhotoProofToCloud,
  loadPhotoProofs,
  reverseGeocodeCoordinates,
  type PhotoProofItem,
} from './photoProof';
import type { MyRequest } from './requests';
import { markBirthdayLeaveGrantedForYear } from './birthdayLeave';
import { updateEmployeeProfile, type UpdateEmployeeProfileInput } from './profile';

export const OFFLINE_QUEUE_KEY = 'hyg_offline_queue_v2';
export const MY_REQUESTS_CACHE_KEY = 'my_requests_v1';

export type OfflineEsarfPayload = {
  primaryRequestType: string;
  overallDateFrom: string;
  overallDateTo: string;
  overallTimeFrom: string | null;
  overallTimeTo: string | null;
  totalHoursSum: number;
  combinedReason: string;
  schedule?: string | null;
  dayOff?: string | null;
  payrollClass?: string | null;
  combinedTransactionType: string;
  attachedProofs?: Array<{
    photoProofId?: string | null;
    uri: string;
    localFileUri?: string | null;
    timestamp?: string;
    locationText?: string;
    latitude?: number;
    longitude?: number;
    driveWebViewLink?: string | null;
    source?: 'gallery' | 'photo_proof' | 'camera';
  }>;
  isEdit?: boolean;
  targetRequestId?: string;
};

export type OfflineLeavePayload = {
  entries: Array<{
    leaveType: string;
    leaveCategory: string;
    startDate: string;
    endDate: string;
    paidDays: number;
    unpaidDays: number;
    reason: string;
  }>;
  identities?: {
    username?: string | null;
    employeeId?: string | null;
    userEmail?: string | null;
    hasCompletedOneYear?: boolean;
  };
  isEdit?: boolean;
  targetRequestId?: string;
};

export type OfflineQueueItem =
  | {
      id: string;
      type: 'esarf';
      createdAt: string;
      payload: OfflineEsarfPayload;
      displayItem: MyRequest;
      syncAttempts: number;
      lastError?: string | null;
    }
  | {
      id: string;
      type: 'leave';
      createdAt: string;
      payload: OfflineLeavePayload;
      displayItems: MyRequest[];
      syncAttempts: number;
      lastError?: string | null;
    }
  | {
      id: string;
      type: 'photo_proof';
      createdAt: string;
      payload: PhotoProofItem;
      syncAttempts: number;
      lastError?: string | null;
    }
  | {
      id: string;
      type: 'profile_update';
      createdAt: string;
      payload: UpdateEmployeeProfileInput;
      syncAttempts: number;
      lastError?: string | null;
    }
  | {
      id: string;
      type: 'delete_request';
      createdAt: string;
      payload: {
        requestId: string;
        isPerk: boolean;
      };
      syncAttempts: number;
      lastError?: string | null;
    };

let isSyncing = false;

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  try {
    const list = await getCacheJSON<OfflineQueueItem[]>(OFFLINE_QUEUE_KEY);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('[OfflineQueue] Failed to load offline queue:', err);
    return [];
  }
}

async function saveOfflineQueue(queue: OfflineQueueItem[]): Promise<void> {
  await setCacheJSON(OFFLINE_QUEUE_KEY, queue);
  DeviceEventEmitter.emit('offline_queue_changed', queue.length);
}

export async function getPendingOfflineCount(): Promise<{
  total: number;
  esarf: number;
  leave: number;
  photoProof: number;
  profile: number;
}> {
  const queue = await getOfflineQueue();
  let esarf = 0;
  let leave = 0;
  let photoProof = 0;
  let profile = 0;

  for (const item of queue) {
    if (item.type === 'esarf') esarf++;
    else if (item.type === 'leave') leave++;
    else if (item.type === 'photo_proof') photoProof++;
    else if (item.type === 'profile_update') profile++;
  }

  // Also count any local photo proofs pending cloud sync
  try {
    const proofs = await loadPhotoProofs();
    const unsyncedProofs = proofs.filter((p) => !p.syncedToCloud);
    // Avoid double counting
    const queuedProofIds = new Set(
      queue.filter((q) => q.type === 'photo_proof').map((q) => q.id),
    );
    for (const p of unsyncedProofs) {
      if (!queuedProofIds.has(p.id)) {
        photoProof++;
      }
    }
  } catch {
    // ignore
  }

  return {
    total: esarf + leave + photoProof + profile,
    esarf,
    leave,
    photoProof,
    profile,
  };
}

/**
 * Enqueue an item to be submitted to the database once the internet connection is detected.
 */
export async function enqueueOfflineItem(item: OfflineQueueItem): Promise<void> {
  const queue = await getOfflineQueue();
  // If this is a profile update, keep only the newest update in the queue to avoid duplicate calls
  const updated =
    item.type === 'profile_update'
      ? [item, ...queue.filter((q) => q.type !== 'profile_update')]
      : [item, ...queue.filter((q) => q.id !== item.id)];
  await saveOfflineQueue(updated);

  // If this item has display representation for My Requests, merge into local cache
  if (item.type === 'esarf' && item.displayItem) {
    await mergeRequestIntoLocalCache(item.displayItem);
  } else if (item.type === 'leave' && item.displayItems?.length) {
    for (const disp of item.displayItems) {
      await mergeRequestIntoLocalCache(disp);
    }
  }
}

async function mergeRequestIntoLocalCache(req: MyRequest): Promise<void> {
  try {
    const cached = (await getCacheJSON<MyRequest[]>(MY_REQUESTS_CACHE_KEY)) || [];
    const existingIndex = cached.findIndex((c) => c.request_id === req.request_id);
    let updatedList: MyRequest[];
    if (existingIndex !== -1) {
      updatedList = [...cached];
      updatedList[existingIndex] = req;
    } else {
      updatedList = [req, ...cached];
    }
    await setCacheJSON(MY_REQUESTS_CACHE_KEY, updatedList);
    DeviceEventEmitter.emit('my_requests_updated');
  } catch {
    // ignore
  }
}

export async function removeRequestFromLocalCache(requestId: string): Promise<void> {
  if (!requestId) return;
  try {
    const cached = (await getCacheJSON<MyRequest[]>(MY_REQUESTS_CACHE_KEY)) || [];
    const baseId = requestId.replace(/_\d+$/, '');
    const filtered = cached.filter((c) => {
      if (c.request_id === requestId) return false;
      if (baseId && (c.request_id === baseId || c.request_id.startsWith(`${baseId}_`))) return false;
      return true;
    });
    await setCacheJSON(MY_REQUESTS_CACHE_KEY, filtered);
    DeviceEventEmitter.emit('my_requests_updated');
  } catch {
    // ignore
  }
}

export async function replaceOfflineRequestInLocalCache(oldRequestId: string, updatedRequest: MyRequest): Promise<void> {
  if (!oldRequestId) return;
  try {
    const cached = (await getCacheJSON<MyRequest[]>(MY_REQUESTS_CACHE_KEY)) || [];
    const baseId = oldRequestId.replace(/_\d+$/, '');
    let replaced = false;
    const cleanUpdated: MyRequest = {
      ...updatedRequest,
      status: 'pending',
      approval_summary: (updatedRequest.approval_summary || []).map((step) => ({
        ...step,
        status:
          (step.status || '').toLowerCase().includes('offline') ||
          (step.status || '').toLowerCase().includes('pending sync')
            ? 'pending'
            : step.status,
      })),
    };
    const newList = cached.map((c) => {
      if (c.request_id === oldRequestId || (baseId && (c.request_id === baseId || c.request_id.startsWith(`${baseId}_`)))) {
        replaced = true;
        return cleanUpdated;
      }
      return c;
    });
    if (!replaced) {
      newList.unshift(cleanUpdated);
    }
    await setCacheJSON(MY_REQUESTS_CACHE_KEY, newList);
    DeviceEventEmitter.emit('my_requests_updated');
  } catch {
    // ignore
  }
}

export async function removeOfflineItem(id: string): Promise<void> {
  if (!id) return;
  const queue = await getOfflineQueue();
  const baseId = id.replace(/_\d+$/, '');
  const updated = queue.filter((q) => {
    if (q.id === id) return false;
    if (q.id === `offline_update_${id}` || q.id === `offline_edit_${id}` || q.id === `offline_delete_${id}`) return false;
    if (baseId && q.id === baseId) return false;

    if (q.type === 'esarf') {
      if (q.displayItem?.request_id === id) return false;
      if (baseId && q.displayItem?.request_id?.startsWith(baseId)) return false;
      if (q.payload?.targetRequestId === id) return false;
    }

    if (q.type === 'leave') {
      if (q.payload?.targetRequestId === id) return false;
      if (q.displayItems?.some((d) => d.request_id === id || (baseId && d.request_id?.startsWith(baseId)))) return false;
    }

    if (q.type === 'delete_request') {
      if (q.payload?.requestId === id) return false;
    }

    return true;
  });
  await saveOfflineQueue(updated);
}

function isTransientSyncError(err: any): boolean {
  if (!err) return false;
  const msg = (err?.message || String(err)).toLowerCase();
  return (
    msg.includes('statement timeout') ||
    msg.includes('canceling statement') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('connection') ||
    msg.includes('fetch failed') ||
    msg.includes('aborterror') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('502') ||
    msg.includes('deadlock') ||
    msg.includes('lock')
  );
}

async function updateOfflineQueueItem(updatedItem: OfflineQueueItem): Promise<void> {
  try {
    const queue = await getOfflineQueue();
    const idx = queue.findIndex((q) => q.id === updatedItem.id);
    if (idx !== -1) {
      queue[idx] = updatedItem;
      await saveOfflineQueue(queue);
    }
  } catch {
    // ignore
  }
}

async function syncDeleteRequestOnline(requestId: string, isPerk = false): Promise<void> {
  const { error: rpcErr } = await supabase.rpc('delete_my_pending_request', {
    p_request_id: requestId,
    p_is_perk: isPerk,
  });
  if (!rpcErr) return;

  const { error: adminErr } = await supabase.rpc('admin_delete_request', {
    p_request_id: requestId,
    p_is_perk: isPerk,
  });
  if (!adminErr) return;

  if (isPerk) {
    const { error } = await supabase.from('employee_perk_requests').delete().eq('id', requestId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('requests').delete().eq('id', requestId);
    if (error) throw new Error(error.message);
  }
}

let autoRetryTimer: ReturnType<typeof setTimeout> | null = null;

export type SyncResult = {
  success: boolean;
  totalSynced: number;
  esarfSynced: number;
  leaveSynced: number;
  photosSynced: number;
  profileSynced: number;
  failedCount: number;
  errors: string[];
};

let activeSyncPromise: Promise<SyncResult> | null = null;

/**
 * Synchronize all pending offline items to Supabase and Google Drive once online.
 */
export async function syncAllOfflineItems(): Promise<SyncResult> {
  if (isSyncing && activeSyncPromise) {
    console.log('[OfflineQueue] Sync already in progress, awaiting existing sync promise...');
    return activeSyncPromise;
  }

  if (!isAppOnline()) {
    console.log('[OfflineQueue] App is currently offline. Will sync once internet is restored.');
    return {
      success: false,
      totalSynced: 0,
      esarfSynced: 0,
      leaveSynced: 0,
      photosSynced: 0,
      profileSynced: 0,
      failedCount: 0,
      errors: ['Offline'],
    };
  }

  isSyncing = true;

  activeSyncPromise = (async (): Promise<SyncResult> => {
    let esarfSynced = 0;
    let leaveSynced = 0;
    let photosSynced = 0;
    let profileSynced = 0;
    let deleteSynced = 0;
    const errors: string[] = [];
    const syncedProofIds = new Set<string>();

    try {
      // 1. Scan un-uploaded Photo Proofs and Queue items to determine total work
      let allProofs: PhotoProofItem[] = [];
      try {
        allProofs = await loadPhotoProofs();
      } catch (e) {
        console.log('[OfflineQueue] Error scanning photo proofs for sync:', e);
      }
      const unsyncedProofs = allProofs.filter((p) => !p.syncedToCloud);
      const initialQueue = await getOfflineQueue();
      const unsyncedProofIdSet = new Set(unsyncedProofs.map((p) => p.id));
      const queueItemsToProcess = initialQueue.filter((item) => {
        if (item.type === 'photo_proof' && unsyncedProofIdSet.has(item.id)) {
          return false;
        }
        return true;
      });

      const totalToSync = unsyncedProofs.length + queueItemsToProcess.length;

      if (totalToSync === 0) {
        DeviceEventEmitter.emit('offline_sync_completed', {
          total: 0,
          esarf: 0,
          leave: 0,
          photos: 0,
          profile: 0,
        });
        return {
          success: true,
          totalSynced: 0,
          esarfSynced: 0,
          leaveSynced: 0,
          photosSynced: 0,
          profileSynced: 0,
          failedCount: 0,
          errors: [],
        };
      }

      let processedCount = 0;
      const emitProgress = () => {
        const percent = totalToSync > 0 ? Math.min(100, Math.round((processedCount / totalToSync) * 100)) : 0;
        DeviceEventEmitter.emit('offline_sync_progress', {
          current: processedCount,
          total: totalToSync,
          percent,
        });
      };

      DeviceEventEmitter.emit('offline_sync_started', { total: totalToSync });
      emitProgress();

      // 1. Sync un-uploaded Photo Proofs to Google Drive & Supabase table
      console.log('[OfflineQueue] Starting photo proofs sync...');
      const proofLinkMap = new Map<string, string>();
      const proofLocMap = new Map<string, string>();

      for (const proof of unsyncedProofs) {
        const originalId = proof.id;
        const originalPhotoUri = proof.photoUri;
        const originalLocalUri = proof.localFileUri;
        const originalTimestamp = proof.timestamp;
        try {
          const ok = await syncPhotoProofToCloud(proof);
          if (ok) {
            photosSynced++;
            syncedProofIds.add(proof.id);
            syncedProofIds.add(originalId);
            const resolvedLink = proof.driveWebViewLink || (proof.photoUri && proof.photoUri.startsWith('http') ? proof.photoUri : null);
            if (resolvedLink) {
              proofLinkMap.set(originalId, resolvedLink);
              proofLinkMap.set(proof.id, resolvedLink);
              if (originalPhotoUri) proofLinkMap.set(originalPhotoUri, resolvedLink);
              if (proof.photoUri) proofLinkMap.set(proof.photoUri, resolvedLink);
              if (originalLocalUri) proofLinkMap.set(originalLocalUri, resolvedLink);
              if (originalTimestamp) proofLinkMap.set(originalTimestamp, resolvedLink);
            }
            const hasRealAddress = proof.locationText && !proof.locationText.startsWith('Lat:') && !proof.locationText.includes('Lon:');
            if (hasRealAddress) {
              proofLocMap.set(originalId, proof.locationText);
              proofLocMap.set(proof.id, proof.locationText);
              if (originalPhotoUri) proofLocMap.set(originalPhotoUri, proof.locationText);
              if (originalTimestamp) proofLocMap.set(originalTimestamp, proof.locationText);
            }
            // Also immediately clear from offline queue if queued there
            await removeOfflineItem(proof.id);
            await removeOfflineItem(originalId);
          }
        } catch (pErr: any) {
          console.log('[OfflineQueue] Photo proof upload failed:', proof.id, pErr);
        }
        processedCount++;
        emitProgress();
      }

      // Map of synced photo proof drive links for updating ESARF reasons
      const freshProofs = await loadPhotoProofs();
      for (const fp of freshProofs) {
        const link = fp.driveWebViewLink || (fp.photoUri && fp.photoUri.startsWith('http') ? fp.photoUri : null);
        if (link) {
          proofLinkMap.set(fp.id, link);
          if (fp.localId) proofLinkMap.set(fp.localId, link);
          if (fp.photoUri) proofLinkMap.set(fp.photoUri, link);
          if (fp.localFileUri) proofLinkMap.set(fp.localFileUri, link);
          if (fp.timestamp) proofLinkMap.set(fp.timestamp, link);
        }
        const hasRealAddress = fp.locationText && !fp.locationText.startsWith('Lat:') && !fp.locationText.includes('Lon:');
        if (hasRealAddress) {
          proofLocMap.set(fp.id, fp.locationText);
          if (fp.localId) proofLocMap.set(fp.localId, fp.locationText);
          if (fp.photoUri) proofLocMap.set(fp.photoUri, fp.locationText);
          if (fp.localFileUri) proofLocMap.set(fp.localFileUri, fp.locationText);
          if (fp.timestamp) proofLocMap.set(fp.timestamp, fp.locationText);
        }
      }

      for (const item of queueItemsToProcess) {
        try {
        if (item.type === 'photo_proof') {
          // If already synced during Step 1 or previous attempt, immediately dequeue
          if (syncedProofIds.has(item.id) || item.payload.syncedToCloud) {
            await removeOfflineItem(item.id);
            continue;
          }
          try {
            const ok = await syncPhotoProofToCloud(item.payload);
            if (ok) {
              photosSynced++;
              syncedProofIds.add(item.id);
              await removeOfflineItem(item.id);
            }
          } catch (err: any) {
            errors.push(`Photo proof ${item.id}: ${err.message || err}`);
          }
        } else if (item.type === 'esarf') {
          try {
            console.log('[OfflineQueue] Submitting queued ESARF:', item.id);
            // 1. Resolve any attached photo proof drive links and real street addresses in reason (replace local URIs in-place)
            let reason = item.payload.combinedReason;
            if (item.payload.attachedProofs?.length) {
              for (const att of item.payload.attachedProofs) {
                let driveLink = att.driveWebViewLink;
                if (!driveLink && att.photoProofId && proofLinkMap.has(att.photoProofId)) {
                  driveLink = proofLinkMap.get(att.photoProofId);
                }
                if (!driveLink && att.uri && proofLinkMap.has(att.uri)) {
                  driveLink = proofLinkMap.get(att.uri);
                }
                if (!driveLink && att.localFileUri && proofLinkMap.has(att.localFileUri)) {
                  driveLink = proofLinkMap.get(att.localFileUri);
                }
                if (!driveLink && att.timestamp && proofLinkMap.has(att.timestamp)) {
                  driveLink = proofLinkMap.get(att.timestamp);
                }

                const isGalleryAtt = att.source === 'gallery' || (!att.timestamp && !att.locationText);

                // Resolve real street address
                let resolvedLoc: string | undefined;
                if (!isGalleryAtt) {
                  if (att.photoProofId && proofLocMap.has(att.photoProofId)) {
                    resolvedLoc = proofLocMap.get(att.photoProofId);
                  }
                  if (!resolvedLoc && att.uri && proofLocMap.has(att.uri)) {
                    resolvedLoc = proofLocMap.get(att.uri);
                  }
                  if (!resolvedLoc && att.localFileUri && proofLocMap.has(att.localFileUri)) {
                    resolvedLoc = proofLocMap.get(att.localFileUri);
                  }
                  if (!resolvedLoc && att.timestamp && proofLocMap.has(att.timestamp)) {
                    resolvedLoc = proofLocMap.get(att.timestamp);
                  }
                  if (!resolvedLoc && typeof att.latitude === 'number' && typeof att.longitude === 'number') {
                    try {
                      const geo = await reverseGeocodeCoordinates(att.latitude, att.longitude);
                      if (geo) resolvedLoc = geo;
                    } catch {}
                  }
                }

                if (driveLink) {
                  const isBase64 = att.uri && att.uri.startsWith('data:image/');
                  let replaced = false;

                  if (isBase64) {
                    const b64Regex = /\[Proof:\s*data:image\/[^\]]+\]/gi;
                    if (b64Regex.test(reason)) {
                      reason = reason.replace(b64Regex, `[Proof: ${driveLink}]`);
                      replaced = true;
                    }
                  }

                  const possibleLocalTargets = [
                    att.localFileUri,
                    att.photoProofId,
                    !isBase64 ? att.uri : null,
                  ].filter(Boolean) as string[];

                  // In-place replacement of any matching local URI tag in reason
                  for (const target of possibleLocalTargets) {
                    if (!target) continue;
                    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const targetRegex = new RegExp(`\\[Proof:\\s*${escaped}\\]`, 'gi');
                    if (targetRegex.test(reason)) {
                      reason = reason.replace(targetRegex, `[Proof: ${driveLink}]`);
                      replaced = true;
                      break;
                    }
                  }

                  // If not replaced by exact target match, check for any unmatched local file URI tag
                  if (!replaced && !reason.includes(driveLink)) {
                    const localTagRegex = /\[Proof:\s*(?:file:|content:|data:image\/|blob:|\/)[^\]]+\]/i;
                    if (localTagRegex.test(reason)) {
                      reason = reason.replace(localTagRegex, `[Proof: ${driveLink}]`);
                      replaced = true;
                    }
                  }

                  // If still not present in reason, append safely
                  if (!reason.includes(driveLink)) {
                    reason = `${reason} [Proof: ${driveLink}]${isGalleryAtt ? ' [ProofSource: gallery]' : ''}`.trim();
                  }

                  // If this was a gallery proof, ensure [ProofSource: gallery] follows it and no camera tags are present
                  if (isGalleryAtt) {
                    const driveProofPattern = new RegExp(
                      `(\\[Proof:\\s*${driveLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\])` +
                      `(\\s*\\[Proof(?:Time|Loc|Id):\\s*[^\]]+\\])*` +
                      `(\\s*\\[ProofSource:\\s*[^\]]+\\])?`,
                      'gi'
                    );
                    reason = reason.replace(driveProofPattern, `$1 [ProofSource: gallery]`);
                  }

                  // Remove any duplicate leftover local proof tags to guarantee no duplicate proofs
                  for (const target of possibleLocalTargets) {
                    if (!target) continue;
                    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const leftoverRegex = new RegExp(
                      `\\s*\\[Proof:\\s*${escaped}\\](\\s*\\[Proof(?:Source|Time|Loc|Id):\\s*[^\]]+\\])*`,
                      'gi'
                    );
                    reason = reason.replace(leftoverRegex, '').trim();
                  }
                }

                // In-place replacement of raw coordinates with the real street address
                if (resolvedLoc) {
                  if (att.locationText) {
                    const cleanOld = att.locationText.replace(/[\[\]]/g, '').trim();
                    reason = reason.split(`[ProofLoc: ${cleanOld}]`).join(`[ProofLoc: ${resolvedLoc}]`);
                  }
                  reason = reason.replace(/\[ProofLoc:\s*Lat:\s*[0-9.-]+[,\s]+Lon:\s*[0-9.-]+\]/gi, `[ProofLoc: ${resolvedLoc}]`);
                }
              }

              // Final cleanup of any raw local file URI proof tags if a Google Drive link exists in reason
              if (/\[Proof:\s*https?:\/\/[^\]]+\]/i.test(reason)) {
                reason = reason.replace(/\s*\[Proof:\s*(?:file:|content:|blob:|data:|\/)[^\]]+\](?:\s*\[Proof(?:Source|Time|Loc|Id):\s*[^\]]+\])*/gi, '').trim();
              }
            }

            let esarfSubmittedSuccessfully = false;
            let lastEsarfErr: any = null;

            if (item.payload.isEdit && item.payload.targetRequestId) {
              console.log('[OfflineQueue] Submitting queued ESARF edit update for request:', item.payload.targetRequestId);
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  if (attempt > 1) {
                    console.log(`[OfflineQueue] Retrying ESARF update (${attempt}/3) for ${item.payload.targetRequestId}...`);
                    await new Promise((r) => setTimeout(r, 2000 * (attempt - 1)));
                  }

                  const { error } = await supabase.rpc('update_my_pending_request', {
                    p_request_id: item.payload.targetRequestId,
                    p_request_type_code: item.payload.primaryRequestType,
                    p_date_from: item.payload.overallDateFrom,
                    p_date_to: item.payload.overallDateTo,
                    p_time_from: item.payload.overallTimeFrom ? item.payload.overallTimeFrom : null,
                    p_time_to: item.payload.overallTimeTo ? item.payload.overallTimeTo : null,
                    p_total_hours: item.payload.totalHoursSum,
                    p_reason: reason,
                    p_time_schedule: item.payload.schedule,
                    p_day_off: item.payload.dayOff,
                    p_payroll_class: item.payload.payrollClass,
                    p_transaction_type: item.payload.combinedTransactionType || null,
                  });

                  if (error) {
                    throw new Error(error.message);
                  }

                  esarfSubmittedSuccessfully = true;
                  lastEsarfErr = null;
                  break;
                } catch (err: any) {
                  lastEsarfErr = err;
                  if (!isTransientSyncError(err) || attempt === 3) {
                    break;
                  }
                }
              }

              if (esarfSubmittedSuccessfully) {
                esarfSynced++;
                await removeOfflineItem(item.id);
                await removeCacheItem(MY_REQUESTS_CACHE_KEY).catch(() => {});
                DeviceEventEmitter.emit('my_requests_updated');
                console.log('[OfflineQueue] ESARF update successfully synced to database:', item.payload.targetRequestId);
              } else {
                const errMsg = lastEsarfErr?.message || String(lastEsarfErr);
                console.log('[OfflineQueue] ESARF update sync paused:', item.id, errMsg);
                errors.push(`ESARF Update: ${errMsg}`);
                item.syncAttempts = (item.syncAttempts || 0) + 1;
                item.lastError = errMsg;
                await updateOfflineQueueItem(item);
              }
            } else {
              let createdServerId: string | null = null;
              // Retry up to 3 attempts for transient database timeouts or network interruptions
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  if (attempt > 1) {
                    console.log(`[OfflineQueue] Retrying ESARF submission (${attempt}/3) for ${item.id}...`);
                    await new Promise((r) => setTimeout(r, 2000 * (attempt - 1)));
                  }

                  const { data: newRequestId, error } = await supabase.rpc('submit_time_request', {
                    p_request_type_code: item.payload.primaryRequestType,
                    p_date_from: item.payload.overallDateFrom,
                    p_date_to: item.payload.overallDateTo,
                    p_time_from: item.payload.overallTimeFrom ? item.payload.overallTimeFrom : null,
                    p_time_to: item.payload.overallTimeTo ? item.payload.overallTimeTo : null,
                    p_total_hours: item.payload.totalHoursSum,
                    p_reason: reason,
                    p_time_schedule: item.payload.schedule,
                    p_day_off: item.payload.dayOff,
                    p_payroll_class: item.payload.payrollClass,
                    p_transaction_type: item.payload.combinedTransactionType || null,
                  });

                  if (error) {
                    throw new Error(error.message);
                  }

                  if (newRequestId) {
                    createdServerId = String(newRequestId);
                  }
                  esarfSubmittedSuccessfully = true;
                  lastEsarfErr = null;
                  break;
                } catch (err: any) {
                  lastEsarfErr = err;
                  if (!isTransientSyncError(err) || attempt === 3) {
                    break;
                  }
                }
              }

              if (esarfSubmittedSuccessfully) {
                esarfSynced++;
                await removeOfflineItem(item.id);
                if (createdServerId) {
                  await replaceOfflineRequestInLocalCache(item.displayItem.request_id, {
                    ...item.displayItem,
                    request_id: createdServerId,
                    status: 'pending',
                  });
                  DeviceEventEmitter.emit('offline_request_synced', {
                    oldId: item.displayItem.request_id,
                    newId: createdServerId,
                  });
                } else {
                  await removeRequestFromLocalCache(item.displayItem.request_id);
                }
                console.log('[OfflineQueue] ESARF request successfully synced online to database:', item.id);
              } else {
                const errMsg = lastEsarfErr?.message || String(lastEsarfErr);
                console.log('[OfflineQueue] ESARF sync paused (will auto-retry once database is responsive):', item.id, errMsg);
                errors.push(`ESARF: ${errMsg}`);
                item.syncAttempts = (item.syncAttempts || 0) + 1;
                item.lastError = errMsg;
                await updateOfflineQueueItem(item);
              }
            }
          } catch (err: any) {
            console.log('[OfflineQueue] Failed to process ESARF item:', item.id, err);
            errors.push(`ESARF: ${err.message || err}`);
          }
        } else if (item.type === 'leave') {
          try {
            console.log('[OfflineQueue] Submitting queued Leave request:', item.id);

            if (item.payload.isEdit && item.payload.targetRequestId && item.payload.entries.length > 0) {
              const ent = item.payload.entries[0];
              let leaveUpdatedSuccessfully = false;
              let lastLeaveErr: any = null;

              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  if (attempt > 1) {
                    console.log(`[OfflineQueue] Retrying Leave update (${attempt}/3) for ${item.payload.targetRequestId}...`);
                    await new Promise((r) => setTimeout(r, 2000 * (attempt - 1)));
                  }

                  const { error } = await supabase.rpc('update_my_pending_request', {
                    p_request_id: item.payload.targetRequestId,
                    p_request_type_code: 'leave',
                    p_leave_type: ent.leaveType,
                    p_leave_category: ent.leaveCategory,
                    p_start_date: ent.startDate,
                    p_end_date: ent.endDate,
                    p_total_days: ent.paidDays + ent.unpaidDays,
                    p_paid_days: ent.paidDays,
                    p_unpaid_days: ent.unpaidDays,
                    p_reason: ent.reason,
                  });

                  if (error) {
                    throw new Error(error.message);
                  }

                  leaveUpdatedSuccessfully = true;
                  lastLeaveErr = null;
                  break;
                } catch (lErr: any) {
                  lastLeaveErr = lErr;
                  if (!isTransientSyncError(lErr) || attempt === 3) {
                    break;
                  }
                }
              }

              if (leaveUpdatedSuccessfully) {
                leaveSynced++;
                await removeOfflineItem(item.id);
                await removeCacheItem(MY_REQUESTS_CACHE_KEY).catch(() => {});
                DeviceEventEmitter.emit('my_requests_updated');
                console.log('[OfflineQueue] Leave update successfully synced online to database:', item.payload.targetRequestId);
              } else {
                const errMsg = lastLeaveErr?.message || String(lastLeaveErr);
                console.log('[OfflineQueue] Leave update sync paused:', item.id, errMsg);
                errors.push(`Leave Update: ${errMsg}`);
                item.syncAttempts = (item.syncAttempts || 0) + 1;
                item.lastError = errMsg;
                await updateOfflineQueueItem(item);
              }
            } else {
              let allEntriesSucceeded = true;
              let lastLeaveErr: any = null;
              const createdLeaveIds: string[] = [];

              for (const ent of item.payload.entries) {
                let entryOk = false;
                for (let attempt = 1; attempt <= 3; attempt++) {
                  try {
                    if (attempt > 1) {
                      console.log(`[OfflineQueue] Retrying Leave submission (${attempt}/3) for ${item.id}...`);
                      await new Promise((r) => setTimeout(r, 2000 * (attempt - 1)));
                    }

                    const { data: newLeaveId, error } = await supabase.rpc('submit_leave_request', {
                      p_leave_type: ent.leaveType,
                      p_leave_category: ent.leaveCategory,
                      p_start_date: ent.startDate,
                      p_end_date: ent.endDate,
                      p_paid_days: ent.paidDays,
                      p_unpaid_days: ent.unpaidDays,
                      p_reason: ent.reason,
                    });

                    if (error) {
                      throw new Error(error.message);
                    }

                    if (newLeaveId) {
                      createdLeaveIds.push(String(newLeaveId));
                    }

                    if (ent.leaveCategory === 'Birthday Leave' && item.payload.identities) {
                      const { username, employeeId, userEmail } = item.payload.identities;
                      await markBirthdayLeaveGrantedForYear([username, employeeId, userEmail]);
                    }

                    entryOk = true;
                    break;
                  } catch (lErr: any) {
                    lastLeaveErr = lErr;
                    if (!isTransientSyncError(lErr) || attempt === 3) {
                      break;
                    }
                  }
                }

                if (!entryOk) {
                  allEntriesSucceeded = false;
                  break;
                }
              }

              if (allEntriesSucceeded) {
                leaveSynced++;
                await removeOfflineItem(item.id);
                if (item.displayItems?.length) {
                  for (let i = 0; i < item.displayItems.length; i++) {
                    const disp = item.displayItems[i];
                    const serverId = createdLeaveIds[i];
                    if (serverId) {
                      await replaceOfflineRequestInLocalCache(disp.request_id, {
                        ...disp,
                        request_id: serverId,
                        status: 'pending',
                      });
                      DeviceEventEmitter.emit('offline_request_synced', {
                        oldId: disp.request_id,
                        newId: serverId,
                      });
                    } else {
                      await removeRequestFromLocalCache(disp.request_id);
                    }
                  }
                }
                console.log('[OfflineQueue] Leave request successfully synced online to database:', item.id);
              } else {
                const errMsg = lastLeaveErr?.message || String(lastLeaveErr);
                console.log('[OfflineQueue] Leave sync paused (will auto-retry once database is responsive):', item.id, errMsg);
                errors.push(`Leave: ${errMsg}`);
                item.syncAttempts = (item.syncAttempts || 0) + 1;
                item.lastError = errMsg;
                await updateOfflineQueueItem(item);
              }
            }
          } catch (err: any) {
            console.log('[OfflineQueue] Failed to process Leave item:', item.id, err);
            errors.push(`Leave: ${err.message || err}`);
          }
        } else if (item.type === 'profile_update') {
          try {
            console.log('[OfflineQueue] Submitting queued Profile update:', item.id);
            await updateEmployeeProfile(item.payload);
            profileSynced++;
            await removeOfflineItem(item.id);
            console.log('[OfflineQueue] Profile update successfully synced online to database:', item.id);
          } catch (err: any) {
            console.log('[OfflineQueue] Failed to sync Profile update:', item.id, err);
            errors.push(`Profile: ${err.message || err}`);
          }
        } else if (item.type === 'delete_request') {
          try {
            console.log('[OfflineQueue] Submitting queued Delete request:', item.payload.requestId);
            await syncDeleteRequestOnline(item.payload.requestId, item.payload.isPerk);
            deleteSynced++;
            await removeOfflineItem(item.id);
            console.log('[OfflineQueue] Request deletion successfully synced online to database:', item.payload.requestId);
          } catch (err: any) {
            console.log('[OfflineQueue] Failed to sync Delete request:', item.id, err);
            errors.push(`Delete: ${err.message || err}`);
          }
        }
      } finally {
        processedCount++;
        emitProgress();
      }
    }

      const totalSynced = esarfSynced + leaveSynced + photosSynced + profileSynced + deleteSynced;
      const currentQueue = await getOfflineQueue();

      if (totalSynced > 0) {
        console.log(`[OfflineQueue] Sync completed! Synced: ${totalSynced} items (${esarfSynced} ESARF, ${leaveSynced} Leave, ${photosSynced} Photos, ${profileSynced} Profile, ${deleteSynced} Deleted)`);
        if (esarfSynced > 0 || leaveSynced > 0 || deleteSynced > 0) {
          try {
            await removeCacheItem(MY_REQUESTS_CACHE_KEY).catch(() => {});
          } catch {
            // ignore
          }
        }
        DeviceEventEmitter.emit('requests_synced_online', {
          total: totalSynced,
          esarf: esarfSynced,
          leave: leaveSynced,
          photos: photosSynced,
          profile: profileSynced,
        });
        if (profileSynced > 0) {
          DeviceEventEmitter.emit('profile_updated_online');
        }
        DeviceEventEmitter.emit('my_requests_updated');
        DeviceEventEmitter.emit('refresh_dashboard');
      }

      DeviceEventEmitter.emit('offline_sync_completed', {
        total: totalSynced,
        esarf: esarfSynced,
        leave: leaveSynced,
        photos: photosSynced,
        profile: profileSynced,
      });

      // If transient errors occurred (such as DB statement timeout), auto-schedule a retry in 20s
      if (errors.length > 0 && isAppOnline()) {
        const hasTransient = errors.some((e) => isTransientSyncError(e));
        if (hasTransient) {
          if (autoRetryTimer) clearTimeout(autoRetryTimer);
          autoRetryTimer = setTimeout(() => {
            autoRetryTimer = null;
            if (isAppOnline()) {
              console.log('[OfflineQueue] Auto-retrying offline items after previous transient timeout...');
              void syncAllOfflineItems();
            }
          }, 20000);
        }
      }

      return {
        success: errors.length === 0,
        totalSynced,
        esarfSynced,
        leaveSynced,
        photosSynced,
        profileSynced,
        failedCount: currentQueue.length,
        errors,
      };
    } finally {
      isSyncing = false;
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

// Debounced listener for network restoration to avoid rapid-fire concurrent triggers
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

DeviceEventEmitter.addListener('network_restored', () => {
  console.log('[OfflineQueue] Network restored detected! Scheduling debounced sync...');
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    void syncAllOfflineItems();
  }, 2000);
});
