/** Phase 5A source-executed model/API checks with fake Supabase queries, not a live DB or a native view. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const origTs = Module._extensions['.ts'];
const origLoad = Module._load;
Module._extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const checks=[];const check=(title,fn)=>checks.push({title,fn});
const owner='account-A';
const metrics = require('../src/features/dashboard/dashboardModel.ts');
const projectModel = require('../src/features/projects/projectModel.ts');
const reminderModel = require('../src/features/reminders/reminderModel.ts');
const now=new Date('2026-10-23T10:00:00Z');
check('Dashboard defines exactly four requested cards',()=>assert.deepEqual(metrics.DASHBOARD_METRICS,['totalLeads','quoteSentProjects','wonProjects','overdueReminders']));
check('Overdue uses same group/predicate as Phase 4B',()=>{
 for(const [status,due] of [['open','2026-10-23T09:59:59Z'],['open','2026-10-23T10:00:00Z'],['open','2026-10-22T18:00:00-05:00'],['completed','2026-10-20T01:00:00Z']])
  assert.equal(metrics.isOverdueOpen(status,due,now),status==='open'&&reminderModel.reminderGroup(due,now)==='Overdue');
 assert.equal(metrics.isOverdueOpen('open','invalid',now),false);
});
check('Quote Sent projects counted as project rows, not distinct leads',()=>{
 const rows=[['a','quote_sent','A'],['b','quote_sent','A'],['c','won','A'],['d','won','B'],['e','draft','C'],['f','lost','C']]
  .map(([id,status,lead_id])=>({project:{id,status,lead_id},leadName:lead_id}));
 assert.equal(new Set(rows.map(r=>r.project.lead_id)).size,3);
 assert.equal(projectModel.filterProjects(rows,'quote_sent').length,2);
 assert.equal(projectModel.filterProjects(rows,'won').length,2);
});
check('Only actual current statuses match, never historical quote count',()=>{
 const rows=[{project:{id:'a',status:'won',quote_versions:9}},{project:{id:'b',status:'quote_sent',quote_versions:6}}];
 assert.equal(projectModel.filterProjects(rows,'quote_sent').length,1);
 assert.equal(projectModel.filterProjects(rows,'won').length,1);
});
check('Dashboard status route inputs accept only quote_sent or won',()=>{
 assert.equal(metrics.dashboardProjectFilter('quote_sent'),'quote_sent'); assert.equal(metrics.dashboardProjectFilter('won'),'won');
 for(const bad of ['draft','lost',undefined,{},'bad']) assert.equal(metrics.dashboardProjectFilter(bad),null);
});
check('Overdue route input is explicit',()=>{ assert.equal(metrics.isDashboardOverdue('overdue'),true); assert.equal(metrics.isDashboardOverdue('completed'),false); });
const state={errors:new Set(),counts:{leads:3,projects_quote_sent:2,projects_won:2,reminders:4},requests:[],sessionValid:true,records:null};
const fake={from(table){const r={table,filters:{},options:{}};state.requests.push(r);
 const q={select(columns,opt){r.options={columns,...opt};return q;},eq(k,v){r.filters[k]=v;return q;},lt(k,v){r.filters['lt:'+k]=v;return q;},
 then(resolve){const id=table==='projects'?'projects_'+r.filters.status:table;
 let count=state.counts[id]??null;
 if(state.records){ count=state.records[table].filter(row=>Object.entries(r.filters).every(([key,val])=>
   key==='lt:due_at' ? new Date(row.due_at).getTime()<new Date(val).getTime() : row[key]===val)).length; }
 resolve({count,error:state.errors.has(id)?new Error('network'):null});}}
 return q;}};
Module._load=function(req,parent,isMain){if(req==='../projects/projectsApi' && parent?.filename.endsWith('dashboardApi.ts')){
 return {ProjectFailure:class ProjectFailure extends Error{},projectRequest:async(account,fn)=>{
  if(!state.sessionValid||account!==owner)throw new Error('unauthorized');return fn(fake);
 }};
 }return origLoad.call(this,req,parent,isMain);};
const {loadDashboardCounts}=require('../src/features/dashboard/dashboardApi.ts');
const counts=async()=>loadDashboardCounts(owner,now);
check('Acceptance fixture counts three leads, two Sent, two Won, four overdue',async()=>{
 assert.deepEqual(await counts(),{totalLeads:3,quoteSentProjects:2,wonProjects:2,overdueReminders:4});
});
check('Every query uses exact count HEAD, owner filter and no row pagination',async()=>{
 state.requests.length=0;await counts();assert.equal(state.requests.length,4);
 for(const r of state.requests){assert.equal(r.options.columns,'id');assert.equal(r.options.count,'exact');assert.equal(r.options.head,true);
  assert.equal(r.filters.user_id,owner);}
 assert.equal(state.requests.filter(r=>r.table==='projects').length,2);
});
check('Project counts scope to current persisted statuses',async()=>{
 state.requests.length=0;await counts();assert.deepEqual(state.requests.filter(r=>r.table==='projects').map(r=>r.filters.status).sort(),['quote_sent','won']);
});
check('Overdue uses UTC less-than and only Open status',async()=>{
 state.requests.length=0;await counts();const r=state.requests.find(r=>r.table==='reminders');
 assert.deepEqual(r.filters,{user_id:owner,status:'open','lt:due_at':now.toISOString()});
});
check('Zero is a valid count and 1500+ is not truncated',async()=>{
 state.counts.leads=0;state.counts.projects_won=1605;const r=await counts();assert.equal(r.totalLeads,0);assert.equal(r.wonProjects,1605);
 state.counts.leads=3;state.counts.projects_won=2;
});
check('Fixture with sibling projects, historical quotes, and a foreign account matches acceptance counts',async()=>{
 const savedRecords=state.records;
 state.records={
 leads:[...['A','B','C'].map(id=>({id,user_id:owner})),{id:'foreign-lead',user_id:'account-B'}],
 projects:[
  ['kitchen','A','quote_sent',4],['bath','A','quote_sent',1],['extension','A','won',5],
  ['roof','B','won',2],['painting','C','draft',0],['floor','C','lost',2],
  ['foreign','foreign-lead','quote_sent',9]
 ].map(([id,lead_id,status,versions])=>({id,lead_id,status,versions,user_id:id==='foreign'?'account-B':owner})),
 reminders:[
  ...[1,2,3,4].map(id=>({id,user_id:owner,status:'open',due_at:'2026-10-23T09:00:00Z'})),
  {id:5,user_id:owner,status:'completed',due_at:'2026-10-22T07:00:00Z'},
  {id:6,user_id:owner,status:'open',due_at:'2026-10-24T06:00:00Z'},
  {id:7,user_id:'account-B',status:'open',due_at:'2026-10-20T01:00:00Z'}]
 };
 try{
  assert.deepEqual(await counts(),{totalLeads:3,quoteSentProjects:2,wonProjects:2,overdueReminders:4});
  const kitchen=state.records.projects[0];kitchen.status='won'; // Mark Won
  assert.deepEqual(await counts(),{totalLeads:3,quoteSentProjects:1,wonProjects:3,overdueReminders:4});
  kitchen.status='draft'; // Reopen
  assert.deepEqual(await counts(),{totalLeads:3,quoteSentProjects:1,wonProjects:2,overdueReminders:4});
  state.records.reminders[0].status='completed'; // Mark done
  assert.equal((await counts()).overdueReminders,3);
  state.records.reminders[1].due_at='2026-10-25T10:00:00Z'; // Reschedule
  assert.equal((await counts()).overdueReminders,2);
 } finally { state.records=savedRecords; }
});
check('Dashboard never queries quotes, photos or PDFs for counts',async()=>{
 state.requests.length=0;await counts();assert.deepEqual([...new Set(state.requests.map(r=>r.table))].sort(),['leads','projects','reminders']);
});
check('Partial backend failures remain unavailable, never false zero',async()=>{
 state.errors.add('projects_won');state.counts.projects_won=null;
 const r=await counts();assert.equal(r.wonProjects,null);assert.equal(r.totalLeads,3);
 state.errors.clear();state.counts.projects_won=2;
});
check('Missing count is unavailable',async()=>{state.counts.leads=null;assert.equal((await counts()).totalLeads,null);state.counts.leads=3;});
check('Unverified or wrong owner is rejected',async()=>{state.sessionValid=false;await assert.rejects(counts);state.sessionValid=true;await assert.rejects(()=>loadDashboardCounts('other',now));});
check('Invalid now rejects rather than counting misleading records',async()=>assert.rejects(()=>loadDashboardCounts(owner,new Date(NaN))));
// Inspect destination screens for the actual query-parameter consumption, beyond route-model checks.
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
check('All four card destinations use real routes and correct params',()=>{
 assert.deepEqual(metrics.dashboardDestination('totalLeads','1'),{pathname:'/(tabs)/leads',params:{dashboard:'1'}});
 assert.deepEqual(metrics.dashboardDestination('quoteSentProjects','2'),{pathname:'/projects',params:{status:'quote_sent',dashboard:'2'}});
 assert.deepEqual(metrics.dashboardDestination('wonProjects','3'),{pathname:'/projects',params:{status:'won',dashboard:'3'}});
 assert.deepEqual(metrics.dashboardDestination('overdueReminders','4'),{pathname:'/(tabs)/reminders',params:{view:'overdue',dashboard:'4'}});
 assert.match(read('src/features/dashboard/DashboardScreen.tsx'),/router\.push\(dashboardDestination/);
});
check('Destination screens consume dashboard query params',()=>{
 assert.match(read('src/features/leads/LeadsScreen.tsx'),/if \(dashboard\).*setSearch\(''\).*setStage\('all'\)/);
 assert.match(read('src/features/projects/ProjectsScreen.tsx'),/setFilter\(dashboardProjectFilter\(status\)/);
 assert.match(read('src/features/reminders/RemindersScreen.tsx'),/setFocusedGroup\('Overdue'\)/);
});
check('Dashboard refresh is focus and foreground triggered and request-fenced',()=>{
 const source=read('src/features/dashboard/DashboardScreen.tsx');
 assert.match(source,/useFocusEffect/);assert.match(source,/AppState\.addEventListener/);
 assert.match(source,/liveScope\.current !== scope/);assert.match(source,/generation\.current/);
});
(async()=>{let pass=0;for(const {title,fn} of checks){try{await fn();console.log('PASS',title);pass++;}catch(e){console.error('FAIL',title,e);process.exitCode=1;}}
 console.log(`Phase 5A isolated: ${pass}/${checks.length} passed`);Module._load=origLoad;Module._extensions['.ts']=origTs;})();
