jest.mock('../../photos/photosApi', () => ({ deleteSavedPhoto: jest.fn(), listTaskPhotosForDeletion: jest.fn() }));
jest.mock('../../photos/photoQueue', () => ({ clearPendingPhoto: jest.fn(), loadPendingPhotos: jest.fn() }));
import { createTask, listProjectTasks, loadTask, removeTask, removeTaskWithPhotos, TaskFailure, updateTask } from '../tasksApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
import type { Task, TaskDraft } from '../taskModel';
import { deleteSavedPhoto, listTaskPhotosForDeletion } from '../../photos/photosApi';
import { clearPendingPhoto, loadPendingPhotos } from '../../photos/photoQueue';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
const A = 'account-a', B = 'account-b';
const draft: TaskDraft = { category: 'Kitchen Remodeling', title: 'Cabinets', notes: 'Install only', cost: '1500.01' };
const records: Task[] = [];
let offline = false;
let pending: Promise<void> | null = null;
let next = 1;
let owner = A;
let projectStatus = 'draft';
const clients = { tag: 'client' };
const from = jest.fn((table: string) => {
  const conditions: Record<string, unknown> = {};
  let dataToInsert: Record<string, unknown> | undefined;
  let dataToUpdate: Record<string, unknown> | undefined;
  let deleting = false;
  let start = 0; let end = 199;
  const q: Record<'select' | 'eq' | 'order' | 'range' | 'maybeSingle' | 'single' | 'insert' | 'update' | 'delete', jest.Mock> = {
    select: jest.fn((_columns: string) => q),
    eq: jest.fn((field: string, value: unknown) => { conditions[field] = value; return q; }),
    order: jest.fn((_column: string, _direction: unknown) => q),
    range: jest.fn(async (s: number, e: number) => { start = s; end = e; return resolve('many'); }),
    maybeSingle: jest.fn(async () => resolve('one')),
    single: jest.fn(async () => resolve('one')),
    insert: jest.fn((value: Record<string, unknown>) => { dataToInsert = value; return q; }),
    update: jest.fn((value: Record<string, unknown>) => { dataToUpdate = value; return q; }),
    delete: jest.fn(() => { deleting = true; return q; })
  };
  async function resolve(mode: 'one' | 'many') {
    if (pending) await pending;
    if (offline) return { data: null, error: { code: 'NETWORK' } };
    if (table === 'projects') {
      const project = conditions.id === 'p-a' && conditions.user_id === A ?
        { id: 'p-a', status: projectStatus } : null;
      return { data: project, error: null };
    }
    if (table !== 'project_tasks') throw new Error(`Unexpected table ${table}`);
    const match = (row: Task) => Object.entries(conditions).every(([key, value]) =>
      row[key as keyof Task] === value);
    if (dataToInsert) {
      if (dataToInsert.user_id !== owner || dataToInsert.project_id !== 'p-a')
        return { data: null, error: { code: '23503' } };
      const task = { id: `task-${next++}`, created_at: '2026-10-22', updated_at: '2026-10-22',
        sort_order: 0, ...dataToInsert } as Task;
      records.push(task);
      return { data: task, error: null };
    }
    if (dataToUpdate) {
      const existing = records.find(match);
      if (!existing) return { data: null, error: null };
      Object.assign(existing, dataToUpdate);
      return { data: { ...existing }, error: null };
    }
    if (deleting) {
      const index = records.findIndex(match);
      if (index < 0) return { data: null, error: null };
      const [removed] = records.splice(index, 1);
      return { data: { id: removed!.id }, error: null };
    }
    const matches = records.filter(match).sort((a, b) => a.id.localeCompare(b.id));
    return { data: mode === 'one' ? matches[0] ?? null : matches.slice(start, end + 1), error: null };
  }
  return q;
});
const getClient = jest.mocked(getSupabaseClient);
const isCurrent = jest.mocked(isCurrentSupabaseClient);
const validate = jest.mocked(validateServerSession);
beforeEach(() => {
  records.length = 0; next = 1; owner = A; offline = false; pending = null; projectStatus = 'draft';
  from.mockClear(); getClient.mockReturnValue({ from } as never);
  isCurrent.mockReturnValue(true);
  jest.mocked(listTaskPhotosForDeletion).mockReset().mockResolvedValue([]);
  jest.mocked(deleteSavedPhoto).mockReset().mockResolvedValue();
  jest.mocked(loadPendingPhotos).mockReset().mockResolvedValue([]);
  jest.mocked(clearPendingPhoto).mockReset().mockResolvedValue();
  validate.mockImplementation(async () => ({ userId: owner, accessToken: 'current-token', expiresAtMs: Date.now() + 100000 }));
});

test('creates multiple tasks with the same category but independent rows, notes, and exact cents', async () => {
  const first = await createTask(A, 'p-a', draft);
  const second = await createTask(A, 'p-a', { ...draft, title: 'Countertop', notes: 'Different', cost: '0.00' });
  expect(first.id).not.toEqual(second.id);
  const all = await listProjectTasks(A, 'p-a');
  expect(all).toHaveLength(2);
  expect(all.map((t) => [t.category, t.title, t.notes, t.amount_minor])).toEqual([
    ['Kitchen Remodeling', 'Cabinets', 'Install only', 150001],
    ['Kitchen Remodeling', 'Countertop', 'Different', 0]
  ]);
  const edited = await updateTask(A, second.id, { ...draft, title: 'Sink', notes: 'My sink', cost: '100.10' });
  expect(edited.amount_minor).toBe(10010);
  expect((await loadTask(A, first.id)).notes).toBe('Install only');
  expect((await loadTask(A, second.id)).notes).toBe('My sink');
  await removeTask(A, 'p-a', first.id);
  expect((await listProjectTasks(A, 'p-a')).map((t) => t.id)).toEqual([second.id]);
});

test('validates before writes and rejects missing/nonowned project', async () => {
  await expect(createTask(A, 'p-a', { ...draft, cost: '-1' })).rejects.toBeInstanceOf(TaskFailure);
  expect(from).not.toHaveBeenCalled();
  await expect(createTask(A, 'p-b', draft)).rejects.toMatchObject({ reason: 'not_found' });
  await expect(loadTask(A, 'missing')).rejects.toMatchObject({ reason: 'not_found' });
});

test('won/lost locks are respected by client and existing writes remain unmodified', async () => {
  const task = await createTask(A, 'p-a', draft);
  projectStatus = 'lost';
  await expect(createTask(A, 'p-a', draft)).rejects.toMatchObject({ reason: 'locked' });
  await expect(updateTask(A, task.id, draft)).rejects.toMatchObject({ reason: 'locked' });
  await expect(removeTask(A, 'p-a', task.id)).rejects.toMatchObject({ reason: 'locked' });
  expect(records).toHaveLength(1);
});

test('network error and retry preserve server state', async () => {
  offline = true;
  await expect(createTask(A, 'p-a', draft)).rejects.toMatchObject({ reason: 'request' });
  offline = false;
  expect((await createTask(A, 'p-a', draft)).amount_minor).toBe(150001);
});

test('RLS-shaped account filters block cross-account reads, updates and removal', async () => {
  const task = await createTask(A, 'p-a', draft);
  owner = B;
  await expect(loadTask(B, task.id)).rejects.toMatchObject({ reason: 'not_found' });
  await expect(listProjectTasks(B, 'p-a')).rejects.toMatchObject({ reason: 'not_found' });
  await expect(updateTask(B, task.id, draft)).rejects.toMatchObject({ reason: 'not_found' });
  await expect(removeTask(B, 'p-a', task.id)).rejects.toMatchObject({ reason: 'not_found' });
  expect(records).toHaveLength(1);
});

test('rejects old account session, client retirement, and response after switch', async () => {
  owner = B;
  await expect(listProjectTasks(A, 'p-a')).rejects.toMatchObject({ reason: 'session' });
  owner = A;
  let release!: () => void;
  pending = new Promise<void>((resolve) => { release = resolve; });
  const request = loadTask(A, 'missing');
  await Promise.resolve(); await Promise.resolve();
  isCurrent.mockReturnValue(false);
  release();
  await expect(request).rejects.toMatchObject({ reason: 'session' });
  expect(validate).toHaveBeenCalled();
});

test('confirmed task removal deletes its saved photos before the restrictive FK task removal', async () => {
  const row = await createTask(A, 'p-a', draft);
  const attached = { id: 'photo-1', user_id: A, project_id: 'p-a', task_id: row.id,
    storage_path: 'account-a/p-a/photo-1.jpg', source: 'site_visit', state: 'active',
    created_at: 'now', updated_at: 'now' } as const;
  jest.mocked(listTaskPhotosForDeletion).mockResolvedValue([attached]);
  await removeTaskWithPhotos(A, 'p-a', row.id);
  expect(deleteSavedPhoto).toHaveBeenCalledWith(A, attached);
  expect(await listProjectTasks(A, 'p-a')).toHaveLength(0);
});

test('SQ-QA-006: a network failure after client retirement reports the obsolete session', async () => {
  let release!: () => void;
  pending = new Promise<void>((resolve) => { release = resolve; });
  const request = listProjectTasks(A, 'p-a');
  await Promise.resolve(); await Promise.resolve();
  offline = true;
  isCurrent.mockReturnValue(false);
  release();
  await expect(request).rejects.toMatchObject({ reason: 'session' });
});
test('failed photo deletion preserves task for explicit retry', async () => {
  const row = await createTask(A, 'p-a', draft);
  jest.mocked(listTaskPhotosForDeletion).mockResolvedValue([{ id: 'photo-1' } as never]);
  jest.mocked(deleteSavedPhoto).mockRejectedValueOnce(new Error('storage offline'));
  await expect(removeTaskWithPhotos(A, 'p-a', row.id)).rejects.toThrow();
  expect(await listProjectTasks(A, 'p-a')).toHaveLength(1);
});
test('Won/Lost restriction blocks task photo cleanup before mutations', async () => {
  const row = await createTask(A, 'p-a', draft);
  projectStatus = 'lost';
  await expect(removeTaskWithPhotos(A, 'p-a', row.id)).rejects.toMatchObject({ reason: 'locked' });
  expect(deleteSavedPhoto).not.toHaveBeenCalled();
});
