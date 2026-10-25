import { NotificationLifecycle, type NativePending } from '../notificationLifecycle';
import { GENERIC_BODY, GENERIC_TITLE } from '../reminderNotificationModel';
import type { NotificationEntry, RegistryStore } from '../notificationRegistry';
import type { Reminder } from '../../reminders/reminderModel';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const R = '11111111-1111-4111-8111-111111111111';
const DUE = new Date(Date.now() + 86400000).toISOString();
const make = (ownerId = A, status: Reminder['status'] = 'open', due_at = DUE): Reminder => ({
  id: R, user_id: ownerId, lead_id: 'lead', project_id: null, title: 'PRIVATE', note: 'PRIVATE',
  kind: 'site_visit', due_at, status, completed_at: null, created_at: DUE, updated_at: DUE
});
function harness() {
  let rows: Reminder[] = [make()]; let entries: NotificationEntry[] = [];
  let pending: NativePending[] = [];
  let seq = 0; let state: 'granted' | 'denied' = 'granted';
  let failCancel = false; let failWrite = false;
  const store: RegistryStore = {
    read: async () => entries.slice(),
    write: async (next) => { if (failWrite) throw new Error('disk'); entries = next.slice(); }
  };
  const native = {
    list: async () => pending.slice(),
    cancel: async (id: string) => { if (failCancel) throw new Error('OS'); pending = pending.filter((r) => r.identifier !== id); },
    schedule: async (date: Date, payload: { type: 'reminder'; reminderId: string }) => {
      const id = `os-${++seq}`;
      pending.push({ identifier: id, content: { title: GENERIC_TITLE, body: GENERIC_BODY, data: payload },
        trigger: { type: 'date', timestamp: date.getTime() } });
      return id;
    }
  };
  const service = new NotificationLifecycle(store, native, async () => ({ state, canAskAgain: false }),
    async (owner) => rows.filter((r) => r.user_id === owner));
  return { service, native,
    restart: () => new NotificationLifecycle(store, native, async () => ({state,canAskAgain:false}),
      async (owner) => rows.filter((r) => r.user_id === owner)),
    get pending() { return pending; }, get entries() { return entries; },
    setRows: (next: Reminder[]) => { rows = next; }, setPermission: (next: typeof state) => { state = next; },
    setFailCancel: (next: boolean) => { failCancel = next; }, setFailWrite: (next: boolean) => { failWrite = next; },
    setPending: (next: NativePending[]) => { pending = next; }, setEntries: (next: NotificationEntry[]) => { entries = next; }
  };
}
const run = (h: ReturnType<typeof harness>, owner = A, current = () => true) =>
  h.service.reconcile(owner, current);

test('one-shot UTC alert, persisted registry, no private payload; repeat is idempotent', async () => {
  const h = harness(); expect((await run(h)).scheduled).toBe(1);
  expect(h.entries).toHaveLength(1); expect(h.entries[0]!.dueMs).toBe(Date.parse(DUE));
  expect(JSON.stringify(h.pending)).not.toContain('PRIVATE');
  expect((await run(h)).scheduled).toBe(0); expect(h.pending).toHaveLength(1);
});
test('reschedule cancels obsolete and installs only new date', async () => {
  const h = harness(); await run(h);
  const revised = new Date(Date.now() + 172800000).toISOString(); h.setRows([make(A, 'open', revised)]);
  expect((await run(h)).cancelled).toBe(1); expect(h.pending).toHaveLength(1);
  expect(h.entries[0]!.dueMs).toBe(Date.parse(revised));
});
test('completed and deleted remove native alert, reopened future restores, overdue does not', async () => {
  const h = harness(); await run(h); h.setRows([make(A, 'completed')]);
  expect((await run(h)).cancelled).toBe(1); expect(h.pending).toHaveLength(0);
  h.setRows([make(A)]); await run(h); expect(h.pending).toHaveLength(1);
  h.setRows([]); await run(h); expect(h.pending).toHaveLength(0);
  h.setRows([make(A, 'open', new Date(Date.now() - 86400000).toISOString())]);
  await run(h); expect(h.pending).toHaveLength(0);
});
test('permission denied removes existing, restore reinstates', async () => {
  const h = harness(); await run(h); h.setPermission('denied'); await run(h);
  expect(h.pending).toHaveLength(0); h.setPermission('granted'); await run(h); expect(h.pending).toHaveLength(1);
});
test('crash after OS schedule before registry commit adopts native date without a duplicate', async () => {
  const h = harness(); h.setFailWrite(true); expect((await run(h)).failed).toBeGreaterThan(0);
  expect(h.pending).toHaveLength(1); h.setFailWrite(false);
  expect((await run(h)).scheduled).toBe(0); expect(h.entries).toHaveLength(1);
});
test('OS missing but registry present restores alert and repairs ID', async () => {
  const h = harness(); await run(h); h.setPending([]);
  expect((await run(h)).scheduled).toBe(1); expect(h.entries).toHaveLength(1);
});
test('native orphan, duplicates and unrelated app schedules: only SiteQuote duplicates removed', async () => {
  const h = harness(); await run(h); const first = h.pending[0]!;
  h.setPending([first, { ...first, identifier: 'dup' }, {
    identifier: 'other-app', content: { title: 'Other application', body: 'Other', data: { type: 'reminder', reminderId: R } }
  }]);
  await run(h); expect(h.pending.filter((r) => r.identifier !== 'other-app')).toHaveLength(1);
  expect(h.pending.some((r) => r.identifier === 'other-app')).toBe(true);
});
test('failed cancellation blocks replacement until retry, preserves recovery state', async () => {
  const h = harness(); await run(h);
  h.setRows([make(A, 'open', new Date(Date.now() + 172800000).toISOString())]);
  h.setFailCancel(true); const failure = await run(h); expect(failure.failed).toBeGreaterThan(0);
  expect(h.pending).toHaveLength(1); h.setFailCancel(false); await run(h);
  expect(h.pending).toHaveLength(1);
});
test('owner change, signed-out cleanup, and no other account owner rows', async () => {
  const h = harness(); await run(h); await h.service.signOut(A);
  expect(h.pending).toHaveLength(0); h.setRows([make(B)]); h.service.activate(B); await run(h, B);
  expect(h.entries[0]!.ownerId).toBe(B); expect(h.pending).toHaveLength(1);
  expect((await run(h, A)).scheduled).toBe(0);
});
test('late native schedule after scope revocation is canceled', async () => {
  const h = harness(); let resolve!: () => void; let current = true;
  const originalSchedule = h.native.schedule; h.native.schedule = async (date, data) => {
    await new Promise<void>((done) => { resolve = done; }); return originalSchedule(date, data);
  };
  const pending = run(h, A, () => current);
  // Allows pending owner read, registry inspection and schedule to advance.
  for (let i = 0; i < 20 && !resolve; i++) await new Promise((done) => setTimeout(done, 0));
  expect(resolve).toBeDefined(); current = false; h.service.retire(A); resolve(); await pending;
  expect(h.pending).toHaveLength(0);
});
test('Supabase read failure never sweeps existing OS schedules', async () => {
  const h = harness(); await run(h);
  const service = new NotificationLifecycle({ read: async () => [], write: async () => {} }, h.native,
    async () => ({state:'granted', canAskAgain: false}), async () => { throw new Error('offline'); });
  expect((await service.reconcile(A, () => true)).failed).toBe(1); expect(h.pending).toHaveLength(1);
});
test('signed-out startup cleans only SiteQuote generic schedules', async () => {
  const h = harness(); await run(h);
  h.setPending([...h.pending, { identifier:'third-party', content: { title:'Other', body:'Ignore', data:{} } }]);
  await h.service.signedOutStartup(); expect(h.pending.map((r) => r.identifier)).toEqual(['third-party']);
});

test('new lifecycle engine after restart reuses registry and existing native request', async () => {
  const h = harness(); await run(h);
  const newEngine = h.restart(); expect((await newEngine.reconcile(A, () => true)).scheduled).toBe(0);
  expect(h.pending).toHaveLength(1);
});
test('overlapping reconciliations serialize and do not double schedule', async () => {
  const h = harness();
  const [a, b] = await Promise.all([run(h), run(h)]);
  expect(a.scheduled + b.scheduled).toBe(1); expect(h.pending).toHaveLength(1);
});
test('multiple rapid reschedules converge on last authoritative due instant', async () => {
  const h = harness(); await run(h);
  h.setRows([make(A,'open',new Date(Date.now()+172800000).toISOString())]);
  const first = run(h);
  h.setRows([make(A,'open',new Date(Date.now()+259200000).toISOString())]);
  const second = run(h); await Promise.all([first, second]);
  expect(h.pending).toHaveLength(1); expect(h.entries[0]!.dueMs).toBe((h.pending[0]!.trigger as {timestamp:number}).timestamp);
});
test('native cancel success without removal never creates competing replacement', async () => {
  const h = harness(); await run(h);
  h.setRows([make(A,'open',new Date(Date.now()+172800000).toISOString())]);
  h.native.cancel = async () => {}; // buggy OS adapter says success but leaves pending
  expect((await run(h)).failed).toBeGreaterThan(0);
  expect(h.pending).toHaveLength(1);
});

test('account switch while owner read is pending does not touch native state', async () => {
  const h = harness(); await run(h);
  let resolve!: (rows: Reminder[]) => void; let current = true;
  const service = new NotificationLifecycle({ read: async()=>h.entries, write:async()=>{} }, h.native,
    async () => ({state:'granted',canAskAgain:false}),
    async () => new Promise<Reminder[]>((done) => { resolve = done; }));
  const pending = service.reconcile(A, () => current);
  for (let i = 0; i < 20 && !resolve; i++) await new Promise((done) => setTimeout(done, 0));
  current = false; resolve([]); await pending;
  expect(h.pending).toHaveLength(1);
});
test('failed sign-out cancel is repairable on subsequent signed-out launch', async () => {
  const h = harness(); await run(h); h.setFailCancel(true);
  expect((await h.service.signOut(A)).failed).toBeGreaterThan(0);
  expect(h.pending).toHaveLength(1);
  h.setFailCancel(false); await h.restart().signedOutStartup();
  expect(h.pending).toHaveLength(0); expect(h.entries).toHaveLength(0);
});
