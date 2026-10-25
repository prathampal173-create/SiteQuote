import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { clearSecureSession, secureStorageAvailable } from '../../lib/secureSessionStorage';
import { getSupabaseClient, retireSupabaseClient } from '../../lib/supabase';
import { cleanupOutgoingAccount } from './accountCleanup';
import { normalizeEmail, RESEND_COOLDOWN_MS, verifiedIdentity, type VerificationProof } from './authUtils';
import { validateServerSession, type ValidatedSession } from './sessionValidation';

type PendingSignup = { email: string; resendAvailableAt: number };
type AuthStatus = 'checking' | 'ready' | 'error';
type AuthFlowContextValue = {
  pending: PendingSignup | null;
  authorized: boolean;
  accountId: string | null;
  accountScope: number;
  checking: boolean;
  sessionError: string;
  beginVerification: (email: string, codeAlreadySent?: boolean) => void;
  markResendAttempt: () => void;
  grantVerifiedOtp: (proof: VerificationProof) => Promise<boolean>;
  grantVerifiedLogin: (expectedEmail: string, expectedToken: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
  discardUntrustedSession: () => Promise<void>;
  retryRestore: () => Promise<void>;
  remainingResendSeconds: number;
};

const AuthFlowContext = createContext<AuthFlowContextValue | null>(null);
const GENERIC_RESTORE_ERROR = 'Unable to verify your saved session. Connect to the internet and retry.';

export function AuthFlowProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingSignup | null>(null);
  const [grant, setGrant] = useState<ValidatedSession | null>(null);
  // Changes when an account is granted/revoked, but not on same-account token refresh.
  const [accountScope, setAccountScope] = useState(0);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [sessionError, setSessionError] = useState('');
  const [now, setNow] = useState(Date.now());
  const pendingRef = useRef<PendingSignup | null>(null);
  const grantRef = useRef<ValidatedSession | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const signingOut = useRef(false);
  const cleanupBlocked = useRef(false);
  const pendingCleanupAccount = useRef<string | null>(null);
  const [clientGeneration, setClientGeneration] = useState(0);
  const checkRef = useRef<() => Promise<void>>(async () => {});

  const setActiveGrant = useCallback((next: ValidatedSession | null) => {
    const previousId = grantRef.current?.userId ?? null;
    const nextId = next?.userId ?? null;
    grantRef.current = next;
    if (mounted.current) {
      if (previousId !== nextId) setAccountScope((n) => n + 1);
      setGrant(next);
    }
  }, []);
  const revoke = useCallback(() => {
    epoch.current += 1;
    setActiveGrant(null);
  }, [setActiveGrant]);

  const retryRestore = useCallback(async () => {
    if (signingOut.current) return;
    if (cleanupBlocked.current) {
      try {
        await clearSecureSession();
        await cleanupOutgoingAccount(pendingCleanupAccount.current);
        pendingCleanupAccount.current = null;
        cleanupBlocked.current = false;
        setClientGeneration((n) => n + 1);
      } catch {
        setStatus('error');
        setSessionError('Local credential cleanup is incomplete. Retry secure session check.');
        return;
      }
    }
    const attempt = ++epoch.current;
    setActiveGrant(null);
    setStatus('checking');
    setSessionError('');
    try {
      if (!await secureStorageAvailable()) throw new Error('secure-storage');
      const client = getSupabaseClient();
      if (!client) {
        if (attempt === epoch.current && mounted.current) {
          setSessionError('Supabase is not configured. Add the public backend environment values.');
          setStatus('error');
        }
        return;
      }
      // The SDK may read corrupt/revoked state; a session is never authorization until getUser verifies it.
      const { data, error } = await client.auth.getSession();
      if (attempt !== epoch.current) return;
      if (error) throw new Error('session-read');
      if (data.session) {
        // Refresh against the Auth server to reject revoked refresh credentials, not just a signed JWT.
        const refresh = await client.auth.refreshSession();
        if (refresh.error || !refresh.data.session) throw new Error('session-revoked');
        const valid = await validateServerSession(client);
        if (attempt !== epoch.current) return;
        if (!valid) {
          // Network/unverified/revoked are all fail-closed. Preserve encrypted data for retry offline.
          setSessionError(GENERIC_RESTORE_ERROR);
          setStatus('error');
          return;
        }
        setActiveGrant(valid);
      }
      if (attempt === epoch.current && mounted.current) setStatus('ready');
    } catch {
      if (attempt === epoch.current && mounted.current) {
        setActiveGrant(null);
        setSessionError(GENERIC_RESTORE_ERROR);
        setStatus('error');
      }
    }
  }, [setActiveGrant]);
  checkRef.current = retryRestore;

  useEffect(() => {
    mounted.current = true;
    const client = getSupabaseClient();
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (!mounted.current || signingOut.current || event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        const outgoing = grantRef.current?.userId ?? null;
        revoke();
        if (!outgoing) {
          // A failed refresh can emit SIGNED_OUT during restoration.
          setStatus('ready');
          return;
        }
        // An external sign-out must clean the outgoing account too. Defer
        // SDK/storage work until after the Auth event callback returns.
        pendingCleanupAccount.current = outgoing;
        cleanupBlocked.current = true;
        setStatus('checking');
        void Promise.resolve().then(async () => {
          await retireSupabaseClient();
          await clearSecureSession();
          await cleanupOutgoingAccount(outgoing);
          pendingCleanupAccount.current = null;
          cleanupBlocked.current = false;
          if (mounted.current) {
            setSessionError('');
            setStatus('ready');
            setClientGeneration((n) => n + 1);
          }
        }).catch(() => {
          if (mounted.current) {
            setSessionError('Secure local sign-out could not finish. Retry the secure session check.');
            setStatus('error');
          }
        });
        return;
      }
      const existing = grantRef.current;
      if (event === 'SIGNED_IN') {
        // Another SDK sign-in (including the same user with a replaced token) is not this grant.
        if (existing && (session?.user.id !== existing.userId ||
            session?.access_token !== existing.accessToken)) revoke();
        return;
      }
      if (event !== 'TOKEN_REFRESHED' && existing) { revoke(); return; }
      if (event === 'TOKEN_REFRESHED' && existing) {
        // Never call Auth SDK methods directly inside its auth event callback.
        if (!session || session.user.id !== existing.userId) { revoke(); return; }
        setStatus('checking');
        const attempt = ++epoch.current;
        Promise.resolve().then(async () => {
          try {
            const verified = await validateServerSession(client!, undefined, session.access_token);
            if (attempt !== epoch.current || !mounted.current) return;
            if (!verified || verified.userId !== existing.userId) { revoke(); setSessionError(GENERIC_RESTORE_ERROR); }
            else setActiveGrant(verified);
          } catch {
            if (attempt === epoch.current) { revoke(); setSessionError(GENERIC_RESTORE_ERROR); }
          } finally {
            if (attempt === epoch.current && mounted.current) setStatus('ready');
            // revoke() advances epoch, so finish loading even if refresh validation failed.
            else if (mounted.current && !grantRef.current) setStatus('ready');
          }
        });
      }
    });
    const listener = AppState.addEventListener('change', (next) => {
      if (!client) return;
      if (next === 'active') {
        client.auth.startAutoRefresh();
        // Validate previously authorized sessions after backgrounding; offline fails closed.
        if (grantRef.current) void checkRef.current();
      } else client.auth.stopAutoRefresh();
    });
    if (client && AppState.currentState === 'active') client.auth.startAutoRefresh();
    void checkRef.current();
    return () => {
      mounted.current = false;
      epoch.current += 1;
      clearInterval(interval);
      listener.remove();
      subscription?.data.subscription.unsubscribe();
      client?.auth.stopAutoRefresh();
    };
  }, [clientGeneration, revoke, setActiveGrant]);

  const beginVerification = useCallback((email: string, codeAlreadySent = true) => {
    revoke();
    const next = { email: normalizeEmail(email), resendAvailableAt: codeAlreadySent ? Date.now() + RESEND_COOLDOWN_MS : Date.now() };
    pendingRef.current = next;
    setPending(next);
  }, [revoke]);
  const markResendAttempt = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    const next = { ...current, resendAvailableAt: Math.max(current.resendAvailableAt, Date.now() + RESEND_COOLDOWN_MS) };
    pendingRef.current = next;
    setPending(next);
  }, []);

  const authorize = useCallback(async (email: string, token: string, expectedUserId?: string) => {
    const client = getSupabaseClient();
    if (!client || signingOut.current) return false;
    const attempt = epoch.current;
    try {
      const validated = await validateServerSession(client, email, token);
      if (!validated || (expectedUserId && expectedUserId !== validated.userId) ||
          attempt !== epoch.current || signingOut.current || !mounted.current) return false;
      setActiveGrant(validated);
      pendingRef.current = null;
      setPending(null);
      setStatus('ready');
      setSessionError('');
      setNow(Date.now());
      return true;
    } catch { return false; }
  }, [setActiveGrant]);

  const grantVerifiedOtp = useCallback(async (proof: VerificationProof) => {
    const current = pendingRef.current;
    if (!current || !proof.session) return false;
    const identity = verifiedIdentity(proof, current.email);
    if (!identity) return false;
    return authorize(current.email, proof.session.access_token, identity.userId);
  }, [authorize]);

  const grantVerifiedLogin = useCallback(async (email: string, token: string) => {
    return authorize(normalizeEmail(email), token);
  }, [authorize]);

  const discardUntrustedSession = useCallback(async () => {
    revoke();
    try { await getSupabaseClient()?.auth.signOut({ scope: 'local' }); } catch { /* local cleanup follows */ }
    await retireSupabaseClient();
    try { await clearSecureSession(); } catch {
      cleanupBlocked.current = true;
      setSessionError('Secure session cleanup failed. Sign-in is blocked until storage is available.');
      setStatus('error');
      return;
    }
    setClientGeneration((n) => n + 1);
  }, [revoke]);

  const signOut = useCallback(async () => {
    if (signingOut.current) return false;
    signingOut.current = true;
    const outgoing = grantRef.current?.userId ?? null;
    revoke(); // immediately close all protected routes before any await
    pendingRef.current = null;
    setPending(null);
    setSessionError('');
    setStatus('checking');
    const client = getSupabaseClient();
    // Remote failure must not stop local revocation/cleanup.
    try {
      if (client) {
        // Network operations cannot hold local credential cleanup indefinitely.
        await Promise.race([
          client.auth.signOut({ scope: 'global' }),
          new Promise<void>((resolve) => { setTimeout(resolve, 4000); })
        ]);
      }
    } catch { /* local cleanup below */ }
    await retireSupabaseClient();
    pendingCleanupAccount.current = outgoing;
    let cleaned = true;
    try {
      await clearSecureSession();
      await cleanupOutgoingAccount(outgoing);
      pendingCleanupAccount.current = null;
    } catch { cleaned = false; cleanupBlocked.current = true; }
    if (mounted.current) {
      setStatus(cleaned ? 'ready' : 'error');
      if (!cleaned) setSessionError('Secure local sign-out could not finish. Retry sign-out before using another account.');
    }
    signingOut.current = false;
    if (cleaned) setClientGeneration((n) => n + 1);
    return cleaned;
  }, [revoke]);

  const authorized = status === 'ready' && Boolean(grant && grant.expiresAtMs > now && !signingOut.current);
  const value = useMemo<AuthFlowContextValue>(() => ({
    pending, authorized, accountId: authorized ? grant?.userId ?? null : null, accountScope,
    checking: status === 'checking', sessionError,
    beginVerification, markResendAttempt, grantVerifiedOtp, grantVerifiedLogin, signOut, discardUntrustedSession, retryRestore,
    remainingResendSeconds: pending ? Math.max(0, Math.ceil((pending.resendAvailableAt - now) / 1000)) : 0
  }), [pending, authorized, grant, accountScope, status, sessionError, beginVerification, markResendAttempt,
    grantVerifiedOtp, grantVerifiedLogin, signOut, discardUntrustedSession, retryRestore, now]);
  return <AuthFlowContext.Provider value={value}>{children}</AuthFlowContext.Provider>;
}

export function useAuthFlow(): AuthFlowContextValue {
  const context = useContext(AuthFlowContext);
  if (!context) throw new Error('AuthFlowProvider is required.');
  return context;
}
