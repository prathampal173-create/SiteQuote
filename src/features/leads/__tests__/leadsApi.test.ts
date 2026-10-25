import { addManualHistory, createLead, LeadFailure, listLeadHistory, listLeads, loadLead, updateLead, updateLeadStage } from '../leadsApi';
import { EMPTY_LEAD, type Activity, type Lead } from '../leadModel';
import { validateServerSession } from '../../auth/sessionValidation';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));

type Result = { data?: unknown; error: unknown };
function builder(result: Result | Promise<Result>) {
  const b = {
    select: jest.fn(), eq: jest.fn(), order: jest.fn(), range: jest.fn(), maybeSingle: jest.fn(),
    single: jest.fn(), insert: jest.fn(), update: jest.fn()
  };
  b.select.mockReturnValue(b); b.eq.mockReturnValue(b); b.order.mockReturnValue(b);
  b.insert.mockReturnValue(b); b.update.mockReturnValue(b);
  b.range.mockImplementation(() => result); b.single.mockImplementation(() => result);
  b.maybeSingle.mockImplementation(() => result);
  return b;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const draft = { ...EMPTY_LEAD, customerName: 'Customer', phone: '555' };
const row: Lead = { id: 'L', user_id: A, customer_name: 'Customer', phone: '555', email: null,
  source: 'Referral', notes: null, contact_stage: 'new', created_at: '2026-10-21', updated_at: '2026-10-21' };
const activity: Activity = { id: 'H', lead_id: 'L', user_id: A, type: 'manual_note', project_id: null,
  detail: { note: 'Visited site' }, created_at: '2026-10-22T10:00:00Z' };
const mockClient = { from: jest.fn() };
const validate = jest.mocked(validateServerSession);

beforeEach(() => {
  jest.mocked(getSupabaseClient).mockReturnValue(mockClient as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  validate.mockResolvedValue({ userId: A, accessToken: 'tokenA', expiresAtMs: Date.now() + 60000 });
  mockClient.from.mockReset();
});

test('creates lead with validated identity, owner ID and no arbitrary fields', async () => {
  const b = builder({ data: row, error: null }); mockClient.from.mockReturnValue(b);
  expect(await createLead(A, draft)).toEqual(row);
  expect(mockClient.from).toHaveBeenCalledWith('leads');
  expect(b.insert).toHaveBeenCalledWith({ user_id: A, customer_name: 'Customer',
    phone: '555', email: null, source: 'Referral', notes: null, contact_stage: 'new' });
  expect(validate).toHaveBeenCalledTimes(2);
});

test('invalid lead is rejected before any network work', async () => {
  await expect(createLead(A, EMPTY_LEAD)).rejects.toMatchObject({ reason: 'invalid' });
  expect(mockClient.from).not.toHaveBeenCalled();
});

test('updates contact stage and reads persisted stage', async () => {
  const updated = { ...row, contact_stage: 'site_visit_completed' as const };
  const b = builder({ data: updated, error: null }); mockClient.from.mockReturnValue(b);
  expect((await updateLead(A, 'L', { ...draft, contactStage: 'site_visit_completed' })).contact_stage)
    .toBe('site_visit_completed');
  expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ contact_stage: 'site_visit_completed' }));
  expect(b.eq).toHaveBeenCalledWith('user_id', A);
  expect(b.eq).toHaveBeenCalledWith('id', 'L');
  expect((await loadLead(A, 'L')).contact_stage).toBe('site_visit_completed');
});

test('detail stage correction updates only contact_stage and never overwrites customer fields', async () => {
  const corrected = { ...row, contact_stage: 'contacted' as const };
  const b = builder({ data: corrected, error: null }); mockClient.from.mockReturnValue(b);
  expect((await updateLeadStage(A, 'L', 'contacted')).contact_stage).toBe('contacted');
  expect(b.update).toHaveBeenCalledWith({ contact_stage: 'contacted' });
  expect(b.eq).toHaveBeenCalledWith('user_id', A);
  expect(b.eq).toHaveBeenCalledWith('id', 'L');
  await expect(updateLeadStage(A, 'L', 'won' as never)).rejects.toMatchObject({ reason: 'invalid' });
});

test('appends manual notes as distinct activities and returns chronological history', async () => {
  const b = builder({ data: activity, error: null }); mockClient.from.mockReturnValue(b);
  expect(await addManualHistory(A, 'L', '  Visited site  ')).toEqual(activity);
  expect(b.insert).toHaveBeenCalledWith({ user_id: A, lead_id: 'L', type: 'manual_note', detail: { note: 'Visited site' } });
  await expect(addManualHistory(A, 'L', '  ')).rejects.toMatchObject({ reason: 'invalid' });
  const old = { ...activity, id: 'H0', created_at: '2026-10-20T10:00:00Z' };
  const history = builder({ data: [activity, old], error: null }); mockClient.from.mockReturnValue(history);
  expect((await listLeadHistory(A, 'L')).map((item) => item.id)).toEqual(['H0', 'H']);
  expect(history.range).toHaveBeenCalledWith(0, 199);
});


test('lead history paginates beyond the backend cap without losing old quote or decision activities', async () => {
  const events = Array.from({ length: 425 }, (_, i): Activity => ({
    ...activity, id: `activity-${String(i).padStart(4, '0')}`,
    created_at: `2026-10-23T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`
  }));
  const pages = [events.slice(0, 200), events.slice(200, 400), events.slice(400)];
  const queries = pages.map((data) => builder({ data, error: null }));
  queries.forEach((query) => mockClient.from.mockReturnValueOnce(query));
  const saved = await listLeadHistory(A, 'L');
  expect(saved).toHaveLength(425);
  expect(saved.map((e) => e.id)).toEqual(events.map((e) => e.id));
  expect(queries.map((q) => q.range.mock.calls[0])).toEqual([[0, 199], [200, 399], [400, 599]]);
  queries.forEach((query) => {
    expect(query.eq).toHaveBeenCalledWith('user_id', A);
    expect(query.eq).toHaveBeenCalledWith('lead_id', 'L');
  });
});

test('lead history pagination stops on database failure instead of showing incomplete audit history', async () => {
  const events = Array.from({ length: 200 }, (_, i): Activity => ({ ...activity, id: String(i) }));
  mockClient.from.mockReturnValueOnce(builder({ data: events, error: null }))
    .mockReturnValueOnce(builder({ data: null, error: { message: 'backend failed' } }));
  await expect(listLeadHistory(A, 'L')).rejects.toMatchObject({ reason: 'request' });
});

test('network failure does not invent persistence; retry succeeds', async () => {
  mockClient.from.mockReturnValueOnce(builder({ data: null, error: { message: 'offline' } }))
    .mockReturnValueOnce(builder({ data: row, error: null }));
  await expect(createLead(A, draft)).rejects.toMatchObject({ reason: 'request' });
  expect(await createLead(A, draft)).toEqual(row);
});

test('unauthenticated, cross-account or revoked sessions fail closed before table queries', async () => {
  validate.mockResolvedValueOnce(null);
  await expect(listLeads(A)).rejects.toBeInstanceOf(LeadFailure);
  validate.mockResolvedValueOnce({ userId: A, accessToken: 'tokenA', expiresAtMs: Date.now()+60000 });
  await expect(loadLead(B, 'L')).rejects.toMatchObject({ reason: 'session' });
  expect(mockClient.from).not.toHaveBeenCalled();
});

test('retired client and account switching prevent old responses being accepted', async () => {
  let resolve!: (result: Result) => void;
  const pending = new Promise<Result>((r) => { resolve = r; });
  const b = builder(pending); mockClient.from.mockReturnValue(b);
  const operation = loadLead(A, 'L');
  // Wait for the async session verification to enter the data request.
  for (let tick = 0; tick < 12 && mockClient.from.mock.calls.length === 0; tick++) {
    await Promise.resolve();
  }
  expect(mockClient.from).toHaveBeenCalledWith('leads');
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
  resolve({ data: row, error: null });
  await expect(operation).rejects.toMatchObject({ reason: 'session' });
});

test('explicit owner-scoped pagination reads beyond the 1,000-row default cap', async () => {
  const page = Array.from({ length: 200 }, (_, i) => ({ ...row, id: `${i}` }));
  const first = builder({ data: page, error: null });
  const second = builder({ data: [row], error: null });
  mockClient.from.mockReturnValueOnce(first).mockReturnValueOnce(second);
  expect(await listLeads(A)).toHaveLength(201);
  expect(first.range).toHaveBeenCalledWith(0, 199);
  expect(second.range).toHaveBeenCalledWith(200, 399);
});
