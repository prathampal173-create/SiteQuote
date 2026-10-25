import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { LeadChoices } from './LeadChoices';
import { formatSiteVisitStageActivity } from './siteVisitStageActivity';
import { LeadProjectsSection } from '../projects/LeadProjectsSection';
import { RelatedRemindersSection } from '../reminders/RelatedRemindersSection';
import { formatDecisionHistory } from '../projects/projectDecisionModel';
import { addManualHistory, leadFailureMessage, listLeadHistory, loadLead, updateLeadStage } from './leadsApi';
import { chronologicalHistory, STAGES, STAGE_LABELS, type Activity, type ContactStage, type Lead } from './leadModel';

type Model = {
  scope: string; lead: Lead | null; history: Activity[]; loading: boolean; loaded: boolean;
  error: string; stageError: string; noteError: string; stageSaving: boolean; noteSaving: boolean;
  note: string; success: string;
};
const empty = (scope: string): Model => ({ scope, lead: null, history: [], loaded: false,
  loading: false, error: '', stageError: '', noteError: '', stageSaving: false,
  noteSaving: false, note: '', success: '' });

export function LeadDetailScreen({ id, saved }: { id: string; saved?: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const generation = useRef(0);
  const busyStage = useRef(false);
  const busyNote = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const myRequest = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const [lead, history] = await Promise.all([loadLead(accountId, id), listLeadHistory(accountId, id)]);
      if (generation.current !== myRequest || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), lead, history,
        loaded: true, loading: false, error: '', success: saved === 'created' ? 'Lead created.' :
          saved === 'updated' ? 'Lead updated.' : previous.success }));
    } catch (error) {
      if (generation.current !== myRequest || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)),
        loading: false, error: leadFailureMessage(error) }));
    }
  }, [accountId, id, scope, saved]);

  useFocusEffect(useCallback(() => {
    setStored(empty(scope));
    busyStage.current = false;
    busyNote.current = false;
    void reload();
    return () => { generation.current++; };
  }, [reload, scope]));

  const changeStage = async (stage: ContactStage) => {
    if (!accountId || !model.lead || busyStage.current || busyNote.current || model.loading || stage === model.lead.contact_stage) return;
    const myScope = scope;
    const myGeneration = generation.current;
    busyStage.current = true;
    setStored((previous) => ({ ...previous, stageSaving: true, stageError: '', success: '' }));
    try {
      const lead = await updateLeadStage(accountId, id, stage);
      if (generation.current !== myGeneration || currentScope.current !== myScope) return;
      setStored((previous) => ({ ...previous, lead, stageSaving: false, success: 'Contact stage saved.' }));
    } catch (error) {
      if (generation.current !== myGeneration || currentScope.current !== myScope) return;
      setStored((previous) => ({ ...previous, stageSaving: false, stageError: leadFailureMessage(error) }));
    } finally {
      if (generation.current === myGeneration && currentScope.current === myScope) busyStage.current = false;
    }
  };

  const saveNote = async () => {
    if (!accountId || !model.lead || busyNote.current || busyStage.current || model.noteSaving) return;
    const note = model.note.trim();
    if (!note || note.length > 5000) {
      setStored((previous) => ({ ...previous, noteError: 'Enter a history note between 1 and 5000 characters.' }));
      return;
    }
    const myScope = scope;
    const myGeneration = generation.current;
    busyNote.current = true;
    setStored((previous) => ({ ...previous, noteSaving: true, noteError: '', success: '' }));
    try {
      const activity = await addManualHistory(accountId, id, note);
      if (generation.current !== myGeneration || currentScope.current !== myScope) return;
      setStored((previous) => ({ ...previous, history: chronologicalHistory([...previous.history, activity]),
        note: '', noteSaving: false, noteError: '', success: 'History note saved.' }));
    } catch (error) {
      if (generation.current !== myGeneration || currentScope.current !== myScope) return;
      setStored((previous) => ({ ...previous, noteSaving: false, noteError: leadFailureMessage(error) }));
    } finally {
      if (generation.current === myGeneration && currentScope.current === myScope) busyNote.current = false;
    }
  };

  return (
    <AppScreen>
      <AppText variant="title">Lead Detail</AppText>
      <AppButton variant="secondary" label="Back to Leads" onPress={() => router.back()} />
      {model.loading ? <AppText accessibilityRole="alert">Loading lead details…</AppText> : null}
      {model.error ? <View style={styles.group}>
        <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
        <AppButton label="Retry loading lead details" variant="secondary" onPress={() => void reload()} />
      </View> : null}
      {model.success ? <AppText accessibilityRole="alert" style={styles.success}>{model.success}</AppText> : null}
      {model.lead ? <>
        <AppCard>
          <AppText variant="section">{model.lead.customer_name}</AppText>
          <AppText>Phone: {model.lead.phone ?? 'Not provided'}</AppText>
          <AppText>Email: {model.lead.email ?? 'Not provided'}</AppText>
          <AppText>Source: {model.lead.source}</AppText>
          <AppText>Notes: {model.lead.notes || 'None'}</AppText>
          <AppButton variant="secondary" label="Edit Lead" onPress={() => router.push({ pathname: '/lead/edit/[id]', params: { id } })} />
        </AppCard>
        <AppCard>
          <LeadChoices label="Contact stage" options={STAGES} selected={model.lead.contact_stage}
            text={(stage) => STAGE_LABELS[stage]} disabled={model.stageSaving || model.noteSaving}
            onSelect={(stage) => void changeStage(stage)} />
          {model.stageSaving ? <AppText>Saving contact stage…</AppText> : null}
          {model.stageError ? <AppText accessibilityRole="alert" style={styles.error}>{model.stageError}</AppText> : null}
        </AppCard>
        {accountId ? <LeadProjectsSection accountId={accountId} accountScope={accountScope} leadId={id} /> : null}
        {accountId ? <RelatedRemindersSection accountId={accountId} accountScope={accountScope} leadId={id} /> : null}
        <AppCard>
          <AppText variant="section">Lead History</AppText>
          <AppText muted>History entries are permanent and separate from lead notes.</AppText>
          {model.history.length === 0 ? <AppText muted>No history entries yet.</AppText> : null}
          {model.history.map((activity) => (
            <View key={activity.id} style={styles.entry}>
              <AppText variant="caption" muted>{new Date(activity.created_at).toLocaleString()}</AppText>
              <AppText>{activity.type === 'manual_note' && 'note' in activity.detail ? activity.detail.note :
                formatSiteVisitStageActivity(activity) ?? formatDecisionHistory(activity) ?? activity.type}</AppText>
            </View>
          ))}
          <AppField label="New history note" value={model.note} multiline
            style={{ minHeight: 88, textAlignVertical: 'top' }}
            onChangeText={(note) => setStored((previous) => previous.scope === scope ?
              { ...previous, note, noteError: '', success: '' } : previous)} />
          {model.noteError ? <AppText accessibilityRole="alert" style={styles.error}>{model.noteError}</AppText> : null}
          <AppButton label={model.noteSaving ? 'Saving history note…' : 'Add History Note'}
            disabled={model.noteSaving || model.stageSaving} onPress={() => void saveNote()} />
        </AppCard>
      </> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs }, error: { color: colors.dangerText },
  success: { color: colors.successText },
  entry: { gap: spacing.xxs, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm }
});
