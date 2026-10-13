import { useEffect, useState } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';
import NetInfo, { type NetInfoState, type NetInfoStateType } from '@react-native-community/netinfo';

/**
 * Offline Mode and sync queue is only applicable on the native Android APK app.
 * iOS Web and PWA require an active internet connection to access the app.
 */
export const isOfflineSupported = Platform.OS === 'android';

export type NetworkStatus = {
  isOnline: boolean;
  isConnected: boolean;
  isInternetReachable: boolean;
  connectionType: NetInfoStateType | string;
  lastCheckedAt: number;
};

let currentStatus: NetworkStatus = {
  isOnline: true,
  isConnected: true,
  isInternetReachable: true,
  connectionType: 'unknown',
  lastCheckedAt: Date.now(),
};

const listeners = new Set<(status: NetworkStatus) => void>();
let isInitialized = false;
let pingInProgress = false;

/**
 * Lightweight verification ping to check true internet connectivity on Android.
 * Always returns true on iOS Web/PWA since internet is required to access the app.
 */
export async function verifyInternetReachability(): Promise<boolean> {
  if (!isOfflineSupported) {
    return true;
  }

  if (pingInProgress) return currentStatus.isOnline;
  pingInProgress = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // Primary: Google 204 endpoint (standard Android connectivity test)
    const res = await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      cache: 'no-cache',
      signal: controller.signal,
    }).catch(async () => {
      // Secondary fallback
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 3000);
      return await fetch('https://httpbin.org/status/200', {
        method: 'GET',
        cache: 'no-cache',
        signal: controller2.signal,
      }).finally(() => clearTimeout(timeoutId2));
    });

    clearTimeout(timeoutId);
    return Boolean(res && (res.status === 204 || res.status === 200 || res.ok));
  } catch {
    return false;
  } finally {
    pingInProgress = false;
  }
}

function updateStatus(newStatus: Partial<NetworkStatus>) {
  const prevOnline = currentStatus.isOnline;
  currentStatus = { ...currentStatus, ...newStatus, lastCheckedAt: Date.now() };

  listeners.forEach((listener) => {
    try {
      listener(currentStatus);
    } catch (e) {
      console.warn('[Network] Listener error:', e);
    }
  });

  DeviceEventEmitter.emit('network_status_changed', currentStatus);

  if (!prevOnline && currentStatus.isOnline) {
    console.log('[Network] Connection restored! Emitting network_restored event.');
    DeviceEventEmitter.emit('network_restored', currentStatus);
  }
}

export async function refreshNetworkStatus(): Promise<NetworkStatus> {
  if (!isOfflineSupported) {
    return {
      isOnline: true,
      isConnected: true,
      isInternetReachable: true,
      connectionType: 'wifi',
      lastCheckedAt: Date.now(),
    };
  }

  try {
    const netState = await NetInfo.fetch();
    const isConnected = Boolean(netState.isConnected);
    let isReachable = netState.isInternetReachable ?? isConnected;

    if (isConnected) {
      const pingOk = await verifyInternetReachability();
      isReachable = pingOk;
    } else {
      isReachable = false;
    }

    const isOnline = isConnected && isReachable;
    updateStatus({
      isOnline,
      isConnected,
      isInternetReachable: isReachable,
      connectionType: netState.type,
    });
    return currentStatus;
  } catch (err) {
    console.warn('[Network] refreshNetworkStatus error:', err);
    return currentStatus;
  }
}

export function initNetworkService() {
  if (!isOfflineSupported) return;
  if (isInitialized) return;
  isInitialized = true;

  // Initial fetch
  void refreshNetworkStatus();

  // Subscribe to NetInfo network changes
  NetInfo.addEventListener(async (state: NetInfoState) => {
    const isConnected = Boolean(state.isConnected);
    let isReachable = state.isInternetReachable ?? isConnected;

    if (isConnected) {
      const pingOk = await verifyInternetReachability();
      isReachable = pingOk;
    } else {
      isReachable = false;
    }

    const isOnline = isConnected && isReachable;
    updateStatus({
      isOnline,
      isConnected,
      isInternetReachable: isReachable,
      connectionType: state.type,
    });
  });

  // Periodic heartbeat verification every 8 seconds on Android
  setInterval(() => {
    void refreshNetworkStatus();
  }, 8000);
}

export function getNetworkStatus(): NetworkStatus {
  if (!isOfflineSupported) {
    return {
      isOnline: true,
      isConnected: true,
      isInternetReachable: true,
      connectionType: 'wifi',
      lastCheckedAt: Date.now(),
    };
  }
  return currentStatus;
}

export function isAppOnline(): boolean {
  if (!isOfflineSupported) {
    return true;
  }
  return currentStatus.isOnline;
}

/**
 * React Hook providing real-time online/offline status.
 * Always returns online on non-Android platforms (iOS Web/PWA).
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => {
    if (!isOfflineSupported) {
      return {
        isOnline: true,
        isConnected: true,
        isInternetReachable: true,
        connectionType: 'wifi',
        lastCheckedAt: Date.now(),
      };
    }
    return currentStatus;
  });

  useEffect(() => {
    if (!isOfflineSupported) {
      return;
    }

    initNetworkService();
    setStatus(currentStatus);

    const handler = (newStatus: NetworkStatus) => {
      setStatus(newStatus);
    };

    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return status;
}
