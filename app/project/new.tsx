import { useLocalSearchParams } from 'expo-router';
import { ProjectFormScreen } from '../../src/features/projects/ProjectFormScreen';
export default function NewProjectRoute() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  return <ProjectFormScreen leadId={leadId} />;
}
