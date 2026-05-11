import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import { env } from './env';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
