import { useEffect, useRef, useState } from 'react';
import { useRootNavigationState, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { loadReminder } from '../reminders/remindersApi';
import { authorizeReminderTap, parseReminderTap } from './reminderNotificationModel';
import { Notifications } from './reminderNotificationService';

type Intent = { key: string; reminderId: string };
/** Mounted inside the root AuthFlowProvider, outside protected screens.
 * Never navigate from the notification payload alone: verify current account via owner-scoped Supabase read.
 */
export function NotificationTapCoordinator() {
  const router = useRouter();
  const nav = useRootNavigationState();
  const { authorized, checking, accountId, accountScope } = useAuthFlow();
  const scope = authorized && !checking && accountId ? `${accountScope}:${accountId}` : '';
  const currentScope = useRef(scope); currentScope.current = scope;
  const [intent, setIntent] = useState<Intent | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    let mounted = true;
    const accept = (response: import('expo-notifications').NotificationResponse | null) => {
      if (!mounted || !response) return;
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      // Only default tap is supported. Other notification actions are never interpreted as completion.
      if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        const reminderId = parseReminderTap(response.notification.request.content.data);
        if (reminderId) setIntent({ key, reminderId });
      }
      // Clearing avoids replay after another app launch; intent survives until verified login in RAM.
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const listener = Notifications.addNotificationResponseReceivedListener(accept);
    void Notifications.getLastNotificationResponseAsync().then(accept).catch(() => {});
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (!intent || !scope || !accountId || !nav?.key) return;
    let cancelled = false;
    const checkedScope = scope;
    void (async () => {
      try {
        // loadReminder verifies the *current* signed-in account and uses owner-filtered RLS.
        const reminder = await authorizeReminderTap(accountId, intent.reminderId, loadReminder,
          () => !cancelled && currentScope.current === checkedScope);
        if (cancelled || currentScope.current !== checkedScope) return;
        if (!reminder) throw new Error('Unauthorized or missing reminder');
        setIntent((current) => current?.key === intent.key ? null : current);
        router.push({ pathname: '/reminder/[id]', params: { id: reminder.id } });
      } catch {
        if (cancelled || currentScope.current !== checkedScope) return;
        setIntent((current) => current?.key === intent.key ? null : current);
        Alert.alert('Reminder unavailable', 'Unable to open this reminder. It may have been deleted, may belong to another account, or your connection may be unavailable.');
        router.replace('/(tabs)/reminders');
      }
    })();
    return () => { cancelled = true; };
  }, [intent, scope, accountId, nav?.key, router]);
  return null;
}
