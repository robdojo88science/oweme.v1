export type PricingMode = 'upfront' | 'addon' | 'zero';
export type EntryMode = 'repay' | 'cash';

/** All monetary fields are nonnegative integer Philippine centavos. */
export interface Borrower {
  id: string;
  displayId: string;
  name: string;
  phone: string;
  address: string;
  income: number | null;
  notes: string;
  createdAt: string;
  archived: boolean;
}

export interface Installment {
  index: number;
  dueDate: string;
  amount: number;
}

/** Identity details at recording time; later profile edits cannot rewrite a signed document. */
export interface BorrowerIdentitySnapshot { name: string; displayId: string; phone: string; address: string }
export interface BusinessIdentitySnapshot { businessName: string; ownerName: string; address: string; contact: string }

export interface Loan {
  id: string;
  ref: string;
  borrowerId: string;
  createdAt: string;
  issuedOn: string;
  pricing: PricingMode;
  entryMode: EntryMode;
  inputAmount: number;
  rateBps: number;
  months: number;
  courtesyDays: number;
  face: number;
  charge: number;
  cash: number;
  total: number;
  schedule: Installment[];
  affordabilityPercent: number;
  income: number | null;
  overrideReason: string;
  terms: string;
  operator: string;
  borrowerSnapshot?: BorrowerIdentitySnapshot;
  businessSnapshot?: BusinessIdentitySnapshot;
}

export interface LedgerEntry {
  id: string;
  ref: string;
  kind: 'release' | 'payment' | 'reversal';
  loanId: string;
  borrowerId: string;
  amount: number;
  date: string;
  createdAt: string;
  method: string;
  institution: string;
  externalRef: string;
  operator: string;
  notes: string;
  reversesId?: string;
  idempotencyKey: string;
  balanceAfter: number;
  /** Monotonic posting order within the loan, independent of backdated receipt dates. */
  postedOrder?: number;
  borrowerSnapshot?: BorrowerIdentitySnapshot;
  businessSnapshot?: BusinessIdentitySnapshot;
}

export interface Attachment {
  id: string;
  borrowerId: string;
  loanId: string;
  name: string;
  type: string;
  /** Portable data URL; private files never leave this device without an export. */
  data: string;
  createdAt: string;
  revisionOf?: string;
  /** Explicit owner classification; an arbitrary proof file is not a signed agreement. */
  category?: 'agreement' | 'proof' | 'other';
}

export interface Audit {
  id: string;
  at: string;
  action: string;
  entityId: string;
  detail: string;
  operator: string;
}

export interface Settings {
  businessName: string;
  ownerName: string;
  address: string;
  contact: string;
  defaultRateBps: number;
  defaultMonths: number;
  maxMonths: number;
  affordabilityPercent: number;
  courtesyDays: number;
  terms: string;
  lastMethod: string;
  driveClientId: string;
  driveFileId: string;
  driveRevision: string;
  lastBackupAt: string;
  lastExportAt: string;
  email: string;
}

export interface Draft {
  id: string;
  borrowerId: string;
  values: Record<string, string>;
  updatedAt: string;
}

export interface DataSnapshot {
  borrowers: Borrower[];
  loans: Loan[];
  entries: LedgerEntry[];
  attachments: Attachment[];
  audits: Audit[];
  drafts: Draft[];
  settings: Settings;
}

export interface LoanInput {
  amount: string;
  rate: string;
  months: number;
  date: string;
  pricing: PricingMode;
  entryMode: EntryMode;
  income: string;
  affordabilityPercent: number;
}

export interface LoanCalculation {
  face: number;
  charge: number;
  cash: number;
  total: number;
  schedule: Installment[];
  monthly: number;
  suggestedMax: number | null;
  costPercent: number;
  rateBps: number;
  inputAmount: number;
  months: number;
  date: string;
}

export interface InstallmentBalance extends Installment {
  paid: number;
  remaining: number;
  paidOn: string | null;
  status: 'paid' | 'partial' | 'unpaid';
}

export interface PaymentPreview {
  balanceBefore: number;
  balanceAfter: number;
  allocations: { index: number; amount: number }[];
  nextDue: string | null;
  remainingInstallments: number;
  status: 'Paid in Full' | 'Active';
}

export interface Reliability {
  stars: number | null;
  dueCount: number;
  onTime: number;
  lateCount: number;
  averageDaysLate: number;
  settledLoans: number;
}
