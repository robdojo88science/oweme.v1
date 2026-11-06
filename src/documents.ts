import { jsPDF } from 'jspdf';
import type { Borrower, DataSnapshot, LedgerEntry, Loan, Settings } from './domain';
import { installmentBalances, loanBalance, todayManila } from './finance';

// The standard PDF font is bundled in jsPDF. PHP avoids an unsupported peso glyph.
const money = (centavos: number) => `PHP ${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (value: string) => value.replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/₱/g, 'PHP ');
const inRange = (date: string, from = '', to = '') => (!from || date.slice(0, 10) >= from) && (!to || date.slice(0, 10) <= to);
const signedCollection = (entry: LedgerEntry) => entry.kind === 'payment' ? entry.amount : entry.kind === 'reversal' ? -entry.amount : 0;
const allocatedCharge = (amount: number, charge: number, total: number) => {
  if (!amount || total <= 0) return 0;
  const numerator = BigInt(Math.abs(amount)) * BigInt(charge);
  const denominator = BigInt(total);
  return Math.sign(amount) * Number((numerator * 2n + denominator) / (denominator * 2n));
};
const labelDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(`${date}T12:00:00+08:00`)) : date;

class Paper {
  doc: jsPDF;
  y = 0;
  width: number;
  height: number;
  margin: number;
  content: number;
  compact: boolean;
  constructor(private title: string, private settings: Settings, compact = false, private reference = '') {
    this.compact = compact;
    this.doc = new jsPDF({ unit: 'mm', format: compact ? [80, 210] : 'a4', compress: true });
    this.width = this.doc.internal.pageSize.getWidth();
    this.height = this.doc.internal.pageSize.getHeight();
    this.margin = compact ? 7 : 18;
    this.content = this.width - this.margin * 2;
    this.doc.setProperties({ title, author: settings.businessName || 'OweMe', creator: 'OweMe offline lending notebook', subject: 'Private financial record' });
    this.header();
  }
  header() {
    const d = this.doc;
    d.setFillColor(107, 78, 255);
    d.rect(0, 0, this.width, 3, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(this.compact ? 15 : 23); d.setTextColor(42, 28, 90);
    const business = d.splitTextToSize(clean(this.settings.businessName || 'OweMe'), this.content);
    d.text(business, this.margin, this.compact ? 14 : 19);
    this.y = (this.compact ? 14 : 19) + business.length * (this.compact ? 6 : 9);
    this.text([this.settings.address, this.settings.contact].filter(Boolean).join(' | '), 8, [90, 91, 106]);
    this.y += 3;
    this.text(this.title, this.compact ? 12 : 16, [23, 25, 35], true);
    if (this.reference) this.text(this.reference, 8, [90, 91, 106]);
    this.y += 4;
  }
  room(height: number) {
    if (this.y + height > this.height - 18) { this.doc.addPage(); this.header(); }
  }
  text(value: string, size = 9, color: [number, number, number] = [65, 68, 84], bold = false) {
    if (!value) return;
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal'); this.doc.setFontSize(size); this.doc.setTextColor(...color);
    const lines: string[] = this.doc.splitTextToSize(clean(value), this.content);
    const lineHeight = size * 0.43;
    for (const line of lines) { this.room(lineHeight + 1); this.doc.setFont('helvetica', bold ? 'bold' : 'normal'); this.doc.setFontSize(size); this.doc.setTextColor(...color); this.doc.text(line, this.margin, this.y); this.y += lineHeight; }
    this.y += 1.4;
  }
  section(value: string) { this.room(12); this.y += 4; this.text(value, 10, [77, 54, 164], true); this.y += 1; }
  pair(label: string, value: string, emphasis = false) {
    if (this.compact) { this.text(label, 8); this.text(value, emphasis ? 15 : 10, [23, 25, 35], true); this.y += 1; return; }
    const valueLines: string[] = this.doc.splitTextToSize(clean(value), this.content * 0.53);
    const labelLines: string[] = this.doc.splitTextToSize(clean(label), this.content * 0.43);
    const height = Math.max(valueLines.length, labelLines.length) * (emphasis ? 5 : 4) + 4;
    this.room(height);
    if (emphasis) { this.doc.setFillColor(243, 240, 255); this.doc.roundedRect(this.margin - 2, this.y - 5, this.content + 4, height + 1, 2, 2, 'F'); }
    this.doc.setFont('helvetica', 'normal'); this.doc.setTextColor(77, 80, 95); this.doc.setFontSize(9);
    this.doc.text(labelLines, this.margin, this.y);
    this.doc.setFont('helvetica', 'bold'); this.doc.setTextColor(23, 25, 35); this.doc.setFontSize(emphasis ? 13 : 10);
    this.doc.text(valueLines, this.margin + this.content * 0.47, this.y);
    this.y += height;
  }
  table(headers: string[], rows: string[][], fractions: number[]) {
    const widths = fractions.map(x => x * this.content);
    const drawRow = (row: string[], head = false) => {
      const cells = row.map((value, i) => this.doc.splitTextToSize(clean(value), widths[i] - 4) as string[]);
      const rowHeight = Math.max(...cells.map(x => x.length)) * 4 + 5;
      if (this.y + rowHeight > this.height - 19) { this.doc.addPage(); this.header(); if (!head) drawRow(headers, true); }
      if (head) { this.doc.setFillColor(239, 235, 252); this.doc.rect(this.margin, this.y - 4, this.content, rowHeight, 'F'); }
      this.doc.setFont('helvetica', head ? 'bold' : 'normal'); this.doc.setFontSize(8); this.doc.setTextColor(head ? 62 : 66, head ? 43 : 69, head ? 128 : 83);
      let x = this.margin;
      cells.forEach((lines, i) => { this.doc.text(lines, x + 2, this.y); x += widths[i]; });
      this.y += rowHeight;
      this.doc.setDrawColor(230, 230, 238); this.doc.line(this.margin, this.y - 4, this.margin + this.content, this.y - 4);
    };
    drawRow(headers, true); rows.forEach(row => drawRow(row)); this.y += 3;
  }
  signature(label: string) { const lines: string[] = this.doc.splitTextToSize(clean(label), this.content); this.room(21 + lines.length * 3.44); this.y += 13; this.doc.setDrawColor(115, 115, 130); this.doc.line(this.margin, this.y, this.margin + Math.min(105, this.content), this.y); this.y += 5; this.text(label, 8); }
  finish() {
    const pages = this.doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      this.doc.setPage(i); this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7); this.doc.setTextColor(112, 112, 126);
      this.doc.text(`Private record | OweMe | ${i} / ${pages}`, this.margin, this.height - 8);
    }
    return this.doc;
  }
}

export function agreementPdf(currentBorrower: Borrower, loan: Loan, currentSettings: Settings): jsPDF {
  // Issued identity is part of the record, just like its money and schedule.
  const borrower = { ...currentBorrower, ...loan.borrowerSnapshot };
  const settings = { ...currentSettings, ...loan.businessSnapshot };
  const p = new Paper('Loan agreement & cash release acknowledgement', settings, false, `${loan.ref || 'UNISSUED DRAFT'} | Borrower ${borrower.displayId}`);
  p.text('Read every amount and due date before signing. Keep a copy of this agreement.', 9);
  p.pair('Borrower / notebook ID', `${borrower.name} / ${borrower.displayId}`);
  if (borrower.address) p.pair('Borrower address', borrower.address);
  if (borrower.phone) p.pair('Borrower contact', borrower.phone);
  p.pair('Loan reference', loan.ref || 'UNISSUED DRAFT - no funds recorded');
  p.pair('Release date (Asia/Manila)', labelDate(loan.issuedOn));
  p.section('Exact money agreed');
  p.pair('Cash the borrower receives', money(loan.cash), true);
  p.pair('Total the borrower must repay', money(loan.total), true);
  p.pair('Face amount / obligation', money(loan.face));
  const pricing = loan.pricing === 'upfront' ? `One-time upfront deduction (${loan.rateBps / 100}% of face amount)` : loan.pricing === 'addon' ? `One-time charge added (${loan.rateBps / 100}% of cash given)` : 'Zero-charge loan';
  p.pair(pricing, money(loan.charge));
  p.pair('Term', `${loan.months} calendar month${loan.months === 1 ? '' : 's'}; monthly installments`);
  p.pair('Late fees', 'PHP 0.00 - no automatic late fees');
  p.text(loan.pricing === 'upfront' ? `The charge is deducted once from face value. The borrower receives ${money(loan.cash)} and repays ${money(loan.total)}. The stated percentage is not a monthly rate or an APR.` : loan.pricing === 'addon' ? `The one-time charge is added to cash given. The borrower receives ${money(loan.cash)} and repays ${money(loan.total)}. The percentage is not a monthly rate or an APR.` : 'No finance charge is included. Cash given equals the total repayment obligation.');
  p.text(`Charge relative to cash received over the entire term: ${loan.cash > 0 ? (loan.charge / loan.cash * 100).toFixed(2) : '0.00'}%. This is a full-term cost comparison, not an annualized rate.`);
  p.section('Every contractual installment');
  p.table(['Payment', 'Due on (Asia/Manila)', 'Amount due'], loan.schedule.map(row => [`${row.index}`, labelDate(row.dueDate), money(row.amount)]), [0.18, 0.47, 0.35]);
  p.text(`Courtesy reminder window: ${loan.courtesyDays} calendar days after each due date. This is an internal servicing window only. Contractual due dates above do not move. A payment after its due date is late even within this window. This window adds no charge.`);
  p.section('Agreement and acknowledgement');
  p.text('Payments apply to the oldest unpaid scheduled installment. Partial payments reduce the amount owed; they do not change contractual dates. Extra money above the remaining balance must be handled separately and is not accepted silently. Corrections preserve the original transaction and require a recorded reversal.');
  p.text(loan.terms || 'Any change to an issued obligation requires a separately signed written agreement. No undisclosed fee is payable.');
  p.text('The borrower acknowledges the amounts, schedule and disclosed charges above and, when funds are actually handed over, acknowledges receiving the cash shown. Signing a draft alone does not record cash release in OweMe.');
  p.text('This customizable form is not a guarantee of legal enforceability or regulatory compliance. The owner is responsible for appropriate local review, lawful lending activity, privacy notice and retention practices.', 8);
  p.signature(`Borrower: ${borrower.name} | Signature and date`);
  p.signature(`Owner / operator: ${loan.operator || settings.ownerName || '________________'} | Signature and date`);
  p.signature('Witness (optional): Printed name, signature and date');
  return p.finish();
}

export function receiptPdf(currentBorrower: Borrower, loan: Loan, entry: LedgerEntry, currentSettings: Settings, compact = false): jsPDF {
  const borrower = { ...currentBorrower, ...(entry.borrowerSnapshot || loan.borrowerSnapshot) };
  const settings = { ...currentSettings, ...(entry.businessSnapshot || loan.businessSnapshot) };
  const title = entry.kind === 'release' ? 'Cash release acknowledgement' : entry.kind === 'reversal' ? 'Payment reversal record' : 'Payment receipt';
  const p = new Paper(title, settings, compact, entry.ref);
  p.pair('Receipt / transaction reference', entry.ref);
  p.pair('Borrower / notebook ID', `${borrower.name} / ${borrower.displayId}`);
  p.pair('Loan reference', loan.ref);
  p.pair('Transaction date (Asia/Manila)', labelDate(entry.date));
  p.pair('Recorded at (Asia/Manila)', new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(entry.createdAt)));
  p.pair(entry.kind === 'release' ? 'Cash given to borrower' : entry.kind === 'reversal' ? 'Payment reversed' : 'Payment received', money(entry.amount), true);
  p.pair('Remaining balance after this entry', money(entry.balanceAfter), true);
  p.pair('Payment method', entry.method || 'Cash');
  if (entry.institution) p.pair('Bank / e-wallet institution', entry.institution);
  if (entry.externalRef) p.pair('Bank / e-wallet reference', entry.externalRef);
  if (entry.reversesId) p.pair('Reverses original entry UUID', entry.reversesId);
  if (entry.notes) { p.section(entry.kind === 'reversal' ? 'Reason for correction' : 'Notes'); p.text(entry.notes); }
  p.pair('Recorded by', entry.operator || settings.ownerName || 'Not entered');
  p.text('Balance shown is the immutable balance immediately after this entry was recorded. Later payments or corrections may change the current balance.', 8);
  p.signature('Owner / collector signature');
  if (entry.kind === 'release') p.signature('Borrower acknowledgement signature');
  return p.finish();
}

export function statementPdf(borrower: Borrower, snapshot: DataSnapshot, from = '', to = ''): jsPDF {
  const p = new Paper('Borrower account statement', snapshot.settings, false, `${borrower.name} | Borrower ${borrower.displayId}`);
  const loans = snapshot.loans.filter(loan => loan.borrowerId === borrower.id);
  const entries = snapshot.entries.filter(entry => entry.borrowerId === borrower.id && inRange(entry.date, from, to)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  p.pair('Borrower / notebook ID', `${borrower.name} / ${borrower.displayId}${borrower.archived ? ' (archived)' : ''}`);
  p.pair('Transactions included', `${from ? labelDate(from) : 'Beginning of history'} through ${to ? labelDate(to) : 'Today'}`);
  p.pair('Current remaining balance (all history)', money(loans.reduce((sum, loan) => sum + loanBalance(loan, snapshot.entries), 0)), true);
  p.pair('Cash released in selected range', money(entries.filter(e => e.kind === 'release').reduce((sum, entry) => sum + entry.amount, 0)));
  p.pair('Collections less reversals in selected range', money(entries.reduce((sum, entry) => sum + signedCollection(entry), 0)));
  p.text('The current balance uses all saved entries. The transaction table below follows the selected date range. Historical receipt balances are snapshots at recording time, including any backdated entries.', 8);
  p.section('Transaction history');
  if (entries.length) p.table(['Date', 'Transaction / loan', 'Money movement', 'Balance after entry'], entries.map(entry => [labelDate(entry.date), `${entry.ref}\n${loans.find(loan => loan.id === entry.loanId)?.ref || entry.loanId}`, `${entry.kind === 'release' ? 'Released' : entry.kind === 'payment' ? 'Received' : 'Reversed'}\n${money(entry.amount)}`, money(entry.balanceAfter)]), [0.18, 0.38, 0.23, 0.21]);
  else p.text('No transactions in this date range.');
  for (const loan of loans) {
    p.section(`Contractual schedule - ${loan.ref}`);
    p.pair('Cash released / total repayable', `${money(loan.cash)} / ${money(loan.total)}`);
    p.table(['Payment', 'Contractual due date', 'Scheduled', 'Paid / remaining'], installmentBalances(loan, snapshot.entries).map(row => [`${row.index}`, labelDate(row.dueDate), money(row.amount), `${money(row.paid)} / ${money(row.remaining)}`]), [0.12, 0.28, 0.22, 0.38]);
  }
  return p.finish();
}

export function reportPdf(snapshot: DataSnapshot, from = '', to = ''): jsPDF {
  const p = new Paper('Collections & cash movement report', snapshot.settings, false, `${from || 'All history'} through ${to || todayManila()}`);
  const asOf = to || todayManila();
  const entries = snapshot.entries.filter(entry => inRange(entry.date, from, to));
  const released = entries.filter(entry => entry.kind === 'release').reduce((sum, entry) => sum + entry.amount, 0);
  const grossPayments = entries.filter(entry => entry.kind === 'payment').reduce((sum, entry) => sum + entry.amount, 0);
  const reversals = entries.filter(entry => entry.kind === 'reversal').reduce((sum, entry) => sum + entry.amount, 0);
  const historical = snapshot.entries.filter(entry => entry.date.slice(0, 10) <= asOf);
  const loans = snapshot.loans.filter(loan => loan.issuedOn <= asOf);
  const outstanding = loans.reduce((sum, loan) => sum + loanBalance(loan, historical), 0);
  const overdue = loans.reduce((sum, loan) => sum + installmentBalances(loan, historical).filter(row => row.dueDate < asOf).reduce((n, row) => n + row.remaining, 0), 0);
  const chargesAllocated = entries.reduce((sum, entry) => {
    const loan = snapshot.loans.find(item => item.id === entry.loanId);
    return sum + (loan ? allocatedCharge(signedCollection(entry), loan.charge, loan.total) : 0);
  }, 0);
  p.pair('Date range', `${from ? labelDate(from) : 'Beginning of history'} through ${to ? labelDate(to) : 'Today'}`);
  p.pair('Collections after reversals', money(grossPayments - reversals), true);
  p.pair('Actual cash released', money(released));
  p.pair('Net cash movement', money(grossPayments - reversals - released));
  p.pair('Outstanding obligations at range end', money(outstanding));
  p.pair('Overdue obligations at range end', money(overdue));
  p.section('Details');
  p.pair('Gross payments', money(grossPayments));
  p.pair('Payment reversals', money(reversals));
  p.pair('Finance-charge portion of collections', money(chargesAllocated));
  p.text('Finance-charge portion is an illustrative proportional allocation: each collection (less reversed payments) x the original charge / original total repayable, rounded per transaction. It is a cash-collection allocation, not an assertion of accounting income, tax profit or regulatory compliance. Gross collections include recovery of cash lent; net cash movement is not profit.');
  p.section('Collection channels');
  const methods = Array.from(new Set(entries.filter(e => e.kind !== 'release').map(e => e.method || 'Cash'))).sort();
  if (methods.length) p.table(['Method', 'Collections less reversals'], methods.map(method => [method, money(entries.filter(entry => (entry.method || 'Cash') === method).reduce((sum, entry) => sum + signedCollection(entry), 0))]), [0.55, 0.45]);
  else p.text('No collections in this date range.');
  p.section(`Aging of unpaid installments as of ${labelDate(asOf)}`);
  const buckets = [0, 0, 0, 0, 0];
  for (const loan of loans) for (const row of installmentBalances(loan, historical)) {
    const lateDays = Math.floor((Date.parse(`${asOf}T12:00:00+08:00`) - Date.parse(`${row.dueDate}T12:00:00+08:00`)) / 86_400_000);
    const index = lateDays <= 0 ? 0 : lateDays <= 30 ? 1 : lateDays <= 60 ? 2 : lateDays <= 90 ? 3 : 4;
    buckets[index] += row.remaining;
  }
  p.table(['Age', 'Unpaid obligation'], ['Not past due', '1-30 days late', '31-60 days late', '61-90 days late', '91+ days late'].map((label, i) => [label, money(buckets[i])]), [0.55, 0.45]);
  p.text('Archived borrowers remain included. Courtesy periods do not move due dates or reduce overdue totals. This report uses payment dates for the selected range and original contractual schedules for aging.');
  return p.finish();
}

export function downloadCsv(snapshot: DataSnapshot, from = '', to = ''): void {
  // Prefix spreadsheet formula-like values to prevent CSV formula injection.
  const cell = (value: string | number) => `"${String(value).replace(/^[=+@\t\r-]/, "'$&").replace(/"/g, '""')}"`;
  const rows: (string | number)[][] = [['Transaction ID', 'UUID', 'Date (Asia/Manila)', 'Type', 'Borrower ID', 'Borrower', 'Loan', 'Cash amount PHP', 'Balance after entry PHP', 'Method', 'Institution', 'External reference', 'Operator', 'Notes']];
  const entries = snapshot.entries.filter(entry => inRange(entry.date, from, to)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const entry of entries) {
    const borrower = snapshot.borrowers.find(b => b.id === entry.borrowerId);
    rows.push([entry.ref, entry.id, entry.date, entry.kind, borrower?.displayId || '', borrower?.name || '', snapshot.loans.find(l => l.id === entry.loanId)?.ref || entry.loanId, (entry.amount / 100).toFixed(2), (entry.balanceAfter / 100).toFixed(2), entry.method, entry.institution, entry.externalRef, entry.operator, entry.notes]);
  }
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `oweme-transactions-${from || 'all'}-${to || todayManila()}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
