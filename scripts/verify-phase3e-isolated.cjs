/* Node-only mocked behavioral verification. NOT real RLS, Supabase or native device acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = function (mod, file) { mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),
  {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file); };
const P='c5555555-5555-4555-8555-555555555555', A='A';
const original=Module._load;
let session='A', swapped=false, swapAfterRpc=false, response, lastRpc, quotes=[], quoteQueryCount=0, projectRequestCount=0;
const project={id:P,user_id:A,lead_id:'lead1',status:'quote_sent',accepted_quote_id:null,title:'Kitchen',tax_bps:800};
const content={ project_id:P,user_id:A,project_title:'Kitchen',site_address:null,status:'quote_sent',tax_bps:800,
  customer_name:'Customer',customer_phone:null,customer_email:null,business_name:'Company',business_phone:null,business_address:null,
  tasks:[{id:'t1',category:'Painting',title:'Task',notes:null,amount_minor:300000,sort_order:0}],
  charges:[{id:'c1',description:'Permit',amount_minor:15000,sort_order:0}] };
const totals={taskSubtotalMinor:300000,chargesTotalMinor:15000,pretaxMinor:315000,taxMinor:25200,finalMinor:340200,taxBps:800};
const row={id:'q1',user_id:A,project_id:P,version:1,status:'sent',fingerprint:'a'.repeat(64),request_key:'key1',snapshot:{content,totals},tasks_subtotal_minor:300000,
  charges_total_minor:15000,tax_bps:800,tax_minor:25200,total_minor:340200,issued_at:'2026-10-23T00:00:00Z',sent_at:'2026-10-23T01:00:00Z'};
const page = {select(){return this},eq(){return this},order(){return this},async range(start,end){return {data:quotes.slice(start,end+1),error:null}}};
const client={rpc:async(name,args)=>{lastRpc=[name,args];if(swapAfterRpc)swapped=true;return response;},from:()=>{quoteQueryCount++;return page;}};
const failureClass=class ProjectFailure extends Error {constructor(reason){super(reason);this.reason=reason}};
Module._load=function(name,parent,isMain){
  if(name==='expo-print')return {printToFileAsync:async()=>({uri:'file:///quote.pdf'})};
  if(name==='expo-sharing')return {isAvailableAsync:async()=>false};
  if(name==='expo-file-system')return {File:class {}};
  if (name.endsWith('/projectsApi')||name==='./projectsApi') return {
    projectRequest:async(accountId,run)=>{projectRequestCount++;if(accountId!=='A')throw new failureClass('session');return run(client)},
    ProjectFailure:failureClass,projectFailureMessage:()=> 'Project request failed'
  };
  if (name.endsWith('/lib/supabase')||name==='../../lib/supabase') return {
    getSupabaseClient:()=>client,isCurrentSupabaseClient:()=>!swapped
  };
  if (name.endsWith('/auth/sessionValidation')||name==='../auth/sessionValidation')return {
    validateServerSession:async()=>({userId:session,accessToken:'token',expiresAtMs:Date.now()+100000})
  };
  return original.call(this,name,parent,isMain);
};
const {canMarkWon,permittedDecision,formatDecisionHistory}=require('../src/features/projects/projectDecisionModel.ts');
const {summarizeQuote,quoteSummaryLine,loadProjectQuoteSummaries}=require('../src/features/projects/projectQuoteSummary.ts');
const {markProjectWon,markProjectLost,reopenProject}=require('../src/features/projects/projectDecisionsApi.ts');
const {confirmQuoteSent}=require('../src/features/estimates/preparedQuotesApi.ts');
const {buildVersionedQuoteHtml}=require('../src/features/estimates/versionedPdf.ts');
const {calculateEstimate}=require('../src/features/estimates/estimateMath.ts');
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS',name)}
async function main(){
 await test('only Quote Sent with a Sent version can mark Won',()=>{
  for(const status of ['draft','quote_sent','lost','won']) assert.equal(canMarkWon({...project,status},1),status==='quote_sent');
  assert.equal(canMarkWon(project,0),false);assert.equal(canMarkWon({...project,accepted_quote_id:'q1'},1),false);
 });
 await test('Lost/Reopen permission only for relevant statuses',()=>{
  assert.equal(permittedDecision('draft'),'mark_lost');assert.equal(permittedDecision('quote_sent'),'mark_lost');
  assert.equal(permittedDecision('won'),'reopen');assert.equal(permittedDecision('lost'),'reopen');
 });
 const q1={id:'q1',project_id:P,user_id:A,status:'sent',version:1,total_minor:340200};
 const q2={...q1,id:'q2',version:2,total_minor:360000};
 const prepared={...q1,id:'p3',version:3,status:'prepared'};
 const foreign={...q1,id:'other',user_id:'B',version:9};
 await test('latest Sent is highest version, not last confirmation or Prepared',()=>{
  const summary=summarizeQuote(project,[q1,q2,prepared,foreign]);
  assert.match(quoteSummaryLine(project,summary),/\$3,600.00/);assert.equal(summary.label,'Latest sent quote');
 });
 await test('Won binds accepted older version and $3402 amount',()=>{
  const accepted={...project,status:'won',accepted_quote_id:'q1'};
  assert.match(quoteSummaryLine(accepted,summarizeQuote(accepted,[q2,q1])),/Accepted quote: \$3,402.00/);
 });
 await test('foreign prepared cannot be accepted or shown as a Sent quote',()=>{
  const accepted={...project,status:'won',accepted_quote_id:'other'};
  assert.match(quoteSummaryLine(accepted,summarizeQuote(accepted,[prepared,foreign])),/unavailable/);
 });
 await test('open project with no Sent quote displays exact required text',()=>{
  assert.equal(quoteSummaryLine(project,summarizeQuote(project,[prepared,foreign])),'No sent quote');
 });
 await test('owner-scoped project-card query once and filters quote rows',async()=>{
  quotes=[q1,q2,prepared,foreign];quoteQueryCount=0;
  const result=await loadProjectQuoteSummaries('A',[project]);
  assert.equal(quoteQueryCount,1);assert.equal(result.get(P).amountMinor,360000);
 });
 await test('Mark Won sends only project ID and selected quote ID to RPC',async()=>{
  response={data:{...project,status:'won',accepted_quote_id:'q1'},error:null};
  const saved=await markProjectWon('A',P,'q1');
  assert.equal(saved.accepted_quote_id,'q1');assert.deepEqual(lastRpc,['mark_project_won',{p_project_id:P,p_quote_id:'q1'}]);
 });
 await test('Mark Won rejects missing choice, wrong owner and unexpected acceptance',async()=>{
  await assert.rejects(markProjectWon('A',P,''),/invalid/);
  response={data:{...project,user_id:'B',status:'won',accepted_quote_id:'q1'},error:null};
  await assert.rejects(markProjectWon('A',P,'q1'),/request/);
  response={data:{...project,status:'won',accepted_quote_id:'q2'},error:null};
  await assert.rejects(markProjectWon('A',P,'q1'),/request/);
 });
 await test('Mark Lost and Reopen use existing authenticated RPC signatures',async()=>{
  response={data:{...project,status:'lost'},error:null};await markProjectLost('A',P);
  assert.deepEqual(lastRpc,['mark_project_lost',{p_project_id:P}]);
  response={data:{...project,status:'quote_sent'},error:null};await reopenProject('A',P);
  assert.deepEqual(lastRpc,['reopen_project',{p_project_id:P}]);
 });
 await test('explicit Sent confirmation returns validated immutable version',async()=>{
  response={data:row,error:null};const confirmed=await confirmQuoteSent('A',P,'q1');
  assert.equal(confirmed.total_minor,340200);assert.deepEqual(lastRpc,['confirm_quote_sent',{p_quote_id:'q1'}]);
 });
 await test('Sent confirmation rejects non-Sent or cross-account RPC results',async()=>{
  response={data:{...row,status:'prepared',sent_at:null},error:null};
  await assert.rejects(confirmQuoteSent('A',P,'q1'),/Unexpected confirmation/);
  response={data:{...row,user_id:'B'},error:null};
  await assert.rejects(confirmQuoteSent('A',P,'q1'),/unauthorized/);
 });
 await test('Sent confirmation rejects account switch after request',async()=>{
  response={data:row,error:null};swapAfterRpc=true;
  await assert.rejects(confirmQuoteSent('A',P,'q1'),/account changed/);swapped=false;swapAfterRpc=false;
 });
 await test('quote data retained $3402 with integer cents and immutable PDF',()=>{
  assert.equal(calculateEstimate(content.tasks,content.charges,800).finalMinor,340200);
  const html=buildVersionedQuoteHtml(row);assert.match(html,/\$3,402.00/);assert.match(html,/SQ-C55555555555-v1/);
 });
 await test('Won and Sent history messages include quote version/approval',()=>{
  assert.match(formatDecisionHistory({type:'project_marked_won',detail:{project_title:'Kitchen',from_status:'quote_sent',to_status:'won',accepted_quote_version:1,accepted_quote_id:'q1'}}),/Accepted v1/);
  assert.match(formatDecisionHistory({type:'quote_marked_sent',detail:{project_title:'Kitchen',from_status:'draft',to_status:'quote_sent',version:1}}),/Sent v1/);
 });
 await test('new migration exists and contains owner, same-project, append-only safeguards',()=>{
  const m=fs.readFileSync('supabase/migrations/20261023060000_phase_3e_quote_decisions.sql','utf8');
  assert.match(m,/foreign key \(user_id,id,accepted_quote_id\)/i);
  assert.match(m,/status='sent'/);assert.match(m,/for update/);assert.match(m,/public.activities/);
 });
 console.log(`RESULT ${passed}/${passed} isolated mocked/pure checks passed; live RLS and concurrency NOT tested`);
}
main().catch((e)=>{console.error('FAIL',e);process.exitCode=1}).finally(()=>{
  Module._extensions['.ts']=previous;Module._load=original;
});
