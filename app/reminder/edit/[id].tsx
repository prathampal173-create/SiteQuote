import { useLocalSearchParams } from 'expo-router';
import { ReminderFormScreen } from '../../../src/features/reminders/ReminderFormScreen';
export default function EditReminder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReminderFormScreen id={id} />;
}
