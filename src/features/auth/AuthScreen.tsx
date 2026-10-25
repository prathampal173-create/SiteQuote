import { SignUpScreen } from './SignUpScreen';
import { VerifyEmailScreen } from './VerifyEmailScreen';
import { LogInScreen } from './LogInScreen';

type Mode = 'sign-up' | 'log-in' | 'verify-email';

export function AuthScreen({ mode }: { mode: Mode }) {
  if (mode === 'sign-up') return <SignUpScreen />;
  if (mode === 'verify-email') return <VerifyEmailScreen />;
  return <LogInScreen />;
}
