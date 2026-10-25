import { getSupabaseClient, isCurrentSupabaseClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import { ESTIMATE_CHANGED_MESSAGE } from './unsentEstimate';
import { parsePreparedQuote, parsePrepareResult, type PreparedQuote, type PrepareResult } from './preparedQuotes';

async function guardedClient(accountId: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is unavailable.');
  const session = await validateServerSession(client);
  if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client))
    throw new Error('Verified session unavailable.');
  return { client, token: session.accessToken };
}
async function recheck(accountId: string, token: string, client: NonNullable<ReturnType<typeof getSupabaseClient>>) {
  const current = await validateServerSession(client, undefined, token);
  if (!current || current.userId !== accountId || !isCurrentSupabaseClient(client))
    throw new Error('Your account changed during the quote request.');
}
export async function prepareQuote(accountId: string, projectId: string, fingerprint: string, requestKey: string): Promise<PrepareResult> {
  const { client, token } = await guardedClient(accountId);
  const { data, error } = await client.rpc('prepare_quote', { p_project_id: projectId,
    p_preview_fingerprint: fingerprint, p_request_key: requestKey });
  if (error) {
    if (/estimate changed|preview again/i.test(error.message || '')) throw new Error(ESTIMATE_CHANGED_MESSAGE);
    throw new Error(error.message || 'Could not prepare quote. Retry with the same request.');
  }
  const result = parsePrepareResult(data, accountId, projectId);
  await recheck(accountId, token, client);
  return result;
}
export async function listPreparedQuotes(accountId: string, projectId: string): Promise<PreparedQuote[]> {
  const { client, token } = await guardedClient(accountId);
  const rows: PreparedQuote[] = [];
  for (let start = 0; ; start += 200) {
    const { data, error } = await client.from('quotes').select('*')
      .eq('user_id', accountId).eq('project_id', projectId)
      .order('version', { ascending: false }).range(start, start + 199);
    if (error) throw new Error('Quote history could not be loaded.');
    for (const row of data ?? []) rows.push(parsePreparedQuote(row, accountId, projectId));
    if ((data?.length ?? 0) < 200) break;
  }
  await recheck(accountId, token, client);
  return rows;
}

/** Phase 3D prerequisite: only this explicit user-confirmed call records delivery. */
export async function confirmQuoteSent(accountId: string, projectId: string, quoteId: string): Promise<PreparedQuote> {
  const { client, token } = await guardedClient(accountId);
  const { data, error } = await client.rpc('confirm_quote_sent', { p_quote_id: quoteId });
  if (error) throw new Error(error.message || 'Could not confirm delivery. Retry the confirmation.');
  const quote = parsePreparedQuote(data, accountId, projectId);
  if (quote.id !== quoteId || quote.status !== 'sent') throw new Error('Unexpected confirmation result.');
  await recheck(accountId, token, client);
  return quote;
}

/** Atomic genuine-Sent indicator; an already-Sent retry returns transitioned=false. */
export async function confirmQuoteSentForFollowup(accountId: string, projectId: string, quoteId: string):
  Promise<{ quote: PreparedQuote; transitioned: boolean }> {
  const { client, token } = await guardedClient(accountId);
  const { data, error } = await client.rpc('confirm_quote_sent_for_followup', { p_quote_id: quoteId });
  if (error) throw new Error(error.message || 'Could not confirm delivery.');
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.transitioned !== 'boolean')
    throw new Error('Invalid quote confirmation response.');
  const quote = parsePreparedQuote(data.quote, accountId, projectId);
  if (quote.id !== quoteId || quote.status !== 'sent') throw new Error('Unexpected confirmation result.');
  await recheck(accountId, token, client);
  return { quote, transitioned: data.transitioned };
}
