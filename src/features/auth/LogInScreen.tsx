import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { AppButton } from '../../components/AppButton';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { getBackendConfiguration } from '../../config/env';
import { colors } from '../../config/theme';
import { getSupabaseClient } from '../../lib/supabase';
import { useAuthFlow } from './AuthFlowProvider';
import { normalizeEmail, validateSignup, type AuthFieldErrors } from './authUtils';
import { describeLoginFailure } from './sessionValidation';

export function LogInScreen() {
  const router = useRouter();
  const { authorized, grantVerifiedLogin, discardUntrustedSession, beginVerification } = useAuthFlow();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [requestError, setRequestError] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const configured = getBackendConfiguration().status === 'ready';

  async function submit() {
    if (inFlight.current || authorized || !configured) return;
    const next = validateSignup(email, password);
    setErrors(next);
    setRequestError('');
    setNeedsConfirmation(false);
    if (Object.keys(next).length) return;
    const client = getSupabaseClient();
    if (!client) { setRequestError('Secure Supabase configuration is unavailable.'); return; }
    inFlight.current = true;
    setLoading(true);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error) {
        setRequestError(describeLoginFailure(error));
        setNeedsConfirmation(error.code === 'email_not_confirmed');
        return;
      }
      if (!data.session?.access_token || !await grantVerifiedLogin(email, data.session.access_token)) {
        await discardUntrustedSession();
        setRequestError('Your session could not be verified. Check your connection and retry.');
        return;
      }
      setPassword('');
      // Protected route guard opens Dashboard; no shortcut to the CRM.
      router.replace('/(tabs)');
    } catch {
      await discardUntrustedSession();
      setRequestError('Network unavailable or sign-in could not be verified. Retry when connected.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AppScreen>
      <AppText variant="title">Log In</AppText>
      <AppText muted>Sign in using a verified email address.</AppText>
      {!configured ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>
        Supabase is not configured. Set the two EXPO_PUBLIC_SUPABASE_ environment values.
      </AppText> : null}
      <AppField label="Email" testID="login-email" placeholder="name@example.com"
        value={email} editable={!loading} keyboardType="email-address" autoCapitalize="none" autoComplete="email"
        error={errors.email} onChangeText={(text) => { setEmail(text); setErrors((prev) => ({ ...prev, email: undefined })); }} />
      <AppField label="Password" testID="login-password" value={password} placeholder="Password"
        secureTextEntry autoComplete="current-password" editable={!loading}
        error={errors.password} onChangeText={(text) => { setPassword(text); setErrors((prev) => ({ ...prev, password: undefined })); }} />
      {requestError ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>{requestError}</AppText> : null}
      {needsConfirmation ? <AppButton label="Verify email" variant="secondary" disabled={loading}
        onPress={() => { beginVerification(email, false); setPassword(''); router.replace('/verify-email'); }} /> : null}
      <AppButton label={loading ? 'Signing in…' : 'Log In'} disabled={loading || !configured} onPress={submit} />
      <AppButton label="Back to Welcome" variant="secondary" disabled={loading} onPress={() => router.replace('/')} />
    </AppScreen>
  );
}
