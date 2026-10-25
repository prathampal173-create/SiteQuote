import { ESTIMATE_CHANGED_MESSAGE, matchesPreview, parseUnsentEstimate } from '../unsentEstimate';
const content = {
  project_id: 'p', user_id: 'a', project_title: 'Kitchen', site_address: 'One Street', status: 'draft', tax_bps: 800,
  customer_name: 'Customer', customer_phone: null, customer_email: null,
  business_name: 'Business', business_phone: null, business_address: null,
  tasks: [
    { id: 't1', category: 'Kitchen Remodeling', title: 'Cabinets', notes: 'Approved only', amount_minor: 150000, sort_order: 0 },
    { id: 't2', category: 'Kitchen Remodeling', title: 'Counters', notes: null, amount_minor: 50000, sort_order: 1 },
    { id: 't3', category: 'Painting', title: 'Walls', notes: null, amount_minor: 100000, sort_order: 2 }
  ], charges: [{ id: 'c1', description: 'Permit', amount_minor: 10000, sort_order: 0 },
    { id: 'c2', description: 'Disposal', amount_minor: 5000, sort_order: 1 }]
};
const wrap = (data = content, hash = 'a'.repeat(64)) => ({ content: data, fingerprint: hash });
test('3,402.00 from authoritative cents with one exact tax rounding', () => {
  const p = parseUnsentEstimate(wrap(), 'a', 'p');
  expect([p.totals.taskSubtotalMinor, p.totals.chargesTotalMinor, p.totals.taxMinor, p.totals.finalMinor])
    .toEqual([300000, 15000, 25200, 340200]);
});
test('same fingerprint and owner remains stable; changes require another preview', () => {
  const original = parseUnsentEstimate(wrap(), 'a', 'p');
  expect(matchesPreview(original, parseUnsentEstimate(wrap(), 'a', 'p'))).toBe(true);
  expect(matchesPreview(original, parseUnsentEstimate(wrap({ ...content, project_title: 'New Kitchen' }, 'b'.repeat(64)), 'a', 'p'))).toBe(false);
  expect(ESTIMATE_CHANGED_MESSAGE).toBe('Estimate changed — preview again.');
});
test('missing content, malformed SHA256, foreign owner and invalid cents refused', () => {
  expect(() => parseUnsentEstimate(null, 'a', 'p')).toThrow();
  expect(() => parseUnsentEstimate(wrap(content, 'wrong'), 'a', 'p')).toThrow();
  expect(() => parseUnsentEstimate(wrap(), 'b', 'p')).toThrow();
  expect(() => parseUnsentEstimate(wrap({ ...content, tasks: [{ ...content.tasks[0]!, amount_minor: 0.01 }] }), 'a', 'p')).toThrow();
  expect(() => parseUnsentEstimate(wrap({ ...content, tax_bps: 3001 }), 'a', 'p')).toThrow();
});
test('empty pricing, zero tax, half-up boundary and allowed closed read', () => {
  const empty = parseUnsentEstimate(wrap({ ...content, tasks: [], charges: [], tax_bps: 0 }), 'a', 'p');
  expect(empty.totals.finalMinor).toBe(0);
  const small = parseUnsentEstimate(wrap({ ...content, tasks: [
    { ...content.tasks[0]!, amount_minor: 1 }, { ...content.tasks[1]!, amount_minor: 1 }], charges: [], tax_bps: 2500,
    status: 'won' }), 'a', 'p');
  expect(small.totals.taxMinor).toBe(1);
});
