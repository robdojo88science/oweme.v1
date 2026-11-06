import Dexie, { type Table } from 'dexie';
import type { Attachment, Audit, Borrower, BorrowerIdentitySnapshot, BusinessIdentitySnapshot, DataSnapshot, Draft, LedgerEntry, Loan, Settings } from './domain';
import { calculateLoan, loanBalance, todayManila } from './finance';

interface Meta { key: string; value: unknown }
interface SettingsRow extends Settings { key: string }

export class OweMeDatabase extends Dexie {
  borrowers!: Table<Borrower, string>;
  loans!: Table<Loan, string>;
  entries!: Table<LedgerEntry, string>;
  attachments!: Table<Attachment, string>;
  audits!: Table<Audit, string>;
  drafts!: Table<Draft, string>;
  settings!: Table<SettingsRow, string>;
  meta!: Table<Meta, string>;
  constructor(name = 'OweMe') {
    super(name);
    this.version(1).stores({
      borrowers: 'id, &displayId, name, archived, createdAt',
      loans: 'id, &ref, borrowerId, issuedOn, createdAt',
      entries: 'id, &ref, &idempotencyKey, loanId, borrowerId, date, kind, externalRef, reversesId',
      attachments: 'id, borrowerId, loanId, createdAt',
      audits: 'id, at, entityId, action', drafts: 'id, borrowerId, updatedAt',
      settings: 'key', meta: 'key',
    });
  }
}

export const db = new OweMeDatabase();
export const defaultSettings: Settings = {
  businessName: 'OweMe', ownerName: '', address: '', contact: '',
  defaultRateBps: 1000, defaultMonths: 3, maxMonths: 3,
  affordabilityPercent: 30, courtesyDays: 5,
  terms: 'Payments are due on the dates listed. The finance charge is charged once for the entire term. No late fees apply. The courtesy period is for internal reminders only and does not change the agreed due date. Keep your receipt. Any change to obligations requires a separate signed agreement.',
  lastMethod: 'Cash', driveClientId: '', driveFileId: '', driveRevision: '',
  lastBackupAt: '', lastExportAt: '', email: '',
};

export const dataChanges = new EventTarget();
const changeChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('oweme-notebook-changes') : null;
changeChannel?.addEventListener('message', event => {
  if (event.data === 'reset') dataChanges.dispatchEvent(new Event('reset'));
  dataChanges.dispatchEvent(new Event('change'));
});
const notify = (reset = false) => {
  if (reset) dataChanges.dispatchEvent(new Event('reset'));
  dataChanges.dispatchEvent(new Event('change'));
  changeChannel?.postMessage(reset ? 'reset' : 'change');
};
const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
const allTables = () => [db.borrowers, db.loans, db.entries, db.attachments, db.audits, db.drafts, db.settings, db.meta];

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('settings');
  if (!row) return { ...defaultSettings };
  const settings = { ...row };
  Reflect.deleteProperty(settings, 'key');
  return { ...defaultSettings, ...settings };
}

export async function getSnapshot(): Promise<DataSnapshot> {
  return db.transaction('r', allTables(), async () => {
    const [borrowers, loans, entries, attachments, audits, drafts, settings] = await Promise.all([
      db.borrowers.toArray(), db.loans.toArray(), db.entries.toArray(), db.attachments.toArray(),
      db.audits.toArray(), db.drafts.toArray(), getSettings(),
    ]);
    return { borrowers, loans, entries, attachments, audits, drafts, settings };
  });
}

export async function addAudit(action: string, entityId: string, detail: string, operator = '') {
  await db.audits.add({ id: uuid(), at: now(), action, entityId, detail, operator });
}

async function changed() {
  const row = await db.meta.get('changeVersion');
  await db.meta.put({ key: 'changeVersion', value: Number(row?.value || 0) + 1 });
}

export async function getChangeVersion() { return Number((await db.meta.get('changeVersion'))?.value || 0); }
export async function getDatasetGeneration() { return String((await db.meta.get('datasetGeneration'))?.value || 'initial'); }
export async function getCounterSnapshot(): Promise<Record<string, number>> {
  const rows = await db.meta.toArray();
  return Object.fromEntries(rows.filter(r => r.key.startsWith('counter:')).map(r => [r.key, Number(r.value)]));
}

async function nextCounter(name: string) {
  const key = `counter:${name}`;
  const row = await db.meta.get(key);
  const next = Number(row?.value || 0) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('The identifier counter exceeded its safe limit. Nothing was recorded.');
  await db.meta.put({ key, value: next });
  return next;
}

async function nextRef(prefix: string, date: string) {
  const year = date.slice(0, 4);
  return `OWM-${prefix}-${year}-${String(await nextCounter(`${prefix}:${year}`)).padStart(6, '0')}`;
}

function money(value: number, label = 'Amount') {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000) throw new Error(`${label} must be valid centavos within the supported limit.`);
}
function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid calendar date.');
}

export async function addBorrower(input: { name: string; phone?: string; address?: string; income?: number | null; notes?: string }): Promise<Borrower> {
  const name = input.name.trim();
  if (!name) throw new Error('Enter the borrower’s full name.');
  if (name.length > 200) throw new Error('Use a name of 200 characters or fewer.');
  if (input.income != null) money(input.income, 'Income');
  const borrower = await db.transaction('rw', allTables(), async () => {
    const record: Borrower = { id: uuid(), displayId: String(await nextCounter('borrower')).padStart(3, '0'), name,
      phone: input.phone?.trim() || '', address: input.address?.trim() || '', income: input.income ?? null,
      notes: input.notes?.trim() || '', createdAt: now(), archived: false };
    await db.borrowers.add(record);
    await addAudit('Borrower added', record.id, record.name);
    await changed();
    return record;
  });
  notify();
  return borrower;
}

export async function updateBorrower(id: string, patch: Partial<Pick<Borrower, 'name' | 'phone' | 'address' | 'income' | 'notes'>>) {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Full name is required.');
  if (patch.income != null) money(patch.income, 'Income');
  await db.transaction('rw', allTables(), async () => {
    if (!await db.borrowers.get(id)) throw new Error('Borrower not found.');
    await db.borrowers.update(id, patch);
    await addAudit('Borrower updated', id, 'Profile details updated; issued loan terms were preserved.');
    await changed();
  });
  notify();
}

export async function archiveBorrower(id: string, archived = true) {
  await db.transaction('rw', allTables(), async () => {
    const borrower = await db.borrowers.get(id);
    if (!borrower) throw new Error('Borrower not found.');
    if (borrower.archived === archived) return;
    await db.borrowers.update(id, { archived });
    await addAudit(archived ? 'Borrower archived' : 'Borrower restored', id, `${borrower.name}; all financial history retained.`);
    await changed();
  });
  notify();
}

const inputMoney = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const borrowerIdentity = (borrower: Borrower): BorrowerIdentitySnapshot => ({ name: borrower.name, displayId: borrower.displayId, phone: borrower.phone, address: borrower.address });
const businessIdentity = (settings: Settings): BusinessIdentitySnapshot => ({ businessName: settings.businessName, ownerName: settings.ownerName, address: settings.address, contact: settings.contact });

export async function issueLoan(input: Omit<Loan, 'id' | 'ref' | 'createdAt'>, idempotencyKey: string): Promise<Loan> {
  input = structuredClone(input);
  if (!idempotencyKey) throw new Error('A unique release request is required.');
  validDate(input.issuedOn);
  if (input.issuedOn > todayManila()) throw new Error('Cash released cannot be dated in the future. Save a draft until the actual release.');
  const result = await db.transaction('rw', allTables(), async () => {
    const previous = await db.entries.where('idempotencyKey').equals(idempotencyKey).first();
    if (previous) {
      if (previous.kind !== 'release' || previous.borrowerId !== input.borrowerId || previous.amount !== input.cash) throw new Error('This release request was already used with different details. Reopen the loan to verify it.');
      const loan = await db.loans.get(previous.loanId);
      if (!loan) throw new Error('Previous release has no matching loan.');
      return loan;
    }
    const borrower = await db.borrowers.get(input.borrowerId);
    if (!borrower || borrower.archived) throw new Error('Select an active borrower before releasing funds.');
    const preview = calculateLoan({ amount: inputMoney(input.inputAmount), rate: String(input.rateBps / 100), months: input.months,
      date: input.issuedOn, pricing: input.pricing, entryMode: input.entryMode,
      income: input.income === null ? '' : inputMoney(input.income), affordabilityPercent: input.affordabilityPercent });
    for (const field of ['face', 'charge', 'cash', 'total', 'rateBps', 'inputAmount'] as const) if (preview[field] !== input[field]) throw new Error('Loan figures changed. Review the current preview before release.');
    if (JSON.stringify(preview.schedule) !== JSON.stringify(input.schedule)) throw new Error('The repayment schedule must match the reviewed loan.');
    if (input.cash <= 0 || input.total <= 0) throw new Error('Cash released and total repayment must both be greater than zero.');
    if (input.months > 120 || input.months < 1) throw new Error('Choose a term between 1 and 120 months.');
    if (!Number.isInteger(input.courtesyDays) || input.courtesyDays < 0 || input.courtesyDays > 365) throw new Error('Choose a courtesy period between 0 and 365 days.');
    const loan: Loan = { ...input, id: uuid(), ref: await nextRef('LON', input.issuedOn), createdAt: now(),
      borrowerSnapshot: borrowerIdentity(borrower), businessSnapshot: businessIdentity(await getSettings()) };
    await db.loans.add(loan);
    const entry: LedgerEntry = { id: uuid(), ref: await nextRef('DIS', input.issuedOn), kind: 'release', loanId: loan.id,
      borrowerId: loan.borrowerId, amount: loan.cash, date: input.issuedOn, createdAt: now(), method: 'Cash', institution: '',
      externalRef: '', operator: input.operator, notes: 'Cash released; original loan terms locked.', idempotencyKey, balanceAfter: loan.total, postedOrder: 1,
      borrowerSnapshot: loan.borrowerSnapshot, businessSnapshot: loan.businessSnapshot };
    await db.entries.add(entry);
    await addAudit('Funds released', loan.id, `${loan.ref} · ${entry.ref}`, input.operator);
    await changed();
    return loan;
  });
  notify();
  return result;
}

export interface PaymentInput {
  loanId: string; amount: number; date: string; method: string; institution?: string; externalRef?: string;
  operator?: string; notes?: string; idempotencyKey: string; allowDuplicateReference?: boolean;
}

export async function postPayment(input: PaymentInput): Promise<LedgerEntry> {
  money(input.amount, 'Payment');
  validDate(input.date);
  if (input.amount <= 0) throw new Error('Enter a payment greater than zero.');
  if (!input.idempotencyKey) throw new Error('A unique payment request is required.');
  if (input.date > todayManila()) throw new Error('A payment received cannot be dated in the future.');
  const entry = await db.transaction('rw', allTables(), async () => {
    const previous = await db.entries.where('idempotencyKey').equals(input.idempotencyKey).first();
    if (previous) {
      if (previous.kind !== 'payment' || previous.loanId !== input.loanId || previous.amount !== input.amount || previous.date !== input.date) throw new Error('This payment request was already used with different details. Check the receipt before recording again.');
      return previous;
    }
    const loan = await db.loans.get(input.loanId);
    if (!loan) throw new Error('Select a valid loan.');
    const borrower = await db.borrowers.get(loan.borrowerId);
    if (!borrower) throw new Error('The loan’s borrower profile is missing. Restore a verified backup before recording.');
    const settings = await getSettings();
    if (input.date < loan.issuedOn) throw new Error('Payment date cannot be before cash was released.');
    const entries = await db.entries.where('loanId').equals(loan.id).toArray();
    const balance = loanBalance(loan, entries);
    if (input.amount > balance) throw new Error('Payment exceeds the remaining balance. Return the extra money or record only the amount owed. Advance credits are not supported.');
    const externalRef = input.externalRef?.trim() || '';
    if (externalRef && !input.allowDuplicateReference) {
      const duplicate = (await db.entries.toArray()).some(e => e.externalRef && e.externalRef.trim().toLowerCase() === externalRef.toLowerCase());
      if (duplicate) throw new Error('This bank/e-wallet reference already exists. Check the earlier transaction before confirming an intentional duplicate.');
    }
    const record: LedgerEntry = { id: uuid(), ref: await nextRef('PAY', input.date), kind: 'payment', loanId: loan.id,
      borrowerId: loan.borrowerId, amount: input.amount, date: input.date, createdAt: now(), method: input.method || 'Cash',
      institution: input.method === 'Cash' ? '' : input.institution?.trim() || '',
      externalRef: input.method === 'Cash' ? '' : externalRef, operator: input.operator?.trim() || '', notes: input.notes?.trim() || '',
      idempotencyKey: input.idempotencyKey, balanceAfter: balance - input.amount,
      postedOrder: entries.reduce((max, entry) => Math.max(max, entry.postedOrder || 0), 0) + 1,
      borrowerSnapshot: borrowerIdentity(borrower), businessSnapshot: businessIdentity(settings) };
    await db.entries.add(record);
    await db.settings.put({ ...settings, key: 'settings', lastMethod: record.method });
    await addAudit('Payment received', record.id, `${record.ref}${input.allowDuplicateReference ? ' · duplicate reference explicitly acknowledged' : ''}`, record.operator);
    await changed();
    return record;
  });
  notify();
  return entry;
}

export async function reversePayment(entryId: string, reason: string, operator = ''): Promise<LedgerEntry> {
  if (!reason.trim()) throw new Error('Explain why this payment needs to be reversed.');
  const entry = await db.transaction('rw', allTables(), async () => {
    const original = await db.entries.get(entryId);
    if (!original || original.kind !== 'payment') throw new Error('Only a recorded payment can be reversed.');
    const existing = await db.entries.where('reversesId').equals(entryId).first();
    if (existing) return existing;
    const loan = await db.loans.get(original.loanId);
    if (!loan) throw new Error('Linked loan not found.');
    const entries = await db.entries.where('loanId').equals(loan.id).toArray();
    const record: LedgerEntry = { ...original, id: uuid(), ref: await nextRef('REV', todayManila()), kind: 'reversal',
      date: todayManila(), createdAt: now(), externalRef: '', reversesId: original.id,
      idempotencyKey: `reverse:${entryId}`, notes: reason.trim(), operator: operator.trim(),
      balanceAfter: loanBalance(loan, entries) + original.amount,
      postedOrder: entries.reduce((max, entry) => Math.max(max, entry.postedOrder || 0), 0) + 1 };
    await db.entries.add(record);
    await addAudit('Payment reversed', record.id, `${original.ref} · ${reason.trim()}`, operator);
    await changed();
    return record;
  });
  notify();
  return entry;
}

export async function saveSettings(patch: Partial<Settings>, options: { quiet?: boolean } = {}) {
  await db.transaction('rw', allTables(), async () => {
    const settings = { ...await getSettings(), ...patch };
    if (!settings.businessName.trim()) throw new Error('Enter a business or notebook name.');
    if (!Number.isInteger(settings.defaultRateBps) || settings.defaultRateBps < 0 || settings.defaultRateBps >= 10000) throw new Error('Default deduction must be 0% to 99.99%.');
    if (!Number.isInteger(settings.maxMonths) || settings.maxMonths < 1 || settings.maxMonths > 120 || !Number.isInteger(settings.defaultMonths) || settings.defaultMonths < 1 || settings.defaultMonths > settings.maxMonths) throw new Error('Default term must fit the maximum term, between 1 and 120 months.');
    if (!Number.isFinite(settings.affordabilityPercent) || settings.affordabilityPercent < 0 || settings.affordabilityPercent > 100) throw new Error('Choose an affordability percentage from 0 to 100.');
    if (!Number.isInteger(settings.courtesyDays) || settings.courtesyDays < 0 || settings.courtesyDays > 365) throw new Error('Courtesy period must be 0 to 365 days.');
    await db.settings.put({ ...settings, key: 'settings' });
    if (!options.quiet) { await addAudit('Settings updated', 'settings', 'Defaults apply only to new drafts.'); await changed(); }
  });
  if (!options.quiet) notify();
}

export async function saveDraft(draft: Draft) {
  await db.transaction('rw', allTables(), async () => {
    await db.drafts.put(draft);
    await changed();
  });
  notify();
}
export async function deleteDraft(id: string) {
  await db.transaction('rw', allTables(), async () => { await db.drafts.delete(id); await changed(); });
  notify();
}

export async function addAttachment(input: Omit<Attachment, 'id' | 'createdAt'>): Promise<Attachment> {
  if (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(input.data)) throw new Error('Choose a PNG, JPEG, WebP image or PDF file.');
  if (input.data.length > 28_000_000) throw new Error('Attachment is too large. Choose a file below 20 MB.');
  const record: Attachment = { ...input, id: uuid(), createdAt: now() };
  await db.transaction('rw', allTables(), async () => {
    if (!await db.borrowers.get(input.borrowerId)) throw new Error('Borrower not found.');
    if (input.loanId) {
      const loan = await db.loans.get(input.loanId);
      if (!loan || loan.borrowerId !== input.borrowerId) throw new Error('Choose the loan this document belongs to.');
    }
    await db.attachments.add(record);
    await addAudit('Document added', record.id, `${record.name}${record.revisionOf ? ' · revised scan' : ''}`);
    await changed();
  });
  notify();
  return record;
}

/** UI must obtain a freshly downloaded and verified backup before this operation. */
export async function clearData(expectedVersion?: number) {
  await db.transaction('rw', allTables(), async () => {
    if (expectedVersion !== undefined && expectedVersion !== await getChangeVersion()) throw new Error('Records changed after the recovery backup. Prepare and verify a fresh backup before clearing.');
    const lease = (await db.meta.get('driveUploadLease'))?.value as { expires: number } | undefined;
    if (lease && lease.expires > Date.now()) throw new Error('A Drive backup is running in another window. Wait for it to finish before clearing records.');
    for (const table of allTables()) await table.clear();
    await db.meta.put({ key: 'datasetGeneration', value: uuid() });
    // No cloud auto-restore or deletion is triggered by a local reset.
  });
  notify(true);
}

/** Used only by validated backup restore; preserves high-water ID counters. */
export async function applySnapshot(snapshot: DataSnapshot, counters: Record<string, number>, mode: 'merge' | 'replace') {
  await db.transaction('rw', allTables(), async () => {
    const oldCounters = await getCounterSnapshot();
    if (mode === 'replace') {
      for (const table of allTables()) await table.clear();
      await db.meta.put({ key: 'datasetGeneration', value: uuid() });
    }
    await db.borrowers.bulkPut(snapshot.borrowers);
    await db.loans.bulkPut(snapshot.loans);
    await db.entries.bulkPut(snapshot.entries);
    await db.attachments.bulkPut(snapshot.attachments);
    await db.audits.bulkPut(snapshot.audits);
    await db.drafts.bulkPut(snapshot.drafts);
    await db.settings.put({ ...snapshot.settings, key: 'settings' });
    const merged = { ...oldCounters };
    for (const [key, value] of Object.entries(counters)) merged[key] = Math.max(merged[key] || 0, value);
    merged['counter:borrower'] = Math.max(merged['counter:borrower'] || 0, ...snapshot.borrowers.map(b => Number(b.displayId) || 0));
    for (const item of [...snapshot.loans, ...snapshot.entries]) {
      const match = /^OWM-(LON|DIS|PAY|REV)-(\d{4})-(\d+)$/.exec(item.ref);
      if (match) {
        const key = `counter:${match[1]}:${match[2]}`;
        merged[key] = Math.max(merged[key] || 0, Number(match[3]));
      }
    }
    for (const [key, value] of Object.entries(merged)) await db.meta.put({ key, value });
    await addAudit('Backup restored', 'backup', `${mode === 'replace' ? 'Replaced local data' : 'Merged verified records'}; ${snapshot.loans.length} loans.`);
    await changed();
  });
  notify();
}
