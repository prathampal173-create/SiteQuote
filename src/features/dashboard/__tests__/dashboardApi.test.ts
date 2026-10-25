import { loadDashboardCounts } from '../dashboardApi';
import { projectRequest } from '../../projects/projectsApi';

jest.mock('../../projects/projectsApi', () => ({
  projectRequest: jest.fn(async (_accountId: string, work: (client: unknown) => Promise<unknown>) => work(mockClient)),
  ProjectFailure: class ProjectFailure extends Error {}
}));
const owner = 'current-owner';
const requests: { table: string; filters: Record<string, unknown>; count: boolean; head: boolean }[] = [];
const results: Record<string, { count: number | null; error: Error | null }> = {
  leads: { count: 3, error: null }, projects_quote_sent: { count: 2, error: null },
  projects_won: { count: 2, error: null }, reminders: { count: 4, error: null }
};
const mockClient = {
  from(table: string) {
    const request = { table, filters: {} as Record<string, unknown>, count: false, head: false };
    requests.push(request);
    const query = {
      select(_columns: string, options: { count: string; head: boolean }) {
        request.count = options.count === 'exact'; request.head = options.head;
        return query;
      },
      eq(key: string, value: unknown) { request.filters[key] = value; return query; },
      lt(key: string, value: unknown) { request.filters[`lt:${key}`] = value; return query; },
      then(resolve: (value: unknown) => void) {
        resolve(results[table === 'projects' ? `projects_${request.filters.status}` : table]);
      }
    };
    return query;
  }
};

describe('Phase 5A exact owner-scoped counts', () => {
  beforeEach(() => {
    requests.length = 0;
    results.projects_won = { count: 2, error: null };
    results.leads = { count: 3, error: null };
  });
  it('uses four RLS-scoped exact count HEAD requests and current statuses', async () => {
    const now = new Date('2026-10-23T10:00:00Z');
    expect(await loadDashboardCounts(owner, now)).toEqual({ totalLeads: 3, quoteSentProjects: 2, wonProjects: 2, overdueReminders: 4 });
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.count && r.head && r.filters.user_id === owner)).toBe(true);
    expect(requests.find((r) => r.table === 'projects' && r.filters.status === 'quote_sent')).toBeDefined();
    expect(requests.find((r) => r.table === 'projects' && r.filters.status === 'won')).toBeDefined();
    expect(requests.find((r) => r.table === 'reminders')?.filters).toEqual({ user_id: owner, status: 'open', 'lt:due_at': now.toISOString() });
    expect(projectRequest).toHaveBeenCalledWith(owner, expect.any(Function));
  });
  it('returns correct zero and exact counts beyond pagination limits', async () => {
    results.leads = { count: 0, error: null };
    results.projects_won = { count: 1204, error: null };
    expect(await loadDashboardCounts(owner)).toMatchObject({ totalLeads: 0, wonProjects: 1204 });
  });
  it('keeps individual failures unavailable instead of showing a false zero', async () => {
    results.projects_won = { count: null, error: new Error('offline') };
    expect(await loadDashboardCounts(owner)).toMatchObject({ totalLeads: 3, wonProjects: null });
  });
  it('rejects an invalid clock or invalid authenticated request', async () => {
    await expect(loadDashboardCounts(owner, new Date(NaN))).rejects.toThrow();
    (projectRequest as jest.Mock).mockRejectedValueOnce(new Error('session'));
    await expect(loadDashboardCounts(owner)).rejects.toThrow();
  });
});
