# Lexora production checklist (platform-side)

The app-side hardening lives in the repo (see [security-model.md](security-model.md)).
This file tracks what must be configured **on the SELISE Blocks project** —
things the repository cannot enforce by itself. Status as of 2026-11-06.

## 1. Data Gateway field validation — deployed

The app's zod schemas ([src/shared/schemas.ts](../src/shared/schemas.ts)) cap
every user-facing string. The gateway now mirrors those caps with `maxlength`
validation rules, so even a call that skips the app's validation layer is
rejected at the database boundary:

| Schema | Fields with maxlength rules |
| --- | --- |
| Workspace | name·80, normalizedName·80, organizationId·120 |
| DictionaryEntry | word·80, normalizedWord·80, bengaliMeaning·200, englishMeaning·200, pronunciationGuide·120, ipa·120, partOfSpeech·40, root·120, wordFormationExplanation·600, prefixes·120, suffixes·120, grammarNotes·600, mnemonic·400, source·20, status·20, learningStatus·20 |
| Phrasebook | sourceText·2000, translatedText·2000, sourceLang·20, targetLang·20, note·400 |
| Language | name·40, normalizedName·40, description·400, status·20 |
| WorkspaceMembership | userId·200, role·20 |
| UserProfile | userId·200, avatarFileId·200 |
| GenerationJob | status·20, style·40, preferredName·40 |
| LearningProgress | status·20 |
| ActivityLog | action·80, resourceType·40, resourceId·200 |

Deliberately **not** capped: serialized-JSON fields (`profileJson`,
`snapshotJson`, `historyJson`, `exampleSentencesJson`, `stagesJson`,
`resultJson`, `metadataJson`, `referenceLangs`) — their size is already
bounded structurally by the zod schemas that produce them, and a wrong
maxlength there would corrupt real documents.

Maintenance rule: **when a zod cap changes, change the gateway rule to
match** (and vice versa). A drift means the app and the boundary accept
different data.

## 2. Row-level policy — UserProfile (deployed)

- `UserProfile` READ access = **Custom**, governed by one RLS policy:
  rows are readable only when `CreatedBy` equals the caller's user claim.
  Result: a signed-in user can read only their own profile row through the
  Gateway, even with a hand-built request.
- Write/Edit/Delete on `UserProfile` remain **User** level: the app creates
  and updates the caller's own row on first use; narrowing those to policy
  needs the same `CreatedBy` rule applied per operation and is a follow-up.
- The app only ever reads its own profile
  ([blocksStore.ts](../src/core/db/blocksStore.ts) queries by `userId`),
  so the policy is app-compatible — verified live: profile page, avatar
  included, renders with the policy deployed.

## 3. Shared-content schemas — still User level (accepted risk)

`Workspace`, `WorkspaceMembership`, `DictionaryEntry`, `Language`,
`LanguageVersion`, `GenerationJob`, `Phrasebook`, `LearningProgress`,
`ActivityLog` are readable/writable by any valid tenant identity at the
Gateway. Workspace isolation is enforced in the app's data layer
(`requireWorkspace()` on every call). An RLS rule like
`workspaceId ∈ (memberships of caller)` would need a join the policy grammar
cannot express across collections — if a future platform release supports
lookups or claims carrying workspace ids, revisit; until then this stays a
**documented residual risk** (risk 2 in security-model.md).

## 4. Rate limiting — not available app-side

The 30-second generate cooldown is an in-browser safeguard. The Gateway has
no per-user quota surface in the current CLI. If abuse becomes real:
front the Gateway with the platform's API management (if offered at the
OS portal level), or accept that signed-in users are trusted users. Do not
attempt to build throttling inside the SPA — it is unenforceable there.

## 5. Backup & restore

- **Mechanism:** Settings → Download full backup (JSON) per workspace
  (`GET /api/ws/:id/export/all`, admin/owner only, envelope
  `lexora-workspace-export/v1`).
- **Cadence recommendation:** after any significant dictionary/language work
  and at least weekly for active workspaces. There is no automatic backup.
- **Restore drill (do once before real use):** spin a fresh workspace, import
  the JSON via a small script against the Gateway (no restore UI exists —
  the envelope is a complete document set, so restore is a mechanical
  re-insert), verify dictionary/language/practice surfaces. Record how long
  it took; that number is the real RTO.

## 6. IAM-level items

- **MFA**: enforced in the SELISE Blocks IAM Console, not in Lexora. Turn it
  on for all members before production use.
- **Account deletion / GDPR-style erasure**: an IAM operation. Lexora's app
  data (profile row, memberships, progress) should be cleaned as part of the
  offboarding runbook; there is no in-app flow by design.
- **Role hygiene**: Lexora workspace roles are its own membership records,
  independent of IAM roles; onboarding should grant Blocks directory access
  first, then an owner adds the member inside Lexora.

## 7. Incident rollback

- Gateway rules: `blocks data validation delete <id>` per rule; policies via
  `blocks data rules policy delete <itemId>`; followed by
  `blocks data reload --yes`. Every deploy step has a `--dry-run`; keep the
  pulled `blocks/data/rules.json` + schemas in version control as the
  rollback source of truth.
- App code: single-repo SPA; roll back by redeploying the previous build —
  schemas and rules are backward compatible (the app never sends values
  beyond the caps above).

## 8. Deploy-time smoke (run after any gateway change)

Sign in → Dashboard → Dictionary (add + search a word) → My Language
(generate or open existing) → Grammar page → Practice (answer one card) →
Translation Lab (translate a phrase) → Security & Access (members list) →
Activity Log (latest event present) → Settings (download backup).
