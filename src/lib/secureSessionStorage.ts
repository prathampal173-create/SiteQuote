import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
type SessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Dedicated, non-backed-up per-install auth key; never store tokens in AsyncStorage. */
export const AUTH_STORAGE_KEY = 'sitequote.auth.v1';
// The implicit email/password SDK also reads/removes these keys on error/sign-out.
// Keep a fixed allowlist; this app does not enable PKCE or arbitrary storage keys.
const AUTH_STORAGE_KEYS: readonly string[] = [AUTH_STORAGE_KEY,
  `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-flows-code-verifier`,
  `${AUTH_STORAGE_KEY}-user`];

export class SecureSessionStorageError extends Error {
  constructor(message: string) { super(message); this.name = 'SecureSessionStorageError'; }
}

export async function secureStorageAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  try { return await SecureStore.isAvailableAsync(); } catch { return false; }
}

export async function clearSecureSession(): Promise<void> {
  if (!await secureStorageAvailable()) throw new SecureSessionStorageError('Secure storage unavailable.');
  const results = await Promise.allSettled(AUTH_STORAGE_KEYS.map(key => SecureStore.deleteItemAsync(key)));
  if (results.some(result => result.status === 'rejected')) {
    throw new SecureSessionStorageError('Secure session cleanup failed.');
  }
}

/** Retired clients cannot write a late refresh/session back after account switching. */
export function createSecureSessionStorage(): { storage: SessionStorage; retire: () => Promise<void> } {
  let retired = false;
  const outstanding = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (retired) return Promise.reject(new SecureSessionStorageError('Secure session storage is retired.'));
    const task = operation().catch(error => {
      if (error instanceof SecureSessionStorageError) throw error;
      throw new SecureSessionStorageError('Secure session storage operation failed.');
    });
    outstanding.add(task);
    // Attach both handlers so a rejected operation cannot create a second unhandled rejection.
    void task.then(() => outstanding.delete(task), () => outstanding.delete(task));
    return task;
  }
  async function guard() {
    if (retired || !await secureStorageAvailable() || retired) {
      throw new SecureSessionStorageError('Secure session storage is unavailable.');
    }
  }
  const storage: SessionStorage = {
    getItem(key) {
      return track(async () => {
        if (!AUTH_STORAGE_KEYS.includes(key)) throw new SecureSessionStorageError('Unexpected session key.');
        await guard();
        return SecureStore.getItemAsync(key);
      });
    },
    setItem(key, value) {
      return track(async () => {
        if (!AUTH_STORAGE_KEYS.includes(key)) throw new SecureSessionStorageError('Unexpected session key.');
        await guard();
        await SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
        });
      });
    },
    removeItem(key) {
      return track(async () => {
        if (!AUTH_STORAGE_KEYS.includes(key)) throw new SecureSessionStorageError('Unexpected session key.');
        await guard();
        await SecureStore.deleteItemAsync(key);
      });
    }
  };
  return {
    storage,
    retire: async () => {
      retired = true;
      // Sign-out awaits writes started by the old client before deleting its credentials.
      await Promise.allSettled([...outstanding]);
    }
  };
}
