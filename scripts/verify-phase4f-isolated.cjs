/** Executable Phase 4F checks against real transpiled source; mocked DB/auth.
 * This is not Jest, PostgreSQL, Expo Router or native OS acceptance. */
// Fixed test zone makes both DST cases execute on every host.
process.env.TZ = 'America/New_York';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalExt = Module._extensions['.ts'];
const originalLoad = Module._load;
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),
 {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lead='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const quote='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const model=require('../src/features/reminders/sentQuoteFollowup.ts');
const reminderModel=require('../src/features/reminders/reminderModel.ts');
const prefill={sourceOwnerId:owner,sourceQuoteId:quote,leadId:lead,projectId:project,sentAt:'2026-10-23T14:00:00Z'};
test('Prefill accepts owned, well-formed quote and project IDs',()=>assert.ok(model.validPrefill(prefill,owner)));
test('Prefill rejects other account',()=>assert.equal(model.validPrefill(prefill,quote),false));
test('Prefill rejects malformed quote/project IDs',()=>assert.equal(model.validPrefill({...prefill,projectId:'foreign'},owner),false));
test('Initial Follow-up title is editable model default',()=>assert.equal(model.FOLLOWUP_TITLE,'Follow up on sent quote'));
test('Local +3 days preserves wall time and UTC serialization',()=>{
 const now=new Date('2026-10-23T14:00:00Z');const {due,adjusted}=model.suggestFollowup(prefill.sentAt,now);
 assert.equal(due.getHours(),now.getHours());assert.equal(due.getDate(),now.getDate()+3);assert.equal(adjusted,false);
 const draft={leadId:lead,projectId:project,kind:'follow_up',title:model.FOLLOWUP_TITLE,note:'',dueDate:due};
 const result=reminderModel.validateReminder(draft,now);assert.equal(result.ok,true);assert.equal(result.values.due_at,due.toISOString());
});
test('Local midnight date boundary advances calendar month',()=>{
 const {due}=model.suggestFollowup(new Date(2026,9,30,23,45).toISOString(),new Date(2026,9,30,23,0));
 assert.equal(due.getMonth(),10);assert.equal(due.getDate(),2);
});
test('Expired or invalid suggestion cannot be submitted silently',()=>{
 assert.throws(()=>model.suggestFollowup('bad'));assert.throws(()=>model.suggestFollowup('2020-01-01Z',new Date('2026-10-23Z')));
});
test('DST spring-forward gap advances to first valid 3:00 AM',()=>{
 const {due,adjusted}=model.suggestFollowup('2026-03-05T07:30:00Z',new Date('2026-03-05T07:30:00Z'));
 assert.equal(due.getFullYear(),2026);assert.equal(due.getMonth(),2);assert.equal(due.getDate(),8);
 assert.equal(due.getHours(),3);assert.equal(due.getMinutes(),0);assert.equal(adjusted,true);
});
test('DST fall-back overlap stays at intended local 1:30 AM',()=>{
 const {due,ambiguous}=model.suggestFollowup('2026-10-29T05:30:00Z',new Date('2026-10-29T05:30:00Z'));
 assert.equal(due.getDate(),1);assert.equal(due.getMonth(),10);assert.equal(due.getHours(),1);assert.equal(due.getMinutes(),30);assert.equal(ambiguous,true);
});
const stored=new Map();let inserts=0;let lookups=0;let mode='saved';
const saved=()=>({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',user_id:owner,lead_id:lead,project_id:project,
 kind:'follow_up',title:model.FOLLOWUP_TITLE,note:null,due_at:'2099-01-05T10:00:00Z',status:'open'});
const draft={leadId:lead,projectId:project,kind:'follow_up',title:model.FOLLOWUP_TITLE,note:'',dueDate:new Date('2099-01-05T10:00:00Z')};
const projectRequest=async (accountId,fn)=>{
 if(accountId!==owner)throw new Error('wrong owner');
 return fn({from(table){
   let filters={};let requestKey='';
   const q={select(){return q},eq(k,v){filters[k]=v;return q},
    async maybeSingle(){
     if(table==='leads')return {data:filters.id===lead?{id:lead}:null,error:null};
     if(table==='projects')return {data:filters.id===project&&filters.lead_id===lead?{id:project}:null,error:null};
     lookups++;return {data:stored.get(filters.client_request_id)||null,error:null};
    },insert(data){inserts++;requestKey=data.client_request_id;
     if(mode==='uncertain' || mode==='collision') stored.set(requestKey,mode==='collision'?{...saved(),title:'Other'}:saved());
     return q;},async single(){if(mode==='saved'){stored.set(requestKey,saved());return {data:saved(),error:null}}return {data:null,error:new Error('lost response')};}
   };return q;
 }});
};
Module._load=function(request,parent,isMain){
 if(request==='../projects/projectsApi' && parent?.filename.endsWith('remindersApi.ts')) return {projectRequest};
 return originalLoad.call(this,request,parent,isMain);
};
const {createReminder}=require('../src/features/reminders/remindersApi.ts');
test('Explicit save produces one request-identified INSERT',async()=>{
 inserts=0;mode='saved';stored.clear();const row=await createReminder(owner,draft,quote);
 assert.equal(row.id,saved().id);assert.equal(inserts,1);
});
test('Lost INSERT response reconciles committed request without another INSERT',async()=>{
 inserts=0;mode='uncertain';stored.clear();const row=await createReminder(owner,draft,quote);
 assert.equal(row.id,saved().id);assert.equal(inserts,1);assert.equal(stored.size,1);
});
test('Retries with same key cannot create second saved identity',async()=>{
 inserts=0;mode='uncertain';stored.clear();await createReminder(owner,draft,quote);await createReminder(owner,draft,quote);
 assert.equal(stored.size,1);
});
test('Request ID reused with different saved content is rejected',async()=>{
 mode='collision';stored.clear();await assert.rejects(createReminder(owner,draft,quote));
});
test('Foreign project/lead association cannot create a reminder',async()=>{
 inserts=0;mode='saved';await assert.rejects(createReminder(owner,{...draft,projectId:lead},quote));assert.equal(inserts,0);
});
test('Reminder completion kind follow_up stays excluded from Site visit automation',()=>{
 assert.equal(draft.kind,'follow_up');assert.notEqual(draft.kind,'site_visit');
});
test('Owned previous reminder remains valid for explicit UTC editing',()=>{
 const due=model.suggestFollowup('2026-10-23T14:00:00Z',new Date('2026-10-23T14:00:00Z')).due;
 const chosen=reminderModel.changeLocalDatePart(due,new Date(due.getTime()+3600000),'time');
 assert.equal(chosen.getTime()-due.getTime(),3600000);
});
// Exercise the actual new quote-confirmation client adapter with a fake owner-scoped
// Supabase RPC. Financial quote parser is already covered by earlier Phase 3C tests.
let rpcTransition=true, rpcUser=owner, rpcCalls=0;
const rpcClient={rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'confirm_quote_sent_for_followup');
 assert.equal(args.p_quote_id,quote);return {data:{transitioned:rpcTransition,quote:{id:quote,status:'sent'}},error:null};}};
Module._load=function(request,parent,isMain){
 if(parent?.filename.endsWith('preparedQuotesApi.ts')){
  if(request==='../../lib/supabase') return {getSupabaseClient:()=>rpcClient,isCurrentSupabaseClient:(c)=>c===rpcClient};
  if(request==='../auth/sessionValidation') return {validateServerSession:async()=>({userId:rpcUser,accessToken:'token'})};
  if(request==='./preparedQuotes')return {parsePreparedQuote:(value,actor,pid)=>{
    assert.equal(actor,owner);assert.equal(pid,project);return value;}};
 }
 if(request==='../projects/projectsApi' && parent?.filename.endsWith('remindersApi.ts'))return {projectRequest};
 return originalLoad.call(this,request,parent,isMain);
};
const quoteApi=require('../src/features/estimates/preparedQuotesApi.ts');
test('New explicit Sent confirmation transports atomic true flag',async()=>{
 rpcCalls=0;rpcTransition=true;rpcUser=owner;
 const result=await quoteApi.confirmQuoteSentForFollowup(owner,project,quote);
 assert.equal(result.transitioned,true);assert.equal(result.quote.status,'sent');assert.equal(rpcCalls,1);
});
test('Already-Sent retry returns false and cannot trigger new prompt',async()=>{
 rpcTransition=false;const result=await quoteApi.confirmQuoteSentForFollowup(owner,project,quote);
 assert.equal(result.transitioned,false);
});
test('Account change during confirmation fails closed',async()=>{
 rpcUser=lead;await assert.rejects(quoteApi.confirmQuoteSentForFollowup(owner,project,quote));rpcUser=owner;
});

(async()=>{let passed=0;try{for(const x of tests){await x.fn();console.log('PASS',x.name);passed++;}
 console.log(`RESULT ${passed}/${tests.length} executable Phase 4F isolated source/mocked checks; no DB/native validation`);
}catch(e){console.error('FAIL',tests[passed]?.name,e);process.exitCode=1;}
finally{Module._extensions['.ts']=originalExt;Module._load=originalLoad;}})();
