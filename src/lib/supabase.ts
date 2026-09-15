import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { env } from './env';

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

const fallbackSupabaseUrl = 'https://placeholder.supabase.co';
const fallbackSupabaseAnonKey = 'placeholder-anon-key';

// 25-second timeout fetch wrapper to abort suspended TCP connections that WebKit fails to drop upon iOS sleep/wake
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const timeoutMs = 25000;
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  if (init?.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (err: any) {
    if (controller.signal.aborted && (!init?.signal || !init.signal.aborted)) {
      throw new Error('Network request timed out. Please check your connection.');
    }
    throw err;
  } finally {
    clearTimeout(timerId);
  }
};

export const supabase = createClient(env.supabaseUrl || fallbackSupabaseUrl, env.supabaseAnonKey || fallbackSupabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Workaround for Safari / iOS WebKit Web Locks deadlock bug where backgrounded/suspended
    // tabs leave zombie locks and cause getSession() and all API calls to hang indefinitely.
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

// Manage auto-refresh based on app state per official Supabase guidelines
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

let refreshPromise: Promise<{ session: any; error: any }> | null = null;

/**
 * Validates the current auth session and proactively refreshes it if it has
 * expired or is within 2 minutes of expiration (e.g. after phone sleep/inactivity).
 */
export async function ensureFreshSession() {
  if (!isSupabaseConfigured) {
    return { session: null, error: null };
  }

  // Deduplicate concurrent refresh calls
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        return { session: data.session ?? null, error };
      }

      const session = data.session;
      const expiresAt = session.expires_at ?? 0;
      const nowInSeconds = Math.floor(Date.now() / 1000);

      // If expired or expiring within 2 minutes (120s), refresh immediately
      if (expiresAt - nowInSeconds < 120) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && refreshData.session) {
          return { session: refreshData.session, error: null };
        }
        // If refresh failed due to a transient network glitch, retain existing session
        if (refreshError && !refreshError.message?.toLowerCase().includes('invalid refresh token')) {
          console.warn('ensureFreshSession refresh failed (retaining session):', refreshError.message);
          return { session, error: null };
        }
        return { session: null, error: refreshError };
      }

      return { session, error: null };
    } catch (err) {
      console.warn('ensureFreshSession error:', err);
      return { session: null, error: err };
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

