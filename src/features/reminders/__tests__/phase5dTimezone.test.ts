import { suggestFollowup } from '../sentQuoteFollowup';
import { reminderGroup, validateReminder } from '../reminderModel';
import { eligibleDueAt, authorizeReminderTap } from '../../notifications/reminderNotificationModel';
import type { Reminder } from '../reminderModel';

const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const reminder: Reminder={id:'33333333-3333-4333-8333-333333333333',user_id:owner,lead_id:owner,project_id:null,
 kind:'follow_up',title:'Follow-up',note:null,due_at:'2026-11-05T15:00:00.000Z',status:'open',
 completed_at:null,created_at:'2026-10-23T00:00:00Z',updated_at:'2026-10-23T00:00:00Z'};

test('native scheduling uses the saved UTC instant, irrespective of display timezone',()=>{
 const native=eligibleDueAt(reminder,owner,Date.parse('2026-11-01T00:00:00Z'));
 expect(native?.toISOString()).toBe(reminder.due_at);
 expect(eligibleDueAt({...reminder,status:'completed'},owner,0)).toBeNull();
});
test('a foreign-account notification tap is not authorization',async()=>{
 const load=jest.fn().mockResolvedValue(reminder);
 expect(await authorizeReminderTap(other,reminder.id,load,()=>true)).toBeNull();
 expect(await authorizeReminderTap(owner,reminder.id,load,()=>true)).toEqual(reminder);
});
test('a tap that returns after sign-out is discarded',async()=>{
 let resolve: ((value: Reminder)=>void)|undefined;
 let active=true;
 const request=authorizeReminderTap(owner,reminder.id,()=>new Promise<Reminder>((r)=>{resolve=r;}),()=>active);
 active=false;resolve?.(reminder);
 expect(await request).toBeNull();
});
test('UTC reminder grouping is instant-based for Overdue, local-calendar for Today',()=>{
 expect(reminderGroup('2026-11-05T15:00:00Z',new Date('2026-11-05T15:00:01Z'))).toBe('Overdue');
});
test('valid due time serializes into UTC without a second timezone conversion',()=>{
 const due=new Date('2026-11-05T15:00:00.000Z');
 const result=validateReminder({leadId:owner,projectId:null,kind:'follow_up',title:'Call',note:'',dueDate:due},new Date('2026-11-01T00:00:00Z'));
 expect(result.ok).toBe(true);
 if(result.ok) expect(result.values.due_at).toBe('2026-11-05T15:00:00.000Z');
});
// Cross-zone spring/fall local-calendar tests also run in the executable
// scripts/verify-phase5d-isolated.cjs with explicit process.env.TZ settings.
