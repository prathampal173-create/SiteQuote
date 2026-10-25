/** UTC instants on the wire; local calendar/time is derived only at presentation. */
export type ReminderKind = 'site_visit' | 'follow_up' | 'other';
export type ReminderStatus = 'open' | 'completed';
export type Reminder = {
  id: string; user_id: string; lead_id: string; project_id: string | null;
  kind: ReminderKind; title: string; note: string | null; due_at: string;
  status: ReminderStatus; completed_at: string | null; created_at: string; updated_at: string; client_request_id?: string | null;
};
/** Persisted append-only event. Earlier cycles remain when a reminder is reopened. */
export type ReminderCompletionEvent = {
  id: string; user_id: string; reminder_id: string;
  event_type: 'completed' | 'reopened'; occurred_at: string;
  lead_id: string; project_id: string | null;
  reminder_title: string; reminder_kind: ReminderKind; reminder_due_at: string;
};
function instant(iso: string | null): number {
  const time = Date.parse(iso ?? '');
  return Number.isFinite(time) ? time : 0;
}
export function sortCompletionHistory(rows: readonly ReminderCompletionEvent[]): ReminderCompletionEvent[] {
  return [...rows].sort((a, b) => instant(a.occurred_at) - instant(b.occurred_at) || a.id.localeCompare(b.id));
}
export type ReminderDraft = {
  leadId: string; projectId: string | null; kind: ReminderKind;
  title: string; note: string; dueDate: Date;
};
export const KIND_OPTIONS: readonly ReminderKind[] = ['site_visit', 'follow_up', 'other'];
export const KIND_LABELS: Record<ReminderKind, string> = {
  site_visit: 'Site visit', follow_up: 'Follow-up', other: 'Other'
};
export function defaultDueDate(now = new Date()): Date {
  const due = new Date(now.getTime() + 60 * 60 * 1000);
  due.setSeconds(0, 0);
  return due;
}
export function formattedLocalDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Invalid date';
}
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device local time';
}
/** The OS picker supplies local date/time pieces. Combine with local Date constructor,
 * never Date.UTC or parsing an unzoned string; reject DST-gap normalization. */
export function changeLocalDatePart(original: Date, selected: Date, part: 'date' | 'time'): Date {
  if (!Number.isFinite(original.getTime()) || !Number.isFinite(selected.getTime())) return new Date(NaN);
  const year = part === 'date' ? selected.getFullYear() : original.getFullYear();
  const month = part === 'date' ? selected.getMonth() : original.getMonth();
  const day = part === 'date' ? selected.getDate() : original.getDate();
  const hours = part === 'time' ? selected.getHours() : original.getHours();
  const minutes = part === 'time' ? selected.getMinutes() : original.getMinutes();
  const next = new Date(year, month, day, hours, minutes, 0, 0);
  if (next.getFullYear() !== year || next.getMonth() !== month || next.getDate() !== day ||
    next.getHours() !== hours || next.getMinutes() !== minutes) return new Date(NaN);
  return next;
}
export function validateReminder(draft: ReminderDraft, now = new Date(), originalDue?: string):
  | { ok: true; values: { lead_id: string; project_id: string | null; kind: ReminderKind;
    title: string; note: string | null; due_at: string } }
  | { ok: false; error: string } {
  if (!draft.leadId) return { ok: false, error: 'Select a lead.' };
  if (!KIND_OPTIONS.includes(draft.kind)) return { ok: false, error: 'Select a reminder type.' };
  const title = draft.title.trim();
  if (!title || title.length > 200) return { ok: false, error: 'Title must be 1–200 characters.' };
  if (draft.note.length > 5000) return { ok: false, error: 'Note cannot exceed 5000 characters.' };
  const time = draft.dueDate.getTime();
  if (!Number.isFinite(time)) return { ok: false, error: 'Select a valid local date and time.' };
  // An old overdue due instant can be retained for text-only edits; no backdating/rescheduling.
  const sameInstant = originalDue !== undefined && time === new Date(originalDue).getTime();
  if (!sameInstant && time <= now.getTime()) return { ok: false, error: 'Choose a future due date and time.' };
  return { ok: true, values: { lead_id: draft.leadId, project_id: draft.projectId || null,
    kind: draft.kind, title, note: draft.note.trim() || null, due_at: draft.dueDate.toISOString() } };
}
export type ReminderGroup = 'Overdue' | 'Today' | 'Upcoming';
export function reminderGroup(dueAt: string, now = new Date()): ReminderGroup {
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return 'Overdue';
  return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate() ? 'Today' : 'Upcoming';
}
export function sortReminders(rows: readonly Reminder[]): Reminder[] {
  return [...rows].sort((a, b) => a.status === 'completed' && b.status === 'completed' ?
    instant(b.completed_at) - instant(a.completed_at) || a.id.localeCompare(b.id) :
    instant(a.due_at) - instant(b.due_at) || a.id.localeCompare(b.id));
}
