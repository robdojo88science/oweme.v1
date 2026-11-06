import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Documentation artifact only. This never writes any IndexedDB data.
const vite = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true } });
try {
  const { agreementPdf } = await vite.ssrLoadModule('/src/documents.ts');
  const { calculateLoan } = await vite.ssrLoadModule('/src/finance.ts');
  const calculation = calculateLoan({ amount: '3000', rate: '10', months: 3, date: '2026-11-05', pricing: 'upfront', entryMode: 'repay', income: '', affordabilityPercent: 30 });
  const borrower = { id: 'sample-only', displayId: '---', name: '____________________________ (layout example)', phone: '', address: '____________________________________________', income: null, notes: '', createdAt: '2026-11-05T00:00:00Z', archived: false };
  const settings = { businessName: 'OweMe - SAMPLE LAYOUT', ownerName: '', address: '', contact: '', defaultRateBps: 1000, defaultMonths: 3, maxMonths: 3, affordabilityPercent: 30, courtesyDays: 5, terms: 'SAMPLE ONLY. Replace with appropriate reviewed agreement terms before signing. This file contains no real borrower or transaction.', lastMethod: 'Cash', driveClientId: '', driveFileId: '', driveRevision: '', lastBackupAt: '', lastExportAt: '', email: '' };
  const loan = { id: 'sample-only', ref: 'UNISSUED SAMPLE - NO CASH RECORDED', borrowerId: borrower.id, createdAt: borrower.createdAt, issuedOn: '2026-11-05', pricing: 'upfront', entryMode: 'repay', inputAmount: 300000, rateBps: 1000, months: 3, courtesyDays: 5, face: calculation.face, charge: calculation.charge, cash: calculation.cash, total: calculation.total, schedule: calculation.schedule, affordabilityPercent: 30, income: null, overrideReason: '', terms: settings.terms, operator: '' };
  const pdf = agreementPdf(borrower, loan, settings);
  await mkdir('docs', { recursive: true });
  await writeFile('docs/sample-agreement.pdf', new Uint8Array(pdf.output('arraybuffer')));
  console.log(`Created sample agreement (${pdf.getNumberOfPages()} pages). No application records were created.`);
} finally {
  await vite.close();
}
