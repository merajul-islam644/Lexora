# Lexora testing guide

What is tested, where, how to run it, and what is deliberately not
covered. Run everything with `npx vitest run`; typecheck with
`npm run typecheck`.

## Suites

| File | Count | What it covers |
| --- | --- | --- |
| `tests/unit/api.test.ts` | 34 | The route layer (`createApiRouter`): tenant isolation (404 anti-probing), role ladder (viewer→owner) on every gate, escalation blocks, job isolation, generate cooldown (429/409 ordering), audit events (member role change, removal, cancellation, deletion, exports), tombstone survival after workspace delete, avatar audit events, full-workspace export envelope |
| `tests/unit/generator.test.ts` | 14 | The generation engine: profile construction, name candidates, **regeneration schema contract** (150 seed pairs prove gen-2 over gen-1's drafts never blows the warning cap — the historical flake), foreign-sound note caps |
| `tests/unit/practice.test.ts` | 13 | Queue scheduling, mode enrichment (MCQ distractors, fill-blank contexts), grade normalization |
| `tests/unit/languageDiff.test.ts` | 6 | `diffProfiles` purity: name/order/rules/vocab deltas |
| `tests/unit/csv.test.ts` | 15 | Import/export round-trips |
| `tests/unit/a11y.test.tsx` | 3 | jest-axe scans: public landing (full shell), Practice + Grammar error states (see [a11y-checklist.md](a11y-checklist.md)) |

Current state: **85 tests, all green, 3 consecutive full-suite runs** at the
time of writing.

## The test seam

`src/web/api.ts` exports `createApiRouter(deps)` — every handler gets its
`store`, `identity`, `files` and `schedule` from an injected factory. Tests
build a router over a throwaway SQLite store (helper `makeTestEnv` +
`createWorkspace`/`addEntry`/`insertJobRow` in `tests/unit/helpers.ts`) and
call `router.request("GET", "/api/ws/...")` directly, injecting a fake
identity (`email`, `name`). The browser uses the same factory with real
Blocks Gateway deps — **the handlers under test are the ones that run in
production**, only the transport differs.

`routerFor` fires the schedule fire-and-forget (realistic for the SPA);
`scheduledRouterFor` collects scheduled work and drains it explicitly
(deterministic for generation assertions).

## Store seam (the honest gap)

Business logic is tested against **sqliteStore**. The Blocks Gateway store
(`blocksStore.ts`) implements the same `DataStore` interface but is **not
covered by the suite** — there is no test double for the live Gateway, and
integration tests against the real project would be slow, stateful and
tenant-mutating. Mitigations:

- the interface is small and shared; any behavior the Gateway store breaks
  fails loudly in the app, not silently;
- gateway-level configuration (field validations, RLS) is deployed via the
  CLI and smoke-tested live per [production-checklist.md](production-checklist.md) §8;
- the app-level route tests run on every push, so regressions surface in
  CI-shaped workflows before deploy.

## Deliberately not covered

- **End-to-end browser flows.** No Playwright/system-test suite runs in CI;
  the responsive-QA and deploy-time smoke passes are manual records
  ([responsive-qa.md](responsive-qa.md), production-checklist §8). The
  trade: no flaky browser farm, at the cost of manual release-time checking.
- **Live Gateway behavior under the deployed policies** (what a *forged*
  request sees) is verified by reading the platform's policy semantics and
  smoke tests, not by automated adversarial tests.
- **Avatar upload against real Azure storage** — unit tests stub `files`;
  the presigned flow is exercised manually.

## Adding tests

Follow the existing patterns: `makeTestEnv` for a fresh DB per test,
`expectApiError` for error-shape assertions, and explicit timeouts
(`, 120_000`) for long loop tests — the default 30s is tight under full-suite
load. Generation-loop tests must stay under ~150 iterations to keep the
suite fast; the flake regression test's math targets ≥4σ there.
