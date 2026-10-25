import { listReminderHistory, setReminderStatus, ReminderFailure } from '../remindersApi';
import { reminderGroup, sortCompletionHistory, sortReminders, type Reminder, type ReminderCompletionEvent } from '../reminderModel';
import { projectRequest } from '../../projects/projectsApi';
jest.mock('../../projects/projectsApi', () => ({ projectRequest: jest.fn() }));
const account = 'owner-a', reminderId = 'r-1';
const current: Reminder = { id: reminderId, user_id: account, lead_id: 'lead-a', project_id: null,
  kind: 'follow_up', title: 'Call', note: null, due_at: '2099-01-04T00:00:00Z', status: 'open',
  completed_at: null, created_at: '2026-10-23T08:00:00Z', updated_at: 'v1' };
const event = (id: string, event_type: 'completed' | 'reopened', occurred_at: string): ReminderCompletionEvent => ({
  id, user_id: account, reminder_id: reminderId, lead_id: 'lead-a', project_id: null,
  event_type, occurred_at, reminder_title: 'Call', reminder_kind: 'follow_up', reminder_due_at: current.due_at
});
const events = [event('a', 'completed', '2026-10-23T10:00:00Z'),
  event('b', 'reopened', '2026-10-24T10:00:00Z'), event('c', 'completed', '2026-10-25T10:00:00Z')];
it('keeps every completion/reopen in chronological local-display order', () => {
  expect(sortCompletionHistory([events[2]!, events[0]!, events[1]!]).map((item) => item.event_type))
    .toEqual(['completed', 'reopened', 'completed']);
  expect(sortCompletionHistory([events[2]!, events[0]!, events[1]!]).map((item) => item.id))
    .toEqual(['a', 'b', 'c']);
});
it('grouping partitions local overdue/today/upcoming; completed sort newest first', () => {
  const now = new Date(2026, 9, 23, 15, 0);
  expect(reminderGroup(new Date(now.getTime() - 1).toISOString(), now)).toBe('Overdue');
  expect(reminderGroup(new Date(2026, 9, 23, 23, 30).toISOString(), now)).toBe('Today');
  expect(reminderGroup(new Date(2026, 9, 24, 0, 30).toISOString(), now)).toBe('Upcoming');
  const sorted = sortReminders([{...current, id:'a', status:'completed', completed_at:'2026-10-23T10:00:00Z'},
    {...current, id:'b', status:'completed', completed_at:'2026-10-25T10:00:00Z'}]);
  expect(sorted.map((item) => item.id)).toEqual(['b','a']);
  expect(sortReminders([{...current,id:'later',due_at:'2026-10-23T08:00:00Z'},
    {...current,id:'earlier',due_at:'2026-10-23T09:00:00+02:00'}]).map((row) => row.id))
    .toEqual(['earlier','later']);
});
it('history is paginated, owner/id scoped, read-only and preserves all entries', async () => {
  const all = Array.from({length: 201}, (_, i) => event(`id-${String(i).padStart(3, '0')}`,
    i % 2 ? 'reopened' : 'completed', '2026-10-23T10:00:00Z'));
  const calls: Array<{key:string;value:string}> = [];
  const ranges: Array<[number, number]> = [];
  const query: any = { select: jest.fn().mockReturnThis(),
    eq: jest.fn((key, value) => { calls.push({key,value}); return query; }),
    order: jest.fn().mockReturnThis(),
    range: jest.fn(async (from,to) => { ranges.push([from,to]); return {data:all.slice(from,to+1),error:null}; }) };
  const from = jest.fn(() => query);
  (projectRequest as jest.Mock).mockImplementation(async (_owner, work) => work({from}));
  expect((await listReminderHistory(account, reminderId)).length).toBe(201);
  expect(from).toHaveBeenCalledWith('reminder_completion_events');
  expect(calls).toContainEqual({key:'user_id',value:account});
  expect(calls).toContainEqual({key:'reminder_id',value:reminderId});
  expect(ranges).toEqual([[0,199],[200,399]]);
});
it('uncertain completion reply reconciles matching server status but rejects other changes', async () => {
  let row = {...current, status:'completed' as const};
  const query: any = { select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),
    update:jest.fn().mockReturnThis(),maybeSingle:jest.fn()
      .mockResolvedValueOnce({data:null,error:null})
      .mockImplementation(async()=>({data:row,error:null})) };
  (projectRequest as jest.Mock).mockImplementation(async (_, work) => work({from:()=>query}));
  expect((await setReminderStatus(account,current,'completed')).status).toBe('completed');
  query.maybeSingle.mockReset().mockResolvedValueOnce({data:null,error:null})
    .mockResolvedValueOnce({data:{...current,updated_at:'v2'},error:null});
  await expect(setReminderStatus(account,current,'completed')).rejects.toBeInstanceOf(ReminderFailure);
});

it('same-status request reads current server state instead of trusting a stale local copy', async () => {
  const query: any = { select: jest.fn().mockReturnThis(), eq:jest.fn().mockReturnThis(),
    maybeSingle:jest.fn().mockResolvedValue({ data: {...current,status:'completed'}, error:null }) };
  (projectRequest as jest.Mock).mockImplementation(async (_, work) => work({ from:()=>query }));
  await expect(setReminderStatus(account,current,'open')).rejects.toBeInstanceOf(ReminderFailure);
});
