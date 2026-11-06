import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addAttachment, addBorrower, archiveBorrower, clearData, db, getSnapshot, issueLoan, postPayment, reversePayment, saveSettings, updateBorrower } from './db';
import { backupTotals, canonical, captureBackup, exportBackup, inspectBackup, restoreBackup } from './backup';
import { calculateLoan, loanBalance } from './finance';

beforeEach(async () => { await clearData(); });

async function createLoan(name = 'Test borrower') {
  const borrower = await addBorrower({ name });
  const calculated = calculateLoan({ amount: '3000', rate: '10', months: 3, date: '2026-01-05', pricing: 'upfront', entryMode: 'repay', income: '', affordabilityPercent: 30 });
  const loan = await issueLoan({ borrowerId: borrower.id, issuedOn: '2026-01-05', pricing: 'upfront', entryMode: 'repay',
    inputAmount: 300000, rateBps: 1000, months: 3, courtesyDays: 5,
    face: calculated.face, charge: calculated.charge, cash: calculated.cash, total: calculated.total,
    schedule: calculated.schedule, affordabilityPercent: 30, income: null, overrideReason: '', terms: 'No late fees.', operator: 'Owner' }, `release:${borrower.id}`);
  return { borrower, loan };
}

describe('atomic IndexedDB ledger', () => {
  it('creates name-only borrowers starting at 001 and no seeded records', async () => {
    expect((await getSnapshot()).borrowers).toEqual([]);
    const first = await addBorrower({ name: '  Maria Cruz  ' });
    expect(first.displayId).toBe('001'); expect(first.name).toBe('Maria Cruz'); expect(first.income).toBeNull();
    expect((await addBorrower({ name: 'Juan' })).displayId).toBe('002');
    await expect(addBorrower({ name: ' ' })).rejects.toThrow(/full name/i);
  });

  it('assigns unique sequential release/payment IDs and keeps original loan terms', async () => {
    const { loan } = await createLoan();
    const snapshot = await getSnapshot();
    expect(loan.ref).toBe('OWM-LON-2026-000001'); expect(snapshot.entries[0].ref).toBe('OWM-DIS-2026-000001');
    await saveSettings({ defaultRateBps: 2500, defaultMonths: 2 });
    expect(await db.loans.get(loan.id)).toEqual(loan);
    const payment = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'one' });
    expect(payment.ref).toBe('OWM-PAY-2026-000001'); expect(payment.balanceAfter).toBe(250000);
  });

  it('double-submit commits one payment, including concurrent callers', async () => {
    const { loan } = await createLoan();
    const input = { loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'double' };
    const [a, b] = await Promise.all([postPayment(input), postPayment(input)]);
    expect(a.id).toBe(b.id);
    expect((await db.entries.toArray()).filter(e => e.kind === 'payment')).toHaveLength(1);
    expect(loanBalance(loan, await db.entries.toArray())).toBe(250000);
  });

  it('serializes concurrent tabs so different requests cannot overpay', async () => {
    const { loan } = await createLoan();
    const results = await Promise.allSettled([
      postPayment({ loanId: loan.id, amount: 200000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'a' }),
      postPayment({ loanId: loan.id, amount: 200000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'b' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(loanBalance(loan, await db.entries.toArray())).toBe(100000);
  });

  it('preserves original receipt on reversal and archive; only reverses once', async () => {
    const { borrower, loan } = await createLoan();
    const payment = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'original' });
    await expect(reversePayment(payment.id, '')).rejects.toThrow(/why/i);
    const reversal = await reversePayment(payment.id, 'Entered twice', 'Owner');
    expect((await reversePayment(payment.id, 'Entered twice')).id).toBe(reversal.id);
    expect(await db.entries.get(payment.id)).toEqual(payment);
    expect(loanBalance(loan, await db.entries.toArray())).toBe(300000);
    await archiveBorrower(borrower.id);
    expect((await db.borrowers.get(borrower.id))?.archived).toBe(true);
    expect(await db.entries.get(payment.id)).toEqual(payment);
    expect(await db.loans.count()).toBe(1);
  });

  it('rejects invalid dates, negatives, future receipts, overpayments and duplicate external references', async () => {
    const { loan } = await createLoan();
    const base = { loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'GCash', externalRef: 'REF-100', idempotencyKey: 'one' };
    await postPayment(base);
    await expect(postPayment({ ...base, idempotencyKey: 'two' })).rejects.toThrow(/reference already exists/);
    await postPayment({ ...base, idempotencyKey: 'two', allowDuplicateReference: true });
    await expect(postPayment({ ...base, amount: -1, idempotencyKey: 'negative' })).rejects.toThrow(/valid centavos/);
    await expect(postPayment({ ...base, amount: 500000, idempotencyKey: 'over' })).rejects.toThrow(/exceeds/);
    await expect(postPayment({ ...base, date: '2099-01-01', idempotencyKey: 'future' })).rejects.toThrow(/future/);
    await expect(postPayment({ ...base, date: '2026-02-30', idempotencyKey: 'invalid' })).rejects.toThrow(/valid calendar/);
  });

  it('refuses release snapshots that disagree with the finance engine', async () => {
    const { loan } = await createLoan();
    await expect(issueLoan({ ...loan, cash: 280000 }, 'bad-release')).rejects.toThrow(/figures changed/);
    expect(await db.loans.count()).toBe(1);
  });

  it('pins agreement and receipt identities even after later profile and business edits', async () => {
    const { borrower, loan } = await createLoan('Original borrower name');
    const payment = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'identity' });
    await updateBorrower(borrower.id, { name: 'Updated borrower name', address: 'Updated address' });
    await saveSettings({ businessName: 'Updated business' });
    expect((await db.loans.get(loan.id))?.borrowerSnapshot?.name).toBe('Original borrower name');
    expect((await db.entries.get(payment.id))?.borrowerSnapshot?.name).toBe('Original borrower name');
    expect((await db.entries.get(payment.id))?.businessSnapshot?.businessName).toBe('OweMe');
    const reversal = await reversePayment(payment.id, 'Correcting this receipt');
    expect(reversal.borrowerSnapshot).toEqual(payment.borrowerSnapshot);
    expect(reversal.businessSnapshot).toEqual(payment.businessSnapshot);
    await expect(inspectBackup(await exportBackup())).resolves.toBeDefined();
  });

  it('preserves receipt posting order independently from backdated payment dates', async () => {
    const { loan } = await createLoan();
    const first = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'later-date' });
    const backdated = await postPayment({ loanId: loan.id, amount: 100000, date: '2026-01-15', method: 'Cash', idempotencyKey: 'earlier-date' });
    expect(first.postedOrder).toBe(2); expect(first.balanceAfter).toBe(250000);
    expect(backdated.postedOrder).toBe(3); expect(backdated.balanceAfter).toBe(150000);
    const reversal = await reversePayment(first.id, 'Wrong payment amount');
    expect(reversal.postedOrder).toBe(4); expect(reversal.balanceAfter).toBe(200000);
    const verified = await inspectBackup(await exportBackup());
    expect(backupTotals(verified.data).outstanding).toBe(200000);
  });
});

describe('verified portable recovery', () => {
  it('round-trips loans, archive, reversals, attachment bytes and totals', async () => {
    const { borrower, loan } = await createLoan();
    const payment = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'p1' });
    await reversePayment(payment.id, 'Correcting wrong amount');
    await postPayment({ loanId: loan.id, amount: 100000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'p2' });
    const attachment = await addAttachment({ borrowerId: borrower.id, loanId: loan.id, name: 'signed.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0xLjQ=' });
    await archiveBorrower(borrower.id);
    const before = await getSnapshot();
    const backup = await inspectBackup(await exportBackup());
    expect(backup.counts.attachments).toBe(1);
    await clearData();
    await restoreBackup(backup, 'replace');
    const after = await getSnapshot();
    expect(backupTotals(after)).toEqual(backupTotals(before));
    expect(after.loans).toEqual(before.loans); expect(after.entries).toEqual(before.entries);
    expect(after.attachments[0]).toEqual(attachment); expect(after.borrowers[0].archived).toBe(true);
    expect((await addBorrower({ name: 'Next borrower' })).displayId).toBe('002');
    const next = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-03-05', method: 'Cash', idempotencyKey: 'p3' });
    expect(next.ref).toBe('OWM-PAY-2026-000003');
  });

  it('handles IDs beyond 999 without reuse after a restore', async () => {
    await addBorrower({ name: 'Existing' });
    await db.meta.put({ key: 'counter:borrower', value: 999 });
    const thousand = await addBorrower({ name: 'Thousand' });
    expect(thousand.displayId).toBe('1000');
    const backup = await inspectBackup(await exportBackup());
    await clearData(); await restoreBackup(backup, 'replace');
    expect((await addBorrower({ name: 'After' })).displayId).toBe('1001');
  });

  it('detects tampering and refuses missing releases even with a recalculated checksum', async () => {
    await createLoan();
    const text = await exportBackup();
    await expect(inspectBackup(text.replace('270000', '270001'))).rejects.toThrow(/checksum/);
    const payload = JSON.parse(text);
    delete payload.checksum;
    payload.data.entries = []; payload.counts.entries = 0;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(payload))))].map(n => n.toString(16).padStart(2, '0')).join('');
    await expect(inspectBackup(JSON.stringify({ ...payload, checksum: hash }))).rejects.toThrow(/Release record mismatch/);
    expect(await db.loans.count()).toBe(1);
  });

  it('safe-merges identical records and rejects independent reference collisions without mutation', async () => {
    await createLoan();
    const backup = await inspectBackup(await exportBackup());
    await restoreBackup(backup, 'merge');
    expect(await db.loans.count()).toBe(1);
    await clearData();
    await createLoan('Different borrower');
    const before = await getSnapshot();
    await expect(restoreBackup(backup, 'merge')).rejects.toThrow(/colliding|duplicate|Safe merge/);
    expect(await getSnapshot()).toEqual(before);
  });

  it('rejects a modified immutable transaction with matching UUID during merge', async () => {
    const { loan } = await createLoan();
    const payment = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'payment' });
    const backup = await inspectBackup(await exportBackup());
    await db.entries.update(payment.id, { notes: 'Different device changed this record' });
    await expect(restoreBackup(backup, 'merge')).rejects.toThrow(/conflicting transaction/);
    expect((await db.entries.get(payment.id))?.notes).toBe('Different device changed this record');
  });

  it('reconstructs high-water counters from more than 1000 imported borrower records', async () => {
    const template = await addBorrower({ name: 'Import template' });
    await db.borrowers.clear();
    await db.meta.delete('counter:borrower');
    await db.borrowers.bulkAdd(Array.from({ length: 1001 }, (_, index) => ({ ...template, id: crypto.randomUUID(), displayId: String(index + 1).padStart(3, '0'), name: `Imported borrower ${index + 1}` })));
    const backup = await inspectBackup(await exportBackup());
    expect(backup.counters['counter:borrower']).toBeUndefined();
    await clearData(); await restoreBackup(backup, 'replace');
    expect((await addBorrower({ name: 'Next borrower' })).displayId).toBe('1002');
  });

  it('atomically refuses reset and replacement when data changed after the recovery capture', async () => {
    await createLoan();
    const capture = await captureBackup();
    const backup = await inspectBackup(capture.text);
    await addBorrower({ name: 'New record after backup' });
    await expect(clearData(capture.version)).rejects.toThrow(/Records changed/);
    await expect(restoreBackup(backup, 'replace', capture.version)).rejects.toThrow(/Records changed/);
    expect(await db.borrowers.count()).toBe(2);
    expect(await db.loans.count()).toBe(1);
  });

  it('rejects incorrect historic receipt balances even if the checksum is recalculated', async () => {
    const { loan } = await createLoan();
    const payment = await postPayment({ loanId: loan.id, amount: 50000, date: '2026-02-05', method: 'Cash', idempotencyKey: 'bad-balance' });
    const payload = JSON.parse(await exportBackup());
    delete payload.checksum;
    payload.data.entries.find((entry: { id: string }) => entry.id === payment.id).balanceAfter = 0;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(payload))))].map(n => n.toString(16).padStart(2, '0')).join('');
    await expect(inspectBackup(JSON.stringify({ ...payload, checksum: hash }))).rejects.toThrow(/Receipt balance/);
  });
});
