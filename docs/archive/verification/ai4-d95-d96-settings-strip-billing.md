# AI #4 — D-95 settings module strip on phones, D-96 Billing & Plan in dark mode

Based on main 6007d05.

**D-95.** The overlapping labels ("Pre Data Sup Help Doc Pricing API" at 390px) were the module strip above Settings
(`ModuleSubNav`): D-78 had made only the Reports group's buttons keep their width. Every module group now gets the
same rules: buttons never shrink (whole labels on one scrolling row), 44px targets, visible keyboard focus,
`aria-current="page"` on the current page, decorative icons hidden from screen readers. The current page is revealed by
scrolling the strip only, on selection and again when the strip is resized (ResizeObserver, disconnected on cleanup).
Routes, registry, visibility rules (owner/pro/developer/modules) are unchanged.

**D-96.** Billing & Plan used fixed light colours (`bg-white`, `slate-*`, `indigo-50/100`), so the panel and plan cards
stayed white in dark mode. They now use the theme variables (`--panel`, `--surface`, `--elevated`, `--line`, `--text`,
`--muted`, `--brass*`); the past-due banner gets `dark:` amber variants; white-on-indigo buttons/badges stay (readable in
both themes). The "Popular" badge was positioned against the wrong box (its card had no `relative`); fixed. Plans,
prices, checkout and portal calls are unchanged.

**Checks.** `e2e/settings-tabs.spec.ts` (390px, light and dark): one non-overlapping row of whole labels ≥ 44px,
strip scrolls, Enter on the last page reveals it, no page-level horizontal scroll; Billing panel background and
headings equal `--panel` / `--text`, dark plan cards not white. Fails on the old code (whole-label check), passes
2/2 now; D-78 `report-tabs.spec.ts` still 2/2. Before/after images: [images/d95](images/d95), [images/d96](images/d96).

**Visual references.** The Settings references (and any screen whose module strip had shrinking buttons) change; local
Chromium differs from the CI-captured baselines even on untouched screens, so they must be refreshed with the
"Refresh visual baselines" workflow and the images looked at before merge. Not done here.

Release gate: W1 navigation evidence only; W1 stays incomplete.
