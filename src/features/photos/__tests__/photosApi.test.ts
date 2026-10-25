import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { uploadStagedPhoto, listSavedPhotos, signPhotoUrl, PhotoFailure } from '../photosApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';

jest.mock('expo-file-system', () => ({ File: jest.fn(), UploadType: { BINARY_CONTENT: 0 } }));
jest.mock('../photoQueue', () => ({ loadPendingPhotos: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '33333333-3333-4333-8333-333333333333') }));
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));

const user = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const path = `${user}/${project}/${id}.jpg`;
const saved = { id, user_id: user, project_id: project, task_id: null, storage_path: path,
  source: 'site_visit' as const, state: 'active' as const, created_at: 'now', updated_at: 'now' };
const staged = { uri: 'file:///tmp/processed.jpg', mimeType: 'image/jpeg' as const,
  width: 1800, height: 1000, sizeBytes: 4, source: 'site_visit' as const,
  projectId: project, taskId: null };

const storage = { upload: jest.fn(), createSignedUrl: jest.fn() };
const query: any = {};
for (const method of ['select', 'eq', 'order', 'range']) query[method] = jest.fn(() => query);
query.maybeSingle = jest.fn();
query.single = jest.fn();
query.insert = jest.fn(() => query);
const client = { from: jest.fn(() => query), storage: { from: jest.fn(() => storage) } };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({ userId: user, accessToken: 'token' } as never);
  jest.mocked(File).mockImplementation(() => ({ exists: true, size: 4,
    arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0x12]).buffer } as never));
  query.maybeSingle.mockResolvedValue({ data: { id: project }, error: null });
  query.single.mockResolvedValue({ data: saved, error: null });
  query.range.mockReturnValue(query);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [saved], error: null }).then(resolve);
  storage.upload.mockResolvedValue({ data: { path }, error: null });
  storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://private.example/signed' }, error: null });
});
test('uploads actual JPEG buffer to private bucket, writes record AFTER upload with exact owner and direct association', async () => {
  const events: string[] = [];
  storage.upload.mockImplementation(async () => { events.push('storage'); return { data: { path }, error: null }; });
  query.insert.mockImplementation(() => { events.push('metadata'); return query; });
  expect(await uploadStagedPhoto(user, { projectId: project, taskId: null }, staged)).toEqual(saved);
  expect(events).toEqual(['storage', 'metadata']);
  expect(client.storage.from).toHaveBeenCalledWith('project-site-photos');
  expect(storage.upload).toHaveBeenCalledWith(path, expect.any(ArrayBuffer),
    { contentType: 'image/jpeg', upsert: false, cacheControl: '300' });
  expect(query.insert).toHaveBeenCalledWith({ id, user_id: user, project_id: project,
    task_id: null, source: 'site_visit', storage_path: path });
});
test('rejects a mismatched project or task association before sending any bytes', async () => {
  await expect(uploadStagedPhoto(user, { projectId: project, taskId: 'other' }, staged))
    .rejects.toMatchObject({ reason: 'invalid' });
  expect(storage.upload).not.toHaveBeenCalled();
});
test('task must be in same project and owner even if caller passes an ID', async () => {
  query.maybeSingle.mockResolvedValueOnce({ data: { id: project }, error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  await expect(uploadStagedPhoto(user, { projectId: project, taskId: 't' },
    { ...staged, taskId: 't' })).rejects.toMatchObject({ reason: 'not_found' });
  expect(storage.upload).not.toHaveBeenCalled();
});
test('storage failure never creates metadata', async () => {
  storage.upload.mockResolvedValue({ data: null, error: new Error('denied') });
  await expect(uploadStagedPhoto(user, { projectId: project, taskId: null }, staged))
    .rejects.toMatchObject({ reason: 'storage' });
  expect(query.insert).not.toHaveBeenCalled();
});
test('metadata failure reports incomplete upload (Phase 2C orphan cleanup)', async () => {
  query.single.mockResolvedValue({ data: null, error: new Error('db') });
  await expect(uploadStagedPhoto(user, { projectId: project, taskId: null }, staged))
    .rejects.toMatchObject({ reason: 'metadata' });
});
test('list task images applies exact task ID, excluding direct images and siblings', async () => {
  await listSavedPhotos(user, project, 'task-1');
  expect(query.eq).toHaveBeenCalledWith('task_id', 'task-1');
  expect(query.eq).toHaveBeenCalledWith('state', 'active');
});
test('short lived signed URL and owner guard, never a public URL', async () => {
  expect(await signPhotoUrl(user, saved)).toBe('https://private.example/signed');
  expect(storage.createSignedUrl).toHaveBeenCalledWith(path, 300);
  await expect(signPhotoUrl('some-other-user', saved)).rejects.toMatchObject({ reason: 'not_found' });
});
test('account switch during upload blocks metadata creation', async () => {
  storage.upload.mockImplementation(async () => {
    jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
    return { data: { path }, error: null };
  });
  await expect(uploadStagedPhoto(user, { projectId: project, taskId: null }, staged))
    .rejects.toMatchObject({ reason: 'session' });
  expect(query.insert).not.toHaveBeenCalled();
});
