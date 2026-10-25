import { useLocalSearchParams } from 'expo-router';
import { ReminderFormScreen } from '../../src/features/reminders/ReminderFormScreen';
export default function NewReminder() {
  const { leadId, projectId, sourceQuoteId, sourceOwnerId, sentAt } = useLocalSearchParams<{
    leadId?: string; projectId?: string; sourceQuoteId?: string; sourceOwnerId?: string; sentAt?: string;
  }>();
  return <ReminderFormScreen leadId={typeof leadId === 'string' ? leadId : ''}
    projectId={typeof projectId === 'string' ? projectId : ''}
    followup={typeof sourceQuoteId === 'string' && typeof sourceOwnerId === 'string' && typeof sentAt === 'string' ?
      { sourceQuoteId, sourceOwnerId, sentAt, leadId: typeof leadId === 'string' ? leadId : '',
        projectId: typeof projectId === 'string' ? projectId : '' } : undefined} />;
}
