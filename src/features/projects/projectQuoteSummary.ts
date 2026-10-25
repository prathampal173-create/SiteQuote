import { formatUsdCents } from '../tasks/taskModel';
import { quoteReference } from '../estimates/preparedQuotes';
import { projectRequest } from './projectsApi';
import type { Project } from './projectModel';

type SentSummary = { id: string; project_id: string; user_id: string; status: string; version: number; total_minor: number };
export type QuoteSummary = { label: 'Accepted quote' | 'Latest sent quote'; reference: string; amountMinor: number } | null;

/** Prefer the explicitly accepted version for Won, otherwise the highest *numbered* Sent. */
export function summarizeQuote(project: Project, quotes: readonly SentSummary[]): QuoteSummary {
  const sent = quotes.filter((q) => q.project_id === project.id && q.user_id === project.user_id &&
    q.status === 'sent' && Number.isSafeInteger(q.total_minor) && q.total_minor > 0 &&
    Number.isSafeInteger(q.version) && q.version > 0);
  const match = project.status === 'won' ? sent.find((q) => q.id === project.accepted_quote_id) :
    sent.reduce<SentSummary | null>((best, q) => !best || q.version > best.version ? q : best, null);
  if (!match) return null;
  return { label: project.status === 'won' ? 'Accepted quote' : 'Latest sent quote',
    reference: quoteReference(match), amountMinor: match.total_minor };
}

/** One paginated, owner-scoped query for project lists; no per-card network calls. */
export async function loadProjectQuoteSummaries(accountId: string, projects: readonly Project[]): Promise<Map<string, QuoteSummary>> {
  if (!projects.length) return new Map();
  return projectRequest(accountId, async (client) => {
    const sent: SentSummary[] = [];
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await client.from('quotes')
        .select('id,project_id,user_id,status,version,total_minor')
        .eq('user_id', accountId).eq('status', 'sent')
        .order('project_id', { ascending: true }).order('version', { ascending: false })
        .range(offset, offset + 199);
      if (error) throw error;
      sent.push(...(data ?? []));
      if ((data?.length ?? 0) < 200) break;
    }
    return new Map(projects.map((p) => [p.id, summarizeQuote(p, sent)]));
  });
}
export function quoteSummaryLine(project: Project, summary: QuoteSummary): string {
  if (summary) return `${summary.label}: ${formatUsdCents(summary.amountMinor)} · ${summary.reference}`;
  return project.status === 'won' ? 'Accepted quote unavailable — refresh' : 'No sent quote';
}
