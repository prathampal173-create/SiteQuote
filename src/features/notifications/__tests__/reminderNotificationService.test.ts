import * as Notifications from 'expo-notifications';
import { checkNotificationPermission, enableNotificationPermission, scheduleSavedReminders } from '../reminderNotificationService';
import type { Reminder } from '../../reminders/reminderModel';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(), setNotificationChannelAsync: jest.fn(async () => ({})),
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'os-1'),
  AndroidImportance: { DEFAULT: 3 }, SchedulableTriggerInputTypes: { DATE: 'date' }
}));
const ID = '11111111-1111-4111-8111-111111111111';
const due = new Date(Date.now() + 86400000).toISOString();
const row: Reminder = { id: ID, user_id: 'user-1', lead_id: 'lead-1', project_id: null,
  kind: 'other', title: 'PRIVATE TITLE', note: 'PRIVATE NOTE', due_at: due,
  status: 'open', completed_at: null, created_at: due, updated_at: due };

beforeEach(() => {
  jest.clearAllMocks();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status:'undetermined', canAskAgain:true });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status:'granted', granted:true });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('os-1');
});

test('permission request is explicit; no repeat when denied without prompting ability', async () => {
  expect((await checkNotificationPermission()).state).toBe('prompt');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied', canAskAgain: false });
  expect((await enableNotificationPermission()).state).toBe('denied');
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
test('request grants when prompted; thrown request is unavailable', async () => {
  expect((await enableNotificationPermission()).state).toBe('granted');
  (Notifications.requestPermissionsAsync as jest.Mock).mockRejectedValue(new Error('native permission'));
  expect((await enableNotificationPermission()).state).toBe('unavailable');
});
test('one generic, one-time DATE notification at saved absolute UTC instant', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status:'granted', granted:true });
  const result = await scheduleSavedReminders('unique-scope-service-test', 'user-1', [row]);
  expect(result.scheduled).toBe(1);
  const request = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
  expect(request.trigger.type).toBe('date');
  expect(request.trigger.date.getTime()).toBe(Date.parse(due));
  expect(request.content.data).toEqual({ type: 'reminder', reminderId: ID });
  expect(JSON.stringify(request.content)).not.toContain(row.title);
  expect(JSON.stringify(request.content)).not.toContain(row.note);
});
test('denial and native scheduling errors never change saved data', async () => {
  const copy = JSON.stringify(row);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status:'denied', canAskAgain:false });
  expect((await scheduleSavedReminders('denied-service-test', 'user-1', [row])).scheduled).toBe(0);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status:'granted', granted:true });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error('native'));
  expect((await scheduleSavedReminders('failing-service-test','user-1',[row])).failed).toBe(1);
  expect(JSON.stringify(row)).toBe(copy);
});
