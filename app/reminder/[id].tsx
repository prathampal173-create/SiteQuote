import { useLocalSearchParams } from 'expo-router';
import { ReminderDetailScreen } from '../../src/features/reminders/ReminderDetailScreen';
export default function ReminderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReminderDetailScreen id={id} />;
}
