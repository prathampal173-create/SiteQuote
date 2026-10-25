import { getSupabaseClient, isCurrentSupabaseClient, type SiteQuoteClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import { chronologicalHistory, STAGES, validateLead, type Activity, type ContactStage, type Lead, type LeadDraft } from './leadModel';

export class LeadFailure extends Error {
  constructor(public readonly reason: 'configuration' | 'session' | 'request' | 'not_found' | 'invalid') {
    super(reason);
    this.name = 'LeadFailure';
  }
}

export function leadFailureMessage(error: unknown): string {
  if (error instanceof LeadFailure) {
    if (error.reason === 'configuration') return 'Supabase is not configured. Add the public backend settings.';
    if (error.reason === 'session') return 'Your verified session is unavailable. Sign in again.';
    if (error.reason === 'not_found') return 'This lead is unavailable. Return to Leads and refresh.';
    if (error.reason === 'invalid') return 'Enter valid lead details and try again.';
  }
  return 'Could not reach your leads. Check your connection and retry.';
}

type Authorized = { client: SiteQuoteClient; token: string };
async function authorized(accountId: string): Promise<Authorized> {
  const client = getSupabaseClient();
  if (!client) throw new LeadFailure('configuration');
  try {
    const session = await validateServerSession(client);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client)) throw new LeadFailure('session');
    return { client, token: session.accessToken };
  } catch { throw new LeadFailure('session'); }
}

/** Check that the same validated account and access token still owns the response. */
async function stillAuthorized(auth: Authorized, accountId: string): Promise<void> {
  if (!isCurrentSupabaseClient(auth.client)) throw new LeadFailure('session');
  try {
    const session = await validateServerSession(auth.client, undefined, auth.token);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(auth.client)) throw new LeadFailure('session');
  } catch { throw new LeadFailure('session'); }
}

async function request<T>(accountId: string, run: (client: SiteQuoteClient) => Promise<T>): Promise<T> {
  const auth = await authorized(accountId);
  try {
    const result = await run(auth.client);
    await stillAuthorized(auth, accountId);
    return result;
  } catch (error) {
    if (error instanceof LeadFailure) throw error;
    throw new LeadFailure('request');
  }
}

const LEAD_COLUMNS = 'id,user_id,customer_name,phone,email,source,notes,contact_stage,created_at,updated_at';
const ACTIVITY_COLUMNS = 'id,user_id,lead_id,project_id,type,detail,created_at';

/** Explicit pagination; PostgREST's default 1,000-row cap must not silently truncate lists. */
export function listLeads(accountId: string): Promise<Lead[]> {
  return request(accountId, async (client) => {
    const all: Lead[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('leads').select(LEAD_COLUMNS)
        .eq('user_id', accountId).order('created_at', { ascending: false })
        .order('id', { ascending: false }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = (data ?? []) as Lead[];
      all.push(...rows);
      if (rows.length < pageSize) return all;
    }
  });
}

export function loadLead(accountId: string, id: string): Promise<Lead> {
  return request(accountId, async (client) => {
    const { data, error } = await client.from('leads').select(LEAD_COLUMNS)
      .eq('user_id', accountId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new LeadFailure('not_found');
    return data as Lead;
  });
}

export async function createLead(accountId: string, draft: LeadDraft): Promise<Lead> {
  const validated = validateLead(draft);
  if (!validated.ok) throw new LeadFailure('invalid');
  return request(accountId, async (client) => {
    const { data, error } = await client.from('leads')
      .insert({ user_id: accountId, ...validated.values })
      .select(LEAD_COLUMNS).single();
    if (error || !data) throw error ?? new Error('missing created lead');
    return data as Lead;
  });
}

export async function updateLead(accountId: string, id: string, draft: LeadDraft): Promise<Lead> {
  const validated = validateLead(draft);
  if (!validated.ok) throw new LeadFailure('invalid');
  return request(accountId, async (client) => {
    const { data, error } = await client.from('leads')
      .update(validated.values).eq('user_id', accountId).eq('id', id)
      .select(LEAD_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new LeadFailure('not_found');
    return data as Lead;
  });
}

/** Stage correction only: never overwrite customer fields with a stale detail snapshot. */
export async function updateLeadStage(accountId: string, id: string, stage: ContactStage): Promise<Lead> {
  if (!STAGES.includes(stage)) throw new LeadFailure('invalid');
  return request(accountId, async (client) => {
    const { data, error } = await client.from('leads')
      .update({ contact_stage: stage }).eq('user_id', accountId).eq('id', id)
      .select(LEAD_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new LeadFailure('not_found');
    return data as Lead;
  });
}

/** Load the complete append-only timeline, not just PostgREST's default capped page.
 * Ordering by timestamp AND immutable ID gives stable pagination for equal timestamps.
 */
export function listLeadHistory(accountId: string, leadId: string): Promise<Activity[]> {
  return request(accountId, async (client) => {
    const all: Activity[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('activities').select(ACTIVITY_COLUMNS)
        .eq('user_id', accountId).eq('lead_id', leadId)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as Activity[];
      all.push(...page);
      if (page.length < pageSize) return chronologicalHistory(all);
    }
  });
}

export async function addManualHistory(accountId: string, leadId: string, text: string): Promise<Activity> {
  const note = text.trim();
  if (!note || note.length > 5000) throw new LeadFailure('invalid');
  return request(accountId, async (client) => {
    const { data, error } = await client.from('activities')
      .insert({ user_id: accountId, lead_id: leadId, type: 'manual_note', detail: { note } })
      .select(ACTIVITY_COLUMNS).single();
    if (error || !data) throw error ?? new Error('missing created history');
    return data as Activity;
  });
}
