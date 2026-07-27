import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

export const NATIVE_APP_VERSION = '1.5.6';

export type AppUpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up_to_date'
  | 'error';

export type AppUpdateState = {
  status: AppUpdateStatus;
  message: string;
  checkedAt?: string | null;
  currentUpdateId?: string | null;
  channel?: string | null;
  runtimeVersion?: string | null;
};

export function getInitialAppUpdateState(): AppUpdateState {
  if (Platform.OS !== 'android') {
    return {
      status: 'unsupported',
      message: Platform.OS === 'web' ? 'Web updates automatically when you refresh.' : 'App updates are managed by the App Store.',
      currentUpdateId: null,
      runtimeVersion: null,
    };
  }

  return {
    status: 'idle',
    message: 'Automatic app updates are enabled.',
    currentUpdateId: null,
    runtimeVersion: NATIVE_APP_VERSION,
  };
}

function isNewerVersion(current: string, latest: string): boolean {
  const cParts = current.split('.').map(Number);
  const lParts = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const cVal = cParts[i] || 0;
    const lVal = lParts[i] || 0;
    if (lVal > cVal) return true;
    if (lVal < cVal) return false;
  }
  return false;
}

export async function checkForAppUpdate(): Promise<AppUpdateState> {
  if (Platform.OS !== 'android') {
    return getInitialAppUpdateState();
  }

  try {
    const response = await fetch('https://hygportal.vercel.app/app-version.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch version metadata (Status: ${response.status})`);
    }
    const data = await response.json();
    const latestVersion = data.version;

    const checkedAt = new Date().toISOString();
    if (isNewerVersion(NATIVE_APP_VERSION, latestVersion)) {
      return {
        status: 'available',
        message: `A new version (v${latestVersion}) is available. Download and install it now?`,
        checkedAt,
        runtimeVersion: latestVersion,
      };
    }

    return {
      status: 'up_to_date',
      message: `You are using the latest version (v${NATIVE_APP_VERSION}).`,
      checkedAt,
      runtimeVersion: NATIVE_APP_VERSION,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to check for app updates.',
      checkedAt: new Date().toISOString(),
      runtimeVersion: NATIVE_APP_VERSION,
    };
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateState> {
  if (Platform.OS !== 'android') {
    return getInitialAppUpdateState();
  }

  try {
    const response = await fetch('https://hygportal.vercel.app/app-version.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch version metadata (Status: ${response.status})`);
    }
    const data = await response.json();
    const apkUrl = data.apkUrl || 'https://hygportal.vercel.app/hygportal.apk';

    const filename = 'hygportal.apk';
    const localUri = FileSystem.cacheDirectory + filename;

    // Remove any existing downloaded file
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    }

    const { uri } = await FileSystem.downloadAsync(apkUrl, localUri);

    return {
      status: 'ready',
      message: `v${data.version} downloaded. Install the update now?`,
      checkedAt: new Date().toISOString(),
      currentUpdateId: uri, // Store local URI path here to pass it during install
      runtimeVersion: data.version,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to download app update.',
      runtimeVersion: NATIVE_APP_VERSION,
    };
  }
}

export async function restartToApplyAppUpdate(localUri?: string | null) {
  if (Platform.OS !== 'android' || !localUri) {
    throw new Error('Installation not supported or invalid file path.');
  }

  try {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to launch package installer.');
  }
}
