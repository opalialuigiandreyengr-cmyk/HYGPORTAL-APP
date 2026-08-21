import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initialized = false;

function getDb() {
  if (Platform.OS === 'web') return null;
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('hygportal-cache.db');
  }
  return dbPromise;
}

export async function initLocalCache() {
  if (Platform.OS === 'web' || initialized) return;
  const database = await getDb();
  if (!database) return;
  await database.execAsync(`
    create table if not exists app_cache (
      key text primary key not null,
      value text not null,
      updated_at integer not null
    );
  `);
  initialized = true;
}

export async function setCacheJSON(key: string, value: unknown) {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(`cache_${key}`, JSON.stringify(value));
    return;
  }
  await initLocalCache();
  const database = await getDb();
  if (!database) return;
  const serialized = JSON.stringify(value);
  await database.runAsync(
    `insert into app_cache (key, value, updated_at)
     values (?, ?, ?)
     on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
    [key, serialized, Date.now()],
  );
}

export async function getCacheJSON<T>(key: string): Promise<T | null> {
  if (Platform.OS === 'web') {
    const item = await AsyncStorage.getItem(`cache_${key}`);
    if (!item) return null;
    try {
      return JSON.parse(item) as T;
    } catch {
      return null;
    }
  }
  await initLocalCache();
  const database = await getDb();
  if (!database) return null;
  const row = await database.getFirstAsync<{ value: string }>('select value from app_cache where key = ? limit 1', [key]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function removeCacheItem(key: string) {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(`cache_${key}`);
    return;
  }
  await initLocalCache();
  const database = await getDb();
  if (!database) return;
  await database.runAsync('delete from app_cache where key = ?', [key]);
}
