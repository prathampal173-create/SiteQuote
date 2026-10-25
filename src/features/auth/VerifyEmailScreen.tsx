import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { AppButton } from '../../components/AppButton';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { getSupabaseClient } from '../../lib/supabase';
import { colors } from '../../config/theme';
import { useAuthFlow } from './AuthFlowProvider';
import { describeAuthError, validateOtp } from './authUtils';

export function VerifyEmailScreen() {
  const router = useRouter();
  const { pending, authorized, grantVerifiedOtp, markResendAttempt, remainingResendSeconds } = useAuthFlow();
  const [otp, setOtp] = useState('');
  const [inputError, setInputError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<'verify' | 'resend' | null>(null);
  const inFlight = useRef(false);

  useEffect(() => { if (authorized) router.replace('/(tabs)'); }, [authorized, router]);

  async function verify() {
    if (inFlight.current || !pending || authorized) return;
    const validation = validateOtp(otp);
    setInputError(validation ?? '');
    setRequestError('');
    setNotice('');
    if (validation) return;
    const client = getSupabaseClient();
    if (!client) { setRequestError('Supabase is not configured. Return to signup after configuring the backend.'); return; }
    inFlight.current = true;
    setAction('verify');
    try {
      const { data, error } = await client.auth.verifyOtp({ email: pending.email, token: otp, type: 'email' });
      if (error) { setRequestError(describeAuthError(error, 'verify').message); return; }
      if (!await grantVerifiedOtp(data)) {
        setRequestError('Confirmation did not establish a verified, valid session. Check Supabase Confirm email settings and try again.');
      }
      // The verified session guard triggers navigation. No tokens are stored here.
    } catch (error) {
      setRequestError(describeAuthError(error, 'verify').message);
    } finally {
      inFlight.current = false;
      setAction(null);
    }
  }

  async function resend() {
    if (inFlight.current || !pending || remainingResendSeconds > 0) return;
    const client = getSupabaseClient();
    if (!client) { setRequestError('Supabase is not configured. Return to signup after configuring the backend.'); return; }
    setRequestError('');
    setNotice('');
    inFlight.current = true;
    setAction('resend');
    try {
      const { error } = await client.auth.resend({ type: 'signup', email: pending.email });
      if (error) {
        const issue = describeAuthError(error, 'resend');
        if (issue.kind === 'rate-limited') markResendAttempt();
        setRequestError(issue.message);
        return;
      }
      markResendAttempt();
      setNotice('Resend request accepted. Check your inbox for the latest code; delivery is not yet confirmed.');
    } catch (error) {
      setRequestError(describeAuthError(error, 'resend').message);
    } finally {
      inFlight.current = false;
      setAction(null);
    }
  }

  if (!pending && !authorized) {
    return (
      <AppScreen>
        <AppText variant="title">Verify email</AppText>
        <AppText accessibilityRole="alert">No signup is awaiting verification on this device. Start with Sign Up.</AppText>
        <AppButton label="Return to Sign Up" onPress={() => router.replace('/sign-up')} />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <AppText variant="title">Verify email</AppText>
      <AppText muted>Check {pending?.email ?? 'your email'} for a six-digit code. Email delivery is not yet confirmed.</AppText>
      <AppField label="Six-digit email code" testID="verification-otp" placeholder="000000"
        keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code"
        value={otp} maxLength={6} editable={!action && !authorized}
        error={inputError} onChangeText={(text) => { setOtp(text.replace(/\D/g, '').slice(0, 6)); setInputError(''); setRequestError(''); }} />
      {requestError ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>{requestError}</AppText> : null}
      {notice ? <AppText accessibilityRole="alert" style={{ color: colors.successText }}>{notice}</AppText> : null}
      <AppButton label={action === 'verify' ? 'Verifying…' : 'Verify'} disabled={Boolean(action) || authorized || !pending} onPress={verify} />
      <AppText variant="caption" muted>
        {remainingResendSeconds > 0 ? `Resend available in ${remainingResendSeconds}s` : 'Resend available. Provider limits still apply.'}
      </AppText>
      <AppButton label={action === 'resend' ? 'Sending request…' : 'Resend code'} variant="secondary"
        disabled={Boolean(action) || authorized || !pending || remainingResendSeconds > 0} onPress={resend} />
      <AppButton label="Back to Sign Up" variant="secondary" disabled={Boolean(action)} onPress={() => router.replace('/sign-up')} />
    </AppScreen>
  );
}
