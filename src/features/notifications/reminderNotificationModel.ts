import type { Reminder } from '../reminders/reminderModel';

export const GENERIC_TITLE = 'SiteQuote Reminder';
export const GENERIC_BODY = 'You have a reminder due. Open SiteQuote to view it.';
export const CHANNEL_ID = 'sitequote-reminders';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PermissionState = 'granted' | 'provisional' | 'denied' | 'restricted' | 'prompt' | 'unavailable';
export type PermissionInfo = { state: PermissionState; canAskAgain: boolean };
export type NativePermission = { status: string; granted?: boolean; canAskAgain?: boolean;
  ios?: { status?: number } };

export function interpretPermission(input: NativePermission | null, ios = false): PermissionInfo {
  if (!input) return { state: 'unavailable', canAskAgain: false };
  // iOS AuthorizationStatus: 0 not determined, 1 denied, 2 authorized, 3 provisional, 4 ephemeral.
  if (ios && input.ios) {
    if (input.ios.status === 3) return { state: 'provisional', canAskAgain: false };
    if (input.ios.status === 2 || input.ios.status === 4) return { state: 'granted', canAskAgain: false };
    if (input.ios.status === 1) return { state: 'denied', canAskAgain: !!input.canAskAgain };
    if (input.ios.status !== 0 && input.ios.status !== undefined)
      return { state: 'restricted', canAskAgain: false };
  }
  if (input.granted || input.status === 'granted') return { state: 'granted', canAskAgain: false };
  if (input.status === 'undetermined') return { state: 'prompt', canAskAgain: input.canAskAgain !== false };
  return { state: 'denied', canAskAgain: !!input.canAskAgain };
}
export const maySchedule = (state: PermissionState): boolean => state === 'granted' || state === 'provisional';

/** Return the exact UTC instant or null; never transform the due date into a local wall-clock. */
export function eligibleDueAt(reminder: Reminder, ownerId: string, nowMs = Date.now()): Date | null {
  if (reminder.user_id !== ownerId || reminder.status !== 'open' || !UUID_PATTERN.test(reminder.id) ||
      typeof reminder.due_at !== 'string' || !/(Z|[+-]\d\d:\d\d)$/i.test(reminder.due_at)) return null;
  const ms = Date.parse(reminder.due_at);
  return Number.isFinite(ms) && ms > nowMs ? new Date(ms) : null;
}

export type TapPayload = { type: 'reminder'; reminderId: string };
/** The UUID is only a lookup key. Ownership MUST be checked by the authenticated API. */
export function parseReminderTap(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return data.type === 'reminder' && typeof data.reminderId === 'string' &&
    UUID_PATTERN.test(data.reminderId) ? data.reminderId : null;
}

/** Injectable native adapter keeps scheduling logic independently testable. */
export type ScheduleAdapter = { schedule: (date: Date, payload: TapPayload) => Promise<string> };
export class SessionNotificationScheduler {
  private scheduled = new Set<string>();
  private pending = new Set<string>();
  async schedule(accountScope: string, ownerId: string, reminders: readonly Reminder[],
    adapter: ScheduleAdapter, nowMs = Date.now(), stillCurrent: () => boolean = () => true):
      Promise<{ scheduled: number; failed: number }> {
    let scheduled = 0; let failed = 0;
    for (const reminder of reminders) {
      if (!stillCurrent()) break;
      const dueAt = eligibleDueAt(reminder, ownerId, nowMs);
      if (!dueAt) continue;
      const key = `${accountScope}:${ownerId}:${reminder.id}:${dueAt.getTime()}`;
      if (this.scheduled.has(key) || this.pending.has(key)) continue;
      this.pending.add(key);
      try {
        if (!stillCurrent()) continue;
        if (!await adapter.schedule(dueAt, { type: 'reminder', reminderId: reminder.id }))
          throw new Error('Missing native schedule identifier');
        this.scheduled.add(key); scheduled++;
      } catch { failed++; }
      finally { this.pending.delete(key); }
    }
    return { scheduled, failed };
  }
}
export const sessionScheduler = new SessionNotificationScheduler();

/** Resolve an opaque tap using a freshly authenticated owner read. No cached payload fields. */
export async function authorizeReminderTap<T extends { id: string; user_id: string }>(
  accountId: string, reminderId: string,
  readOwned: (accountId: string, id: string) => Promise<T>,
  stillCurrent: () => boolean
): Promise<T | null> {
  if (!accountId || !UUID_PATTERN.test(reminderId) || !stillCurrent()) return null;
  const row = await readOwned(accountId, reminderId);
  return stillCurrent() && row.id === reminderId && row.user_id === accountId ? row : null;
}
