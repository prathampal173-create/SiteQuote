import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { formatUsdCents, type Task } from './taskModel';
import { listProjectTasks, taskFailureMessage } from './tasksApi';

type Model = { scope: string; rows: Task[]; loading: boolean; loaded: boolean; error: string };
const empty = (scope: string): Model => ({ scope, rows: [], loading: false, loaded: false, error: '' });

export function ProjectTasksSection({ accountId, accountScope, projectId, closed }: {
  accountId: string; accountScope: string | number; projectId: string; closed: boolean;
}) {
  const router = useRouter();
  const scope = `${accountScope}:${accountId}:${projectId}`;
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);

  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const rows = await listProjectTasks(accountId, projectId);
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, rows, loading: false, loaded: true, error: '' });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)),
        loading: false, error: taskFailureMessage(error) }));
    }
  }, [accountId, projectId, scope]);

  useFocusEffect(useCallback(() => {
    setStored(empty(scope)); void reload();
    return () => { generation.current++; };
  }, [reload, scope]));

  return <AppCard>
    <AppText variant="section">Tasks ({model.loaded ? model.rows.length : '…'})</AppText>
    {closed ? <AppText muted>Tasks are read-only on Won/Lost projects until Reopen.</AppText>
      : <AppButton label="Add Task" onPress={() => router.push({ pathname: '/task/new', params: { projectId } })} />}
    {model.loading ? <AppText accessibilityRole="alert">Loading tasks…</AppText> : null}
    {model.error ? <View style={styles.group}>
      <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
      <AppButton variant="secondary" label="Retry tasks" onPress={() => void reload()} />
    </View> : null}
    {model.loaded && !model.loading && !model.error && model.rows.length === 0 ?
      <AppText muted>No tasks for this project yet.</AppText> : null}
    {model.rows.map((task) => <AppCard key={task.id}>
      <AppText variant="section">{task.title}</AppText>
      <AppText muted>{task.category}</AppText>
      <AppText>Estimated cost: {formatUsdCents(task.amount_minor)}</AppText>
      {task.notes ? <AppText>Notes: {task.notes}</AppText> : null}
      <AppButton variant="secondary" label={closed ? `View task ${task.title}` : `Edit task ${task.title}`}
        onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })} />
    </AppCard>)}
  </AppCard>;
}
const styles = StyleSheet.create({ group: { gap: spacing.xs }, error: { color: colors.dangerText } });
