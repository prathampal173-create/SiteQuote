import { addAdditionalCharge, editAdditionalCharge, loadWorkingEstimate,
  removeAdditionalCharge, saveTaxRate } from '../estimatesApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
const A = 'user-a'; const B = 'user-b'; const P = 'project-a';
const parent = { id: P, user_id: A, status: 'draft', tax_bps: 800 };
const tasks = [
  { id: 't1', project_id: P, user_id: A, title: 'Floor', amount_minor: 100000, sort_order: 0 },
  { id: 't2', project_id: P, user_id: A, title: 'Paint', amount_minor: 200000, sort_order: 0 }
];
const charges = [
  { id: 'c1', project_id: P, user_id: A, description: 'Permit', amount_minor: 15000, sort_order: 0 }
];
let status = 'draft';
let fail = false;
let lastWrite: { kind: string; values: any; table: string; filters: Record<string, unknown> } | null;
const from = jest.fn((table: string) => {
  const filters: Record<string, unknown> = {};
  let write: { kind: string; values: any } | null = null;
  let first = 0, last = 199;
  const q: any = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn((k: string, v: unknown) => { filters[k] = v; return q; });
  q.order = jest.fn(() => q);
  q.range = jest.fn((a: number, b: number) => { first = a; last = b; return result(false); });
  q.insert = jest.fn((v: any) => { write = { kind: 'insert', values: v }; return q; });
  q.update = jest.fn((v: any) => { write = { kind: 'update', values: v }; return q; });
  q.delete = jest.fn(() => { write = { kind: 'delete', values: null }; return q; });
  q.then = (resolve: (v: any) => void, reject: (e: any) => void) => result(false).then(resolve, reject);
  q.maybeSingle = jest.fn(() => result(true));
  const match = (v: any) => Object.entries(filters).every(([k, x]) => v[k] === x);
  async function result(one: boolean): Promise<any> {
    if (fail) return { data: null, error: { code: 'FETCH_ERROR' } };
    if (write) {
      lastWrite = { ...write, table, filters: { ...filters } };
      if (table === 'projects' && write.kind === 'update' && parent.id === filters.id && A === filters.user_id && status === 'draft') {
        parent.tax_bps = write.values.tax_bps;
        return { data: { id: P }, error: null };
      }
      if (table === 'project_additional_charges') {
        if (write.kind === 'insert' && write.values.project_id === P && write.values.user_id === A && status === 'draft') {
          charges.push({ id: `c${charges.length+1}`, ...write.values, sort_order: 0 });
          return { data: null, error: null };
        }
        const row = charges.find((c) => match(c));
        if (row && status === 'draft') {
          if (write.kind === 'update') Object.assign(row, write.values);
          if (write.kind === 'delete') charges.splice(charges.indexOf(row), 1);
          return { data: { id: row.id }, error: null };
        }
      }
      return { data: null, error: { code: status !== 'draft' ? '23514' : '42501' } };
    }
    const source = table === 'projects' ? [{ ...parent, status }] : table === 'project_tasks' ? tasks : charges;
    const rows = source.filter(match);
    return { data: one ? rows[0]! ?? null : rows.slice(first, last + 1), error: null };
  }
  return q;
});
const client = { from };
beforeEach(() => {
  jest.clearAllMocks(); status = 'draft'; parent.tax_bps = 800; fail = false; lastWrite = null;
  charges.splice(0, charges.length, { id: 'c1', project_id: P, user_id: A, description: 'Permit', amount_minor: 15000, sort_order: 0 });
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({ userId: A, accessToken: 'token' } as never);
});
test('reads saved project-specific task and charge lines and computes exact acceptance total', async () => {
  const result = await loadWorkingEstimate(A, P);
  expect(result.totals.finalMinor).toBe(340200);
  expect(result.charges[0]!.description).toBe('Permit');
  expect(from).toHaveBeenCalledWith('project_additional_charges');
});
test('add/edit/remove charge updates only its owner/project and refreshes totals', async () => {
  await addAdditionalCharge(A, P, ' Removal ', '0.05');
  expect(lastWrite).toMatchObject({ kind: 'insert', table: 'project_additional_charges', values: {
    user_id: A, project_id: P, description: 'Removal', amount_minor: 5 } });
  expect((await loadWorkingEstimate(A, P)).totals.finalMinor).toBe(340205);
  await editAdditionalCharge(A, P, 'c2', 'Removal', '50.00');
  expect(lastWrite).toMatchObject({ kind: 'update', filters: { user_id: A, project_id: P, id: 'c2' } });
  expect((await loadWorkingEstimate(A, P)).totals.finalMinor).toBe(345600);
  await removeAdditionalCharge(A, P, 'c2');
  expect((await loadWorkingEstimate(A, P)).totals.finalMinor).toBe(340200);
});
test('tax update applies exact bps, errors preserve rows, no direct protected updates', async () => {
  await saveTaxRate(A, P, '30.00');
  expect(lastWrite).toMatchObject({ table: 'projects', kind: 'update', values: { tax_bps: 3000 },
    filters: { user_id: A, id: P } });
  expect((await loadWorkingEstimate(A, P)).totals.finalMinor).toBe(409500);
  await expect(saveTaxRate(A, P, '30.01')).rejects.toMatchObject({ reason: 'invalid' });
  expect(parent.tax_bps).toBe(3000);
  fail = true;
  await expect(removeAdditionalCharge(A, P, 'c1')).rejects.toBeTruthy();
  expect(charges).toHaveLength(1);
});
test('closed project cannot write charges or tax; project tax stays unchanged', async () => {
  status = 'lost';
  await expect(addAdditionalCharge(A, P, 'No', '1')).rejects.toMatchObject({ reason: 'locked' });
  await expect(editAdditionalCharge(A, P, 'c1', 'No', '1')).rejects.toMatchObject({ reason: 'locked' });
  await expect(removeAdditionalCharge(A, P, 'c1')).rejects.toMatchObject({ reason: 'locked' });
  await expect(saveTaxRate(A, P, '5')).rejects.toMatchObject({ reason: 'locked' });
  expect(charges).toHaveLength(1); expect(parent.tax_bps).toBe(800);
});
test('foreign account/session or missing project cannot read or write', async () => {
  await expect(loadWorkingEstimate(B, P)).rejects.toMatchObject({ reason: 'session' });
  await expect(addAdditionalCharge(B, P, 'X', '10')).rejects.toMatchObject({ reason: 'session' });
  await expect(loadWorkingEstimate(A, 'other')).rejects.toMatchObject({ reason: 'not_found' });
  expect(charges).toHaveLength(1);
});
test('rejects invalid form values without issuing database writes', async () => {
  await expect(addAdditionalCharge(A, P, '', '1')).rejects.toMatchObject({ reason: 'invalid' });
  await expect(editAdditionalCharge(A, P, 'c1', 'Permit', '1.123')).rejects.toMatchObject({ reason: 'invalid' });
  await expect(saveTaxRate(A, P, '-1')).rejects.toMatchObject({ reason: 'invalid' });
  expect(from).not.toHaveBeenCalled();
});
