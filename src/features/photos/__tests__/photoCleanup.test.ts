import { cleanupProjectPhotos, deleteSavedPhoto } from '../photosApi';
import { loadPendingPhotos } from '../photoQueue';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';

jest.mock('expo-file-system', () => ({ File: jest.fn(), UploadType: { BINARY_CONTENT: 0 } }));
jest.mock('../photoQueue', () => ({ loadPendingPhotos: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../../config/env', () => ({ getBackendConfiguration: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const folder = `${owner}/${project}`;
const filename = `${id}.jpg`;
const path = `${folder}/${filename}`;
const oldDate = '2026-10-01T10:00:00.000Z';
const freshDate = '2099-01-01T10:00:00.000Z';
let fileDate = oldDate;
let containsFile = true;
let metadata: null | { id: string; user_id: string; project_id: string; task_id: null;
  storage_path: string; source: 'site_visit'; state: 'active' | 'deleting'; created_at: string; updated_at: string } = null;
let startPending: boolean;
let finalPending: boolean;
let removeWithoutDeleting: boolean;
const remove = jest.fn(async () => {
  if (!removeWithoutDeleting) containsFile = false;
  return { error: null, data: [] };
});
const list = jest.fn(async (_folder: string, args: { search?: string }): Promise<{
  data: { name: string; created_at: string }[]; error: Error | null
}> => {
  const files = containsFile ? [{ name: filename, created_at: fileDate }] : [];
  return { data: args.search ? files.filter((file) => file.name.includes(args.search!)) : files, error: null };
});
const from = jest.fn((table: string) => {
  let action: 'update' | 'delete' | '' = '';
  let updatedState = '';
  const q: any = {
    select: jest.fn(() => q), eq: jest.fn(() => q), order: jest.fn(() => q),
    range: jest.fn(async () => ({ data: table === 'project_photos' && metadata ? [metadata] : [], error: null })),
    update: jest.fn((values: { state: string }) => { action = 'update'; updatedState = values.state; return q; }),
    delete: jest.fn(() => { action = 'delete'; return q; }),
    maybeSingle: jest.fn(async () => {
      if (table === 'projects') return { data: { id: project }, error: null };
      if (action === 'update' && metadata) {
        metadata = { ...metadata, state: updatedState as 'deleting' };
        return { data: { id }, error: null };
      }
      if (action === 'delete' && metadata && !containsFile) {
        metadata = null;
        return { data: { id }, error: null };
      }
      return { data: metadata, error: null };
    }),
    then: (resolve: (value: unknown) => unknown) => resolve({
      data: table === 'project_tasks' ? [] : null, error: null
    })
  };
  return q;
});
const client = { from, storage: { from: () => ({ list, remove }) } };
const saved = { id, user_id: owner, project_id: project, task_id: null,
  storage_path: path, source: 'site_visit' as const, state: 'active' as const,
  created_at: oldDate, updated_at: oldDate };

beforeEach(() => {
  jest.clearAllMocks();
  fileDate = oldDate; containsFile = true; metadata = null;
  startPending = false; finalPending = false; removeWithoutDeleting = false;
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({ userId: owner, accessToken: 'owner-token' } as never);
  jest.mocked(loadPendingPhotos).mockImplementation(async () =>
    (startPending ? true : finalPending && jest.mocked(loadPendingPhotos).mock.calls.length > 1)
      ? [{ id, createdAt: oldDate, photo: { projectId: project, taskId: null, uri: 'file:///pending.jpg',
        width: 2, height: 2, sizeBytes: 4, mimeType: 'image/jpeg', source: 'site_visit' } }]
      : []);
});

test('manual cleanup rejects objects younger than 24 hours', async () => {
  fileDate = freshDate;
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 0, orphaned: 0 });
  expect(remove).not.toHaveBeenCalled();
});

test('pending journal protects an orphan at initial scan', async () => {
  startPending = true;
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 0, orphaned: 0 });
  expect(remove).not.toHaveBeenCalled();
});

test('new pending journal entry protects an object after initial scan', async () => {
  finalPending = true;
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 0, orphaned: 0 });
  expect(remove).not.toHaveBeenCalled();
});

test('rechecked object age prevents cleanup if its timestamp becomes fresh', async () => {
  list.mockImplementationOnce(async () => {
    fileDate = freshDate;
    return { data: [{ name: filename, created_at: oldDate }], error: null };
  });
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 0, orphaned: 0 });
  expect(remove).not.toHaveBeenCalled();
});

test('an old upload with no local journal survives repair on another installation', async () => {
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 0, orphaned: 1 });
  expect(remove).not.toHaveBeenCalled();
  expect(containsFile).toBe(true);
});

test('repair still finishes a previously requested photo deletion', async () => {
  metadata = { ...saved, state: 'deleting' };
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 1, orphaned: 0 });
  expect(remove).toHaveBeenCalledWith([path]);
  expect(containsFile).toBe(false);
  expect(metadata).toBeNull();
});

test('Storage success with object still present does not finalize metadata', async () => {
  metadata = { ...saved };
  removeWithoutDeleting = true;
  await expect(deleteSavedPhoto(owner, saved)).rejects.toMatchObject({ reason: 'delete' });
  expect(metadata?.state).toBe('deleting');
  expect(containsFile).toBe(true);
});

test('cleanup does not trust a missing or failed Storage listing', async () => {
  list.mockResolvedValueOnce({ data: [], error: new Error('offline') });
  await expect(cleanupProjectPhotos(owner, project)).rejects.toMatchObject({ reason: 'storage' });
  expect(remove).not.toHaveBeenCalled();
});
