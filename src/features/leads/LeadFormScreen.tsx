import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { LeadChoices } from './LeadChoices';
import { createLead, leadFailureMessage, loadLead, updateLead } from './leadsApi';
import { draftFromLead, EMPTY_LEAD, SOURCES, STAGES, STAGE_LABELS, validateLead, type LeadDraft } from './leadModel';

export function LeadFormScreen({ id }: { id?: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id ?? 'new'}` : '';
  const [model, setModel] = useState(() => ({ scope, draft: { ...EMPTY_LEAD }, ready: !id,
    loading: Boolean(id), saving: false, error: '', success: '', errors: {} as Record<string, string> }));
  const generation = useRef(0);
  const busy = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const active = model.scope === scope ? model : { scope, draft: { ...EMPTY_LEAD }, ready: !id,
    loading: Boolean(id), saving: false, error: '', success: '', errors: {} as Record<string, string> };

  const reload = useCallback(async () => {
    if (!accountId || !id) return;
    const requestId = ++generation.current;
    setModel((previous) => ({ ...previous, scope, ready: false, loading: true, error: '' }));
    try {
      const lead = await loadLead(accountId, id);
      if (generation.current !== requestId || currentScope.current !== scope) return;
      setModel({ scope, draft: draftFromLead(lead), ready: true, loading: false,
        saving: false, error: '', success: '', errors: {} });
    } catch (error) {
      if (generation.current !== requestId || currentScope.current !== scope) return;
      setModel((previous) => ({ ...previous, scope, ready: false, loading: false,
        error: leadFailureMessage(error) }));
    }
  }, [accountId, id, scope]);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    setModel({ scope, draft: { ...EMPTY_LEAD }, ready: !id, loading: Boolean(id), saving: false,
      error: '', success: '', errors: {} });
    if (id) void reload();
    return () => { generation.current++; };
  }, [id, scope, reload]);

  const setField = (field: keyof LeadDraft, value: string) => {
    setModel((previous) => previous.scope === scope
      ? { ...previous, draft: { ...previous.draft, [field]: value },
        error: '', success: '', errors: {} } : previous);
  };

  const save = async () => {
    if (!accountId || busy.current || !active.ready || active.saving) return;
    const checked = validateLead(active.draft);
    if (!checked.ok) {
      setModel((previous) => ({ ...previous, errors: checked.errors, error: '', success: '' }));
      return;
    }
    const requestId = ++generation.current;
    busy.current = true;
    setModel((previous) => ({ ...previous, saving: true, error: '', success: '' }));
    try {
      const result = id ? await updateLead(accountId, id, active.draft) : await createLead(accountId, active.draft);
      if (generation.current !== requestId || currentScope.current !== scope) return;
      router.replace({ pathname: '/lead/[id]', params: { id: result.id, saved: id ? 'updated' : 'created' } });
    } catch (error) {
      if (generation.current !== requestId || currentScope.current !== scope) return;
      setModel((previous) => ({ ...previous, saving: false, error: leadFailureMessage(error) }));
    } finally {
      if (generation.current === requestId && currentScope.current === scope) busy.current = false;
    }
  };

  return (
    <AppScreen>
      <AppText variant="title">{id ? 'Edit Lead' : 'Create Lead'}</AppText>
      {active.loading ? <AppText accessibilityRole="alert">Loading lead…</AppText> : null}
      {active.error ? <AppText accessibilityRole="alert" style={styles.error}>{active.error}</AppText> : null}
      {!active.ready && !active.loading ? <AppButton label="Retry loading lead" onPress={() => void reload()} /> : null}
      {active.ready ? (
        <AppCard>
          <AppField label="Customer name" value={active.draft.customerName}
            onChangeText={(value) => setField('customerName', value)} error={active.errors.customerName} />
          <AppField label="Phone" value={active.draft.phone} keyboardType="phone-pad"
            onChangeText={(value) => setField('phone', value)} />
          <AppField label="Email" value={active.draft.email} keyboardType="email-address"
            autoCapitalize="none" onChangeText={(value) => setField('email', value)} />
          {active.errors.contact ? <AppText accessibilityRole="alert" style={styles.error}>{active.errors.contact}</AppText> : null}
          <LeadChoices label="Lead source" options={SOURCES} selected={active.draft.source}
            text={(source) => source} disabled={active.saving} onSelect={(value) => setField('source', value)} />
          <LeadChoices label="Contact stage" options={STAGES} selected={active.draft.contactStage}
            text={(stage) => STAGE_LABELS[stage]} disabled={active.saving}
            onSelect={(value) => setField('contactStage', value)} />
          <AppField label="Lead notes (optional)" value={active.draft.notes} multiline
            style={{ minHeight: 88, textAlignVertical: 'top' }}
            onChangeText={(value) => setField('notes', value)} />
          <AppButton label={active.saving ? 'Saving lead…' : 'Save Lead'}
            disabled={active.saving} onPress={() => void save()} />
        </AppCard>
      ) : null}
      <View style={{ gap: spacing.xs }}><AppButton variant="secondary" label="Back"
        onPress={() => router.back()} /></View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({ error: { color: colors.dangerText } });
