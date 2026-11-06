# Lexora accessibility checklist

What is automated, what is manual, and what each covers. The automated part
runs in the normal test suite (`npx vitest run tests/unit/a11y.test.tsx`).

## Automated (every test run)

- **axe-core scans** via jest-axe on three render states:
  - the public landing page (header, hero, sections, footer — the full
    `PublicLayout` shell including the skip link and `<main>` landmark),
  - the Practice page in its load-error state (`ErrorNote` + retry),
  - the Grammar Workspace in its no-grammar/error state (`EmptyState`).
- The app pages are rendered inside a `<main id="main-content">` wrapper that
  mirrors the deployed `AppShell` structure, so the `region` rule sees the
  same landmarks users see.
- Heading outline: `PageHeader` renders the page `h1`; section headings are
  `h2`; sub-groups `h3`; `EmptyState` titles are `h2` (they sit directly under
  the page `h1`). This is what the `heading-order` rule verifies on the
  Grammar page.

## Implemented in code

- Skip-to-content link in both shells (`AppShell` and `PublicLayout`), hidden
  until keyboard-focused, jumping to `#main-content`.
- `Modal` traps Tab focus inside the dialog (cycles between first and last
  focusable element), closes on Escape, restores focus on close, and labels
  itself with `aria-modal` + the title.
- `lang="bn"` on every element that renders Bengali text (the `.bn` class
  surfaces in Dashboard, My Language, Grammar, Dictionary, Word Builder).
- `aria-live="polite"` regions: Practice answer feedback (`role="status"`)
  and the Translation Lab result card.
- Labels/`aria-label`s on icon-only buttons (avatar menu, sidebar collapse,
  remove-member, close dialog, theme toggle), `role="menu"`/`menuitem` on
  dropdowns, `aria-expanded` on disclosure buttons.

## Manual pass (run before a release, tick each)

Keyboard:

- [ ] Tab through the landing page: skip link appears first and jumps to content.
- [ ] Tab through the app shell: sidebar → topbar → content order is logical.
- [ ] Open the Add-member dialog: focus lands inside it; Tab cycles inside
      only; Escape closes and focus returns to the trigger button.
- [ ] Every action (save word, generate, cancel job, delete workspace) is
      reachable and operable with keyboard only — no pointer-specific handlers.

Screen reader spot-check (NVDA or VoiceOver):

- [ ] Page title changes per route (`document.title`).
- [ ] Practice feedback announces "Correct!"/"Not quite." without a page reload.
- [ ] Translation Lab result is announced when it arrives.
- [ ] Table headers are announced on Dictionary and Activity Log tables.
- [ ] Bengali text is read with Bengali voice where `lang="bn"` is set.

Visual:

- [ ] Zoom to 200%: no clipped controls, no horizontal scrolling at 1280px.
- [ ] Dark mode: text contrast holds on badges, chips and muted copy.
- [ ] Focus outlines are visible on every interactive element in both themes.

## Known limits

- The automated scans cover three render states, not every page × state
  combination; the manual pass covers the rest.
- Speech synthesis ("Hear it") depends on the browser's available voices;
  there is no fallback audio. The button degrades to a toast when speech is
  unavailable.
