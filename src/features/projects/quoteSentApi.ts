import { getSupabaseClient, isCurrentSupabaseClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import { ProjectFailure } from './projectsApi';

/** Current project status, not a quote history record or arbitrary preferred-project pointer. */
export async function listQuoteSentLeadIds(accountId: string): Promise<ReadonlySet<string>> {
  const client = getSupabaseClient();
  if (!client) throw new ProjectFailure('configuration');
  const session = await validateServerSession(client).catch(() => null);
  if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client)) throw new ProjectFailure('session');
  try {
    const ids = new Set<string>();
    const limit = 200;
    for (let offset = 0; ; offset += limit) {
      const { data, error } = await client.from('projects').select('lead_id').eq('user_id', accountId)
        .eq('status', 'quote_sent').order('lead_id', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = data ?? [];
      rows.forEach(({ lead_id }) => ids.add(lead_id));
      if (rows.length < limit) break;
    }
    if (!isCurrentSupabaseClient(client)) throw new ProjectFailure('session');
    const current = await validateServerSession(client, undefined, session.accessToken).catch(() => null);
    if (!current || current.userId !== accountId || !isCurrentSupabaseClient(client)) throw new ProjectFailure('session');
    return ids;
  } catch (error) {
    if (error instanceof ProjectFailure) throw error;
    throw new ProjectFailure('request');
  }
}
