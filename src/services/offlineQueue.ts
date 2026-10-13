import { DeviceEventEmitter } from 'react-native';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';
import { isAppOnline } from './network';
import {
  syncPhotoProofToCloud,
  loadPhotoProofs,
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
    driveWebViewLink?: string | null;
  }>;
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
    const filtered = cached.filter((c) => c.request_id !== req.request_id);
    await setCacheJSON(MY_REQUESTS_CACHE_KEY, [req, ...filtered]);
    DeviceEventEmitter.emit('my_requests_updated');
  } catch {
    // ignore
  }
}

async function removeRequestFromLocalCache(requestId: string): Promise<void> {
  try {
    const cached = (await getCacheJSON<MyRequest[]>(MY_REQUESTS_CACHE_KEY)) || [];
    const filtered = cached.filter((c) => c.request_id !== requestId);
    await setCacheJSON(MY_REQUESTS_CACHE_KEY, filtered);
  } catch {
    // ignore
  }
}

export async function removeOfflineItem(id: string): Promise<void> {
  const queue = await getOfflineQueue();
  const updated = queue.filter((q) => q.id !== id);
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
  DeviceEventEmitter.emit('offline_sync_started');

  activeSyncPromise = (async (): Promise<SyncResult> => {
    let esarfSynced = 0;
    let leaveSynced = 0;
    let photosSynced = 0;
    let profileSynced = 0;
    const errors: string[] = [];
    const syncedProofIds = new Set<string>();

    try {
      // 1. Sync un-uploaded Photo Proofs to Google Drive & Supabase table
      console.log('[OfflineQueue] Starting photo proofs sync...');
      try {
        const proofs = await loadPhotoProofs();
        for (const proof of proofs) {
          if (!proof.syncedToCloud) {
            try {
              const ok = await syncPhotoProofToCloud(proof);
              if (ok) {
                photosSynced++;
                syncedProofIds.add(proof.id);
                // Also immediately clear from offline queue if queued there
                await removeOfflineItem(proof.id);
              }
            } catch (pErr: any) {
              console.log('[OfflineQueue] Photo proof upload failed:', proof.id, pErr);
            }
          } else {
            syncedProofIds.add(proof.id);
          }
        }
      } catch (e) {
        console.log('[OfflineQueue] Error scanning photo proofs for sync:', e);
      }

      const queue = await getOfflineQueue();
      if (queue.length === 0 && photosSynced === 0) {
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

      // Map of synced photo proof drive links for updating ESARF reasons
      const freshProofs = await loadPhotoProofs();
      const proofLinkMap = new Map<string, string>();
      for (const fp of freshProofs) {
        if (fp.driveWebViewLink) {
          proofLinkMap.set(fp.id, fp.driveWebViewLink);
          if (fp.photoUri) proofLinkMap.set(fp.photoUri, fp.driveWebViewLink);
        }
      }

      for (const item of queue) {
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
            // 1. Resolve any attached photo proof drive links in reason
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
                if (driveLink && !reason.includes(driveLink)) {
                  reason = `${reason} [Proof: ${driveLink}]`.trim();
                }
              }
            }

            let esarfSubmittedSuccessfully = false;
            let lastEsarfErr: any = null;

            // Retry up to 3 attempts for transient database timeouts or network interruptions
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                if (attempt > 1) {
                  console.log(`[OfflineQueue] Retrying ESARF submission (${attempt}/3) for ${item.id}...`);
                  await new Promise((r) => setTimeout(r, 2000 * (attempt - 1)));
                }

                const { error } = await supabase.rpc('submit_time_request', {
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
              // Immediately remove from offline queue storage and local placeholder
              await removeOfflineItem(item.id);
              await removeRequestFromLocalCache(item.displayItem.request_id);
              console.log('[OfflineQueue] ESARF request successfully synced online to database:', item.id);
            } else {
              const errMsg = lastEsarfErr?.message || String(lastEsarfErr);
              console.log('[OfflineQueue] ESARF sync paused (will auto-retry once database is responsive):', item.id, errMsg);
              errors.push(`ESARF: ${errMsg}`);
              item.syncAttempts = (item.syncAttempts || 0) + 1;
              item.lastError = errMsg;
              await updateOfflineQueueItem(item);
            }
          } catch (err: any) {
            console.log('[OfflineQueue] Failed to process ESARF item:', item.id, err);
            errors.push(`ESARF: ${err.message || err}`);
          }
        } else if (item.type === 'leave') {
          try {
            console.log('[OfflineQueue] Submitting queued Leave request:', item.id);
            let allEntriesSucceeded = true;
            let lastLeaveErr: any = null;

            for (const ent of item.payload.entries) {
              let entryOk = false;
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  if (attempt > 1) {
                    console.log(`[OfflineQueue] Retrying Leave submission (${attempt}/3) for ${item.id}...`);
                    await new Promise((r) => setTimeout(r, 2000 * (attempt - 1)));
                  }

                  const { error } = await supabase.rpc('submit_leave_request', {
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
                for (const disp of item.displayItems) {
                  await removeRequestFromLocalCache(disp.request_id);
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
        }
      }

      const totalSynced = esarfSynced + leaveSynced + photosSynced + profileSynced;
      const currentQueue = await getOfflineQueue();

      if (totalSynced > 0) {
        console.log(`[OfflineQueue] Sync completed! Synced: ${totalSynced} items (${esarfSynced} ESARF, ${leaveSynced} Leave, ${photosSynced} Photos, ${profileSynced} Profile)`);
        DeviceEventEmitter.emit('requests_synced_online', {
          total: totalSynced,
          esarf: esarfSynced,
          leave: leaveSynced,
          photos: photosSynced,
          profile: profileSynced,
        });
        DeviceEventEmitter.emit('offline_sync_completed', {
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
