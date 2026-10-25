import { dashboardDestination, dashboardProjectFilter, isDashboardOverdue, isOverdueOpen, DASHBOARD_METRICS } from '../dashboardModel';
import { filterProjects } from '../../projects/projectModel';

describe('Phase 5A dashboard counts and filter semantics', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  it('uses the identical open/elapsed-instant overdue rule as Reminders', () => {
    expect(isOverdueOpen('open', '2026-10-23T09:59:59Z', now)).toBe(true);
    expect(isOverdueOpen('completed', '2026-10-22T04:00:00Z', now)).toBe(false);
    expect(isOverdueOpen('open', '2026-10-23T10:00:00Z', now)).toBe(false);
    expect(isOverdueOpen('open', '2026-10-23T12:00:00+02:00', now)).toBe(false);
    expect(isOverdueOpen('open', 'invalid', now)).toBe(false);
  });
  it('filters independently owned projects by their CURRENT status, not quote versions or customer', () => {
    const statuses = ['quote_sent','quote_sent','won','won','draft','lost'] as const;
    const rows = statuses.map((status, index) => ({ project: { id: String(index), status, lead_id: String(Math.floor(index/3)) }, leadName: 'Test' }));
    expect(filterProjects(rows as never, 'quote_sent')).toHaveLength(2);
    expect(filterProjects(rows as never, 'won')).toHaveLength(2);
    expect(filterProjects(rows as never, 'all')).toHaveLength(6);
  });
  it('routes every card to its existing, correctly filtered destination', () => {
    expect(dashboardDestination('totalLeads', '1')).toEqual({ pathname: '/(tabs)/leads', params: { dashboard: '1' } });
    expect(dashboardDestination('quoteSentProjects', '2')).toEqual({ pathname: '/projects', params: { status: 'quote_sent', dashboard: '2' } });
    expect(dashboardDestination('wonProjects', '3')).toEqual({ pathname: '/projects', params: { status: 'won', dashboard: '3' } });
    expect(dashboardDestination('overdueReminders', '4')).toEqual({ pathname: '/(tabs)/reminders', params: { view: 'overdue', dashboard: '4' } });
  });
  it('accepts only supported status and overdue navigation values' , () => {
    expect(dashboardProjectFilter('quote_sent')).toBe('quote_sent');
    expect(dashboardProjectFilter('won')).toBe('won');
    expect(dashboardProjectFilter('draft')).toBeNull();
    expect(dashboardProjectFilter('lost')).toBeNull();
    expect(isDashboardOverdue('overdue')).toBe(true);
    expect(isDashboardOverdue('completed')).toBe(false);
    expect(DASHBOARD_METRICS).toHaveLength(4);
  });
});
