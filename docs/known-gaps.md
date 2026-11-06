# Lexora known gaps

What the product does **not** do today, stated plainly, each with the
design-spec pointer and the reason. Nothing on this list is hidden behind
marketing language; most are consequences of the zero-backend decision or
explicit de-scoping.

1. **No server-side rate limiting** — the 30-second generate cooldown lives
   in the app's data layer, inside the browser. A determined user can bypass
   it. Sustained abuse of the Gateway is a platform concern (§17). See
   [production-checklist.md](production-checklist.md) §4.

2. **No sessions, MFA or account deletion in the app** — sign-in is SELISE
   Blocks SSO only; there are no Lexora sessions to harden, but that also
   means MFA, account recovery and erasure live entirely in the IAM Console
   (§18). Lexora deliberately does not reimplement identity management.

3. **Shared-content schemas remain User-level at the Gateway** — workspace
   isolation is enforced in the app's data layer on every call; a skilled
   signed-in user can bypass those checks with a hand-built request and the
   Gateway cannot distinguish them. `UserProfile` and `LearningProgress`
   reads ARE row-level (self-only RLS deployed); the nine shared-content
   schemas are not, because the policy grammar cannot express a
   workspace-membership join (§14, §20). Residual risk documented in
   [security-model.md](security-model.md) risks 1–2 and 5.

4. **No end-to-end browser test suite** — per the project decision, coverage
   is route/store-level integration tests (85 tests) plus recorded manual
   passes: [responsive-qa.md](responsive-qa.md) and the deploy-time smoke in
   production-checklist §8. No automated E2E runs in CI.

5. **No automatic backups** — the only backup is the per-workspace JSON
   export (Settings → Download full backup). There is no point-in-time
   recovery; restore is a manual re-insert from the export envelope with no
   dedicated UI (§14).

6. **Translation "Report incorrect" is an audit note, not a workflow** — the
   flag records direction + reason in the activity log (never the text
   itself, for privacy). Nothing consumes the report: no queue, no reviewer
   UI, no closure state (§13). It exists so problems are visible, not to fix
   them.

7. **Generation jobs are tab-bound** — a job continues server-side only
   while the browser runs the runner. Progress survives a reload
   (re-suspended from the job record), but closing the tab abandons a
   running job; the stale-job banner offers Cancel/Retry rather than
   pretending the work continues elsewhere (§8).

8. **Word Builder approval keeps status "approved"** — a human-reviewed
   generated word is approved directly; the human edit-step plus the
   `source: "generated"` badge is the discrimination between human and
   generated words. There is no separate "pending approval" state machine
   (§16.4). Draft status is reserved for the generator's bulk output.

9. **Blocks Gateway store has no automated tests** — the suite tests
   business logic over the SQLite implementation of the `DataStore` seam;
   `blocksStore.ts` (the real Gateway mapping) is exercised manually and by
   the live gateway smoke. Any store-behavior drift fails loudly in the app
   rather than silently in CI. See [testing.md](testing.md).

Each gap is a decision, not an oversight — if one of them matters more to
you than the trade it bought, say so and it becomes the next work item.
