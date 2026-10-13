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

// L1 in-memory cache map for instantaneous (0ms) reads without disk serialization latency
const memoryCache = new Map<string, { value: any; updatedAt: number }>();

export function clearLocalCacheMemory() {
  memoryCache.clear();
}

export async function setCacheJSON(key: string, value: unknown) {
  memoryCache.set(key, { value, updatedAt: Date.now() });

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

export async function getCacheJSON<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  const mem = memoryCache.get(key);
  if (mem) {
    if (maxAgeMs === undefined || Date.now() - mem.updatedAt <= maxAgeMs) {
      return mem.value as T;
    }
  }

  if (Platform.OS === 'web') {
    const item = await AsyncStorage.getItem(`cache_${key}`);
    if (!item) return null;
    try {
      const parsed = JSON.parse(item) as T;
      memoryCache.set(key, { value: parsed, updatedAt: Date.now() });
      return parsed;
    } catch {
      return null;
    }
  }
  await initLocalCache();
  const database = await getDb();
  if (!database) return null;
  const row = await database.getFirstAsync<{ value: string; updated_at?: number }>(
    'select value, updated_at from app_cache where key = ? limit 1',
    [key],
  );
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as T;
    memoryCache.set(key, { value: parsed, updatedAt: row.updated_at ?? Date.now() });
    return parsed;
  } catch {
    return null;
  }
}

export async function removeCacheItem(key: string) {
  memoryCache.delete(key);

  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(`cache_${key}`);
    return;
  }
  await initLocalCache();
  const database = await getDb();
  if (!database) return;
  await database.runAsync('delete from app_cache where key = ?', [key]);
}
