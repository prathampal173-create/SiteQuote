/* Phase 4C dependency-light checks. Native API, Router and Supabase are NOT run here. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const file = require.resolve('../src/features/notifications/reminderNotificationModel.ts');
const js = ts.transpileModule(fs.readFileSync(file,'utf8'), { fileName:file,
  compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
const mod = new Module(file, module); mod.filename=file; mod.paths=module.paths; mod._compile(js,file);
const m = mod.exports;
const ID='11111111-1111-4111-8111-111111111111', owner='one';
const now=Date.parse('2026-10-23T10:00:00Z');
const row={id:ID,user_id:owner,status:'open',due_at:'2026-10-24T10:00:00+05:30',title:'PRIVATE',note:'CUSTOMER DATA'};
let passed=0; async function check(label,fn){try{await fn();passed++;console.log('PASS',label);}catch(error){console.error('FAIL',label,error);process.exitCode=1;}}
(async()=>{
 await check('granted',()=>assert.equal(m.interpretPermission({status:'granted'}).state,'granted'));
 await check('provisional',()=>assert.equal(m.interpretPermission({status:'denied',ios:{status:3}},true).state,'provisional'));
 await check('ephemeral',()=>assert.equal(m.interpretPermission({status:'denied',ios:{status:4}},true).state,'granted'));
 await check('denied no re-prompt',()=>assert.equal(m.interpretPermission({status:'denied',canAskAgain:false}).canAskAgain,false));
 await check('prompt',()=>assert.equal(m.interpretPermission({status:'undetermined'}).state,'prompt'));
 await check('unavailable',()=>assert.equal(m.interpretPermission(null).state,'unavailable'));
 await check('UTC offset exact',()=>assert.equal(m.eligibleDueAt(row,owner,now).toISOString(),'2026-10-24T04:30:00.000Z'));
 await check('completed ineligible',()=>assert.equal(m.eligibleDueAt({...row,status:'completed'},owner,now),null));
 await check('past ineligible',()=>assert.equal(m.eligibleDueAt(row,owner,Date.parse('2026-10-25T00:00:00Z')),null));
 await check('foreign ineligible',()=>assert.equal(m.eligibleDueAt(row,'two',now),null));
 await check('malformed due ineligible',()=>assert.equal(m.eligibleDueAt({...row,due_at:'tomorrow'},owner,now),null));
 await check('generic contents',()=>{assert.equal(m.GENERIC_TITLE,'SiteQuote Reminder');assert.ok(!m.GENERIC_BODY.includes('CUSTOMER'))});
 await check('parse valid tap',()=>assert.equal(m.parseReminderTap({type:'reminder',reminderId:ID}),ID));
 await check('reject wrong tap type',()=>assert.equal(m.parseReminderTap({type:'quote',reminderId:ID}),null));
 await check('reject malformed tap',()=>assert.equal(m.parseReminderTap({type:'reminder',reminderId:'broken'}),null));
 await check('dedupe and no external flag',async()=>{const s=new m.SessionNotificationScheduler();let n=0;const a={schedule:async (date,p)=>{n++;assert.equal(date.toISOString(),'2026-10-24T04:30:00.000Z');assert.deepEqual(p,{type:'reminder',reminderId:ID});return 'os'}};assert.equal((await s.schedule('scope',owner,[row,row],a,now)).scheduled,1);assert.equal((await s.schedule('scope',owner,[row],a,now)).scheduled,0);assert.equal(n,1);});
 await check('retry after native failure unchanged',async()=>{const s=new m.SessionNotificationScheduler();let n=0;const a={schedule:async()=>{if(++n===1)throw Error('native');return 'os'}};const original=JSON.stringify(row);assert.equal((await s.schedule('scope',owner,[row],a,now)).failed,1);assert.equal((await s.schedule('scope',owner,[row],a,now)).scheduled,1);assert.equal(JSON.stringify(row),original);});
 await check('each account scope independent',async()=>{const s=new m.SessionNotificationScheduler();let n=0;const a={schedule:async()=>{n++;return 'os'}};await s.schedule('scope1',owner,[row],a,now);await s.schedule('scope2',owner,[row],a,now);assert.equal(n,2)});
 await check('fresh authorized tap',async()=>{let n=0;const r=await m.authorizeReminderTap(owner,ID,async(a,id)=>{n++;assert.equal(a,owner);assert.equal(id,ID);return {...row,status:'completed'}},()=>true);assert.equal(r.status,'completed');assert.equal(n,1)});
 await check('foreign tap blocked',async()=>assert.equal(await m.authorizeReminderTap(owner,ID,async()=>({...row,user_id:'other'}),()=>true),null));
 await check('switch during lookup blocked',async()=>{let active=true;assert.equal(await m.authorizeReminderTap(owner,ID,async()=>{active=false;return row},()=>active),null)});
 await check('signed out no lookup',async()=>{let called=false;assert.equal(await m.authorizeReminderTap('',ID,async()=>{called=true;return row},()=>true),null);assert.equal(called,false)});
 await check('session expiry fails closed',async()=>{await assert.rejects(m.authorizeReminderTap(owner,ID,async()=>{throw Error('expired')},()=>true))});
 console.log(`Phase 4C isolated: ${passed}/23 checks passed`);
 if(passed!==23)process.exitCode=1;
})();
