import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { listReminders } from '../reminders/remindersApi';
import { checkNotificationPermission } from './reminderNotificationService';
import { CHANNEL_ID, GENERIC_BODY, GENERIC_TITLE } from './reminderNotificationModel';
import { notificationRegistry } from './notificationRegistry';
import { NotificationLifecycle } from './notificationLifecycle';

export const notificationLifecycle = new NotificationLifecycle(notificationRegistry, {
  list: () => Notifications.getAllScheduledNotificationsAsync(),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  schedule: (date, payload) => Notifications.scheduleNotificationAsync({
    content: { title: GENERIC_TITLE, body: GENERIC_BODY, data: payload },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) }
  })
}, checkNotificationPermission, listReminders);

export function reconcileSavedNotifications(ownerId: string, stillCurrent: () => boolean) {
  return notificationLifecycle.reconcile(ownerId, stillCurrent);
}
