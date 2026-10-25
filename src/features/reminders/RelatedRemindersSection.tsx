import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppText } from '../../components/AppText';
import { listReminders, reminderFailureMessage } from './remindersApi';
import { formattedLocalDate, type Reminder } from './reminderModel';

export function RelatedRemindersSection({ accountId, accountScope, leadId, projectId }: {
  accountId: string; accountScope: number; leadId: string; projectId?: string;
}) {
  const router = useRouter();
  const scope = `${accountScope}:${accountId}:${leadId}:${projectId ?? ''}`;
  const [state, setState] = useState<{ scope: string; reminders: Reminder[]; error: string }>(
    { scope, reminders: [], error: '' });
  const active = state.scope === scope ? state : { scope, reminders: [], error: '' };
  const generation = useRef(0);
  const currentScope = useRef(scope); currentScope.current = scope;
  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const reminders = await listReminders(accountId, projectId ? { projectId } : { leadId });
      if (ticket === generation.current && currentScope.current === scope)
        setState({ scope, reminders, error: '' });
    } catch (error) {
      if (ticket === generation.current && currentScope.current === scope)
        setState({ scope, reminders: [], error: reminderFailureMessage(error) });
    }
  }, [accountId, leadId, projectId, scope]);
  useFocusEffect(useCallback(() => { void reload(); return () => { generation.current++; }; }, [reload]));
  return <AppCard>
    <AppText variant="section">Reminders</AppText>
    <AppButton label="Add Reminder" onPress={() => router.push({ pathname: '/reminder/new',
      params: { leadId, ...(projectId ? { projectId } : {}) } })} />
    {active.error ? <AppText accessibilityRole="alert">{active.error}</AppText> : null}
    {active.error ? <AppButton label="Retry reminders" variant="secondary" onPress={() => void reload()} /> : null}
    {active.reminders.length === 0 && !active.error ? <AppText muted>No reminders associated yet.</AppText> : null}
    {active.reminders.map((reminder) => <AppButton key={reminder.id} variant="secondary"
      label={`${reminder.status === 'completed' ? 'Completed: ' : ''}${reminder.title} — ${formattedLocalDate(reminder.due_at)}`}
      onPress={() => router.push({ pathname: '/reminder/[id]', params: { id: reminder.id } })} />)}
  </AppCard>;
}
