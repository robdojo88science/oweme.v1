# Feature status

This file describes implementation scope and the verification completed on November 6, 2026 (Asia/Manila).

## Core scope

The build targets an empty, offline-first owner notebook with name-only borrower creation; instant exact-centavo pricing and payment previews; upfront, add-on and zero-charge modes; anchored monthly due dates; drafts and immutable release snapshots; atomic payments and receipt references; reversal-based corrections; borrower archives; local IndexedDB documents; printable agreements, receipts and statements; contractual-date ratings and reminders; date-filtered reporting; validated portable backup/restore; and an optional configurable Google Drive adapter.

The UI progressively reveals optional fields and technical definitions. Borrowers do not log in or provide government IDs. A calculator preview, report filter or settings change never posts money.

## PDF module

Implemented exports:

- A4 loan agreement with exact cash released, face amount, charge, repayment total, every monthly due date, zero late fee, courtesy-window disclosure, customizable terms and real-paper signature lines.
- A4 or 80mm compact transaction receipt, including reference, borrower/loan, transaction and recorded timestamps, method/reference, operator, immutable balance-after snapshot and reversal details.
- Date-filtered borrower statements, including archived borrower history, current all-history balance and full original schedules with paid/remaining allocation.
- Date-range cash-movement report with releases, collections net of reversals, outstanding obligations, overdue amount, channels, aging and an explicitly described proportional finance-charge allocation.
- Filtered CSV download with spreadsheet formula-injection escaping.

PDFs bundle their font resources and use `PHP` in place of an unsupported peso glyph. This does not require a web-font service. A generated paper agreement does not claim enforceability or prove that anyone signed it.

PDF verification: eight content/pagination tests passed with `npm test -- src/documents.test.ts`. They include identity regressions: renaming a borrower or business does not alter an issued agreement, a receipt uses its payment-time identity, and a regenerated reversed receipt is marked while preserving its original money snapshot. New records carry immutable borrower/business snapshots; legacy imports without snapshots use the documented fallback. The final two-page synthetic sample was rendered with MuPDF and both pages were visually inspected for clipping, overlap, signature placement and repeated loan identification. This verifies the sample layout; physical printer output still needs a local check. Recreate the sample with `node docs/generate-sample.mjs` after dependencies are installed.

## Signed-paper attachments

The gallery requires an exact loan association, accepts camera images and image/PDF uploads, previews before saving, and preserves earlier scans when a revision is added. Image tools provide 90-degree rotation, an optional center square crop and local JPEG compression up to 1600 pixels on the longest side. Review signatures and page edges before saving; this is not an automatic document-edge detector or a freeform crop editor. PDFs retain their original pages. File-size and available-storage warnings are shown, and portable backups include the saved document data.

## Intentionally optional or outside the core release

- Borrower-facing accounts, mandatory ID checks, cloud database accounts, automatic borrower messages and forced privacy locks are not required.
- Closed-app background Drive uploads and scheduled iOS notifications cannot be guaranteed by this browser app.
- Google OAuth requires the owner's public web client configuration and authorization. Live Google account upload/recovery cannot be certified without that authorization. Mock API checks are separate from a real-account test.
- Automatic two-way multi-device sync is not implemented; use explicit backup and recovery. Revision conflicts require review.
- Automatic email delivery is not enabled without a separately configured authorized API or service. Download plus manual email attachment is the honest fallback.
- Automatic advance-credit/refund accounting, manually altered installment allocation, signed amendments to issued financial obligations and annualized effective-rate/APR calculations are outside the current core engine. Do not represent them as available.
- Password-encrypted exports, large ZIP backups, biometric/privacy-lock UI, OCR and freeform document-edge cropping are not included. Portable backups are unencrypted JSON, and the import size limit is 150 MB.
- Search normalizes case, accents and spacing and supports text fragments; fuzzy typo ranking and the full set of advanced cross-module search filters are not included.
- Privacy erasure requires a retention/legal review. Archive preserves records and is not erasure.
- Real touch keyboard, iOS installation, VoiceOver, camera behavior and physical printer output need device checks even when desktop browser tests pass.

## Final verification record

Verified locally with Node 24 and Chrome:

- `npm run typecheck` and `npm run lint` passed.
- `npm test` passed all 83 tests: 47 financial, 17 database/backup, 11 mocked Drive and 8 PDF tests.
- Production builds passed at `/` and the repository's GitHub Pages path, `/oweme.v1/`.
- `node scripts/verify-production.mjs` passed for both paths: empty initial database, manifest/icons, correct service-worker scope, offline reload, persisted offline borrower, live calculator and agreement PDF download, with zero uncaught browser errors. Use the same `VITE_BASE_PATH` for the build and verification command.
- `npm run test:e2e` passed all 24 checks across six screen sizes after fixing a focused payment input that could sit behind the sticky action bar. Focused loan/payment fields now scroll clear of overlays; the regression checks inspect actual hit targets as well as viewport bounds.

The browser suite and screen-size results are recorded in [the friction audit](FRICTION-AUDIT.md). Live Google account authorization/upload/recovery, real touch keyboards, iOS installation, VoiceOver, camera behavior and physical printing remain device/account checks. Mocked Drive tests and desktop touch emulation do not certify those capabilities. These local checks do not establish that the current working tree has been published.
