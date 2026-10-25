/* Dependency-light mock verification only. NOT PostgreSQL, RLS, Jest or native. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const oldTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const owner = 'account-a', other='account-b', rid='rem-1';
let account = owner, records=[], events=[], next=0, dropReply=false;
const initial = {id:rid,user_id:owner,lead_id:'lead-a',project_id:null,kind:'follow_up',title:'Call',
 note:null,due_at:'2099-01-01T00:00:00Z',status:'open',completed_at:null,created_at:'2026-10-23T00:00:00Z',updated_at:'v1'};
records=[{...initial}];
const db={from(table){
  const state={table,filter:[],action:'read',values:{}};
  const q={select(){return q},eq(k,v){state.filter.push([k,v]);return q},order(){return q},
   async range(from,to){const rows=table==='reminder_completion_events'?events:records;
      return {data:rows.filter(r=>state.filter.every(([k,v])=>r[k]===v)).slice(from,to+1),error:null}},
   update(values){state.action='update';state.values=values;return q},
   async maybeSingle(){let rows=(table==='reminder_completion_events'?events:records)
      .filter(r=>state.filter.every(([k,v])=>r[k]===v));
      let data=rows[0]||null;
      if(data&&state.action==='update'){
        const old=data.status;
        Object.assign(data,state.values,{updated_at:'v'+(++next)});
        if(old!==data.status){
          data.completed_at=data.status==='completed'?'2026-10-24T12:00:00Z':null;
          events.push({id:'e'+(++next),user_id:owner,reminder_id:rid,
           event_type:data.status==='completed'?'completed':'reopened',occurred_at:'2026-10-24T12:00:00Z',
           lead_id:data.lead_id,project_id:data.project_id,reminder_title:data.title,
           reminder_kind:data.kind,reminder_due_at:data.due_at});
        }
      }
      if(dropReply&&state.action==='update'){dropReply=false;return {data:null,error:null};}
      return {data:data?{...data}:null,error:null};
   }
  };return q;
}};
const load=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='../projects/projectsApi')return {projectRequest:async(uid,cb)=>{
   if(uid!==account)throw Error('account/session mismatch');
   const result=await cb(db);
   if(uid!==account)throw Error('account switched');
   return result;
 }};
 return load.call(this,name,parent,isMain);
};
const model=require('../src/features/reminders/reminderModel.ts');
const api=require('../src/features/reminders/remindersApi.ts');
let passed=0;
async function check(label,fn){await fn(); console.log('PASS',label);passed++}
(async()=>{
 await check('Open/Today/Upcoming use local calendar including midnight',()=>{
   const now=new Date(2026,9,23,23,30);
   assert.deepEqual([new Date(now.getTime()-10),new Date(2026,9,23,23,45),new Date(2026,9,24,0,15)]
    .map(x=>model.reminderGroup(x.toISOString(),now)),['Overdue','Today','Upcoming']);
 });
 await check('sort Completed by descending server completion timestamp',()=>{
  const rows=[{...initial,id:'a',status:'completed',completed_at:'2026-10-24T00:00:00Z'},
    {...initial,id:'b',status:'completed',completed_at:'2026-10-25T00:00:00Z'}];
  assert.deepEqual(model.sortReminders(rows).map(x=>x.id),['b','a']);
 });
 await check('UTC offset variants sort by instant rather than timestamp text',()=>{
   const r1={...initial,id:'a',due_at:'2026-10-23T09:00:00+02:00'};
   const r2={...initial,id:'b',due_at:'2026-10-23T08:00:00Z'};
   assert.deepEqual(model.sortReminders([r2,r1]).map(x=>x.id),['a','b']);
 });
 await check('complete makes one server event in mock',async()=>{
  records[0]=await api.setReminderStatus(owner,{...records[0]},'completed');
  assert.equal(events.length,1);assert.equal(events[0].event_type,'completed');
 });
 await check('idempotent repeat completion reads saved status and makes no event',async()=>{
  const saved = await api.setReminderStatus(owner,{...records[0]},'completed');
  assert.equal(saved.status,'completed');assert.equal(events.length,1);
 });
 await check('reopen and complete again retain all events',async()=>{
  records[0]=await api.setReminderStatus(owner,{...records[0]},'open');
  records[0]=await api.setReminderStatus(owner,{...records[0]},'completed');
  assert.deepEqual(events.map(x=>x.event_type),['completed','reopened','completed']);
 });
 await check('read history is scoped to owner and reminder',async()=>{
  const rows=await api.listReminderHistory(owner,rid);
  assert.equal(rows.length,3);assert.equal(rows[0].user_id,owner);
  await assert.rejects(api.listReminderHistory(other,rid),/account/);
 });
 await check('history sorting returns chronological events',()=>{
  assert.deepEqual(model.sortCompletionHistory([...events].reverse()).map(x=>x.event_type),
     ['completed','reopened','completed']);
 });
 await check('lost status response reconciles saved status without new event',async()=>{
   records[0]=await api.setReminderStatus(owner,{...records[0]},'open');
   const stale={...records[0]};dropReply=true;
   const resolved=await api.setReminderStatus(owner,stale,'completed');
   assert.equal(resolved.status,'completed');assert.equal(events.length,5);
 });
 await check('stale original with different saved state rejected, no new event',async()=>{
  const stale={...initial, status:'completed', updated_at:'wrong'};
  await assert.rejects(api.setReminderStatus(owner,stale,'open'));
  assert.equal(events.length,5);
 });
 await check('stale same-status copy is rejected rather than falsely acknowledged',async()=>{
   const stale={...records[0], status:'open'};
   await assert.rejects(api.setReminderStatus(owner,stale,'open'));
   assert.equal(events.length,5);
 });
 await check('cannot mutate foreign reminder',async()=>{
  assert.throws(()=>api.setReminderStatus(other,{...records[0]},'open'));
 });
 await check('account switch rejects request after validation',async()=>{
  account=other;await assert.rejects(api.listReminderHistory(owner,rid));account=owner;
 });
 await check('strict future reschedule and unchanged overdue due preserved',()=>{
  const now=new Date('2026-10-23T09:00:00Z'),past=new Date('2026-10-22T09:00:00Z');
  const draft={leadId:'lead-a',projectId:null,kind:'other',title:'Call',note:'',dueDate:past};
  assert.equal(model.validateReminder(draft,now,past.toISOString()).ok,true);
  assert.equal(model.validateReminder(draft,now).ok,false);
 });
 await check('local date and time normalization preserve UTC instant',()=>{
  const start=new Date(2026,9,23,16,15),selected=new Date(2026,9,24,8,45);
  const updated=model.changeLocalDatePart(start,selected,'date');
  assert.equal(updated.getHours(),16);assert.equal(new Date(updated.toISOString()).getTime(),updated.getTime());
 });
 console.log(`RESULT ${passed}/${passed} isolated pure/mocked checks; not live database verification`);
})().catch(error=>{console.error('FAILED',error);process.exitCode=1}).finally(()=>{
  Module._load=load;Module._extensions['.ts']=oldTs;
});
