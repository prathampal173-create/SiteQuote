import { projectRequest, ProjectFailure } from '../projects/projectsApi';
import { DASHBOARD_METRICS, EMPTY_COUNTS, type DashboardCounts, type DashboardMetric } from './dashboardModel';

/** Counts are exact HEAD queries; never download potentially capped result pages. */
async function exactCount(request: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await request;
  if (error || count === null || !Number.isSafeInteger(count) || count < 0) throw new Error('Count unavailable');
  return count;
}

/** An individual failure is not a real zero; unaffected metric cards stay usable.
 * projectRequest validates the server session before AND after all four reads. */
export function loadDashboardCounts(accountId: string, now: Date = new Date()): Promise<DashboardCounts> {
  if (!Number.isFinite(now.getTime())) return Promise.reject(new ProjectFailure('invalid'));
  return projectRequest(accountId, async (client) => {
    const requests: Record<DashboardMetric, Promise<number>> = {
      totalLeads: exactCount(client.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', accountId)),
      quoteSentProjects: exactCount(client.from('projects').select('id', { count: 'exact', head: true })
        .eq('user_id', accountId).eq('status', 'quote_sent')),
      wonProjects: exactCount(client.from('projects').select('id', { count: 'exact', head: true })
        .eq('user_id', accountId).eq('status', 'won')),
      overdueReminders: exactCount(client.from('reminders').select('id', { count: 'exact', head: true })
        .eq('user_id', accountId).eq('status', 'open').lt('due_at', now.toISOString()))
    };
    const results = await Promise.allSettled(DASHBOARD_METRICS.map((key) => requests[key]));
    const output: DashboardCounts = { ...EMPTY_COUNTS };
    results.forEach((result, index) => {
      const metric = DASHBOARD_METRICS[index];
      if (result.status === 'fulfilled' && metric) output[metric] = result.value;
    });
    return output;
  });
}
