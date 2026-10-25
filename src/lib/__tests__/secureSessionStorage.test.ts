import * as SecureStore from 'expo-secure-store';
import { AUTH_STORAGE_KEY, createSecureSessionStorage, secureStorageAvailable, clearSecureSession } from '../secureSessionStorage';

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(), getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6
}));
const available = jest.mocked(SecureStore.isAvailableAsync);
const getItem = jest.mocked(SecureStore.getItemAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);
const del = jest.mocked(SecureStore.deleteItemAsync);

beforeEach(() => {
  jest.clearAllMocks();
  available.mockResolvedValue(true);
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue();
  del.mockResolvedValue();
});

test('encrypts session through platform secure store and clears by dedicated key', async () => {
  const { storage } = createSecureSessionStorage();
  await storage.setItem(AUTH_STORAGE_KEY, 'unit-test-value');
  expect(setItem).toHaveBeenCalledWith(AUTH_STORAGE_KEY, 'unit-test-value', expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }));
  await storage.getItem(AUTH_STORAGE_KEY);
  expect(getItem).toHaveBeenCalledWith(AUTH_STORAGE_KEY);
  await clearSecureSession();
  expect(del).toHaveBeenCalledWith(AUTH_STORAGE_KEY);
});

test('storage unavailable fails closed instead of writing plaintext', async () => {
  available.mockResolvedValue(false);
  expect(await secureStorageAvailable()).toBe(false);
  const { storage } = createSecureSessionStorage();
  await expect(storage.setItem(AUTH_STORAGE_KEY, 'secret')).rejects.toThrow();
  expect(setItem).not.toHaveBeenCalled();
});

test('retired clients cannot persist late refresh credentials', async () => {
  const { storage, retire } = createSecureSessionStorage();
  retire();
  await expect(storage.setItem(AUTH_STORAGE_KEY, 'late-token')).rejects.toThrow();
  expect(setItem).not.toHaveBeenCalled();
});

test('unexpected SDK storage keys are rejected', async () => {
  const { storage } = createSecureSessionStorage();
  await expect(storage.getItem('not-sitequote-session')).rejects.toThrow();
});

test.each(['-code-verifier', '-flows-code-verifier', '-user'])('supports SDK auxiliary key %s in encrypted storage', async suffix => {
  const { storage } = createSecureSessionStorage();
  const key = AUTH_STORAGE_KEY + suffix;
  await storage.setItem(key, 'test-only');
  await storage.getItem(key);
  await storage.removeItem(key);
  expect(setItem).toHaveBeenCalledWith(key, 'test-only', expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }));
  expect(getItem).toHaveBeenCalledWith(key);
  expect(del).toHaveBeenCalledWith(key);
});

test('cleanup attempts all auth keys and fails closed if any deletion fails', async () => {
  del.mockRejectedValueOnce(new Error('native failure'));
  await expect(clearSecureSession()).rejects.toMatchObject({ name: 'SecureSessionStorageError' });
  expect(del.mock.calls.map(([key]) => key)).toEqual([
    AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`,
    `${AUTH_STORAGE_KEY}-flows-code-verifier`, `${AUTH_STORAGE_KEY}-user`
  ]);
});

test('retirement waits for an in-flight write before credentials can be cleared', async () => {
  let release!: () => void;
  setItem.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  const { storage, retire } = createSecureSessionStorage();
  const write = storage.setItem(AUTH_STORAGE_KEY, 'stale-token');
  for (let i = 0; i < 5; i += 1) await Promise.resolve(); // Allow availability check to resolve.
  expect(setItem).toHaveBeenCalledTimes(1);
  let retired = false;
  const done = retire().then(() => { retired = true; });
  await Promise.resolve();
  expect(retired).toBe(false);
  release();
  await write;
  await done;
  expect(retired).toBe(true);
  await expect(storage.setItem(AUTH_STORAGE_KEY, 'later-token')).rejects.toThrow();
});
