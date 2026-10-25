import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { AuthFlowProvider, useAuthFlow } from '../AuthFlowProvider';
import { SignUpScreen } from '../SignUpScreen';
import { registerAccountCleanup } from '../accountCleanup';
import { getSupabaseClient, isCurrentSupabaseClient, retireSupabaseClient } from '../../../lib/supabase';
import { clearSecureSession, secureStorageAvailable } from '../../../lib/secureSessionStorage';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('../../../lib/supabase', () => ({
  getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn(), retireSupabaseClient: jest.fn()
}));
jest.mock('../../../lib/secureSessionStorage', () => ({
  clearSecureSession: jest.fn(), secureStorageAvailable: jest.fn()
}));
jest.mock('../../../config/env', () => ({ getBackendConfiguration: () => ({
  status: 'ready', url: 'https://example.supabase.co', publishableKey: 'sb_publishable_unit_test'
}) }));

function Harness() {
  const flow = useAuthFlow();
  return <>
    <Text>{flow.checking ? 'Checking' : flow.accountId ?? 'Signed out'}</Text>
    <Text>{flow.pending?.email ?? 'No pending email'}</Text>
    {flow.authorized
      ? <Pressable accessibilityRole="button" onPress={() => void flow.signOut()}><Text>Sign Out</Text></Pressable>
      : <SignUpScreen />}
  </>;
}

// Real provider + signup screen; SDK/native boundaries are mocked, not a device test.
test('A restore → existing sign-out/cleanup → B signup never retains A authorization or pending email', async () => {
  const user = { id: 'account-a', email: 'a@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' };
  const session = { user, access_token: 'unit-only', expires_at: 2000000000 };
  let stored: typeof session | null = session;
  const cleanup = jest.fn().mockResolvedValue(undefined);
  const unregister = registerAccountCleanup(cleanup);
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: stored }, error: null })),
    getUser: jest.fn(async () => ({ data: { user }, error: null })),
    refreshSession: jest.fn(async () => ({ data: { session: stored }, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
    signUp: jest.fn(async () => ({ data: { user: { id: 'account-b', identities: [{}] }, session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn()
  };
  const clientA = { auth } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>;
  const clientB = { auth: { ...auth } } as unknown as typeof clientA;
  let active = clientA;
  jest.mocked(getSupabaseClient).mockImplementation(() => active);
  jest.mocked(isCurrentSupabaseClient).mockImplementation(client => client === active);
  jest.mocked(retireSupabaseClient).mockImplementation(async () => { active = clientB; });
  jest.mocked(secureStorageAvailable).mockResolvedValue(true);
  jest.mocked(clearSecureSession).mockImplementation(async () => { stored = null; });
  const view = render(<AuthFlowProvider><Harness /></AuthFlowProvider>);
  try {
    await screen.findByText('account-a');
    fireEvent.press(screen.getByRole('button', { name: 'Sign Out' }));
    await screen.findByText('Signed out');
    expect(clearSecureSession).toHaveBeenCalledTimes(1);
    expect(retireSupabaseClient).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith('account-a');
    expect(active).toBe(clientB);
    fireEvent.changeText(screen.getByTestId('signup-email'), 'b@example.test');
    fireEvent.changeText(screen.getByTestId('signup-password'), 'unit-password');
    fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Enter confirmation code' }));
    await waitFor(() => expect(screen.getByText('b@example.test')).toBeTruthy());
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'b@example.test', password: 'unit-password' });
    expect(screen.queryByText('account-a')).toBeNull();
    expect(screen.getByText('Signed out')).toBeTruthy();
    expect(mockReplace).toHaveBeenCalledWith('/verify-email');
  } finally { view.unmount(); unregister(); }
});
