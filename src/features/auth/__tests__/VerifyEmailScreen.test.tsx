import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { VerifyEmailScreen } from '../VerifyEmailScreen';
import { getSupabaseClient } from '../../../lib/supabase';
import { useAuthFlow } from '../AuthFlowProvider';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../AuthFlowProvider', () => ({ useAuthFlow: jest.fn() }));

const clientMock = jest.mocked(getSupabaseClient);
const flowMock = jest.mocked(useAuthFlow);
const verifyOtp = jest.fn();
const resend = jest.fn();
const grantVerifiedOtp = jest.fn();
const markResendAttempt = jest.fn();
const pending = { email: 'person@example.com', resendAvailableAt: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  clientMock.mockReturnValue({ auth: { verifyOtp, resend } } as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>);
  flowMock.mockReturnValue({ pending, authorized: false, remainingResendSeconds: 0, grantVerifiedOtp, markResendAttempt } as unknown as ReturnType<typeof useAuthFlow>);
});

function enterCode() { fireEvent.changeText(screen.getByTestId('verification-otp'), '123456'); }

test('rejects missing OTP locally and remains on verification', () => {
  render(<VerifyEmailScreen />);
  fireEvent.press(screen.getByText('Verify'));
  expect(screen.getByText('Enter the six-digit code from your email.')).toBeTruthy();
  expect(verifyOtp).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test.each([
  [{ code: 'otp_invalid', message: 'invalid' }, 'incorrect'],
  [{ code: 'otp_expired', message: 'expired' }, 'expired']
])('incorrect or expired OTP cannot enter tabs', async (error, expected) => {
  verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error });
  render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  await screen.findByText(new RegExp(expected));
  expect(grantVerifiedOtp).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');
});

test('a verified OTP and confirmed in-memory grant triggers Dashboard navigation', async () => {
  const proof = { user: { id: 'user-1' }, session: { access_token: 'redacted' } };
  verifyOtp.mockResolvedValue({ data: proof, error: null });
  grantVerifiedOtp.mockResolvedValue(true);
  const view = render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  await waitFor(() => expect(grantVerifiedOtp).toHaveBeenCalledWith(proof));
  expect(verifyOtp).toHaveBeenCalledWith({ email: pending.email, token: '123456', type: 'email' });
  flowMock.mockReturnValue({ pending: null, authorized: true, remainingResendSeconds: 0 } as ReturnType<typeof useAuthFlow>);
  view.rerender(<VerifyEmailScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
});

test('honors visible resend cooldown and never submits early', () => {
  flowMock.mockReturnValue({ pending, authorized: false, remainingResendSeconds: 45 } as ReturnType<typeof useAuthFlow>);
  render(<VerifyEmailScreen />);
  expect(screen.getByText('Resend available in 45s')).toBeTruthy();
  fireEvent.press(screen.getByText('Resend code'));
  expect(resend).not.toHaveBeenCalled();
});

test('resend uses signup type and rate limits start a new cooldown', async () => {
  resend.mockResolvedValue({ error: { status: 429 } });
  render(<VerifyEmailScreen />);
  fireEvent.press(screen.getByText('Resend code'));
  await screen.findByText(/Too many requests/);
  expect(resend).toHaveBeenCalledWith({ type: 'signup', email: pending.email });
  expect(markResendAttempt).toHaveBeenCalledTimes(1);
});

test('OTP verification rate limit denies access', async () => {
  verifyOtp.mockResolvedValue({ error: { status: 429 }, data: { user: null, session: null } });
  render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  await screen.findByText(/Too many requests/);
  expect(grantVerifiedOtp).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');
});

test('a network interruption keeps the OTP for retry', async () => {
  verifyOtp.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ error: { code: 'otp_invalid' } });
  render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  await screen.findByText(/Network unavailable/);
  expect(screen.getByTestId('verification-otp').props.value).toBe('123456');
  fireEvent.press(screen.getByText('Verify'));
  await screen.findByText(/incorrect/);
  expect(verifyOtp).toHaveBeenCalledTimes(2);
});

test('successful resend reports only acceptance, not delivery', async () => {
  resend.mockResolvedValue({ error: null });
  render(<VerifyEmailScreen />);
  fireEvent.press(screen.getByText('Resend code'));
  await screen.findByText(/Resend request accepted/);
  expect(markResendAttempt).toHaveBeenCalledTimes(1);
});

test('direct verification route without pending signup cannot verify', () => {
  flowMock.mockReturnValue({ pending: null, authorized: false } as ReturnType<typeof useAuthFlow>);
  render(<VerifyEmailScreen />);
  expect(screen.getByText(/No signup is awaiting verification/)).toBeTruthy();
  expect(verifyOtp).not.toHaveBeenCalled();
});

test('missing Supabase client blocks OTP verification', async () => {
  clientMock.mockReturnValue(null);
  render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  await screen.findByText(/Supabase is not configured/);
  expect(grantVerifiedOtp).not.toHaveBeenCalled();
});


test('prevents duplicate verification requests during loading', async () => {
  let complete!: (value: unknown) => void;
  verifyOtp.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  fireEvent.press(screen.getByText('Verifying…'));
  expect(verifyOtp).toHaveBeenCalledTimes(1);
  complete({ error: { code: 'otp_invalid' }, data: { user: null, session: null } });
  await screen.findByText(/incorrect/);
});

test('a valid-looking OTP result without a matching SDK session stays on verification', async () => {
  const proof = { user: { id: 'user-1' }, session: { access_token: 'unit-test-only' } };
  verifyOtp.mockResolvedValue({ data: proof, error: null });
  grantVerifiedOtp.mockResolvedValue(false);
  render(<VerifyEmailScreen />);
  enterCode();
  fireEvent.press(screen.getByText('Verify'));
  await screen.findByText(/did not establish a verified, valid session/);
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)');
  expect(screen.getByTestId('verification-otp').props.value).toBe('123456');
});
