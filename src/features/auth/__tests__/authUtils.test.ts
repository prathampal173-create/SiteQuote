import type { User } from '@supabase/supabase-js';
import { describeAuthError, normalizeEmail, RESEND_COOLDOWN_MS, validateOtp, validateSignup, verifiedIdentity } from '../authUtils';

const confirmedProof = {
  user: { id: 'user-1', email: 'test@example.com', email_confirmed_at: '2026-10-21T00:00:00Z' },
  session: {
    access_token: 'test-unit-only-token',
    expires_at: 2000000000,
    user: { id: 'user-1', email: 'test@example.com' } as User
  }
};

describe('sign up and OTP validation', () => {
  it.each([
    [new TypeError('Network request failed'), 'network'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'network'],
    [{ name: 'AuthRetryableFetchError', status: 502 }, 'service'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'rate-limited'],
    [{ code: 'user_already_exists' }, 'existing'],
    [{ code: 'email_exists' }, 'existing'],
    [{ code: 'session_not_found' }, 'session'],
    [{ name: 'SecureSessionStorageError' }, 'session'],
    [{ code: 'validation_failed', message: 'private-test-value' }, 'generic'],
    [new Error('private-test-value'), 'generic'],
    [null, 'generic']
  ])('classifies signup errors without exposing provider payloads', (error, kind) => {
    const issue = describeAuthError(error, 'signup');
    expect(issue.kind).toBe(kind);
    expect(issue.message).not.toContain('private-test-value');
  });
  it('normalizes email and accepts valid input', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(validateSignup(' User@Example.COM ', 'password-long')).toEqual({});
    expect(validateOtp('012345')).toBeUndefined();
  });

  it.each([['bad', '12345678'], ['a @example.com', '12345678'], ['', '12345678'], ['ok@example.com', 'short']])(
    'rejects invalid credentials', (email, password) => {
      expect(Object.keys(validateSignup(email, password)).length).toBeGreaterThan(0);
    }
  );
  it.each(['', '12345', '1234567', '12a456', ' 123456'])(
    'rejects invalid code %s', (otp) => expect(validateOtp(otp)).toBeDefined()
  );

  it('grants only server-confirmed email with nonexpired matching session', () => {
    expect(verifiedIdentity(confirmedProof, 'test@example.com', 1000000000000)).toEqual({
      userId: 'user-1', expiresAtMs: 2000000000000
    });
    expect(verifiedIdentity(confirmedProof, 'another@example.com', 1000000000000)).toBeNull();
    expect(verifiedIdentity(confirmedProof, 'test@example.com', 2000000000000)).toBeNull();
    expect(verifiedIdentity({ ...confirmedProof, user: { ...confirmedProof.user, email_confirmed_at: '' } }, 'test@example.com', 1000000000000)).toBeNull();
    expect(verifiedIdentity({ ...confirmedProof, session: null }, 'test@example.com', 1000000000000)).toBeNull();
    expect(verifiedIdentity({ ...confirmedProof, session: { ...confirmedProof.session, user: { ...confirmedProof.session.user, id: 'other' } } }, 'test@example.com', 1000000000000)).toBeNull();
  });

  it('classifies invalid, expired, rate-limited, and network errors without echoing them', () => {
    expect(describeAuthError({ code: 'otp_expired', message: 'expired' }, 'verify').kind).toBe('expired');
    expect(describeAuthError({ code: 'otp_invalid' }, 'verify').kind).toBe('invalid');
    expect(describeAuthError({ status: 429 }, 'resend').kind).toBe('rate-limited');
    expect(describeAuthError(null, 'signup').kind).toBe('generic');
    expect(RESEND_COOLDOWN_MS).toBe(60000);
  });
});
