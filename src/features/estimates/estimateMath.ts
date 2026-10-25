import { formatUsdCents, parseUsdCents } from '../tasks/taskModel';

/** All calculation inputs are whole USD cents, never floating-point dollars. */
export type PricedLine = { amount_minor: number };
export type EstimateTotals = {
  taskSubtotalMinor: number; chargesTotalMinor: number; pretaxMinor: number;
  taxMinor: number; finalMinor: number; taxBps: number;
};

function safeCents(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Estimate exceeds the supported exact USD-cent range.');
  return Number(value);
}
function validateCents(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid USD cents.');
  return BigInt(value);
}
export function calculateEstimate(tasks: readonly PricedLine[], charges: readonly PricedLine[], taxBps: number): EstimateTotals {
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 3000)
    throw new RangeError('Tax must be between 0 and 3000 basis points.');
  const sum = (items: readonly PricedLine[]) => items.reduce((total, item) => total + validateCents(item.amount_minor), 0n);
  const task = sum(tasks);
  const extras = sum(charges);
  const pretax = task + extras;
  // Round half up exactly ONCE, on the entire pre-tax total.
  const tax = (pretax * BigInt(taxBps) + 5000n) / 10000n;
  return {
    taskSubtotalMinor: safeCents(task), chargesTotalMinor: safeCents(extras),
    pretaxMinor: safeCents(pretax), taxMinor: safeCents(tax),
    finalMinor: safeCents(pretax + tax), taxBps
  };
}

/** 8, 8.0, 8.00 -> 800 bps. Never interpret a binary float as a money amount. */
export function parseTaxBps(input: string): number | null {
  const value = input.trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const bps = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return bps <= 3000n ? Number(bps) : null;
}
export function formatTaxBps(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0 || bps > 3000) throw new RangeError('Invalid tax basis points.');
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;
}
export function validateCharge(description: string, amount: string):
  | { ok: true; values: { description: string; amount_minor: number } }
  | { ok: false; errors: { description?: string; amount?: string } } {
  const errors: { description?: string; amount?: string } = {};
  if (!description.trim()) errors.description = 'Charge description is required.';
  const cents = parseUsdCents(amount);
  if (cents === null) errors.amount = 'Enter a nonnegative USD amount with at most two decimal places.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { description: description.trim(), amount_minor: cents! } };
}
export function formatChargeDraft(cents: number): string {
  return formatUsdCents(cents).replace(/[$,]/g, '');
}
