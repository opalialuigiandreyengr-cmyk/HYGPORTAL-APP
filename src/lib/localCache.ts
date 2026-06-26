import * as SQLite from 'expo-sqlite';

const dbPromise = SQLite.openDatabaseAsync('hygportal-cache.db');
let initialized = false;

async function db() {
  return dbPromise;
}

export async function initLocalCache() {
  if (initialized) {
    return;
  }
  const database = await db();
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
  await initLocalCache();
  const database = await db();
  const serialized = JSON.stringify(value);
  await database.runAsync(
    `insert into app_cache (key, value, updated_at)
     values (?, ?, ?)
     on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
    [key, serialized, Date.now()],
  );
}

export async function getCacheJSON<T>(key: string) {
  await initLocalCache();
  const database = await db();
  const row = await database.getFirstAsync<{ value: string }>('select value from app_cache where key = ? limit 1', [key]);
  if (!row?.value) {
    return null;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

