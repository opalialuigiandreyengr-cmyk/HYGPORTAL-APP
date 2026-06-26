import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

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

const LATEST_APK_MESSAGE =
  'This installed APK cannot check automatic updates yet. Download and install the latest APK once, then future updates can be checked here.';

export function getInitialAppUpdateState(): AppUpdateState {
  if (!canUseNativeUpdates()) {
    return {
      status: 'unsupported',
      message: getUnsupportedUpdateMessage(),
      currentUpdateId: null,
      channel: Updates.channel ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
    };
  }

  return {
    status: 'idle',
    message: 'Automatic app updates are enabled.',
    currentUpdateId: Updates.updateId,
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
  };
}

export async function checkForAppUpdate(): Promise<AppUpdateState> {
  if (!canUseNativeUpdates()) {
    return getInitialAppUpdateState();
  }

  try {
    const result = await Updates.checkForUpdateAsync();
    const checkedAt = new Date().toISOString();
    if (result.isAvailable) {
      return {
        status: 'available',
        message: 'A new app update is available. Download it now?',
        checkedAt,
        currentUpdateId: Updates.updateId,
        channel: Updates.channel,
        runtimeVersion: Updates.runtimeVersion,
      };
    }

    return {
      status: 'up_to_date',
      message: 'You are using the latest available app update.',
      checkedAt,
      currentUpdateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
    };
  } catch (error) {
    return {
      status: 'error',
      message: formatUpdateErrorMessage(error, 'Unable to check for app updates.'),
      checkedAt: new Date().toISOString(),
      currentUpdateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
    };
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateState> {
  if (!canUseNativeUpdates()) {
    return getInitialAppUpdateState();
  }

  try {
    const result = await Updates.fetchUpdateAsync();
    if (result.isNew) {
      return {
        status: 'ready',
        message: 'Update downloaded. Restart the app to apply it.',
        checkedAt: new Date().toISOString(),
        currentUpdateId: Updates.updateId,
        channel: Updates.channel,
        runtimeVersion: Updates.runtimeVersion,
      };
    }

    return {
      status: 'up_to_date',
      message: 'No new update was downloaded.',
      checkedAt: new Date().toISOString(),
      currentUpdateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
    };
  } catch (error) {
    return {
      status: 'error',
      message: formatUpdateErrorMessage(error, 'Unable to download app update.'),
      checkedAt: new Date().toISOString(),
      currentUpdateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
    };
  }
}

export async function restartToApplyAppUpdate() {
  await Updates.reloadAsync();
}

function canUseNativeUpdates() {
  return Platform.OS !== 'web' && Updates.isEnabled && Boolean(Updates.channel);
}

function getUnsupportedUpdateMessage() {
  if (Platform.OS === 'web') {
    return 'Web updates automatically when you refresh the page.';
  }

  if (!Updates.isEnabled) {
    return 'Automatic app updates are available after installing a release APK.';
  }

  return LATEST_APK_MESSAGE;
}

function formatUpdateErrorMessage(error: unknown, fallback: string) {
  const rawMessage = error instanceof Error ? error.message : '';
  const message = rawMessage.toLowerCase();

  if (
    message.includes('failed to check for update') ||
    message.includes('checkforupdatesasync') ||
    message.includes('expo updates')
  ) {
    return LATEST_APK_MESSAGE;
  }

  return rawMessage || fallback;
}
