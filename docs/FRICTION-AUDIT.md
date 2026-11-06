# Workflow friction audit

Count only meaningful screens and deliberate actions, excluding the individual keystrokes needed to enter a name or amount. Counts below describe the implemented flow design. Browser observations must be recorded separately after the end-to-end run; a design count is not a claim that a device test passed.

| Task | Intended compact path | Screens / key actions | Unnecessary steps excluded |
| --- | --- | --- | --- |
| Add borrower | Home or Borrowers → Add borrower → type full name → Save → profile | One entry form and resulting profile; one Save | No registration, PIN, mandatory phone/address, ID upload or onboarding wizard |
| Issue loan | Borrower profile → New loan → enter money → Review release → Confirm funds released | One live form, one review; two deliberate financial actions | No Calculate button, repeated review or mandatory printing |
| Take payment | Borrower profile → Record payment → enter amount → Confirm payment → success/receipt | One compact form and success; one posting confirmation | No second “Are you sure?”, cash bank fields or separate allocation wizard |
| Find old receipt | Transactions → search name/reference → transaction → View receipt | Search/history and transaction detail; PDF action | No export-menu chain or unrelated borrower pages |
| Export backup | More → Backups → Export backup | One backup view and export action | No OAuth prerequisite or cloud account requirement |

## Browser observations

Pending the parent implementation's browser run. Record viewport, actual clicks, state preservation, money updates, result and any remaining friction here after observing the flows. Do not treat the intended counts above as measured results.

Required viewports: 375px and 430px phone, 768px tablet portrait, 1024px tablet landscape and desktop. Check software-keyboard access separately on an actual touch device; desktop emulation cannot verify a real iOS keyboard or VoiceOver session.

For each observed task, check:

- Empty initial database and no fake borrowers.
- A clear next action and only genuinely required inputs.
- Live arithmetic and stable focus while editing.
- No posted transaction before confirmation.
- Clear, single success state after successful local commit.
- Back navigation preserves or explicitly protects unsaved work.
- Help opens and closes without saving, navigation or form reset.
- Relevant button remains visible without horizontal page overflow.
- Missing OAuth, sharing or offline capabilities show truthful alternatives.
