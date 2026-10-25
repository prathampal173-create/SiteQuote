import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { AuthFlowProvider, useAuthFlow } from '../AuthFlowProvider';
import { getSupabaseClient, retireSupabaseClient } from '../../../lib/supabase';
import { secureStorageAvailable, clearSecureSession } from '../../../lib/secureSessionStorage';
import type { VerificationProof } from '../authUtils';
import { registerAccountCleanup } from '../accountCleanup';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), retireSupabaseClient: jest.fn() }));
jest.mock('../../../lib/secureSessionStorage', () => ({ secureStorageAvailable: jest.fn(), clearSecureSession: jest.fn() }));

const clientMock = jest.mocked(getSupabaseClient);
const availability = jest.mocked(secureStorageAvailable);
const storageClear = jest.mocked(clearSecureSession);
const getSession = jest.fn();
const getUser = jest.fn();
const signOut = jest.fn();
const refreshSession = jest.fn();
const onAuthStateChange = jest.fn();
let eventHandler: ((event: string, session: unknown) => void) | undefined;
let storedSession: Record<string, unknown> | null;
const user = { id: 'user-a', email: 'a@example.com', email_confirmed_at: '2026-10-01T00:00:00Z', is_anonymous: false };
const session = { access_token: 'token-a', expires_at: 2000000000, user };
const proof = { user, session } as unknown as VerificationProof;

function Harness() {
  const flow = useAuthFlow();
  return <>
    <Text>{flow.checking ? 'Checking' : flow.authorized ? 'Granted' : 'Denied'}</Text>
    <Text>{flow.sessionError || 'No error'}</Text>
    <Text>{flow.pending?.email ?? 'No pending'}</Text>
    <Pressable onPress={() => flow.beginVerification('a@example.com')}><Text>Begin</Text></Pressable>
    <Pressable onPress={() => void flow.grantVerifiedOtp(proof)}><Text>OTP</Text></Pressable>
    <Pressable onPress={() => void flow.grantVerifiedLogin('a@example.com', session.access_token)}><Text>Login</Text></Pressable>
    <Pressable onPress={() => void flow.signOut()}><Text>Sign out</Text></Pressable>
  </>;
}

beforeEach(() => {
  jest.clearAllMocks();
  storedSession = null;
  availability.mockResolvedValue(true);
  storageClear.mockImplementation(async () => { storedSession = null; });
  getSession.mockImplementation(async () => ({ data: { session: storedSession }, error: null }));
  getUser.mockResolvedValue({ data: { user }, error: null });
  signOut.mockResolvedValue({ error: null });
  refreshSession.mockImplementation(async () => ({ data: { session: storedSession }, error: null }));
  onAuthStateChange.mockImplementation((handler) => {
    eventHandler = handler;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  clientMock.mockReturnValue({ auth: {
    getSession, getUser, signOut, refreshSession, onAuthStateChange,
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn()
  } } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>);
});

async function grantOtp() {
  fireEvent.press(screen.getByText('Begin'));
  storedSession = session;
  fireEvent.press(screen.getByText('OTP'));
  await waitFor(() => expect(screen.getByText('Granted')).toBeTruthy());
}

test('OTP cannot grant until server-validated and verified', async () => {
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  fireEvent.press(screen.getByText('OTP'));
  expect(screen.getByText('Denied')).toBeTruthy();
  await grantOtp();
  expect(getUser).toHaveBeenCalledWith('token-a');
});

test('restores only a remotely verified, non-anonymous session', async () => {
  storedSession = session;
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await waitFor(() => expect(screen.getByText('Granted')).toBeTruthy());
  expect(refreshSession).toHaveBeenCalled();
});

test('fails closed on revoked, unconfirmed, and anonymous restored users', async () => {
  storedSession = session;
  getUser.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null, is_anonymous: true } }, error: null });
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  expect(screen.getByText(/Unable to verify your saved session/)).toBeTruthy();
});

test('offline restoration blocks access and displays retry', async () => {
  storedSession = session;
  getUser.mockRejectedValue(new Error('offline'));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  expect(screen.getByText(/Unable to verify your saved session/)).toBeTruthy();
});

test('clearing an unrestorable session removes stale credentials and permits a fresh login', async () => {
  storedSession = session;
  refreshSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('revoked') });
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText(/Unable to verify your saved session/);
  fireEvent.press(screen.getByText('Sign out'));
  await screen.findByText('No error');
  expect(storageClear).toHaveBeenCalled();
  expect(retireSupabaseClient).toHaveBeenCalled();
  expect(storedSession).toBeNull();
  await grantOtp();
});

test('corrupted secure session data does not unlock app', async () => {
  getSession.mockRejectedValue(new Error('corrupt'));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  expect(screen.getByText(/Unable to verify your saved session/)).toBeTruthy();
});

test('secure storage unavailable prevents session restoration', async () => {
  availability.mockResolvedValue(false);
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  expect(screen.getByText(/Unable to verify your saved session/)).toBeTruthy();
});

test('legitimate same-account token refresh is remotely revalidated without sign-out', async () => {
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  const refreshed = { ...session, access_token: 'token-refreshed' };
  storedSession = refreshed;
  act(() => eventHandler?.('TOKEN_REFRESHED', refreshed));
  await waitFor(() => expect(getUser).toHaveBeenCalledWith('token-refreshed'));
  await waitFor(() => expect(screen.getByText('Granted')).toBeTruthy());
});

test('a different account SIGNED_IN event revokes current access', async () => {
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  act(() => eventHandler?.('SIGNED_IN', { user: { id: 'user-b' } }));
  await screen.findByText('Denied');
});

test('sign-out immediately locks navigation, clears encrypted credentials and retires client', async () => {
  let finish!: (v: unknown) => void;
  signOut.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  fireEvent.press(screen.getByText('Sign out'));
  expect(screen.queryByText('Granted')).toBeNull();
  await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: 'global' }));
  await act(async () => { finish({ error: null }); });
  await waitFor(() => expect(storageClear).toHaveBeenCalled());
  expect(retireSupabaseClient).toHaveBeenCalled();
  expect(screen.queryByText('Granted')).toBeNull();
});

test('network failure during sign-out still wipes local credentials', async () => {
  signOut.mockRejectedValue(new Error('offline'));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  fireEvent.press(screen.getByText('Sign out'));
  await waitFor(() => expect(storageClear).toHaveBeenCalled());
  expect(screen.queryByText('Granted')).toBeNull();
});

test('secure deletion failure blocks session reuse after sign-out', async () => {
  storageClear.mockRejectedValue(new Error('keychain'));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  fireEvent.press(screen.getByText('Sign out'));
  await screen.findByText(/Secure local sign-out could not finish/);
  expect(screen.queryByText('Granted')).toBeNull();
});

test('a provider remount revalidates a real stored session instead of trusting previous grant', async () => {
  const app = render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  app.unmount();
  getUser.mockResolvedValue({ data: { user }, error: null });
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await waitFor(() => expect(screen.getByText('Granted')).toBeTruthy());
  expect(getUser).toHaveBeenCalled();
});


test('account A to B switch never exposes A grant on new session', async () => {
  storageClear.mockImplementation(async () => { storedSession = null; });
  const app = render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  fireEvent.press(screen.getByText('Sign out'));
  await waitFor(() => expect(storageClear).toHaveBeenCalled());
  await screen.findByText('Denied');
  app.unmount();
  const userB = { id: 'user-b', email: 'b@example.com', email_confirmed_at: '2026-10-01T00:00:00Z', is_anonymous: false };
  storedSession = { access_token: 'token-b', expires_at: 2000000000, user: userB };
  getUser.mockResolvedValue({ data: { user: userB }, error: null });
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await waitFor(() => expect(screen.getByText('Granted')).toBeTruthy());
  expect(getUser).toHaveBeenCalledWith('token-b');
});

test('late OTP confirmation from account A cannot reopen routes after sign-out', async () => {
  let finish!: (v: unknown) => void;
  getUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  fireEvent.press(screen.getByText('Begin'));
  storedSession = session;
  fireEvent.press(screen.getByText('OTP'));
  await waitFor(() => expect(getUser).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Sign out'));
  await act(async () => finish({ data: { user }, error: null }));
  await waitFor(() => expect(storageClear).toHaveBeenCalled());
  expect(screen.queryByText('Granted')).toBeNull();
});


test('same-account token replacement without verified refresh is denied', async () => {
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await screen.findByText('Denied');
  await grantOtp();
  act(() => eventHandler?.('SIGNED_IN', { ...session, access_token: 'untrusted-replacement' }));
  await screen.findByText('Denied');
});

test('an external Supabase SIGNED_OUT event revokes access and cleans only the outgoing account', async () => {
  const cleanup = jest.fn().mockResolvedValue(undefined);
  const unregister = registerAccountCleanup(cleanup);
  try {
    render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
    await screen.findByText('Denied');
    await grantOtp();
    act(() => eventHandler?.('SIGNED_OUT', null));
    expect(screen.queryByText('Granted')).toBeNull();
    await waitFor(() => expect(storageClear).toHaveBeenCalled());
    await waitFor(() => expect(cleanup).toHaveBeenCalledWith('user-a'));
    expect(cleanup).not.toHaveBeenCalledWith('user-b');
    await screen.findByText('Denied');
  } finally { unregister(); }
});

test('a SIGNED_OUT event during initial restoration never leaves checking indefinitely', async () => {
  let finish!: (v: unknown) => void;
  storedSession = session;
  refreshSession.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  await waitFor(() => expect(refreshSession).toHaveBeenCalled());
  act(() => eventHandler?.('SIGNED_OUT', null));
  await screen.findByText('Denied');
  await act(async () => { finish({ data: { session: null }, error: null }); });
  expect(screen.getByText('Denied')).toBeTruthy();
});
