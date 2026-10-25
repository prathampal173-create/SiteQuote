import { projectRequest } from '../projects/projectsApi';
import { validateReminder, type Reminder, type ReminderCompletionEvent, type ReminderDraft, type ReminderStatus } from './reminderModel';
import type { SiteQuoteClient } from '../../lib/supabase';

export class ReminderFailure extends Error {
  constructor(public readonly reason: 'invalid' | 'not_found' | 'request') { super(reason); this.name = 'ReminderFailure'; }
}
export function reminderFailureMessage(error: unknown): string {
  if (error instanceof ReminderFailure && error.reason === 'invalid') return 'Check the reminder fields, date, and matching lead/project.';
  if (error instanceof ReminderFailure && error.reason === 'not_found') return 'Reminder unavailable. It may have been deleted or belongs to another account.';
  return 'Could not save or load reminders. Check your connection, permissions, and selected lead/project.';
}
const COLUMNS = 'id,user_id,lead_id,project_id,kind,title,note,due_at,status,completed_at,created_at,updated_at,client_request_id';
const PAGE = 200;
const EVENT_COLUMNS = 'id,user_id,reminder_id,event_type,occurred_at,lead_id,project_id,reminder_title,reminder_kind,reminder_due_at';
/** History is read-only; only the database trigger can append events. */
export function listReminderHistory(accountId: string, reminderId: string): Promise<ReminderCompletionEvent[]> {
  return projectRequest(accountId, async (client) => {
    const events: ReminderCompletionEvent[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await client.from('reminder_completion_events').select(EVENT_COLUMNS)
        .eq('user_id', accountId).eq('reminder_id', reminderId)
        .order('occurred_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as ReminderCompletionEvent[];
      events.push(...page);
      if (page.length < PAGE) return events;
    }
  });
}

export function listReminders(accountId: string, filter?: { leadId?: string; projectId?: string }): Promise<Reminder[]> {
  return projectRequest(accountId, async (client) => {
    const rows: Reminder[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = client.from('reminders').select(COLUMNS).eq('user_id', accountId);
      if (filter?.leadId) query = query.eq('lead_id', filter.leadId);
      if (filter?.projectId) query = query.eq('project_id', filter.projectId);
      const { data, error } = await query.order('due_at', { ascending: true }).order('id').range(offset, offset + PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as Reminder[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  });
}
export function loadReminder(accountId: string, id: string): Promise<Reminder> {
  return projectRequest(accountId, async (client) => {
    const { data, error } = await client.from('reminders').select(COLUMNS).eq('user_id', accountId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new ReminderFailure('not_found');
    return data as Reminder;
  });
}
// Fetch project association and lead existence as an early UX validation.
// Database FK + owner RLS remain the authoritative security boundary.
async function checkAssociation(client: SiteQuoteClient, userId: string, leadId: string, projectId: string | null) {
  const { data: lead, error: leadError } = await client.from('leads').select('id')
    .eq('user_id', userId).eq('id', leadId).maybeSingle();
  if (leadError) throw leadError;
  if (!lead) throw new ReminderFailure('invalid');
  if (projectId) {
    const { data: project, error } = await client.from('projects').select('id')
      .eq('user_id', userId).eq('lead_id', leadId).eq('id', projectId).maybeSingle();
    if (error) throw error;
    if (!project) throw new ReminderFailure('invalid');
  }
}
/** An optional stable owner-scoped request UUID prevents duplicate INSERTs after a
 * lost response. On retry, only a row with identical saved data can be reused.
 */
export function createReminder(accountId: string, draft: ReminderDraft, requestKey?: string): Promise<Reminder> {
  const result = validateReminder(draft);
  if (!result.ok) throw new ReminderFailure('invalid');
  return projectRequest(accountId, async (client) => {
    await checkAssociation(client, accountId, result.values.lead_id, result.values.project_id);
    let originalError: unknown;
    try {
      const { data, error } = await client.from('reminders').insert({ user_id: accountId, ...result.values,
        ...(requestKey ? { client_request_id: requestKey } : {}) }).select(COLUMNS).single();
      if (!error && data) return data as Reminder;
      originalError = error ?? new Error('Missing created reminder');
    } catch (error) { originalError = error; }
    if (requestKey) {
      // A committed insert can lose its response. RLS + this unique key
      // re-establishes exactly which row, if any, was persisted.
      const { data, error } = await client.from('reminders').select(COLUMNS)
        .eq('user_id', accountId).eq('client_request_id', requestKey).maybeSingle();
      if (error) throw error;
      if (data) {
        const row = data as Reminder;
        if (row.lead_id !== result.values.lead_id || row.project_id !== result.values.project_id ||
          row.kind !== result.values.kind || row.title !== result.values.title ||
          row.note !== result.values.note || Date.parse(row.due_at) !== Date.parse(result.values.due_at))
          throw new ReminderFailure('invalid');
        return row;
      }
    }
    throw originalError ?? new Error('Unable to confirm saved reminder');
  });
}
export function updateReminder(accountId: string, original: Reminder, draft: ReminderDraft): Promise<Reminder> {
  if (original.user_id !== accountId) throw new ReminderFailure('not_found');
  const result = validateReminder(draft, new Date(), original.due_at);
  if (!result.ok) throw new ReminderFailure('invalid');
  return projectRequest(accountId, async (client) => {
    await checkAssociation(client, accountId, result.values.lead_id, result.values.project_id);
    // Optimistic version guard: avoid silently overwriting concurrent modifications.
    const { data, error } = await client.from('reminders').update(result.values).eq('user_id', accountId)
      .eq('id', original.id).eq('updated_at', original.updated_at).select(COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new ReminderFailure('not_found');
    return data as Reminder;
  });
}
export function setReminderStatus(accountId: string, original: Reminder, status: ReminderStatus): Promise<Reminder> {
  if (original.user_id !== accountId) throw new ReminderFailure('not_found');
  if (original.status === status) {
    // Never treat a possibly stale local status as proof of a saved server state.
    // An idempotent request reads the current row but performs no new write/event.
    return projectRequest(accountId, async (client) => {
      const { data, error } = await client.from('reminders').select(COLUMNS)
        .eq('user_id', accountId).eq('id', original.id).maybeSingle();
      if (error) throw error;
      if (!data || data.status !== status) throw new ReminderFailure('not_found');
      return data as Reminder;
    });
  }
  return projectRequest(accountId, async (client) => {
    const { data, error } = await client.from('reminders').update({ status })
      .eq('user_id', accountId).eq('id', original.id).eq('updated_at', original.updated_at)
      .eq('status', original.status).select(COLUMNS).maybeSingle();
    if (error || !data) {
      // An UPDATE may commit even if its HTTP response fails or times out.
      // Reconcile under current-owner RLS before reporting failure; never
      // perform a second transition or fabricate a completion event.
      const { data: current, error: lookupError } = await client.from('reminders')
        .select(COLUMNS).eq('user_id', accountId).eq('id', original.id).maybeSingle();
      if (!lookupError && current && current.status === status) return current as Reminder;
      if (error) throw error;
      if (lookupError) throw lookupError;
      throw new ReminderFailure('not_found');
    }
    return data as Reminder;
  });
}
export function deleteReminder(accountId: string, original: Reminder): Promise<void> {
  if (original.user_id !== accountId) throw new ReminderFailure('not_found');
  return projectRequest(accountId, async (client) => {
    const { data, error } = await client.from('reminders').delete().eq('user_id', accountId)
      .eq('id', original.id).eq('updated_at', original.updated_at).select('id').maybeSingle();
    if (error) {
      // A DELETE can commit and lose its response. Confirm that this exact
      // owner-scoped reminder is absent before accepting an ambiguous result.
      const lookup = await client.from('reminders').select('id')
        .eq('user_id', accountId).eq('id', original.id).maybeSingle();
      if (!lookup.error && !lookup.data) return;
      throw error;
    }
    if (!data) throw new ReminderFailure('not_found');
  });
}
