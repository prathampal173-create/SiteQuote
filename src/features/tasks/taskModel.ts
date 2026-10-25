import type { Database } from '../../lib/database.types';

export type Task = Database['public']['Tables']['project_tasks']['Row'];
export const TASK_CATEGORIES = [
  'House Remodeling', 'Kitchen Remodeling', 'Bathroom Remodeling',
  'Flooring', 'Painting', 'Electrical/Plumbing', 'Miscellaneous'
] as const;
export type TaskCategory = typeof TASK_CATEGORIES[number];
export type TaskDraft = { category: TaskCategory; title: string; notes: string; cost: string };
export const EMPTY_TASK: TaskDraft = {
  category: 'House Remodeling', title: '', notes: '', cost: '0.00'
};

/** Strict decimal parser, no float conversion, even at the maximum safe cent value. */
export function parseUsdCents(input: string): number | null {
  const value = input.trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid USD cents');
  const whole = Number(BigInt(cents) / 100n);
  const fractional = (BigInt(cents) % 100n).toString().padStart(2, '0');
  // BigInt avoids the rounding introduced by a cents/100 floating-point formatter.
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(whole)}.${fractional}`;
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    category: task.category as TaskCategory, title: task.title,
    notes: task.notes ?? '', cost: (BigInt(task.amount_minor) / 100n).toString() + '.' +
      (BigInt(task.amount_minor) % 100n).toString().padStart(2, '0')
  };
}

export type TaskErrors = { category?: string; title?: string; cost?: string };
export function validateTask(draft: TaskDraft):
  | { ok: true; values: { category: TaskCategory; title: string; notes: string | null; amount_minor: number } }
  | { ok: false; errors: TaskErrors } {
  const errors: TaskErrors = {};
  if (!(TASK_CATEGORIES as readonly string[]).includes(draft.category)) errors.category = 'Select a valid category.';
  if (!draft.title.trim()) errors.title = 'Task title is required.';
  const cents = parseUsdCents(draft.cost);
  if (cents === null) errors.cost = 'Enter a nonnegative USD amount with at most two decimal places.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { category: draft.category, title: draft.title.trim(),
    notes: draft.notes.trim() || null, amount_minor: cents! } };
}
