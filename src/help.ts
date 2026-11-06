export type HelpContent = { title: string; body: string; learnMore?: string };

export const helpContent = {
  upfront: { title: 'One-time upfront deduction', body: 'Deducted once from the total to repay. For example, PHP 3,000 to repay with a 10% deduction means PHP 2,700 cash given and PHP 3,000 repaid. This is not a 10% monthly rate or APR.' },
  addon: { title: 'One-time charge added', body: 'The charge is added to the cash you give. PHP 3,000 cash with a 10% add-on charge means PHP 3,300 total to repay. It is charged once for the whole term, not each month.' },
  zero: { title: 'Zero-charge loan', body: 'Cash given equals the amount to repay. A PHP 3,000 loan has no finance charge and PHP 3,000 total repayments. Late fees remain zero.' },
  cash: { title: 'Cash to give', body: 'The actual money you hand to the borrower when funds are released. Compare this with the total they must repay before confirming.' },
  monthly: { title: 'Monthly payment', body: 'The scheduled amount each month, beginning one month after release. Extra centavos go to earlier installments, so PHP 1,000 over three months is PHP 333.34, PHP 333.33 and PHP 333.33.' },
  limit: { title: 'Suggested repayment budget', body: 'An editable guide using the income and share you entered; it is not an approval or promise of affordability. PHP 1,000 monthly income x 3 months x 30% suggests PHP 900 total repayments. Other active loans also use the borrower’s budget.' },
  courtesy: { title: 'Courtesy reminder window', body: 'An internal reminder window after the contractual due date; five calendar days is the default. The agreed due date does not move, payments after it are late, and no extra fee is created.' },
  reliability: { title: 'Repayment reliability', body: 'Based on installments fully paid by their contractual due dates: 95% on time earns 5 stars, then 85%, 70% and 50% earn 4, 3 and 2. New borrowers stay Not rated until an installment is due. This is not a credit score or a repayment guarantee.' },
  pendingBackup: { title: 'Backup is pending', body: 'Your changes are saved on this device. A pending cloud backup is not yet a confirmed copy in Google Drive; stay online with OweMe open and reconnect if authorization expired.' },
  reversal: { title: 'Correct a mistaken payment', body: 'Reverse the original payment with a reason, then record the correct payment. The original transaction and receipt remain in history, and the reversal restores the amount owed.' },
  archive: { title: 'Archive borrower', body: 'Hides the borrower from the active list while keeping loans, receipts and reports. You can restore the profile later. Archiving does not erase personal information.' },
  transactionId: { title: 'Transaction reference', body: 'A unique, readable reference links a cash release or payment to its receipt. Use it to find a record or compare it with a bank or e-wallet reference.' },
  advance: { title: 'Payment before due date', body: 'Early payments apply to the oldest unpaid scheduled balance, including future installments. Due dates do not change. Money above the full remaining balance is rejected so extra cash is never silently lost.' },
  cost: { title: 'Cost relative to cash received', body: 'One-time charge divided by actual cash given, over the entire loan term. PHP 300 / PHP 2,700 is 11.11%. This comparison is not an APR or a monthly rate.' },
  cloudBackup: { title: 'Google Drive backup', body: 'Uploads happen only while OweMe is open, online and authorized. Closing the app can pause backup; you may need to reconnect. This is backup and manual recovery, not automatic two-way device sync.' },
  late: { title: 'Past contractual due date', body: 'A payment received after its agreed due date is late, even during the internal courtesy window. Fully paying an installment by its due date is required for on-time rating credit.' },
  privacy: { title: 'Private to this device', body: 'Borrowers and transactions are stored in this browser’s IndexedDB, separate from other owners. Back up regularly: clearing browser storage or losing the device can remove the local copy. Anyone using this unlocked browser can view it.' },
  recognition: { title: 'Collections are not profit', body: 'Repayments include recovery of money lent. Reports show cash released, collections and cash movement separately. Any finance-charge allocation is a proportional cash-collection illustration, not a tax or accounting conclusion.' },
  restore: { title: 'Restore or safely merge', body: 'Restore replaces this device’s records after you confirm. Safe merge adds compatible records and rejects conflicting financial identities. Check record counts and totals, keep a fresh backup and restore only a file you trust.' },
  draft: { title: 'Draft only', body: 'Changing a number or saving a draft never records money or creates a debt. Only the final cash-release confirmation posts an immutable release and repayment schedule.' },
  targetCash: { title: 'Cash they want to receive', body: 'OweMe finds the smallest whole-centavo obligation that provides at least the requested cash after rounding the deduction. At 10%, a PHP 3,000 cash target means PHP 3,333.33 to repay.' },
  settings: { title: 'Defaults affect new drafts', body: 'Changing default pricing, term or courtesy settings applies to new loans. Issued loan terms and their printed disclosures remain unchanged.' },
  storage: { title: 'Local storage and attachments', body: 'Borrower records and document files stay in this browser. Device storage can run out, so keep portable backups and check storage status. A successful download is not proof that the file was kept safely.' },
} as const satisfies Record<string, HelpContent>;

export type HelpKey = keyof typeof helpContent;
