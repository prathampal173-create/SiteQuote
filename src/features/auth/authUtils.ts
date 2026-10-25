import type { Session, User } from '@supabase/supabase-js';

export const RESEND_COOLDOWN_MS = 60_000;

export type AuthFieldErrors = { email?: string; password?: string; otp?: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateSignup(email: string, password: string): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) {
    errors.email = 'Enter a valid email address.';
  }
  if (password.length < 8) errors.password = 'Password must be at least eight characters.';
  return errors;
}

export function validateOtp(otp: string): string | undefined {
  return /^\d{6}$/.test(otp) ? undefined : 'Enter the six-digit code from your email.';
}

export type VerificationProof = {
  user: Pick<User, 'id' | 'email' | 'email_confirmed_at'> | null;
  session: Pick<Session, 'access_token' | 'expires_at' | 'user'> | null;
};

/** Only a verified OTP response with a live session grants access. Signup never calls this. */
export function verifiedIdentity(
  proof: VerificationProof,
  expectedEmail: string,
  nowMs: number = Date.now()
): { userId: string; expiresAtMs: number } | null {
  const { user, session } = proof;
  if (!user?.id || !user.email_confirmed_at || !session?.access_token ||
      !session.expires_at || !session.user?.id || session.user.id !== user.id ||
      normalizeEmail(user.email ?? '') !== normalizeEmail(expectedEmail) ||
      normalizeEmail(session.user.email ?? '') !== normalizeEmail(expectedEmail)) return null;
  const expiresAtMs = session.expires_at * 1000;
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs
    ? { userId: user.id, expiresAtMs }
    : null;
}

export type AuthIssue = { kind: 'invalid' | 'expired' | 'rate-limited' | 'network' | 'generic' | 'existing' | 'session' | 'service'; message: string };

/** Never expose raw provider errors, OTP values, tokens, or passwords in UI messages. */
export function describeAuthError(error: unknown, action: 'signup' | 'verify' | 'resend'): AuthIssue {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof value.code === 'string' ? value.code.toLowerCase() : '';
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  const status = typeof value.status === 'number' ? value.status : undefined;
  if (status === 429 || /^(over_.*rate_limit|rate_limit_exceeded)$/.test(code)) {
    return { kind: 'rate-limited', message: 'Too many requests. Please wait before trying again. Supabase controls the limit.' };
  }
  if (action === 'signup' && ['user_already_exists', 'email_exists'].includes(code)) {
    return { kind: 'existing', message: 'Email already registered. Log In to continue.' };
  }
  if (value.name === 'SecureSessionStorageError' || value.name === 'AuthSessionMissingError' ||
      ['session_not_found', 'session_expired', 'refresh_token_not_found', 'bad_jwt'].includes(code)) {
    return { kind: 'session', message: 'Your secure session is unavailable. Return to Welcome and retry the session check before signing up.' };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'service', message: 'The sign-in service is temporarily unavailable. Please try again later.' };
  }
  if (action === 'verify' && (/expir/.test(`${code} ${message}`))) {
    return { kind: 'expired', message: 'This code has expired. Request a new code when Resend is available.' };
  }
  if (action === 'verify' && (/invalid|incorrect|token.has|otp/.test(`${code} ${message}`))) {
    return { kind: 'invalid', message: 'That code is incorrect or no longer valid. Check the latest email or resend.' };
  }
  if (status === 0 || (!code && status === undefined &&
      /^(network request failed|failed to fetch|fetch failed|network|offline)$/.test(message))) {
    return { kind: 'network', message: 'Network unavailable. Check your connection and try again.' };
  }
  return { kind: 'generic', message: action === 'signup'
    ? 'Unable to request signup. Please retry, or Log In if you already have an account.'
    : 'Unable to complete this request. Please try again.' };
}
