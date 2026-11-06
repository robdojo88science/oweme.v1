import { z } from 'zod';
import type { DataSnapshot } from './domain';
import { calculateLoan, loanBalance } from './finance';
import { applySnapshot, db, defaultSettings, getChangeVersion, getCounterSnapshot, getDatasetGeneration, getSnapshot, saveSettings } from './db';

const cents = z.number().int().min(0).max(100_000_000_000);
const text = z.string().max(100_000);
const identifier = z.string().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const timestamp = z.string().refine(value => !Number.isNaN(Date.parse(value)), 'Invalid timestamp');
const borrowerSchema = z.object({
  id: identifier, displayId: z.string().regex(/^\d{3,}$/), name: z.string().min(1).max(200), phone: text,
  address: text, income: cents.nullable(), notes: text, createdAt: timestamp, archived: z.boolean(),
}).strict();
const borrowerSnapshotSchema = z.object({ name: z.string().min(1).max(200), displayId: z.string().regex(/^\d{3,}$/), phone: text, address: text }).strict();
const businessSnapshotSchema = z.object({ businessName: text, ownerName: text, address: text, contact: text }).strict();
const loanSchema = z.object({
  id: identifier, ref: identifier, borrowerId: identifier, createdAt: timestamp, issuedOn: date,
  pricing: z.enum(['upfront', 'addon', 'zero']), entryMode: z.enum(['repay', 'cash']), inputAmount: cents,
  rateBps: z.number().int().min(0).max(100_000), months: z.number().int().min(1).max(120),
  courtesyDays: z.number().int().min(0).max(365), face: cents, charge: cents, cash: cents, total: cents,
  schedule: z.array(z.object({ index: z.number().int().min(1), dueDate: date, amount: cents }).strict()).min(1).max(120),
  affordabilityPercent: z.number().min(0).max(100), income: cents.nullable(), overrideReason: text, terms: text, operator: text,
  borrowerSnapshot: borrowerSnapshotSchema.optional(), businessSnapshot: businessSnapshotSchema.optional(),
}).strict();
const entrySchema = z.object({
  id: identifier, ref: identifier, kind: z.enum(['release', 'payment', 'reversal']), loanId: identifier, borrowerId: identifier,
  amount: cents, date, createdAt: timestamp, method: text, institution: text, externalRef: text, operator: text, notes: text,
  reversesId: identifier.optional(), idempotencyKey: identifier, balanceAfter: cents, postedOrder: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  borrowerSnapshot: borrowerSnapshotSchema.optional(), businessSnapshot: businessSnapshotSchema.optional(),
}).strict();
const attachmentSchema = z.object({
  id: identifier, borrowerId: identifier, loanId: z.string().max(200), name: text, type: text,
  data: z.string().max(28_000_000).refine(value => /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=\r\n]+$/.test(value), 'Attachment must be a portable image/PDF'),
  createdAt: timestamp, revisionOf: identifier.optional(), category: z.enum(['agreement', 'proof', 'other']).optional(),
}).strict();
const auditSchema = z.object({ id: identifier, at: timestamp, action: text, entityId: text, detail: text, operator: text }).strict();
const draftSchema = z.object({ id: identifier, borrowerId: text, values: z.record(z.string()), updatedAt: timestamp }).strict();
const settingsSchema = z.object({
  businessName: text, ownerName: text, address: text, contact: text,
  defaultRateBps: z.number().int().min(0).max(9999), defaultMonths: z.number().int().min(1).max(120),
  maxMonths: z.number().int().min(1).max(120), affordabilityPercent: z.number().min(0).max(100),
  courtesyDays: z.number().int().min(0).max(365), terms: text, lastMethod: text,
  driveClientId: text, driveFileId: text, driveRevision: text, lastBackupAt: text, lastExportAt: text, email: text,
}).strict();
const dataSchema = z.object({
  borrowers: z.array(borrowerSchema).max(100_000), loans: z.array(loanSchema).max(100_000), entries: z.array(entrySchema).max(1_000_000),
  attachments: z.array(attachmentSchema).max(100_000), audits: z.array(auditSchema).max(1_000_000), drafts: z.array(draftSchema).max(100_000),
  settings: settingsSchema,
}).strict();
const payloadSchema = z.object({
  app: z.literal('OweMe'), schemaVersion: z.literal(1), createdAt: timestamp,
  data: dataSchema, counters: z.record(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  counts: z.record(z.number().int().min(0)),
}).strict();

export interface BackupEnvelope {
  app: 'OweMe'; schemaVersion: 1; createdAt: string; data: DataSnapshot;
  counters: Record<string, number>; counts: Record<string, number>; checksum: string;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function backupTotals(data: DataSnapshot) {
  const reversed = new Set(data.entries.filter(e => e.kind === 'reversal').map(e => e.reversesId));
  return {
    cashReleased: data.loans.reduce((sum, loan) => sum + loan.cash, 0),
    repayable: data.loans.reduce((sum, loan) => sum + loan.total, 0),
    payments: data.entries.filter(e => e.kind === 'payment' && !reversed.has(e.id)).reduce((sum, entry) => sum + entry.amount, 0),
    outstanding: data.loans.reduce((sum, loan) => sum + loanBalance(loan, data.entries), 0),
  };
}

const countData = (data: DataSnapshot) => ({ borrowers: data.borrowers.length, loans: data.loans.length, entries: data.entries.length,
  attachments: data.attachments.length, audits: data.audits.length, drafts: data.drafts.length });

function unique(items: Array<{ id: string }>, label: string, field = 'id') {
  const seen = new Set<unknown>();
  for (const item of items) {
    const value = (item as unknown as Record<string, unknown>)[field];
    if (seen.has(value)) throw new Error(`Backup contains duplicate ${label} ${field}. Nothing was restored.`);
    seen.add(value);
  }
}
const moneyInput = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;

export function validateAccounting(data: DataSnapshot) {
  if (data.settings.defaultMonths > data.settings.maxMonths) throw new Error('Default loan term exceeds the configured maximum. Nothing was restored.');
  const borrowers = new Map(data.borrowers.map(b => [b.id, b]));
  const loans = new Map(data.loans.map(l => [l.id, l]));
  const entries = new Map(data.entries.map(e => [e.id, e]));
  for (const key of ['borrowers', 'loans', 'entries', 'attachments', 'audits', 'drafts'] as const) unique(data[key], key);
  unique(data.borrowers, 'borrower', 'displayId'); unique(data.loans, 'loan', 'ref');
  unique(data.entries, 'transaction', 'ref'); unique(data.entries, 'transaction', 'idempotencyKey');
  for (const loan of data.loans) {
    if (!borrowers.has(loan.borrowerId)) throw new Error(`Loan ${loan.ref} has no borrower. Nothing was restored.`);
    const computed = calculateLoan({ amount: moneyInput(loan.inputAmount), rate: String(loan.rateBps / 100), months: loan.months,
      date: loan.issuedOn, pricing: loan.pricing, entryMode: loan.entryMode,
      income: loan.income === null ? '' : moneyInput(loan.income), affordabilityPercent: loan.affordabilityPercent });
    for (const key of ['face', 'charge', 'cash', 'total', 'rateBps', 'inputAmount'] as const) if (loan[key] !== computed[key]) throw new Error(`Financial mismatch in ${loan.ref}. Nothing was restored.`);
    if (canonical(loan.schedule) !== canonical(computed.schedule)) throw new Error(`Schedule mismatch in ${loan.ref}. Nothing was restored.`);
    const releases = data.entries.filter(e => e.loanId === loan.id && e.kind === 'release');
    if (releases.length !== 1 || releases[0].amount !== loan.cash || releases[0].date !== loan.issuedOn || releases[0].balanceAfter !== loan.total) throw new Error(`Release record mismatch in ${loan.ref}. Nothing was restored.`);
    if (loan.borrowerSnapshot && (loan.borrowerSnapshot.displayId !== borrowers.get(loan.borrowerId)!.displayId || canonical(loan.borrowerSnapshot) !== canonical(releases[0].borrowerSnapshot))) throw new Error(`Borrower identity snapshot mismatch in ${loan.ref}.`);
    if (loan.businessSnapshot && canonical(loan.businessSnapshot) !== canonical(releases[0].businessSnapshot)) throw new Error(`Business identity snapshot mismatch in ${loan.ref}.`);
    const balance = loanBalance(loan, data.entries);
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > loan.total) throw new Error(`Invalid outstanding balance in ${loan.ref}. Nothing was restored.`);
    const ordered = data.entries.filter(e => e.loanId === loan.id);
    if (ordered.every(entry => entry.postedOrder !== undefined)) {
      ordered.sort((a, b) => a.postedOrder! - b.postedOrder!);
      let runningBalance = loan.total;
      const paymentsSeen = new Set<string>();
      const reversalsSeen = new Set<string>();
      for (let index = 0; index < ordered.length; index++) {
        const entry = ordered[index];
        if (entry.postedOrder !== index + 1 || (index === 0 && entry.kind !== 'release') || (index > 0 && entry.kind === 'release')) throw new Error(`Posting order is inconsistent in ${loan.ref}. Nothing was restored.`);
        if (entry.kind === 'payment') { runningBalance -= entry.amount; paymentsSeen.add(entry.id); }
        if (entry.kind === 'reversal') {
          if (!entry.reversesId || !paymentsSeen.has(entry.reversesId) || reversalsSeen.has(entry.reversesId)) throw new Error(`Reversal posting order is inconsistent in ${loan.ref}.`);
          runningBalance += entry.amount; reversalsSeen.add(entry.reversesId);
        }
        if (runningBalance < 0 || runningBalance > loan.total || entry.balanceAfter !== runningBalance) throw new Error(`Receipt balance does not match posting history in ${entry.ref}. Nothing was restored.`);
      }
      if (runningBalance !== balance) throw new Error(`Posting history does not match the current balance in ${loan.ref}.`);
    }
  }
  const reversed = new Set<string>();
  for (const entry of data.entries) {
    const loan = loans.get(entry.loanId);
    if (!loan || entry.borrowerId !== loan.borrowerId) throw new Error(`Transaction ${entry.ref} has an invalid loan link. Nothing was restored.`);
    if (entry.amount <= 0 || entry.balanceAfter > loan.total || entry.date < loan.issuedOn) throw new Error(`Transaction ${entry.ref} has invalid amounts or dates. Nothing was restored.`);
    if (entry.borrowerSnapshot && entry.borrowerSnapshot.displayId !== borrowers.get(entry.borrowerId)!.displayId) throw new Error(`Transaction ${entry.ref} has an inconsistent borrower number.`);
    if (entry.kind === 'reversal') {
      const original = entry.reversesId ? entries.get(entry.reversesId) : undefined;
      if (!original || original.kind !== 'payment' || original.loanId !== entry.loanId || original.amount !== entry.amount || reversed.has(original.id) || !entry.notes.trim()) throw new Error(`Reversal ${entry.ref} is inconsistent. Nothing was restored.`);
      if (canonical(entry.borrowerSnapshot) !== canonical(original.borrowerSnapshot) || canonical(entry.businessSnapshot) !== canonical(original.businessSnapshot)) throw new Error(`Reversal identity does not match ${original.ref}.`);
      reversed.add(original.id);
    } else if (entry.reversesId) throw new Error(`Transaction ${entry.ref} has an unexpected reversal link.`);
  }
  for (const attachment of data.attachments) {
    if (!borrowers.has(attachment.borrowerId) || (attachment.loanId && loans.get(attachment.loanId)?.borrowerId !== attachment.borrowerId)) throw new Error(`Document ${attachment.name} has an invalid borrower or loan link.`);
    if (attachment.revisionOf && !data.attachments.some(a => a.id === attachment.revisionOf && a.borrowerId === attachment.borrowerId && a.loanId === attachment.loanId)) throw new Error(`Document ${attachment.name} has a missing revision.`);
  }
  for (const draft of data.drafts) if (draft.borrowerId && !borrowers.has(draft.borrowerId)) throw new Error('A loan draft refers to a missing borrower.');
}

async function serializeBackup(data: DataSnapshot, counters: Record<string, number>): Promise<string> {
  validateAccounting(data);
  const payload = { app: 'OweMe' as const, schemaVersion: 1 as const, createdAt: new Date().toISOString(), data,
    counters, counts: countData(data) };
  const checked = payloadSchema.safeParse(payload);
  if (!checked.success) throw new Error(`Saved data cannot be exported safely: ${checked.error.issues[0]?.path.join('.') || 'schema'}. No incomplete recovery file was created.`);
  const checksum = await sha256(canonical(payload));
  return JSON.stringify({ ...payload, checksum }, null, 2);
}

/** Snapshot and watermark share one read transaction, even if hashing takes time. */
export async function captureBackup(): Promise<{ text: string; version: number; generation: string }> {
  const capture = await db.transaction('r', [db.borrowers, db.loans, db.entries, db.attachments, db.audits, db.drafts, db.settings, db.meta], async () => {
    const [data, counters, version, generation] = await Promise.all([getSnapshot(), getCounterSnapshot(), getChangeVersion(), getDatasetGeneration()]);
    return { data, counters, version, generation };
  });
  return { text: await serializeBackup(capture.data, capture.counters), version: capture.version, generation: capture.generation };
}

export async function exportBackup(snapshot?: DataSnapshot): Promise<string> {
  return snapshot ? serializeBackup(snapshot, await getCounterSnapshot()) : (await captureBackup()).text;
}

export async function inspectBackup(input: string): Promise<BackupEnvelope> {
  if (input.length > 150_000_000) throw new Error('Backup is larger than 150 MB. Use a device with enough memory to restore this file.');
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new Error('This file is not valid OweMe JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Choose an OweMe backup file.');
  const { checksum, ...rawPayload } = parsed as Record<string, unknown>;
  if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Backup checksum is missing or invalid.');
  if (checksum !== await sha256(canonical(rawPayload))) throw new Error('Backup checksum does not match. The file may be damaged or modified. Nothing was restored.');
  const checked = payloadSchema.safeParse(rawPayload);
  if (!checked.success) throw new Error(`Unsupported or invalid backup data: ${checked.error.issues[0]?.path.join('.') || 'schema'}. Nothing was restored.`);
  const payload = checked.data;
  const data = payload.data as DataSnapshot;
  for (const [key, value] of Object.entries(countData(data))) if (payload.counts[key] !== value) throw new Error('Backup record counts do not match its contents.');
  for (const key of Object.keys(payload.counters)) if (!/^counter:(borrower|(LON|DIS|PAY|REV):\d{4})$/.test(key)) throw new Error('Backup contains an invalid ID counter.');
  validateAccounting(data);
  return { ...payload, data, checksum };
}

function mergeRecords<T extends { id: string }>(current: T[], incoming: T[], label: string): T[] {
  const merged = new Map(current.map(record => [record.id, record]));
  for (const record of incoming) {
    const existing = merged.get(record.id);
    if (existing && canonical(existing) !== canonical(record)) throw new Error(`Safe merge found conflicting ${label} data for ${record.id}. Export this device first, then use Restore–Replace with the correct backup.`);
    if (!existing) merged.set(record.id, record);
  }
  return [...merged.values()];
}

export async function restoreBackup(backup: BackupEnvelope, mode: 'merge' | 'replace', expectedVersion?: number) {
  // Revalidate even when a caller retains a parsed object from an earlier preview.
  const verified = await inspectBackup(JSON.stringify(backup));
  return db.transaction('rw', [db.borrowers, db.loans, db.entries, db.attachments, db.audits, db.drafts, db.settings, db.meta], async () => {
  if (expectedVersion !== undefined && expectedVersion !== await getChangeVersion()) throw new Error('Records changed after the pre-restore recovery backup. Download a fresh recovery copy and review the restore again.');
  const lease = (await db.meta.get('driveUploadLease'))?.value as { expires: number } | undefined;
  if (lease && lease.expires > Date.now()) throw new Error('A Drive backup is still running. Wait for it to finish before restoring records.');
  let data = verified.data;
  if (mode === 'merge') {
    const current = await getSnapshot();
    data = {
      borrowers: mergeRecords(current.borrowers, data.borrowers, 'borrower'), loans: mergeRecords(current.loans, data.loans, 'loan'),
      entries: mergeRecords(current.entries, data.entries, 'transaction'), attachments: mergeRecords(current.attachments, data.attachments, 'document'),
      audits: mergeRecords(current.audits, data.audits, 'activity'), drafts: mergeRecords(current.drafts, data.drafts, 'draft'),
      settings: current.settings,
    };
    try { validateAccounting(data); } catch (error) {
      throw new Error(`Safe merge stopped: ${(error as Error).message} Existing data was kept. Independent devices may have colliding display IDs or transaction numbers; use a verified Replace restore instead.`);
    }
  } else {
    // Never adopt an incoming device’s Drive revision: require explicit recovery/reconnection.
    data = { ...data, settings: { ...defaultSettings, ...data.settings, driveFileId: '', driveRevision: '', lastBackupAt: '' } };
  }
  await applySnapshot(data, verified.counters, mode);
  return backupTotals(data);
  });
}

export async function markBackupExported() { await saveSettings({ lastExportAt: new Date().toISOString() }, { quiet: true }); }
