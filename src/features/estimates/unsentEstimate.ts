import { calculateEstimate, type EstimateTotals } from './estimateMath';

export type EstimateTaskLine = {
  id: string; category: string; title: string; notes: string | null;
  amount_minor: number; sort_order: number;
};
export type EstimateChargeLine = {
  id: string; description: string; amount_minor: number; sort_order: number;
};
/** Only these explicitly allowed fields may enter an unsent estimate/PDF. */
export type EstimateContent = {
  project_id: string; user_id: string; project_title: string; site_address: string | null;
  status: string; tax_bps: number;
  customer_name: string; customer_phone: string | null; customer_email: string | null;
  business_name: string | null; business_phone: string | null; business_address: string | null;
  tasks: EstimateTaskLine[]; charges: EstimateChargeLine[];
};
export type UnsentEstimate = { content: EstimateContent; fingerprint: string; totals: EstimateTotals };

function stringValue(value: unknown): value is string { return typeof value === 'string'; }
function optionalString(value: unknown): value is string | null { return value === null || stringValue(value); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value); }
function cents(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

/** Reject malformed / unsafe JSON cents rather than silently rounding a remote amount. */
export function parseUnsentEstimate(payload: unknown, accountId: string, projectId: string): UnsentEstimate {
  if (!record(payload) || !record(payload.content) ||
      !stringValue(payload.fingerprint) || !/^[a-f0-9]{64}$/.test(payload.fingerprint))
    throw new Error('Invalid estimate snapshot.');
  const c = payload.content;
  if (c.user_id !== accountId || c.project_id !== projectId ||
      !stringValue(c.project_title) || !stringValue(c.status) || !stringValue(c.customer_name) ||
      !optionalString(c.site_address) || !optionalString(c.customer_phone) ||
      !optionalString(c.customer_email) || !optionalString(c.business_name) ||
      !optionalString(c.business_phone) || !optionalString(c.business_address) ||
      !integer(c.tax_bps) || !Array.isArray(c.tasks) || !Array.isArray(c.charges))
    throw new Error('Invalid estimate fields or ownership.');
  const tasks = c.tasks;
  const charges = c.charges;
  if (!tasks.every((t: unknown) => record(t) && stringValue(t.id) && stringValue(t.category) &&
      stringValue(t.title) && optionalString(t.notes) && cents(t.amount_minor) && integer(t.sort_order)) ||
      !charges.every((x: unknown) => record(x) && stringValue(x.id) && stringValue(x.description) &&
      cents(x.amount_minor) && integer(x.sort_order))) throw new Error('Invalid pricing lines.');
  const content = c as unknown as EstimateContent;
  return { content, fingerprint: payload.fingerprint,
    totals: calculateEstimate(content.tasks, content.charges, content.tax_bps) };
}

export const ESTIMATE_CHANGED_MESSAGE = 'Estimate changed — preview again.';
export function matchesPreview(original: UnsentEstimate, newest: UnsentEstimate): boolean {
  return original.fingerprint === newest.fingerprint &&
    original.content.user_id === newest.content.user_id &&
    original.content.project_id === newest.content.project_id;
}
