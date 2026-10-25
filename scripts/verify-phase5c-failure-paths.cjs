/** Phase 5C fault-injection tests against production TypeScript source.
 * Injected transports and OS/native adapters; NOT real Supabase, Android or iOS.
 * Run: node scripts/verify-phase5c-failure-paths.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.PHASE5C_SOURCE_ROOT || path.resolve(__dirname, '..');
const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const tests = [];
const test = (name, fn) => tests.push({name,fn});
function source(rel, mock) {
  const file = path.join(root, rel);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {fileName:file,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  const context={module:m,exports:m.exports, require:(n)=>{
    if(!(n in mock)) throw new Error('Unexpected import '+n+' in '+rel);
    return mock[n];},Date,Promise,Set,Map,Number,Math,Uint8Array,ArrayBuffer,Error,console};
  vm.runInNewContext(compiled,context,{filename:file});
  return m.exports;
}
// Reminder API: simulate a server commit followed by a lost HTTP response.
const state={row:null, updateMode:'success',deleteMode:'success',readFailure:false,updates:0,deletes:0,reads:0};
const original={id, user_id:owner, lead_id:'lead',project_id:null,kind:'site_visit',title:'Site visit',
  note:'',due_at:'2026-11-01T00:00:00Z',status:'open',updated_at:'2026-10-23T00:00:00Z'};
function makeReminderQuery(){
  let operation='read', values=null;
  const q={ select(){return q;},eq(){return q;},update(v){operation='update';values=v;return q;},
    delete(){operation='delete';return q;}, async maybeSingle(){
      if(operation==='read') {state.reads++;return state.readFailure?{data:null,error:new Error('offline')}:{data:state.row,error:null};}
      if(operation==='update'){
        state.updates++;
        if(state.updateMode==='reject')return {data:null,error:new Error('server refused')};
        if(state.row.status!==original.status)return {data:null,error:null};
        state.row={...state.row,status:values.status,updated_at:'2026-10-23T00:01:00Z'};
        if(state.updateMode==='lost')return {data:null,error:new Error('response lost after commit')};
        return {data:state.row,error:null};
      }
      state.deletes++;
      if(state.deleteMode==='reject')return {data:null,error:new Error('server refused')};
      state.row=null;
      if(state.deleteMode==='lost')return {data:null,error:new Error('response lost after delete')};
      return {data:{id},error:null};
    }};
  return q;
}
const reminderApi=source('src/features/reminders/remindersApi.ts',{
 '../projects/projectsApi':{ projectRequest:async(account,work)=> {assert.equal(account,owner);return work({from:(table)=>{
    assert.equal(table,'reminders');return makeReminderQuery();}});}},
 './reminderModel':{validateReminder:()=>({ok:true})}
});
function resetReminder(){state.row={...original};state.updateMode='success';state.deleteMode='success';state.readFailure=false;
 state.updates=0;state.deletes=0;state.reads=0;}
test('lost response AFTER reminder completion commit reconciles saved Completed without second transition',async()=>{
 resetReminder();state.updateMode='lost';const actual=await reminderApi.setReminderStatus(owner,original,'completed');
 assert.equal(actual.status,'completed');assert.equal(state.updates,1);assert.equal(state.reads,1);
});
test('retrying Completed from stale Open row returns saved state without another update',async()=>{
 resetReminder();state.row={...original,status:'completed'};
 const actual=await reminderApi.setReminderStatus(owner,original,'completed');
 assert.equal(actual.status,'completed');assert.equal(state.updates,1);
});
test('already Completed request performs read-only lookup; manual changes are not overwritten',async()=>{
 resetReminder();state.row={...original,status:'completed',updated_at:'later'};
 const actual=await reminderApi.setReminderStatus(owner,state.row,'completed');
 assert.equal(actual.updated_at,'later');assert.equal(state.updates,0);
});
test('rejected update with Open persisted remains failure',async()=>{
 resetReminder();state.updateMode='reject';await assert.rejects(reminderApi.setReminderStatus(owner,original,'completed'));
 assert.equal(state.row.status,'open');assert.equal(state.updates,1);
});
test('offline lookup after ambiguous commit remains unconfirmed, never fabricates success',async()=>{
 resetReminder();state.updateMode='lost';state.readFailure=true;
 await assert.rejects(reminderApi.setReminderStatus(owner,original,'completed'));
 assert.equal(state.row.status,'completed');assert.equal(state.updates,1);
});
test('lost response after saved deletion reconciles owner-scoped absence',async()=>{
 resetReminder();state.deleteMode='lost';await reminderApi.deleteReminder(owner,original);
 assert.equal(state.row,null);assert.equal(state.deletes,1);assert.equal(state.reads,1);
});
test('failed deletion with surviving saved row is not falsely reported successful',async()=>{
 resetReminder();state.deleteMode='reject';
 await assert.rejects(reminderApi.deleteReminder(owner,original));
 assert.equal(state.row.status,'open');
});
test('failed deletion with inaccessible lookup stays unconfirmed',async()=>{
 resetReminder();state.deleteMode='lost';state.readFailure=true;
 await assert.rejects(reminderApi.deleteReminder(owner,original));
});
test('foreign-owner status write denied before any database request',async()=>{
 resetReminder();await assert.rejects(async()=>reminderApi.setReminderStatus(owner,{...original,user_id:'foreign'},'completed'),{reason:'not_found'});
 assert.equal(state.updates,0);
});
// Photo orphan scan: mock PostgREST caps every unbounded response at 200 rows.
const photo={removed:0,contains:true,age:new Date(Date.now()-48*3600000).toISOString(),
 journalTask:'task-201',taskPages:2,failPage:-1,queried:[],scans:0};
const tasks=Array.from({length:201},(_,i)=>({id:`task-${String(i+1).padStart(3,'0')}`}));
function photoClient(){return {
  from(table){const query={filters:[],rangeStart:null};
    const q={select(){return q;},eq(k,v){query.filters.push([k,v]);return q;},order(){return q;},
      range(start){query.rangeStart=start;return Promise.resolve(rowResult());},
      maybeSingle(){return Promise.resolve({data:table==='projects'?{id:project}:null,error:null});},
      then(ok,bad){return Promise.resolve(rowResult()).then(ok,bad)}};
    function rowResult(){
      if(table==='project_photos') return {data:[],error:null};
      if(table==='project_tasks'){
        photo.queried.push(query);
        if(query.rangeStart===photo.failPage)return {data:null,error:new Error('injected page failure')};
        const start=query.rangeStart??0;
        return {data:tasks.slice(start,start+200),error:null};
      }
      return {data:null,error:null};
    }
    return q;
  }, storage:{from(bucket){assert.equal(bucket,'project-site-photos');return {
    async list(folder,opts){assert.equal(folder,`${owner}/${project}`);photo.scans++;
      const items=photo.contains?[{name:`${id}.jpg`,created_at:photo.age}]:[];
      return {data: opts.search?items.filter(x=>x.name.includes(opts.search)):items,error:null};},
    async remove(paths){assert.equal(paths.length,1);assert.equal(paths[0],`${owner}/${project}/${id}.jpg`);photo.removed++;photo.contains=false;return {data:[],error:null};}
  };}}
};}
const nativeClient=photoClient();
const photoApi=source('src/features/photos/photosApi.ts',{
 'expo-file-system':{File:class {},UploadType:{BINARY_CONTENT:0}},
 '../../config/env':{getBackendConfiguration:()=>({status:'ready'})},
 './photoQueue':{loadPendingPhotos:async(_owner,_project,taskId)=>
    (taskId && taskId===photo.journalTask?[{id,photo:{projectId:project,taskId,source:'site_visit'}}]:[])},
 'expo-crypto':{randomUUID:()=>id},
 '../../lib/supabase':{getSupabaseClient:()=>nativeClient,isCurrentSupabaseClient:()=>true},
 '../../lib/photoProcessing':{PHOTO_MAX_BYTES:10*1024*1024},
 '../auth/sessionValidation':{validateServerSession:async()=>({userId:owner,accessToken:'secret-test-token'})}
});
function resetPhoto(){photo.removed=0;photo.contains=true;photo.age=new Date(Date.now()-48*3600000).toISOString();
 photo.journalTask='task-201';photo.failPage=-1;photo.queried=[];photo.scans=0;}
test('repair inspects all 201 task journals before reporting untracked files',async()=>{
 resetPhoto();photo.journalTask='task-201';
 // test row id matches actual fixture, to reserve the orphan on the LAST page
 photo.journalTask=tasks[200].id;
 const result=await photoApi.cleanupProjectPhotos(owner,project);
 assert.equal(result.orphaned,0);assert.equal(photo.removed,0);
 assert(photo.queried.some(q=>q.rangeStart===200));
});
test('repair rechecks all 201 task journals before reporting an untracked file',async()=>{
 resetPhoto();photo.journalTask=null;
 const original=photoApi.cleanupProjectPhotos;
 // Journals at the initial scan are empty. Before final scan, the mock journal appears.
 const tracked = []; const q = source('src/features/photos/photosApi.ts',{
  'expo-file-system':{File:class {},UploadType:{BINARY_CONTENT:0}},
  '../../config/env':{getBackendConfiguration:()=>({status:'ready'})},
  './photoQueue':{loadPendingPhotos:async(_owner,_project,taskId)=>{
    if(taskId===tasks[200].id){tracked.push(taskId);return tracked.length>1?[{id}]:[];}
    return [];}},
  'expo-crypto':{randomUUID:()=>id},
  '../../lib/supabase':{getSupabaseClient:()=>nativeClient,isCurrentSupabaseClient:()=>true},
  '../../lib/photoProcessing':{PHOTO_MAX_BYTES:10*1024*1024},
  '../auth/sessionValidation':{validateServerSession:async()=>({userId:owner,accessToken:'secret-test-token'})}
 });
 const result=await q.cleanupProjectPhotos(owner,project);
 assert.equal(result.orphaned,0);assert.equal(photo.removed,0);assert.equal(tracked.length,2);
});
test('task enumeration failure on page two aborts repair',async()=>{
 resetPhoto();photo.journalTask=null;photo.failPage=200;
 await assert.rejects(photoApi.cleanupProjectPhotos(owner,project),{reason:'read'});
 assert.equal(photo.removed,0);
});
test('old upload with no local pending journal is reported and retained',async()=>{
 resetPhoto();photo.journalTask=null;
 const result=await photoApi.cleanupProjectPhotos(owner,project);
 assert.equal(result.orphaned,1);assert.equal(photo.removed,0);
});
test('young orphan is protected even when no local journal exists',async()=>{
 resetPhoto();photo.journalTask=null;photo.age=new Date(Date.now()-3600000).toISOString();
 const result=await photoApi.cleanupProjectPhotos(owner,project);
 assert.equal(result.orphaned,0);assert.equal(photo.removed,0);
});
test('foreign owner cannot run orphan cleanup before verified auth',async()=>{
 resetPhoto();await assert.rejects(photoApi.cleanupProjectPhotos('foreign',project),{reason:'session'});
 assert.equal(photo.removed,0);
});
(async()=>{
 let passed=0;
 for(const t of tests){try{await t.fn();passed++;console.log(`PASS ${String(passed).padStart(2,'0')} ${t.name}`)}
  catch(e){console.error(`FAIL ${t.name}\n`,e);process.exitCode=1;break;}}
 console.log(`RESULT Phase 5C mocked negative path: ${passed}/${tests.length}${passed===tests.length?' PASS':''} — no live RLS/native evidence`);
})();
