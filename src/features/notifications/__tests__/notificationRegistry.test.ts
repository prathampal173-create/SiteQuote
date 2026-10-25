import Storage from 'expo-sqlite/kv-store';
import { notificationRegistry } from '../notificationRegistry';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const R = '11111111-1111-4111-8111-111111111111';
let mockSaved: Record<string,string> = {};
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockSaved[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockSaved[key] = value; })
}}));
beforeEach(() => { mockSaved = {}; jest.clearAllMocks(); });
test('writes opaque per-account state without customer or session data', async () => {
  const entries = [{ ownerId: A, reminderId: R, nativeId: 'os-1', dueMs: 1999999999999 },
    { ownerId: B, reminderId: R, nativeId: 'os-2', dueMs: 1999999999999 }];
  await notificationRegistry.write(entries);
  expect(await notificationRegistry.read()).toEqual(entries);
  expect(JSON.stringify(mockSaved)).not.toContain('customer_name');
  expect(Storage.setItem).toHaveBeenCalledTimes(1);
});
test('rejects invalid journal type and ignores malformed entries', async () => {
  mockSaved['sitequote:local-reminder-notifications:v1'] = '{}';
  await expect(notificationRegistry.read()).rejects.toThrow('damaged');
  mockSaved['sitequote:local-reminder-notifications:v1'] = JSON.stringify([
    { ownerId:'not-an-owner',reminderId:R,nativeId:'x',dueMs:100 },
    { ownerId:A,reminderId:R,nativeId:'valid',dueMs:200 }
  ]);
  expect(await notificationRegistry.read()).toHaveLength(1);
});
