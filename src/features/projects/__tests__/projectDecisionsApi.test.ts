import { markProjectLost, reopenProject } from '../projectDecisionsApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
import type { Project } from '../projectModel';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const first: Project = { id: 'p1', user_id: A, lead_id: 'lead', title: 'Kitchen',
  site_address: null, notes: null, status: 'draft', accepted_quote_id: null,
  tax_bps: 0, created_at: '2026-10-22', updated_at: '2026-10-22' };
const projects = [first, { ...first, id: 'p2', title: 'Bathroom' }];
let rows: Project[];
let serverFail: string | null;
let delayed: Promise<void> | null;
const rpc = jest.fn(async (name: string, args: { p_project_id: string }) => {
  if (delayed) await delayed;
  if (serverFail) return { data: null, error: { code: serverFail } };
  const row = rows.find((p) => p.id === args.p_project_id && p.user_id === A);
  if (!row) return { data: null, error: { code: '42501' } };
  if (name === 'mark_project_lost' && !['draft', 'quote_sent'].includes(row.status) ||
      name === 'reopen_project' && !['won', 'lost'].includes(row.status)) {
    return { data: null, error: { code: '23514' } };
  }
  const status = name === 'mark_project_lost' ? 'lost' : 'draft';
  Object.assign(row, { status, accepted_quote_id: null });
  return { data: { ...row }, error: null };
});
const session = jest.mocked(validateServerSession);

beforeEach(() => {
  rows = projects.map((row) => ({ ...row })); serverFail = null; delayed = null; rpc.mockClear();
  jest.mocked(getSupabaseClient).mockReturnValue({ rpc } as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  session.mockReset();
  session.mockResolvedValue({ userId: A, accessToken: 'A-token', expiresAtMs: Date.now() + 60000 });
});

test('Mark Lost persists only selected project, Reopen restores Draft, sibling untouched', async () => {
  expect((await markProjectLost(A, 'p1')).status).toBe('lost');
  expect(rows[1]?.status).toBe('draft');
  expect((await reopenProject(A, 'p1')).status).toBe('draft');
  expect(rows[1]?.status).toBe('draft');
  expect(rpc).toHaveBeenNthCalledWith(1, 'mark_project_lost', { p_project_id: 'p1' });
  expect(session).toHaveBeenCalledWith(expect.anything(), undefined, 'A-token');
});

test('invalid transition, missing project and network error are rejected without synthetic success', async () => {
  await expect(reopenProject(A, 'p1')).rejects.toMatchObject({ reason: 'invalid' });
  await expect(markProjectLost(A, 'none')).rejects.toMatchObject({ reason: 'not_found' });
  serverFail = '08006';
  await expect(markProjectLost(A, 'p1')).rejects.toMatchObject({ reason: 'request' });
  expect(rows[0]?.status).toBe('draft');
  serverFail = null;
  await expect(markProjectLost(A, 'p1')).resolves.toMatchObject({ status: 'lost' });
});

test('cross-account rejects before issuing RPC; server checks owner if request reaches RPC', async () => {
  session.mockResolvedValue({ userId: B, accessToken: 'B-token', expiresAtMs: Date.now() + 60000 });
  await expect(markProjectLost(A, 'p1')).rejects.toMatchObject({ reason: 'session' });
  expect(rpc).not.toHaveBeenCalled();
  session.mockResolvedValue({ userId: A, accessToken: 'A-token', expiresAtMs: Date.now() + 60000 });
  await expect(markProjectLost(A, 'foreign-project')).rejects.toMatchObject({ reason: 'not_found' });
});

test('late old-account result fails closed after session/client change', async () => {
  let resolve!: () => void;
  delayed = new Promise<void>((res) => { resolve = res; });
  const pending = markProjectLost(A, 'p1');
  for (let attempt = 0; attempt < 20 && rpc.mock.calls.length === 0; attempt++) await Promise.resolve();
  expect(rpc).toHaveBeenCalledTimes(1);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
  resolve();
  await expect(pending).rejects.toMatchObject({ reason: 'session' });
});


test('Quote Sent project may become Lost without changing another project', async () => {
  rows[0]!.status = 'quote_sent';
  expect((await markProjectLost(A, 'p1')).status).toBe('lost');
  expect(rows[1]?.status).toBe('draft');
});
