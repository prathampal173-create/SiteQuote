/** Phase 5D executable source/adapter regression tests, NOT PostgreSQL/native acceptance.
 * Runs actual pure TS models and notification lifecycle with injected fake OS and backend.
 * Usage: node scripts/verify-phase5d-isolated.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
const previousLoad = Module._load;
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  fileName:file, compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }
}).outputText,file);
Module._load = function(id,parent,main) {
  if (id==='./projectsApi' && parent?.filename.endsWith('/projectQuoteSummary.ts')) return {projectRequest:async()=>new Map()};
  if (id==='expo-print') return { printToFileAsync:async()=>({uri:'file:///tmp/frozen.pdf'}), printAsync:async()=>{} };
  if (id==='expo-sharing') return { isAvailableAsync:async()=>true, shareAsync:async()=>{} };
  if (id==='expo-file-system') return { File:class {delete(){}} };
  return previousLoad.call(this,id,parent,main);
};
const owner='11111111-1111-4111-8111-111111111111';
const foreign='22222222-2222-4222-8222-222222222222';
const project='33333333-3333-4333-8333-333333333333';
const remId='44444444-4444-4444-8444-444444444444';
const now=new Date('2026-10-23T18:00:00Z');
const testCases=[];
const test=(name,fn)=>testCases.push([name,fn]);
const {calculateEstimate}=require('../src/features/estimates/estimateMath.ts');
const {parsePreparedQuote,quoteReference,quoteChanges}=require('../src/features/estimates/preparedQuotes.ts');
const {buildVersionedQuoteHtml}=require('../src/features/estimates/versionedPdf.ts');
const {summarizeQuote}=require('../src/features/projects/projectQuoteSummary.ts');
const {suggestFollowup}=require('../src/features/reminders/sentQuoteFollowup.ts');
const {reminderGroup,validateReminder}=require('../src/features/reminders/reminderModel.ts');
const {NotificationLifecycle}=require('../src/features/notifications/notificationLifecycle.ts');
const {GENERIC_TITLE,GENERIC_BODY,eligibleDueAt,authorizeReminderTap}=require('../src/features/notifications/reminderNotificationModel.ts');
const amount=(n)=>({amount_minor:n});
const totals=calculateEstimate([amount(150000),amount(50000),amount(100000)],[amount(10000),amount(5000)],800);
const content={project_id:project,user_id:owner,project_title:'Kitchen',site_address:'10 Example Road',status:'draft',tax_bps:800,
 customer_name:'Before Profile Edit',customer_phone:null,customer_email:'old@example.test',business_name:'Before Business Edit',business_phone:null,business_address:null,
 tasks:[{id:'a',category:'Kitchen Remodeling',title:'Cabinets',notes:'Visible & permitted',amount_minor:150000,sort_order:0},
 {id:'b',category:'Kitchen Remodeling',title:'Hardware',notes:null,amount_minor:50000,sort_order:1},
 {id:'c',category:'Kitchen Remodeling',title:'Countertop',notes:null,amount_minor:100000,sort_order:2}],
 charges:[{id:'x',description:'Permit',amount_minor:10000,sort_order:0},{id:'y',description:'Cleanup',amount_minor:5000,sort_order:1}]};
const fingerprint='a'.repeat(64);
const rawQuote={ id:'55555555-5555-4555-8555-555555555555', user_id:owner, project_id:project, version:1,status:'sent',
 fingerprint,request_key:'66666666-6666-4666-8666-666666666666',issued_at:'2026-10-23T14:00:00Z',sent_at:'2026-10-23T16:00:00Z',
 snapshot:{content,totals},tasks_subtotal_minor:300000,charges_total_minor:15000,tax_bps:800,tax_minor:25200,total_minor:340200};
const q=parsePreparedQuote(rawQuote,owner,project);
test('exact $3402 acceptance uses integer cents and one round-half-up tax',()=>{
 assert.equal(totals.finalMinor,340200);assert.equal(totals.taxMinor,25200);
 assert.equal(calculateEstimate([amount(2)],[amount(0)],2500).taxMinor,1);
});
test('same numbered quote retains snapshot and issue date after edits to live profiles',()=>{
 const before=JSON.stringify(q),html=buildVersionedQuoteHtml(q);
 const changedLive={...content,customer_name:'After Profile Edit',business_name:'After Business Edit'};
 assert.notEqual(changedLive.business_name,q.snapshot.content.business_name);
 assert.equal(buildVersionedQuoteHtml(q),html);assert.equal(JSON.stringify(q),before);
 assert(html.includes('Before Profile Edit')&&html.includes('Before Business Edit'));
 assert(!html.includes('After Profile Edit')&&!html.includes('After Business Edit'));
 assert(html.includes('$3,402.00'));assert(html.includes('SQ-333333333333-v1'));
});
test('rendered frozen quote escapes public task notes',()=>{
 const html=buildVersionedQuoteHtml(q);
 assert(html.includes('Visible &amp; permitted')); assert(!html.includes('HIDDEN PROJECT NOTE'));
});
test('quote parser rejects mismatched owner/snapshot cent fields',()=>{
 assert.throws(()=>parsePreparedQuote(rawQuote,foreign,project));
 assert.throws(()=>parsePreparedQuote({...rawQuote,total_minor:340201},owner,project));
 assert.throws(()=>parsePreparedQuote({...rawQuote,snapshot:{...rawQuote.snapshot,totals:{...totals,taxMinor:999}}},owner,project));
});
test('revisions compare frozen tasks, never live project amounts',()=>{
 const revised={...q,id:'77777777-7777-4777-8777-777777777777',version:2,fingerprint:'b'.repeat(64),
  snapshot:{content:{...content,tasks:[{...content.tasks[0],amount_minor:160000},...content.tasks.slice(1)]},
   totals:calculateEstimate([{amount_minor:160000},amount(50000),amount(100000)],[amount(10000),amount(5000)],800)},
  total_minor:351000};
 const diff=quoteChanges(revised,q);
 assert(diff.includes('task lines'));assert(diff.includes('$108.00'));
 assert.equal(quoteChanges(q,q),'Same estimate content');
});
test('latest Sent label is highest numbered version, not most recent sent timestamp',()=>{
 const other={...q,id:'88888888-8888-4888-8888-888888888888',version:2,total_minor:351000,
 sent_at:'2026-10-23T15:00:00Z'};
 const p={id:project,user_id:owner,status:'quote_sent',accepted_quote_id:null};
 const latest=summarizeQuote(p,[q,other]);
 assert.equal(latest.reference,quoteReference(other));assert.equal(latest.amountMinor,351000);
});
test('Won summary uses explicitly selected older Sent version with different total',()=>{
 const newer={...q,id:'88888888-8888-4888-8888-888888888888',version:2,total_minor:351000};
 const p={id:project,user_id:owner,status:'won',accepted_quote_id:q.id};
 const selected=summarizeQuote(p,[newer,q]);
 assert.equal(selected.reference,quoteReference(q));assert.equal(selected.amountMinor,340200);
 assert.equal(summarizeQuote({...p,accepted_quote_id:newer.id},[newer,q]).amountMinor,351000);
});
test('foreign and prepared-only quotes excluded from summary/acceptance display',()=>{
 const p={id:project,user_id:owner,status:'quote_sent',accepted_quote_id:null};
 assert.equal(summarizeQuote(p,[{...q,user_id:foreign},{...q,status:'prepared'}]),null);
});
const utc='2026-11-05T15:00:00.000Z';
function reminder(dueAt=utc, status='open',user=owner,id=remId){return {
 id,user_id:user,lead_id:'99999999-9999-4999-8999-999999999999',project_id:project,kind:'follow_up',title:'Follow up',note:null,
 due_at:dueAt,status,completed_at:status==='completed'?now.toISOString():null,created_at:now.toISOString(),updated_at:now.toISOString()
};}
test('notification eligibility preserves absolute UTC instant regardless of display zone',()=>{
 const r=reminder(); const date=eligibleDueAt(r,owner,now.getTime());
 assert.equal(date?.toISOString(),utc);
 for(const zone of ['Asia/Kolkata','America/New_York','Europe/London','Pacific/Auckland']){
   const local=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(date);
   assert(local.length>2);assert.equal(date.toISOString(),utc);
 }
});
test('Open past, Completed, and foreign reminders cannot schedule',()=>{
 assert.equal(eligibleDueAt(reminder('2026-10-23T12:00:00Z'),owner,now.getTime()),null);
 assert.equal(eligibleDueAt(reminder(utc,'completed'),owner,now.getTime()),null);
 assert.equal(eligibleDueAt(reminder(utc,'open',foreign),owner,now.getTime()),null);
});
test('reminder local grouping changes presentation without changing saved UTC instant',()=>{
 const prior=process.env.TZ;
 try {
   process.env.TZ='America/New_York';
   assert.equal(reminderGroup('2026-11-05T01:00:00Z',new Date('2026-11-04T18:00:00Z')),'Today');
   process.env.TZ='Asia/Kolkata';
   assert.equal(reminderGroup('2026-11-05T01:00:00Z',new Date('2026-11-04T18:00:00Z')),'Upcoming');
 } finally {if(prior===undefined) delete process.env.TZ;else process.env.TZ=prior;}
});
test('local +3 calendar days spans spring DST without requiring 72 hours',()=>{
 const prior=process.env.TZ;
 try {process.env.TZ='America/New_York';
   const sent=new Date(2026,2,6,10,0);
   const picked=suggestFollowup(sent.toISOString(),new Date(2026,2,5));
   assert.equal(picked.due.getDate(),9);assert.equal(picked.due.getHours(),10);
   assert.equal((picked.due.getTime()-sent.getTime())/3600000,71);
 } finally {if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test('spring DST gap produces warned valid alternative; no invalid wall time is saved',()=>{
 const prior=process.env.TZ;
 try {process.env.TZ='America/New_York';
  const sent=new Date(2026,2,5,2,30);
  const proposed=suggestFollowup(sent.toISOString(),new Date(2026,2,5));
  assert.equal(proposed.due.getDate(),8);assert.equal(proposed.due.getHours(),3);
  assert.equal(proposed.due.getMinutes(),0);assert.equal(proposed.adjusted,true);
  const draft=validateReminder({leadId:reminder().lead_id,projectId:project,kind:'follow_up',title:'Follow-up',note:'',dueDate:proposed.due},new Date(2026,2,5));
  assert.equal(draft.ok,true); if(draft.ok)assert.equal(draft.values.due_at,proposed.due.toISOString());
 } finally {if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test('fall DST overlap chooses earlier occurrence and surfaces ambiguity warning',()=>{
 const prior=process.env.TZ;
 try{process.env.TZ='America/New_York';
  const sent=new Date(2026,9,29,1,30);
  const suggested=suggestFollowup(sent.toISOString(),new Date(2026,9,29));
  assert.equal(suggested.due.getMonth(),10);assert.equal(suggested.due.getDate(),1);
  assert.equal(suggested.due.getHours(),1);assert.equal(suggested.ambiguous,true);
  assert.equal(suggested.due.getTimezoneOffset(),240);
 }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
function makeDevice({rows=()=>[], permission=()=>({state:'granted',canAskAgain:false}), failRead=()=>false}={}) {
 const requests=new Map(), entries={value:[]};let seq=0;
 const os={list:async()=>[...requests.values()].map((x)=>({...x,content:{...x.content}})),
  cancel:async(id)=>{requests.delete(id)},
  schedule:async(date,payload)=>{const id=`os-${++seq}`;requests.set(id,{identifier:id,
   trigger:{type:'date',timestamp:date.getTime()},content:{title:GENERIC_TITLE,body:GENERIC_BODY,data:payload}});return id}};
 const registry={read:async()=>entries.value.map(x=>({...x})),write:async(next)=>{entries.value=next.map(x=>({...x}))}};
 const lifecycle=new NotificationLifecycle(registry,os,async()=>permission(),async(_)=>{
  if(failRead())throw new Error('offline');return rows();
 });
 return {lifecycle,requests,entries,os};
}
test('two devices independently schedule same saved reminder once each',async()=>{
 let saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const a=makeDevice({rows:()=>saved}),b=makeDevice({rows:()=>saved});
 for (const d of [a,b]) {const first=await d.lifecycle.reconcile(owner,()=>true);
  assert.equal(first.scheduled,1);assert.equal(d.requests.size,1);
  const again=await d.lifecycle.reconcile(owner,()=>true);assert.equal(again.scheduled,0);assert.equal(d.requests.size,1);}
});
test('remote reschedule fixes stale alert on device B foreground without duplicates',async()=>{
 let saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const a=makeDevice({rows:()=>saved}),b=makeDevice({rows:()=>saved});
 await a.lifecycle.reconcile(owner,()=>true);await b.lifecycle.reconcile(owner,()=>true);
 saved=[reminder(new Date(Date.now()+7200000).toISOString())];
 await a.lifecycle.reconcile(owner,()=>true);
 assert.equal(b.requests.size,1); // offline/stale until next foreground
 const outcome=await b.lifecycle.reconcile(owner,()=>true);
 assert.equal(outcome.cancelled,1);assert.equal(outcome.scheduled,1);assert.equal(b.requests.size,1);
 assert.equal([...b.requests.values()][0].trigger.timestamp,Date.parse(saved[0].due_at));
});
test('remote completion and deletion on device A remove B stale alerts after reconcile',async()=>{
 let saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const b=makeDevice({rows:()=>saved});await b.lifecycle.reconcile(owner,()=>true);
 saved=[{...saved[0],status:'completed'}];await b.lifecycle.reconcile(owner,()=>true);
 assert.equal(b.requests.size,0);
 saved=[];await b.lifecycle.reconcile(owner,()=>true);assert.equal(b.requests.size,0);
});
test('offline authoritative read leaves existing schedules intact until recovery',async()=>{
 let offline=false;const saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const b=makeDevice({rows:()=>saved,failRead:()=>offline});await b.lifecycle.reconcile(owner,()=>true);
 offline=true;const result=await b.lifecycle.reconcile(owner,()=>true);
 assert.equal(result.failed,1);assert.equal(b.requests.size,1);
});
test('corrupt/missing registry derived state repairs from existing OS request',async()=>{
 const saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const d=makeDevice({rows:()=>saved});await d.lifecycle.reconcile(owner,()=>true);
 d.entries.value=[];const result=await d.lifecycle.reconcile(owner,()=>true);
 assert.equal(result.scheduled,0);assert.equal(d.requests.size,1);assert.equal(d.entries.value.length,1);
});
test('a vanished OS notification is restored from authoritative saved data',async()=>{
 const saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const d=makeDevice({rows:()=>saved});await d.lifecycle.reconcile(owner,()=>true);
 d.requests.clear();const result=await d.lifecycle.reconcile(owner,()=>true);
 assert.equal(result.scheduled,1);assert.equal(d.requests.size,1);
});
test('sign-out prevents later old-account schedules; next account only schedules owned reminders',async()=>{
 let saved=[reminder(new Date(Date.now()+3600000).toISOString())];
 const d=makeDevice({rows:()=>saved});await d.lifecycle.reconcile(owner,()=>true);
 await d.lifecycle.signOut(owner);assert.equal(d.requests.size,0);
 await d.lifecycle.reconcile(owner,()=>true);assert.equal(d.requests.size,0);
 saved=[reminder(new Date(Date.now()+7200000).toISOString(),'open',foreign,'55555555-5555-4555-8555-555555555555')];
 const after=await d.lifecycle.reconcile(foreign,()=>true);
 assert.equal(after.scheduled,1);assert.equal(d.requests.size,1);
 assert.equal([...d.entries.value][0].ownerId,foreign);
});
test('old-account tap rejects current-account identity (UUID is not authorization)',async()=>{
 let reads=0;
 const read=async(_owner,id)=>{reads++;return {id,user_id:owner}};
 assert.equal(await authorizeReminderTap(foreign,remId,read,()=>true),null);
 assert.equal(reads,1);
 assert.equal((await authorizeReminderTap(owner,remId,read,()=>true))?.id,remId);
 assert.equal(await authorizeReminderTap(owner,'invalid',read,()=>true),null);
});
test('account switch during tap lookup discards late response',async()=>{
 let resolve;const read=()=>new Promise(r=>resolve=r);let current=true;
 const pending=authorizeReminderTap(owner,remId,read,()=>current);
 current=false;resolve({id:remId,user_id:owner});assert.equal(await pending,null);
});
test('Phase 5D forward SQL matches Sent by fingerprint in the query itself',()=>{
 const migration=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261023110000_phase_5d_sent_matching_precedence.sql'),'utf8');
 const query=/where user_id=actor and project_id=p_project_id and status='sent' and fingerprint=fp\s+order by version desc limit 1/;
 assert(query.test(migration));assert(/if found then\s+mode := 'reshare_sent'/.test(migration));
 assert(/create or replace function public\.prepare_quote/.test(migration));
});
test('historical Phase 3C code shows the fixed latest-overall bug (source review)',()=>{
 const old=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261023040000_phase_3c_prepared_quotes.sql'),'utf8');
 assert(/status='sent'\s+order by version desc limit 1/.test(old));
 assert(/if found and winner\.fingerprint = fp then/.test(old));
});
(async()=>{let ok=0;try {
 for(const [name,fn] of testCases){await fn();ok++;console.log('PASS',name)}
 console.log(`RESULT ${ok}/${testCases.length} isolated source/model/native-port checks; no real Supabase or device`);
} catch(err){console.error('FAIL',testCases[ok]?.[0],err);process.exitCode=1;}
finally{Module._extensions['.ts']=previous;Module._load=previousLoad;}})();
