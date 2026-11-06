import type {
  InstallmentBalance, LedgerEntry, Loan, LoanCalculation, LoanInput,
  PaymentPreview, Reliability,
} from './domain';

export type { LoanInput, LoanCalculation, InstallmentBalance, PaymentPreview, Reliability } from './domain';

// A conservative explicit application limit, well inside Number's exact integer range.
export const MAX_MONEY = 100_000_000_000;
const BASIS = 10_000n;

function checkedMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) {
    throw new Error('Enter an amount of no more than ₱1,000,000,000.00.');
  }
  return value;
}

function fromBigInt(value: bigint): number {
  return checkedMoney(Number(value));
}

/** Half-up monetary rounding. Multiplication happens before the only rounding step. */
function roundedCharge(amount: number, rateBps: number): number {
  return fromBigInt((BigInt(amount) * BigInt(rateBps) + BASIS / 2n) / BASIS);
}

/** Editing-friendly parsing; it never reformats or mutates the user's input. */
export function parseMoney(raw: string): number | null {
  const input = raw.trim();
  if (!input) return null;
  const value = input.replace(/^(?:₱|PHP)\s*/i, '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/.test(value)) {
    throw new Error('Use a positive peso amount with up to two decimal places.');
  }
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
  return fromBigInt(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

/** 10 means 10%, represented as 1000 basis points. */
export function parseRate(raw: string): number {
  const value = raw.trim().replace(/%$/, '').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) {
    throw new Error('Enter a one-time percentage from 0, with up to two decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  const scaled = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (scaled > 100_000n) throw new Error('The one-time charge cannot exceed 1,000%.');
  return Number(scaled);
}

export function formatMoney(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new Error('Invalid centavo amount.');
  return new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(centavos / 100);
}

function calendarParts(date: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid calendar date.');
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Choose a valid calendar date from 1900 onward.');
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error('Choose a valid calendar date.');
  }
  return [year, month, day];
}

/** Dates remain calendar strings. No UTC/local conversion can move the agreed day. */
export function addMonthsAnchored(date: string, months: number): string {
  const [year, month, day] = calendarParts(date);
  if (!Number.isInteger(months) || months < 0 || months > 1200) throw new Error('Choose a valid month offset.');
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  if (targetYear > 9999) throw new Error('The final due date is too far in the future.');
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function todayManila(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (name: string) => parts.find((part) => part.type === name)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function paymentDay(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    calendarParts(date);
    return date;
  }
  const instant = new Date(date);
  if (!Number.isFinite(instant.valueOf())) throw new Error('The payment date is invalid.');
  return todayManila(instant);
}

export function calculateLoan(input: LoanInput): LoanCalculation {
  const amount = parseMoney(input.amount);
  if (amount === null || amount === 0) throw new Error('Enter how much they will repay or receive.');
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120) {
    throw new Error('Choose a term from 1 to 120 months.');
  }
  calendarParts(input.date);
  if (!['upfront', 'addon', 'zero'].includes(input.pricing)) throw new Error('Choose a pricing mode.');
  if (!['repay', 'cash'].includes(input.entryMode)) throw new Error('Choose how to enter the amount.');
  const rateBps = input.pricing === 'zero' ? 0 : parseRate(input.rate);
  if (input.pricing === 'upfront' && rateBps >= 10_000) {
    throw new Error('An upfront deduction must be less than 100%.');
  }

  let face = amount;
  let charge = 0;
  let cash = amount;
  let total = amount;
  if (input.pricing === 'upfront') {
    if (input.entryMode === 'cash') {
      // Find the smallest integer face whose rounded deduction nets at least the target.
      // This is monotonic even at rounding boundaries and avoids a floating-point inverse.
      let lo = amount;
      let hi = MAX_MONEY;
      const net = (candidate: number) => candidate - roundedCharge(candidate, rateBps);
      if (net(hi) < amount) throw new Error('The cash target is too large for this deduction.');
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (net(mid) >= amount) hi = mid;
        else lo = mid + 1;
      }
      face = lo;
    }
    charge = roundedCharge(face, rateBps);
    cash = face - charge;
    total = face;
  } else if (input.pricing === 'addon') {
    // An add-on quote always starts with actual cash given; the UI labels this explicitly.
    charge = roundedCharge(amount, rateBps);
    cash = amount;
    total = fromBigInt(BigInt(cash) + BigInt(charge));
    face = total;
  }
  if (cash === 0) throw new Error('The deduction leaves no cash to give. Increase the amount or lower the charge.');

  const base = Math.floor(total / input.months);
  const extra = total % input.months;
  const schedule = Array.from({ length: input.months }, (_, index) => ({
    index: index + 1,
    dueDate: addMonthsAnchored(input.date, index + 1),
    amount: base + (index < extra ? 1 : 0),
  }));
  if (!Number.isFinite(input.affordabilityPercent) || input.affordabilityPercent < 0 || input.affordabilityPercent > 100) {
    throw new Error('Choose an income share between 0% and 100%.');
  }
  const affordabilityBps = parseRate(String(input.affordabilityPercent));
  const income = parseMoney(input.income);
  const monthlyCap = income === null ? null : fromBigInt(BigInt(income) * BigInt(affordabilityBps) / BASIS);
  const suggestedMax = monthlyCap === null ? null : fromBigInt(BigInt(monthlyCap) * BigInt(input.months));
  return {
    face, charge, cash, total, schedule, monthly: schedule[0].amount,
    suggestedMax, costPercent: cash === 0 ? 0 : charge / cash * 100,
    rateBps, inputAmount: amount, months: input.months, date: input.date,
  };
}

function effectivePayments(loan: Loan, entries: LedgerEntry[]): LedgerEntry[] {
  const relevant = entries.filter((entry) => entry.loanId === loan.id);
  const reversed = new Set(relevant.filter((entry) => entry.kind === 'reversal').map((entry) => entry.reversesId));
  return relevant.filter((entry) => entry.kind === 'payment' && !reversed.has(entry.id))
    .sort((a, b) => paymentDay(a.date).localeCompare(paymentDay(b.date))
      || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function loanBalance(loan: Loan, entries: LedgerEntry[]): number {
  let paid = 0n;
  for (const entry of effectivePayments(loan, entries)) paid += BigInt(checkedMoney(entry.amount));
  if (paid > BigInt(loan.total)) throw new Error('Payment history exceeds this loan’s repayment obligation. Review the records.');
  return fromBigInt(BigInt(checkedMoney(loan.total)) - paid);
}

export function installmentBalances(loan: Loan, entries: LedgerEntry[]): InstallmentBalance[] {
  loanBalance(loan, entries); // Detect invalid histories instead of silently discarding money.
  const result: InstallmentBalance[] = loan.schedule.map((item) => ({
    ...item, paid: 0, remaining: item.amount, paidOn: null,
    status: item.amount === 0 ? 'paid' : 'unpaid',
  }));
  let cursor = 0;
  for (const payment of effectivePayments(loan, entries)) {
    let available = payment.amount;
    while (available > 0 && cursor < result.length) {
      const installment = result[cursor];
      const allocation = Math.min(installment.remaining, available);
      installment.paid += allocation;
      installment.remaining -= allocation;
      available -= allocation;
      if (installment.remaining === 0) {
        installment.paidOn = paymentDay(payment.date);
        installment.status = 'paid';
        cursor += 1;
      } else {
        installment.status = 'partial';
      }
    }
    if (available > 0) throw new Error('Payment allocations exceed the agreed installment schedule.');
  }
  return result;
}

/** Pure preview: no identifiers, persistence, counters or receipt numbers are created. */
export function previewPayment(loan: Loan, entries: LedgerEntry[], amount: number, date: string): PaymentPreview {
  checkedMoney(amount);
  if (amount === 0) throw new Error('Enter the payment received.');
  const day = paymentDay(date);
  if (day < loan.issuedOn) throw new Error('The payment cannot be dated before the loan was released.');
  const balanceBefore = loanBalance(loan, entries);
  if (amount > balanceBefore) {
    throw new Error('Amount can’t exceed the remaining balance. Record only the amount owed; handle extra cash separately.');
  }
  const current = installmentBalances(loan, entries);
  const allocations: PaymentPreview['allocations'] = [];
  let left = amount;
  for (const item of current) {
    const allocated = Math.min(left, item.remaining);
    if (allocated > 0) allocations.push({ index: item.index, amount: allocated });
    left -= allocated;
  }
  const previewEntry: LedgerEntry = {
    id: '__preview__', ref: '', kind: 'payment', loanId: loan.id, borrowerId: loan.borrowerId,
    amount, date: day, createdAt: '9999-12-31T23:59:59Z', method: '', institution: '',
    externalRef: '', operator: '', notes: '', idempotencyKey: '', balanceAfter: balanceBefore - amount,
  };
  const after = installmentBalances(loan, [...entries, previewEntry]);
  const remaining = after.filter((item) => item.remaining > 0);
  return {
    balanceBefore, balanceAfter: balanceBefore - amount, allocations,
    nextDue: remaining[0]?.dueDate ?? null, remainingInstallments: remaining.length,
    status: balanceBefore === amount ? 'Paid in Full' : 'Active',
  };
}

function elapsedDays(from: string, to: string): number {
  const a = calendarParts(from);
  const b = calendarParts(to);
  return Math.max(0, Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000));
}

export function reliability(loans: Loan[], entries: LedgerEntry[], today = todayManila()): Reliability {
  calendarParts(today);
  let dueCount = 0;
  let onTime = 0;
  let lateCount = 0;
  let totalLateDays = 0;
  for (const loan of loans) {
    for (const item of installmentBalances(loan, entries)) {
      if (item.amount === 0) continue;
      // Today is still available for an unpaid installment. Do not penalize before day-end.
      if (item.dueDate > today || (item.dueDate === today && !item.paidOn)) continue;
      dueCount += 1;
      if (item.remaining === 0 && item.paidOn && item.paidOn <= item.dueDate) onTime += 1;
      else {
        lateCount += 1;
        totalLateDays += elapsedDays(item.dueDate, item.paidOn ?? today);
      }
    }
  }
  const ratio = dueCount === 0 ? 0 : onTime / dueCount;
  const stars = dueCount === 0 ? null : ratio >= .95 ? 5 : ratio >= .85 ? 4 : ratio >= .7 ? 3 : ratio >= .5 ? 2 : 1;
  return {
    stars, dueCount, onTime, lateCount,
    averageDaysLate: lateCount === 0 ? 0 : Math.round(totalLateDays / lateCount * 10) / 10,
    settledLoans: loans.filter((loan) => loanBalance(loan, entries) === 0).length,
  };
}

/** One offline search normalization for names, identifiers, notes and file labels. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-PH').replace(/[\s\p{P}\p{S}]+/gu, '');
}
