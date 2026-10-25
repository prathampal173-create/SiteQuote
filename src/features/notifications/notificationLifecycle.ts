import type { Reminder } from '../reminders/reminderModel';
import { eligibleDueAt, GENERIC_BODY, GENERIC_TITLE, maySchedule, parseReminderTap,
  type PermissionInfo, type TapPayload } from './reminderNotificationModel';
import type { NotificationEntry, RegistryStore } from './notificationRegistry';

export type NativePending = { identifier: string; content: { title?: string | null; body?: string | null; data?: unknown };
  trigger?: unknown };
export type NativeNotificationPort = {
  list: () => Promise<NativePending[]>;
  cancel: (id: string) => Promise<void>;
  schedule: (date: Date, payload: TapPayload) => Promise<string>;
};
export type LifecycleReport = { scheduled: number; cancelled: number; failed: number; permission: PermissionInfo };
const disabled: PermissionInfo = { state: 'unavailable', canAskAgain: false };
const owned = (row: NativePending) => row.content?.title === GENERIC_TITLE &&
  row.content?.body === GENERIC_BODY && !!parseReminderTap(row.content.data);
const utcFromNative = (row: NativePending): number | null => {
  const t = row.trigger as { timestamp?: unknown; date?: unknown; value?: unknown; type?: unknown } | null;
  if (t?.type !== 'date') return null;
  const number = t.timestamp ?? t.date ?? t.value;
  const n = number instanceof Date ? number.getTime() : typeof number === 'string' ? Date.parse(number) : number;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n > 0 && n < 1e11 ? n * 1000 : n;
};
export function desiredNotifications(rows: readonly Reminder[], ownerId: string, now = Date.now()): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const date = eligibleDueAt(row, ownerId, now);
    if (date) result.set(row.id, date.getTime());
  }
  return result;
}

/** Single serialized lifecycle engine. Registry state is derived; native OS state is inspected before
 * every reconciliation, and owner-scoped Supabase rows are the only authority for what should exist. */
export class NotificationLifecycle {
  private queue: Promise<unknown> = Promise.resolve();
  private blocked = new Set<string>();
  constructor(private registry: RegistryStore, private native: NativeNotificationPort,
    private getPermission: () => Promise<PermissionInfo>,
    private fetchOwned: (ownerId: string) => Promise<Reminder[]>) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }
  /** Called synchronously at account revocation before cleanup is queued. */
  retire(ownerId: string): void { this.blocked.add(ownerId); }
  /** New verified grant may re-enable that owner; obsolete workers still honor their scope closure. */
  activate(ownerId: string): void { this.blocked.delete(ownerId); }
  async reconcile(ownerId: string, stillCurrent: () => boolean): Promise<LifecycleReport> {
    return this.serial(async () => {
      const result: LifecycleReport = { scheduled: 0, cancelled: 0, failed: 0, permission: disabled };
      const active = () => !this.blocked.has(ownerId) && stillCurrent();
      if (!active()) return result;
      // Never sweep schedules if authoritative owner read failed or session became invalid.
      let rows: Reminder[];
      try { rows = await this.fetchOwned(ownerId); } catch { result.failed++; return result; }
      if (!active()) return result;
      let permission: PermissionInfo;
      try { permission = await this.getPermission(); } catch { permission = disabled; result.failed++; }
      result.permission = permission;
      if (!active()) return result;
      const desired = maySchedule(permission.state) ? desiredNotifications(rows, ownerId) : new Map<string, number>();
      let registry: NotificationEntry[];
      try { registry = await this.registry.read(); } catch { registry = []; result.failed++; }
      if (!active()) return result;
      let pending: NativePending[];
      try { pending = (await this.native.list()).filter(owned); } catch { result.failed++; return result; }
      if (!active()) return result;
      const regById = new Map(registry.map((entry) => [entry.nativeId, entry]));
      const retained: NotificationEntry[] = [];
      const keepReminder = new Set<string>();
      for (const request of pending) {
        if (!active()) return result;
        const reminderId = parseReminderTap(request.content.data)!;
        const dueMs = desired.get(reminderId);
        const reg = regById.get(request.identifier);
        // Adopt crash-orphaned requests only when their native DATE instant is independently known.
        // Otherwise cancel and recreate from the authoritative saved instant.
        const nativeDue = utcFromNative(request);
        const matches = dueMs !== undefined && !keepReminder.has(reminderId) &&
          ((nativeDue === dueMs && (!reg || reg.ownerId === ownerId)) || (nativeDue === null && reg?.ownerId === ownerId &&
            reg.reminderId === reminderId && reg.dueMs === dueMs));
        if (matches) {
          keepReminder.add(reminderId);
          retained.push({ ownerId, reminderId, nativeId: request.identifier, dueMs: dueMs! });
          continue;
        }
        try { await this.native.cancel(request.identifier); result.cancelled++; }
        catch {
          result.failed++;
          // Do not schedule a replacement if cancellation is uncertain: avoid two pending alerts.
          if (dueMs !== undefined) keepReminder.add(reminderId);
          if (reg) retained.push(reg);
        }
        if (!active()) return result;
      }
      // Verify cancellation against OS state before creating replacements. A native adapter may
      // resolve a cancel while the notification is still pending (eventual consistency/failure).
      try {
        const afterCancel = (await this.native.list()).filter(owned);
        if (!active()) return result;
        for (const row of afterCancel) {
          const reminderId = parseReminderTap(row.content.data)!;
          if (desired.has(reminderId) && !keepReminder.has(reminderId)) {
            keepReminder.add(reminderId);
            result.failed++; // retry after OS converges; never create a duplicate now
            const prior = regById.get(row.identifier);
            if (prior && !retained.some((item) => item.nativeId === prior.nativeId)) retained.push(prior);
          }
        }
      } catch { result.failed++; return result; }
      // Registry is replaced from actual observed native state. Missing OS IDs never suppress repair.
      // A failed cancellation keeps the ID journaled for retry after restart.
      try { await this.registry.write(retained); } catch { result.failed++; }
      if (!active()) return result;
      for (const [reminderId, dueMs] of desired) {
        if (!active()) return result;
        if (keepReminder.has(reminderId)) continue;
        try {
          const nativeId = await this.native.schedule(new Date(dueMs), { type: 'reminder', reminderId });
          if (!nativeId) throw new Error('Native scheduler returned no identifier.');
          if (!active()) {
            // Scheduling could have resolved after logout/account switch; never leave an obsolete alert.
            try { await this.native.cancel(nativeId); result.cancelled++; } catch { result.failed++; }
            return result;
          }
          retained.push({ ownerId, reminderId, dueMs, nativeId });
          keepReminder.add(reminderId); result.scheduled++;
          // Journal after each successful scheduling operation, not only at the end.
          try { await this.registry.write(retained); } catch { result.failed++; }
        } catch { result.failed++; }
      }
      return result;
    });
  }
  /** No Supabase reads during cleanup: it is safe after the auth grant has been revoked.
   * Cancels only SiteQuote's generic notifications; registry entries never authorize read access. */
  async signOut(ownerId: string): Promise<{ cancelled: number; failed: number }> {
    this.retire(ownerId);
    return this.serial(async () => {
      let cancelled = 0; let failed = 0;
      let pending: NativePending[];
      try { pending = (await this.native.list()).filter(owned); } catch { return { cancelled, failed: 1 }; }
      for (const notification of pending) {
        try { await this.native.cancel(notification.identifier); cancelled++; } catch { failed++; }
      }
      if (!failed) {
        try { await this.registry.write([]); } catch { failed++; }
      }
      // A failure leaves a repairable journal; the next authenticated reconciliation resweeps OS state.
      return { cancelled, failed };
    });
  }
  /** On cold signed-out startup, purge leftover generic requests from a previous process. */
  async signedOutStartup(): Promise<void> {
    return this.serial(async () => {
      const pending = (await this.native.list()).filter(owned);
      let failed = false;
      for (const item of pending) try { await this.native.cancel(item.identifier); } catch { failed = true; }
      if (!failed) await this.registry.write([]);
    });
  }
}
