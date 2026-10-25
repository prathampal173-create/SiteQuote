/* Isolated Phase 4D model and SQL contract checks. NOT live SQL, full Jest or native. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const previous=Module._extensions['.ts'];
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const formatter=require('../src/features/leads/siteVisitStageActivity.ts');
const model=require('../src/features/leads/leadModel.ts');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261023090000_phase_4d_site_visit_stage.sql'),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'../supabase/tests/phase_4d_site_visit_stage_security.sql'),'utf8');
let count=0;
function check(desc,fun){fun();count++;console.log('PASS',desc);}
try {
  check('renders server event New -> Site Visit Completed',()=>assert.match(formatter.formatSiteVisitStageActivity({type:'site_visit_stage_advanced',detail:{from_stage:'new',to_stage:'site_visit_completed',reminder_id:'r'}}),/New → Site Visit Completed/));
  check('renders server event Contacted -> Site Visit Completed',()=>assert.match(formatter.formatSiteVisitStageActivity({type:'site_visit_stage_advanced',detail:{from_stage:'contacted',to_stage:'site_visit_completed'}}),/Contacted → Site Visit Completed/));
  check('does not invent manual-note stage event',()=>assert.equal(formatter.formatSiteVisitStageActivity({type:'manual_note',detail:{note:'Visit complete'}}),null));
  check('malformed activity does not claim specific stage',()=>assert.doesNotMatch(formatter.formatSiteVisitStageActivity({type:'site_visit_stage_advanced',detail:{from_stage:'not-stage'}}),/Contacted →|New →/));
  check('stage filters regroup saved lead after authoritative refresh',()=>{
    const original={id:'1',customer_name:'Example',contact_stage:'new'};
    assert.equal(model.filterLeads([original],'','new').length,1);
    assert.equal(model.filterLeads([{...original,contact_stage:'site_visit_completed'}],'','new').length,0);
    assert.equal(model.filterLeads([{...original,contact_stage:'site_visit_completed'}],'','site_visit_completed').length,1);
  });
  check('migration limits real completion transition and site visit',()=>{
    assert.match(sql,/old\.status <> 'open' or new\.status <> 'completed'/);
    assert.match(sql,/new\.kind <> 'site_visit'/);
  });
  check('migration locks authoritative lead row',()=>assert.match(sql,/select contact_stage into prior_stage[\s\S]*?for update;/));
  check('stage transition only for New or Contacted',()=>assert.match(sql,/if prior_stage in \('new'::public\.lead_contact_stage,[\s\S]*?'contacted'::public\.lead_contact_stage\)/));
  check('all stage and activity writes stay in a trigger transaction',()=>{
    assert.match(sql,/update public\.leads/);assert.match(sql,/insert into public\.activities/);
    assert.doesNotMatch(sql,/exception\s+when\s+others\s+then\s+null/i);
  });
  check('actor and verified session checked',()=>{
    assert.match(sql,/actor <> new\.user_id/);assert.match(sql,/is_anonymous/);assert.match(sql,/security definer/);
  });
  check('no external execute and pinned search path',()=>{
    assert.match(sql,/revoke all on function sitequote_internal\.advance_lead_on_site_visit_completion\(\)/);
    assert.match(sql,/set search_path = ''/);
  });
  check('test fixture checks manual correction and rollback',()=>{
    assert.match(fixture,/Retry overwrote manual correction/);
    assert.match(fixture,/Incomplete rollback on required activity failure/);
  });
  check('test fixture checks cross-account isolation and duplicate events',()=>{
    assert.match(fixture,/Cross-account read leaked/);
    assert.match(fixture,/idempotency|duplicated history/i);
  });
  console.log(`RESULT ${count}/${count} isolated source/model checks; PostgreSQL trigger not executed`);
} finally { Module._extensions['.ts']=previous; }
