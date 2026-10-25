import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SignUpScreen } from '../SignUpScreen';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { getBackendConfiguration } from '../../../config/env';
import { useAuthFlow } from '../AuthFlowProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../../config/env', () => ({ getBackendConfiguration: jest.fn() }));
jest.mock('../AuthFlowProvider', () => ({ useAuthFlow: jest.fn() }));

const clientMock = jest.mocked(getSupabaseClient);
const configMock = jest.mocked(getBackendConfiguration);
const flowMock = jest.mocked(useAuthFlow);
const signUp = jest.fn();
const getSession = jest.fn();
const retryRestore = jest.fn();
const discardUntrustedSession = jest.fn();
const beginVerification = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  clientMock.mockReturnValue({ auth: { signUp, getSession } } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>);
  configMock.mockReturnValue({ status: 'ready', url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });
  flowMock.mockReturnValue({ beginVerification, discardUntrustedSession, retryRestore, authorized: false, checking: false, sessionError: '', accountScope: 0 } as unknown as ReturnType<typeof useAuthFlow>);
  discardUntrustedSession.mockResolvedValue(undefined);
});

function fillValidForm() {
  fireEvent.changeText(screen.getByTestId('signup-email'), ' Person@Example.com ');
  fireEvent.changeText(screen.getByTestId('signup-password'), 'abcdefgh');
}

test.each([[], undefined, [{ provider: 'email' }]])('obfuscated existing-email response stays neutral with a Log In option (%s)', async identities => {
  signUp.mockResolvedValue({ data: { user: { id: 'obfuscated', identities }, session: null }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await screen.findByText(/If this email can be registered/);
  expect(screen.queryByText(/Email already registered/)).toBeNull();
  expect(beginVerification).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Log In' }));
  expect(mockReplace).toHaveBeenCalledWith('/log-in');
});

test('neutral response still allows a recipient to enter an actual confirmation code', async () => {
  signUp.mockResolvedValue({ data: { user: { id: 'ambiguous' }, session: null }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Enter confirmation code' }));
  expect(beginVerification).toHaveBeenCalledWith('person@example.com');
  expect(mockReplace).toHaveBeenCalledWith('/verify-email');
});

test.each([
  [{ code: 'user_already_exists', status: 422 }, /Email already registered/],
  [{ code: 'email_exists', status: 422 }, /Email already registered/],
  [{ code: 'over_email_send_rate_limit', status: 429 }, /Too many requests/],
  [{ code: 'signup_disabled', status: 422 }, /Unable to request signup/],
  [{ name: 'AuthRetryableFetchError', status: 503 }, /service is temporarily unavailable/],
  [{ name: 'SecureSessionStorageError' }, /secure session is unavailable/],
  [new Error('Unexpected session key.'), /Unable to request signup/]
])('distinguishes provider and local failures without mislabeling them as offline', async (error, message) => {
  signUp.mockResolvedValue({ data: { user: null, session: null }, error });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await screen.findByText(message);
  expect(screen.queryByText(/Network unavailable/)).toBeNull();
  expect(beginVerification).not.toHaveBeenCalled();
});

test('authenticated signup routes to existing Settings sign-out without submitting', () => {
  flowMock.mockReturnValue({ ...flowMock(), authorized: true, accountScope: 1 });
  render(<SignUpScreen />);
  expect(screen.queryByTestId('signup-email')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Go to Settings' }));
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/settings');
  expect(signUp).not.toHaveBeenCalled();
});

test('SDK session preflight prevents signup even before the provider authorizes it', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'account-a' } } }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await screen.findByText(/Sign out in Settings/);
  expect(signUp).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Continue to current account' }));
  expect(retryRestore).toHaveBeenCalled();
});

test.each([{ checking: true }, { sessionError: 'cleanup incomplete' }])('blocks signup until session checks and cleanup finish', state => {
  flowMock.mockReturnValue({ ...flowMock(), ...state });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  expect(signUp).not.toHaveBeenCalled();
});

test('A signed in then signed out can submit B without retaining form state', async () => {
  const view = render(<SignUpScreen />);
  fillValidForm();
  flowMock.mockReturnValue({ ...flowMock(), authorized: true, accountScope: 1 });
  view.rerender(<SignUpScreen />);
  flowMock.mockReturnValue({ ...flowMock(), authorized: false, accountScope: 2 });
  view.rerender(<SignUpScreen />);
  expect(screen.getByTestId('signup-email').props.value).toBe('');
  expect(screen.getByTestId('signup-password').props.value).toBe('');
  signUp.mockResolvedValue({ data: { user: { id: 'b', identities: [{ provider: 'email' }] }, session: null }, error: null });
  fireEvent.changeText(screen.getByTestId('signup-email'), 'b@example.com');
  fireEvent.changeText(screen.getByTestId('signup-password'), 'abcdefgh');
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Enter confirmation code' }));
  expect(beginVerification).toHaveBeenCalledWith('b@example.com');
  expect(signUp).toHaveBeenCalledWith({ email: 'b@example.com', password: 'abcdefgh' });
});

test.each(['retired', 'scope', 'unmounted'])('ignores a signup response after its client/scope is obsolete: %s', async change => {
  let complete!: (value: unknown) => void;
  signUp.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
  if (change === 'retired') jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
  if (change === 'scope') {
    flowMock.mockReturnValue({ ...flowMock(), accountScope: 2 });
    view.rerender(<SignUpScreen />);
  }
  if (change === 'unmounted') view.unmount();
  await act(async () => complete({ data: { user: { identities: [{}] }, session: null }, error: null }));
  expect(beginVerification).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('shows field errors and rejects invalid signup inputs', () => {
  render(<SignUpScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  expect(screen.getByText('Password must be at least eight characters.')).toBeTruthy();
  expect(signUp).not.toHaveBeenCalled();
});

test('requests Supabase signup and lets the recipient continue to OTP without unlocking access', async () => {
  signUp.mockResolvedValue({ data: { user: { id: 'unconfirmed', identities: [{ provider: 'email' }] }, session: null }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Enter confirmation code' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/verify-email'));
  expect(signUp).toHaveBeenCalledWith({ email: 'person@example.com', password: 'abcdefgh' });
  expect(beginVerification).toHaveBeenCalledWith('person@example.com');
});

test('does not submit when Supabase configuration is missing', () => {
  configMock.mockReturnValue({ status: 'unconfigured' });
  clientMock.mockReturnValue(null);
  render(<SignUpScreen />);
  expect(screen.getByText(/Supabase is not configured/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sign Up' }).props.accessibilityState?.disabled).toBe(true);
  expect(signUp).not.toHaveBeenCalled();
});

test('shows a recoverable network error, keeps form input, and permits retry', async () => {
  signUp.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: { user: { id: 'new-account', identities: [{ provider: 'email' }] }, session: null }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await screen.findByText(/Network unavailable/);
  expect(screen.getByTestId('signup-email').props.value).toBe(' Person@Example.com ');
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Enter confirmation code' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/verify-email'));
  expect(signUp).toHaveBeenCalledTimes(2);
});


test('prevents duplicate submissions while the signup request is pending', async () => {
  let complete!: (value: unknown) => void;
  signUp.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  fireEvent.press(screen.getByRole('button', { name: 'Requesting code…' }));
  await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
  complete({ data: { user: { id: 'new-account', identities: [{ provider: 'email' }] }, session: null }, error: null });
  fireEvent.press(await screen.findByRole('button', { name: 'Enter confirmation code' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/verify-email'));
});

test('rejects unexpectedly returned signup sessions when Confirm email is disabled', async () => {
  signUp.mockResolvedValue({ data: { user: { id: 'unconfirmed', identities: [{ provider: 'email' }] }, session: { access_token: 'test-only' } }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await screen.findByText(/Confirm email enabled/);
  expect(discardUntrustedSession).toHaveBeenCalledTimes(1);
  expect(beginVerification).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalledWith('/verify-email');
});

test('rejects a signup response without a pending user', async () => {
  signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  render(<SignUpScreen />);
  fillValidForm();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
  await screen.findByText(/did not return an account awaiting confirmation/);
  expect(beginVerification).not.toHaveBeenCalled();
});
