import { draftFromProject, EMPTY_PROJECT, filterProjects, PROJECT_FILTERS, PROJECT_LABELS,
  quoteSentLeadIds, validateProject, type Project, type ProjectWithLead } from '../projectModel';

const base: Project = { id: 'p1', lead_id: 'l1', user_id: 'a', title: 'Kitchen', notes: 'Internal',
  site_address: '101 Main', status: 'draft', tax_bps: 0, accepted_quote_id: null,
  created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z' };

test('requires a nonblank named project without inventing a status', () => {
  expect(validateProject(EMPTY_PROJECT)).toEqual({ ok: false, errors: { title: 'Project name is required.' } });
  expect(validateProject({ title: '\n  Kitchen Remodel  ', siteAddress: ' 45 High St ', notes: ' notes ' }))
    .toEqual({ ok: true, values: { title: 'Kitchen Remodel', site_address: '45 High St', notes: 'notes' } });
  expect(validateProject({ title: 'Bathroom', siteAddress: ' ', notes: ' ' }))
    .toEqual({ ok: true, values: { title: 'Bathroom', site_address: null, notes: null } });
});

test('editing loads separately persisted project fields, including nullable values', () => {
  expect(draftFromProject(base)).toEqual({ title: 'Kitchen', siteAddress: '101 Main', notes: 'Internal' });
  expect(draftFromProject({ ...base, notes: null, site_address: null }))
    .toEqual({ title: 'Kitchen', siteAddress: '', notes: '' });
});

test('each of five project list filters matches exact persisted status', () => {
  const rows: ProjectWithLead[] = PROJECT_FILTERS.slice(1).map((status, i) => ({
    project: { ...base, id: `p${i}`, status: status as Project['status'] }, leadName: `Customer ${i}`
  }));
  expect(PROJECT_FILTERS).toEqual(['all', 'draft', 'quote_sent', 'won', 'lost']);
  expect(filterProjects(rows, 'all')).toHaveLength(4);
  for (const status of PROJECT_FILTERS.slice(1)) {
    expect(filterProjects(rows, status).map(({ project }) => project.status)).toEqual([status]);
    expect(PROJECT_LABELS[status as Project['status']]).toBeTruthy();
  }
});

test('one lead with multiple projects: only current quote_sent children qualify, with no duplicates', () => {
  expect([...quoteSentLeadIds([
    { lead_id: 'l1', status: 'quote_sent' }, { lead_id: 'l1', status: 'draft' },
    { lead_id: 'l1', status: 'quote_sent' }, { lead_id: 'l2', status: 'won' },
    { lead_id: 'l3', status: 'lost' }
  ])]).toEqual(['l1']);
  expect(quoteSentLeadIds([{ lead_id: 'old', status: 'draft' }]).size).toBe(0);
  // A chronologically older project still in Quote Sent qualifies, even with a newer Draft sibling.
  expect(quoteSentLeadIds([{ lead_id: 'l4', status: 'quote_sent' },
    { lead_id: 'l4', status: 'draft' }]).has('l4')).toBe(true);
});
