import { draftFromTask, formatUsdCents, parseUsdCents, TASK_CATEGORIES, validateTask, type Task } from '../taskModel';

const draft = { category: 'Kitchen Remodeling' as const, title: 'Cabinet installation', notes: 'Own notes', cost: '1500.00' };
test('each documented task category is selectable without deduplication', () => {
  expect(TASK_CATEGORIES).toHaveLength(7);
  expect(TASK_CATEGORIES).toContain('Electrical/Plumbing');
  expect(validateTask(draft)).toEqual({ ok: true, values: {
    title: 'Cabinet installation', category: 'Kitchen Remodeling', notes: 'Own notes', amount_minor: 150000
  } });
  expect(validateTask({ ...draft, notes: 'Second task', title: 'Countertop replacement' }).ok).toBe(true);
});

test.each([
  ['0', 0], ['0.00', 0], ['.50', 50], ['1', 100], ['0.01', 1],
  ['1500', 150000], ['1500.01', 150001], [' 1.90 ', 190],
  ['90071992547409.91', Number.MAX_SAFE_INTEGER]
] as [string, number][])('parses %s as exact %i cents', (input, cents) => {
  expect(parseUsdCents(input)).toBe(cents);
});

test.each(['', ' ', '-1', '-0.01', '1.001', '0.005', '1.999', 'abc', '$1',
  '1e4', 'Infinity', 'NaN', '1,000', '90071992547409.92', '9999999999999999999', '+1'])
('rejects invalid/negative/fractional/overflow %s', (value) => {
  expect(parseUsdCents(value)).toBeNull();
  expect(validateTask({ ...draft, cost: value }).ok).toBe(false);
});

test('exact formatting and persisted task fields round trip without float rounding', () => {
  expect(formatUsdCents(0)).toBe('$0.00');
  expect(formatUsdCents(150001)).toBe('$1,500.01');
  expect(formatUsdCents(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91');
  expect(() => formatUsdCents(-1)).toThrow();
  const task: Task = {
    id: 'task-1', user_id: 'a', project_id: 'p', category: 'Flooring', title: 'Repair',
    notes: 'Private to repair', amount_minor: 101, sort_order: 0,
    created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z'
  };
  expect(draftFromTask(task)).toEqual({ category: 'Flooring', title: 'Repair',
    notes: 'Private to repair', cost: '1.01' });
});

test('validates title and fixed categories', () => {
  expect(validateTask({ ...draft, title: '   ' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
  expect(validateTask({ ...draft, category: 'Invented' as typeof draft.category })).toMatchObject({
    ok: false, errors: { category: expect.any(String) }
  });
});
