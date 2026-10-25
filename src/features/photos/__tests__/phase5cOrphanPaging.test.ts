/** Mocked pagination checks complement the real-backend repair regression. */
import { cleanupProjectPhotos } from '../photosApi';
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
const pendingPhotoId = '33333333-3333-4333-8333-333333333333';
const taskIds = Array.from({ length: 201 }, (_, i) => `task-${String(i).padStart(3, '0')}`);
let failTaskPage = false;
const remove = jest.fn(async () => ({ error: null }));
const list = jest.fn(async () => ({ data: [{ name: `${pendingPhotoId}.jpg`,
  created_at: '2026-10-01T00:00:00Z' }], error: null }));
const from = jest.fn((table: string) => {
  const q: any = {
    select: jest.fn(() => q), eq: jest.fn(() => q), order: jest.fn(() => q),
    range: jest.fn(async (start: number) => {
      if (table === 'project_photos') return { data: [], error: null };
      if (table === 'project_tasks') return start === 200 && failTaskPage ?
        { data: null, error: new Error('page 2 unavailable') } :
        { data: taskIds.slice(start, start + 200).map((id) => ({ id })), error: null };
      return { data: [], error: null };
    }),
    maybeSingle: jest.fn(async () => ({ data: table === 'projects' ? { id: project } : null, error: null }))
  };
  return q;
});

beforeEach(() => {
  jest.clearAllMocks(); failTaskPage = false;
  jest.mocked(getSupabaseClient).mockReturnValue({ from, storage: { from: () => ({ list, remove }) } } as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({ userId: owner, accessToken: 'test-only' } as never);
  jest.mocked(loadPendingPhotos).mockImplementation(async (_user, _project, taskId) =>
    taskId === taskIds[200] ? [{ id: pendingPhotoId } as never] : []);
});

test('pending journal on task 201 prevents an untracked-file report despite the row cap', async () => {
  expect(await cleanupProjectPhotos(owner, project)).toEqual({ recovered: 0, orphaned: 0 });
  expect(remove).not.toHaveBeenCalled();
  expect(from).toHaveBeenCalledWith('project_tasks');
});

test('failure on the second task page aborts repair', async () => {
  failTaskPage = true;
  await expect(cleanupProjectPhotos(owner, project)).rejects.toMatchObject({ reason: 'read' });
  expect(remove).not.toHaveBeenCalled();
});
