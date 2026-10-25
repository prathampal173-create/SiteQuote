import { FOLLOWUP_TITLE, suggestFollowup, validPrefill } from '../sentQuoteFollowup';
import { validateReminder, changeLocalDatePart } from '../reminderModel';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lead = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const quote = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const prefill = { sourceOwnerId: owner, sourceQuoteId: quote, leadId: lead, projectId: project, sentAt: '2026-10-23T14:00:00Z' };
it('preselects exactly the owner-scoped identifiers and default Follow-up title', () => {
  expect(FOLLOWUP_TITLE).toBe('Follow up on sent quote');
  expect(validPrefill(prefill, owner)).toBe(true);
  expect(validPrefill(prefill, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBe(false);
  expect(validPrefill({ ...prefill, projectId: 'not-uuid' }, owner)).toBe(false);
});
it('preserves absolute UTC output after an editable local suggestion', () => {
  const { due } = suggestFollowup(prefill.sentAt, new Date('2026-10-23T14:00:00Z'));
  expect(due.getTime()).toBeGreaterThan(new Date('2026-10-23T14:00:00Z').getTime());
  const draft = { leadId: lead, projectId: project, kind: 'follow_up' as const,
    title: FOLLOWUP_TITLE, note: '', dueDate: due };
  const validated = validateReminder(draft, new Date('2026-10-23T14:00:00Z'));
  expect(validated.ok).toBe(true);
  if (validated.ok) expect(validated.values.due_at).toBe(due.toISOString());
  const changed = changeLocalDatePart(due, new Date(due.getTime() + 60_000), 'time');
  expect(changed.getTime()).not.toBe(due.getTime());
});
it('rejects missing/expired Sent instants, never silently uses a past default', () => {
  expect(() => suggestFollowup('bad', new Date())).toThrow();
  expect(() => suggestFollowup('2020-01-01T00:00:00Z', new Date('2026-10-23T00:00:00Z'))).toThrow();
});
