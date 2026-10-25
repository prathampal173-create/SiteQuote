import { File } from 'expo-file-system';
import { recoverPendingUpload, deleteSavedPhoto, PhotoFailure } from '../photosApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
import { getBackendConfiguration } from '../../../config/env';
import type { PendingPhoto } from '../photoQueue';

jest.mock('expo-file-system', () => ({ File: jest.fn(), UploadType: { BINARY_CONTENT: 0 } }));
jest.mock('../photoQueue', () => ({ loadPendingPhotos: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
jest.mock('../../../config/env', () => ({ getBackendConfiguration: jest.fn() }));

const user = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const path = `${user}/${project}/${photoId}.jpg`;
const pending: PendingPhoto = { id: photoId, createdAt: '2026-10-23T10:00:00Z', photo: {
  uri: 'file:///durable.jpg', mimeType: 'image/jpeg', width: 800, height: 600,
  sizeBytes: 4, source: 'site_visit', projectId: project, taskId: null
} };
const saved = { id: photoId, user_id: user, project_id: project, task_id: null,
  storage_path: path, source: 'site_visit' as const, state: 'active' as const,
  created_at: 'now', updated_at: 'now' };
const files = new Set<string>();
let metadata: typeof saved | (Omit<typeof saved, 'state'> & { state: 'deleting' }) | null;
let failMetadata = false;
let failRemoval = false;
let uploadCount: number;
const transfer = jest.fn();
const storage = {
  list: jest.fn(async () => ({ data: files.has(path) ? [{ name: `${photoId}.jpg` }] : [], error: null })),
  remove: jest.fn(async () => {
    if (failRemoval) return { data: null, error: new Error('offline') };
    files.delete(path);
    return { data: [], error: null };
  })
};
const from = jest.fn((table: string) => {
  const filters: Record<string, unknown> = {};
  let op = ''; let input: any;
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn((key: string, value: unknown) => { filters[key] = value; return q; }),
    insert: jest.fn((value: any) => { op = 'insert'; input = value; return q; }),
    update: jest.fn((value: any) => { op = 'update'; input = value; return q; }),
    delete: jest.fn(() => { op = 'delete'; return q; }),
    maybeSingle: jest.fn(async () => resolve()),
    single: jest.fn(async () => resolve())
  };
  async function resolve() {
    if (table === 'projects') return { data: { id: project }, error: null };
    if (table !== 'project_photos') throw new Error(`Unexpected ${table}`);
    if (op === 'insert') {
      if (failMetadata) return { data: null, error: new Error('metadata') };
      if (metadata) return { data: null, error: new Error('duplicate') };
      metadata = { ...saved, ...input }; return { data: metadata, error: null };
    }
    if (op === 'update') {
      if (!metadata || metadata.state !== filters.state) return { data: null, error: null };
      metadata = { ...metadata, ...input };
      return { data: { id: photoId }, error: null };
    }
    if (op === 'delete') {
      if (!metadata || metadata.state !== filters.state || files.has(path))
        return { data: null, error: new Error('FK/object guard') };
      metadata = null; return { data: { id: photoId }, error: null };
    }
    return { data: metadata, error: null };
  }
  return q;
});
const client = { from, storage: { from: jest.fn(() => storage) } };

beforeEach(() => {
  jest.clearAllMocks();
  files.clear(); metadata = null; failMetadata = false; failRemoval = false; uploadCount = 0;
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({ userId: user, accessToken: 'signed-token' } as never);
  jest.mocked(getBackendConfiguration).mockReturnValue({ status: 'ready', url: 'https://example.supabase.co/',
    publishableKey: 'sb_publishable_test' });
  transfer.mockImplementation(async () => { uploadCount++; files.add(path); return { status: 200 }; });
  jest.mocked(File).mockImplementation(() => ({ exists: true, size: 4,
    arrayBuffer: async () => Uint8Array.from([255, 216, 255, 12]).buffer,
    createUploadTask: (_url: string, options: any) => ({ uploadAsync: () => {
      options.onProgress?.({ bytesSent: 2, totalBytes: 4 });
      return transfer();
    } }) } as never));
});

test('one UUID across retries, real native upload progress and metadata saved once', async () => {
  const progress = jest.fn();
  await expect(recoverPendingUpload(user, pending, progress)).resolves.toMatchObject(saved);
  expect(progress).toHaveBeenCalledWith(50);
  expect(progress).toHaveBeenCalledWith(100);
  expect(uploadCount).toBe(1);
  await expect(recoverPendingUpload(user, pending)).resolves.toMatchObject(saved);
  expect(uploadCount).toBe(1);
});
test('failed metadata insert leaves storage object for retry without reupload', async () => {
  failMetadata = true;
  await expect(recoverPendingUpload(user, pending)).rejects.toMatchObject({ reason: 'metadata' });
  expect(files.has(path)).toBe(true);
  failMetadata = false;
  await expect(recoverPendingUpload(user, pending)).resolves.toMatchObject(saved);
  expect(uploadCount).toBe(1);
});
test('uncertain upload response with completed object still commits metadata once', async () => {
  transfer.mockImplementationOnce(async () => { uploadCount++; files.add(path); throw new Error('lost response'); });
  await expect(recoverPendingUpload(user, pending)).resolves.toMatchObject(saved);
  expect(uploadCount).toBe(1);
});
test('wrong identity cannot recover or delete another account photo', async () => {
  await expect(recoverPendingUpload('different-account', pending)).rejects.toBeInstanceOf(PhotoFailure);
  await expect(deleteSavedPhoto('different-account', saved)).rejects.toMatchObject({ reason: 'not_found' });
  expect(uploadCount).toBe(0);
});
test('two-phase deletion is idempotent; partial Storage failure keeps deleting metadata', async () => {
  files.add(path); metadata = { ...saved };
  failRemoval = true;
  await expect(deleteSavedPhoto(user, saved)).rejects.toMatchObject({ reason: 'delete' });
  expect(metadata?.state).toBe('deleting');
  expect(files.has(path)).toBe(true);
  failRemoval = false;
  await deleteSavedPhoto(user, saved);
  expect(metadata).toBeNull();
  expect(files.has(path)).toBe(false);
  await expect(deleteSavedPhoto(user, saved)).resolves.toBeUndefined();
});
test('account switch after native upload blocks metadata insert', async () => {
  transfer.mockImplementationOnce(async () => {
    files.add(path); jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
    return { status: 200 };
  });
  await expect(recoverPendingUpload(user, pending)).rejects.toMatchObject({ reason: 'session' });
  expect(metadata).toBeNull();
});
