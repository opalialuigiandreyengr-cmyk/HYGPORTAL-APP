declare const process: {
  env: Record<string, string | undefined>;
};

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dkabosehgvldiwtdmvxh.supabase.co',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrYWJvc2VoZ3ZsZGl3dGRtdnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MDUyMTMsImV4cCI6MjA5Mzk4MTIxM30.bWkX7qAPi4iRMZZ2Vf3oYuE2fHW3bBHWJ_8wuibzTUo',
  webPushVapidPublicKey: process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY || 'BAPPKaO-Q9TfDq4lcf9bGXwli9bkxXOORs1Mmn0DpTyoKt8oY9d82jhm0pQy7JOSBU9KzwwerN8vycn5bHGxYiw',
  googleDriveScriptUrl: process.env.EXPO_PUBLIC_GDRIVE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyIsvO5CHfj1db0bSmX9QPefanWsOkgIFTxquzqZPp6pqX1ThpjEZ1jbGRyZyN-EDpJhg/exec',
  googleDriveRootFolderId: process.env.EXPO_PUBLIC_GDRIVE_ROOT_FOLDER_ID || '1N-OzBcYFP5-l3CcEWuaGcLSxU8iFm0zV',
  inventoryUrl: process.env.EXPO_PUBLIC_INVENTORY_URL || 'https://luigiandreyopalia.pythonanywhere.com/inventory/store_inventory_data',
};
