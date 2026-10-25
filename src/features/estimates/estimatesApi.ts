import type { Database } from '../../lib/database.types';
import type { SiteQuoteClient } from '../../lib/supabase';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import type { Task } from '../tasks/taskModel';
import { calculateEstimate, parseTaxBps, validateCharge, type EstimateTotals } from './estimateMath';

export type AdditionalCharge = Database['public']['Tables']['project_additional_charges']['Row'];
export type WorkingEstimate = {
  tasks: Task[]; charges: AdditionalCharge[]; totals: EstimateTotals; status: string;
};
export class EstimateFailure extends Error {
  constructor(public readonly reason: 'not_found' | 'invalid' | 'locked' | 'request' | 'session') {
    super(reason); this.name = 'EstimateFailure';
  }
}
export function estimateFailureMessage(error: unknown): string {
  if (error instanceof EstimateFailure) {
    if (error.reason === 'not_found') return 'Project or charge unavailable. Refresh the estimate.';
    if (error.reason === 'locked') return 'This project is Won/Lost. Reopen it before editing pricing.';
    if (error.reason === 'invalid') return 'Correct the amount, description, or tax rate.';
    if (error.reason === 'session') return 'Your verified session is unavailable. Sign in again.';
  }
  if (error instanceof RangeError) return error.message;
  return 'Could not save or load the estimate. Check your connection and retry.';
}
/** Session and client fences prevent old-account responses from being shown. */
async function estimateRequest<T>(accountId: string, work: (client: SiteQuoteClient) => Promise<T>): Promise<T> {
  const client = getSupabaseClient();
  if (!client) throw new EstimateFailure('request');
  let token: string;
  try {
    const session = await validateServerSession(client);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client)) throw new Error('session');
    token = session.accessToken;
  } catch { throw new EstimateFailure('session'); }
  try {
    const result = await work(client);
    const current = await validateServerSession(client, undefined, token);
    if (!current || current.userId !== accountId || !isCurrentSupabaseClient(client)) throw new EstimateFailure('session');
    return result;
  } catch (error) {
    if (error instanceof EstimateFailure || error instanceof RangeError) throw error;
    throw new EstimateFailure('request');
  }
}
const CHARGE_COLUMNS = 'id,user_id,project_id,description,amount_minor,sort_order,created_at,updated_at';
const TASK_COLUMNS = 'id,user_id,project_id,category,title,notes,amount_minor,sort_order,created_at,updated_at';
const PAGE = 200;

async function ownedStatus(client: SiteQuoteClient, accountId: string, projectId: string): Promise<{
  status: string; tax_bps: number;
}> {
  const { data, error } = await client.from('projects').select('status,tax_bps')
    .eq('id', projectId).eq('user_id', accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new EstimateFailure('not_found');
  return data;
}
async function editable(client: SiteQuoteClient, accountId: string, projectId: string): Promise<void> {
  const { status } = await ownedStatus(client, accountId, projectId);
  if (status === 'won' || status === 'lost') throw new EstimateFailure('locked');
}

/** Explicit pagination prevents silent undercounting at the PostgREST default 1000-row limit. */
async function allTasks(client: SiteQuoteClient, accountId: string, projectId: string): Promise<Task[]> {
  const rows: Task[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await client.from('project_tasks').select(TASK_COLUMNS)
      .eq('user_id', accountId).eq('project_id', projectId)
      .order('sort_order').order('created_at').order('id').range(start, start + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Task[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
async function allCharges(client: SiteQuoteClient, accountId: string, projectId: string): Promise<AdditionalCharge[]> {
  const rows: AdditionalCharge[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await client.from('project_additional_charges').select(CHARGE_COLUMNS)
      .eq('user_id', accountId).eq('project_id', projectId)
      .order('sort_order').order('created_at').order('id').range(start, start + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as AdditionalCharge[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export function loadWorkingEstimate(accountId: string, projectId: string): Promise<WorkingEstimate> {
  return estimateRequest(accountId, async (client) => {
    const parent = await ownedStatus(client, accountId, projectId);
    const tasks = await allTasks(client, accountId, projectId);
    const charges = await allCharges(client, accountId, projectId);
    return { tasks, charges, status: parent.status,
      totals: calculateEstimate(tasks, charges, parent.tax_bps) };
  });
}

/** All write operations require owner-scoped rows; server trigger serializes with Won/Lost decisions. */
export function addAdditionalCharge(accountId: string, projectId: string, description: string, amount: string): Promise<void> {
  const checked = validateCharge(description, amount);
  if (!checked.ok) return Promise.reject(new EstimateFailure('invalid'));
  return estimateRequest(accountId, async (client) => {
    await editable(client, accountId, projectId);
    const { error } = await client.from('project_additional_charges').insert({
      user_id: accountId, project_id: projectId, ...checked.values
    });
    if (error) throw normalizeError(error);
  });
}
export function editAdditionalCharge(accountId: string, projectId: string, chargeId: string,
  description: string, amount: string): Promise<void> {
  const checked = validateCharge(description, amount);
  if (!checked.ok || !chargeId) return Promise.reject(new EstimateFailure('invalid'));
  return estimateRequest(accountId, async (client) => {
    await editable(client, accountId, projectId);
    const { data, error } = await client.from('project_additional_charges').update(checked.values)
      .eq('user_id', accountId).eq('project_id', projectId).eq('id', chargeId)
      .select('id').maybeSingle();
    if (error) throw normalizeError(error);
    if (!data) throw new EstimateFailure('not_found');
  });
}
export function removeAdditionalCharge(accountId: string, projectId: string, chargeId: string): Promise<void> {
  if (!chargeId) return Promise.reject(new EstimateFailure('invalid'));
  return estimateRequest(accountId, async (client) => {
    await editable(client, accountId, projectId);
    const { data, error } = await client.from('project_additional_charges').delete()
      .eq('user_id', accountId).eq('project_id', projectId).eq('id', chargeId)
      .select('id').maybeSingle();
    if (error) throw normalizeError(error);
    if (!data) throw new EstimateFailure('not_found');
  });
}
export function saveTaxRate(accountId: string, projectId: string, taxInput: string): Promise<void> {
  const tax_bps = parseTaxBps(taxInput);
  if (tax_bps === null) return Promise.reject(new EstimateFailure('invalid'));
  return estimateRequest(accountId, async (client) => {
    await editable(client, accountId, projectId);
    const { data, error } = await client.from('projects').update({ tax_bps })
      .eq('user_id', accountId).eq('id', projectId).select('id').maybeSingle();
    if (error) throw normalizeError(error);
    if (!data) throw new EstimateFailure('not_found');
  });
}
function normalizeError(error: { code?: string }): Error {
  return error.code === '23514' ? new EstimateFailure('locked') : new EstimateFailure('request');
}
