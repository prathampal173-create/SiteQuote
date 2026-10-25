import { createReminder, deleteReminder, listReminders, loadReminder,
  setReminderStatus, updateReminder, ReminderFailure } from '../remindersApi';
import { projectRequest } from '../../projects/projectsApi';
import type { ReminderDraft, Reminder } from '../reminderModel';
jest.mock('../../projects/projectsApi', () => ({ projectRequest: jest.fn() }));
const account = 'owner-a';
const draft: ReminderDraft = { leadId: 'lead-a', projectId: 'project-a', kind: 'other', title: 'Follow up',
  note: '', dueDate: new Date('2099-01-02T10:00:00Z') };
const row: Reminder = { id:'rem-1', user_id:account, lead_id:'lead-a',project_id:'project-a',kind:'other',
  title:'Follow up',note:null,due_at:'2099-01-02T10:00:00Z',status:'open',completed_at:null,
  created_at:'2026-10-23T10:00:00Z',updated_at:'2026-10-23T10:00:00Z' };
const mocks = { leads: [{id: 'lead-a', user_id: account}], projects: [{id:'project-a',lead_id:'lead-a', user_id: account}], reminders: [row] };
function selectQuery(table: 'leads'|'projects'|'reminders') {
  const filters: Record<string,unknown> = {};
  const query: any = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockImplementation((key,value) => { filters[key]=value;return query; }),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockImplementation(async (from,to) => ({data:mocks[table].filter((item:any) =>
      Object.entries(filters).every(([key,value]) => item[key]===value)).slice(from,to+1),error:null})),
    maybeSingle: jest.fn().mockImplementation(async () => ({data:mocks[table].find((item:any) =>
      Object.entries(filters).every(([key,value]) => item[key]===value)) ?? null,error:null})),
    single: jest.fn().mockResolvedValue({data:row,error:null}),
    insert: jest.fn().mockReturnThis(),update: jest.fn().mockReturnThis(),delete:jest.fn().mockReturnThis()
  };
  return query;
}
let queries: ReturnType<typeof selectQuery>[];
beforeEach(() => {
  queries = [];
  (projectRequest as jest.Mock).mockImplementation(async (_accountId, fn) => fn({from: (table:any) => {
    const query = selectQuery(table);queries.push(query);return query;
  }}));
});
it('creates reminder through validated owner scope and correct association', async () => {
  const result = await createReminder(account,draft);
  expect(result.id).toBe(row.id);
  expect(projectRequest).toHaveBeenCalledWith(account,expect.any(Function));
  expect(queries[0].eq).toHaveBeenCalledWith('user_id',account);
  expect(queries[1].eq).toHaveBeenCalledWith('lead_id',draft.leadId);
  expect(queries[2].insert).toHaveBeenCalledWith(expect.objectContaining({
    user_id:account,lead_id:draft.leadId,project_id:draft.projectId,due_at:draft.dueDate.toISOString()
  }));
});
it('prevents mismatched lead and project before inserting',async()=>{
  await expect(createReminder(account,{...draft,leadId:'lead-b'})).rejects.toBeInstanceOf(ReminderFailure);
  expect(queries.find((q)=>q.insert.mock.calls.length)).toBeUndefined();
});
it('paginates owner scoped reminder listing with optional lead filter',async()=>{
  const results = await listReminders(account,{leadId:'lead-a'});
  expect(results).toEqual([row]);
  expect(queries[0].eq).toHaveBeenCalledWith('user_id',account);
  expect(queries[0].eq).toHaveBeenCalledWith('lead_id','lead-a');
});
it('reads specific owner record and rejects missing',async()=>{
  expect(await loadReminder(account,'rem-1')).toEqual(row);
  await expect(loadReminder(account,'missing')).rejects.toBeInstanceOf(ReminderFailure);
});
it('rejects modifications to foreign rows synchronously',()=>{
  const foreign={...row,user_id:'another'};
  expect(()=>updateReminder(account,foreign,draft)).toThrow(ReminderFailure);
  expect(()=>deleteReminder(account,foreign)).toThrow(ReminderFailure);
  expect(()=>setReminderStatus(account,foreign,'completed')).toThrow(ReminderFailure);
});
it('optimistically scopes status and deletion writes to owner/id/version',async()=>{
  expect(await setReminderStatus(account,row,'completed')).toEqual(row);
  const statusQuery=queries[0];expect(statusQuery.eq).toHaveBeenCalledWith('updated_at',row.updated_at);
  expect(statusQuery.update).toHaveBeenCalledWith({status:'completed'});
  await deleteReminder(account,row);
  expect(queries[1].delete).toHaveBeenCalled();
  expect(queries[1].eq).toHaveBeenCalledWith('user_id',account);
  expect(queries[1].eq).toHaveBeenCalledWith('updated_at',row.updated_at);
});
