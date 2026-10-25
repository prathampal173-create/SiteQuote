import { frozenEstimate, parsePreparedQuote, parsePrepareResult, quoteChanges, quoteReference } from '../preparedQuotes';
import { buildVersionedQuoteHtml } from '../versionedPdf';
const A = 'c1111111-1111-4111-8111-111111111111';
const P = 'c5555555-5555-4555-8555-555555555555';
const content = { project_id: P, user_id: A, project_title: 'Kitchen', site_address: '123 Main',
  status: 'draft', tax_bps: 800, customer_name: 'Client', customer_phone: '321', customer_email: 'a@example.test',
  business_name: 'Builder', business_phone: null, business_address: null,
  tasks: [ { id: 't1', category: 'Painting', title: 'Paint & <repair>', notes: 'Allowed\nnotes', amount_minor: 150000, sort_order: 0 },
    { id: 't2', category: 'Painting', title: 'Plumbing', notes: null, amount_minor: 50000, sort_order: 1 },
    { id: 't3', category: 'Painting', title: 'Trim', notes: null, amount_minor: 100000, sort_order: 2 } ],
  charges: [{ id:'c1', description:'Permit', amount_minor:10000, sort_order:0 },
    { id:'c2', description:'Disposal', amount_minor:5000, sort_order:1 }] };
const totals = { taskSubtotalMinor: 300000, chargesTotalMinor: 15000, pretaxMinor: 315000, taxMinor: 25200,
  finalMinor: 340200, taxBps: 800 };
const make = () => ({ id:'q1', user_id:A, project_id:P, version:1, status:'prepared',
  fingerprint:'a'.repeat(64), request_key:'request', snapshot:{content,totals},
  tasks_subtotal_minor:300000, charges_total_minor:15000, tax_bps:800, tax_minor:25200, total_minor:340200,
  issued_at:'2026-10-23T10:00:00.000Z', sent_at:null });
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(), printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
test('immutable USD 3402 acceptance snapshot parses and renders, excluding private notes', () => {
  const q = parsePreparedQuote(make(), A, P);
  expect(frozenEstimate(q).totals.finalMinor).toBe(340200);
  const html = buildVersionedQuoteHtml(q);
  expect(html).toContain('$3,402.00');
  expect(html).toContain('SQ-C55555555555-v1');
  expect(html).toContain('October 23, 2026');
  expect(html).toContain('Paint &amp; &lt;repair&gt;');
  expect(html).toContain('Allowed');
  expect(html).not.toContain('UNSENT · Not a prepared');
  expect(html).not.toContain('HIDDEN PROJECT NOTE');
  expect(html).not.toContain('HIDDEN LEAD NOTE');
});
test('rejects cross-account / project quote and contradictory server totals', () => {
  expect(() => parsePreparedQuote(make(), 'other', P)).toThrow('unauthorized');
  expect(() => parsePreparedQuote(make(), A, 'other')).toThrow('unauthorized');
  expect(() => parsePreparedQuote({...make(), total_minor:340201}, A, P)).toThrow('inconsistent');
  expect(() => parsePreparedQuote({...make(), snapshot:{ content, totals:{ ...totals, taxMinor:25201 }}}, A, P)).toThrow('inconsistent');
  expect(() => parsePreparedQuote({...make(),snapshot:{content:{...content,tasks:[]},totals}},A,P)).toThrow('inconsistent');
});
test('request type and reference parsed; revision display reads frozen data', () => {
  const a = parsePreparedQuote(make(), A, P);
  expect(parsePrepareResult({result:'created',quote:make()}, A, P).quote.version).toBe(1);
  expect(() => parsePrepareResult({result:'sent',quote:make()}, A, P)).toThrow();
  expect(quoteReference(a)).toBe('SQ-C55555555555-v1');
  const changed = parsePreparedQuote({...make(), id:'q2', version:2, fingerprint:'b'.repeat(64), total_minor:340201,
    tasks_subtotal_minor:300001, tax_minor:25200,
    snapshot:{content:{...content,tasks:[{...content.tasks[0],amount_minor:150001},...content.tasks.slice(1)]},
      totals:{...totals,taskSubtotalMinor:300001,pretaxMinor:315001,finalMinor:340201}} },A,P);
  expect(quoteChanges(changed,a)).toContain('task');
});
test('tax half-up uses Phase 3A exact-cent arithmetic for frozen quotes',()=>{
  const values = { ...content, tax_bps:500, tasks:[{...content.tasks[0],amount_minor:10}], charges:[] };
  const t = { taskSubtotalMinor:10, chargesTotalMinor:0, pretaxMinor:10, taxMinor:1, finalMinor:11, taxBps:500 };
  const q = parsePreparedQuote({...make(),snapshot:{content:values,totals:t},
    tasks_subtotal_minor:10,charges_total_minor:0,tax_bps:500,tax_minor:1,total_minor:11},A,P);
  expect(q.tax_minor).toBe(1);
});
