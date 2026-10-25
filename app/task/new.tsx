import { useLocalSearchParams } from 'expo-router';
import { TaskFormScreen } from '../../src/features/tasks/TaskFormScreen';
export default function NewTaskRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <TaskFormScreen projectId={projectId} />;
}
