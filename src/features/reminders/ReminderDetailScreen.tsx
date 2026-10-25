import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { AppScreen } from '../../components/AppScreen';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { AppButton } from '../../components/AppButton';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { reconcileSavedNotifications } from '../notifications/notificationLifecycleService';
import { loadLead } from '../leads/leadsApi';
import { STAGE_LABELS, type ContactStage } from '../leads/leadModel';
import { deleteReminder, listReminderHistory, loadReminder, reminderFailureMessage, setReminderStatus } from './remindersApi';
import { formattedLocalDate, KIND_LABELS, sortCompletionHistory, type Reminder, type ReminderCompletionEvent } from './reminderModel';

type State = { scope: string; loading: boolean; reminder: Reminder | null; busy: boolean; error: string;
  history: ReminderCompletionEvent[]; historyLoading: boolean; historyError: string;
  contactStage: ContactStage | null; stageLoading: boolean; stageError: string };
const empty = (scope: string): State => ({ scope, loading: false, reminder: null, busy: false,
  error: '', history: [], historyLoading: false, historyError: '',
  contactStage: null, stageLoading: false, stageError: '' });
export function ReminderDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id}` : '';
  const [stored, setStored] = useState<State>(() => empty(scope));
  const generation = useRef(0);
  const busyRef = useRef(false);
  const liveScope = useRef(scope); liveScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  const refreshHistory = useCallback(async (ticket: number) => {
    if (!accountId) return;
    setStored((prev) => prev.scope === scope ? { ...prev, historyLoading: true, historyError: '' } : prev);
    try {
      const history = await listReminderHistory(accountId, id);
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => prev.scope === scope ? { ...prev, history, historyLoading: false } : prev);
    } catch (error) {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => prev.scope === scope ? { ...prev, historyLoading: false,
        historyError: reminderFailureMessage(error) } : prev);
    }
  }, [accountId, id, scope]);
  // Only a fresh, owner-checked read can show a stage after completion.
  // Failure here is informational: a successful reminder save stays saved.
  const refreshContactStage = useCallback(async (ticket: number, leadId: string) => {
    if (!accountId) return;
    setStored((prev) => prev.scope === scope ? { ...prev, stageLoading: true, stageError: '' } : prev);
    try {
      const lead = await loadLead(accountId, leadId);
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => prev.scope === scope ? { ...prev, contactStage: lead.contact_stage,
        stageLoading: false, stageError: '' } : prev);
    } catch {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => prev.scope === scope ? { ...prev, contactStage: null,
        stageLoading: false, stageError: 'Could not refresh the customer stage. Open the customer to retry.' } : prev);
    }
  }, [accountId, scope]);
  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setStored((prev) => ({ ...(prev.scope === scope ? prev : empty(scope)), loading: true, error: '', contactStage: null, stageLoading: true, stageError: '' }));
    try {
      const reminder = await loadReminder(accountId, id);
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => ({ ...(prev.scope === scope ? prev : empty(scope)),
        loading: false, busy: false, error: '', reminder }));
      await Promise.all([refreshHistory(ticket), refreshContactStage(ticket, reminder.lead_id)]);
    } catch (error) {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => ({ ...prev, loading: false, stageLoading: false, error: reminderFailureMessage(error) }));
    }
  }, [accountId, id, scope, refreshHistory, refreshContactStage]);
  useFocusEffect(useCallback(() => {
    busyRef.current = false;
    void reload();
    return () => { generation.current++; };
  }, [reload]));
  const doAction = async (operation: 'toggle' | 'delete') => {
    if (!accountId || !model.reminder || busyRef.current) return;
    busyRef.current = true;
    const ticket = generation.current;
    setStored((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      if (operation === 'delete') {
        await deleteReminder(accountId, model.reminder);
        void reconcileSavedNotifications(accountId, () => liveScope.current === scope)
          .then((report) => { if (liveScope.current === scope && report.failed)
            Alert.alert('Reminder deleted', 'The saved reminder was deleted. A local alert may need cleanup on the next refresh.'); })
          .catch(() => { if (liveScope.current === scope)
            Alert.alert('Reminder deleted', 'The saved reminder was deleted. Local alert cleanup will retry.'); });
        if (ticket === generation.current && liveScope.current === scope) router.replace('/(tabs)/reminders');
      } else {
        const next = await setReminderStatus(accountId, model.reminder,
          model.reminder.status === 'open' ? 'completed' : 'open');
        void reconcileSavedNotifications(accountId, () => liveScope.current === scope)
          .then((report) => { if (liveScope.current === scope && report.failed)
            Alert.alert('Reminder saved', 'The reminder was saved. Device notification repair will retry.'); })
          .catch(() => { if (liveScope.current === scope)
            Alert.alert('Reminder saved', 'The reminder was saved. Device alerts will retry.'); });
        if (ticket === generation.current && liveScope.current === scope) {
          setStored((prev) => ({ ...prev, reminder: next, busy: false, contactStage: null, stageLoading: true }));
          await Promise.all([refreshHistory(ticket), refreshContactStage(ticket, next.lead_id)]);
        }
      }
    } catch (error) {
      if (ticket === generation.current && liveScope.current === scope)
        setStored((prev) => ({ ...prev, busy: false, error: `${reminderFailureMessage(error)} Refresh before retrying.` }));
    } finally { busyRef.current = false; }
  };
  return <AppScreen>
    <AppText variant="title">Reminder Detail</AppText>
    <AppButton label="Back to Reminders" variant="secondary" onPress={() => router.push('/(tabs)/reminders')} />
    {model.loading ? <AppText>Loading reminder…</AppText> : null}
    {model.error ? <View style={styles.group}>
      <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
      <AppButton label="Refresh" variant="secondary" onPress={() => void reload()} />
    </View> : null}
    {model.reminder ? <>
      <AppCard>
        <AppText variant="section">{model.reminder.title}</AppText>
        <AppText>Type: {KIND_LABELS[model.reminder.kind]}</AppText>
        <AppText>Status: {model.reminder.status === 'open' ? 'Open' : 'Completed'}</AppText>
        <AppText>Due (local): {formattedLocalDate(model.reminder.due_at)}</AppText>
        {model.reminder.completed_at ? <AppText>Completed: {formattedLocalDate(model.reminder.completed_at)}</AppText> : null}
        <AppText>Note: {model.reminder.note || 'None'}</AppText>
        {model.stageLoading ? <AppText muted>Refreshing customer stage…</AppText> : null}
        {model.contactStage ? <AppText>Customer contact stage: {STAGE_LABELS[model.contactStage]}</AppText> : null}
        {model.stageError ? <AppText accessibilityRole="alert" style={styles.error}>{model.stageError}</AppText> : null}
        <AppButton label="View customer and activity history" variant="secondary"
          onPress={() => router.push({ pathname: '/lead/[id]', params: { id: model.reminder!.lead_id } })} />
        <AppButton label="Edit / Reschedule" variant="secondary" disabled={model.busy}
          onPress={() => router.push({ pathname: '/reminder/edit/[id]', params: { id } })} />
        <AppButton label={model.busy ? 'Saving…' : model.reminder.status === 'open' ? 'Mark done' : 'Reopen reminder'}
          disabled={model.busy} onPress={() => void doAction('toggle')} />
        <AppButton label="Delete reminder" variant="secondary" disabled={model.busy}
          onPress={() => Alert.alert('Delete reminder?',
            'This permanently removes the reminder and its completion/reopen history.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void doAction('delete') }
            ])} />
      </AppCard>
      <AppCard>
        <AppText variant="section">Completion history</AppText>
        {model.historyLoading ? <AppText>Loading history…</AppText> : null}
        {model.historyError ? <AppText accessibilityRole="alert" style={styles.error}>{model.historyError}</AppText> : null}
        {model.historyError ? <AppButton label="Retry history" variant="secondary"
          onPress={() => void refreshHistory(generation.current)} /> : null}
        {!model.historyLoading && !model.historyError && !model.history.length ?
          <AppText muted>No completion or reopening events yet.</AppText> : null}
        {sortCompletionHistory(model.history).map((event) => <View key={event.id} style={styles.event}>
          <AppText>{event.event_type === 'completed' ? 'Marked done' : 'Reopened'} — {formattedLocalDate(event.occurred_at)}</AppText>
        </View>)}
      </AppCard>
    </> : null}
  </AppScreen>;
}
const styles = StyleSheet.create({ error: { color: colors.dangerText }, group: { gap: spacing.xs }, event: { paddingVertical: spacing.xs } });
