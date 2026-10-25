import { calculateEstimate } from '../estimateMath';
import { parsePreparedQuote, quoteChanges, quoteReference } from '../preparedQuotes';
import { summarizeQuote } from '../../projects/projectQuoteSummary';
import { buildUnsentEstimateHtml } from '../unsentPdf';
import { frozenEstimate } from '../preparedQuotes';

const owner='11111111-1111-4111-8111-111111111111';
const project='33333333-3333-4333-8333-333333333333';
const content={project_id:project,user_id:owner,project_title:'Kitchen',site_address:'1 Main St',status:'draft',tax_bps:800,
 customer_name:'Original Customer',customer_phone:null,customer_email:null,business_name:'Original Business',business_phone:null,business_address:null,
 tasks:[{id:'t1',category:'Kitchen Remodeling',title:'Cabinets',notes:'Public note',amount_minor:150000,sort_order:0},
  {id:'t2',category:'Kitchen Remodeling',title:'Hardware',notes:null,amount_minor:50000,sort_order:1},
  {id:'t3',category:'Kitchen Remodeling',title:'Countertop',notes:null,amount_minor:100000,sort_order:2}],
 charges:[{id:'c1',description:'Permit',amount_minor:10000,sort_order:0},{id:'c2',description:'Disposal',amount_minor:5000,sort_order:1}]};
const totals=calculateEstimate(content.tasks,content.charges,800);
const raw={id:'a',user_id:owner,project_id:project,version:1,status:'sent',fingerprint:'a'.repeat(64),
 request_key:'request-a',issued_at:'2026-10-23T14:00:00.000Z',sent_at:'2026-10-23T15:00:00.000Z',
 snapshot:{content,totals},tasks_subtotal_minor:300000,charges_total_minor:15000,tax_bps:800,tax_minor:25200,total_minor:340200};

test('Phase 5D real exact-cent $3402 fixture with repeated task categories',()=>{
 expect(totals).toMatchObject({taskSubtotalMinor:300000,chargesTotalMinor:15000,pretaxMinor:315000,
  taxMinor:25200,finalMinor:340200,taxBps:800});
 expect(content.tasks[0]!.category).toBe(content.tasks[1]!.category);
});
test('highest NUMBERED Sent drives summary despite out-of-order sent_at',()=>{
 const v2={...raw,id:'b',version:2,total_minor:351000,sent_at:'2026-10-23T14:30:00Z'};
 const projectRow={id:project,user_id:owner,status:'quote_sent',accepted_quote_id:null} as never;
 const displayed=summarizeQuote(projectRow,[raw,v2]);
 expect(displayed?.amountMinor).toBe(351000);
 expect(displayed?.reference).toBe(quoteReference(v2));
});
test('Won accepts and displays deliberately selected older Sent v1, not newest v2',()=>{
 const v2={...raw,id:'b',version:2,total_minor:351000};
 const projectRow={id:project,user_id:owner,status:'won',accepted_quote_id:'a'} as never;
 expect(summarizeQuote(projectRow,[v2,raw])).toMatchObject({label:'Accepted quote',amountMinor:340200});
});
test('frozen historical PDF fields remain unchanged when mutable profile is edited',()=>{
 const q=parsePreparedQuote(raw,owner,project);
 const before=buildUnsentEstimateHtml(frozenEstimate(q),{reference:quoteReference(q),issueDate:q.issued_at});
 const liveCustomer={...content,customer_name:'Changed Customer',business_name:'Changed Business'};
 expect(liveCustomer.customer_name).not.toBe(q.snapshot.content.customer_name);
 const after=buildUnsentEstimateHtml(frozenEstimate(q),{reference:quoteReference(q),issueDate:q.issued_at});
 expect(after).toBe(before);
 expect(after).toContain('Original Customer');
 expect(after).toContain('Original Business');
 expect(after).toContain('$3,402.00');
 expect(after).not.toContain('Changed Customer');
});
test('snapshot parser fails closed for foreign owners and financial tampering',()=>{
 expect(()=>parsePreparedQuote(raw,'22222222-2222-4222-8222-222222222222',project)).toThrow();
 expect(()=>parsePreparedQuote({...raw,total_minor:1},owner,project)).toThrow();
});
test('version changes are derived from frozen snapshots',()=>{
 const q=parsePreparedQuote(raw,owner,project);
 const r={...q,version:2,fingerprint:'b'.repeat(64),total_minor:351000,
  snapshot:{content:{...q.snapshot.content,tasks:[{...q.snapshot.content.tasks[0]!,amount_minor:160000},...q.snapshot.content.tasks.slice(1)]},totals:calculateEstimate(
   [{amount_minor:160000},{amount_minor:50000},{amount_minor:100000}],q.snapshot.content.charges,800)}};
 expect(quoteChanges(r,q)).toContain('task lines');
 expect(quoteChanges(q,q)).toBe('Same estimate content');
});
