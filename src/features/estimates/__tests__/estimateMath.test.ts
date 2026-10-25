import { calculateEstimate, formatChargeDraft, formatTaxBps, parseTaxBps, validateCharge } from '../estimateMath';
const line = (cents: number) => ({ amount_minor: cents });

test('documented $3,402 acceptance: tasks $3,000 + charges $150 + 8% tax', () => {
  const total = calculateEstimate([line(150000), line(50000), line(100000)], [line(10000), line(5000)], 800);
  expect(total).toEqual({ taskSubtotalMinor: 300000, chargesTotalMinor: 15000,
    pretaxMinor: 315000, taxMinor: 25200, finalMinor: 340200, taxBps: 800 });
});
test('zero lines, zero tax, and many independent charge lines', () => {
  expect(calculateEstimate([], [], 0).finalMinor).toBe(0);
  expect(calculateEstimate([line(0)], [line(0), line(125), line(75)], 0)).toMatchObject({
    taskSubtotalMinor: 0, chargesTotalMinor: 200, taxMinor: 0, finalMinor: 200
  });
});
test('tax uses round-half-up ONCE on aggregate exact cents', () => {
  expect(calculateEstimate([line(1)], [], 500).taxMinor).toBe(0); // 5% of one cent
  expect(calculateEstimate([line(1)], [], 3000).taxMinor).toBe(0);
  expect(calculateEstimate([line(1)], [line(1)], 2500).taxMinor).toBe(1);
  expect(calculateEstimate([line(5)], [], 1000).taxMinor).toBe(1);
  // Two one-cent lines taxed at 25% round to one cent together (not zero per line).
  expect(calculateEstimate([line(1), line(1)], [], 2500).finalMinor).toBe(3);
});
test('large prices, exact cents, and no floating-point drift', () => {
  expect(calculateEstimate([line(100000001), line(99999999)], [line(1)], 750)).toMatchObject({
    pretaxMinor: 200000001, taxMinor: 15000000, finalMinor: 215000001
  });
  expect(calculateEstimate([line(Number.MAX_SAFE_INTEGER)], [], 0).finalMinor)
    .toBe(Number.MAX_SAFE_INTEGER);
  expect(() => calculateEstimate([line(Number.MAX_SAFE_INTEGER)], [line(1)], 0)).toThrow(RangeError);
  expect(() => calculateEstimate([line(Number.MAX_SAFE_INTEGER)], [], 1)).toThrow(RangeError);
});
test('invalid cents and tax rates rejected, including fractional/infinite values', () => {
  for (const cents of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => calculateEstimate([line(cents)], [], 0)).toThrow(RangeError);
  }
  for (const bps of [-1, 3001, 1.1, NaN, Infinity]) {
    expect(() => calculateEstimate([], [], bps)).toThrow(RangeError);
  }
});
test('tax editor enforces 0%..30%, precision two decimal places', () => {
  for (const [input, expected] of [['0', 0], ['30', 3000], ['8', 800], ['8.5', 850],
    ['.01', 1], ['30.00', 3000], ['00.00', 0], [' 8.25 ', 825]] as const) {
    expect(parseTaxBps(input)).toBe(expected);
  }
  for (const input of ['', '-1', '30.01', '8.999', '3e1', 'Infinity', '1,000', '3.', '0.001', '1e-3']) {
    expect(parseTaxBps(input)).toBeNull();
  }
  expect(formatTaxBps(825)).toBe('8.25');
});
test('charge editor requires a description and exact nonnegative cents', () => {
  expect(validateCharge(' Permit ', '150.00')).toEqual({ ok: true, values: {
    description: 'Permit', amount_minor: 15000
  } });
  expect(validateCharge('  ', '10')).toMatchObject({ ok: false, errors: { description: expect.any(String) } });
  for (const input of ['-1', '1.234', '1e5', '', '$100', '90071992547409.92']) {
    expect(validateCharge('Permit', input)).toMatchObject({ ok: false, errors: { amount: expect.any(String) } });
  }
  expect(validateCharge('Free item', '0')).toMatchObject({ ok: true, values: { amount_minor: 0 } });
  expect(formatChargeDraft(101205)).toBe('1012.05');
});
