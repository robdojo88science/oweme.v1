import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Loan, LoanInput } from './domain';
import {
  addMonthsAnchored, calculateLoan, formatMoney, installmentBalances, loanBalance,
  MAX_MONEY, normalizeSearch, parseMoney, parseRate, previewPayment, reliability, todayManila,
} from './finance';

const input = (changes: Partial<LoanInput> = {}): LoanInput => ({
  amount: '3000', rate: '10', months: 3, date: '2026-11-05',
  pricing: 'upfront', entryMode: 'repay', income: '1000', affordabilityPercent: 100, ...changes,
});

const makeLoan = (changes: Partial<LoanInput> = {}): Loan => {
  const draft = input(changes);
  const calc = calculateLoan(draft);
  return {
    id: 'loan-1', ref: 'OWM-LON-2026-000001', borrowerId: 'borrower-1',
    createdAt: '2026-11-05T02:00:00.000Z', issuedOn: draft.date,
    pricing: draft.pricing, entryMode: draft.entryMode, inputAmount: calc.inputAmount,
    rateBps: calc.rateBps, months: draft.months, courtesyDays: 5,
    face: calc.face, charge: calc.charge, cash: calc.cash, total: calc.total, schedule: calc.schedule,
    affordabilityPercent: draft.affordabilityPercent, income: parseMoney(draft.income),
    overrideReason: '', terms: '', operator: 'Owner',
  };
};

const payment = (id: string, amount: number, date: string): LedgerEntry => ({
  id, ref: `OWM-PAY-2026-${id}`, kind: 'payment', loanId: 'loan-1', borrowerId: 'borrower-1',
  amount, date, createdAt: `${date}T08:00:00.000Z`, method: 'Cash', institution: '',
  externalRef: '', operator: 'Owner', notes: '', idempotencyKey: id, balanceAfter: 0,
});

describe('editing-friendly, exact centavo parsing', () => {
  it('allows empty, zero, trailing decimal and pasted PHP amounts without changing the string', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('1000.')).toBe(100_000);
    expect(parseMoney('₱3,000.00')).toBe(300_000);
    expect(parseMoney('PHP 1,234.50')).toBe(123_450);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('1000.1')).toBe(100_010);
  });

  it.each(['-1', 'NaN', 'Infinity', '1.001', '1e3', '1,00', 'PHP', '₱-1', '1.2.3', '12abc'])('rejects invalid money %s', (value) => {
    expect(() => parseMoney(value)).toThrow();
  });

  it('has an explicit safely representable upper limit', () => {
    expect(parseMoney('1000000000')).toBe(MAX_MONEY);
    expect(() => parseMoney('1000000000.01')).toThrow(/no more/);
    expect(() => parseMoney('999999999999999999999999999999')).toThrow();
  });

  it('uses decimal percentages and never mistakes 2.5 for 250%', () => {
    expect(parseRate('2.5')).toBe(250);
    expect(parseRate('10%')).toBe(1000);
    expect(parseRate('0')).toBe(0);
    expect(parseRate('99.99')).toBe(9999);
    for (const value of ['', '-1', 'NaN', '2.555', '1001', '1e2']) expect(() => parseRate(value)).toThrow();
  });

  it('formats centavos consistently', () => {
    expect(formatMoney(123_456)).toBe('₱1,234.56');
    expect(formatMoney(1)).toBe('₱0.01');
    expect(() => formatMoney(.5)).toThrow();
  });
});

describe('one live financial engine', () => {
  it('deducts one 10% charge for the entire term, never a monthly charge', () => {
    const result = calculateLoan(input());
    expect(result).toMatchObject({ face: 300_000, charge: 30_000, cash: 270_000, total: 300_000, monthly: 100_000 });
    expect(result.schedule.map((item) => item.amount)).toEqual([100_000, 100_000, 100_000]);
    expect(result.costPercent).toBeCloseTo(11.111111, 5);
  });

  it('finds minimum face amounts that meet the exact cash target after rounded charge', () => {
    expect(calculateLoan(input({ entryMode: 'cash', amount: '2700' }))).toMatchObject({ face: 300_000, charge: 30_000, cash: 270_000 });
    expect(calculateLoan(input({ entryMode: 'cash', amount: '3000' }))).toMatchObject({ face: 333_333, charge: 33_333, cash: 300_000 });
    expect(calculateLoan(input({ entryMode: 'cash', amount: '0.01', rate: '99.99' }))).toMatchObject({ face: 5001, charge: 5000, cash: 1 });
  });

  it('adds a one-time charge to cash given only in add-on mode', () => {
    const result = calculateLoan(input({ pricing: 'addon', entryMode: 'cash' }));
    expect(result).toMatchObject({ face: 330_000, cash: 300_000, charge: 30_000, total: 330_000, monthly: 110_000 });
    expect(calculateLoan(input({ pricing: 'zero' }))).toMatchObject({ cash: 300_000, charge: 0, total: 300_000 });
  });

  it('rounds half-centavo charges once, half up', () => {
    expect(calculateLoan(input({ amount: '1.05', rate: '10' })).charge).toBe(11);
    expect(calculateLoan(input({ amount: '1.04', rate: '10' })).charge).toBe(10);
    expect(calculateLoan(input({ amount: '1000', rate: '2.5' })).charge).toBe(2500);
  });

  it('distributes remainder centavos to the earliest installments', () => {
    expect(calculateLoan(input({ amount: '1000' })).schedule.map((row) => row.amount)).toEqual([33_334, 33_333, 33_333]);
    expect(calculateLoan(input({ amount: '0.01', pricing: 'zero' })).schedule.map((row) => row.amount)).toEqual([1, 0, 0]);
  });

  it('computes conservative guidelines without assuming unreported income', () => {
    expect(calculateLoan(input()).suggestedMax).toBe(300_000);
    expect(calculateLoan(input({ affordabilityPercent: 30 })).suggestedMax).toBe(90_000);
    expect(calculateLoan(input({ income: '' })).suggestedMax).toBeNull();
    expect(calculateLoan(input({ income: '1.01', affordabilityPercent: 30 })).suggestedMax).toBe(90);
    expect(calculateLoan(input({ affordabilityPercent: 0 })).suggestedMax).toBe(0);
  });

  it.each([
    { amount: '' }, { amount: '0' }, { months: 0 }, { months: 1.5 }, { months: 121 },
    { rate: '-1' }, { rate: '100' }, { rate: '100.01' }, { date: '2026-02-30' },
    { affordabilityPercent: -1 }, { affordabilityPercent: 101 }, { income: '-1000' },
  ])('rejects invalid issuance input %j', (changes) => {
    expect(() => calculateLoan(input(changes))).toThrow();
  });

  it('uses the latest complete draft state with no retained intermediate values', () => {
    const original = input();
    const first = calculateLoan(original);
    const changed = calculateLoan({ ...original, amount: '2000', rate: '2.5', months: 4, date: '2027-01-31' });
    expect(changed).toMatchObject({ total: 200_000, charge: 5000, cash: 195_000, monthly: 50_000 });
    expect(changed.schedule.map((row) => row.dueDate)).toEqual(['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    expect(first.cash).toBe(270_000);
    expect(original.amount).toBe('3000');
  });

  it('preserves accounting identities and minimum-net targets over many independent amounts', () => {
    let seed = 703;
    const random = () => { seed = (seed * 48271) % 2147483647; return seed; };
    for (let index = 0; index < 400; index += 1) {
      const amount = 1 + random() % 10_000_000;
      const rate = random() % 9900;
      const months = 1 + random() % 12;
      const common = input({ amount: (amount / 100).toFixed(2), rate: (rate / 100).toFixed(2), months });
      const upfront = calculateLoan(common);
      expect(upfront.cash + upfront.charge).toBe(upfront.face);
      expect(upfront.schedule.reduce((sum, row) => sum + row.amount, 0)).toBe(upfront.total);
      expect(upfront.schedule.every((row) => Number.isSafeInteger(row.amount) && row.amount >= 0)).toBe(true);
      const inverse = calculateLoan({ ...common, entryMode: 'cash' });
      expect(inverse.cash).toBeGreaterThanOrEqual(amount);
      if (inverse.face > 1) {
        const previousCharge = Number((BigInt(inverse.face - 1) * BigInt(rate) + 5000n) / 10_000n);
        expect(inverse.face - 1 - previousCharge).toBeLessThan(amount);
      }
      const addon = calculateLoan({ ...common, pricing: 'addon', entryMode: 'cash' });
      expect(addon.cash + addon.charge).toBe(addon.total);
      expect(addon.schedule.reduce((sum, row) => sum + row.amount, 0)).toBe(addon.total);
    }
  });
});

describe('anchored Philippine calendar dates', () => {
  it('starts one calendar month after release and crosses year-end', () => {
    expect(calculateLoan(input()).schedule.map((row) => row.dueDate)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
  });
  it('clamps each month independently without drifting from January 31', () => {
    expect([1, 2, 3].map((months) => addMonthsAnchored('2027-01-31', months))).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
    expect([1, 2, 3].map((months) => addMonthsAnchored('2028-01-31', months))).toEqual(['2028-02-29', '2028-03-31', '2028-04-30']);
    expect(addMonthsAnchored('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonthsAnchored('2026-12-30', 2)).toBe('2027-02-28');
  });
  it('uses Manila day even while UTC is on the preceding date', () => {
    expect(todayManila(new Date('2026-11-05T16:00:00Z'))).toBe('2026-11-06');
    expect(todayManila(new Date('2026-11-05T15:59:59Z'))).toBe('2026-11-05');
    expect(() => addMonthsAnchored('2027-02-29', 1)).toThrow();
  });
});

describe('payment preview, allocation, reversal and rating', () => {
  it('previews partial/full payments without changing ledger or loan', () => {
    const loan = makeLoan();
    const entries: LedgerEntry[] = [];
    const original = JSON.stringify(loan);
    expect(previewPayment(loan, entries, 50_000, '2026-12-05')).toMatchObject({ balanceBefore: 300_000, balanceAfter: 250_000, allocations: [{ index: 1, amount: 50_000 }], remainingInstallments: 3 });
    expect(previewPayment(loan, entries, 100_000, '2026-12-05')).toMatchObject({ balanceAfter: 200_000, nextDue: '2027-01-05', remainingInstallments: 2 });
    expect(previewPayment(loan, entries, 300_000, '2026-12-05')).toMatchObject({ balanceAfter: 0, nextDue: null, status: 'Paid in Full' });
    expect(entries).toEqual([]);
    expect(JSON.stringify(loan)).toBe(original);
  });

  it('settles a due installment only after both partial payments arrive', () => {
    const loan = makeLoan();
    const first = payment('p1', 50_000, '2026-12-04');
    const second = payment('p2', 50_000, '2026-12-05');
    expect(installmentBalances(loan, [first])[0]).toMatchObject({ paid: 50_000, remaining: 50_000, paidOn: null, status: 'partial' });
    expect(installmentBalances(loan, [second, first])[0]).toMatchObject({ paid: 100_000, remaining: 0, paidOn: '2026-12-05', status: 'paid' });
    expect(reliability([loan], [first, second], '2026-12-06')).toMatchObject({ stars: 5, dueCount: 1, onTime: 1, lateCount: 0 });
  });

  it('does not disguise courtesy-period payments as on-time', () => {
    const loan = makeLoan();
    const entries = [payment('p1', 50_000, '2026-12-05'), payment('p2', 50_000, '2026-12-08')];
    expect(reliability([loan], entries, '2026-12-09')).toMatchObject({ stars: 1, dueCount: 1, onTime: 0, lateCount: 1, averageDaysLate: 3 });
    expect(loan.schedule[0].dueDate).toBe('2026-12-05');
  });

  it('is not rated before due history exists and does not penalize an unfinished due day', () => {
    const loan = makeLoan();
    expect(reliability([loan], [], '2026-12-04').stars).toBeNull();
    expect(reliability([loan], [], '2026-12-05').stars).toBeNull();
    expect(reliability([loan], [], '2026-12-06')).toMatchObject({ stars: 1, lateCount: 1, averageDaysLate: 1 });
  });

  it('allocates advance payments oldest-first without moving due dates', () => {
    const loan = makeLoan();
    const early = payment('advance', 150_000, '2026-11-06');
    const result = installmentBalances(loan, [early]);
    expect(result.map((row) => row.paid)).toEqual([100_000, 50_000, 0]);
    expect(result.map((row) => row.dueDate)).toEqual(loan.schedule.map((row) => row.dueDate));
  });

  it('reversal restores exact balance and rating while keeping original history', () => {
    const loan = makeLoan();
    const original = payment('p1', 100_000, '2026-12-05');
    const reversed: LedgerEntry = { ...payment('r1', 100_000, '2026-12-06'), kind: 'reversal', reversesId: original.id, notes: 'Wrong cash amount' };
    const corrected = payment('p2', 50_000, '2026-12-06');
    expect(loanBalance(loan, [original])).toBe(200_000);
    expect(loanBalance(loan, [original, reversed])).toBe(300_000);
    const history = [original, reversed, corrected];
    expect(loanBalance(loan, history)).toBe(250_000);
    expect(installmentBalances(loan, history)[0].remaining).toBe(50_000);
    expect(reliability([loan], history, '2026-12-07')).toMatchObject({ stars: 1, onTime: 0 });
    expect(history).toHaveLength(3);
    expect(original.kind).toBe('payment');
  });

  it('rejects accidental overpayment, zero and pre-release dates', () => {
    const loan = makeLoan();
    expect(() => previewPayment(loan, [], 300_001, '2026-12-05')).toThrow(/remaining balance/);
    expect(() => previewPayment(loan, [], 0, '2026-12-05')).toThrow();
    expect(() => previewPayment(loan, [], 1, '2026-11-04')).toThrow(/before/);
    expect(() => loanBalance(loan, [payment('bad', 300_001, '2026-12-05')])).toThrow(/exceeds/);
  });

  it('never mixes one borrower’s separate loans', () => {
    const loan = makeLoan();
    const other = { ...payment('other', 100_000, '2026-12-05'), loanId: 'loan-2' };
    expect(loanBalance(loan, [other])).toBe(300_000);
  });

  it('preserves paid + outstanding = obligation over many payment sequences', () => {
    for (let amount = 1; amount < 50_000; amount += 739) {
      const loan = makeLoan({ amount: (amount / 100).toFixed(2), pricing: 'zero' });
      const first = Math.floor(amount / 3);
      const second = Math.floor(amount / 4);
      const entries = [payment('first', first, '2026-11-06'), payment('second', second, '2026-11-07')];
      expect(loanBalance(loan, entries) + first + second).toBe(amount);
      const rows = installmentBalances(loan, entries);
      expect(rows.reduce((sum, row) => sum + row.remaining, 0)).toBe(loanBalance(loan, entries));
    }
  });
});

it('normalizes private offline searches across accents, spaces and reference punctuation', () => {
  expect(normalizeSearch(' José  de la Cruz ')).toBe(normalizeSearch('jose dela cruz'));
  expect(normalizeSearch('OWM-PAY-2026-000001')).toBe('owmpay2026000001');
});
