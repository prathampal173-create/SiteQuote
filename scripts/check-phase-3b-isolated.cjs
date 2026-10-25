/* Dependency-light Phase 3B checks using mocked Supabase/Expo. NOT live DB or native PDF. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
let passed=0;
const root=require('node:path').resolve(__dirname,'..');
for(const ext of ['.ts','.tsx']) require.extensions[ext] = function(m, filename){
  const result=ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    fileName:filename, compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  if(result.diagnostics?.length) throw Error('Parse errors in '+filename);
  m._compile(result.outputText,filename);
};
const {parseUnsentEstimate,matchesPreview,ESTIMATE_CHANGED_MESSAGE}=require(root+'/src/features/estimates/unsentEstimate.ts');
const {buildUnsentEstimateHtml,escapePdfHtml}=require(root+'/src/features/estimates/unsentPdf.ts');
const input={project_id:'P',user_id:'A',project_title:'<Kitchen>',site_address:'11 Main',status:'draft',tax_bps:800,
  customer_name:'Alice & Co',customer_phone:'555',customer_email:'alice@example.test',
  business_name:'Builder LLC',business_phone:'444',business_address:'1 Main',
  tasks:[{id:'t1',category:'Kitchen Remodeling',title:'Cabinets',notes:'Allowed note',amount_minor:150000,sort_order:0},
    {id:'t2',category:'Kitchen Remodeling',title:'Counter',notes:null,amount_minor:50000,sort_order:1},
    {id:'t3',category:'Painting',title:'Finish',notes:null,amount_minor:100000,sort_order:2}],
  charges:[{id:'c1',description:'Permit',amount_minor:10000,sort_order:0},
    {id:'c2',description:'Disposal',amount_minor:5000,sort_order:1}]};
const wrap=(content=input,fingerprint='a'.repeat(64))=>({content,fingerprint});
const original=parseUnsentEstimate(wrap(),'A','P');
let account='A';let clientCurrent=true;let missing=false;let latest=wrap();let calls=0;
const client={rpc:async (fn,args)=> {calls++;assert.equal(fn,'get_unsent_estimate_snapshot');assert.equal(args.p_project_id,'P');return {data:missing?null:latest,error:null};}};
const load0=Module._load;
Module._load=function(request,parent,isMain){
  if(request.endsWith('/lib/supabase'))return{getSupabaseClient:()=>client,isCurrentSupabaseClient:()=>clientCurrent};
  if(request.endsWith('/auth/sessionValidation'))return{validateServerSession:async()=>({userId:account,accessToken:'tok'})};
  if(request==='expo-print')return{printToFileAsync:async()=>({uri:'file:///tmp/mock.pdf'})};
  if(request==='expo-file-system')return{File:class File {delete(){}}};
  return load0.call(this,request,parent,isMain);
};
const api=require(root+'/src/features/estimates/unsentEstimateApi.ts');
const pdf=require(root+'/src/features/estimates/verifiedUnsentPdf.ts');
Module._load=load0;
async function check(name, fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
 await check('$3402 saved values and tax 8%',()=>assert.deepEqual(
   [original.totals.taskSubtotalMinor,original.totals.chargesTotalMinor,original.totals.pretaxMinor,original.totals.taxMinor,original.totals.finalMinor],
   [300000,15000,315000,25200,340200]));
 await check('stable hash returns match',()=>assert.equal(matchesPreview(original,parseUnsentEstimate(wrap(),'A','P')),true));
 await check('altered fingerprint returns stale',()=>assert.equal(matchesPreview(original,parseUnsentEstimate(wrap(input,'b'.repeat(64)),'A','P')),false));
 await check('consistent stale message',()=>assert.equal(ESTIMATE_CHANGED_MESSAGE,'Estimate changed — preview again.'));
 await check('wrong owner rejected',()=>assert.throws(()=>parseUnsentEstimate(wrap(),'B','P')));
 await check('wrong project rejected',()=>assert.throws(()=>parseUnsentEstimate(wrap(),'A','Q')));
 await check('missing snapshot rejected',()=>assert.throws(()=>parseUnsentEstimate(null,'A','P')));
 await check('invalid fingerprint rejected',()=>assert.throws(()=>parseUnsentEstimate(wrap(input,'abc'),'A','P')));
 await check('fractional cents refused',()=>assert.throws(()=>parseUnsentEstimate(wrap({...input,tasks:[{...input.tasks[0],amount_minor:1.5}]}),'A','P')));
 await check('tax >30% refused',()=>assert.throws(()=>parseUnsentEstimate(wrap({...input,tax_bps:3001}),'A','P')));
 await check('zero amounts/tax',()=>assert.equal(parseUnsentEstimate(wrap({...input,tasks:[],charges:[],tax_bps:0}),'A','P').totals.finalMinor,0));
 await check('round-half-up only once',()=>assert.equal(parseUnsentEstimate(wrap({...input,tasks:[{...input.tasks[0],amount_minor:2}],charges:[],tax_bps:2500}),'A','P').totals.taxMinor,1));
 const html=buildUnsentEstimateHtml(original);
 await check('PDF HTML acceptance $3402',()=>assert.match(html,/\$3,402\.00/));
 await check('PDF task/charge/tax itemization',()=>['$3,000.00','$150.00','$252.00','Tax (8.00%)'].forEach(x=>assert.ok(html.includes(x))));
 await check('HTML escapes project/customer',()=>{assert.ok(html.includes('&lt;Kitchen&gt;'));assert.ok(html.includes('Alice &amp; Co'));});
 await check('PDF contains allowed notes',()=>assert.ok(html.includes('Allowed note')));
 await check('PDF HTML injection safe',()=>assert.equal(escapePdfHtml('<script>alert("x")</script>'),'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
 await check('No private field references',()=>['lead_notes','project_notes','photos','accepted_quote_id'].forEach(x=>assert.ok(!html.includes(x))));
 await check('one session-scoped RPC loads snapshot',async()=>{const result=await api.loadUnsentEstimate('A','P');assert.equal(result.fingerprint,original.fingerprint);assert.equal(calls,1);});
 await check('account mismatch stops before query',async()=>{let c=calls;await assert.rejects(()=>api.loadUnsentEstimate('B','P'));assert.equal(calls,c);});
 await check('missing project returns safe error',async()=>{missing=true;await assert.rejects(()=>api.loadUnsentEstimate('A','P'));missing=false;});
 await check('session switched before read rejects',async()=>{account='B';await assert.rejects(()=>api.loadUnsentEstimate('A','P'));account='A';});
 await check('client retired fails closed',async()=>{clientCurrent=false;await assert.rejects(()=>api.loadUnsentEstimate('A','P'));clientCurrent=true;});
 await check('PDF validated twice and returned only after both',async()=>{
   let n=0;let captured='';const uri=await pdf.generateVerifiedUnsentPdf('A','P',original,{load:async()=>{n++;return original;},
     render:async(html)=>{captured=html;return{uri:'file:///cache/test.pdf'}}});
   assert.equal(uri,'file:///cache/test.pdf');assert.equal(n,2);assert.match(captured,/\$3,402\.00/);
 });
 await check('stale before render never creates file',async()=>{
   let n=0;await assert.rejects(()=>pdf.generateVerifiedUnsentPdf('A','P',original,{load:async()=>parseUnsentEstimate(wrap(input,'b'.repeat(64)),'A','P'),render:async()=>{n++;return{uri:'file:///cache/test.pdf'}}}),pdf.StaleEstimateError);assert.equal(n,0);
 });
 await check('concurrent edit after render deletes PDF',async()=>{
   let n=0,removed=[];await assert.rejects(()=>pdf.generateVerifiedUnsentPdf('A','P',original,{load:async()=>++n===1?original:parseUnsentEstimate(wrap(input,'b'.repeat(64)),'A','P'),
     render:async()=>({uri:'file:///cache/test.pdf'}),remove:u=>removed.push(u)}),pdf.StaleEstimateError);
   assert.deepEqual(removed,['file:///cache/test.pdf']);
 });
 await check('network failure after render deletes PDF',async()=>{
   let n=0,removed=[];await assert.rejects(()=>pdf.generateVerifiedUnsentPdf('A','P',original,{load:async()=>{if(++n===2)throw Error('network');return original;},
     render:async()=>({uri:'file:///cache/test.pdf'}),remove:u=>removed.push(u)}));assert.equal(removed.length,1);
 });
 await check('invalid native PDF path rejected',async()=>assert.rejects(()=>pdf.generateVerifiedUnsentPdf('A','P',original,{load:async()=>original,render:async()=>({uri:'https://public.example/test.pdf'})})));
 console.log(`SUCCESS ${passed}/${passed} Phase 3B isolated checks (mocked backend & renderer)`);
 fs.writeFileSync(root+'/scripts/.phase-3b-acceptance.html',html);
})().catch(e=>{console.error(e);process.exitCode=1;});
