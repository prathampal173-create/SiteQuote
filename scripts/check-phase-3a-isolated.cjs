/* Phase 3A dependency-light checks: run with installed TypeScript or NODE_PATH set
 * to a global TypeScript installation. These mocks are NOT live Supabase tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
let passed = 0;
function check(label, action) {
  return Promise.resolve().then(action).then(() => { passed++; console.log('PASS', label); });
}
require.extensions['.ts'] = function loadTS(module, filename) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  module._compile(code, filename);
};
const { calculateEstimate, parseTaxBps, formatTaxBps, validateCharge } = require('../src/features/estimates/estimateMath.ts');
const { parseUsdCents } = require('../src/features/tasks/taskModel.ts');
const line = amount_minor => ({ amount_minor });
let activeAccount = 'A';
let active = true;
let status = 'draft';
let tax_bps = 800;
let charges = [];
let tasks = [line(150000), line(50000), line(100000)];
let lastFilters = null;
let lastWrite = null;
const fakeClient = { from(table) {
  const filters = {}; let action = null; let start = 0; let end = 199;
  const q = {
    select() { return q; }, eq(k, v) { filters[k] = v; return q; }, order() { return q; },
    range(a,b) { start=a; end=b; return Promise.resolve(answer()); },
    insert(values) { action = ['insert', values]; return q; },
    update(values) { action = ['update', values]; return q; },
    delete() { action = ['delete', null]; return q; },
    maybeSingle() { return Promise.resolve(answer(true)); },
    then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); }
  };
  function answer(one=false) {
    lastFilters = { ...filters };
    if (action) {
      lastWrite = [table, ...action];
      if (activeAccount !== 'A' || filters.user_id && filters.user_id !== 'A') return { data:null, error:{code:'42501'} };
      if (status !== 'draft') return { data:null, error:{code:'23514'} };
      if (table === 'projects') { tax_bps = action[1].tax_bps; return { data: { id:'P' }, error:null }; }
      if (table === 'project_additional_charges') {
        if (action[0] === 'insert') { charges.push({ id:String(charges.length+1), ...action[1] }); return { data:null,error:null }; }
        const found = charges.find(x=>x.id===filters.id && x.project_id === filters.project_id);
        if (!found) return { data:null,error:null };
        if (action[0] === 'delete') charges.splice(charges.indexOf(found),1);
        else Object.assign(found,action[1]);
        return {data:{id:found.id},error:null};
      }
    }
    const parent = [{id:'P',user_id:'A',status,tax_bps}];
    const list = table === 'projects' ? parent : table === 'project_tasks' ?
      tasks.map((t,i)=>({ ...t, id:String(i),user_id:'A',project_id:'P' })) : charges;
    const filtered=list.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));
    return {data:one ? filtered[0]??null : filtered.slice(start,end+1),error:null};
  }
  return q;
} };
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request.endsWith('/lib/supabase')) return {
    getSupabaseClient: () => fakeClient, isCurrentSupabaseClient: () => active
  };
  if (request.endsWith('/auth/sessionValidation')) return {
    validateServerSession: async () => ({userId:activeAccount, accessToken:'token'})
  };
  return origLoad.call(this, request, parent, isMain);
};
const api = require('../src/features/estimates/estimatesApi.ts');
Module._load = origLoad;
(async () => {
  await check('acceptance $3,402 from tasks $3,000, charges $150 and 8% tax', () => {
    const r=calculateEstimate(tasks,[line(15000)],800);
    assert.deepEqual([r.taskSubtotalMinor,r.chargesTotalMinor,r.taxMinor,r.finalMinor],[300000,15000,25200,340200]);
  });
  await check('zero amounts and tax', () => assert.equal(calculateEstimate([],[],0).finalMinor,0));
  await check('round-half-up once on aggregate cents', () => assert.equal(calculateEstimate([line(1),line(1)],[],2500).taxMinor,1));
  await check('large integer precision', () => assert.equal(calculateEstimate([line(100000001),line(99999999)],[line(1)],750).finalMinor,215000001));
  await check('amount overflow rejected', () => assert.throws(()=>calculateEstimate([line(Number.MAX_SAFE_INTEGER),line(1)],[],0),RangeError));
  await check('unrepresentable input rejected', () => assert.throws(()=>calculateEstimate([line(0.1)],[],0),RangeError));
  await check('invalid tax range rejected', () => assert.throws(()=>calculateEstimate([],[],3001),RangeError));
  await check('tax decimal parsing to basis points', () => { assert.equal(parseTaxBps('8.25'),825); assert.equal(formatTaxBps(825),'8.25'); });
  await check('invalid tax precision rejected', () => assert.equal(parseTaxBps('0.001'),null));
  await check('tax boundaries accepted', () => { assert.equal(parseTaxBps('0'),0); assert.equal(parseTaxBps('30.00'),3000); });
  await check('exact decimal charge validation', () => assert.deepEqual(validateCharge(' Permit ','150.00'), {ok:true,values:{description:'Permit',amount_minor:15000}}));
  await check('negative/overprecision charge rejected', () => { assert.equal(validateCharge('x','-1').ok,false); assert.equal(validateCharge('x','1.001').ok,false); });
  await check('cent parser rejects floats and exponent', () => { assert.equal(parseUsdCents('1e3'),null); assert.equal(parseUsdCents('1.005'),null); });
  await check('save charge and reload persisted estimate', async () => {
    await api.addAdditionalCharge('A','P','Permit','150.00');
    assert.deepEqual([lastWrite[0],lastWrite[1],lastWrite[2].amount_minor],['project_additional_charges','insert',15000]);
    assert.equal((await api.loadWorkingEstimate('A','P')).totals.finalMinor,340200);
  });
  await check('edit charge and recompute without duplicate row', async () => {
    await api.editAdditionalCharge('A','P','1','Permit','100.00');
    assert.equal(charges.length,1);
    assert.equal((await api.loadWorkingEstimate('A','P')).totals.finalMinor,334800);
  });
  await check('save tax in basis points on this project only', async () => {
    await api.saveTaxRate('A','P','30');
    assert.equal(tax_bps,3000);
    assert.equal((await api.loadWorkingEstimate('A','P')).totals.finalMinor,403000);
  });
  await check('closed project rejects financial writes', async () => {
    status='lost';
    await assert.rejects(api.addAdditionalCharge('A','P','x','5'),{reason:'locked'});
    await assert.rejects(api.saveTaxRate('A','P','8'),{reason:'locked'});
    status='draft';
  });
  await check('account mismatch denied before queries', async () => {
    await assert.rejects(api.loadWorkingEstimate('B','P'),{reason:'session'});
    await assert.rejects(api.removeAdditionalCharge('B','P','1'),{reason:'session'});
  });
  await check('stale client results discarded at request boundary', async () => {
    active=false;
    await assert.rejects(api.loadWorkingEstimate('A','P'),{reason:'session'});
    active=true;
  });
  await check('delete charge leaves task subtotal intact', async () => {
    await api.removeAdditionalCharge('A','P','1');
    const next=await api.loadWorkingEstimate('A','P');
    assert.equal(next.totals.taskSubtotalMinor,300000);
    assert.equal(next.totals.chargesTotalMinor,0);
  });
  await check('project scope prevents mutation of missing project', async () => {
    await assert.rejects(api.addAdditionalCharge('A','not-P','x','1'),{reason:'not_found'});
  });
  await check('pagination includes more than 200 saved tasks and charges', async () => {
    tasks=Array.from({length:205},()=>line(100));
    charges=Array.from({length:205},(_,i)=>({id:`many-${i}`,user_id:'A',project_id:'P',amount_minor:1}));
    tax_bps=0;
    const totals=await api.loadWorkingEstimate('A','P');
    assert.equal(totals.tasks.length,205);
    assert.equal(totals.charges.length,205);
    assert.equal(totals.totals.taskSubtotalMinor,20500);
    assert.equal(totals.totals.chargesTotalMinor,205);
    assert.equal(totals.totals.finalMinor,20705);
  });
  console.log(`Phase 3A: ${passed}/22 isolated checks passed (mocked API; not live DB).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
