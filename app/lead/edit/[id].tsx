import { useLocalSearchParams } from 'expo-router';
import { LeadFormScreen } from '../../../src/features/leads/LeadFormScreen';

export default function EditLeadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LeadFormScreen id={id} />;
}
