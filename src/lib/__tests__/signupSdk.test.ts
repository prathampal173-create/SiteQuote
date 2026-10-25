import { getSupabaseClient, retireSupabaseClient } from '../supabase';
import { AUTH_STORAGE_KEY, clearSecureSession } from '../secureSessionStorage';
import * as SecureStore from 'expo-secure-store';

jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('../../config/env', () => ({
  getBackendConfiguration: () => ({ status: 'ready', url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_unit_test' })
}));
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(), getItemAsync: jest.fn(), setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6
}));

// Real installed Supabase SDK + real app adapter. Only HTTP and native storage are mocked.
const stored = new Map<string, string>();
const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
function response(body: object, status = 200) {
  return { ok: status < 400, status, headers: { get: (name: string) => name.toLowerCase() === 'x-supabase-api-version' ? '2024-01-01' : null },
    json: async () => body } as unknown as Response;
}

beforeEach(async () => {
  await retireSupabaseClient();
  stored.clear();
  jest.resetAllMocks();
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { stored.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { stored.delete(key); });
  globalThis.fetch = fetchMock;
});
afterEach(async () => { await retireSupabaseClient(); globalThis.fetch = originalFetch; });

test('SDK signup preserves a real-shaped rate-limit response instead of throwing from storage cleanup', async () => {
  fetchMock.mockResolvedValue(response({ code: 'over_email_send_rate_limit', msg: 'Rate limited' }, 429));
  const client = getSupabaseClient()!;
  await client.auth.getSession();
  await expect(client.auth.signUp({ email: 'new@example.test', password: 'unit-password' }))
    .resolves.toMatchObject({ error: { code: 'over_email_send_rate_limit', status: 429 } });
});

test('SDK preserves a genuine offline failure through its error cleanup', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  const client = getSupabaseClient()!;
  await client.auth.getSession();
  await expect(client.auth.signUp({ email: 'new@example.test', password: 'unit-password' }))
    .resolves.toMatchObject({ error: { name: 'AuthRetryableFetchError', status: 0 } });
});

test('SDK sign-out clears auxiliary auth keys and a fresh client can sign up B without A data', async () => {
  const clientA = getSupabaseClient()!;
  await clientA.auth.getSession();
  const userA = { id: 'account-a', email: 'a@example.test', aud: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z',
    email_confirmed_at: '2026-10-01T00:00:00Z' };
  fetchMock.mockResolvedValueOnce(response({ user: userA, access_token: 'unit-test-session',
    refresh_token: 'unit-test-refresh', token_type: 'bearer', expires_in: 3600 }));
  expect((await clientA.auth.signInWithPassword({ email: userA.email, password: 'unit-password' })).error).toBeNull();
  expect(stored.has(AUTH_STORAGE_KEY)).toBe(true);
  fetchMock.mockResolvedValueOnce(response({}, 204));
  await expect(clientA.auth.signOut()).resolves.toEqual({ error: null });
  await retireSupabaseClient();
  await clearSecureSession();
  expect(stored.size).toBe(0);

  const clientB = getSupabaseClient()!;
  expect(clientB).not.toBe(clientA);
  expect((await clientB.auth.getSession()).data.session).toBeNull();
  fetchMock.mockResolvedValueOnce(response({ id: 'account-b', email: 'b@example.test',
    identities: [{ id: 'identity-b', provider: 'email' }] }));
  const result = await clientB.auth.signUp({ email: 'b@example.test', password: 'unit-password' });
  expect(result.error).toBeNull();
  expect(result.data.user?.id).toBe('account-b');
  expect(result.data.session).toBeNull();
  expect(stored.has(AUTH_STORAGE_KEY)).toBe(false);
});
