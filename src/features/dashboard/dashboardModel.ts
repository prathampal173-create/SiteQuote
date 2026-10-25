import { reminderGroup } from '../reminders/reminderModel';
import type { ProjectFilter } from '../projects/projectModel';

/** Owner-scoped exact database counts; null means unavailable, never zero. */
export const DASHBOARD_METRICS = ['totalLeads', 'quoteSentProjects', 'wonProjects', 'overdueReminders'] as const;
export type DashboardMetric = typeof DASHBOARD_METRICS[number];
export type DashboardCounts = Record<DashboardMetric, number | null>;
export const EMPTY_COUNTS: DashboardCounts = {
  totalLeads: null, quoteSentProjects: null, wonProjects: null, overdueReminders: null
};

/** The Reminders list's predicate is authoritative: strictly earlier than now. */
export function isOverdueOpen(status: string, dueAt: string, now: Date): boolean {
  return status === 'open' && Number.isFinite(Date.parse(dueAt)) && reminderGroup(dueAt, now) === 'Overdue';
}

/** Only allow a status filter the existing Projects screen understands. */
export function dashboardProjectFilter(value: unknown): ProjectFilter | null {
  return value === 'quote_sent' || value === 'won' ? value : null;
}
export function isDashboardOverdue(value: unknown): boolean { return value === 'overdue'; }

export const METRIC_DETAILS: Record<DashboardMetric, { title: string; symbol: string; description: string }> = {
  totalLeads: { title: 'Total Leads', symbol: '👥', description: 'View all customers' },
  quoteSentProjects: { title: 'Quote Sent Projects', symbol: '📤', description: 'Current Quote Sent projects' },
  wonProjects: { title: 'Won Projects', symbol: '✓', description: 'Current Won projects' },
  overdueReminders: { title: 'Overdue Reminders', symbol: '◷', description: 'Open reminders past due' }
};

/** Route request IDs only reset visible filters; none represent authorization. */
export function dashboardDestination(key: DashboardMetric, request: string) {
  switch (key) {
    case 'totalLeads': return { pathname: '/(tabs)/leads', params: { dashboard: request } } as const;
    case 'quoteSentProjects': return { pathname: '/projects', params: { status: 'quote_sent', dashboard: request } } as const;
    case 'wonProjects': return { pathname: '/projects', params: { status: 'won', dashboard: request } } as const;
    case 'overdueReminders': return { pathname: '/(tabs)/reminders', params: { view: 'overdue', dashboard: request } } as const;
  }
}
