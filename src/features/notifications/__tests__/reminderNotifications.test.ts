import { authorizeReminderTap, eligibleDueAt, GENERIC_BODY, GENERIC_TITLE, interpretPermission,
  maySchedule, parseReminderTap, SessionNotificationScheduler } from '../reminderNotificationModel';
import type { Reminder } from '../../reminders/reminderModel';
const owner = 'account-one';
const ID = '11111111-1111-4111-8111-111111111111';
const row: Reminder = { id: ID, user_id: owner, lead_id: 'owned-lead', project_id: null,
  kind: 'follow_up', title: 'PRIVATE CUSTOMER TITLE', note: 'PRIVATE NOTE',
  due_at: '2035-04-01T15:30:00.000Z', status: 'open', completed_at: null,
  created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z' };
const now = Date.parse('2035-01-01T00:00:00Z');

describe('Phase 4C permission decisions', () => {
  it('accepts granted and iOS provisional/ephemeral', () => {
    expect(maySchedule(interpretPermission({ status: 'granted', granted: true }).state)).toBe(true);
    expect(interpretPermission({ status: 'denied', ios: { status: 3 } }, true).state).toBe('provisional');
    expect(interpretPermission({ status: 'denied', ios: { status: 4 } }, true).state).toBe('granted');
  });
  it('does not request again when denied or restricted and cannot ask', () => {
    expect(interpretPermission({ status: 'denied', canAskAgain: false }).canAskAgain).toBe(false);
    expect(interpretPermission({ status: 'denied', ios: { status: 99 } }, true).state).toBe('restricted');
  });
  it('handles undetermined and absent permission without granting access', () => {
    expect(interpretPermission({ status: 'undetermined' }).state).toBe('prompt');
    expect(interpretPermission(null).state).toBe('unavailable');
  });
});

describe('Phase 4C local schedule', () => {
  it('uses the exact absolute UTC instant and rejects overdue/completed/foreign/malformed', () => {
    expect(eligibleDueAt(row, owner, now)?.getTime()).toBe(Date.parse(row.due_at));
    expect(eligibleDueAt(row, owner, Date.parse(row.due_at))).toBeNull();
    expect(eligibleDueAt({ ...row, status: 'completed' }, owner, now)).toBeNull();
    expect(eligibleDueAt(row, 'different-account', now)).toBeNull();
    expect(eligibleDueAt({ ...row, due_at: '2035-04-01T15:30:00' }, owner, now)).toBeNull();
    expect(eligibleDueAt({ ...row, due_at: 'invalid' }, owner, now)).toBeNull();
  });
  it('protects generic text from customer/project/title/note leakage', () => {
    expect(`${GENERIC_TITLE} ${GENERIC_BODY}`).not.toContain(row.title);
    expect(`${GENERIC_TITLE} ${GENERIC_BODY}`).not.toContain(row.note);
  });
  it('deduplicates per session and owner without a server scheduling flag', async () => {
    const scheduler = new SessionNotificationScheduler(); const native = jest.fn(async () => 'native-id');
    const adapter = { schedule: native };
    expect(await scheduler.schedule('scope-a', owner, [row, row], adapter, now)).toEqual({ scheduled: 1, failed: 0 });
    expect(await scheduler.schedule('scope-a', owner, [row], adapter, now)).toEqual({ scheduled: 0, failed: 0 });
    expect(await scheduler.schedule('scope-b', owner, [row], adapter, now)).toEqual({ scheduled: 1, failed: 0 });
    expect(native).toHaveBeenCalledWith(new Date(row.due_at), { type: 'reminder', reminderId: ID });
  });
  it('does not cache failures and allows retry without changing the saved row', async () => {
    const scheduler = new SessionNotificationScheduler(); let fail = true;
    const adapter = { schedule: async () => { if (fail) throw new Error('OS denied'); return 'native'; } };
    const original = JSON.stringify(row);
    expect((await scheduler.schedule('a', owner, [row], adapter, now)).failed).toBe(1);
    fail = false;
    expect((await scheduler.schedule('a', owner, [row], adapter, now)).scheduled).toBe(1);
    expect(JSON.stringify(row)).toBe(original);
  });
  it('guards simultaneous duplicate schedule requests', async () => {
    const scheduler = new SessionNotificationScheduler(); let resolve!: (id: string) => void;
    const adapter = { schedule: () => new Promise<string>((done) => { resolve = done; }) };
    const first = scheduler.schedule('a', owner, [row], adapter, now);
    const second = scheduler.schedule('a', owner, [row], adapter, now);
    expect(await second).toEqual({ scheduled: 0, failed: 0 });
    resolve('os-1'); expect(await first).toEqual({ scheduled: 1, failed: 0 });
  });
});

describe('Phase 4C authenticated tap', () => {
  it('rejects malformed payloads and ignores private user data', () => {
    expect(parseReminderTap({ type: 'reminder', reminderId: ID })).toBe(ID);
    expect(parseReminderTap({ type: 'reminder', reminderId: 'invalid' })).toBeNull();
    expect(parseReminderTap({ type: 'other', reminderId: ID })).toBeNull();
    expect(parseReminderTap(null)).toBeNull();
  });
  it('accepts only a fresh owned Supabase lookup and permits completed reminders', async () => {
    const read = jest.fn(async () => ({ ...row, status: 'completed' }));
    expect(await authorizeReminderTap(owner, ID, read, () => true)).toHaveProperty('status', 'completed');
    expect(read).toHaveBeenCalledWith(owner, ID);
  });
  it('rejects a foreign-owned lookup or account switch while resolving', async () => {
    expect(await authorizeReminderTap(owner, ID, async () => ({ ...row, user_id: 'account-two' }), () => true)).toBeNull();
    let current = true;
    const read = async () => { current = false; return row; };
    expect(await authorizeReminderTap(owner, ID, read, () => current)).toBeNull();
  });
  it('blocks malformed and signed-out identifiers before any backend access', async () => {
    const read = jest.fn(async () => row);
    expect(await authorizeReminderTap('', ID, read, () => true)).toBeNull();
    expect(await authorizeReminderTap(owner, 'invalid', read, () => true)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it('fails closed on deleted/expired-session/network lookup errors', async () => {
    await expect(authorizeReminderTap(owner, ID, async () => { throw new Error('401'); }, () => true))
      .rejects.toThrow('401');
  });
});
