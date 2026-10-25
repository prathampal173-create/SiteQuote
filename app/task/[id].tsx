import { useLocalSearchParams } from 'expo-router';
import { TaskDetailScreen } from '../../src/features/tasks/TaskDetailScreen';
export default function TaskDetailRoute() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  return <TaskDetailScreen id={id} saved={saved} />;
}
