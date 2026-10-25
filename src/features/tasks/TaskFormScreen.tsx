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
import { LeadChoices } from '../leads/LeadChoices';
import { loadProject } from '../projects/projectsApi';
import { TASK_CATEGORIES, EMPTY_TASK, draftFromTask, validateTask,
  type TaskDraft, type TaskErrors } from './taskModel';
import { createTask, loadTask, taskFailureMessage, updateTask } from './tasksApi';

type Model = { scope: string; projectId: string; draft: TaskDraft; loading: boolean; ready: boolean;
  closed: boolean; saving: boolean; error: string; errors: TaskErrors };
const empty = (scope: string, projectId: string): Model => ({ scope, projectId,
  draft: { ...EMPTY_TASK }, loading: true, ready: false, closed: false,
  saving: false, error: '', errors: {} });

export function TaskFormScreen({ id, projectId = '' }: { id?: string; projectId?: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id ?? `new:${projectId}`}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope, projectId));
  const generation = useRef(0);
  const busy = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope, projectId);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    busy.current = false;
    setStored(empty(scope, projectId));
    try {
      const task = id ? await loadTask(accountId, id) : null;
      const linkedProject = await loadProject(accountId, task?.project_id ?? projectId);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ ...empty(scope, linkedProject.id), loading: false, ready: true,
        closed: linkedProject.status === 'won' || linkedProject.status === 'lost',
        draft: task ? draftFromTask(task) : { ...EMPTY_TASK } });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope, projectId)),
        loading: false, error: taskFailureMessage(error) }));
    }
  }, [accountId, scope, id, projectId]);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    setStored(empty(scope, projectId));
    void reload();
    return () => { generation.current++; busy.current = false; };
  }, [scope, projectId, reload]);

  const field = (name: keyof TaskDraft, value: string) => {
    setStored((previous) => previous.scope !== scope ? previous : {
      ...previous, draft: { ...previous.draft, [name]: value }, errors: {}, error: ''
    });
  };

  const save = async () => {
    if (!accountId || !model.ready || model.closed || busy.current || model.saving) return;
    const checked = validateTask(model.draft);
    if (!checked.ok) {
      setStored((previous) => previous.scope === scope ? { ...previous, errors: checked.errors } : previous);
      return;
    }
    const ticket = ++generation.current;
    busy.current = true;
    setStored((previous) => ({ ...previous, saving: true, error: '' }));
    try {
      const task = id ? await updateTask(accountId, id, model.draft)
        : await createTask(accountId, model.projectId, model.draft);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      router.replace({ pathname: '/task/[id]', params: { id: task.id, saved: '1' } });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...previous, saving: false, error: taskFailureMessage(error) }));
    } finally {
      if (ticket === generation.current && currentScope.current === scope) busy.current = false;
    }
  };

  return <AppScreen>
    <AppText variant="title">{id ? 'Edit Task' : 'Create Task'}</AppText>
    {model.loading ? <AppText accessibilityRole="alert">Loading task form…</AppText> : null}
    {model.error ? <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText> : null}
    {!model.ready && !model.loading ? <AppButton variant="secondary" label="Retry loading task"
      onPress={() => void reload()} /> : null}
    {model.ready ? <AppCard>
      {model.closed ? <AppText muted>Won/Lost projects have read-only tasks until Reopen.</AppText> : null}
      <LeadChoices label="Task category" options={TASK_CATEGORIES} selected={model.draft.category}
        text={(value) => value} onSelect={(value) => field('category', value)}
        disabled={model.closed || model.saving} />
      {model.errors.category ? <AppText accessibilityRole="alert" style={styles.error}>{model.errors.category}</AppText> : null}
      <AppField label="Task title" value={model.draft.title} error={model.errors.title}
        editable={!model.closed && !model.saving} onChangeText={(value) => field('title', value)} />
      <AppField label="Task notes (optional)" value={model.draft.notes} multiline
        style={{ minHeight: 88, textAlignVertical: 'top' }} editable={!model.closed && !model.saving}
        onChangeText={(value) => field('notes', value)} />
      <AppField label="Estimated cost (USD)" value={model.draft.cost} error={model.errors.cost}
        keyboardType="decimal-pad" placeholder="0.00" editable={!model.closed && !model.saving}
        onChangeText={(value) => field('cost', value)} />
      {!model.closed ? <AppButton label={model.saving ? 'Saving task…' : 'Save Task'}
        disabled={model.saving} onPress={() => void save()} /> : null}
    </AppCard> : null}
    <AppButton variant="secondary" label="Back" onPress={() => router.back()} />
  </AppScreen>;
}
const styles = StyleSheet.create({ error: { color: colors.dangerText } });
