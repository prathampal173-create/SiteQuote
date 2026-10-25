import { canMarkWon, formatDecisionHistory, permittedDecision } from '../projectDecisionModel';
import { filterProjects, quoteSentLeadIds, type Project } from '../projectModel';

const fixture: Project = { id: 'kitchen', user_id: 'a', lead_id: 'lead', title: 'Kitchen',
  site_address: null, notes: null, status: 'draft', accepted_quote_id: null, tax_bps: 0,
  created_at: '2026-10-22', updated_at: '2026-10-22' };

test('exact decision permissions; Mark Won requires Quote Sent and a Sent version', () => {
  expect(permittedDecision('draft')).toBe('mark_lost');
  expect(permittedDecision('quote_sent')).toBe('mark_lost');
  expect(permittedDecision('lost')).toBe('reopen');
  expect(permittedDecision('won')).toBe('reopen');
  for (const status of ['draft','quote_sent','won','lost'] as const) {
    expect(canMarkWon({ ...fixture, status })).toBe(false);
    expect(canMarkWon({ ...fixture, status }, 1)).toBe(status === 'quote_sent');
  }
});

test('independent siblings, exact-status filters and current Quote Sent filter', () => {
  const rows = [fixture, { ...fixture, id: 'bath', status: 'quote_sent' as const },
    { ...fixture, id: 'another', lead_id: 'other', status: 'lost' as const }];
  expect(filterProjects(rows.map((project) => ({ project, leadName: 'Owner' })), 'lost'))
    .toHaveLength(1);
  expect([...quoteSentLeadIds(rows)]).toEqual(['lead']);
  // Losing the one currently Quote Sent project removes only that lead from filter.
  expect([...quoteSentLeadIds(rows.map((project) => project.id === 'bath' ? { ...project, status: 'lost' as const } : project))])
    .toEqual([]);
  expect(rows[0]?.status).toBe('draft');
});

test('decision history renders prior accepted reference; manual history remains independent', () => {
  expect(formatDecisionHistory({ type: 'project_reopened', detail: {
    project_title: 'Kitchen', from_status: 'won', to_status: 'draft',
    previous_accepted_quote_id: 'older-sent-version-id'
  } })).toContain('older-sent-version-id');
  expect(formatDecisionHistory({ type: 'project_marked_lost', detail: {
    project_title: 'Kitchen', from_status: 'quote_sent', to_status: 'lost', previous_accepted_quote_id: null
  } })).toContain('Kitchen: quote sent → lost.');
  expect(formatDecisionHistory({ type: 'manual_note', detail: { note: 'Keep separate' } })).toBeNull();
});
