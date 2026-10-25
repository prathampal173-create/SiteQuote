import { formatSiteVisitStageActivity } from '../siteVisitStageActivity';
import { filterLeads, type Activity, type Lead } from '../leadModel';

const activity = (type: string, detail: Record<string, unknown>): Pick<Activity, 'type' | 'detail'> =>
  ({ type, detail: detail as Activity['detail'] });

test('renders only committed automatic contact-stage activity with actual old/new stage', () => {
  expect(formatSiteVisitStageActivity(activity('site_visit_stage_advanced', {
    from_stage: 'new', to_stage: 'site_visit_completed', reminder_id: 'r1'
  }))).toContain('New → Site Visit Completed');
  expect(formatSiteVisitStageActivity(activity('site_visit_stage_advanced', {
    from_stage: 'contacted', to_stage: 'site_visit_completed'
  }))).toContain('Contacted → Site Visit Completed');
});

test('manual notes, quote changes, and invalid activity data never invent a stage transition', () => {
  expect(formatSiteVisitStageActivity(activity('manual_note', { note: 'site visit' }))).toBeNull();
  expect(formatSiteVisitStageActivity(activity('quote_marked_sent', {}))).toBeNull();
  expect(formatSiteVisitStageActivity(activity('site_visit_stage_advanced', {
    from_stage: 'invalid', to_stage: 'site_visit_completed'
  }))).not.toContain('New →');
});

test('existing contact-stage filters use fresh database stage values without project status mutation', () => {
  const lead = {id:'l1', user_id:'a', customer_name:'Taylor', contact_stage:'new'} as Lead;
  const refreshed = { ...lead, contact_stage:'site_visit_completed' as const };
  expect(filterLeads([lead], '', 'new')).toHaveLength(1);
  expect(filterLeads([refreshed], '', 'new')).toHaveLength(0);
  expect(filterLeads([refreshed], '', 'site_visit_completed')).toHaveLength(1);
});
