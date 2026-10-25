import { getSupabaseClient, isCurrentSupabaseClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import { parseUnsentEstimate, type UnsentEstimate } from './unsentEstimate';

/** Each read is ONE owner-scoped, read-only SQL statement (no mixed pagination snapshots). */
export async function loadUnsentEstimate(accountId: string, projectId: string): Promise<UnsentEstimate> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is unavailable.');
  const session = await validateServerSession(client);
  if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client))
    throw new Error('Verified session unavailable.');
  const { data, error } = await client.rpc('get_unsent_estimate_snapshot', { p_project_id: projectId });
  if (error) throw new Error('Could not load saved estimate. Check network and migration.');
  if (!data) throw new Error('Project is unavailable or access is denied.');
  const snapshot = parseUnsentEstimate(data, accountId, projectId);
  const after = await validateServerSession(client, undefined, session.accessToken);
  if (!after || after.userId !== accountId || !isCurrentSupabaseClient(client))
    throw new Error('Your account changed during the estimate request.');
  return snapshot;
}
