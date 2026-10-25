import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Alert, View, StyleSheet, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { AppScreen } from '../../components/AppScreen';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppField } from '../../components/AppField';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { reconcileSavedNotifications } from '../notifications/notificationLifecycleService';
import { listLeads } from '../leads/leadsApi';
import type { Lead } from '../leads/leadModel';
import { listProjects } from '../projects/projectsApi';
import { listPreparedQuotes } from '../estimates/preparedQuotesApi';
import { FOLLOWUP_TITLE, suggestFollowup, validPrefill, type FollowupPrefill } from './sentQuoteFollowup';
import type { ProjectWithLead } from '../projects/projectModel';
import { LeadChoices } from '../leads/LeadChoices';
import { createReminder, loadReminder, reminderFailureMessage, updateReminder } from './remindersApi';
import { changeLocalDatePart, defaultDueDate, formattedLocalDate, KIND_LABELS,
  KIND_OPTIONS, localTimezone, validateReminder, type Reminder, type ReminderDraft } from './reminderModel';

type Data = { scope: string; loading: boolean; saving: boolean; error: string; validation: string;
  leads: Lead[]; projects: ProjectWithLead[]; original: Reminder | null; draft: ReminderDraft; ready: boolean;
  dueChoiceRequired: boolean; suggestionInfo: string };
const initialDraft = (leadId = '', projectId: string | null = null): ReminderDraft => ({
  leadId, projectId, kind: 'follow_up', title: '', note: '', dueDate: defaultDueDate()
});
const empty = (scope: string, leadId: string, projectId: string | null): Data => ({
  scope, loading: false, saving: false, error: '', validation: '', leads: [], projects: [],
  original: null, draft: initialDraft(leadId, projectId), ready: false, dueChoiceRequired: false, suggestionInfo: ''
});
export function ReminderFormScreen({ id, leadId = '', projectId = '', followup }:
  { id?: string; leadId?: string; projectId?: string; followup?: FollowupPrefill }) {
  const { accountId, accountScope } = useAuthFlow();
  const router = useRouter();
  const scope = accountId ? `${accountScope}:${accountId}:${id || 'new'}:${followup?.sourceQuoteId ?? ''}` : '';
  const [stored, setStored] = useState<Data>(() => empty(scope, leadId, projectId || null));
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const createRequestKey = useRef<{ scope: string; key: string } | null>(null);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope, leadId, projectId || null);
  const load = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope, leadId, projectId || null)), loading: true, error: '' }));
    try {
      if (followup && (id || !validPrefill(followup, accountId) ||
        followup.leadId !== leadId || followup.projectId !== projectId))
        throw new Error('Follow-up link belongs to a different account or is invalid.');
      const [leads, projects, original, quoted] = await Promise.all([
        listLeads(accountId), listProjects(accountId), id ? loadReminder(accountId, id) : Promise.resolve(null),
        followup ? listPreparedQuotes(accountId, followup.projectId) : Promise.resolve(null)
      ]);
      if (followup && !quoted?.some((q) => q.id === followup.sourceQuoteId &&
        q.project_id === followup.projectId && q.user_id === accountId && q.status === 'sent' &&
        Date.parse(q.sent_at ?? '') === Date.parse(followup.sentAt)))
        throw new Error('Sent quote unavailable for this account/project.');
      if (ticket !== generation.current || liveScope.current !== scope) return;
      const chosenLead = original?.lead_id ?? leadId ?? '';
      const chosenProject = original?.project_id ?? projectId ?? null;
      if (chosenLead && !leads.some((item) => item.id === chosenLead)) throw new Error('Associated lead missing');
      if (chosenProject && !projects.some(({ project }) => project.id === chosenProject && project.lead_id === chosenLead))
        throw new Error('Associated project missing or unmatched');
      let dueChoiceRequired = false;
      let suggestionInfo = '';
      let draft = initialDraft(chosenLead, chosenProject);
      if (followup) {
        draft = { ...draft, kind: 'follow_up', title: FOLLOWUP_TITLE };
        try {
          const suggestion = suggestFollowup(followup.sentAt);
          draft.dueDate = suggestion.due;
          if (suggestion.adjusted) suggestionInfo = 'Suggested time was adjusted to the first valid local time after a daylight-saving gap. Review before saving.';
          if (suggestion.ambiguous) suggestionInfo = 'This time occurs twice during the daylight-saving fallback. The earlier occurrence is selected. Review the time before saving.';
        } catch {
          dueChoiceRequired = true;
          suggestionInfo = 'The original +3-day suggestion is no longer valid. Choose a new future date/time before saving.';
        }
      }
      setStored({ scope, loading: false, saving: false, error: '', validation: '', leads, projects, original,
        draft: original ? { leadId: original.lead_id, projectId: original.project_id,
          kind: original.kind, title: original.title, note: original.note ?? '', dueDate: new Date(original.due_at) }
          : draft, ready: true, dueChoiceRequired, suggestionInfo });
    } catch (error) {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((previous) => ({ ...previous, loading: false, ready: false, error: followup ?
        error instanceof Error ? error.message : 'Could not validate Sent quote follow-up.' : reminderFailureMessage(error) }));
    }
  }, [accountId, id, leadId, projectId, followup?.sourceQuoteId, followup?.sourceOwnerId, followup?.sentAt, scope]);
  useFocusEffect(useCallback(() => {
    busy.current = false;
    void load();
    return () => { generation.current++; setPicker(null); };
  }, [load]));
  const setDraft = (change: Partial<ReminderDraft>) => setStored((previous) => previous.scope === scope ?
    { ...previous, draft: { ...previous.draft, ...change }, validation: '' } : previous);
  const choose = (event: DateTimePickerEvent, selected?: Date) => {
    const currentPart = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (event.type !== 'set' || !selected || !currentPart) return;
    const next = changeLocalDatePart(model.draft.dueDate, selected, currentPart);
    if (!Number.isFinite(next.getTime())) {
      setStored((previous) => ({ ...previous, validation: 'This local time does not exist due to a timezone change. Choose another time.' }));
      return;
    }
    setStored((previous) => previous.scope === scope ? { ...previous,
      draft: { ...previous.draft, dueDate: next }, validation: '', dueChoiceRequired: false } : previous);
  };
  const save = async () => {
    if (!accountId || !model.ready || model.saving || busy.current) return;
    if (model.dueChoiceRequired) {
      setStored((prev) => ({ ...prev, validation: 'Choose a new future date/time before saving.' })); return;
    }
    const validated = validateReminder(model.draft, new Date(), model.original?.due_at);
    if (!validated.ok) { setStored((prev) => ({ ...prev, validation: validated.error })); return; }
    if (!model.leads.some((lead) => lead.id === model.draft.leadId) ||
      model.draft.projectId && !model.projects.some(({ project }) =>
        project.id === model.draft.projectId && project.lead_id === model.draft.leadId)) {
      setStored((prev) => ({ ...prev, validation: 'Choose a project belonging to the selected lead.' }));
      return;
    }
    busy.current = true;
    if (!model.original && createRequestKey.current?.scope !== scope)
      createRequestKey.current = { scope, key: Crypto.randomUUID() };
    const ticket = generation.current;
    setStored((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const result = model.original ? await updateReminder(accountId, model.original, model.draft)
        : await createReminder(accountId, model.draft, createRequestKey.current?.key);
      if (ticket !== generation.current || liveScope.current !== scope) return;
      // Re-read authoritative saved reminders; notification failures never undo the saved form.
      void reconcileSavedNotifications(accountId, () => liveScope.current === scope)
        .then((outcome) => {
          if (liveScope.current === scope && outcome.failed) Alert.alert('Reminder saved',
            'Your reminder was saved, but the local alert needs repair. Open Reminders to retry.');
        }).catch(() => { if (liveScope.current === scope) Alert.alert('Reminder saved',
          'Your reminder was saved. Local notification reconciliation is unavailable.'); });
      router.replace({ pathname: '/reminder/[id]', params: { id: result.id } });
    } catch (error) {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored((prev) => ({ ...prev, saving: false, error: model.original ? reminderFailureMessage(error) :
        'Could not confirm whether the reminder was saved. Retry with the same values (the request ID prevents duplicates), or check Reminders when connected.' }));
    } finally { busy.current = false; }
  };
  const projectOptions = model.projects.filter(({ project }) => project.lead_id === model.draft.leadId);
  return <AppScreen>
    <AppText variant="title">{id ? 'Edit Reminder' : 'New Reminder'}</AppText>
    <AppButton variant="secondary" label="Back" onPress={() => router.back()} />
    {model.loading ? <AppText>Loading reminder options…</AppText> : null}
    {model.error ? <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText> : null}
    {model.error && !model.ready ? <AppButton variant="secondary" label="Retry" onPress={() => void load()} /> : null}
    {model.ready ? <AppCard>
      {followup ? <><AppText variant="section">Sent quote follow-up</AppText>
        <AppText muted>Optional reminder. Nothing is created until you press Save reminder. You can edit every field.</AppText>
        {model.suggestionInfo ? <AppText accessibilityRole="alert" style={styles.error}>{model.suggestionInfo}</AppText> : null}</> : null}
      {model.leads.length === 0 ? <AppText>First create a lead in the Leads tab.</AppText> : <>
        <AppText variant="section">Customer / Lead</AppText>
        <View style={styles.choices}>{model.leads.map((lead) => <AppButton key={lead.id}
          label={`${model.draft.leadId === lead.id ? '✓ ' : ''}${lead.customer_name}`}
          variant={model.draft.leadId === lead.id ? 'primary' : 'secondary'}
          disabled={model.saving} onPress={() => setDraft({ leadId: lead.id, projectId: null })} />)}</View>
        <AppText variant="section">Project (optional)</AppText>
        <View style={styles.choices}>
          <AppButton label={`${!model.draft.projectId ? '✓ ' : ''}Lead only`}
            variant={!model.draft.projectId ? 'primary' : 'secondary'}
            onPress={() => setDraft({ projectId: null })} />
          {projectOptions.map(({ project }) => <AppButton key={project.id} label={`${model.draft.projectId === project.id ? '✓ ' : ''}${project.title}`}
            variant={model.draft.projectId === project.id ? 'primary' : 'secondary'}
            onPress={() => setDraft({ projectId: project.id })} />)}
        </View>
        <LeadChoices label="Reminder type" options={KIND_OPTIONS} text={(value) => KIND_LABELS[value]}
          selected={model.draft.kind} disabled={model.saving} onSelect={(kind) => setDraft({ kind })} />
        <AppField label="Title" value={model.draft.title} maxLength={200}
          editable={!model.saving} onChangeText={(title) => setDraft({ title })} />
        <AppField label="Note (optional)" value={model.draft.note} multiline maxLength={5000}
          style={{ minHeight: 90, textAlignVertical: 'top' }} editable={!model.saving}
          onChangeText={(note) => setDraft({ note })} />
        <AppText variant="section">Due date and time</AppText>
        <AppText>{formattedLocalDate(model.draft.dueDate)}</AppText>
        <AppText muted>Device timezone: {localTimezone()}. Saved as a UTC instant.</AppText>
        <View style={styles.choices}>
          <AppButton label="Choose date" variant="secondary" onPress={() => setPicker('date')} />
          <AppButton label="Choose time" variant="secondary" onPress={() => setPicker('time')} />
        </View>
        {picker ? <>
          <DateTimePicker value={Number.isFinite(model.draft.dueDate.getTime()) ? model.draft.dueDate : defaultDueDate()}
            mode={picker} is24Hour onChange={choose} />
          {Platform.OS === 'ios' ? <AppButton variant="secondary" label="Done choosing" onPress={() => setPicker(null)} /> : null}
        </> : null}
        {id ? <AppText muted>Current status: {model.original?.status === 'completed' ? 'Completed' : 'Open'}. Change status from Reminder Detail.</AppText> : null}
        {model.validation ? <AppText accessibilityRole="alert" style={styles.error}>{model.validation}</AppText> : null}
        <AppButton label={model.saving ? 'Saving…' : 'Save reminder'} disabled={model.saving || !model.draft.leadId}
          onPress={() => void save()} />
      </>}
    </AppCard> : null}
  </AppScreen>;
}
const styles = StyleSheet.create({ error: { color: colors.dangerText }, choices: { gap: spacing.xs } });
