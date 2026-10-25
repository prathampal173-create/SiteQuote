import { buildUnsentEstimateHtml, escapePdfHtml } from '../unsentPdf';
import { parseUnsentEstimate } from '../unsentEstimate';
const c = { project_id:'p',user_id:'a',project_title:'<Kitchen>',site_address:null,status:'draft',tax_bps:800,
  customer_name:'Alice & Bob',customer_phone:'555',customer_email:null,
  business_name:'Home Renovations',business_phone:null,business_address:'Street',
  tasks:[{id:'t',category:'Painting',title:'<Task>',notes:'Work approved & reviewed',amount_minor:300000,sort_order:0}],
  charges:[{id:'c',description:'Permit',amount_minor:15000,sort_order:0}] };
const snapshot = parseUnsentEstimate({ fingerprint:'0'.repeat(64), content:c },'a','p');
test('PDF HTML itemizes acceptance $3,402 with USD, tax, and customer details', () => {
  const html=buildUnsentEstimateHtml(snapshot);
  expect(html).toContain('Unsent estimate');
  expect(html).toContain('$3,402.00');
  expect(html).toContain('$3,000.00');
  expect(html).toContain('$150.00');
  expect(html).toContain('$252.00');
  expect(html).toContain('Tax (8.00%)');
  expect(html).toContain('Alice &amp; Bob');
  expect(html).toContain('Work approved &amp; reviewed');
});
test('HTML escaping prevents injected markup and private fields never appear', () => {
  const html=buildUnsentEstimateHtml(snapshot);
  expect(html).toContain('&lt;Task&gt;');
  expect(html).not.toContain('<Task>');
  expect(escapePdfHtml('<script>')).toBe('&lt;script&gt;');
  expect(html).not.toContain('internal notes');
  expect(html).not.toContain('project_photos');
  expect(html).not.toContain('fingerprint');
});
