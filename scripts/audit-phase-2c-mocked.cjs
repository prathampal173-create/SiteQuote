/** Isolated mocked Phase 2C regressions (no backend or native verification).
 * Run after npm ci: node scripts/audit-phase-2c-mocked.cjs
 * Requires the project's TypeScript dev dependency; does not log secrets.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pathUtil = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const folder = `${owner}/${project}`;
const path = `${folder}/${id}.jpg`;
const old = new Date(Date.now() - 72 * 3600_000).toISOString();
const recent = new Date(Date.now() - 2 * 3600_000).toISOString();
const row = (state = 'active') => ({ id, user_id: owner, project_id: project, task_id: null,
  storage_path: path, source: 'site_visit', state, created_at: old, updated_at: old });
let object = null;
let metadata = null;
let pendingRead = 0;
let pendingAfterFirst = false;
let removeLeavesObject = false;
let rejectList = false;
let removed = 0;

const storage = {
  list: async (_folder, opts) => {
    if (rejectList) return { data: null, error: new Error('network') };
    const files = object ? [{ name: `${id}.jpg`, created_at: object.created_at }] : [];
    return { data: opts.search ? files.filter(x => x.name === opts.search) : files, error: null };
  },
  remove: async () => { removed++; if (!removeLeavesObject) object = null; return { data: [], error: null }; }
};
const client = { storage: { from: () => storage }, from: (table) => {
  let op = '', nextState = '';
  const q = {
    select: () => q, eq: () => q, order: () => q,
    range: async () => ({ data: table === 'project_photos' && metadata ? [metadata] : [], error: null }),
    update: x => { op = 'update'; nextState = x.state; return q; },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => {
      if (table === 'projects') return { data: { id: project }, error: null };
      if (op === 'update') { if (metadata) metadata.state = nextState; return { data: metadata && { id }, error: null }; }
      if (op === 'delete') {
        if (!object && metadata?.state === 'deleting') { metadata = null; return { data: { id }, error: null }; }
        return { data: null, error: new Error('storage still present') };
      }
      return { data: metadata, error: null };
    },
    then: resolve => resolve({ data: table === 'project_tasks' ? [] : null, error: null })
  };
  return q;
} };
const mocks = {
  'expo-file-system': { File: class {}, UploadType: { BINARY_CONTENT: 0 } },
  'expo-crypto': { randomUUID: () => id },
  '../../lib/supabase': { getSupabaseClient: () => client, isCurrentSupabaseClient: () => true },
  '../auth/sessionValidation': { validateServerSession: async () => ({ userId: owner, accessToken: 'token' }) },
  '../../config/env': { getBackendConfiguration: () => ({ status: 'ready' }) },
  '../../lib/photoProcessing': { PHOTO_MAX_BYTES: 10485760 },
  './photoQueue': { loadPendingPhotos: async () => {
    pendingRead++;
    return pendingAfterFirst && pendingRead > 1 ? [{ id }] : [];
  } }
};
const filepath = pathUtil.join(__dirname, '..', 'src', 'features', 'photos', 'photosApi.ts');
const compiled = ts.transpileModule(fs.readFileSync(filepath, 'utf8'), { fileName: filepath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, { module: moduleRef, exports: moduleRef.exports,
  require: name => { if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`); return mocks[name]; },
  Date, Promise, Number, Math, Uint8Array, ArrayBuffer, Set, Error, console });
const { cleanupProjectPhotos, deleteSavedPhoto } = moduleRef.exports;
let count = 0;
async function check(label, fn) {
  object = { created_at: old }; metadata = null; pendingRead = 0;
  pendingAfterFirst = false; removeLeavesObject = false; rejectList = false; removed = 0;
  await fn();
  count++;
  console.log(`PASS ${label}`);
}
(async () => {
  await check('old untracked upload is retained for another installation to recover', async () => {
    const result = await cleanupProjectPhotos(owner, project);
    assert.equal(result.recovered, 0);
    assert.equal(result.orphaned, 1);
    assert.equal(removed, 0);
    assert(object);
  });
  await check('young object is not eligible', async () => {
    object.created_at = recent;
    assert.equal((await cleanupProjectPhotos(owner, project)).orphaned, 0);
    assert.equal(removed, 0);
  });
  await check('new pending journal entry protects candidate at second check', async () => {
    pendingAfterFirst = true;
    assert.equal((await cleanupProjectPhotos(owner, project)).orphaned, 0);
    assert.equal(removed, 0);
    assert(pendingRead >= 2);
  });
  await check('existing metadata protects object', async () => {
    metadata = row();
    assert.equal((await cleanupProjectPhotos(owner, project)).orphaned, 0);
    assert.equal(removed, 0);
  });
  await check('Storage list failure fails closed', async () => {
    rejectList = true;
    await assert.rejects(cleanupProjectPhotos(owner, project), e => e.reason === 'storage');
    assert.equal(removed, 0);
  });
  await check('Storage success without removal keeps deleting metadata', async () => {
    metadata = row(); removeLeavesObject = true;
    await assert.rejects(deleteSavedPhoto(owner, metadata), e => e.reason === 'delete');
    assert.equal(metadata.state, 'deleting');
    assert(object);
  });
  await check('retry finalizes after object disappearance', async () => {
    metadata = row('deleting'); object = null;
    await deleteSavedPhoto(owner, metadata);
    assert.equal(metadata, null);
  });
  await check('cross-account owner check rejects delete and cleanup', async () => {
    metadata = row();
    await assert.rejects(deleteSavedPhoto('foreign-user', metadata), e => e.reason === 'not_found');
    await assert.rejects(cleanupProjectPhotos('foreign-user', project), e => e.reason === 'session');
    assert.equal(removed, 0);
  });
  console.log(`ISOLATED MOCK CHECKS: ${count}/8 PASS (not live Storage/RLS/native tests)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
