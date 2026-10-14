import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { isAppOnline } from './network';

const memoryAvatarCache = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string | null>>();
let dirInitPromise: Promise<void> | null = null;

function getAvatarCacheDirectory(): string | null {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    return null;
  }
  return `${FileSystem.documentDirectory}avatar_cache/`;
}

async function ensureDirectoryExists(): Promise<void> {
  const dir = getAvatarCacheDirectory();
  if (!dir) return;

  if (!dirInitPromise) {
    dirInitPromise = (async () => {
      try {
        const info = await FileSystem.getInfoAsync(dir);
        if (!info.exists) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        }
      } catch (err) {
        console.warn('[AvatarCache] Directory init error:', err);
      }
    })();
  }
  await dirInitPromise;
}

/**
 * Computes a deterministic, filesystem-safe filename for a photo URL.
 */
export function getCacheFilename(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash) + url.charCodeAt(i);
    hash |= 0;
  }
  const safeHash = Math.abs(hash).toString(36);
  const tail = url.split('?')[0].replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  const clean = url.split('?')[0];
  const extMatch = clean.match(/\.(jpg|jpeg|png|webp|gif)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  return `avatar_${safeHash}_${tail}.${ext}`;
}

/**
 * Synchronous L1 memory read.
 * Returns local file URI if already resolved in memory, or the URI itself if already a local scheme.
 */
export function getSyncCachedAvatarUri(url: string | null | undefined): string | null {
  if (!url) return null;
  if (Platform.OS === 'web') return url;
  if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('content:')) {
    return url;
  }
  return memoryAvatarCache.get(url) ?? null;
}

/**
 * Pre-checks if the given photo URL is cached on local disk and populates the L1 memory cache.
 * Fast check (2-5ms) typically called on app startup or profile hydration.
 */
export async function primeAvatarCache(url: string | null | undefined): Promise<string | null> {
  if (!url || Platform.OS === 'web') return null;
  if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('content:')) {
    memoryAvatarCache.set(url, url);
    return url;
  }

  const inMem = memoryAvatarCache.get(url);
  if (inMem) return inMem;

  const dir = getAvatarCacheDirectory();
  if (!dir) return null;

  const targetPath = `${dir}${getCacheFilename(url)}`;
  try {
    const info = await FileSystem.getInfoAsync(targetPath);
    if (info.exists && info.size && info.size > 0) {
      memoryAvatarCache.set(url, targetPath);
      return targetPath;
    }
  } catch {
    // Ignore error
  }
  return null;
}

/**
 * Resolves a remote photo URL to a local cached file URI.
 * - If already cached on disk, returns the local file URI immediately.
 * - If not cached and online, downloads it in the background and returns the local URI.
 * - If offline and not cached, returns null or the original URL.
 */
export async function getCachedAvatarUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (Platform.OS === 'web') return url;
  if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('content:')) {
    memoryAvatarCache.set(url, url);
    return url;
  }

  // 1. Check L1 memory cache
  const inMem = memoryAvatarCache.get(url);
  if (inMem) return inMem;

  const dir = getAvatarCacheDirectory();
  if (!dir) return url;

  await ensureDirectoryExists();
  const targetPath = `${dir}${getCacheFilename(url)}`;

  // 2. Check disk cache
  try {
    const info = await FileSystem.getInfoAsync(targetPath);
    if (info.exists && info.size && info.size > 0) {
      memoryAvatarCache.set(url, targetPath);
      return targetPath;
    }
  } catch {
    // Disk check error
  }

  // 3. If offline, do not attempt network request
  if (!isAppOnline()) {
    return null;
  }

  // 4. Download from network (deduplicated for concurrent callers)
  let downloadTask = inFlightDownloads.get(url);
  if (!downloadTask) {
    downloadTask = (async () => {
      const tempPath = `${targetPath}.tmp_${Date.now()}`;
      try {
        const downloadRes = await FileSystem.downloadAsync(url, tempPath);
        if (downloadRes.status >= 200 && downloadRes.status < 300) {
          await FileSystem.moveAsync({
            from: tempPath,
            to: targetPath,
          });
          memoryAvatarCache.set(url, targetPath);
          return targetPath;
        } else {
          try {
            await FileSystem.deleteAsync(tempPath, { idempotent: true });
          } catch {}
          return null;
        }
      } catch (err) {
        try {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
        } catch {}
        return null;
      } finally {
        inFlightDownloads.delete(url);
      }
    })();
    inFlightDownloads.set(url, downloadTask);
  }

  const result = await downloadTask;
  return result || url;
}

/**
 * Saves a local image file directly to the avatar cache for a specific URL.
 * Useful when the user selects and uploads a new profile picture.
 */
export async function saveAvatarToCache(remoteUrl: string, localSourceUri: string): Promise<string | null> {
  if (!remoteUrl || Platform.OS === 'web') return null;
  const dir = getAvatarCacheDirectory();
  if (!dir) return null;

  try {
    await ensureDirectoryExists();
    const targetPath = `${dir}${getCacheFilename(remoteUrl)}`;

    await FileSystem.copyAsync({
      from: localSourceUri,
      to: targetPath,
    });
    memoryAvatarCache.set(remoteUrl, targetPath);
    return targetPath;
  } catch (err) {
    console.warn('[AvatarCache] Failed to save avatar directly to cache:', err);
    return null;
  }
}

/**
 * Clears the persistent avatar cache directory.
 */
export async function clearAvatarCache(): Promise<void> {
  memoryAvatarCache.clear();
  const dir = getAvatarCacheDirectory();
  if (!dir) return;

  try {
    await FileSystem.deleteAsync(dir, { idempotent: true });
    dirInitPromise = null;
  } catch (err) {
    console.warn('[AvatarCache] Failed to clear avatar cache:', err);
  }
}
