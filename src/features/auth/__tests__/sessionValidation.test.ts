import { validateServerSession, describeLoginFailure } from '../sessionValidation';
import type { SiteQuoteClient } from '../../../lib/supabase';
const user = { id: 'a', email: 'a@example.com', email_confirmed_at: '2026-10-01T00:00:00Z', is_anonymous: false };
const session = { access_token: 'unit-test-token', expires_at: 2000000000, user };
const getSession = jest.fn();
const getUser = jest.fn();
const client = { auth: { getSession, getUser } } as unknown as SiteQuoteClient;

beforeEach(() => {
  jest.resetAllMocks();
  getSession.mockResolvedValue({ data: { session }, error: null });
  getUser.mockResolvedValue({ data: { user }, error: null });
});

test('valid verified identity requires a matching token, email and server response', async () => {
  expect(await validateServerSession(client, 'a@example.com', 'unit-test-token'))
    .toEqual({ userId: 'a', accessToken: 'unit-test-token', expiresAtMs: 2000000000000 });
  expect(getUser).toHaveBeenCalledWith('unit-test-token');
});

test('rejects replaced token, expired session, unverified user, anonymous user and mismatched identity', async () => {
  expect(await validateServerSession(client, 'a@example.com', 'wrong')).toBeNull();
  getSession.mockResolvedValueOnce({ data: { session: { ...session, expires_at: 1 } }, error: null });
  expect(await validateServerSession(client)).toBeNull();
  getUser.mockResolvedValueOnce({ data: { user: { ...user, email_confirmed_at: null } }, error: null });
  expect(await validateServerSession(client)).toBeNull();
  getUser.mockResolvedValueOnce({ data: { user: { ...user, is_anonymous: true } }, error: null });
  expect(await validateServerSession(client)).toBeNull();
  getUser.mockResolvedValueOnce({ data: { user: { ...user, id: 'b' } }, error: null });
  expect(await validateServerSession(client)).toBeNull();
  expect(await validateServerSession(client, 'b@example.com')).toBeNull();
});

test('network errors and revoked server user responses cannot authorize', async () => {
  getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } });
  expect(await validateServerSession(client)).toBeNull();
  getUser.mockRejectedValueOnce(new Error('offline'));
  await expect(validateServerSession(client)).rejects.toThrow();
});

test('login messages never disclose account existence', () => {
  expect(describeLoginFailure({ code: 'invalid_credentials' })).toMatch(/Unable to sign in/);
  expect(describeLoginFailure({ code: 'email_not_confirmed' })).toMatch(/confirmation/);
  expect(describeLoginFailure({ status: 429 })).toMatch(/Too many attempts/);
});
