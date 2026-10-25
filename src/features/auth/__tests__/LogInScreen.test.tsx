import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LogInScreen } from '../LogInScreen';
import { getSupabaseClient } from '../../../lib/supabase';
import { getBackendConfiguration } from '../../../config/env';
import { useAuthFlow } from '../AuthFlowProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../../../config/env', () => ({ getBackendConfiguration: jest.fn() }));
jest.mock('../AuthFlowProvider', () => ({ useAuthFlow: jest.fn() }));
const signInWithPassword = jest.fn();
const grantVerifiedLogin = jest.fn();
const discardUntrustedSession = jest.fn();
const beginVerification = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getBackendConfiguration).mockReturnValue({ status: 'ready', url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
  jest.mocked(getSupabaseClient).mockReturnValue({ auth: { signInWithPassword } } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>);
  jest.mocked(useAuthFlow).mockReturnValue({ authorized: false, grantVerifiedLogin, discardUntrustedSession, beginVerification } as unknown as ReturnType<typeof useAuthFlow>);
  grantVerifiedLogin.mockResolvedValue(true);
  discardUntrustedSession.mockResolvedValue(undefined);
});

function fillForm() {
  fireEvent.changeText(screen.getByTestId('login-email'), ' A@Example.com ');
  fireEvent.changeText(screen.getByTestId('login-password'), 'abcdefgh');
}

test('rejects bad email and short password before contacting Supabase', () => {
  render(<LogInScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  expect(screen.getByText('Password must be at least eight characters.')).toBeTruthy();
  expect(signInWithPassword).not.toHaveBeenCalled();
});

test('verified server session opens Dashboard', async () => {
  signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'unit-test-only' } }, error: null });
  render(<LogInScreen />);
  fillForm();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'abcdefgh' });
  expect(grantVerifiedLogin).toHaveBeenCalledWith(' A@Example.com ', 'unit-test-only');
});

test('incorrect credentials give non-enumerating error', async () => {
  signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' }, data: {} });
  render(<LogInScreen />);
  fillForm();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await screen.findByText(/Unable to sign in/);
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');
});

test('unverified email can request OTP verification without granting access', async () => {
  signInWithPassword.mockResolvedValue({ error: { code: 'email_not_confirmed' }, data: {} });
  render(<LogInScreen />);
  fillForm();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await screen.findByText(/Email confirmation is required/);
  fireEvent.press(screen.getByText('Verify email'));
  expect(beginVerification).toHaveBeenCalledWith(' A@Example.com ', false);
  expect(mockReplace).toHaveBeenCalledWith('/verify-email');
  expect(grantVerifiedLogin).not.toHaveBeenCalled();
});

test('failed remote identity verification clears the untrusted session', async () => {
  grantVerifiedLogin.mockResolvedValue(false);
  signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'unit-test-only' } }, error: null });
  render(<LogInScreen />);
  fillForm();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await screen.findByText(/could not be verified/);
  expect(discardUntrustedSession).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');
});

test('rate limiting and network failures preserve inputs and permit retries', async () => {
  signInWithPassword.mockResolvedValueOnce({ error: { status: 429 }, data: {} })
    .mockRejectedValueOnce(new Error('offline'));
  render(<LogInScreen />);
  fillForm();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await screen.findByText(/Too many attempts/);
  expect(screen.getByTestId('login-email').props.value).toBe(' A@Example.com ');
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  await screen.findByText(/Network unavailable/);
  expect(signInWithPassword).toHaveBeenCalledTimes(2);
});

test('duplicate presses cannot submit twice while request is pending', async () => {
  let complete!: (v: unknown) => void;
  signInWithPassword.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<LogInScreen />);
  fillForm();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  fireEvent.press(screen.getByText('Signing in…'));
  expect(signInWithPassword).toHaveBeenCalledTimes(1);
  complete({ error: { code: 'invalid_credentials' }, data: {} });
  await screen.findByText(/Unable to sign in/);
});

test('missing backend disables login without calling the SDK', () => {
  jest.mocked(getBackendConfiguration).mockReturnValue({ status: 'unconfigured' });
  jest.mocked(getSupabaseClient).mockReturnValue(null);
  render(<LogInScreen />);
  expect(screen.getByText(/Supabase is not configured/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  expect(signInWithPassword).not.toHaveBeenCalled();
});
