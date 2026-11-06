# Lexora security model

What actually protects a Lexora workspace, what enforces it, and — just as
importantly — what does **not** protect it. Written to be honest rather than
reassuring: every claim here is backed by code you can read, and every
residual risk is named.

## Architecture in one paragraph

Lexora is a **zero-backend** application: a React SPA plus the SELISE Blocks
platform. There is no Lexora server, no Lexora Function, no session cookie of
ours. The browser holds the user's Blocks SSO token; every data call goes from
the app's data layer ([src/web/api.ts](../src/web/api.ts)) straight to the
Blocks Data Gateway with that token, and avatar files go to Blocks Data
Storage with short-lived links. Identity lives entirely in Blocks IAM.

## Who enforces what

| Control | Where it is enforced | Notes |
| --- | --- | --- |
| Sign-in | Blocks IAM (SSSO/OIDC) | Lexora never sees a password; there are no Lexora sessions to revoke — sign-out ends the Blocks session. |
| Workspace membership & roles | `requireWorkspace()` in the app's data layer | Re-checked on **every** route call against the membership store: viewer < editor < admin < owner, plus capability gates from `PERMISSIONS` (e.g. `members:manage`, `dictionary:export`). |
| Anti-probing | Same layer | A workspace you don't belong to answers **404 not_found**, not 403, so its existence is not confirmed to outsiders. |
| Job & language isolation | Same layer | Jobs and language routes resolve only inside the caller's own workspace. |
| Audit trail | `logActivity()` on every state change | Includes membership changes (with from→to), cancellations, deletions and full-workspace exports. Activity rows **outlive** their workspace (tombstones survive a delete; `listDetachedActivity()` is the post-mortem reader). |
| Avatar privacy | Blocks Data Storage (Private access modifier) | The app only ever hands the browser short-lived download URLs; the pointer lives in `UserProfile`. |
| Translation privacy | By construction | Flagging a bad translation records direction + reason only — never the source or translated text. |
| Generate cooldown | App's data layer | 30s per workspace. An **in-browser safeguard** against double-clicks and runaway loops — not a server-side quota. |

## Residual risks (read this)

These are real today. Each is a deliberate consequence of the zero-backend
decision, documented rather than hidden:

1. **Application-layer enforcement only.** All authorization runs inside the
   SPA's data layer using the user's own token. A technically skilled signed-in
   user can modify the running app in their browser and skip those checks; the
   Gateway cannot distinguish their calls from the app's. The Gateway's schema
   rules (`policies`) are the platform-level second line — see the production
   checklist for the deployed hardening state.
2. **Shared-content schemas are User-level at the Gateway.** Workspace
   content schemas (dictionary, language, activity…) are readable/writable
   through the Gateway by any valid tenant identity; isolation is provided by
   the app layer, not by Gateway row-level rules. Two schemas ARE row-level:
   `UserProfile` and `LearningProgress` reads are **Custom** with a
   self-only policy (`CreatedBy` = caller) — a hand-built Gateway request
   gets only the caller's own profile and practice rows.
3. **No server-side rate limiting.** The 30s generate cooldown is the only
   throttle, and it lives where the user controls it. Sustained abuse of the
   Gateway is a platform concern, not an app control.
4. **No automatic backups.** The Settings → "Download full backup" JSON export
   is the only backup mechanism; restore from it is a manual, ops-level job.
5. **Forged membership rows.** A user with direct Gateway write access to
   `WorkspaceMembership` could insert themselves as an owner of any workspace
   (tests document this as a trust root). Membership writes through the app are
   admin-gated; direct Gateway writes are the residual exposure.
6. **No MFA / account deletion in the app.** Both live in the IAM Console;
   Lexora deliberately does not reimplement them.

## Platform hardening (deployed 2026-11-06)

Items that depend on the Blocks project configuration rather than this
repository are tracked — with their deployed status — in
[production-checklist.md](production-checklist.md): gateway `maxlength`
validation rules mirroring the app's zod caps (deployed, 39 rules),
self-only RLS on `UserProfile` and `LearningProgress` reads (deployed and
smoke-tested live), storage configuration review, and MFA enforcement at the
IAM level (still an IAM Console task).
