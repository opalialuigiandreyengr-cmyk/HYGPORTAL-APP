const STORAGE_PREFIX = 'hygportal-secure:';

export async function getSecureItem(key: string) {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

export async function setSecureItem(key: string, value: string) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

export async function deleteSecureItem(key: string) {
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}
