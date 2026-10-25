import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';
import { AppScreen } from '../../components/AppScreen';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { checkNotificationPermission, enableNotificationPermission } from '../notifications/reminderNotificationService';
import { reconcileSavedNotifications } from '../notifications/notificationLifecycleService';
import { maySchedule, type PermissionInfo } from '../notifications/reminderNotificationModel';
import { listLeads } from '../leads/leadsApi';
import { listProjects } from '../projects/projectsApi';
import { LeadChoices } from '../leads/LeadChoices';
import { listReminders, reminderFailureMessage, setReminderStatus } from './remindersApi';
import { isDashboardOverdue } from '../dashboard/dashboardModel';
import { formattedLocalDate, KIND_LABELS, reminderGroup, sortReminders,
  type Reminder, type ReminderGroup, type ReminderStatus } from './reminderModel';

type State = { scope: string; loading: boolean; error: string; reminders: Reminder[];
  leadNames: Record<string, string>; projectNames: Record<string, string>; busyId: string | null };
const empty = (scope: string): State => ({ scope, loading: false, error: '', reminders: [],
  leadNames: {}, projectNames: {}, busyId: null });
const GROUPS: ReminderGroup[] = ['Overdue', 'Today', 'Upcoming'];
export function RemindersScreen() {
  const { accountId, accountScope } = useAuthFlow();
  const router = useRouter();
  const { view, dashboard } = useLocalSearchParams<{ view?: string; dashboard?: string }>();
  const scope = accountId ? `${accountScope}:${accountId}` : '';
  const [saved, setSaved] = useState<State>(() => empty(scope));
  const [tab, setTab] = useState<ReminderStatus>('open');
  const [focusedGroup, setFocusedGroup] = useState<ReminderGroup | null>(null);
  useEffect(() => { setFocusedGroup(null); setTab('open'); }, [scope]);
  useEffect(() => {
    if (dashboard && isDashboardOverdue(view)) { setTab('open'); setFocusedGroup('Overdue'); }
  }, [dashboard, view]);
  const [permission, setPermission] = useState<PermissionInfo | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const generation = useRef(0);
  const savingRef = useRef<string | null>(null);
  const liveScope = useRef(scope); liveScope.current = scope;
  const model = saved.scope === scope ? saved : empty(scope);
  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setSaved((prev) => ({ ...(prev.scope === scope ? prev : empty(scope)), loading: true, error: '' }));
    try {
      const [reminders, leads, projects] = await Promise.all([
        listReminders(accountId), listLeads(accountId), listProjects(accountId)
      ]);
      if (ticket !== generation.current || liveScope.current !== scope) return;
      // No OS permission prompt on screen focus: scheduling is best-effort for previously enabled devices.
      void reconcileSavedNotifications(accountId, () => liveScope.current === scope).then((result) => {
        if (ticket !== generation.current || liveScope.current !== scope) return;
        setPermission(result.permission);
        if (result.failed) setNotificationMessage(`${result.failed} local alert(s) could not be scheduled. Saved reminders are unchanged.`);
      }).catch(() => {
        if (ticket === generation.current && liveScope.current === scope)
          setNotificationMessage('Notifications unavailable. Saved reminders are unchanged.');
      });
      setSaved({ scope, loading: false, error: '', reminders, busyId: null,
        leadNames: Object.fromEntries(leads.map((lead) => [lead.id, lead.customer_name])),
        projectNames: Object.fromEntries(projects.map(({ project }) => [project.id, project.title])) });
    } catch (error) {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setSaved((prev) => ({ ...prev, loading: false, error: reminderFailureMessage(error) }));
    }
  }, [accountId, scope]);
  useFocusEffect(useCallback(() => {
    setNotificationMessage('');
    void checkNotificationPermission().then((info) => {
      if (liveScope.current === scope) setPermission(info);
    }).catch(() => {});
    void reload();
    return () => { generation.current++; };
  }, [reload]));
  const markDone = async (reminder: Reminder) => {
    if (!accountId || savingRef.current || reminder.status !== 'open') return;
    savingRef.current = reminder.id;
    const ticket = generation.current;
    setSaved((prev) => prev.scope === scope ? { ...prev, busyId: reminder.id, error: '' } : prev);
    try {
      const next = await setReminderStatus(accountId, reminder, 'completed');
      if (ticket !== generation.current || liveScope.current !== scope) return;
      // Explicit completion remains saved even if the OS cannot cancel its alert immediately.
      void reconcileSavedNotifications(accountId, () => liveScope.current === scope).then((report) => {
        if (liveScope.current === scope && report.failed)
          setNotificationMessage('Saved reminder completed. Some local alerts need a retry.');
      }).catch(() => {
        if (liveScope.current === scope) setNotificationMessage('Saved reminder completed. Local alerts need a retry.');
      });
      setSaved((prev) => prev.scope === scope ? { ...prev, busyId: null,
        reminders: prev.reminders.map((item) => item.id === next.id ? next : item) } : prev);
    } catch (error) {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setSaved((prev) => ({ ...prev, busyId: null,
        error: `${reminderFailureMessage(error)} Refresh and retry.` }));
    } finally { savingRef.current = null; }
  };
  const enableAlerts = async () => {
    if (!accountId || notificationBusy) return;
    const targetScope = scope;
    setNotificationBusy(true); setNotificationMessage('');
    try {
      const next = await enableNotificationPermission();
      if (liveScope.current !== targetScope) return;
      setPermission(next);
      if (maySchedule(next.state)) {
        const result = await reconcileSavedNotifications(accountId, () => liveScope.current === targetScope);
        if (liveScope.current !== targetScope) return;
        setNotificationMessage(result.failed ?
          `${result.failed} alert(s) could not be scheduled. Saved reminders are unchanged.` :
          'Local alerts enabled. Eligible future Open reminders have been reconciled on this device.');
      } else setNotificationMessage('Notifications are optional. Reminders remain saved and usable.');
    } catch { if (liveScope.current === targetScope) setNotificationMessage('Could not enable local alerts. Saved reminders are unchanged.'); }
    finally { if (liveScope.current === targetScope) setNotificationBusy(false); }
  };
  const rows = sortReminders(model.reminders.filter((reminder) => reminder.status === tab));
  const render = (reminder: Reminder) => <AppCard key={reminder.id}>
    <AppText variant="section">{reminder.title}</AppText>
    <AppText>{KIND_LABELS[reminder.kind]} · {model.leadNames[reminder.lead_id] ?? 'Customer unavailable'}</AppText>
    <AppText>Project: {reminder.project_id ? (model.projectNames[reminder.project_id] ?? 'Project unavailable') : 'Lead only'}</AppText>
    <AppText>Due (local): {formattedLocalDate(reminder.due_at)}</AppText>
    {reminder.status === 'completed' && reminder.completed_at ?
      <AppText>Completed (local): {formattedLocalDate(reminder.completed_at)}</AppText> : null}
    <AppButton label="View reminder" variant="secondary"
      onPress={() => router.push({ pathname: '/reminder/[id]', params: { id: reminder.id } })} />
    {reminder.status === 'open' ? <View style={styles.actions}>
      <AppButton label={model.busyId === reminder.id ? 'Saving…' : 'Mark done'}
        disabled={model.busyId !== null || model.loading}
        onPress={() => void markDone(reminder)} />
      <AppButton label="Edit / Reschedule" variant="secondary" disabled={model.busyId !== null}
        onPress={() => router.push({ pathname: '/reminder/edit/[id]', params: { id: reminder.id } })} />
    </View> : null}
  </AppCard>;
  const now = new Date();
  return <AppScreen>
    <AppText variant="title">Reminders</AppText>
    <AppButton label="New Reminder" onPress={() => router.push('/reminder/new')} />
    <AppCard>
      <AppText variant="section">Device notifications (optional)</AppText>
      <AppText muted>{permission ? (maySchedule(permission.state) ?
        'Enabled on this device. Future Open reminders can trigger generic one-time alerts.' :
        permission.state === 'prompt' ? 'Enable alerts to be notified when reminders are due.' :
        'Alerts are unavailable or disabled. Saved reminders still work normally.') :
        'Notification permission is checked without prompting when you open Reminders.'}</AppText>
      {notificationMessage ? <AppText accessibilityRole="alert">{notificationMessage}</AppText> : null}
      {permission?.state === 'unavailable' ?
        <AppButton label="Retry notification availability" variant="secondary"
          onPress={() => void reconcileSavedNotifications(accountId!, () => liveScope.current === scope)
            .then((result) => { if (liveScope.current === scope) { setPermission(result.permission);
              if (result.failed) setNotificationMessage('Some local alerts still need repair.'); } })
            .catch(() => setNotificationMessage('Unable to refresh device alerts.'))} /> : null}
      {permission && !maySchedule(permission.state) && permission.state !== 'unavailable' ?
        permission.canAskAgain ? <AppButton label={notificationBusy ? 'Checking…' : 'Enable local alerts'}
          disabled={notificationBusy} onPress={() => void enableAlerts()} /> :
        <AppButton label="Open device notification settings" variant="secondary"
          onPress={() => void Linking.openSettings().catch(() => setNotificationMessage('Open device Settings and enable SiteQuote notifications.'))} /> : null}
    </AppCard>
    <LeadChoices label="Reminder status" options={['open', 'completed'] as const}
      text={(value) => value === 'open' ? 'Open' : 'Completed'} selected={tab} onSelect={(value) => { setTab(value); setFocusedGroup(null); }} />
    {tab === 'open' && focusedGroup ? <View style={styles.group}>
      <AppText variant="section">Showing {focusedGroup} reminders</AppText>
      <AppButton variant="secondary" label="Show all Open groups" onPress={() => setFocusedGroup(null)} />
    </View> : null}
    {model.loading ? <AppText>Refreshing reminders…</AppText> : null}
    {model.error ? <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText> : null}
    {model.error ? <AppButton label="Retry" variant="secondary" onPress={() => void reload()} /> : null}
    {tab === 'open' ? (focusedGroup ? [focusedGroup] : GROUPS).map((group) => {
      const entries = rows.filter((reminder) => reminderGroup(reminder.due_at, now) === group);
      return <View key={group} style={styles.group}>
        <AppText variant="section" style={group === 'Overdue' ? styles.overdue : undefined}>{group} ({entries.length})</AppText>
        {!model.loading && !model.error && !entries.length ?
          <AppText muted>No {group.toLowerCase()} reminders.</AppText> : null}
        {entries.map(render)}
      </View>;
    }) : <View style={styles.group}>
      <AppText variant="section">Completed ({rows.length})</AppText>
      {!model.loading && !model.error && !rows.length ? <AppText muted>No completed reminders yet.</AppText> : null}
      {rows.map(render)}
    </View>}
  </AppScreen>;
}
const styles = StyleSheet.create({ group: { gap: spacing.sm }, actions: { gap: spacing.xs },
  overdue: { color: colors.dangerText }, error: { color: colors.dangerText } });
