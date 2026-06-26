import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { isPwaInstalled } from '../constants/download';
import { deleteSecureItem, getSecureItem, setSecureItem } from '../lib/secureStorage';
import { env } from '../lib/env';
import { supabase } from '../lib/supabase';

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string | null;
  source?: 'local' | 'server';
  actionType?: 'hyg_points_claim' | null;
  actionLabel?: string | null;
  actionStatus?: 'released' | 'claimed' | 'cancelled' | null;
  actionId?: string | null;
  points?: number | null;
  releaseAt?: string | null;
  receivedAt?: string | null;
};

const CACHE_KEY = 'app_notifications_v1';
const ENABLED_KEY = 'hygportal_notifications_enabled';
const WEB_PUSH_ENDPOINT_KEY = 'hygportal_web_push_endpoint';

export async function configureNotificationChannel() {
  // Browser notification channels are managed by the user agent.
}

export async function getNotificationsEnabled() {
  const value = await getSecureItem(ENABLED_KEY);
  return value === '1' && hasWebPushSupport() && Notification.permission === 'granted';
}

export async function setNotificationsEnabled(enabled: boolean) {
  if (enabled) {
    await setSecureItem(ENABLED_KEY, '1');
  } else {
    await deleteSecureItem(ENABLED_KEY);
  }
}

export async function requestNotificationPermission() {
  if (!hasWebPushSupport()) {
    throw new Error(getWebPushUnsupportedMessage());
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  // Support both Promise and Callback styles for mobile Webkit compatibility
  const permissionPromise = (async () => {
    try {
      return await new Promise<NotificationPermission>((resolve) => {
        const result = Notification.requestPermission(resolve);
        if (result && typeof result.then === 'function') {
          result.then(resolve);
        }
      });
    } catch {
      return await Notification.requestPermission();
    }
  })();

  const permission = await withTimeout(
    permissionPromise,
    6000,
    'Notification permission prompt timed out. Please verify app permissions in iOS/Android Settings.'
  );
  return permission === 'granted';
}

export async function loadAppNotifications() {
  const [local, server] = await Promise.all([
    loadLocalNotifications(),
    loadServerNotifications(),
  ]);
  return [...server, ...local].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
}

async function loadLocalNotifications() {
  return (await getCacheJSON<AppNotification[]>(CACHE_KEY)) ?? [];
}

async function loadServerNotifications() {
  const { data: sessionResult } = await supabase.auth.getSession();
  if (!sessionResult.session?.user) {
    return [];
  }

  await ensureMyHygPointGifts();

  const { data, error } = await supabase.rpc('get_my_notifications');
  if (error) {
    return [];
  }

  return (data ?? []).map((item: {
    id: string;
    title: string;
    body: string;
    created_at: string;
    read_at: string | null;
    action_type?: 'hyg_points_claim' | null;
    action_label?: string | null;
    action_status?: 'released' | 'claimed' | 'cancelled' | null;
    action_id?: string | null;
    points?: number | string | null;
    release_at?: string | null;
    received_at?: string | null;
  }) => ({
    id: `server:${item.id}`,
    title: item.title,
    body: item.body,
    createdAt: item.created_at,
    readAt: item.read_at,
    source: 'server' as const,
    actionType: item.action_type ?? null,
    actionLabel: item.action_label ?? null,
    actionStatus: item.action_status ?? null,
    actionId: item.action_id ?? null,
    points: item.points == null ? null : Number(item.points),
    releaseAt: item.release_at ?? null,
    receivedAt: item.received_at ?? null,
  }));
}

export async function ensureMyHygPointGifts() {
  await ensureHygPointGift('ensure_my_launch_hyg_points_gift', 'launch HYG Points gift');
  await ensureHygPointGift('ensure_my_profile_completion_hyg_points_gift', 'profile completion HYG Points gift');
}

async function ensureHygPointGift(rpcName: 'ensure_my_launch_hyg_points_gift' | 'ensure_my_profile_completion_hyg_points_gift', label: string) {
  const { error } = await supabase.rpc(rpcName);
  if (error) {
    const message = error.message.toLowerCase();
    const isMissingRpc =
      message.includes(rpcName.toLowerCase()) ||
      message.includes('could not find the function') ||
      message.includes('pgrst202');
    if (!isMissingRpc) {
      console.warn(`Unable to ensure ${label}.`, error.message);
    }
  }
}

async function saveLocalNotifications(items: AppNotification[]) {
  await setCacheJSON(CACHE_KEY, items);
}

export async function addAppNotification(input: { title: string; body: string }) {
  const current = await loadLocalNotifications();
  const item: AppNotification = {
    id: `local:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
    readAt: null,
    source: 'local',
  };
  const next = [item, ...current].slice(0, 100);
  await saveLocalNotifications(next);
  return item;
}

export async function markNotificationRead(id: string) {
  if (id.startsWith('server:')) {
    const { error } = await supabase.rpc('mark_my_notification_read', { p_notification_id: id.slice('server:'.length) });
    if (error) {
      throw new Error(error.message);
    }
    return loadAppNotifications();
  }

  const current = await loadLocalNotifications();
  const next = current.map((item) => (item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item));
  await saveLocalNotifications(next);
  return loadAppNotifications();
}

export async function deleteNotification(id: string) {
  if (id.startsWith('server:')) {
    const { error } = await supabase.rpc('delete_my_notification', { p_notification_id: id.slice('server:'.length) });
    if (error) {
      throw new Error(error.message);
    }
    return loadAppNotifications();
  }

  const current = await loadLocalNotifications();
  const next = current.filter((item) => item.id !== id);
  await saveLocalNotifications(next);
  return loadAppNotifications();
}

export async function claimHygPointsNotification(actionId: string) {
  const { data, error } = await supabase.rpc('claim_my_hyg_points', {
    p_transaction_id: actionId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as {
    points?: number;
    balance?: number;
    received_at?: string;
    status?: 'claimed';
  };
}

export async function registerPushDevice() {
  if (!hasWebPushSupport()) {
    throw new Error(getWebPushUnsupportedMessage());
  }

  if (!env.webPushVapidPublicKey) {
    throw new Error('Web Push is not configured. Missing VAPID public key.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) {
    throw new Error('Please sign in before enabling notifications.');
  }

  const registration = await withTimeout(
    (async () => {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      return reg || ('serviceWorker' in navigator ? await navigator.serviceWorker.ready : null);
    })(),
    5000,
    'Service Worker registration not ready.'
  );

  if (!registration) {
    throw new Error('Service Worker registration not ready.');
  }

  if (!registration.pushManager) {
    throw new Error('Push messaging is not supported by your browser or service worker.');
  }

  const existing = await withTimeout(
    registration.pushManager.getSubscription(),
    5000,
    'Retrieving existing push subscription timed out.'
  );
  const subscription = existing ?? await withTimeout(
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(env.webPushVapidPublicKey),
    }),
    8000,
    'Apple Push service connection timed out. Please restart the PWA or your device.'
  );
  const payload = subscription.toJSON();
  const p256dh = payload.keys?.p256dh ?? pushKeyToBase64Url(subscription.getKey('p256dh'));
  const auth = payload.keys?.auth ?? pushKeyToBase64Url(subscription.getKey('auth'));

  if (!p256dh || !auth) {
    throw new Error('This browser did not return valid Web Push keys. Remove and reinstall the PWA, then try again.');
  }

  const { error } = await supabase.from('web_push_subscriptions').upsert({
    user_id: session.user.id,
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent || null,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'endpoint',
  });

  if (error) {
    throw new Error(error.message);
  }

  await setSecureItem(WEB_PUSH_ENDPOINT_KEY, subscription.endpoint);
  return subscription.endpoint;
}

export async function disablePushDevice() {
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  const endpoint = subscription?.endpoint ?? await getSecureItem(WEB_PUSH_ENDPOINT_KEY);

  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch {
      // Browser unsubscribe can fail if the subscription was already revoked.
    }
  }

  if (endpoint) {
    await supabase.from('web_push_subscriptions').delete().eq('endpoint', endpoint);
  }

  await deleteSecureItem(WEB_PUSH_ENDPOINT_KEY);
}

export async function scheduleLocalNotification(input: { title: string; body: string }) {
  if (!hasWebPushSupport() || Notification.permission !== 'granted') {
    return;
  }

  // Delay the remote Web Push by 4 seconds so the user can lock their device or exit the PWA
  // to verify the background/sleeping native notification banner behavior on iOS/Android.
  setTimeout(async () => {
    try {
      await supabase.functions.invoke('send-web-push', {
        body: {
          title: input.title,
          body: input.body,
          url: '/',
        },
      });
    } catch (error) {
      console.warn('[NotificationCenter] Remote Web Push invocation failed:', error);
    }
  }, 4000);

  // Only the remote notification delayed by 4 seconds will be sent.
  // This avoids double notifications while ensuring the background/lock screen notification is delivered.
}

export function unreadCount(items: AppNotification[]) {
  return items.filter((item) => !item.readAt).length;
}

function isIosWeb() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isIpadOs = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(userAgent) || isIpadOs;
}

function hasWebPushSupport() {
  const basicSupport = (
    typeof window !== 'undefined' &&
    typeof Notification !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
  if (!basicSupport) return false;

  // On iOS, Web Push is strictly restricted to standalone PWA mode.
  // If not added to the Home Screen, we do not support it to prevent Safari hanging.
  if (isIosWeb() && !isPwaInstalled()) {
    return false;
  }

  return true;
}

function getWebPushUnsupportedMessage() {
  if (isIosWeb() && !isPwaInstalled()) {
    return 'Web Push requires installing HYG Portal to your Home Screen. In Safari or Chrome, tap Share, then select "Add to Home Screen".';
  }
  return 'Web Push requires installing HYG Portal to the Home Screen on iOS 16.4 or newer, then opening the installed app.';
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function pushKeyToBase64Url(key: ArrayBuffer | null) {
  if (!key) {
    return '';
  }

  const bytes = new Uint8Array(key);
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function withTimeout<T>(promise: Promise<T>, ms = 8000, errorMsg = 'Operation timed out.'): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMsg)), ms)
  );
  return Promise.race([promise, timeout]);
}
