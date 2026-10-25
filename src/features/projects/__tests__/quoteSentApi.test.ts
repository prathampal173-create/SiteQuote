import { listQuoteSentLeadIds } from '../quoteSentApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
const A = 'owner-A';
let statusRows: { lead_id: string; status: string; user_id: string }[] = [];
let pending: Promise<void> | null = null;
let rejectQuery = false;
const eq = jest.fn();
const client = { from: jest.fn(() => {
  const filters: Record<string, unknown> = {};
  const query: Record<'select' | 'eq' | 'order' | 'range', jest.Mock> = { select: jest.fn(() => query),
    eq: jest.fn((col: string, value: unknown) => { eq(col, value); filters[col] = value; return query; }),
    order: jest.fn(() => query),
    range: jest.fn(async (start: number, end: number) => {
      if (pending) await pending;
      if (rejectQuery) return { data: null, error: { message: 'offline' } };
      const rows = statusRows.filter((row) => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value));
      return { data: rows.slice(start, end + 1).map(({ lead_id }) => ({ lead_id })), error: null };
    }) };
  return query;
}) };

beforeEach(() => {
  statusRows = []; pending = null; rejectQuery = false;
  client.from.mockClear(); eq.mockClear();
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({ userId: A, accessToken: 'tokenA', expiresAtMs: Date.now()+60000 });
});

test('includes only leads with a CURRENT quote_sent child; no duplicate leads', async () => {
  statusRows = [
    { user_id: A, lead_id: 'l1', status: 'quote_sent' }, { user_id: A, lead_id: 'l1', status: 'quote_sent' },
    { user_id: A, lead_id: 'l2', status: 'won' }, { user_id: A, lead_id: 'l3', status: 'draft' },
    { user_id: 'B', lead_id: 'l4', status: 'quote_sent' }
  ];
  expect([...(await listQuoteSentLeadIds(A))]).toEqual(['l1']);
  expect(eq).toHaveBeenCalledWith('status', 'quote_sent');
  expect(eq).toHaveBeenCalledWith('user_id', A);
});

test('status changes alter derived membership on the next real query', async () => {
  statusRows = [{ user_id: A, lead_id: 'l1', status: 'quote_sent' }];
  expect((await listQuoteSentLeadIds(A)).has('l1')).toBe(true);
  statusRows[0]!.status = 'won';
  expect((await listQuoteSentLeadIds(A)).has('l1')).toBe(false);
});

test('rejects different user sessions before making any query', async () => {
  jest.mocked(validateServerSession).mockResolvedValue({ userId: 'B', accessToken: 'B', expiresAtMs: Date.now()+60000 });
  await expect(listQuoteSentLeadIds(A)).rejects.toMatchObject({ reason: 'session' });
  expect(client.from).not.toHaveBeenCalled();
});

test('rejects stale responses on account switch and reports transport errors', async () => {
  let finish!: () => void;
  pending = new Promise<void>((r) => { finish = r; });
  statusRows = [{ user_id: A, lead_id: 'l1', status: 'quote_sent' }];
  const work = listQuoteSentLeadIds(A);
  for (let i = 0; i < 12 && !client.from.mock.calls.length; i++) await Promise.resolve();
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
  finish();
  await expect(work).rejects.toMatchObject({ reason: 'session' });
  pending = null;
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  rejectQuery = true;
  await expect(listQuoteSentLeadIds(A)).rejects.toMatchObject({ reason: 'request' });
});
