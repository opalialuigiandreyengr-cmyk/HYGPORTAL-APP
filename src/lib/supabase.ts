import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import { env } from './env';

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

const fallbackSupabaseUrl = 'https://placeholder.supabase.co';
const fallbackSupabaseAnonKey = 'placeholder-anon-key';

export const supabase = createClient(env.supabaseUrl || fallbackSupabaseUrl, env.supabaseAnonKey || fallbackSupabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
