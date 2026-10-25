/* Offline isolated behavior checks only. NOT live Supabase, Jest or native device tests. */
const assert=require('node:assert/strict'),fs=require('fs'),Module=require('module');
let ts; try { ts = require('typescript'); } catch {
  const globalModules = require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  ts = require(require('node:path').join(globalModules, 'typescript'));
}
const previous=Module._extensions['.ts'];
Module._extensions['.ts']=function(mod,name){const js=ts.transpileModule(fs.readFileSync(name,'utf8'),{fileName:name,
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;mod._compile(js,name)};
const api={rpc:null,rows:null,session:'A',late:false};
const sharing={isAvailableAsync:async()=>true,shareAsync:async(uri)=>{assert.ok(uri.startsWith('file://'));api.shared=true}};
const printing={printToFileAsync:async()=>({uri:'file:///cache/quote.pdf'}),printAsync:async({uri})=>{api.viewed=uri}};
const orig=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='expo-print')return printing;
 if(name==='expo-sharing')return sharing;
 if(name==='expo-file-system')return {File:class {constructor(uri){this.uri=uri}delete(){api.deleted=true}}};
 if(name.endsWith('/lib/supabase') || name==='../../lib/supabase')return {
  getSupabaseClient:()=>client,isCurrentSupabaseClient:()=>!api.late};
 if(name.endsWith('/auth/sessionValidation') || name==='../auth/sessionValidation')return {
  validateServerSession:async()=>({userId:api.session,accessToken:'token',expiresAtMs:Date.now()+50000})};
 return orig.call(this,name,parent,isMain);
};
const folder='../src/features/estimates/';
const {parsePreparedQuote,parsePrepareResult,frozenEstimate,quoteChanges,quoteReference}=require(folder+'preparedQuotes.ts');
const {buildVersionedQuoteHtml,renderVersionedQuotePdf,shareVersionedQuotePdf,viewVersionedQuotePdf}=require(folder+'versionedPdf.ts');
const {prepareQuote,listPreparedQuotes}=require(folder+'preparedQuotesApi.ts');
const {calculateEstimate}=require(folder+'estimateMath.ts');
const P='c5555555-5555-4555-8555-555555555555';
const content={project_id:P,user_id:'A',project_title:'Kitchen',site_address:'1 Main',status:'draft',tax_bps:800,
 customer_name:'Owner',customer_phone:null,customer_email:null,business_name:'Company',business_phone:null,business_address:null,
 tasks:[{id:'t1',category:'Painting',title:'Paint <walls>',notes:'Shareable task note',amount_minor:150000,sort_order:0},
 {id:'t2',category:'Painting',title:'Floors',notes:null,amount_minor:50000,sort_order:1},
 {id:'t3',category:'Painting',title:'Roof',notes:null,amount_minor:100000,sort_order:2}],
 charges:[{id:'c1',description:'Permit',amount_minor:10000,sort_order:0},
 {id:'c2',description:'Disposal',amount_minor:5000,sort_order:1}]};
const totals={taskSubtotalMinor:300000,chargesTotalMinor:15000,pretaxMinor:315000,taxMinor:25200,finalMinor:340200,taxBps:800};
const row={id:'q1',user_id:'A',project_id:P,version:1,status:'prepared',fingerprint:'a'.repeat(64),request_key:'k',
 snapshot:{content,totals},tasks_subtotal_minor:300000,charges_total_minor:15000,tax_bps:800,tax_minor:25200,
 total_minor:340200,issued_at:'2026-10-23T00:00:00Z',sent_at:null};
const chain={select(){return this},eq(){return this},order(){return this},async range(start,end){return {data:api.rows?.slice(start,end+1)??[],error:null}}};
const client={rpc:async(name,args)=>api.rpc(name,args),from:()=>chain};
let checks=0;
function test(label,fn){return Promise.resolve().then(fn).then(()=>{++checks;console.log('PASS',label)})}
const run=async()=>{
 await test('acceptance $3402 exact integer cents',()=>{assert.deepEqual(calculateEstimate(content.tasks,content.charges,800),totals)});
 await test('half up 1 cent at 5% for 10-cent base',()=>{assert.equal(calculateEstimate([{amount_minor:10}],[],500).taxMinor,1)});
 await test('reject invalid tax and unsafe cents',()=>{assert.throws(()=>calculateEstimate([{amount_minor:-1}],[],0));assert.throws(()=>calculateEstimate([],[],3001))});
 await test('parse immutable snapshot and matching server totals',()=>{assert.equal(frozenEstimate(parsePreparedQuote(row,'A',P)).totals.finalMinor,340200)});
 await test('reject cross account quote',()=>{assert.throws(()=>parsePreparedQuote(row,'B',P),/unauthorized/)});
 await test('reject wrong project quote',()=>{assert.throws(()=>parsePreparedQuote(row,'A','other'),/unauthorized/)});
 await test('reject tampered saved totals',()=>{assert.throws(()=>parsePreparedQuote({...row,total_minor:340201},'A',P),/inconsistent/)});
 await test('reject tampered frozen totals',()=>{assert.throws(()=>parsePreparedQuote({...row,snapshot:{content,totals:{...totals,taxMinor:4}}},'A',P),/inconsistent/)});
 await test('reject missing business',()=>{assert.throws(()=>parsePreparedQuote({...row,snapshot:{content:{...content,business_name:null},totals}},'A',P))});
 await test('PDF contains correct reference and $3402',()=>{const html=buildVersionedQuoteHtml(parsePreparedQuote(row,'A',P));if(process.env.WRITE_HTML)fs.writeFileSync(process.env.WRITE_HTML,html);assert.match(html,/SQ-C55555555555-v1/);assert.match(html,/\$3,402\.00/);assert.match(html,/October 23, 2026/)});
 await test('PDF escapes untrusted text and allows task notes',()=>{const html=buildVersionedQuoteHtml(parsePreparedQuote(row,'A',P));assert.match(html,/Paint &lt;walls&gt;/);assert.match(html,/Shareable task note/);assert.doesNotMatch(html,/HIDDEN INTERNAL/)});
 await test('reference stable for v1 and v2',()=>{assert.equal(quoteReference(row),'SQ-C55555555555-v1');assert.equal(quoteReference({...row,version:2}),'SQ-C55555555555-v2')});
 await test('version delta uses frozen data',()=>{const q=parsePreparedQuote(row,'A',P);assert.equal(quoteChanges(q,null),'First prepared version');assert.equal(quoteChanges(q,q),'Same estimate content')});
 await test('preparation result rejects invented mode',()=>{assert.throws(()=>parsePrepareResult({result:'sent',quote:row},'A',P));assert.equal(parsePrepareResult({result:'created',quote:row},'A',P).quote.version,1)});
 await test('native cache-only PDF generation',async()=>{assert.equal(await renderVersionedQuotePdf(parsePreparedQuote(row,'A',P)),'file:///cache/quote.pdf')});
 await test('reject non-private native PDF URI',async()=>{await assert.rejects(renderVersionedQuotePdf(parsePreparedQuote(row,'A',P),async()=>({uri:'https://public/foo.pdf'})),/private PDF/)});
 await test('native viewing does not update project',async()=>{await viewVersionedQuotePdf('file:///cache/quote.pdf');assert.equal(api.viewed,'file:///cache/quote.pdf')});
 await test('share sheet does not update project',async()=>{await shareVersionedQuotePdf('file:///cache/quote.pdf');assert.equal(api.shared,true)});
 await test('share unavailable fails cleanly',async()=>{sharing.isAvailableAsync=async()=>false;await assert.rejects(shareVersionedQuotePdf('file:///cache/quote.pdf'),/unavailable/);sharing.isAvailableAsync=async()=>true});
 await test('RPC uses stable fingerprint and request key',async()=>{api.rpc=async(name,args)=>{assert.equal(name,'prepare_quote');assert.equal(args.p_preview_fingerprint,row.fingerprint);assert.equal(args.p_request_key,'key1');return {data:{result:'created',quote:row},error:null}};assert.equal((await prepareQuote('A',P,row.fingerprint,'key1')).quote.version,1)});
 await test('RPC sends stale preview warning',async()=>{api.rpc=async()=>({error:{message:'Estimate changed — preview again.'},data:null});await assert.rejects(prepareQuote('A',P,row.fingerprint,'key1'),/Estimate changed/)});
 await test('reject wrong-account session before RPC',async()=>{api.session='B';await assert.rejects(prepareQuote('A',P,row.fingerprint,'key1'),/session/);api.session='A'});
 await test('reject account switch after RPC',async()=>{api.rpc=async()=>{api.late=true;return {data:{result:'created',quote:row},error:null}};await assert.rejects(prepareQuote('A',P,row.fingerprint,'key1'),/account changed/);api.late=false});
 await test('owner filtered quote history parsed',async()=>{api.rows=[row];assert.equal((await listPreparedQuotes('A',P))[0].id,'q1')});
 await test('reject foreign quote history',async()=>{api.rows=[{...row,user_id:'B'}];await assert.rejects(listPreparedQuotes('A',P),/unauthorized/)});
 console.log('RESULT',checks,'/',checks,'isolated behavioral checks PASS');
};
run().catch(e=>{console.error('FAIL',e);process.exitCode=1}).finally(()=>{Module._extensions['.ts']=previous;Module._load=orig});
