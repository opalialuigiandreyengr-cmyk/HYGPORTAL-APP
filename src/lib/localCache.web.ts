const CACHE_PREFIX = 'hygportal-cache:';

export async function initLocalCache() {
  // Web storage is ready without an initialization step.
}

export async function setCacheJSON(key: string, value: unknown) {
  try {
    window.localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Caching should never prevent the portal from loading or completing a request.
  }
}

export async function getCacheJSON<T>(key: string) {
  try {
    const serialized = window.localStorage.getItem(`${CACHE_PREFIX}${key}`);
    return serialized ? (JSON.parse(serialized) as T) : null;
  } catch {
    return null;
  }
}
