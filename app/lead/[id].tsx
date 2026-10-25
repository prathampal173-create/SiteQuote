import { useLocalSearchParams } from 'expo-router';
import { LeadDetailScreen } from '../../src/features/leads/LeadDetailScreen';

export default function LeadDetailRoute() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  return <LeadDetailScreen id={id} saved={saved} />;
}
