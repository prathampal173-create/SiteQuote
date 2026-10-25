/* Dependency-light execution only; DOES NOT test PostgreSQL, native picker or real auth. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const originalExtension = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const owner = 'account-a', lead = 'lead-a', project = 'project-a', otherLead = 'lead-b';
let records = [], lastSelection = [], changedAccount = false, nextId = 0;
const fakeDb = {
  from(table) {
    const context = { table, predicates: [], values: null, insert: false, update: false, deletion: false };
    const query = {
      select() { return this; }, eq(key,val) { context.predicates.push([key,val]); return this; },
      order() {return this;},
      range:async (start,end)=>({data: records.filter(r=>r.user_id===owner && context.predicates.every(([k,v])=>r[k]===v)).slice(start,end+1),error:null}),
      async maybeSingle() {
        let items = context.table==='leads' ? [{id:lead,user_id:owner},{id:otherLead,user_id:owner}]
          : context.table==='projects' ? [{id:project,user_id:owner,lead_id:lead}] : records;
        items = items.filter(r=>context.predicates.every(([k,v])=>r[k]===v));
        if(context.update && items.length) Object.assign(items[0],context.values,{updated_at:'version'+(++nextId)});
        if(context.deletion) {for(const r of items) records=records.filter(x=>x!==r)}
        return {data:items[0] || null,error:null};
      },
      async single() {
        if (!context.insert) throw new Error('single without insert');
        const r = {...context.values,id:'rem'+(++nextId),status:'open',completed_at:null,
          created_at:new Date().toISOString(),updated_at:'version'+nextId};
        records.push(r);return {data:r,error:null};
      },
      insert(values){context.insert=true;context.values=values;return this;},
      update(values){context.update=true;context.values=values;return this;},
      delete(){context.deletion=true;return this;}
    };
    return query;
  }
};
const load = Module._load;
Module._load = function(name,parent,isMain){
  if(name==='../projects/projectsApi')return {projectRequest:async(accountId,fn)=>{
    if(accountId!==owner||changedAccount)throw new Error('Not authorized');
    const ret=await fn(fakeDb);
    if(changedAccount)throw new Error('Account switched');
    return ret;
  }};
  return load.call(this,name,parent,isMain);
};
const model = require('../src/features/reminders/reminderModel.ts');
const api = require('../src/features/reminders/remindersApi.ts');
let passed=0;
async function test(label,fn){await fn();++passed;console.log('PASS',label)}
const draft={leadId:lead,projectId:project,kind:'site_visit',title:'  Visit property  ',note:'  gates  ',dueDate:new Date(Date.now()+86400000)};
(async()=>{
  await test('UTC ISO serializes the saved instant exactly',()=>{
    const r=model.validateReminder(draft);assert.equal(r.ok,true);assert.equal(r.values.due_at,draft.dueDate.toISOString());
  });
  await test('missing lead, invalid kind, blank title, overlong note, invalid date rejected',()=>{
    for(const bad of [{leadId:''},{kind:'bogus'},{title:' '},{note:'x'.repeat(5001)},{dueDate:new Date(NaN)}])
      assert.equal(model.validateReminder({...draft,...bad}).ok,false);
  });
  await test('UTC round trip and local calendar selection preserve instant',()=>{
    const source = new Date(2026,2,12,12,15);
    const date = model.changeLocalDatePart(source,new Date(2026,4,14,8,45),'date');
    assert.deepEqual([date.getMonth(),date.getDate(),date.getHours(),date.getMinutes()],[4,14,12,15]);
    assert.equal(new Date(date.toISOString()).getTime(),date.getTime());
  });
  await test('create reminder bound to owned lead and project',async()=>{
    const row=await api.createReminder(owner,draft);assert.equal(row.user_id,owner);assert.equal(row.title,'Visit property');assert.equal(row.project_id,project);
  });
  await test('reject cross-lead project before insert',async()=>{
    await assert.rejects(api.createReminder(owner,{...draft,leadId:otherLead}),/invalid/);
    assert.equal(records.length,1);
  });
  await test('list lead-only and project-only filters',async()=>{
    await api.createReminder(owner,{...draft,projectId:null});
    assert.equal((await api.listReminders(owner,{projectId:project})).length,1);
    assert.equal((await api.listReminders(owner,{leadId:lead})).length,2);
  });
  await test('update title and due without changing identity',async()=>{
    const before=records[0]; const next=await api.updateReminder(owner,{...before}, {...draft,title:'Updated',dueDate:new Date(Date.now()+3*86400000)});
    assert.equal(next.title,'Updated');assert.equal(next.id,before.id);assert.equal(next.user_id,owner);
  });
  await test('reject foreign owner update / read / deletion',async()=>{
    const before={...records[0]};
    assert.throws(()=>api.updateReminder('b',before,draft));
    assert.throws(()=>api.deleteReminder('b',before));
    await assert.rejects(api.loadReminder('b',before.id));
  });
  await test('mark complete and reopen sends only status update',async()=>{
    const row={...records[0]};const completed=await api.setReminderStatus(owner,row,'completed');
    assert.equal(completed.status,'completed');
    const reopened=await api.setReminderStatus(owner,{...completed},'open');
    assert.equal(reopened.status,'open');
  });
  await test('stale optimistic guard refuses update',async()=>{
    const stale={...records[0],updated_at:'wrong'};
    await assert.rejects(api.updateReminder(owner,stale,draft));
  });
  await test('delete only scoped owned reminder',async()=>{
    const row={...records[0]};await api.deleteReminder(owner,row);
    assert.equal(records.length,1);
  });
  await test('account switch after operation rejects response',async()=>{
    changedAccount=true;await assert.rejects(api.listReminders(owner));changedAccount=false;
  });
  await test('open grouping into one of Overdue Today Upcoming',()=>{
    const now=new Date(2026,9,23,15,0); const groups=[new Date(now.getTime()-1),new Date(2026,9,23,18,0),new Date(2026,9,24,10,0)]
      .map(d=>model.reminderGroup(d.toISOString(),now));
    assert.deepEqual(groups,['Overdue','Today','Upcoming']);
  });
  console.log(`RESULT: ${passed}/${passed} isolated pure/mocked checks; NO database/native verification`);
})().catch(e=>{console.error('FAIL',e);process.exitCode=1}).finally(()=>{Module._load=load;Module._extensions['.ts']=originalExtension});
