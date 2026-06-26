import { deleteSecureItem, getSecureItem, setSecureItem } from '../lib/secureStorage';

// Keys used in SecureStore for the web implementation
const SAVED_USERNAME_KEY = 'hygportal_saved_username';
const BIOMETRIC_ENABLED_KEY = 'hygportal_biometric_enabled';
const CREDENTIAL_ID_KEY = 'hygportal_credential_id';
const SAVED_PASSWORD_KEY = 'hygportal_biometric_password';

export type BiometricLogin = {
  username: string;
  // For the web we don't store a password – the credential itself proves the user.
  password: string;
};

/** Helper: base64url encode Uint8Array */
function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
/** Helper: base64url decode to Uint8Array */
function base64UrlToBuffer(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = base64 + (pad === 0 ? '' : '='.repeat(4 - pad));
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Retrieve the saved username (used for display in the biometric button) */
export async function getSavedUsername(): Promise<string> {
  return (await getSecureItem(SAVED_USERNAME_KEY)) ?? '';
}

/** Persist the username for quick UI rendering */
export async function saveUsername(username: string): Promise<void> {
  const value = username.trim();
  if (value) {
    await setSecureItem(SAVED_USERNAME_KEY, value);
  }
}

/** Register a platform authenticator (Touch ID / Face ID) for the given user.
 *  The credential ID is stored securely and later used to verify the user.
 */
export async function saveBiometricLogin(username: string, password?: string): Promise<void> {
  // Ensure the browser supports WebAuthn platform authenticators
  if (!('PublicKeyCredential' in window)) {
    throw new Error('WebAuthn not supported in this browser');
  }
  const isAvailable = await isBiometricAvailable();
  if (!isAvailable) {
    throw new Error('Biometric authenticator not available');
  }
  // Create a new credential – we only need a random user ID; the username is stored separately.
  const userId = new Uint8Array(16);
  crypto.getRandomValues(userId);
  // Both challenge and userId must be random ArrayBuffers (WebAuthn spec requirement).
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,                                               // ← required by spec
    rp: { name: 'HYG Portal', id: window.location.hostname },
    user: {
      id: userId,
      name: username,
      displayName: username,
    },
    pubKeyCredParams: [
      { alg: -7,   type: 'public-key' },  // ES256  (preferred on iOS)
      { alg: -257, type: 'public-key' },  // RS256  (fallback)
    ],
    timeout: 60000,
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    attestation: 'none',
  };
  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
  if (!credential) {
    throw new Error('Credential creation failed');
  }
  const rawId = credential.rawId;
  // Store the credential ID (base64url) and the username for later lookup
  const tasks = [
    setSecureItem(CREDENTIAL_ID_KEY, bufferToBase64Url(rawId)),
    saveUsername(username),
  ];
  if (password) {
    tasks.push(setSecureItem(SAVED_PASSWORD_KEY, password));
  }
  await Promise.all(tasks);
}

/** Retrieve stored credential and perform a verification challenge.
 *  Returns a BiometricLogin object on success or null if verification fails.
 */
export async function getBiometricLogin(): Promise<BiometricLogin | null> {
  const credentialIdB64 = await getSecureItem(CREDENTIAL_ID_KEY);
  const username = await getSavedUsername();
  const password = await getSecureItem(SAVED_PASSWORD_KEY) ?? '';
  if (!credentialIdB64 || !username) {
    return null;
  }
  const allowCredential = {
    type: 'public-key',
    id: base64UrlToBuffer(credentialIdB64),
    transports: ['internal'],
  } as PublicKeyCredentialDescriptor;

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: new Uint8Array(32), // Random challenge – server would normally supply this
    timeout: 60000,
    rpId: window.location.hostname,
    allowCredentials: [allowCredential],
    userVerification: 'required',
  };

  // Populate a random challenge (crypto-secure) as browsers require a non‑empty value
  crypto.getRandomValues(publicKey.challenge as Uint8Array);

  try {
    const assertion = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
    if (assertion) {
       // Successful verification – return the stored username and password
       return { username, password } as BiometricLogin;
     }
    return null;
  } catch (e) {
    // Authentication was cancelled or failed
    return null;
  }
}

/** Clear stored credential information */
export async function clearBiometricLogin(): Promise<void> {
  await Promise.all([
     deleteSecureItem(CREDENTIAL_ID_KEY),
     deleteSecureItem(SAVED_USERNAME_KEY),
     deleteSecureItem(SAVED_PASSWORD_KEY),
   ]);
}

/** Return whether biometric login is enabled for this device (persisted flag) */
export async function getBiometricEnabled(): Promise<boolean> {
  const flag = await getSecureItem(BIOMETRIC_ENABLED_KEY);
  return flag === '1';
}

/** Enable or disable biometric login – toggles stored flag and optionally clears credentials */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await setSecureItem(BIOMETRIC_ENABLED_KEY, '1');
  } else {
    await Promise.all([
      deleteSecureItem(BIOMETRIC_ENABLED_KEY),
      clearBiometricLogin(),
    ]);
  }
}

/** Detect if the browser/device supports platform authenticators (Touch/Face ID) */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!('PublicKeyCredential' in window) || typeof (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    return false;
  }
  try {
    return await (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Prompt the user to authenticate using the stored credential. Returns true on success. */
export async function promptBiometric(reason: string = 'Authenticate to sign in'): Promise<boolean> {
  const credentialIdB64 = await getSecureItem(CREDENTIAL_ID_KEY);
  if (!credentialIdB64) {
    return false;
  }
  const allowCredential = {
    type: 'public-key',
    id: base64UrlToBuffer(credentialIdB64),
    transports: ['internal'],
  } as PublicKeyCredentialDescriptor;

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: new Uint8Array(32),
    timeout: 60000,
    rpId: window.location.hostname,
    allowCredentials: [allowCredential],
    userVerification: 'required',
  };
  crypto.getRandomValues(publicKey.challenge as Uint8Array);
  try {
    const assertion = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
    return !!assertion;
  } catch {
    return false;
  }
}

