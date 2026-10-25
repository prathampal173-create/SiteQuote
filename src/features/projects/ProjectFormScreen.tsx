import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { createProject, loadProject, projectFailureMessage, updateProject } from './projectsApi';
import { draftFromProject, EMPTY_PROJECT, validateProject, type ProjectDraft } from './projectModel';

type Model = { scope: string; draft: ProjectDraft; ready: boolean; loading: boolean; saving: boolean;
  closed: boolean; leadId: string; error: string; errors: { title?: string } };
const empty = (scope: string, leadId: string, editing: boolean): Model => ({ scope,
  draft: { ...EMPTY_PROJECT }, ready: !editing, loading: editing, saving: false,
  closed: false, leadId, error: '', errors: {} });

export function ProjectFormScreen({ id, leadId = '' }: { id?: string; leadId?: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id ?? `new:${leadId}`}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope, leadId, Boolean(id)));
  const generation = useRef(0);
  const busy = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope, leadId, Boolean(id));

  const reload = useCallback(async () => {
    if (!accountId || !id) return;
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope, leadId, true)),
      loading: true, ready: false, error: '' }));
    try {
      const project = await loadProject(accountId, id);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, draft: draftFromProject(project), ready: true, loading: false,
        saving: false, closed: project.status === 'won' || project.status === 'lost',
        leadId: project.lead_id, error: '', errors: {} });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...previous, ready: false, loading: false, error: projectFailureMessage(error) }));
    }
  }, [accountId, id, scope, leadId]);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    setStored(empty(scope, leadId, Boolean(id)));
    if (id) void reload();
    return () => { generation.current++; };
  }, [scope, id, leadId, reload]);

  const field = (name: keyof ProjectDraft, value: string) => {
    setStored((previous) => previous.scope !== scope ? previous :
      { ...previous, draft: { ...previous.draft, [name]: value }, errors: {}, error: '' });
  };
  const save = async () => {
    if (!accountId || busy.current || !model.ready || model.saving) return;
    const validated = validateProject(model.draft);
    if (!validated.ok) {
      setStored((previous) => ({ ...previous, errors: validated.errors }));
      return;
    }
    const ticket = ++generation.current;
    busy.current = true;
    setStored((previous) => ({ ...previous, saving: true, error: '' }));
    try {
      const project = id ? await updateProject(accountId, id, model.draft)
        : await createProject(accountId, leadId, model.draft);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      router.replace({ pathname: '/project/[id]', params: { id: project.id, saved: '1' } });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...previous, saving: false, error: projectFailureMessage(error) }));
    } finally {
      if (ticket === generation.current && currentScope.current === scope) busy.current = false;
    }
  };

  return (
    <AppScreen>
      <AppText variant="title">{id ? 'Edit Project' : 'Create Project'}</AppText>
      {model.loading ? <AppText accessibilityRole="alert">Loading project…</AppText> : null}
      {model.error ? <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText> : null}
      {!model.ready && !model.loading && id ? <AppButton variant="secondary" label="Retry loading project"
        onPress={() => void reload()} /> : null}
      {model.ready ? <AppCard>
        {model.closed ? <AppText muted>Won/Lost projects have locked names and site addresses until Reopen. Internal notes remain editable.</AppText> : null}
        <AppField label="Project name" value={model.draft.title} error={model.errors.title}
          editable={!model.closed && !model.saving} onChangeText={(value) => field('title', value)} />
        <AppField label="Site address (optional)" value={model.draft.siteAddress} multiline
          editable={!model.closed && !model.saving} onChangeText={(value) => field('siteAddress', value)} />
        <AppField label="Internal project notes (optional)" value={model.draft.notes} multiline
          editable={!model.saving} style={{ minHeight: 88, textAlignVertical: 'top' }}
          onChangeText={(value) => field('notes', value)} />
        <AppButton label={model.saving ? 'Saving project…' : 'Save Project'} disabled={model.saving}
          onPress={() => void save()} />
      </AppCard> : null}
      <AppButton variant="secondary" label="Back" onPress={() => router.back()} />
    </AppScreen>
  );
}
const styles = StyleSheet.create({ error: { color: colors.dangerText } });
