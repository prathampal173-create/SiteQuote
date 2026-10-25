import { useLocalSearchParams } from 'expo-router';
import { TaskFormScreen } from '../../../src/features/tasks/TaskFormScreen';
export default function EditTaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaskFormScreen id={id} />;
}
