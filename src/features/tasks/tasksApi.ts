import { getSupabaseClient, isCurrentSupabaseClient, type SiteQuoteClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import { validateTask, type Task, type TaskDraft } from './taskModel';
import { deleteSavedPhoto, listTaskPhotosForDeletion } from '../photos/photosApi';
import { clearPendingPhoto, loadPendingPhotos } from '../photos/photoQueue';

export class TaskFailure extends Error {
  constructor(public readonly reason: 'configuration' | 'session' | 'request' | 'not_found' | 'invalid' | 'locked' | 'has_photos') {
    super(reason);
    this.name = 'TaskFailure';
  }
}

export function taskFailureMessage(error: unknown): string {
  if (error instanceof TaskFailure) {
    if (error.reason === 'configuration') return 'Supabase is not configured. Add your public backend settings.';
    if (error.reason === 'session') return 'Your verified session is unavailable. Sign in again.';
    if (error.reason === 'not_found') return 'Task or project unavailable. Refresh and retry.';
    if (error.reason === 'invalid') return 'Correct the task details and retry.';
    if (error.reason === 'locked') return 'This project is Won/Lost. Reopen it before changing tasks.';
    if (error.reason === 'has_photos') return 'This task still has saved photos. Retry Remove Task to finish photo cleanup.';
  }
  return 'Could not reach your tasks. Check your connection and retry.';
}

type Authorized = { client: SiteQuoteClient; token: string };
async function authorize(accountId: string): Promise<Authorized> {
  const client = getSupabaseClient();
  if (!client) throw new TaskFailure('configuration');
  try {
    const session = await validateServerSession(client);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client)) throw new TaskFailure('session');
    return { client, token: session.accessToken };
  } catch { throw new TaskFailure('session'); }
}
async function ensureCurrent(auth: Authorized, accountId: string): Promise<void> {
  if (!isCurrentSupabaseClient(auth.client)) throw new TaskFailure('session');
  try {
    const session = await validateServerSession(auth.client, undefined, auth.token);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(auth.client)) throw new TaskFailure('session');
  } catch { throw new TaskFailure('session'); }
}
async function request<T>(accountId: string, work: (client: SiteQuoteClient, auth: Authorized) => Promise<T>): Promise<T> {
  const auth = await authorize(accountId);
  try {
    const result = await work(auth.client, auth);
    await ensureCurrent(auth, accountId);
    return result;
  } catch (error) {
    if (!isCurrentSupabaseClient(auth.client)) throw new TaskFailure('session');
    if (error instanceof TaskFailure) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514') {
      throw new TaskFailure('locked');
    }
    throw new TaskFailure('request');
  }
}

const COLUMNS = 'id,user_id,project_id,category,title,notes,amount_minor,sort_order,created_at,updated_at';
const PAGE_SIZE = 200;
async function ownedProject(client: SiteQuoteClient, accountId: string, projectId: string): Promise<'open' | 'closed'> {
  const { data, error } = await client.from('projects').select('id,status')
    .eq('user_id', accountId).eq('id', projectId).maybeSingle();
  if (error) throw error;
  if (!data) throw new TaskFailure('not_found');
  return data.status === 'won' || data.status === 'lost' ? 'closed' : 'open';
}

export function listProjectTasks(accountId: string, projectId: string): Promise<Task[]> {
  return request(accountId, async (client) => {
    // Also validate ownership when the project has zero tasks.
    await ownedProject(client, accountId, projectId);
    const result: Task[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.from('project_tasks').select(COLUMNS)
        .eq('user_id', accountId).eq('project_id', projectId)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
        .order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Task[];
      result.push(...page);
      if (page.length < PAGE_SIZE) return result;
    }
  });
}

export function loadTask(accountId: string, taskId: string): Promise<Task> {
  return request(accountId, async (client) => {
    const { data, error } = await client.from('project_tasks').select(COLUMNS)
      .eq('user_id', accountId).eq('id', taskId).maybeSingle();
    if (error) throw error;
    if (!data) throw new TaskFailure('not_found');
    return data as Task;
  });
}

export function createTask(accountId: string, projectId: string, draft: TaskDraft): Promise<Task> {
  const checked = validateTask(draft);
  if (!checked.ok || !projectId) return Promise.reject(new TaskFailure('invalid'));
  return request(accountId, async (client, auth) => {
    if (await ownedProject(client, accountId, projectId) === 'closed') throw new TaskFailure('locked');
    await ensureCurrent(auth, accountId);
    const { data, error } = await client.from('project_tasks').insert({
      user_id: accountId, project_id: projectId, ...checked.values
    }).select(COLUMNS).single();
    if (error || !data) throw error ?? new TaskFailure('request');
    return data as Task;
  });
}

export function updateTask(accountId: string, taskId: string, draft: TaskDraft): Promise<Task> {
  const checked = validateTask(draft);
  if (!checked.ok || !taskId) return Promise.reject(new TaskFailure('invalid'));
  return request(accountId, async (client, auth) => {
    const { data: existing, error: loadError } = await client.from('project_tasks').select('project_id')
      .eq('user_id', accountId).eq('id', taskId).maybeSingle();
    if (loadError) throw loadError;
    if (!existing) throw new TaskFailure('not_found');
    if (await ownedProject(client, accountId, existing.project_id) === 'closed') throw new TaskFailure('locked');
    await ensureCurrent(auth, accountId);
    const { data, error } = await client.from('project_tasks').update(checked.values)
      .eq('user_id', accountId).eq('id', taskId).eq('project_id', existing.project_id)
      .select(COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new TaskFailure('not_found');
    return data as Task;
  });
}

/** Caller must show a destructive-action confirmation before invoking. */
export function removeTask(accountId: string, projectId: string, taskId: string): Promise<void> {
  if (!projectId || !taskId) return Promise.reject(new TaskFailure('invalid'));
  return request(accountId, async (client, auth) => {
    if (await ownedProject(client, accountId, projectId) === 'closed') throw new TaskFailure('locked');
    await ensureCurrent(auth, accountId);
    const { data, error } = await client.from('project_tasks').delete()
      .eq('user_id', accountId).eq('project_id', projectId).eq('id', taskId)
      .select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new TaskFailure('not_found');
  });
}


/** Confirm destructive intent in the UI BEFORE calling. Kept sequential on purpose:
 * failures leave the task + remaining photo references intact under the RESTRICT FK.
 * The final normal removeTask preserves the original Won/Lost edit gate.
 */
export async function removeTaskWithPhotos(accountId: string, projectId: string, taskId: string): Promise<void> {
  await request(accountId, async (client) => {
    if (await ownedProject(client, accountId, projectId) === 'closed') throw new TaskFailure('locked');
    const { data, error } = await client.from('project_tasks').select('id')
      .eq('user_id', accountId).eq('project_id', projectId).eq('id', taskId).maybeSingle();
    if (error) throw error;
    if (!data) throw new TaskFailure('not_found');
  });
  const photos = await listTaskPhotosForDeletion(accountId, projectId, taskId);
  for (const photo of photos) {
    // Do not continue removing task photos if another device marked the project Won/Lost.
    await request(accountId, async (client) => {
      if (await ownedProject(client, accountId, projectId) === 'closed') throw new TaskFailure('locked');
    });
    await deleteSavedPhoto(accountId, photo);
  }
  await removeTask(accountId, projectId, taskId);
  // Local previews were explicitly included in the destructive confirmation.
  // A failure to clear a local cache never rolls back successful server deletion.
  try {
    for (const pending of await loadPendingPhotos(accountId, projectId, taskId))
      await clearPendingPhoto(accountId, pending);
  } catch { /* local cleanup can be attempted again after the journal is reopened */ }
}
