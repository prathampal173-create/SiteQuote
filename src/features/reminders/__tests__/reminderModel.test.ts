import { changeLocalDatePart, defaultDueDate, formattedLocalDate, localTimezone, reminderGroup,
  sortReminders, validateReminder, type Reminder, type ReminderDraft } from '../reminderModel';
const NOW = new Date('2026-10-23T09:00:00.000Z');
const valid: ReminderDraft = { leadId: 'lead-a', projectId: null, kind: 'site_visit',
  title: 'Site walkthrough', note: '', dueDate: new Date('2026-10-24T09:00:00.000Z') };
const row = (id: string, status: 'open' | 'completed', due_at: string, completed_at: string | null = null) =>
  ({ ...valid, id, user_id: 'owner-a', lead_id: valid.leadId, project_id: null,
    kind: valid.kind, title: valid.title, note: null, due_at, status, completed_at,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString() } as Reminder);
describe('Phase 4A validation', () => {
  it('stores exact UTC instant, trims and accepts nullable project', () => {
    expect(validateReminder({ ...valid, title: '  Hello  ' }, NOW)).toEqual({ ok: true, values: {
      lead_id: 'lead-a', project_id: null, kind: 'site_visit', title: 'Hello', note: null,
      due_at: '2026-10-24T09:00:00.000Z'
    } });
  });
  it('rejects missing lead, title, kind, overlong note and invalid past date', () => {
    expect(validateReminder({ ...valid, leadId: '' }, NOW).ok).toBe(false);
    expect(validateReminder({ ...valid, title: '  ' }, NOW).ok).toBe(false);
    expect(validateReminder({ ...valid, kind: 'bad' as never }, NOW).ok).toBe(false);
    expect(validateReminder({ ...valid, note: 'x'.repeat(5001) }, NOW).ok).toBe(false);
    expect(validateReminder({ ...valid, dueDate: new Date(NaN) }, NOW).ok).toBe(false);
    expect(validateReminder({ ...valid, dueDate: NOW }, NOW).ok).toBe(false);
  });
  it('allows unchanged overdue due time but not backdated rescheduling', () => {
    const old = new Date('2026-10-22T09:00:00Z');
    expect(validateReminder({ ...valid, dueDate: old }, NOW, old.toISOString()).ok).toBe(true);
    expect(validateReminder({ ...valid, dueDate: old }, NOW).ok).toBe(false);
  });
  it('round-trips local date/time via native picker pieces', () => {
    const base = new Date(2026, 5, 7, 16, 15);
    const selection = new Date(2026, 6, 8, 9, 45);
    const changedDate = changeLocalDatePart(base, selection, 'date');
    expect([changedDate.getFullYear(), changedDate.getMonth(), changedDate.getDate(), changedDate.getHours(), changedDate.getMinutes()])
      .toEqual([2026, 6, 8, 16, 15]);
    const changedTime = changeLocalDatePart(base, selection, 'time');
    expect([changedTime.getDate(), changedTime.getHours(), changedTime.getMinutes()]).toEqual([7, 9, 45]);
    expect(new Date(changedTime.toISOString()).getTime()).toBe(changedTime.getTime());
    expect(Number.isNaN(changeLocalDatePart(base, new Date(NaN), 'date').getTime())).toBe(true);
    expect(defaultDueDate(NOW).getTime()).toBeGreaterThan(NOW.getTime());
    expect(formattedLocalDate(changedDate)).not.toEqual('Invalid date');
    expect(localTimezone()).toBeTruthy();
  });
  it('partitions open reminders once by device-local calendar and sorts completed newest first', () => {
    const today = new Date(2026, 9, 23, 10, 30);
    const yesterday = new Date(today.getTime() - 1000);
    const todayLater = new Date(2026, 9, 23, 23, 30);
    const tomorrow = new Date(2026, 9, 24, 1, 30);
    expect(reminderGroup(yesterday.toISOString(), today)).toBe('Overdue');
    expect(reminderGroup(todayLater.toISOString(), today)).toBe('Today');
    expect(reminderGroup(tomorrow.toISOString(), today)).toBe('Upcoming');
    const rows = sortReminders([row('a', 'completed', '2026-10-24T00:00:00Z', '2026-10-24T01:00:00Z'),
      row('b', 'completed', '2026-10-24T00:00:00Z', '2026-10-25T01:00:00Z')]);
    expect(rows.map((item) => item.id)).toEqual(['b', 'a']);
  });
});
