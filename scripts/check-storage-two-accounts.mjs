/**
 * Phase 0B4 + Phase 2B + Phase 2C REAL Storage API/metadata test; a disposable project and two previously
 * email-verified users are REQUIRED. Not part of the mobile app.
 * No service key; no direct writes to storage.objects; no credentials logged.
 * Run: SITEQUOTE_RUN_STORAGE_TEST=YES node --env-file=.env scripts/check-storage-two-accounts.mjs
 * On error, photo cleanup is best effort; database fixtures remain intentionally.
 * Run ONLY against a disposable Supabase installation; 2B metadata rows can be orphaned
 * unless the test is interrupted; reset fixtures after this run.
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'project-site-photos';
const MAX = 10_485_760;
// Actual 1x1 white JPEG (not a simulated Storage response).
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKcAD//Z',
  'base64'
);
const fail = (stage) => Object.assign(new Error(stage), { name: 'SiteQuoteStorageCheck' });
function assert(condition, stage) { if (!condition) throw fail(stage); }
function hiddenInput(prompt) {
  assert(process.stdin.isTTY && process.stdin.setRawMode, 'Interactive local terminal required');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(`${prompt} (hidden): `);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') {
          end(); reject(fail('Cancelled')); return;
        }
        if (char === '\n' || char === '\r') { end(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    function end() {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    }
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}
function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
function allowed(result, stage) {
  assert(!result.error && result.data != null, `${stage}: expected success`);
  return result.data;
}
function denied(result, stage) {
  // Storage may intentionally return 404 rather than a revealing RLS error.
  assert(!!result.error && result.data == null, `${stage}: unexpectedly allowed`);
}
async function main() {
  assert(process.env.NODE_ENV !== 'production', 'Development test only');
  assert(process.env.SITEQUOTE_RUN_STORAGE_TEST === 'YES',
    'Use a disposable project and set SITEQUOTE_RUN_STORAGE_TEST=YES');
  const url = (process.env.SITEQUOTE_STORAGE_TEST_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)?.trim() ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  let parsed;
  try { parsed = new URL(url); } catch { throw fail('Public Supabase HTTPS origin missing'); }
  const localOnly = parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  assert((parsed.protocol === 'https:' || localOnly) && parsed.pathname === '/' &&
    !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
    'Only HTTPS or local loopback HTTP Supabase origins are allowed');
  assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key), 'Publishable-only API key required');

  console.log('DISPOSABLE test project only: test leads/projects persist after this script.');
  const emailA = (await hiddenInput('Verified account A email')).trim();
  const passA = await hiddenInput('Account A password');
  const emailB = (await hiddenInput('Verified account B email')).trim();
  const passB = await hiddenInput('Account B password');
  assert(emailA && emailB && emailA.toLowerCase() !== emailB.toLowerCase(),
    'Two distinct account emails required');
  const a = client(url, key);
  const b = client(url, key);
  const unsigned = client(url, key);
  const aAuth = await a.auth.signInWithPassword({ email: emailA, password: passA });
  const bAuth = await b.auth.signInWithPassword({ email: emailB, password: passB });
  assert(!aAuth.error && !!aAuth.data.user?.email_confirmed_at && !!aAuth.data.session,
    'A must have a confirmed, authenticated session');
  assert(!bAuth.error && !!bAuth.data.user?.email_confirmed_at && !!bAuth.data.session,
    'B must have a confirmed, authenticated session');
  const aId = aAuth.data.user.id;
  const bId = bAuth.data.user.id;
  assert(aId !== bId, 'Two distinct user IDs required');

  const marker = randomUUID();
  const aLead = allowed(await a.from('leads').insert({
    user_id: aId, customer_name: `Storage check ${marker}`, phone: '000', source: 'Other'
  }).select('id').single(), 'A lead fixture');
  const bLead = allowed(await b.from('leads').insert({
    user_id: bId, customer_name: `Storage check ${marker}`, phone: '000', source: 'Other'
  }).select('id').single(), 'B lead fixture');
  const aProject = allowed(await a.from('projects').insert({
    user_id: aId, lead_id: aLead.id, title: `Storage check ${marker}`
  }).select('id').single(), 'A project fixture');
  const bProject = allowed(await b.from('projects').insert({
    user_id: bId, lead_id: bLead.id, title: `Storage check ${marker}`
  }).select('id').single(), 'B project fixture');

  const path = (user, project, photo = randomUUID()) => `${user}/${project}/${photo}.jpg`;
  const ownPath = path(aId, aProject.id);
  const movePath = path(aId, aProject.id);
  const copyPath = path(aId, aProject.id);
  const aBucket = a.storage.from(BUCKET);
  const bBucket = b.storage.from(BUCKET);
  const anonBucket = unsigned.storage.from(BUCKET);
  const cleanup = new Set([ownPath, movePath, copyPath]);
  const upload = (bucket, objectPath, data = JPEG, contentType = 'image/jpeg', upsert = false) =>
    bucket.upload(objectPath, data, { contentType, upsert });
  try {
    allowed(await upload(aBucket, ownPath), 'A uploads own JPEG');
    const bytes = allowed(await aBucket.download(ownPath), 'A downloads own JPEG');
    assert(Buffer.from(await bytes.arrayBuffer()).equals(JPEG), 'A downloaded different bytes');
    const listed = allowed(await aBucket.list(`${aId}/${aProject.id}`), 'A lists own photos');
    assert(listed.some((file) => file.name === ownPath.split('/')[2]), 'A photo absent from listing');
    const signed = allowed(await aBucket.createSignedUrl(ownPath, 60), 'A signs own photo');
    assert(typeof signed.signedUrl === 'string' && signed.signedUrl.length > 0,
      'A did not receive a signed URL');

    denied(await bBucket.download(ownPath), 'B downloads A photo');
    denied(await bBucket.createSignedUrl(ownPath, 60), 'B signs A photo');
    const bList = allowed(await bBucket.list(`${aId}/${aProject.id}`), 'B lists A path');
    assert(bList.length === 0, 'B can list A photo');
    await bBucket.remove([ownPath]);
    // Removal may return a no-op success for inaccessible names: test the real bytes.
    allowed(await aBucket.download(ownPath), 'A object survives B delete attempt');

    denied(await upload(bBucket, path(aId, aProject.id)), 'B uploads to A path');
    denied(await upload(aBucket, path(aId, bProject.id)),
      'A uploads into B project under A user path');
    denied(await upload(anonBucket, path(aId, aProject.id)), 'Signed-out upload');
    denied(await anonBucket.download(ownPath), 'Signed-out download');
    denied(await anonBucket.createSignedUrl(ownPath, 60), 'Signed-out signing');
    const publicResponse = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${ownPath}`);
    assert(!publicResponse.ok, 'Private object was served via the public endpoint');

    denied(await upload(aBucket, `invalid/${aProject.id}/${randomUUID()}.jpg`),
      'Malformed user UUID');
    denied(await upload(aBucket, path(aId, randomUUID())), 'Nonexistent project');
    denied(await upload(aBucket, `${aId}/${aProject.id}/extra/${randomUUID()}.jpg`),
      'Extra path segment');
    denied(await upload(aBucket, `${aId}/${aProject.id}/${randomUUID()}.png`),
      'Wrong filename extension');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    denied(await upload(aBucket, path(aId, aProject.id), png, 'image/png'),
      'Non-JPEG MIME type');
    denied(await upload(aBucket, path(aId, aProject.id), Buffer.alloc(MAX + 1), 'image/jpeg'),
      'More than 10 MiB');

    denied(await upload(aBucket, ownPath, JPEG, 'image/jpeg', true), 'Overwrite/upsert');
    denied(await aBucket.update(ownPath, JPEG, { contentType: 'image/jpeg' }),
      'Direct object update');
    denied(await aBucket.createSignedUploadUrl(path(aId, aProject.id)),
      'Signed-upload URL (not enabled in 0B4)');
    denied(await aBucket.move(ownPath, movePath), 'Object move');
    denied(await aBucket.copy(ownPath, copyPath), 'Object copy');
    allowed(await aBucket.download(ownPath), 'A original photo still exists');
    // Phase 2B: metadata can be created only for a real object, with owned
    // project and optional task from the SAME project. Real RLS, not fake SQL rows.
    const photoId = ownPath.split('/')[2].replace(/\.jpg$/, '');
    const meta = (client, values) => client.from('project_photos').insert(values)
      .select('id,task_id,storage_path,state').single();
    const direct = { id: photoId, user_id: aId, project_id: aProject.id,
      task_id: null, storage_path: ownPath, source: 'site_visit' };
    denied(await meta(b, direct), 'B cannot create metadata in A account');
    denied(await meta(a, { ...direct, user_id: bId }), 'A cannot claim B ownership');
    denied(await meta(a, { ...direct, task_id: randomUUID() }), 'Unknown task cannot attach');
    const ownMeta = allowed(await meta(a, direct), 'A inserts direct photo metadata');
    assert(ownMeta.task_id === null && ownMeta.state === 'active', 'Direct project metadata semantics');
    const bReads = allowed(await b.from('project_photos').select('id').eq('project_id', aProject.id),
      'B reads metadata with RLS');
    assert(bReads.length === 0, 'B must see no A metadata');
    denied(await unsigned.from('project_photos').select('id').eq('project_id', aProject.id),
      'Anonymous metadata SELECT denied');
    const aReads = allowed(await a.from('project_photos').select('id').eq('project_id', aProject.id),
      'A reads own photo metadata');
    assert(aReads.some((r) => r.id === photoId), 'A direct photo missing');

    const task = allowed(await a.from('project_tasks').insert({
      user_id: aId, project_id: aProject.id, category: 'Painting', title: 'Phase 2B task'
    }).select('id').single(), 'A same-project task');
    const otherAProject = allowed(await a.from('projects').insert({
      user_id: aId, lead_id: aLead.id, title: `Other photo project ${marker}`
    }).select('id').single(), 'A other project fixture');
    const otherTask = allowed(await a.from('project_tasks').insert({
      user_id: aId, project_id: otherAProject.id, category: 'Flooring', title: 'Other project task'
    }).select('id').single(), 'A other-project task');
    const taskPath = path(aId, aProject.id);
    cleanup.add(taskPath);
    allowed(await upload(aBucket, taskPath), 'A task photo upload');
    const taskPhoto = { id: taskPath.split('/')[2].replace(/\.jpg$/, ''),
      user_id: aId, project_id: aProject.id, task_id: task.id,
      storage_path: taskPath, source: 'client_provided' };
    denied(await meta(a, { ...taskPhoto, task_id: otherTask.id }),
      'A cannot attach another project task');
    const taskMeta = allowed(await meta(a, taskPhoto), 'A inserts same-project task photo');
    assert(taskMeta.task_id === task.id, 'Saved task association mismatch');
    const taskRows = allowed(await a.from('project_photos').select('id')
      .eq('user_id', aId).eq('project_id', aProject.id).eq('task_id', task.id),
      'Exact task gallery filter');
    assert(taskRows.length === 1 && taskRows[0].id === taskPhoto.id,
      'Task photos leaked or were not selected');
    denied(await meta(a, { ...direct, id: randomUUID(), storage_path: path(aId, aProject.id) }),
      'Metadata for an object that was not uploaded');
    console.log('PASS: Phase 2B metadata owner RLS, private records, matching project/task, direct/task separation and uploaded-object check.');


    // Phase 2C: an active row prohibits object deletion, and metadata can't
    // be deleted while the Storage object still exists.
    await aBucket.remove([ownPath]);
    allowed(await aBucket.download(ownPath), 'Active object must survive direct Storage removal');
    const prematureDelete = await a.from('project_photos').delete()
      .eq('user_id', aId).eq('id', photoId).select('id');
    assert(!prematureDelete.error && prematureDelete.data.length === 0,
      'Active metadata must not be removable');
    const foreignMark = await b.from('project_photos').update({ state: 'deleting' })
      .eq('id', photoId).select('id');
    assert(!foreignMark.error && foreignMark.data.length === 0,
      'B cannot mark A photos deleting');
    denied(await a.from('project_photos').update({ source: 'client_provided' })
      .eq('id', photoId).select('id'), 'Source must be immutable');
    const mark = allowed(await a.from('project_photos').update({ state: 'deleting' })
      .eq('id', photoId).eq('state', 'active').select('id,state').single(), 'Mark deleting');
    assert(mark.state === 'deleting', 'State did not change');
    allowed(await aBucket.remove([ownPath]), 'A removes marked object');
    cleanup.delete(ownPath);
    allowed(await a.from('project_photos').delete()
      .eq('id', photoId).eq('user_id', aId).eq('state', 'deleting').select('id').single(),
    'A finalizes deleted metadata');
    denied(await aBucket.download(ownPath), 'Deleted photo cannot be downloaded');
    // Task photos enforce the RESTRICT constraint: delete photo FIRST, then task.
    const taskBefore = await a.from('project_tasks').delete().eq('id', task.id).select('id');
    denied(taskBefore, 'Task with saved photos must be restricted');
    allowed(await a.from('project_photos').update({ state: 'deleting' })
      .eq('id', taskPhoto.id).select('id').single(), 'Mark task photo deleting');
    allowed(await aBucket.remove([taskPath]), 'Delete marked task image');
    cleanup.delete(taskPath);
    allowed(await a.from('project_photos').delete().eq('id', taskPhoto.id)
      .select('id').single(), 'Remove task photo metadata');
    allowed(await a.from('project_tasks').delete().eq('id', task.id)
      .select('id').single(), 'Remove task after all photo references');
    console.log('PASS: real owner upload/read/delete; cross-account, anonymous, malformed, oversize, MIME, sign, overwrite, move and copy tests.');
  } finally {
    // Only real authenticated Storage API calls; no direct storage.objects changes.
    // Cleanup is best effort: if an assertion failed, RESET/DELETE test project.
    if (cleanup.size) {
      const result = await aBucket.remove([...cleanup]);
      if (result.error) console.error('Cleanup incomplete: reset the disposable test project.');
    }
    console.log('Database photo/lead/project/task fixtures remain (some photos deliberately orphaned); reset the disposable database/project.');
  }
}

main().catch((e) => {
  console.error(e?.name === 'SiteQuoteStorageCheck' ? `NOT VERIFIED: ${e.message}` :
    'NOT VERIFIED: unexpected error; examine private provider logs.');
  process.exitCode = 1;
});
