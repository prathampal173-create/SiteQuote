import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { AppButton } from '../../components/AppButton';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { getBackendConfiguration } from '../../config/env';
import { colors } from '../../config/theme';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../lib/supabase';
import { useAuthFlow } from './AuthFlowProvider';
import { describeAuthError, normalizeEmail, validateSignup, type AuthFieldErrors } from './authUtils';

export function SignUpScreen() {
  const router = useRouter();
  const { authorized, checking, sessionError, accountScope, retryRestore,
    beginVerification, discardUntrustedSession } = useAuthFlow();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [sessionDetected, setSessionDetected] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const currentFlow = useRef({ authorized, checking, sessionError, accountScope });
  currentFlow.current = { authorized, checking, sessionError, accountScope };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setEmail(''); setPassword(''); setErrors({}); setRequestError('');
    setPendingEmail(null); setSessionDetected(false);
  }, [accountScope]);
  const config = getBackendConfiguration();
  const configurationError = config.status === 'ready' ? ''
    : 'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to sign up.';

  async function submit() {
    if (inFlight.current || authorized || checking || sessionError || sessionDetected) return;
    const nextErrors = validateSignup(email, password);
    setErrors(nextErrors);
    setRequestError('');
    if (Object.keys(nextErrors).length) return;
    const client = getSupabaseClient();
    if (!client) { setRequestError(configurationError || 'Supabase configuration is invalid.'); return; }
    inFlight.current = true;
    setLoading(true);
    setPendingEmail(null);
    const submittedEmail = normalizeEmail(email);
    const requestIsCurrent = () => mounted.current && isCurrentSupabaseClient(client) &&
      currentFlow.current.accountScope === accountScope && !currentFlow.current.authorized &&
      !currentFlow.current.checking && !currentFlow.current.sessionError;
    try {
      // Check the SDK too: a session can exist before the provider finishes restoring it.
      const current = await client.auth.getSession();
      if (!requestIsCurrent()) return;
      if (current.error) { setRequestError(describeAuthError(current.error, 'signup').message); return; }
      if (current.data.session) { setSessionDetected(true); setPassword(''); return; }
      const { data, error } = await client.auth.signUp({ email: submittedEmail, password });
      if (!requestIsCurrent()) return;
      if (error) { setRequestError(describeAuthError(error, 'signup').message); return; }
      if (data?.session) {
        // Confirm email is misconfigured. Drop the unexpected local session;
        // do not treat it as verified signup or expose protected routes.
        await discardUntrustedSession();
        if (mounted.current) setRequestError('Supabase must have Confirm email enabled before signup can continue.');
        return;
      }
      if (!data?.user) {
        setRequestError('Signup did not return an account awaiting confirmation. Please retry.');
        return;
      }
      // A signup response is NOT proof of email delivery, confirmation, or authentication.
      setPassword('');
      // Supabase can obfuscate this response. Do not infer account existence from
      // user/identities fields or promise that a message was sent.
      setPendingEmail(submittedEmail);
    } catch (error) {
      if (requestIsCurrent()) setRequestError(describeAuthError(error, 'signup').message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  if (authorized || sessionDetected) {
    return <AppScreen>
      <AppText variant="title">Sign Up</AppText>
      <AppText>Sign out in Settings before creating another account.</AppText>
      <AppButton label={authorized ? 'Go to Settings' : 'Continue to current account'} onPress={() => {
        if (authorized) router.replace('/(tabs)/settings');
        else { retryRestore(); router.replace('/'); }
      }} />
    </AppScreen>;
  }

  return (
    <AppScreen>
      <AppText variant="title">Sign Up</AppText>
      <AppText muted>We'll email a six-digit confirmation code. Account access stays locked until verification.</AppText>
      {configurationError ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>{configurationError}</AppText> : null}
      {checking || sessionError ? <AppText accessibilityRole="alert">Complete the secure session check before signing up.</AppText> : null}
      <AppField label="Email" testID="signup-email" placeholder="name@example.com" value={email}
        editable={!loading} keyboardType="email-address" autoCapitalize="none" autoComplete="email"
        error={errors.email} onChangeText={(value) => { setEmail(value); setPendingEmail(null); setRequestError(''); setErrors((old) => ({ ...old, email: undefined })); }} />
      <AppField label="Password" testID="signup-password" placeholder="At least 8 characters" value={password}
        editable={!loading} secureTextEntry autoComplete="new-password"
        error={errors.password} onChangeText={(value) => { setPassword(value); setErrors((old) => ({ ...old, password: undefined })); }} />
      {requestError ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>{requestError}</AppText> : null}
      {pendingEmail ? <>
        <AppText accessibilityRole="alert">If this email can be registered, check your inbox for a confirmation code. If you already have an account, Log In.</AppText>
        <AppButton label="Enter confirmation code" variant="secondary" onPress={() => {
          if (checking || sessionError) return;
          beginVerification(pendingEmail); router.replace('/verify-email');
        }} />
      </> : null}
      <AppButton label={loading ? 'Requesting code…' : 'Sign Up'} disabled={loading || checking || Boolean(sessionError) || Boolean(configurationError)} onPress={submit} />
      <AppButton label="Log In" variant="secondary" disabled={loading} onPress={() => router.replace('/log-in')} />
      <AppButton label="Back to Welcome" variant="secondary" disabled={loading} onPress={() => router.replace('/')} />
    </AppScreen>
  );
}
