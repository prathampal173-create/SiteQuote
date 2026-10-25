import { createReminder, ReminderFailure } from '../remindersApi';
import { projectRequest } from '../../projects/projectsApi';
import type { ReminderDraft } from '../reminderModel';
jest.mock('../../projects/projectsApi', () => ({ projectRequest: jest.fn() }));
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lead='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project='cccccccc-cccc-4ccc-8ccc-cccccccccccc', key='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const draft: ReminderDraft = {leadId:lead,projectId:project,kind:'follow_up',title:'Follow up on sent quote',
  note:'',dueDate:new Date('2099-01-05T10:00:00Z')};
const saved = {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',user_id:owner,lead_id:lead,project_id:project,
  kind:'follow_up',title:draft.title,note:null,due_at:draft.dueDate.toISOString(),client_request_id:key};
function setup(insert: 'saved'|'uncertain'|'collision') {
  const calls: unknown[]=[];
  (projectRequest as jest.Mock).mockImplementation((_accountId, fn) => fn({from:(table:string)=>{
    const filters:Record<string,string>={};
    const q:any={
      select:jest.fn().mockReturnThis(),eq:jest.fn().mockImplementation((k,v)=>{filters[k]=v;return q;}),
      insert:jest.fn().mockImplementation((value)=>{calls.push(value);return q;}),
      maybeSingle:jest.fn().mockImplementation(async()=>({data:table==='leads'?{id:lead}:
        table==='projects'?{id:project}:
        insert==='uncertain'?saved:
        insert==='collision'?{...saved,title:'Other'}:null,error:null})),
      single:jest.fn().mockImplementation(async()=>insert==='saved'?{data:saved,error:null}:{data:null,error:new Error('timeout')})
    };return q;
  }}));
  return calls;
}
it('saves once with stable request ID and verified relationship',async()=>{
  const calls=setup('saved');
  expect((await createReminder(owner,draft,key)).id).toBe(saved.id);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual(expect.objectContaining({user_id:owner,client_request_id:key,kind:'follow_up'}));
});
it('reconciles an ambiguous insert without inserting a second time',async()=>{
  const calls=setup('uncertain');
  expect((await createReminder(owner,draft,key)).id).toBe(saved.id);
  expect(calls).toHaveLength(1);
});
it('rejects a reused request ID with conflicting saved details',async()=>{
  setup('collision');
  await expect(createReminder(owner,draft,key)).rejects.toBeInstanceOf(ReminderFailure);
});
