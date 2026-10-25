import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { registerAccountCleanup } from '../auth/accountCleanup';
import { notificationLifecycle, reconcileSavedNotifications } from './notificationLifecycleService';

/** Mounted with the auth provider: startup, foreground, logout and account switching all converge
 * through the same serialized engine. No scheduling is performed from notification taps. */
export function NotificationLifecycleCoordinator() {
  const { authorized, checking, sessionError, accountId, accountScope } = useAuthFlow();
  const scope = authorized && !checking && accountId ? `${accountScope}:${accountId}` : '';
  const current = useRef(scope);
  current.current = scope; // fence asynchronous callbacks as soon as a render detects lost authorization

  useEffect(() => {
    const unregister = registerAccountCleanup(async (outgoing) => {
      // Never fail credential cleanup due to an unavailable native notification API.
      try {
        const cleanup = notificationLifecycle.signOut(outgoing).catch(() => {});
        // Native APIs may stall while permissions/OS services change. Credential revocation
        // must not wait indefinitely; the serialized worker and next launch still retry.
        await Promise.race([cleanup, new Promise<void>((done) => setTimeout(done, 1800))]);
      } catch { /* retried at next startup */ }
    });
    return unregister;
  }, []);
  useEffect(() => {
    if (!accountId || !scope) {
      // A network-error/uncertain restore is not an explicit sign-out: preserve existing alerts.
      if (!checking && !sessionError) void notificationLifecycle.signedOutStartup().catch(() => {});
      return;
    }
    notificationLifecycle.activate(accountId);
    const thisScope = scope;
    void reconcileSavedNotifications(accountId, () => current.current === thisScope).catch(() => {});
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && current.current === thisScope)
        void reconcileSavedNotifications(accountId, () => current.current === thisScope).catch(() => {});
    });
    return () => listener.remove();
  }, [scope, accountId, checking, sessionError]);
  return null;
}
