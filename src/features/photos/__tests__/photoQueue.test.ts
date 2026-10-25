import { File } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import * as Crypto from 'expo-crypto';
import { clearPendingPhoto, loadPendingPhotos, stagePendingPhoto } from '../photoQueue';

jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(), setItem: jest.fn()
} }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '33333333-3333-4333-8333-333333333333') }));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///durable/' },
  File: jest.fn()
}));
const files = new Set<string>();
const memory = new Map<string, string>();
const photo = { uri: 'file:///cache/original.jpg', source: 'site_visit' as const,
  mimeType: 'image/jpeg' as const, width: 900, height: 800, sizeBytes: 5,
  projectId: 'project-1', taskId: null };
const key = 'sitequote:photo-pending:v1:owner-1:project-1:direct';
beforeEach(() => {
  jest.clearAllMocks(); memory.clear(); files.clear();
  jest.mocked(Storage.getItem).mockImplementation(async (name) => memory.get(name) ?? null);
  jest.mocked(Storage.setItem).mockImplementation(async (name, value) => { memory.set(name, typeof value === 'function' ? value(memory.get(name) ?? null) : value); });
  jest.mocked(File).mockImplementation((...parts: any[]) => {
    const uri = parts.map((part) => typeof part === 'string' ? part : '').join('');
    return { uri, get exists() { return files.has(uri); },
      copy: async (dest: { uri: string }) => { files.add(dest.uri); },
      delete: () => { files.delete(uri); } } as never;
  });
});
test('durably stages processed bytes and reloads only exact owner/project/task journal', async () => {
  const entry = await stagePendingPhoto('owner-1', photo);
  expect(jest.mocked(Crypto.randomUUID)).toHaveBeenCalled();
  expect(entry.id).toBe('33333333-3333-4333-8333-333333333333');
  expect(entry.photo.uri).toContain('sitequote-pending-owner-1-33333333');
  expect(memory.has(key)).toBe(true);
  expect(await loadPendingPhotos('owner-1', 'project-1', null)).toHaveLength(1);
  expect(await loadPendingPhotos('owner-2', 'project-1', null)).toHaveLength(0);
  expect(await loadPendingPhotos('owner-1', 'project-1', 'task-2')).toHaveLength(0);
  await clearPendingPhoto('owner-1', entry);
  expect(await loadPendingPhotos('owner-1', 'project-1', null)).toHaveLength(0);
  expect(files.has(entry.photo.uri)).toBe(false);
});
test('journal write failure preserves original picked file but leaves no orphan local copy', async () => {
  jest.mocked(Storage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(stagePendingPhoto('owner-1', photo)).rejects.toThrow('disk full');
  expect([...files]).toHaveLength(0);
  expect(await loadPendingPhotos('owner-1', 'project-1', null)).toEqual([]);
});
