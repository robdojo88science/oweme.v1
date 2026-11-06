# OweMe

A private, offline-first lending notebook for one owner. Borrowers do not register. Opening the app requires no account, password or PIN. Each browser profile has its own IndexedDB records; GitHub Pages hosts application code, not a shared borrower database.

The fast path is **Add borrower → New loan → Review release → Record payment → Receipt**. Amounts update while you type. A preview or saved draft never posts cash or creates a debt.

## Run locally

Use Node.js 24, or Node.js 22.18+ in the 22.x line, and npm. The browser-test wrapper uses Node’s native TypeScript loading. In Windows PowerShell, use `npm.cmd` when script execution policy blocks `npm.ps1`.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Production offline behavior must be checked with the production preview, not the development server:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`npm run test:e2e` runs the browser tests. Install the corresponding Playwright browser first if it is not already available: `npx playwright install chromium`. A browser test run needs a working browser runtime; see the final validation report for what was actually exercised in this environment.

## Everyday use

1. **Add a borrower.** Only the full name is required. Phone, address, monthly income and notes are optional. The notebook assigns IDs such as `001`, expanding beyond `999`.
2. **Create a loan or try the calculator.** Choose the person and enter the total to repay, or choose a target cash amount. Review the actual cash to give, one-time charge, total repayments and all due dates. The default is a single 10% upfront deduction for the entire term, with three monthly installments. It is not a monthly interest rate or APR.
3. **Review before release.** Save a draft without affecting balances, download the paper agreement, or deliberately confirm the cash release. An issued loan keeps a snapshot of its original terms. Later default changes do not alter it.
4. **Record a payment.** Pick the correct loan when the borrower has more than one. Enter what you received and review the balance-after preview. Cash hides bank fields; bank and e-wallet methods reveal optional references. Confirm once to record the payment and create its receipt.
5. **Correct a mistake.** Reverse the mistaken payment with a reason, then enter the correct payment. The original receipt and reversal remain in history. Posted financial records cannot be invisibly edited.
6. **Keep the paper.** Print and sign a real agreement. Attach a scan or camera photo to the matching loan. A generated agreement alone is not evidence that a signed paper was received.
7. **Back up.** Export portable JSON after important changes and keep a second copy outside the device. Browser storage is not a permanent archive.

For a PHP 3,000 obligation with 10% upfront deduction, the charge is PHP 300, cash given is PHP 2,700 and repayments total PHP 3,000. At three months, each installment is PHP 1,000. The charge relative to cash received is 11.11% over the whole term; it is not an annualized rate. Extra centavos are assigned to earlier installments so scheduled amounts add up exactly.

A November 5 release is due December 5, January 5 and February 5. A January 31 release produces February 28/29, March 31 and April 30. The original release-day anchor is retained. The default five-day courtesy reminder window does not move contractual dates, erase lateness or add a fee.

Income is an optional estimate. At PHP 1,000 monthly income, three months and 100% affordability, the illustrative repayment budget is PHP 3,000. Committing all income may be unaffordable. A 30% setting gives PHP 900 instead. These are editable guides, never guaranteed approvals.

## Install and offline behavior

Load the production HTTPS app online once and allow its service worker to finish caching. Then reopen it without a connection to check the offline copy before relying on it in the field. The application shell, local records, bundled help and PDF generation work without a network after caching. Google authorization and Drive uploads require the internet.

- **iPhone / iPad Safari:** open the HTTPS address, use Share → Add to Home Screen, and open the installed icon. Installation UI depends on the current browser. Background uploads and notifications while the app is closed are not guaranteed.
- **Android:** use the browser’s install option or Add to Home Screen when offered. The core app still works as a browser tab.
- **Desktop:** use the browser’s install option when available, or bookmark the address.

Use the same browser profile and exact origin to see the same local records. Browser profiles, private windows, different domains, and other devices have separate storage. GitHub Pages projects under the same `USERNAME.github.io` origin can share origin-level storage; do not host untrusted applications on the same origin as private lending records. Clearing site data, browser eviction, uninstall behavior or device loss may remove the local copy. Downloads cannot be silently replaced by an ordinary website.

## Backups and recovery

Portable backups contain a schema version, creation time, record counts, ID high-water counters, a SHA-256 checksum, settings and document data. Accounting totals are recomputed from those records for the recovery preview. OAuth access tokens and secrets are not included. A checksum detects accidental changes; it is not encryption or proof that a file is trustworthy. Treat an unencrypted backup as confidential personal and financial information.

To recover:

1. Keep the existing device’s current export before changing records.
2. In Backups, choose the exported JSON file. Read the preview counts and totals.
3. Choose **Safe merge** to add compatible records, or **Restore replace** to replace this browser’s records. Financial identity conflicts must be resolved; safe merge must not silently overwrite an issued loan or payment.
4. Confirm the intended mode. A validated restore is committed transactionally. Review a borrower balance, a receipt and a document attachment after recovery.
5. Keep the original backup until the recovered totals and attachments are verified.

Do not edit financial data inside exported JSON. A malformed file, unsupported schema, checksum failure or conflicting immutable record should be rejected with an explanation. Restoring a backup does not turn it into two-way cloud sync.

**Clear all data** is a separate advanced operation. It requires a fresh verified backup, the exact phrase `CLEAR ALL OWEME DATA` and a final confirmation. Cloud backups are separate and are not automatically removed. Do not restore wiped records automatically.

Archiving uses the exact case-sensitive phrase `Delete Full Name`, replacing `Full Name` with the borrower’s actual name, followed by final confirmation. Despite that required phrase, the action is labeled Archive: financial history remains and the profile can be restored. Archive is not privacy erasure. Requests for erasure or anonymization need a separate review of applicable retention and legal obligations.

## Optional Google Drive setup

Drive is optional and never blocks local use. It uses Google Identity Services’ browser token model and the least-privilege `https://www.googleapis.com/auth/drive.file` scope. The browser holds short-lived access tokens only in memory. No service-account private key, OAuth client secret or server process belongs in this static app. [Google token-model guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Drive API** for that project.
3. Configure the Google Auth Platform consent screen: audience, app name, support/contact information and authorized domains as required by Google. Add your owner account as a test user while the OAuth app is in testing. Publication or verification requirements depend on the configured scopes and audience.
4. Create an **OAuth client ID → Web application**.
5. Add the exact **Authorized JavaScript origins**, with scheme and port but without a path: for example `http://localhost:5173`, `http://127.0.0.1:5173` if used, and `https://USERNAME.github.io`. `https://USERNAME.github.io/oweme/` is a project URL, not an OAuth origin. Add a custom domain’s origin separately.
6. Paste the public web client ID into OweMe’s Drive setting. A client ID is public configuration; a client secret is never used by this browser flow.
7. Click Connect and grant the requested file access. Run Back up now and wait for the API-confirmed successful time. Keep your portable local export as well.

The first successful upload creates `OweMe-backup.json`. The stored Drive file ID is reused for later `PATCH` uploads instead of creating a new copy every time. The remote modified time and version are checked before replacing the file; a detected conflict stops upload so the owner can inspect and recover it. An `If-Match` condition is also used when Google exposes an ETag. If no ETag is available, there is a narrow race between the preflight read and upload, so this is not an atomic multi-device write guarantee. Use one active editing device and review conflicts before recovery. [Drive file update API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update).

On another device, connect using the same Google Cloud client and Google account, then select the existing OweMe backup file from the app’s recovery list. Inspect it before restoring or adopting that file for later backups. `drive.file` can access files created or explicitly authorized for this app; it cannot enumerate arbitrary private Drive files. A different OAuth client may not have access to an older client’s files. Downloading the JSON from Drive and importing locally is a recovery fallback. A replace restore disconnects the imported file association to avoid silently overwriting another device’s backup.

Uploads can run only while OweMe is open, online and authorized. Returning to the app or reconnecting can resume pending work. Token expiry requires user interaction to authorize again. A pending label means local changes are saved but a cloud copy is not confirmed. Offline operation never claims upload success. Closing Safari or the installed iOS app can stop JavaScript and suspend work.

If Google rejects authorization, check the exact origin/port, Drive API status, test-user list, app publication state and requested scope. Popup blockers and browser privacy restrictions can also prevent the authorization window. Local loan and payment features remain available.

## Email and sharing

Email backup is off by default. The supported fallback is to download the real backup, open an email composer and attach that downloaded file yourself. A `mailto:` link cannot attach a browser file or confirm delivery. Unattended email would require a separately configured authorized Gmail API integration or secure service; this static build does not invent one.

Receipt sharing shows the selected information before invoking the native Web Share API where supported. Unsupported devices can download the PDF or copy a summary. The app cannot guarantee direct automated Messenger delivery. No borrower reminders are sent automatically.

## Deploy to GitHub Pages

The repository includes a GitHub Actions Pages workflow and hash-based routes. To publish, place the source in your own GitHub repository, push `main` and set **Settings → Pages → Source → GitHub Actions**. If your deployment branch has another name, update the workflow’s `on.push.branches` first. The workflow installs locked dependencies, runs its configured checks, builds and publishes `dist`. Actual publication requires access to that repository; generating this project alone does not create a public URL. [GitHub Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Set `VITE_BASE_PATH` to the complete project subpath including leading/trailing slashes, for example `/oweme/`, for `https://USERNAME.github.io/oweme/`. The included workflow derives this from the repository name. For a root `USERNAME.github.io` repository or a custom domain, change its build environment’s `VITE_BASE_PATH` to `/`. The same base is used for Vite assets and the PWA start URL/scope. [Vite Pages deployment guide](https://vite.dev/guide/static-deploy).

For a local project-subpath check in PowerShell:

```powershell
$env:VITE_BASE_PATH = '/oweme/'
npm.cmd run build
npm.cmd run preview
```

Open the `/oweme/` URL in the preview. Test the hash routes, reload, agreement export and offline reopen. If you change the deployment origin, recover the old origin’s records by exporting and importing; browser data does not move with the code.

Public GitHub source must never contain real borrowers, payment records, private exports, screenshots of real accounts, OAuth tokens or secrets. The application starts empty. The sample agreement under `docs/` uses blank/synthetic layout data only and is never imported into the app.

## Records, privacy and limits

- All posted amounts use integer centavos with one shared financial engine. The database transaction commits the record, unique reference and audit history together. UI previews do not write ledger entries.
- Newly issued agreements pin the borrower and business details present at release. Payment receipts pin identity at recording time, and reversals preserve their original payment identity. Renaming a profile or business later does not rewrite these documents. Older imported records without identity snapshots fall back to their loan snapshot or current profile; missing historical identity cannot be reconstructed automatically.
- Monthly dates are local calendar dates in Asia/Manila. No hidden monthly compounding or automatic late fee is applied.
- Payments apply to oldest unpaid installments. Overpayments are rejected with a clear explanation. Automatic advance-credit/refund accounting and signed financial amendments are intentionally outside this core release; handle a separate documented process instead of altering an issued record.
- A star rating measures full installments paid by the contractual date, not identity, sensitive attributes or creditworthiness. New borrowers are not rated before history exists.
- There is no forced app lock. Device security and access control matter: anyone with access to the unlocked browser profile can view these records. The app is not a substitute for device encryption, privacy notices or an appropriate retention policy.
- No legal-compliance claim is made for the default charge or any generated agreement. Lending, disclosures, pricing and personal data handling may require professional local review. The owner must check applicable requirements; avoiding borrower IDs does not establish an exemption.
- PDF exports work offline with bundled jsPDF fonts and use `PHP` for dependable currency printing. Printed statements distinguish historical receipt balances from the current balance and include archived borrowers where relevant.

See [feature status](docs/FEATURES.md) for implemented and optional work and the [workflow friction audit](docs/FRICTION-AUDIT.md) for click-path verification status.
