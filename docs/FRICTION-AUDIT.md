# Workflow friction audit

Count each field entry as one action and each tap/click as one action; do not count individual keystrokes. The table describes the normal path using the existing loan defaults and a single selected loan. Editing optional terms or choosing between multiple loans adds only the corresponding field actions.

| Task | Compact path | Normal actions | Unnecessary steps excluded |
| --- | --- | --- | --- |
| Add borrower | Home or Borrowers → Add borrower → enter full name → Save → profile | 3: open form, enter name, save; one entry form | No registration, PIN, mandatory phone/address, ID upload or onboarding wizard |
| Issue loan | Borrower profile → New loan → enter money → Review release → Confirm cash released | 4: open form, enter money, review, confirm; one form and one final review | No Calculate button, repeated review or mandatory printing |
| Take payment | Borrower profile → Record payment → enter amount → Confirm payment → success/receipt | 3: open form, enter payment, confirm; one compact form and success | No second “Are you sure?”, cash bank fields or separate allocation wizard |
| Find old receipt | Transactions → search reference → matching transaction → View receipt | 4: open history, enter search, open record, open PDF | No export-menu chain or unrelated borrower pages |
| Export backup | More → Backups & recovery → Export backup | 3: open More, open backup view, export | No OAuth prerequisite or cloud account requirement |

## Browser observations

Verified on November 6, 2026 (Asia/Manila), using Playwright with Chrome: all 24 browser tests passed. The browser suite covers 375×812 and 430×932 phone portrait, 812×375 phone landscape, 768×1024 tablet portrait, 1024×768 tablet landscape and 1440×1000 desktop. Phone/tablet touch is emulated.

The compact paths above were exercised. They remain baseline interaction counts, not timings from a human usability study: the regression scenarios deliberately add term edits, amount changes and screenshot/focus operations.

| Observed task | Result |
| --- | --- |
| Add borrower | Starts with zero borrowers. Only full name is initially visible; open, fill and save creates `001` and opens the profile. |
| Loan preview and release | Editing repayment from PHP 3,000 to PHP 2,000 updates cash from PHP 2,700 to PHP 1,800 while retaining input focus. No ledger entry exists before confirmation. Review plus confirmation creates one loan with the December 5, January 5 and February 5 schedule. |
| Payment | PHP 500, 1,000 and 3,000 produce balances of PHP 2,500, 2,000 and zero; overpayment disables confirmation. Cash hides optional reference fields, and changing methods retains the amount. Two immediate confirmation clicks still create one payment and receipt. Reload preserves it. |
| Old receipt | Open Transactions, search the saved reference, open the matching row and choose View receipt. The historical PDF opens without posting another payment. |
| Help and Back | Escape closes contextual help and returns focus; Enter reopens it without resetting money. Browser Back offers Keep editing or Leave form. Keep editing retains the cash target and route; leaving returns to the profile without posting money. |
| Backup while offline | Open More, Backups & recovery and Export backup. The downloaded JSON contains the actual borrower, loan, release entry and SHA-256 checksum. Search finds the borrower by ID, then continues working by name after going offline. |
| Correction and archive | Receipt sharing requires a privacy review; PDF download has a real PDF header. Reverse PHP 500, record PHP 200 and archive the borrower: the PHP 2,800 balance and all four ledger entries remain in history. |
| Layout and focused fields | No horizontal page overflow in the checked home, loan, payment and archived-history views. Portrait phone summaries remain visible while editing. Focused amount checks use viewport bounds and five hit-test points to detect covering elements. |

The initial screenshot review found the focused payment input partly behind the action bar at 375px. Loan and payment forms now reveal focused fields between the sticky summary and footer, including when the visual viewport resizes. Fresh screenshots show the full phone input above the bar; tablet and desktop money/controls also have no observed clipping. Generated screenshots and the HTML report are under the ignored `test-results/` and `playwright-report/` directories.

Production checks separately verified cached offline reload, offline record persistence and offline agreement PDF generation at `/` and `/oweme.v1/`, with zero uncaught browser errors. Live Google authorization/upload/recovery, unsupported native-share fallbacks and actual delivery to another person were not exercised by this browser run.

Real software keyboards, iOS installation, VoiceOver, camera behavior and physical printing still require device checks. A very short visual viewport can leave less space than the sticky summary, field and action bar together; desktop touch emulation does not certify real keyboard access.
