import { createProject, listLeadProjects, listProjects, loadProject, ProjectFailure, updateProject } from '../projectsApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
import type { Project } from '../projectModel';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
const A = 'aaaa-account'; const B = 'bbbb-account';
const kitchen: Project = { id: 'p1', user_id: A, lead_id: 'l1', title: 'Kitchen', site_address: '11 Main',
  notes: 'Kitchen only', status: 'draft', accepted_quote_id: null, tax_bps: 0,
  created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' };
const bathroom: Project = { ...kitchen, id: 'p2', title: 'Bathroom', notes: 'Bathroom only' };
const records: Project[] = [];
let networkDown = false;
let pendingLoad: Promise<void> | null = null;
const from = jest.fn((table: string) => {
  let filters: Record<string, unknown> = {};
  let insertion: Record<string, unknown> | null = null;
  let update: Record<string, unknown> | null = null;
  let start = 0;
  let end = 199;
  const rows = () => table === 'projects' ? records.map((p) => ({ ...p })) : [
    { id: 'l1', user_id: A, customer_name: 'Customer A' },
    { id: 'l2', user_id: B, customer_name: 'Customer B' }
  ];
  const match = (row: Record<string, unknown>) => Object.entries(filters).every(([key, val]) => row[key] === val);
  const result = async (mode: 'many' | 'one') => {
    if (pendingLoad) await pendingLoad;
    if (networkDown) return { data: null, error: { code: 'NETWORK' } };
    if (insertion) {
      if (table === 'projects') {
        if (insertion.lead_id !== 'l1' || insertion.user_id !== A) return { data: null, error: { code: '23503' } };
        const project = { ...kitchen, id: `p${records.length + 1}`, ...insertion } as Project;
        records.push(project);
        return { data: project, error: null };
      }
    }
    if (update) {
      const record = records.find((p) => match(p as unknown as Record<string, unknown>));
      if (!record) return { data: null, error: null };
      Object.assign(record, update);
      return { data: { ...record }, error: null };
    }
    const matched = rows().filter((r) => match(r as Record<string, unknown>));
    return { data: mode === 'one' ? matched[0] ?? null : matched.slice(start, end + 1), error: null };
  };
  const q: Record<'select' | 'eq' | 'order' | 'range' | 'maybeSingle' | 'single' | 'insert' | 'update', jest.Mock> = {
    select: jest.fn(() => q), eq: jest.fn((field: string, value: unknown) => { filters[field] = value; return q; }),
    order: jest.fn(() => q), range: jest.fn((s: number, e: number) => { start = s; end = e; return result('many'); }),
    insert: jest.fn((value: Record<string, unknown>) => { insertion = value; return q; }),
    update: jest.fn((value: Record<string, unknown>) => { update = value; return q; }),
    maybeSingle: jest.fn(() => result('one')), single: jest.fn(() => result('one'))
  };
  return q;
});
const session = jest.mocked(validateServerSession);

beforeEach(() => {
  records.splice(0, records.length);
  networkDown = false; pendingLoad = null;
  from.mockClear();
  jest.mocked(getSupabaseClient).mockReturnValue({ from } as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  session.mockReset();
  session.mockResolvedValue({ userId: A, accessToken: 'A-token', expiresAtMs: Date.now() + 60000 });
});

test('creates two projects attached to one verified lead and reads persisted independent rows', async () => {
  expect((await createProject(A, 'l1', { title: ' Kitchen ', siteAddress: '11 Main', notes: 'Kitchen only' })).status)
    .toBe('draft');
  await createProject(A, 'l1', { title: 'Bathroom', siteAddress: '', notes: 'Bathroom only' });
  expect((await listLeadProjects(A, 'l1')).map((p) => p.title)).toEqual(['Kitchen', 'Bathroom']);
  expect((await listProjects(A)).map(({ project, leadName }) => `${project.title}-${leadName}`))
    .toEqual(['Kitchen-Customer A', 'Bathroom-Customer A']);
  expect(records.map(({ lead_id }) => lead_id)).toEqual(['l1', 'l1']);
  expect(session).toHaveBeenCalledWith(expect.anything(), undefined, 'A-token');
});

test('edit preserves status, tax, owner, lead and sibling details', async () => {
  records.push({ ...kitchen, tax_bps: 800 }, bathroom);
  const edited = await updateProject(A, 'p1', { title: 'Updated Kitchen', siteAddress: 'Second St', notes: 'Now changed' });
  expect(edited).toMatchObject({ title: 'Updated Kitchen', notes: 'Now changed',
    lead_id: 'l1', user_id: A, status: 'draft', tax_bps: 800 });
  expect(await loadProject(A, 'p2')).toMatchObject({ title: 'Bathroom', notes: 'Bathroom only' });
  expect((await listLeadProjects(A, 'l1')).find((p) => p.id === 'p1')?.site_address).toBe('Second St');
});

test('closed Won/Lost project editing never sends title, tax, site address or lead reassignment', async () => {
  records.push({ ...kitchen, status: 'won' });
  await updateProject(A, 'p1', { title: 'Attempted change', siteAddress: 'Elsewhere', notes: 'Allowed' });
  expect(records[0]).toMatchObject({ title: 'Kitchen', site_address: '11 Main', notes: 'Allowed', status: 'won' });
});

test('blank title and foreign or nonexistent lead are rejected before insertion', async () => {
  await expect(createProject(A, 'l1', { title: ' ', siteAddress: '', notes: '' })).rejects.toMatchObject({ reason: 'invalid' });
  expect(from).not.toHaveBeenCalled();
  await expect(createProject(A, 'l2', { title: 'Other', siteAddress: '', notes: '' })).rejects.toMatchObject({ reason: 'not_found' });
  expect(records).toHaveLength(0);
});

test('failed network save leaves persistence untouched; retry writes once', async () => {
  networkDown = true;
  await expect(createProject(A, 'l1', { title: 'Bathroom', siteAddress: '', notes: '' }))
    .rejects.toMatchObject({ reason: 'request' });
  expect(records).toHaveLength(0);
  networkDown = false;
  await createProject(A, 'l1', { title: 'Bathroom', siteAddress: '', notes: '' });
  expect(records).toHaveLength(1);
});

test('server-validated unauthorized or alternate accounts cannot issue project queries', async () => {
  session.mockResolvedValueOnce(null);
  await expect(listLeadProjects(A, 'l1')).rejects.toBeInstanceOf(ProjectFailure);
  session.mockResolvedValue({ userId: B, accessToken: 'B-token', expiresAtMs: Date.now() + 60000 });
  await expect(loadProject(A, 'p1')).rejects.toMatchObject({ reason: 'session' });
  expect(from).not.toHaveBeenCalled();
});

test('switched client or changed session during delayed request rejects stale account A result', async () => {
  records.push(kitchen);
  let done!: () => void;
  pendingLoad = new Promise<void>((resolve) => { done = resolve; });
  const work = loadProject(A, 'p1');
  for (let i = 0; i < 15 && !from.mock.calls.length; i++) await Promise.resolve();
  expect(from).toHaveBeenCalledWith('projects');
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(false);
  done();
  await expect(work).rejects.toMatchObject({ reason: 'session' });
});

test('query paginates instead of silently truncating at PostgREST row limit', async () => {
  records.push(...Array.from({ length: 205 }, (_, i) => ({ ...kitchen, id: String(i) })));
  expect(await listLeadProjects(A, 'l1')).toHaveLength(205);
});
