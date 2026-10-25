import Storage from 'expo-sqlite/kv-store';
import { UUID_PATTERN } from './reminderNotificationModel';

const REGISTRY_KEY = 'sitequote:local-reminder-notifications:v1';
export type NotificationEntry = { ownerId: string; reminderId: string; nativeId: string; dueMs: number };
export type RegistryStore = { read: () => Promise<NotificationEntry[]>; write: (entries: NotificationEntry[]) => Promise<void> };
const valid = (row: unknown): row is NotificationEntry => {
  if (!row || typeof row !== 'object') return false;
  const r = row as NotificationEntry;
  return UUID_PATTERN.test(r.ownerId) && UUID_PATTERN.test(r.reminderId) &&
    typeof r.nativeId === 'string' && r.nativeId.length > 0 && r.nativeId.length < 512 &&
    Number.isSafeInteger(r.dueMs) && r.dueMs > 0;
};

/** Only opaque IDs and due instants. A single installation-wide journal permits recovery of old-account
 * entries after account changes, without using those entries as an authorization source. */
export const notificationRegistry: RegistryStore = {
  async read() {
    const raw = await Storage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Notification registry is damaged; retry reconciliation.');
    return data.filter(valid);
  },
  async write(entries) {
    // Only actual pending SiteQuote schedules are retained. Removed notifications disappear from the journal.
    await Storage.setItem(REGISTRY_KEY, JSON.stringify(entries.filter(valid)));
  }
};
