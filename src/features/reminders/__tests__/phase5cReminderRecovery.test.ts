/** Phase 5C: PostgREST network failures after a possible database commit.
 * These are client-side mocks, NOT PostgreSQL transaction/RLS tests.
 */
import { deleteReminder, setReminderStatus } from '../remindersApi';
import { projectRequest } from '../../projects/projectsApi';
import type { Reminder } from '../reminderModel';

jest.mock('../../projects/projectsApi', () => ({ projectRequest: jest.fn() }));
const owner = '11111111-1111-4111-8111-111111111111';
const reminder: Reminder = {
  id: '33333333-3333-4333-8333-333333333333', user_id: owner,
  lead_id: '22222222-2222-4222-8222-222222222222', project_id: null,
  title: 'Site visit', kind: 'site_visit', note: null, due_at: '2026-11-01T00:00:00Z',
  status: 'open', completed_at: null, created_at: '2026-10-23T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z', client_request_id: null
};
let saved: Reminder | null;
let updateCount: number;
let deleteCount: number;
let updateFailure: boolean;
let deleteFailure: boolean;
let readFailure: boolean;
function query() {
  let op: 'read' | 'update' | 'delete' = 'read';
  let status: Reminder['status'] = 'open';
  const builder: Record<'select' | 'eq' | 'update' | 'delete' | 'maybeSingle', jest.Mock> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    update: jest.fn((values: { status: Reminder['status'] }) => { op = 'update'; status = values.status; return builder; }),
    delete: jest.fn(() => { op = 'delete'; return builder; }),
    maybeSingle: jest.fn(async () => {
      if (op === 'read') return readFailure ? { data: null, error: new Error('offline') } : { data: saved, error: null };
      if (op === 'update') {
        updateCount++;
        if (!saved) return { data: null, error: null };
        saved = { ...saved, status };
        return updateFailure ? { data: null, error: new Error('lost update response') } : { data: saved, error: null };
      }
      deleteCount++;
      saved = null;
      return deleteFailure ? { data: null, error: new Error('lost delete response') } : { data: { id: reminder.id }, error: null };
    })
  };
  return builder;
}
beforeEach(() => {
  jest.clearAllMocks(); saved = { ...reminder }; updateCount = deleteCount = 0;
  updateFailure = deleteFailure = readFailure = false;
  jest.mocked(projectRequest).mockImplementation(async (_accountId, fn) => fn({ from: () => query() } as never));
});

test('lost update response resolves persisted Completed without replaying transition', async () => {
  updateFailure = true;
  await expect(setReminderStatus(owner, reminder, 'completed')).resolves.toMatchObject({ status: 'completed' });
  expect(updateCount).toBe(1);
});
test('unavailable follow-up read does not claim ambiguous completion succeeded', async () => {
  updateFailure = readFailure = true;
  await expect(setReminderStatus(owner, reminder, 'completed')).rejects.toBeTruthy();
  expect(updateCount).toBe(1);
});
test('idempotent already-Completed call does not rewrite persisted row', async () => {
  saved = { ...reminder, status: 'completed' };
  await expect(setReminderStatus(owner, saved, 'completed')).resolves.toMatchObject({ status: 'completed' });
  expect(updateCount).toBe(0);
});
test('lost delete response resolves authenticated saved absence', async () => {
  deleteFailure = true;
  await expect(deleteReminder(owner, reminder)).resolves.toBeUndefined();
  expect(deleteCount).toBe(1);
});
test('unavailable delete-reconciliation read does not claim success', async () => {
  deleteFailure = readFailure = true;
  await expect(deleteReminder(owner, reminder)).rejects.toBeTruthy();
  expect(deleteCount).toBe(1);
});
test('foreign owner rejected without issuing a DELETE', async () => {
  expect(() => deleteReminder(owner, { ...reminder, user_id: 'another-account' })).toThrow('not_found');
  expect(deleteCount).toBe(0);
});
