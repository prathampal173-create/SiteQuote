/** Phase 5B executable source-integrated checks. They do NOT use a real database or native OS. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const priorTs = Module._extensions['.ts'];
const priorLoad = Module._load;
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, file);
const task = require('../src/features/tasks/taskModel.ts');
const math = require('../src/features/estimates/estimateMath.ts');
const project = require('../src/features/projects/projectModel.ts');
const dashboard = require('../src/features/dashboard/dashboardModel.ts');
const reminders = require('../src/features/reminders/reminderModel.ts');
const cases = [];
const test = (name, fn) => cases.push({name, fn});
const sampleTasks = [
  { category: 'Kitchen Remodeling', title: 'Kitchen cabinets', notes: 'Special <chars> and multi-line\nnotes', cost: '1500.00' },
  { category: 'Kitchen Remodeling', title: 'Cabinet hardware', notes: '', cost: '500.00' },
  { category: 'Kitchen Remodeling', title: 'Countertop installation', notes: 'Install on Friday', cost: '1000.00' }
];
test('the three requested task titles can be persisted as separate valid fixed-category tasks', () => {
  const valid = sampleTasks.map(task.validateTask);
  assert(valid.every(v => v.ok));
  assert.equal(new Set(sampleTasks.map(x => x.title)).size, 3);
  assert.equal(sampleTasks[0].category, sampleTasks[1].category);
});
test('acceptance prompt Cabinetry / Countertops category names must NOT override fixed product spec', () => {
  assert.equal(task.TASK_CATEGORIES.length, 7);
  assert.equal(task.TASK_CATEGORIES.includes('Cabinetry'), false);
  assert.equal(task.TASK_CATEGORIES.includes('Countertops'), false);
  assert.equal(task.validateTask({...sampleTasks[0], category:'Cabinetry'}).ok, false);
});
test('pricing acceptance calculates 340200 cents exactly, using two distinct charge rows', () => {
  const taskLines = sampleTasks.map(t => ({amount_minor: task.parseUsdCents(t.cost)}));
  const charges = [{amount_minor:10000},{amount_minor:5000}];
  const total = math.calculateEstimate(taskLines,charges,800);
  assert.deepEqual(total, { taskSubtotalMinor:300000,chargesTotalMinor:15000,pretaxMinor:315000,
    taxMinor:25200,finalMinor:340200,taxBps:800 });
  assert.equal(task.formatUsdCents(total.finalMinor),'$3,402.00');
});
test('half-up tax rounding uses exact integer cents and one aggregate rounding', () => {
  assert.equal(math.calculateEstimate([{amount_minor:50}],[],100).taxMinor,1);
  assert.equal(math.calculateEstimate([{amount_minor:1},{amount_minor:1}],[],3000).taxMinor,1);
  assert.equal(math.calculateEstimate([{amount_minor:0}],[],0).finalMinor,0);
});
test('invalid financial inputs are rejected rather than rounded floating-point dollars', () => {
  assert.equal(task.parseUsdCents('0.005'),null);
  assert.equal(task.parseUsdCents('-1'),null);
  assert.throws(()=>math.calculateEstimate([{amount_minor:0.1}],[],800));
  assert.throws(()=>math.calculateEstimate([{amount_minor:1}],[],3001));
});
test('a customer with two independently identified projects is represented twice only in project counts',()=>{
  const list=[{project:{id:'kitchen',lead_id:'lead-a',status:'quote_sent'}},
    {project:{id:'bath',lead_id:'lead-a',status:'draft'}},
    {project:{id:'roof',lead_id:'lead-b',status:'won'}}];
  assert.equal(new Set(list.map(x=>x.project.lead_id)).size,2);
  assert.equal(list.length,3);
  assert.equal(project.filterProjects(list,'quote_sent').length,1);
  assert.equal(project.filterProjects(list,'won').length,1);
});
test('quote history cannot inflate current Quote Sent project counts',()=>{
  const list=[{project:{id:'kitchen',lead_id:'lead-a',status:'won',accepted_quote_id:'quote-v1'}},
    {project:{id:'bath',lead_id:'lead-a',status:'draft'}}];
  assert.equal(project.filterProjects(list,'quote_sent').length,0);
  assert.equal(project.filterProjects(list,'won').length,1);
});
test('each Dashboard card maps to the required real Expo Router list, without customer details in params',()=>{
  assert.deepEqual(dashboard.DASHBOARD_METRICS,['totalLeads','quoteSentProjects','wonProjects','overdueReminders']);
  const routes=dashboard.DASHBOARD_METRICS.map(k=>dashboard.dashboardDestination(k,'test-request'));
  assert.deepEqual(routes.map(r=>r.pathname),['/(tabs)/leads','/projects','/projects','/(tabs)/reminders']);
  assert.equal(routes[1].params.status,'quote_sent');
  assert.equal(routes[2].params.status,'won');
  assert.equal(routes[3].params.view,'overdue');
  assert(!JSON.stringify(routes).includes('Customer'));
});
test('Overdue agrees with Phase 4B at exact UTC cutoff and offset boundaries',()=>{
  const now=new Date('2026-10-23T20:00:00Z');
  for(const [due,status] of [
    ['2026-10-23T19:59:59Z','open'], ['2026-10-23T20:00:00Z','open'],
    ['2026-10-23T16:00:00-04:00','open'], ['2026-10-23T19:59:59Z','completed']]) {
    assert.equal(dashboard.isOverdueOpen(status,due,now),
      status==='open' && reminders.reminderGroup(due,now)==='Overdue');
  }
});
// Mock owner-scoped database only for the lead-history pagination regression.
const owner='11111111-1111-4111-8111-111111111111';
const state={pages:[],calls:[],invalid:false,active:true,failAt:-1};
const mock={from(table){assert.equal(table,'activities');const req={filters:[],orders:[],range:null};state.calls.push(req);
 const builder={select(cols){req.columns=cols;return builder;},eq(k,v){req.filters.push([k,v]);return builder;},
 order(k,opt){req.orders.push([k,opt.ascending]);return builder;},
 range(lo,hi){req.range=[lo,hi]; if(lo===state.failAt) return Promise.resolve({data:null,error:{message:'test failure'}});
 return Promise.resolve({data:state.pages[lo/200]||[],error:null});}};
 return builder;}};
Module._load=function(request,parent,isMain){
 if(parent?.filename?.endsWith('/leads/leadsApi.ts')){
  if(request==='../../lib/supabase')return {getSupabaseClient:()=>mock,isCurrentSupabaseClient:()=>state.active};
  if(request==='../auth/sessionValidation')return {validateServerSession:async()=>state.invalid?null:{userId:owner,accessToken:'test-token'}};
 }
 return priorLoad.call(this,request,parent,isMain);
};
const leadsApi=require('../src/features/leads/leadsApi.ts');
const sampleEvent=(i)=>({id:`activity-${String(i).padStart(5,'0')}`,user_id:owner,lead_id:'lead-one',project_id:'kitchen',
 type:'manual_note',detail:{note:'non-sensitive test'},created_at:new Date(Date.UTC(2026,9,23,0,0,i)).toISOString()});
test('lead activity pagination loads 425 history events across all pages without gaps',async()=>{
  const events=Array.from({length:425},(_,i)=>sampleEvent(i));
  state.pages=[events.slice(0,200),events.slice(200,400),events.slice(400)];
  state.calls=[];state.failAt=-1;state.invalid=false;state.active=true;
  const saved=await leadsApi.listLeadHistory(owner,'lead-one');
  assert.equal(saved.length,425);
  assert.deepEqual(saved.map(x=>x.id),events.map(x=>x.id));
  assert.deepEqual(state.calls.map(x=>x.range),[[0,199],[200,399],[400,599]]);
  for(const x of state.calls){
    assert.deepEqual(x.filters,[['user_id',owner],['lead_id','lead-one']]);
    assert.deepEqual(x.orders,[['created_at',true],['id',true]]);
  }
});
test('failed second activity page rejects incomplete history rather than silently dropping it',async()=>{
 state.pages=[Array.from({length:200},(_,i)=>sampleEvent(i))];state.failAt=200;state.calls=[];
 await assert.rejects(leadsApi.listLeadHistory(owner,'lead-one'), {reason:'request'});
 state.failAt=-1;
});
test('foreign account cannot obtain lead activity via stale session',async()=>{
 state.calls=[];await assert.rejects(leadsApi.listLeadHistory('other-account','lead-one'),{reason:'session'});
 assert.equal(state.calls.length,0);
});
test('revoked session rejects the lead history before exposing any rows',async()=>{
 state.invalid=true;state.calls=[];
 await assert.rejects(leadsApi.listLeadHistory(owner,'lead-one'),{reason:'session'});
 assert.equal(state.calls.length,0);state.invalid=false;
});
test('client generation/account retirement rejects completed responses',async()=>{
 state.pages=[[sampleEvent(0)]];state.active=false;
 await assert.rejects(leadsApi.listLeadHistory(owner,'lead-one'),{reason:'session'});
 state.active=true;
});
test('all app navigation targets in Dashboard contract exist in the project route tree',()=>{
 for(const route of ['app/(tabs)/leads.tsx','app/(tabs)/reminders.tsx','app/projects/index.tsx','app/project/[id].tsx','app/lead/[id].tsx','app/reminder/[id].tsx'])
  assert(fs.existsSync(require('node:path').join(__dirname,'..',route)),route);
});
(async()=>{
 let passed=0;
 try {for(const item of cases){await item.fn(); passed++;console.log(`PASS ${String(passed).padStart(2)} ${item.name}`);}
 console.log(`RESULT Phase 5B source/mocked integration: ${passed}/${cases.length} PASS (NO live Supabase/native validation)`);}
 catch(e){console.error(`FAIL ${passed+1}/${cases.length}: ${cases[passed].name}\n`,e);process.exitCode=1;}
 finally{Module._load=priorLoad;if(priorTs)Module._extensions['.ts']=priorTs;}
})();
