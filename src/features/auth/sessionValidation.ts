import type { Session } from '@supabase/supabase-js';
import type { SiteQuoteClient } from '../../lib/supabase';
import { normalizeEmail } from './authUtils';

export type ValidatedSession = { userId: string; expiresAtMs: number; accessToken: string };

/** getSession alone reads untrusted local state. getUser(token) verifies with Auth server. */
export async function validateServerSession(
  client: SiteQuoteClient,
  expectedEmail?: string,
  expectedToken?: string
): Promise<ValidatedSession | null> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const session: Session | null = sessionData.session;
  if (sessionError || !session?.access_token || !session.user?.id ||
      !session.expires_at || session.expires_at * 1000 <= Date.now() ||
      (expectedToken && session.access_token !== expectedToken)) return null;

  // Network failure means no authorization. Never trust persisted JWT metadata alone.
  const { data: userData, error: userError } = await client.auth.getUser(session.access_token);
  const user = userData.user;
  if (userError || !user?.id || !user.email_confirmed_at || user.is_anonymous === true ||
      user.id !== session.user.id || !session.user.email || !user.email ||
      normalizeEmail(user.email) !== normalizeEmail(session.user.email) ||
      (expectedEmail && normalizeEmail(user.email) !== normalizeEmail(expectedEmail))) return null;
  return { userId: user.id, expiresAtMs: session.expires_at * 1000, accessToken: session.access_token };
}

export function describeLoginFailure(error: { code?: string; status?: number } | null): string {
  if (error?.status === 429 || /rate.limit|over_.*rate_limit/.test(error?.code ?? '')) {
    return 'Too many attempts. Wait for the provider limit before retrying.';
  }
  if (error?.code === 'email_not_confirmed') {
    return 'Email confirmation is required before signing in. You can request a new confirmation code.';
  }
  if (error?.status === 0) return 'Network unavailable. Check your connection and retry.';
  return 'Unable to sign in. Check your details, connection, and email confirmation.';
}
