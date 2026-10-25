import { useLocalSearchParams } from 'expo-router';
import { ProjectDetailScreen } from '../../src/features/projects/ProjectDetailScreen';
export default function ProjectDetailRoute() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  return <ProjectDetailScreen id={id} saved={saved} />;
}
