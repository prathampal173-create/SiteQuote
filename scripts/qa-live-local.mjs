/** Disposable loopback backend only. Never loads .env or logs tokens/passwords.
 * Run: npx supabase status -o json > /tmp/sitequote-qa-local-status.json
 *      node scripts/qa-live-local.mjs
 * Real GoTrue, PostgREST and Storage; no native app is exercised. */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
const cfg=JSON.parse(readFileSync(process.env.SITEQUOTE_QA_STATUS || '/tmp/sitequote-qa-local-status.json','utf8'));
assert(['127.0.0.1','localhost'].includes(new URL(cfg.API_URL).hostname),'Loopback only');
assert(['127.0.0.1','localhost'].includes(new URL(cfg.MAILPIT_URL).hostname),'Local mailbox only');
const outputDir=process.env.SITEQUOTE_QA_OUTPUT_DIR || 'qa-evidence/final-audit';
const dbContainer=process.env.SITEQUOTE_QA_DB_CONTAINER || 'supabase_db_sitequote';
mkdirSync(outputDir,{recursive:true});
const make=()=>createClient(cfg.API_URL,cfg.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const A=make(),A2=make(),B=make(),anon=make();
const records=[]; const state={}; const started=new Date().toISOString();
const save=()=>writeFileSync(join(outputDir,'live-api-results.json'),JSON.stringify({started,finished:new Date().toISOString(),platform:'Node → local GoTrue/PostgREST/Storage',limitations:'No native device. Clock injection explicitly identified. No external email delivery.',records,state},null,2));
async function test(id,area,name,fn){const t=Date.now();try{const actual=await fn();records.push({id,area,name,status:'PASS',actual:actual??'Assertions passed',duration_ms:Date.now()-t});console.log('PASS',id,name);return true;}catch(e){records.push({id,area,name,status:'FAIL',actual:String(e.message||e),duration_ms:Date.now()-t});console.log('FAIL',id,name,String(e.message||e));return false;}finally{save();}}
function ok(r){assert(!r.error,r.error?.message);return r.data;}
async function insert(c,t,v){return ok(await c.from(t).insert(v).select().single());}
async function row(c,t,id){return ok(await c.from(t).select().eq('id',id).single());}
async function rpc(c,name,args){return ok(await c.rpc(name,args));}
async function count(c,t,filters={}){let q=c.from(t).select('*',{count:'exact',head:true});for(const [k,v] of Object.entries(filters))q=q.eq(k,v);const r=await q;ok(r);return r.count;}
async function denied(q){const r=await q;assert(r.error || (Array.isArray(r.data)&&r.data.length===0),'Unauthorized operation returned accessible rows');return {code:r.error?.code??'RLS zero rows'};}
const run=randomUUID().slice(0,8),password=randomBytes(30).toString('base64url')+'aA1!';
let ua,ub;
for(const [alias,c] of [['A',A],['B',B]]){
 const email=`sitequote-qa-${run}-${alias.toLowerCase()}@example.test`;
 const good=await test('AUTH-'+alias,'5B',`Account ${alias}: signup, Mailpit OTP verification, separate password login`,async()=>{
  const signed=ok(await c.auth.signUp({email,password}));assert.equal(signed.session,null);
  const unconfirmed=await make().auth.signInWithPassword({email,password});
  assert(unconfirmed.error && !unconfirmed.data.session,'Unconfirmed password login accepted');
  let token;
  for(let n=0;n<30&&!token;n++){
   const messages=await (await fetch(cfg.MAILPIT_URL+'/api/v1/messages')).json();
   const msg=messages.messages.find(x=>x.To?.some(y=>y.Address===email));
   if(msg){const body=await (await fetch(cfg.MAILPIT_URL+'/api/v1/message/'+msg.ID)).json();token=(body.Text+' '+body.HTML).match(/\b\d{6}\b/)?.[0];}
   if(!token)await new Promise(r=>setTimeout(r,300));
  }
  assert(token,'No six-digit OTP received in local Mailpit');
  assert((await c.auth.verifyOtp({email,token:'000000',type:'email'})).error,'Invalid OTP accepted');
  const verified=ok(await c.auth.verifyOtp({email,token,type:'email'}));assert(verified.user.email_confirmed_at);
  assert((await make().auth.verifyOtp({email,token,type:'email'})).error,'OTP replay accepted');
  const login=ok(await c.auth.signInWithPassword({email,password}));assert(login.session);
  const incorrect=await make().auth.signInWithPassword({email,password:password+'wrong'});
  assert(incorrect.error && !incorrect.data.session,'Incorrect password accepted');
  if(alias==='A'){ua=login.user.id;ok(await A2.auth.signInWithPassword({email,password}));}else ub=login.user.id;
  return 'Unconfirmed signup had no session; incorrect/replayed OTP denied; local email token verified; real JWT login succeeded.';
 });
 if(!good){save();process.exit(1);}
}
state.accounts={A:ua,B:ub};
let leads,projects,tasks,charges,other,qa,qb,qc,reminder,photo;
if(!await test('DATA-01','5B','Create three customers, four independent projects and exact estimate via authenticated API',async()=>{
 await insert(A,'business_profiles',{user_id:ua,business_name:'Original Builder',phone:'555'});
 await insert(B,'business_profiles',{user_id:ub,business_name:'Independent Builder'});
 leads=[];for(const name of ['Demo Customer A','Demo Customer B','Demo Customer C'])leads.push(await insert(A,'leads',{user_id:ua,customer_name:name,phone:'555',source:'Referral'}));
 projects=[];for(const [i,title] of [[0,'Kitchen Renovation'],[0,'Bathroom Renovation'],[1,'Roofing Project'],[2,'Painting Project']])projects.push(await insert(A,'projects',{user_id:ua,lead_id:leads[i].id,title,tax_bps:title.startsWith('Kitchen')?800:0}));
 const bl=await insert(B,'leads',{user_id:ub,customer_name:'Independent Customer B',phone:'555',source:'Other'});other=await insert(B,'projects',{user_id:ub,lead_id:bl.id,title:'Independent Project B'});
 tasks=[];for(const [title,amount_minor] of [['Kitchen cabinets',150000],['Cabinet hardware',50000],['Countertop installation',100000]])tasks.push(await insert(A,'project_tasks',{user_id:ua,project_id:projects[0].id,category:'Kitchen Remodeling',title,amount_minor,notes:'Public task note'}));
 charges=[];for(const [description,amount_minor] of [['Additional Charge 1',10000],['Additional Charge 2',5000]])charges.push(await insert(A,'project_additional_charges',{user_id:ua,project_id:projects[0].id,description,amount_minor}));
 assert.equal(new Set(projects.map(p=>p.id)).size,4);assert.equal(tasks.reduce((s,t)=>s+t.amount_minor,0),300000);assert.equal(charges.reduce((s,t)=>s+t.amount_minor,0),15000);
 state.dataset={leads,projects,tasks,charges,other};return '3 leads, 4 distinct projects; 300000 task cents + 15000 charge cents; tax_bps 800.';
})){process.exit(1);}
const p=projects[0].id;
const preview=()=>rpc(A,'get_unsent_estimate_snapshot',{p_project_id:p});
const prepare=(c,fp,key=randomUUID())=>rpc(c,'prepare_quote',{p_project_id:p,p_preview_fingerprint:fp,p_request_key:key});
await test('QUOTE-01','3A–3E','Exact frozen $3402, first Prepared and same-request retries',async()=>{
 const s=await preview(),key=randomUUID();qa=(await prepare(A,s.fingerprint,key)).quote;
 assert.equal(qa.total_minor,340200);assert.equal(qa.tax_minor,25200);assert.equal(qa.version,1);assert.equal(qa.status,'prepared');assert.equal((await row(A,'projects',p)).status,'draft');
 const retry=(await prepare(A,s.fingerprint,key)).quote;assert.deepEqual(retry,qa);state.quoteA=qa;return {total_minor:qa.total_minor,tax_minor:qa.tax_minor,version:qa.version,id:qa.id};
});
await test('QUOTE-02','5D','A → B → A reuses original immutable version and issue time',async()=>{
 ok(await A.from('project_tasks').update({amount_minor:220000}).eq('id',tasks[0].id));ok(await A.from('projects').update({tax_bps:0}).eq('id',p));
 assert((await A.rpc('prepare_quote',{p_project_id:p,p_preview_fingerprint:qa.fingerprint,p_request_key:randomUUID()})).error,'Stale preview accepted');
 qb=(await prepare(A,(await preview()).fingerprint)).quote;assert.equal(qb.version,2);assert.equal(qb.total_minor,385000);
 ok(await A.from('project_tasks').update({amount_minor:150000}).eq('id',tasks[0].id));ok(await A.from('projects').update({tax_bps:800}).eq('id',p));const r=await prepare(A,(await preview()).fingerprint);assert.equal(r.result,'reused_prepared');assert.equal(r.quote.id,qa.id);assert.equal(r.quote.issued_at,qa.issued_at);
});
await test('QUOTE-03','5D','Out-of-order Sent; matching older Sent reuse; parallel explicit Sent idempotency',async()=>{
 await rpc(A,'confirm_quote_sent',{p_quote_id:qb.id});
 const r=await Promise.all([A,A2].map(c=>rpc(c,'confirm_quote_sent_for_followup',{p_quote_id:qa.id})));assert.equal(r.filter(x=>x.transitioned).length,1);
 assert.equal(await count(A,'activities',{project_id:p,type:'quote_marked_sent'}),2);
 const q=ok(await A.from('quotes').select().eq('project_id',p).eq('status','sent').order('version',{ascending:false}));assert.equal(q[0].id,qb.id);
 const reuse=await prepare(A,qa.fingerprint);assert.equal(reuse.result,'reshare_sent');assert.equal(reuse.quote.id,qa.id);assert.equal(await count(A,'quotes',{project_id:p}),2);
 assert.equal(await count(A,'reminders'),0,'Sent created unwanted reminder');
});
await test('QUOTE-04','5D','Profile edits change working fingerprint but leave frozen quote intact',async()=>{
 ok(await A.from('leads').update({customer_name:'Renamed Customer'}).eq('id',leads[0].id));ok(await A.from('business_profiles').update({business_name:'Renamed Builder'}).eq('user_id',ua));
 assert.notEqual((await preview()).fingerprint,qa.fingerprint);assert.deepEqual((await row(A,'quotes',qa.id)).snapshot,qa.snapshot);
 qc=(await prepare(A,(await preview()).fingerprint)).quote;assert.equal(qc.version,3);
});
await test('QUOTE-05','3A–3E','Accept older Sent quote; enforce Won locks; sibling independence; Reopen preserves history',async()=>{
 const won=await rpc(A,'mark_project_won',{p_project_id:p,p_quote_id:qa.id});assert.equal(won.accepted_quote_id,qa.id);assert.equal(won.status,'won');assert.equal((await row(A,'projects',projects[1].id)).status,'draft');
 for(const q of [A.from('project_tasks').update({amount_minor:1}).eq('id',tasks[0].id),A.from('projects').update({tax_bps:1}).eq('id',p),A.from('project_additional_charges').delete().eq('id',charges[0].id),A.rpc('confirm_quote_sent',{p_quote_id:qc.id})])assert((await q).error,'Closed mutation accepted');
 await rpc(A,'confirm_quote_sent',{p_quote_id:qa.id});assert.equal((await row(A,'projects',p)).status,'won');
 ok(await A.from('projects').update({notes:'Internal notes allowed when closed'}).eq('id',p));
 const reopened=await rpc(A,'reopen_project',{p_project_id:p});assert.equal(reopened.status,'quote_sent');assert.equal(reopened.accepted_quote_id,null);assert.equal(await count(A,'activities',{project_id:p,type:'project_marked_won'}),1);assert.deepEqual((await row(A,'quotes',qa.id)).snapshot,qa.snapshot);
});
await test('CONCUR-01','5D','Parallel Prepare requests serialize behind a real PostgreSQL row lock',async()=>{
 ok(await A.from('project_tasks').update({amount_minor:155000}).eq('id',tasks[0].id));const fp=(await preview()).fingerprint;
 const locker=spawn('docker',['exec','-i',dbContainer,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let locked=false,errors='';locker.stdout.on('data',x=>{if(x.toString().includes('LOCK_HELD'))locked=true;});locker.stderr.on('data',x=>errors+=x);
 locker.stdin.write(`begin; select id from public.projects where id='${p}' for update; select 'LOCK_HELD';\n`);
 try{
  for(let n=0;n<50&&!locked;n++)await new Promise(r=>setTimeout(r,50));assert(locked,errors||'Lock not acquired');
  let finished=false;const requests=Promise.all([A,A2].map(c=>prepare(c,fp))).then(x=>{finished=true;return x;});await new Promise(r=>setTimeout(r,500));
  const waits=Number(execFileSync('docker',['exec',dbContainer,'psql','-X','-qAt','-U','postgres','-d','postgres','-c',"select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%prepare_quote%'"]).toString().trim());assert(!finished);assert(waits>=1,'No observed database lock waiter');
  locker.stdin.end('commit;\n');const r=await requests;assert.equal(r[0].quote.id,r[1].quote.id);assert.equal(r.filter(x=>x.result==='created').length,1);state.concurrency={observedLockWaiters:waits,quote_id:r[0].quote.id,version:r[0].quote.version};return state.concurrency;
 }finally{if(!locker.stdin.destroyed)locker.stdin.end('rollback;\n');}
});
await test('REM-01','4A–4F','Site visit concurrent completion has one event and one stage advancement',async()=>{
 reminder=await insert(A,'reminders',{user_id:ua,lead_id:leads[1].id,project_id:projects[2].id,kind:'site_visit',title:'QA site visit',due_at:new Date(Date.now()+3600000).toISOString(),client_request_id:randomUUID()});
 const results=await Promise.all([A,A2].map(c=>c.from('reminders').update({status:'completed'}).eq('id',reminder.id).eq('updated_at',reminder.updated_at).eq('status','open').select()));results.forEach(ok);assert.equal(results.reduce((s,r)=>s+r.data.length,0),1);
 assert.equal(await count(A,'reminder_completion_events',{reminder_id:reminder.id,event_type:'completed'}),1);assert.equal((await row(A,'leads',leads[1].id)).contact_stage,'site_visit_completed');
});
await test('REM-02','5D','Retry after manual stage correction does not overwrite stage; reopen and recomplete are new events',async()=>{
 ok(await A.from('leads').update({contact_stage:'contacted'}).eq('id',leads[1].id));
 ok(await A.from('reminders').update({status:'completed'}).eq('id',reminder.id));assert.equal((await row(A,'leads',leads[1].id)).contact_stage,'contacted');assert.equal(await count(A,'reminder_completion_events',{reminder_id:reminder.id}),1);
 ok(await A.from('reminders').update({status:'open'}).eq('id',reminder.id));ok(await A.from('reminders').update({status:'completed'}).eq('id',reminder.id));assert.equal(await count(A,'reminder_completion_events',{reminder_id:reminder.id}),3);assert.equal((await row(A,'leads',leads[1].id)).contact_stage,'site_visit_completed');
});
await test('RECOVER-01','5C','Lost reminder INSERT response: transport consumes committed response then throws; retry finds one row',async()=>{
 const session=ok(await A.auth.getSession()).session;let dropped=false;
 const broken=createClient(cfg.API_URL,cfg.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{const response=await fetch(input,init);if(!dropped&&String(input).includes('/rest/v1/reminders')&&init?.method==='POST'){await response.text();dropped=true;throw new Error('QA injected response loss AFTER server response');}return response;}}});
 ok(await broken.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token}));
 const request=randomUUID(),values={user_id:ua,lead_id:leads[2].id,kind:'follow_up',title:'Lost response recovery',due_at:new Date(Date.now()+7200000).toISOString(),client_request_id:request};
 const result=await broken.from('reminders').insert(values).select();assert(dropped);assert(result.error);
 const retry=await A.from('reminders').insert(values);assert.equal(retry.error?.code,'23505');assert.equal(await count(A,'reminders',{client_request_id:request}),1);return 'Real insert committed; fetch threw after consuming response; retry unique violation; authenticated request-key read found exactly one row. App recovery algorithm separately Jest-tested.';
});
const bytes=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCjAAf/2Q==','base64');
const bucket=c=>c.storage.from('project-site-photos');
await test('PHOTO-01','2A–2C','Real private JPEG objects and metadata remain project/task specific',async()=>{
 const photos=[];for(const [project_id,task_id,source] of [[p,null,'site_visit'],[p,null,'client_provided'],[projects[1].id,null,'site_visit'],[p,tasks[0].id,'site_visit'],[p,tasks[1].id,'client_provided']]){
  const id=randomUUID(),storage_path=`${ua}/${project_id}/${id}.jpg`;ok(await bucket(A).upload(storage_path,bytes,{contentType:'image/jpeg',upsert:false}));photos.push(await insert(A,'project_photos',{id,user_id:ua,project_id,task_id,source,storage_path}));
 }
 photo=photos[0];state.photos=photos;assert.equal(await count(A,'project_photos',{project_id:p}),4);assert.equal(await count(A,'project_photos',{project_id:projects[1].id}),1);assert.equal(await count(A,'project_photos',{task_id:tasks[0].id}),1);
 const file=ok(await bucket(A).download(photo.storage_path));assert.equal(file.size,bytes.length);const signed=ok(await bucket(A).createSignedUrl(photo.storage_path,60));assert.equal((await fetch(signed.signedUrl)).status,200);return 'Five private objects uploaded via Storage API; distinct project/task metadata; authenticated download and signed URL fetch succeed. Native normalization not exercised.';
});
// Each resource is tested against both independent B and anonymous clients.
const resources=[['business_profiles','user_id',ua,{business_name:'Tamper'}],['leads','id',leads[0].id,{customer_name:'Tamper'}],['projects','id',p,{title:'Tamper'}],['project_tasks','id',tasks[0].id,{amount_minor:1}],['project_additional_charges','id',charges[0].id,{amount_minor:1}],['quotes','id',qa?.id,{total_minor:1}],['reminders','id',reminder?.id,{title:'Tamper'}],['project_photos','id',photo?.id,{source:'client_provided'}],['activities','project_id',p,{detail:{note:'Tamper'}}],['reminder_completion_events','reminder_id',reminder?.id,{reminder_title:'Tamper'}]];
for(const [t,key,id,mutation] of resources){await test('RLS-'+t,'security',`${t}: owner read; B and anonymous SELECT/UPDATE/DELETE denied`,async()=>{
 assert(id,'Fixture unavailable');const original=ok(await A.from(t).select().eq(key,id));assert(original.length>0);
 const outcomes={};for(const [alias,c] of [['B',B],['anonymous',anon]]){outcomes[alias]={read:await denied(c.from(t).select().eq(key,id)),update:await denied(c.from(t).update(mutation).eq(key,id).select()),delete:await denied(c.from(t).delete().eq(key,id).select())};}
 assert.deepEqual(ok(await A.from(t).select().eq(key,id)),original,'Owner rows changed after foreign probes');return outcomes;
});}
await test('RLS-inserts','security','Forged cross-owner and mismatched relationship INSERTs denied',async()=>{
 const operations=[B.from('leads').insert({user_id:ua,customer_name:'Forged',phone:'555',source:'Other'}),B.from('projects').insert({user_id:ub,lead_id:leads[0].id,title:'Forged'}),B.from('project_tasks').insert({user_id:ub,project_id:p,category:'Painting',title:'Forged',amount_minor:1}),B.from('project_additional_charges').insert({user_id:ub,project_id:p,description:'Forged',amount_minor:1}),B.from('reminders').insert({user_id:ub,lead_id:leads[0].id,kind:'other',title:'Forged',due_at:new Date(Date.now()+3600000).toISOString()}),A.from('reminders').insert({user_id:ua,lead_id:leads[2].id,project_id:p,kind:'other',title:'Mismatched',due_at:new Date(Date.now()+3600000).toISOString()}),B.from('activities').insert({user_id:ub,lead_id:leads[0].id,type:'manual_note',detail:{note:'Forged'}}),B.from('project_photos').insert({id:randomUUID(),user_id:ub,project_id:p,task_id:tasks[0].id,source:'site_visit',storage_path:photo.storage_path})];
 for(const op of operations)assert((await op).error,'Forged insert succeeded');return `${operations.length} forged inserts rejected`;
});
await test('RLS-rpcs','security','Foreign and anonymous quote/project RPC authorization',async()=>{
 for(const c of [B,anon])for(const [name,args] of [['prepare_quote',{p_project_id:p,p_preview_fingerprint:qa.fingerprint,p_request_key:randomUUID()}],['confirm_quote_sent',{p_quote_id:qa.id}],['confirm_quote_sent_for_followup',{p_quote_id:qa.id}],['mark_project_won',{p_project_id:p,p_quote_id:qa.id}],['mark_project_lost',{p_project_id:p}],['reopen_project',{p_project_id:p}]])assert((await c.rpc(name,args)).error,`${name} accepted foreign request`);
 assert.equal(await rpc(B,'get_unsent_estimate_snapshot',{p_project_id:p}),null);
});
await test('RLS-immutable','security','Owner cannot mutate financial/history snapshots or internal request ledger',async()=>{
 for(const t of ['quotes','activities','reminder_completion_events']){assert((await A.from(t).delete().eq('user_id',ua)).error);}
 for(const c of [A,B,anon])assert((await c.from('quote_prepare_requests').select()).error);
 assert((await A.from('quotes').update({total_minor:1}).eq('id',qa.id)).error);
 assert((await A.from('projects').update({status:'won'}).eq('id',p)).error);
});
await test('STORAGE-01','security','Known private object path grants neither B nor anonymous access',async()=>{
 for(const c of [B,anon]){
  assert((await bucket(c).download(photo.storage_path)).error);assert((await bucket(c).createSignedUrl(photo.storage_path,60)).error);
  const listed=await bucket(c).list(`${ua}/${p}`);assert(listed.error||listed.data.length===0);
  await bucket(c).remove([photo.storage_path]);assert(ok(await bucket(A).download(photo.storage_path)).size>0);
  assert((await bucket(c).upload(photo.storage_path,bytes,{contentType:'image/jpeg',upsert:true})).error);
 }
 const publicResponse=await fetch(`${cfg.API_URL}/storage/v1/object/public/project-site-photos/${photo.storage_path}`);assert(!publicResponse.ok);
});
await test('PHOTO-02','2A–2C','Active-object delete guard; guarded deleting state and repeat cleanup',async()=>{
 await bucket(A).remove([photo.storage_path]);assert(ok(await bucket(A).download(photo.storage_path)).size>0,'Active object was deleted');
 ok(await A.from('project_photos').update({state:'deleting'}).eq('id',photo.id));ok(await bucket(A).remove([photo.storage_path]));assert((await bucket(A).download(photo.storage_path)).error);
 ok(await A.from('project_photos').delete().eq('id',photo.id));ok(await bucket(A).remove([photo.storage_path]));assert.equal(await count(A,'project_photos',{id:photo.id}),0);
});
await test('STORAGE-02','security','Storage rejects malformed paths, foreign uploads, MIME/size violations and unsupported operations',async()=>{
 const path=`${ua}/${p}/${randomUUID()}.jpg`;
 ok(await bucket(A).upload(path,bytes,{contentType:'image/jpeg',upsert:false}));
 try {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  for (const [name,result] of [
   ['foreign path upload',await bucket(B).upload(`${ua}/${p}/${randomUUID()}.jpg`,bytes,{contentType:'image/jpeg'})],
   ['foreign project upload',await bucket(A).upload(`${ua}/${other.id}/${randomUUID()}.jpg`,bytes,{contentType:'image/jpeg'})],
   ['malformed path',await bucket(A).upload(`${ua}/${p}/extra/${randomUUID()}.jpg`,bytes,{contentType:'image/jpeg'})],
   ['wrong extension',await bucket(A).upload(`${ua}/${p}/${randomUUID()}.png`,bytes,{contentType:'image/jpeg'})],
   ['non-JPEG MIME',await bucket(A).upload(`${ua}/${p}/${randomUUID()}.jpg`,png,{contentType:'image/png'})],
   ['oversize',await bucket(A).upload(`${ua}/${p}/${randomUUID()}.jpg`,Buffer.alloc(10485761),{contentType:'image/jpeg'})],
   ['update',await bucket(A).update(path,bytes,{contentType:'image/jpeg'})],
   ['copy',await bucket(A).copy(path,`${ua}/${p}/${randomUUID()}.jpg`)],
   ['move',await bucket(A).move(path,`${ua}/${p}/${randomUUID()}.jpg`)],
   ['signed upload',await bucket(A).createSignedUploadUrl(`${ua}/${p}/${randomUUID()}.jpg`)]
  ]) assert(result.error,`${name} unexpectedly permitted`);
  assert.equal(ok(await bucket(A).download(path)).size,bytes.length);
 } finally { ok(await bucket(A).remove([path])); }
});
await test('DASH-01','5A','Real exact authenticated counts and current statuses',async()=>{
 await rpc(A,'mark_project_won',{p_project_id:p,p_quote_id:qa.id});
 const n={leads:await count(A,'leads'),quoteSent:await count(A,'projects',{status:'quote_sent'}),won:await count(A,'projects',{status:'won'})};
 const over=await A.from('reminders').select('id',{count:'exact',head:true}).eq('status','open').lt('due_at',new Date().toISOString());ok(over);n.overdue=over.count;
 assert.deepEqual(n,{leads:3,quoteSent:0,won:1,overdue:0});assert.equal(await count(B,'leads'),1);state.dashboard=n;await rpc(A,'reopen_project',{p_project_id:p});return n;
});
await test('MONEY-01','3A–3E','Tax boundaries, separate charge CRUD and project independence',async()=>{
 const sibling=projects[1].id;
 for(const rate of [0,800,3000,1234]){ok(await A.from('projects').update({tax_bps:rate}).eq('id',sibling));assert.equal((await row(A,'projects',sibling)).tax_bps,rate);}
 for(const rate of [-1,3001])assert((await A.from('projects').update({tax_bps:rate}).eq('id',sibling)).error);
 assert.equal((await row(A,'projects',p)).tax_bps,800);
 const c=await insert(A,'project_additional_charges',{user_id:ua,project_id:sibling,description:'Temporary charge',amount_minor:123});ok(await A.from('project_additional_charges').update({amount_minor:456}).eq('id',c.id));assert.equal((await row(A,'project_additional_charges',c.id)).amount_minor,456);ok(await A.from('project_additional_charges').delete().eq('id',c.id));assert.equal(await count(A,'project_additional_charges',{id:c.id}),0);assert.equal(await count(A,'project_additional_charges',{project_id:p}),2);
});
await test('REM-03','4A–4F','Stale edit conflict; stored UTC; intentional deletion cascades history per existing privacy contract',async()=>{
 const old=await row(A,'reminders',reminder.id),instant=new Date(Date.now()+86400000).toISOString();
 ok(await A2.from('reminders').update({due_at:instant}).eq('id',old.id).eq('updated_at',old.updated_at));
 const stale=ok(await A.from('reminders').update({title:'Stale overwrite'}).eq('id',old.id).eq('updated_at',old.updated_at).select());assert.equal(stale.length,0);assert.equal(Date.parse((await row(A,'reminders',old.id)).due_at),Date.parse(instant));
 const n=await count(A,'reminder_completion_events',{reminder_id:old.id});ok(await A.from('reminders').delete().eq('id',old.id));assert.equal(n,3);assert.equal(await count(A,'reminder_completion_events',{reminder_id:old.id}),0);assert.equal(await count(A,'reminders',{id:old.id}),0);
});
await test('DASH-02','5A','Exact HEAD count exceeds server row cap; future/open cutoff and sibling status filters',async()=>{
 const marker='QA pagination '+run;
 const values=Array.from({length:1005},(_,i)=>({user_id:ua,lead_id:leads[2].id,kind:'other',title:marker+' '+i,due_at:new Date(Date.now()+3600000).toISOString()}));
 ok(await A.from('reminders').insert(values));
 const r=await A.from('reminders').select('id',{count:'exact',head:true}).like('title',marker+'%');ok(r);assert.equal(r.count,1005);
 const page=ok(await A.from('reminders').select('id').like('title',marker+'%'));assert.equal(page.length,1000);
 // Backend cutoff is explicit, just as loadDashboardCounts accepts a now parameter.
 const future=await A.from('reminders').select('id',{count:'exact',head:true}).like('title',marker+'%').eq('status','open').lt('due_at',new Date(Date.now()+7200000).toISOString());ok(future);assert.equal(future.count,1005);
 ok(await A.from('reminders').delete().like('title',marker+'%'));return {headCount:r.count,defaultPageLength:page.length,controlledFutureCutoffCount:future.count};
});
await test('PHOTO-03','2A–2C','Task with photos cannot disappear before guarded cleanup; siblings preserved',async()=>{
 const t=await insert(A,'project_tasks',{user_id:ua,project_id:projects[1].id,category:'Painting',title:'Cleanup fixture',amount_minor:100});const id=randomUUID(),path=`${ua}/${projects[1].id}/${id}.jpg`;
 ok(await bucket(A).upload(path,bytes,{contentType:'image/jpeg'}));await insert(A,'project_photos',{id,user_id:ua,project_id:projects[1].id,task_id:t.id,source:'site_visit',storage_path:path});
 assert((await A.from('project_tasks').delete().eq('id',t.id)).error,'Task deletion bypassed restrictive photo FK');
 ok(await A.from('project_photos').update({state:'deleting'}).eq('id',id));ok(await bucket(A).remove([path]));ok(await A.from('project_photos').delete().eq('id',id));ok(await A.from('project_tasks').delete().eq('id',t.id));assert.equal(await count(A,'project_photos',{project_id:projects[1].id}),1);assert.equal(await count(A,'project_photos',{task_id:tasks[1].id}),1);
});
await test('RECOVER-02','5C','Real committed Sent response dropped; retry returns original transition and one activity',async()=>{
 const session=ok(await A.auth.getSession()).session;let dropped=false;
 const broken=createClient(cfg.API_URL,cfg.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{const r=await fetch(input,init);if(String(input).includes('/rpc/confirm_quote_sent_for_followup')&&!dropped){await r.text();dropped=true;throw new Error('QA response loss after Sent commit');}return r;}}});ok(await broken.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token}));
 const failed=await broken.rpc('confirm_quote_sent_for_followup',{p_quote_id:qc.id});assert(dropped);assert(failed.error);
 const sentBefore=await row(A,'quotes',qc.id);const retry=await rpc(A,'confirm_quote_sent_for_followup',{p_quote_id:qc.id});assert.equal(retry.transitioned,false);assert.equal(retry.quote.sent_at,sentBefore.sent_at);
 const events=ok(await A.from('activities').select().eq('project_id',p).eq('type','quote_marked_sent'));assert.equal(events.filter(x=>x.detail.quote_id===qc.id).length,1);
});

await test('DASH-03','5A','Exact requested six-project Dashboard fixture produces 3 / 2 / 2 / 4',async()=>{
 const extension=await insert(A,'projects',{user_id:ua,lead_id:leads[0].id,title:'Extension'});
 const flooring=await insert(A,'projects',{user_id:ua,lead_id:leads[2].id,title:'Flooring'});
 for(const project of [projects[1],projects[2],extension]){
  await insert(A,'project_tasks',{user_id:ua,project_id:project.id,category:'Painting',title:'Dashboard fixture task',amount_minor:10000});
  const snapshot=await rpc(A,'get_unsent_estimate_snapshot',{p_project_id:project.id});const quote=(await rpc(A,'prepare_quote',{p_project_id:project.id,p_preview_fingerprint:snapshot.fingerprint,p_request_key:randomUUID()})).quote;
  await rpc(A,'confirm_quote_sent',{p_quote_id:quote.id});if(project.id!==projects[1].id)await rpc(A,'mark_project_won',{p_project_id:project.id,p_quote_id:quote.id});
 }
 await rpc(A,'mark_project_lost',{p_project_id:flooring.id});
 const due=new Date(Date.now()+2000).toISOString();
 const overdue=ok(await A.from('reminders').insert(Array.from({length:5},(_,i)=>({user_id:ua,lead_id:leads[2].id,kind:'other',title:'Dashboard due fixture '+i,due_at:due}))).select());
 ok(await A.from('reminders').update({status:'completed'}).eq('id',overdue[4].id));await new Promise(r=>setTimeout(r,2200));
 // Execute the application's actual count implementation with real requests.
 const compiled=ts.transpileModule(readFileSync('src/features/dashboard/dashboardApi.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};
 const mocks={'../projects/projectsApi':{ProjectFailure:Error,projectRequest:async(id,work)=>{assert.equal(ok(await A.auth.getUser()).user.id,id);const result=await work(A);assert.equal(ok(await A.auth.getUser()).user.id,id);return result;}},'./dashboardModel':{DASHBOARD_METRICS:['totalLeads','quoteSentProjects','wonProjects','overdueReminders'],EMPTY_COUNTS:{totalLeads:null,quoteSentProjects:null,wonProjects:null,overdueReminders:null}}};
 vm.runInNewContext(compiled,{exports,require:n=>mocks[n],Date,Promise,Number});
 const result=await exports.loadDashboardCounts(ua);assert.deepEqual(JSON.parse(JSON.stringify(result)),{totalLeads:3,quoteSentProjects:2,wonProjects:2,overdueReminders:4});state.exactDashboard=result;
 await rpc(A,'mark_project_won',{p_project_id:p,p_quote_id:qa.id});const changed=await exports.loadDashboardCounts(ua);assert.equal(changed.quoteSentProjects,1);assert.equal(changed.wonProjects,3);await rpc(A,'reopen_project',{p_project_id:p});
 assert.deepEqual(JSON.parse(JSON.stringify(await exports.loadDashboardCounts(ua))),JSON.parse(JSON.stringify(result)));return result;
});

await test('ORPHAN-01','2A–2C','Cross-installation pending upload survives other installation cleanup at >24h (controlled clock)',async()=>{
 const id=randomUUID(),path=`${ua}/${p}/${id}.jpg`;ok(await bucket(A).upload(path,bytes,{contentType:'image/jpeg'}));
 // Production cleanup code, real A2 JWT/API/Storage; only native journal and
 // clock are ports: A2 has no local journal, and time advances 25 hours.
 const code=ts.transpileModule(readFileSync('src/features/photos/photosApi.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};const session=ok(await A2.auth.getSession()).session;
 class FutureDate extends Date {static now(){return Date.now()+25*3600000;}}
 const mocks={'expo-file-system':{},'../../config/env':{},'./photoQueue':{loadPendingPhotos:async()=>[]},'expo-crypto':{randomUUID},'../../lib/supabase':{getSupabaseClient:()=>A2,isCurrentSupabaseClient:c=>c===A2},'../../lib/photoProcessing':{PHOTO_MAX_BYTES:10*1024*1024},'../auth/sessionValidation':{validateServerSession:async()=>{const u=ok(await A2.auth.getUser());return {userId:u.user.id,accessToken:session.access_token};}}};
 vm.runInNewContext(code,{exports,require:n=>{assert(n in mocks,n);return mocks[n];},Date:FutureDate,Set,Promise,Uint8Array,console});
 const result=await exports.cleanupProjectPhotos(ua,p);const download=await bucket(A).download(path);
 state.orphanRace={path,cleanupResult:result,objectStillAvailable:!download.error,clockAdvanceHours:25,deviceA:'independent JWT client with pending identity',deviceB:'independent JWT client with empty local journal',nativeDevices:false};
 assert(!download.error,'SQ-QA-009: real pending Storage object removed by another session; controlled +25h cleanup clock, no native device claim');
});
await test('AUTH-logout','5C','Sign-out clears local session and revoked refresh token cannot establish another session',async()=>{
 const session=ok(await A2.auth.getSession()).session;ok(await A2.auth.signOut({scope:'local'}));assert.equal(ok(await A2.auth.getSession()).session,null);assert((await make().auth.refreshSession({refresh_token:session.refresh_token})).error);
});
state.finalProjects=ok(await A.from('projects').select().order('title'));
state.finalQuotes=ok(await A.from('quotes').select().eq('project_id',p).order('version'));
state.finalActivities=ok(await A.from('activities').select().eq('project_id',p).order('created_at'));
state.finalReminders=ok(await A.from('reminders').select().order('created_at'));
save();console.log(JSON.stringify({pass:records.filter(r=>r.status==='PASS').length,fail:records.filter(r=>r.status==='FAIL').length}));process.exitCode=records.some(r=>r.status==='FAIL')?1:0;
