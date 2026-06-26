import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { deleteSecureItem, getSecureItem, setSecureItem } from '../lib/secureStorage';
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
const PUSH_TOKEN_KEY = 'hygportal_expo_push_token';
const ANDROID_CHANNEL_ID = 'hygportal-alerts';
const EAS_PROJECT_ID = 'b0a75d0f-14f4-432f-a404-9b2a62805c4d';

export async function configureNotificationChannel() {
  if (Platform.OS !== 'android') {
    return;
  }

  // Set notification handler for foreground notifications
  await Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    }),
  });

  // Create high-priority notification channel for Android
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'HYG Portal alerts',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 200, 250],
    lightColor: '#facc15',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    showBadge: true,
  });
}

export async function getNotificationsEnabled() {
  const value = await getSecureItem(ENABLED_KEY);
  return value === '1';
}

export async function setNotificationsEnabled(enabled: boolean) {
  if (enabled) {
    await setSecureItem(ENABLED_KEY, '1');
  } else {
    await deleteSecureItem(ENABLED_KEY);
  }
}

export async function requestNotificationPermission() {
  await configureNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
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
  if (Platform.OS === 'web') {
    throw new Error('Push alerts require an Android or iOS device.');
  }

  try {
    await configureNotificationChannel();
    
    // Check permissions first
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      throw new Error('Notification permission denied. Please enable notifications in your device settings.');
    }

    // Get push token with better error handling
    let token: string;
    try {
      const tokenResult = await Notifications.getExpoPushTokenAsync({ 
        projectId: EAS_PROJECT_ID 
      });
      token = tokenResult.data;
    } catch (tokenError) {
      const errorMessage = tokenError instanceof Error ? tokenError.message : 'Unknown error';
      
      // Check for common Android/FCM errors
      if (errorMessage.includes('google-services') || errorMessage.includes('firebase')) {
        throw new Error('Firebase configuration missing. Please rebuild the app with google-services.json.');
      }
      if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        throw new Error('Network error. Please check your internet connection and try again.');
      }
      if (errorMessage.includes('device') || errorMessage.includes('unsupported')) {
        throw new Error('Push notifications not supported on this device.');
      }
      
      throw new Error(`Failed to get push token: ${errorMessage}`);
    }

    // Register token with backend
    const { error } = await supabase.rpc('register_my_push_token', {
      p_expo_push_token: token,
      p_platform: Platform.OS,
      p_device_name: null,
    });
    
    if (error) {
      throw new Error(`Backend registration failed: ${error.message}`);
    }
    
    await setSecureItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('[PushNotification] Registration failed:', message);
    throw new Error(message);
  }
}

export async function disablePushDevice() {
  const token = await getSecureItem(PUSH_TOKEN_KEY);
  const { error } = await supabase.rpc('disable_my_push_tokens', {
    p_expo_push_token: token,
  });
  if (error) {
    throw new Error(error.message);
  }
  await deleteSecureItem(PUSH_TOKEN_KEY);
}

export async function scheduleLocalNotification(input: { title: string; body: string }) {
  await configureNotificationChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      sound: 'default',
    },
    trigger: null,
  });
}

export function unreadCount(items: AppNotification[]) {
  return items.filter((item) => !item.readAt).length;
}
