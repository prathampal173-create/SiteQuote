/**
 * Phase 0B3 REAL authenticated Data API test. Dedicated disposable Supabase
 * TEST project only: creates records and cannot delete them (by design).
 * Two pre-existing, distinct, email-verified Auth accounts are required.
 * No service key, passwords, tokens, or customer details are printed.
 * Run: node --env-file=.env scripts/check-rls-two-accounts.mjs
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const error = (message) => Object.assign(new Error(message), { name: 'IsolationCheckError' });
function hiddenInput(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw error('Use a local interactive terminal.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(`${prompt} (hidden): `);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') {
          finish(); reject(error('Cancelled.')); return;
        }
        if (char === '\r' || char === '\n') {
          finish(); resolve(value); return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

function assert(condition, stage) {
  if (!condition) throw error(`${stage}: failed. Inspect your private Supabase logs.`);
}
function allowed({ data, error: apiError }, stage, predicate = (value) => value !== null) {
  assert(!apiError && predicate(data), stage);
  return data;
}
function denied({ error: apiError }, stage, code = '42501') {
  assert(apiError?.code === code, `${stage} (expected PostgreSQL ${code})`);
}
function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw error('Development test only.');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  let origin;
  try { origin = new URL(url); } catch { throw error('Invalid public Supabase URL.'); }
  assert(origin.protocol === 'https:' && origin.pathname === '/' && !origin.search && !origin.hash &&
    !origin.username && !origin.password, 'Public HTTPS URL validation');
  assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key), 'Public publishable key required');

  console.log('Dedicated disposable TEST project only. This creates persistent test records.');
  const aEmail = (await hiddenInput('Verified account A email')).trim();
  const aPassword = await hiddenInput('Account A password');
  const bEmail = (await hiddenInput('Verified account B email')).trim();
  const bPassword = await hiddenInput('Account B password');
  assert(aEmail && bEmail && aEmail.toLowerCase() !== bEmail.toLowerCase(), 'Distinct accounts');

  const a = client(url, key);
  const b = client(url, key);
  const unsigned = client(url, key);
  const aLogin = await a.auth.signInWithPassword({ email: aEmail, password: aPassword });
  const bLogin = await b.auth.signInWithPassword({ email: bEmail, password: bPassword });
  assert(!aLogin.error && !!aLogin.data.user?.email_confirmed_at && !!aLogin.data.session,
    'Account A must be verified and signed in');
  assert(!bLogin.error && !!bLogin.data.user?.email_confirmed_at && !!bLogin.data.session,
    'Account B must be verified and signed in');
  const aId = aLogin.data.user.id;
  const bId = bLogin.data.user.id;
  assert(aId !== bId, 'Two distinct user IDs');
  const label = randomUUID().slice(0, 8);

  // Create real records via the same publishable-key API available to the app.
  allowed(await a.from('business_profiles').insert({ user_id: aId, business_name: `Test A ${label}` })
    .select('user_id').single(), 'A creates own business profile', (v) => v?.user_id === aId);
  const aLead = allowed(await a.from('leads').insert({ user_id: aId,
    customer_name: `Test lead A ${label}`, phone: '555-0100', source: 'Referral' })
    .select('id,contact_stage').single(), 'A creates own lead',
    (v) => !!v?.id && v.contact_stage === 'new');
  const aProject = allowed(await a.from('projects').insert({ user_id: aId,
    lead_id: aLead.id, title: `Test project A ${label}` })
    .select('id,status,tax_bps').single(), 'A creates own project',
    (v) => !!v?.id && v.status === 'draft' && v.tax_bps === 0);
  allowed(await b.from('business_profiles').insert({ user_id: bId, business_name: `Test B ${label}` })
    .select('user_id').single(), 'B creates own profile', (v) => v?.user_id === bId);
  const bLead = allowed(await b.from('leads').insert({ user_id: bId,
    customer_name: `Test lead B ${label}`, email: 'test@example.test', source: 'Email' })
    .select('id').single(), 'B creates own lead', (v) => !!v?.id);
  allowed(await b.from('projects').insert({ user_id: bId, lead_id: bLead.id,
    title: `Test project B ${label}` }).select('id').single(), 'B creates own project');

  // B cannot observe or update A's records, even with known identifiers.
  for (const [table, column, id] of [
    ['business_profiles', 'user_id', aId], ['leads', 'id', aLead.id], ['projects', 'id', aProject.id]
  ]) {
    const rows = allowed(await b.from(table).select(column).eq(column, id),
      `B queries A ${table}`, Array.isArray);
    assert(rows.length === 0, `B cannot read A ${table}`);
  }
  for (const [table, column, id, changes] of [
    ['business_profiles', 'user_id', aId, { business_name: 'Hijacked' }],
    ['leads', 'id', aLead.id, { customer_name: 'Hijacked' }],
    ['projects', 'id', aProject.id, { title: 'Hijacked' }]
  ]) {
    const rows = allowed(await b.from(table).update(changes).eq(column, id).select(column),
      `B attempts to update A ${table}`, Array.isArray);
    assert(rows.length === 0, `B cannot update A ${table}`);
  }

  // Own writes work; cross-owner identity, relationship and protected changes fail.
  allowed(await a.from('leads').update({ notes: 'Owner edit' }).eq('id', aLead.id)
    .select('id').single(), 'A edits own lead', (v) => v?.id === aLead.id);
  allowed(await a.from('projects').update({ tax_bps: 800 }).eq('id', aProject.id)
    .select('tax_bps').single(), 'A edits own project', (v) => v?.tax_bps === 800);
  denied(await b.from('leads').insert({ user_id: aId, customer_name: 'Wrong owner',
    phone: '555', source: 'Other' }), 'B foreign-owner lead insert');
  denied(await b.from('projects').insert({ user_id: bId, lead_id: aLead.id,
    title: 'Wrong owner link' }), 'B cross-owner composite FK', '23503');
  denied(await a.from('projects').update({ status: 'won' }).eq('id', aProject.id),
    'Protected status UPDATE');
  denied(await a.from('projects').update({ accepted_quote_id: randomUUID() })
    .eq('id', aProject.id), 'Protected accepted quote UPDATE');
  denied(await a.from('leads').update({ user_id: bId }).eq('id', aLead.id),
    'Owner reassignment');
  denied(await a.from('projects').delete().eq('id', aProject.id), 'Project DELETE');
  denied(await a.from('leads').delete().eq('id', aLead.id), 'Lead DELETE');
  denied(await unsigned.from('leads').select('id'), 'Signed-out anon SELECT');

  console.log('PASS: two real verified accounts, cross-account isolation, protected columns and anon denied.');
  console.log('Test records remain in the disposable project; no DELETE privilege was granted.');
}

main().catch((failure) => {
  // No SDK error responses, passwords or tokens are printed.
  console.error(failure?.name === 'IsolationCheckError' ? `NOT VERIFIED: ${failure.message}`
    : 'NOT VERIFIED: Unexpected API failure. Inspect provider logs privately.');
  process.exitCode = 1;
});
