import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

export type ActiveViewerInfo = {
  isLocked: boolean;
  approverName?: string;
  approverPosition?: string;
  viewingAt?: number;
};

// Global active locks registry map for the current app instance
const activeLocks: Record<
  string,
  { isLocked: boolean; approverName: string; approverPosition?: string; timestamp: number }
> = {};

let lockChannel: any = null;

function ensureLockChannel() {
  if (!lockChannel) {
    lockChannel = supabase.channel('global_request_locks');

    lockChannel
      .on('broadcast', { event: 'lock_heartbeat' }, (msg: any) => {
        const p = msg?.payload;
        if (p && p.requestId) {
          activeLocks[p.requestId] = {
            isLocked: true,
            approverName: p.approverName || 'Manager / Approver',
            approverPosition: p.approverPosition || 'Approver',
            timestamp: Date.now(),
          };
          void setCacheJSON(`req_viewer_lock_${p.requestId}`, {
            name: p.approverName,
            position: p.approverPosition,
            timestamp: Date.now(),
            isLocked: true,
          });
        }
      })
      .on('broadcast', { event: 'lock_released' }, (msg: any) => {
        const p = msg?.payload;
        if (p && p.requestId) {
          delete activeLocks[p.requestId];
          void setCacheJSON(`req_viewer_lock_${p.requestId}`, null);
        }
      });

    lockChannel.subscribe();
  }

  return lockChannel;
}

// Initialize global lock channel subscriber on app load
ensureLockChannel();

/**
 * Called by ApprovalsScreen when a manager/approver opens a pending request details sheet.
 * Broadcasts lock heartbeat every 1.5 seconds over Realtime channel.
 */
export function startApproverViewingSession(
  requestId: string,
  approverName: string,
  approverPosition?: string,
): () => void {
  if (!requestId) return () => {};

  const cleanReqId = requestId.trim();
  const channel = ensureLockChannel();
  const name = approverName || 'Manager / Approver';
  const position = approverPosition || 'Approver';

  const sendHeartbeat = () => {
    try {
      void channel.send({
        type: 'broadcast',
        event: 'lock_heartbeat',
        payload: {
          requestId: cleanReqId,
          approverName: name,
          approverPosition: position,
          timestamp: Date.now(),
        },
      });
    } catch {
      // ignore send error
    }
  };

  // Register locally and send initial heartbeat
  activeLocks[cleanReqId] = { isLocked: true, approverName: name, approverPosition: position, timestamp: Date.now() };
  void setCacheJSON(`req_viewer_lock_${cleanReqId}`, { name, position, timestamp: Date.now(), isLocked: true });

  sendHeartbeat();
  const interval = setInterval(sendHeartbeat, 1500);

  const cleanup = () => {
    clearInterval(interval);
    delete activeLocks[cleanReqId];
    void setCacheJSON(`req_viewer_lock_${cleanReqId}`, null);

    try {
      void channel.send({
        type: 'broadcast',
        event: 'lock_released',
        payload: { requestId: cleanReqId },
      });
    } catch {
      // ignore
    }
  };

  return cleanup;
}

/**
 * Checks if a manager or approver is currently viewing the request.
 */
export async function checkApproverActiveViewing(requestId: string): Promise<ActiveViewerInfo> {
  if (!requestId) return { isLocked: false };

  const cleanReqId = requestId.trim();

  // 1. Check in-memory activeLocks registry (updated via Realtime Broadcast)
  const memoryLock = activeLocks[cleanReqId];
  if (memoryLock && memoryLock.isLocked && Date.now() - memoryLock.timestamp < 12000) {
    return {
      isLocked: true,
      approverName: memoryLock.approverName || 'Manager / Approver',
      approverPosition: memoryLock.approverPosition || 'Approver',
      viewingAt: memoryLock.timestamp,
    };
  }

  // 2. Check localCache fallback (useful across same browser tabs/windows)
  const cached = await getCacheJSON<any>(`req_viewer_lock_${cleanReqId}`);
  if (cached && cached.timestamp && Date.now() - cached.timestamp < 12000) {
    return {
      isLocked: true,
      approverName: cached.name || 'Manager / Approver',
      approverPosition: cached.position || 'Approver',
      viewingAt: cached.timestamp,
    };
  }

  return { isLocked: false };
}
