import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { CHANNEL_ID, GENERIC_BODY, GENERIC_TITLE, interpretPermission, maySchedule,
  sessionScheduler, type PermissionInfo } from './reminderNotificationModel';
import type { Reminder } from '../reminders/reminderModel';

// Required for the native OS to display a local alert while the app is foregrounded.
Notifications.setNotificationHandler({ handleNotification: async () => ({
  shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false
}) });

async function channel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT
    });
  }
}
export async function checkNotificationPermission(): Promise<PermissionInfo> {
  if (Platform.OS === 'web') return { state: 'unavailable', canAskAgain: false };
  try {
    await channel();
    return interpretPermission(await Notifications.getPermissionsAsync(), Platform.OS === 'ios');
  } catch { return { state: 'unavailable', canAskAgain: false }; }
}
export async function enableNotificationPermission(): Promise<PermissionInfo> {
  const current = await checkNotificationPermission();
  if (maySchedule(current.state) || !current.canAskAgain) return current;
  try {
    return interpretPermission(await Notifications.requestPermissionsAsync(), Platform.OS === 'ios');
  } catch { return { state: 'unavailable', canAskAgain: false }; }
}
/** Legacy Phase 4C schedule helper retained for old tests. Production screens now call the
 * centralized Phase 4E reconciliation engine, which inspects and repairs native schedules. */
export async function scheduleSavedReminders(accountScope: string, accountId: string,
  rows: readonly Reminder[], stillCurrent: () => boolean = () => true):
    Promise<{ scheduled: number; failed: number; permission: PermissionInfo }> {
  const permission = await checkNotificationPermission();
  if (!stillCurrent() || !maySchedule(permission.state)) return { scheduled: 0, failed: 0, permission };
  const result = await sessionScheduler.schedule(accountScope, accountId, rows, {
    schedule: (date, payload) => Notifications.scheduleNotificationAsync({
      content: { title: GENERIC_TITLE, body: GENERIC_BODY, data: payload },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) }
    })
  }, Date.now(), stillCurrent);
  return { ...result, permission };
}
export { Notifications };
