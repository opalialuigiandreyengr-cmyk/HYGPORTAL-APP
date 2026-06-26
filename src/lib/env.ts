declare const process: {
  env: Record<string, string | undefined>;
};

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dkabosehgvldiwtdmvxh.supabase.co',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_GPhU0IhaSiDw_VWldGs5ew_I5nG3H18',
  webPushVapidPublicKey: process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY || 'BAPPKaO-Q9TfDq4lcf9bGXwli9bkxXOORs1Mmn0DpTyoKt8oY9d82jhm0pQy7JOSBU9KzwwerN8vycn5bHGxYiw',
  googleDriveScriptUrl: process.env.EXPO_PUBLIC_GDRIVE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyIsvO5CHfj1db0bSmX9QPefanWsOkgIFTxquzqZPp6pqX1ThpjEZ1jbGRyZyN-EDpJhg/exec',
  googleDriveRootFolderId: process.env.EXPO_PUBLIC_GDRIVE_ROOT_FOLDER_ID || '1N-OzBcYFP5-l3CcEWuaGcLSxU8iFm0zV',
};
