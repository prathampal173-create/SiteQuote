import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { loadProject } from '../projects/projectsApi';
import { PhotoStagingSection } from '../photos/PhotoStagingSection';
import { PhotoGallerySection } from '../photos/PhotoGallerySection';
import { formatUsdCents, type Task } from './taskModel';
import { loadTask, removeTaskWithPhotos, taskFailureMessage } from './tasksApi';

type Model = { scope: string; task: Task | null; closed: boolean; loading: boolean;
  error: string; deleting: boolean };
const empty = (scope: string): Model => ({ scope, task: null, closed: false,
  loading: false, error: '', deleting: false });

export function TaskDetailScreen({ id, saved }: { id: string; saved?: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const [photoRevision, setPhotoRevision] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const task = await loadTask(accountId, id);
      const project = await loadProject(accountId, task.project_id);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, task, closed: project.status === 'won' || project.status === 'lost',
        loading: false, error: '', deleting: false });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ ...empty(scope), error: taskFailureMessage(error) });
    }
  }, [accountId, id, scope]);

  useFocusEffect(useCallback(() => {
    busy.current = false;
    setStored(empty(scope));
    void reload();
    return () => { generation.current++; busy.current = false; };
  }, [reload, scope]));

  const doRemove = async (task: Task) => {
    if (!accountId || busy.current || currentScope.current !== scope) return;
    busy.current = true;
    const ticket = ++generation.current;
    setStored((previous) => ({ ...previous, deleting: true, error: '' }));
    try {
      await removeTaskWithPhotos(accountId, task.project_id, task.id);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      router.replace({ pathname: '/project/[id]', params: { id: task.project_id } });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...previous, deleting: false, error: taskFailureMessage(error) }));
    } finally {
      if (ticket === generation.current && currentScope.current === scope) busy.current = false;
    }
  };

  const confirmRemove = () => {
    if (!model.task || model.closed || model.deleting || busy.current) return;
    const task = model.task;
    Alert.alert('Remove task?', `Remove “${task.title}” and all of its saved and pending photos? This cannot be undone. If interrupted, retry removal to finish cleanup.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove Task', style: 'destructive', onPress: () => void doRemove(task) }
    ]);
  };

  return <AppScreen>
    <AppText variant="title">Task Detail</AppText>
    <AppButton variant="secondary" label="Back" onPress={() => router.back()} />
    {model.loading ? <AppText accessibilityRole="alert">Loading task…</AppText> : null}
    {model.error ? <View style={styles.group}>
      <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
      {!model.deleting ? <AppButton variant="secondary" label="Retry loading task"
        onPress={() => void reload()} /> : null}
    </View> : null}
    {model.task ? <AppCard>
      <AppText variant="section">{model.task.title}</AppText>
      <AppText>Category: {model.task.category}</AppText>
      <AppText>Estimated cost: {formatUsdCents(model.task.amount_minor)}</AppText>
      <AppText>Task notes: {model.task.notes || 'None'}</AppText>
      {saved ? <AppText accessibilityRole="alert" style={styles.success}>Task saved.</AppText> : null}
      {model.closed ? <AppText muted>Read-only: reopen this Won/Lost project to change tasks.</AppText> : <>
        <AppButton label="Edit Task" disabled={model.deleting}
          onPress={() => router.push({ pathname: '/task/edit/[id]', params: { id } })} />
        <AppButton variant="secondary" label={model.deleting ? 'Removing task…' : 'Remove Task'}
          disabled={model.deleting} onPress={confirmRemove} />
      </>}
      <AppButton variant="secondary" label="View Project"
        onPress={() => router.replace({ pathname: '/project/[id]', params: { id: model.task!.project_id } })} />
    </AppCard> : null}
    {model.task && accountId ? <PhotoStagingSection accountId={accountId} accountScope={accountScope}
      projectId={model.task.project_id} taskId={model.task.id}
      onSaved={() => setPhotoRevision((n) => n + 1)} /> : null}
    {model.task && accountId ? <PhotoGallerySection accountId={accountId} accountScope={accountScope}
      projectId={model.task.project_id} taskId={model.task.id} refreshKey={photoRevision} /> : null}
  </AppScreen>;
}
const styles = StyleSheet.create({ group: { gap: spacing.xs }, error: { color: colors.dangerText },
  success: { color: colors.successText } });
