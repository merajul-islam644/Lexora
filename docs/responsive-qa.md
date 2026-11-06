# Responsive QA record

Verified against the running dev server (https://dirion.slsblx.com:5173) on
2026-11-06. Public routes were captured with headless-Chromium screenshots;
the signed-in app routes were driven through the live app (user's SSO
session) and captured at 1440 / 768 / 375. Screenshots live in
`responsive-qa/` (untracked — not part of the repo history).

## Breakpoints the stylesheet defines

| Width | What changes (from `styles.css`) |
| --- | --- |
| ≤ 900px | Sidebar becomes an off-canvas drawer (hamburger in the topbar); content padding tightens to 16px; IAM Console splits stack vertically; Word Builder grid stacks |
| ≤ 820px | `.grid-3`/`.grid-2` collapse to one column; metric tiles go 2-up; Translation Lab three-column view stacks |
| ≤ 640px | Public nav hides the middle links (Features/Security); form rows go single-column; modal padding tightens |

## Captured pass (public routes)

- **1440 × 900** — Landing: full nav (Features, Security, Sign in, Get
  started), hero centered, three "How it works" cards in one row. No
  overflow. ✓
- **1024 × 900** — Same layout as 1440; cards still 3-up, comfortable. ✓
- **768 × 900** — Feature cards stacked single-column (820 breakpoint), hero
  type scales down cleanly, full nav still fits. ✓
- **375 × 900** — Nav collapses to Sign in + Get started (640 breakpoint);
  hero, buttons and cards all single-column; **no horizontal scrolling**. ✓
- **Sign in (all widths)** — SSO card centered, single button, no password
  field; copy reads "there is no separate Lexora password". ✓

Screenshots are not committed to the repo; re-run the capture with any
headless Chromium (`--screenshot --window-size=W,900 https://…/`) if you need
them again.

## Captured pass (signed-in app routes)

- **1440 × 900, Dashboard** (`dashboard-1440.png`) — sidebar with labels,
  metrics 4-up, greeting, empty-state CTA; no overflow. ✓
- **1440 × 900, Settings** (`settings-1440.png`) — Workspace / Appearance /
  **Backup & export** (honest copy + "Download full backup (JSON)") / Danger
  zone all render; ✓
- **768 × 900, Grammar** (`grammar-768.png`) — sidebar hidden behind the
  hamburger; page shows the honest no-grammar empty state with Retry; no
  overflow. ✓
- **375 × 900, Dictionary** (`dictionary-375.png`) — filter rows stack,
  empty-state with CTA fits; ✓
- **375 × 900, My Language** (`language-375.png`) — spec empty state
  ("Create your private language"), Generate CTA, Add/Import dictionary and
  the starter-dictionary action all fit without horizontal scrolling. ✓

Dark-mode spot check at each width remains part of the release manual pass
below (single toggle, visual only).
