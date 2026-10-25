import { parseUnsentEstimate, type UnsentEstimate } from './unsentEstimate';
import { calculateEstimate } from './estimateMath';
import { formatUsdCents } from '../tasks/taskModel';

export type QuoteStatus = 'prepared' | 'sent';
export type PreparedQuote = {
  id: string; user_id: string; project_id: string; version: number;
  status: QuoteStatus; fingerprint: string; request_key: string;
  snapshot: { content: UnsentEstimate['content']; totals: UnsentEstimate['totals'] };
  tasks_subtotal_minor: number; charges_total_minor: number;
  tax_bps: number; tax_minor: number; total_minor: number;
  issued_at: string; sent_at: string | null;
};
export type PrepareResult = { result: 'created' | 'reused_prepared' | 'reshare_sent'; quote: PreparedQuote };
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Reject mis-scoped, malformed and mismatched frozen financial snapshots. */
export function parsePreparedQuote(row: unknown, accountId: string, projectId: string): PreparedQuote {
  if (!obj(row) || row.user_id !== accountId || row.project_id !== projectId ||
    typeof row.id !== 'string' || typeof row.request_key !== 'string' ||
    !integer(row.version) || row.version < 1 ||
    (row.status !== 'prepared' && row.status !== 'sent') ||
    typeof row.issued_at !== 'string' || !Number.isFinite(Date.parse(row.issued_at)) ||
    !(row.sent_at === null || typeof row.sent_at === 'string') ||
    !obj(row.snapshot) || !obj(row.snapshot.totals)) throw new Error('Invalid or unauthorized quote.');
  const estimate = parseUnsentEstimate({ content: row.snapshot.content, fingerprint: row.fingerprint }, accountId, projectId);
  const t = estimate.totals;
  const savedTotals = row.snapshot.totals as Record<string, unknown>;
  if (estimate.content.tasks.length < 1 || !estimate.content.business_name?.trim() || t.finalMinor <= 0 ||
    !integer(row.tasks_subtotal_minor) || !integer(row.charges_total_minor) ||
    !integer(row.tax_bps) || !integer(row.tax_minor) || !integer(row.total_minor) ||
    row.tasks_subtotal_minor !== t.taskSubtotalMinor || row.charges_total_minor !== t.chargesTotalMinor ||
    row.tax_bps !== t.taxBps || row.tax_minor !== t.taxMinor || row.total_minor !== t.finalMinor ||
    Object.entries({ taskSubtotalMinor: t.taskSubtotalMinor, chargesTotalMinor: t.chargesTotalMinor,
      pretaxMinor: t.pretaxMinor, taxMinor: t.taxMinor, finalMinor: t.finalMinor, taxBps: t.taxBps })
      .some(([field, value]) => savedTotals[field] !== value))
    throw new Error('Quote snapshot totals are inconsistent.');
  return row as unknown as PreparedQuote;
}
export function parsePrepareResult(payload: unknown, accountId: string, projectId: string): PrepareResult {
  if (!obj(payload) || !['created','reused_prepared','reshare_sent'].includes(String(payload.result)))
    throw new Error('Invalid quote preparation result.');
  return { result: payload.result as PrepareResult['result'],
    quote: parsePreparedQuote(payload.quote, accountId, projectId) };
}
export function quoteReference(q: Pick<PreparedQuote, 'project_id' | 'version'>): string {
  return `SQ-${q.project_id.replace(/-/g, '').slice(0,12).toUpperCase()}-v${q.version}`;
}
/** Version-to-version comparison uses frozen fields, never current mutable task rows. */
export function quoteChanges(current: PreparedQuote, previous: PreparedQuote | null): string {
  if (!previous) return 'First prepared version';
  if (current.fingerprint === previous.fingerprint) return 'Same estimate content';
  const a = current.snapshot.content, b = previous.snapshot.content;
  const changes: string[] = [];
  if (JSON.stringify(a.tasks) !== JSON.stringify(b.tasks)) changes.push('task lines or notes');
  if (JSON.stringify(a.charges) !== JSON.stringify(b.charges)) changes.push('additional charges');
  if (a.tax_bps !== b.tax_bps) changes.push('tax rate');
  if (a.project_title !== b.project_title || a.site_address !== b.site_address) changes.push('project details');
  if (a.customer_name !== b.customer_name || a.customer_phone !== b.customer_phone ||
      a.customer_email !== b.customer_email) changes.push('customer details');
  if (a.business_name !== b.business_name || a.business_phone !== b.business_phone ||
      a.business_address !== b.business_address) changes.push('business details');
  const delta = current.total_minor - previous.total_minor;
  return `${changes.join(', ') || 'Saved estimate details'} · ${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatUsdCents(Math.abs(delta))} vs previous version`;
}
/** Server-side values are checked against the exact same Phase 3A calculation. */
export function frozenEstimate(q: PreparedQuote): UnsentEstimate {
  const c = q.snapshot.content;
  return { content: c, fingerprint: q.fingerprint,
    totals: calculateEstimate(c.tasks, c.charges, c.tax_bps) };
}
