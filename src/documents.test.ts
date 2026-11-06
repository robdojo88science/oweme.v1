import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { jsPDF } from 'jspdf';
import type { Borrower, DataSnapshot, LedgerEntry, Loan, Settings } from './domain';
import { calculateLoan } from './finance';
import { agreementPdf, receiptPdf, reportPdf, statementPdf } from './documents';

function pdfContent(pdf: jsPDF) {
  const raw = Buffer.from(pdf.output('arraybuffer')).toString('latin1');
  const parts = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return match[1]; }
  });
  return parts.flatMap(part => [...part.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(match => match[1].replace(/\\([()\\])/g, '$1'))).join(' ');
}
const settings: Settings = { businessName: 'Test notebook', ownerName: 'Owner', address: '', contact: '', defaultRateBps: 1000, defaultMonths: 3, maxMonths: 12, affordabilityPercent: 30, courtesyDays: 5, terms: 'Reviewed custom terms.', lastMethod: 'Cash', driveClientId: '', driveFileId: '', driveRevision: '', lastBackupAt: '', lastExportAt: '', email: '' };
const borrower: Borrower = { id: 'borrower-test', displayId: '001', name: 'Example Person', phone: '', address: '', income: null, notes: '', createdAt: '2026-11-05T01:00:00Z', archived: false };
function loanFixture(months = 3): Loan {
  const calculation = calculateLoan({ amount: '3000', rate: '10', months, date: '2026-11-05', pricing: 'upfront', entryMode: 'repay', income: '', affordabilityPercent: 30 });
  return { id: 'loan-test', ref: 'OWM-LON-2026-000001', borrowerId: borrower.id, createdAt: borrower.createdAt, issuedOn: '2026-11-05', pricing: 'upfront', entryMode: 'repay', inputAmount: calculation.inputAmount, rateBps: calculation.rateBps, months, courtesyDays: 5, face: calculation.face, charge: calculation.charge, cash: calculation.cash, total: calculation.total, schedule: calculation.schedule, affordabilityPercent: 30, income: null, overrideReason: '', terms: settings.terms, operator: settings.ownerName };
}
const loan = loanFixture();
const payment: LedgerEntry = { id: 'payment-test', ref: 'OWM-PAY-2026-000001', kind: 'payment', loanId: loan.id, borrowerId: borrower.id, amount: 50000, date: '2026-11-06', createdAt: '2026-11-06T02:00:00Z', method: 'GCash', institution: 'GCash', externalRef: 'EXAMPLE-REF', operator: 'Owner', notes: '', idempotencyKey: 'test-key', balanceAfter: 250000 };
const snapshot: DataSnapshot = { borrowers: [borrower], loans: [loan], entries: [payment], attachments: [], audits: [], drafts: [], settings };

describe('offline PDF financial content', () => {
  it('prints the exact reviewed cash, total, charge and all contractual dates', () => {
    const pdf = agreementPdf(borrower, loan, settings);
    const text = pdfContent(pdf);
    expect(text).toContain('PHP 2,700.00');
    expect(text).toContain('PHP 3,000.00');
    expect(text).toContain('PHP 300.00');
    expect(text).toContain('10% of face amount');
    expect(text).toContain('Dec'); expect(text).toContain('Jan'); expect(text).toContain('Feb');
    expect(text).toContain('Reviewed custom terms.');
    expect(text).toContain('Signature and date');
    expect(text).toContain('not a monthly rate or an APR');
    expect(text).toContain('due dates above do not move');
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain('NaN');
  });
  it('paginates long schedules with repeated headers and numbered footers', () => {
    const pdf = agreementPdf(borrower, loanFixture(120), settings);
    const text = pdfContent(pdf);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(3);
    expect(text).toContain('120');
    expect(text).toContain(`1 / ${pdf.getNumberOfPages()}`);
    expect(text).toContain(`${pdf.getNumberOfPages()} / ${pdf.getNumberOfPages()}`);
  });
  it('keeps issued agreement identity and terms after profiles or business settings change', () => {
    const issued: Loan = { ...loan, operator: '', terms: '', borrowerSnapshot: { name: 'Name at release', displayId: '001', phone: 'Original phone', address: 'Original address' }, businessSnapshot: { businessName: 'Original notebook', ownerName: 'Original owner', address: 'Original business address', contact: 'Original contact' } };
    const renamed: Borrower = { ...borrower, name: 'Renamed profile', displayId: '999', phone: 'Changed phone', address: 'Changed address' };
    const changed: Settings = { ...settings, businessName: 'Changed business', ownerName: 'Changed owner', address: 'Changed business address', contact: 'Changed contact', terms: 'New default terms never signed' };
    const text = pdfContent(agreementPdf(renamed, issued, changed));
    expect(text).toContain('Name at release / 001');
    expect(text).toContain('Original notebook'); expect(text).toContain('Original owner');
    expect(text).toContain('Original address'); expect(text).toContain('Original phone');
    expect(text).not.toContain('Renamed profile'); expect(text).not.toContain('Changed business');
    expect(text).not.toContain('New default terms never signed');
    expect(text).toContain('PHP 2,700.00'); expect(text).toContain('PHP 3,000.00');
  });
  it('prefers receipt-time identity over both the loan and current profile', () => {
    const issued: Loan = { ...loan, borrowerSnapshot: { name: 'Name at release', displayId: '001', phone: '', address: '' }, businessSnapshot: { businessName: 'Business at release', ownerName: '', address: '', contact: '' } };
    const received: LedgerEntry = { ...payment, borrowerSnapshot: { name: 'Name at payment', displayId: '001', phone: '', address: '' }, businessSnapshot: { businessName: 'Business at payment', ownerName: '', address: '', contact: '' } };
    const text = pdfContent(receiptPdf({ ...borrower, name: 'Renamed later' }, issued, received, { ...settings, businessName: 'Business changed later' }));
    expect(text).toContain('Name at payment / 001'); expect(text).toContain('Business at payment');
    expect(text).not.toContain('Name at release'); expect(text).not.toContain('Renamed later');
    expect(text).not.toContain('Business changed later'); expect(text).not.toContain('Business at release');
    expect(text).toContain('PHP 2,500.00');
  });
  it('preserves the receipt balance snapshot and optional bank reference', () => {
    const text = pdfContent(receiptPdf(borrower, loan, payment, settings));
    expect(text).toContain('PHP 500.00'); expect(text).toContain('PHP 2,500.00');
    expect(text).toContain(payment.ref); expect(text).toContain('EXAMPLE-REF');
    expect(text).toContain('GCash'); expect(text).toContain('immutable balance');
    const compact = receiptPdf(borrower, loan, payment, settings, true);
    expect(compact.internal.pageSize.getWidth()).toBeCloseTo(80, 0);
    expect(pdfContent(compact)).toContain('2,500.00');
  });
  it('marks a regenerated reversed receipt while preserving original money and identity', () => {
    const text = pdfContent(receiptPdf(borrower, loan, payment, settings, false, true));
    expect(text).toContain('Reversed payment receipt - history'); expect(text).toContain('not an active collection');
    expect(text).toContain(payment.ref); expect(text).toContain('Example Person / 001');
    expect(text).toContain('PHP 500.00'); expect(text).toContain('PHP 2,500.00');
  });
  it('filters statements without changing the current all-history balance', () => {
    const text = pdfContent(statementPdf({ ...borrower, archived: true }, snapshot, '2026-12-01', '2026-12-31'));
    expect(text).toContain('archived'); expect(text).toContain('PHP 2,500.00');
    expect(text).toContain('No transactions in this date range');
    expect(text).not.toContain(payment.ref);
    expect(text).toContain('Contractual schedule');
  });
  it('reports cash collection separately from profit and includes reversed collections', () => {
    const reversal: LedgerEntry = { ...payment, id: 'reversal-test', ref: 'OWM-REV-2026-000001', kind: 'reversal', reversesId: payment.id, date: '2026-11-07', createdAt: '2026-11-07T03:00:00Z', idempotencyKey: 'reverse-test', balanceAfter: loan.total };
    const text = pdfContent(reportPdf({ ...snapshot, entries: [payment, reversal] }, '2026-11-01', '2026-11-30'));
    expect(text).toContain('Collections after reversals'); expect(text).toContain('PHP 0.00');
    expect(text).toContain('Payment reversals'); expect(text).toContain('PHP 500.00');
    expect(text).toContain('not profit'); expect(text).not.toContain('NaN');
  });
});
