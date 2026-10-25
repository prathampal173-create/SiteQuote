import { useLocalSearchParams } from 'expo-router';
import { ProjectFormScreen } from '../../../src/features/projects/ProjectFormScreen';
export default function EditProjectRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProjectFormScreen id={id} />;
}
