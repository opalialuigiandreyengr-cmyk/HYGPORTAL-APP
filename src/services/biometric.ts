import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'hygportal_biometric_enabled';
const BIOMETRIC_USERNAME_KEY = 'hygportal_biometric_username';
const BIOMETRIC_PASSWORD_KEY = 'hygportal_biometric_password';
const SAVED_USERNAME_KEY = 'hygportal_saved_username';

export type BiometricLogin = {
  username: string;
  password: string;
};

export async function getSavedUsername() {
  return (await SecureStore.getItemAsync(SAVED_USERNAME_KEY)) ?? '';
}

export async function saveUsername(username: string) {
  const value = username.trim();
  if (value) {
    await SecureStore.setItemAsync(SAVED_USERNAME_KEY, value);
  }
}

export async function getBiometricLogin() {
  const [username, password] = await Promise.all([
    SecureStore.getItemAsync(BIOMETRIC_USERNAME_KEY),
    SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY),
  ]);

  if (!username || !password) {
    return null;
  }

  return { username, password } as BiometricLogin;
}

export async function saveBiometricLogin(username: string, password: string) {
  await Promise.all([
    saveUsername(username),
    SecureStore.setItemAsync(BIOMETRIC_USERNAME_KEY, username.trim()),
    SecureStore.setItemAsync(BIOMETRIC_PASSWORD_KEY, password),
  ]);
}

export async function clearBiometricLogin() {
  await Promise.all([
    SecureStore.deleteItemAsync(BIOMETRIC_USERNAME_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_PASSWORD_KEY),
  ]);
}

export async function getBiometricEnabled() {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return value === '1';
}

export async function setBiometricEnabled(enabled: boolean) {
  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, '1');
  } else {
    await Promise.all([
      SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY),
      clearBiometricLogin(),
    ]);
  }
}

export async function isBiometricAvailable() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && isEnrolled;
}

export async function promptBiometric(reason: string) {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Use passcode',
    disableDeviceFallback: false,
  });
  return result.success;
}
