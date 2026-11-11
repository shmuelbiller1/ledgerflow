# Broken open PRs — triage and repair (2026-11-05)

Owner request: *"look at all the open PRs that are broken there, and fix it"*.

Base: `main` @ `7550f2b`. Integration branch: `arena/1e39a844-ledgerflow`.

## Why the PRs looked broken

Every open PR came from the fork `Chaim-Richard/ledgerflow`. Three separate causes were mixed
together, and only one of them was a code failure:

| Cause | PRs | Nature |
|---|---|---|
| `CONFLICTING` / `DIRTY` — branch base is 1,000+ commits behind `main` | 537, 536, 526, 524, 533, 531, 527, 525 | real conflicts, mechanical to resolve |
| Genuinely red CI | 526 (typecheck `Cannot find name 'jest'`, `node:test` has no `expect`, `CspReportOnlyConfig`; dependency audit exit 2), 537 (Playwright E2E, Sonar duplication 4.4% > 3%) | real code work |
| `Vercel = FAILURE` | **all 11** | `"Authorization required to deploy."` — fork deploys are not authorized. **Not a code failure.** Owner action, deliberately left red |
| Checks merely queued | 522 | nothing to fix |

`main` itself is green on `tsc` at `7550f2b` (verified locally), so none of this was broken `main`.

## Disposition, PR by PR

| PR | Branch | Disposition |
|---|---|---|
| #538 | `ai8/f-48-deterministic-axe` | **Integrated.** Auto-merge produced a **duplicate `waitForFiniteAnimations`** (main already has one); kept the single definition. |
| #537 | `ai7/F-48-flaky-axe-contrast` | **Integrated.** `view-registry-coverage.spec.ts` conflict resolved to one settle step (no fixed `waitForTimeout(500)`), using the shared finite-animation helper. |
| #536 | `ai7/F-41-browser-journey-test-W2` | **Integrated.** `w2-invoice-payment-statement.spec.ts` takes the branch's improved spec (main + 457/−94); `RELEASE_GATE.md` keeps main's already-fuller W2 row. Dropped 4 unused bindings it introduced so lint stays at cap. |
| #535 | `arena/8b539c5d-ledgerflow` | **Integrated.** `LINE_COUNT.md`: main's measured history plus the branch's 2026-11-05 row. |
| #534 | `arena/b7d3879b-ledgerflow` | **Integrated (documents).** Every audit file conflicted `add/add`; main holds a later revision of the same 28 Oct delta *plus* the AF-011 fix notes, so main's copies are kept. No finding dropped. |
| #533 | `arena/3310a772-ledgerflow` | **Integrated.** `COORDINATION.md` S-22 rate-limit audit entry. |
| #531 | `arena/ai4-af001-audit-only` | **Integrated + corrected.** Evidence said `/sync` persists the cursor *before* responding. That is fixed on main (`storePlaidSync` writes bank lines and moves the cursor in one transaction), so keeping both sides' lines would have left contradictory evidence. The doc now records the server half as fixed and the **caller half as still live** (Banking “Sync now” never persists `transactions`/`modified`/`removed`). |
| #527 | `arena/3f7e3a1d-ledgerflow` | **Partly integrated.** Dashboard D-85 heading, the plain setup-checklist wording and the D-92 sidebar balances box are taken; `EmptyState` keeps main's `action` render prop (Banking uses it) and gains the 44 px tap target. **Settings section is not taken:** main already ships five sections + search from #274, so the branch's parallel `settingsSections.ts` / `settings-navigation.test.tsx` would have been a second implementation. `icon-button-labels.test.ts` now asserts main's labelled search field. |
| #524 | `arena/95baad41-ledgerflow` | **Integrated.** Error grouping, log redaction, flaky report, release notes, layers guard, offline wording, mobile statement layout. Three follow-up fixes below. |
| #526 | `ai6/s-1-to-s-5-security-tasks` | **Not integrated — recommend closing.** Main already ships a *newer* Postgres-backed shared rate limiter (`sharedRateLimiter.ts`, migration `20261021000000_shared_rate_limit_entries.sql`); the branch redefines that module and calls a `createSharedRateLimitMiddleware` that no longer exists. Its tests are also written for Jest inside a `node:test` runner (`jest.fn()`, `expect` from `node:test`), which is exactly what its red typecheck reports. Its genuinely new pieces (`.gitleaks.toml`, secrets/dependency-audit workflows, `securityHeaders.ts`, `cspReportOnly.ts`) are worth re-landing **on top of current main** by their owner, not by rebasing the old branch. |
| #525 | `arena/6fe13103-ledgerflow` | **Not integrated — already delivered.** G-9 (safe IL/US guest sample books) is on main in a richer form: bilingual names, 12 months, invoices and bills, `buildResetDemoWorkspace`, `canUseDemoSandbox`. The branch's `countryDemoWorkspace.ts` is an earlier, thinner version (5 accounts, no invoices/bills) and would regress it. |
| #522 | `ai9/audit-f4-f5-payments` | Nothing broken. Checks were queued/passing; Vercel only. |

## Code fixes made on top of the merges

1. **`e2e/support/a11yGate.ts`** — removed the duplicate `waitForFiniteAnimations` that the #538
   auto-merge introduced beside main's copy.
2. **`src/tests/layers-guard.test.ts`** — the new F-40 guard counted *type-only* imports. Two screens
   import a **type** from `src/server/services` (erased by the compiler, no server code in the
   bundle), so the guard went red on correct code. It now skips `import type` and inline `{ type X }`
   bindings and still counts value imports, proven in both directions by a new test.
3. **`src/components/platform/ConnectionBanner.tsx`** — the merged batch deferred the “All changes
   saved” confirmation behind `setTimeout(…, 0)`, which drops it whenever the store change arrives
   outside an `act()` scope (the banner said nothing after a reconnection). Confirmation is set in the
   same render again, and the stale value is cleared during render rather than by `setState` inside
   the effect (`react-hooks/set-state-in-effect`).
4. **`src/components/Dashboard.tsx`** — the merge left `SavedViewsBar` imported but unused (a lint
   error, and a main feature missing from the page). Restored inside `DashboardWidgets`, and the
   duplicated widget children from the branch's tail were dropped.
5. **`src/components/sales/OrderInvoiceDialog.tsx`** — import only the helpers the file calls.

## Verification in this sandbox

- `npx tsc --noEmit` — clean.
- `npx eslint . --max-warnings 42` — **0 errors / 42 warnings** (the repo's cap, unchanged).
- `npm run build` — passes (client + `server.cjs` + `api.cjs`).
- `src/tests/layers-guard.test.ts` 4/4; `connection-banner` + `data-status-bar` 8/8;
  `icon-button-labels` + `sidebar-balances` + `dashboard-widgets` + `widget-refresh` 11/11;
  #524's new suites 46/47 then all green after fix 1.
- Unit shard 1/4: 1064 tests, **1063 pass, 1 fail** — A-229's performance budget. Shards 2–4 run
  outside this note.
- The two timing failures (A-229, A-206) **reproduce on unmodified `main` in this sandbox** (measured
  in a clean `origin/main` worktree), so they are machine-speed noise, not this integration.

## What the owner still has to do

- **Vercel**: red on all 11 fork PRs is `"Authorization required to deploy."` — authorize the fork for
  Vercel, or make the check non-blocking for fork PRs. Left red on request.
- **#526** and **#525**: close as superseded, and re-land #526's secrets/CSP/audit-workflow pieces from
  current `main` if they are still wanted.
- The remaining 10 PRs can be closed once this branch lands; their content is either here or already
  on `main` (noted per row above).

## Final state — PR #539 is green and mergeable

All 25 checks pass on `8b191e3f`: SonarCloud quality gate (A security, duplication under 3%),
CodeQL, lint/typecheck/db rules, production build, unit shards 1-4 and the three timezones, the
coverage gate, all five browser shards, the E2E smoke gate, and Vercel.

### The browser-shard-1 stall (the real cause, worth remembering)

Four shards finished in 5-7 minutes and shard 1 was cancelled at its limit in five consecutive runs.
A cancelled job names no failing test, so it read as "the suite is slow". It was one call written
wrong in **23 places**:

```js
await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 200 });
//                   options are the THIRD parameter: (pageFunction, arg, options)
```

`{ timeout: 200 }` was passed as the *argument*, so every call used the 30-second default, and on a
screen that keeps a looping animation the condition never becomes true — 30 seconds per call, per
test, with retries, all in shard 1. Fix: `settleAnimations(page, ms)` in `e2e/support/a11yGate.ts`
(reduces motion, bounded wait, never throws), all 23 sites moved to it, and
`src/tests/browser-wait-guard.test.ts` fails the build if the shape returns, if the helper loses its
deadline, or if a spec calls the helper without importing it (that third check caught two specs,
which would have failed 34 report tests). Shard 1: **9m18s, passing.** The shard timeout went back to
30 minutes; the waits, not the budget, were the problem.

### Other fixes in the final stretch

| Area | What was wrong | Fix |
|---|---|---|
| Contrast | reconciliation chip 3.46:1, unmatch action 4.12:1, "Matched ledger entry" 2.92:1, Sales aging labels 2.13:1, critical overdue 3.75:1 | AA pairs (700 in light, 300 in dark) on the real screens |
| Keyboard | statement table scrolled sideways with no keyboard path | focusable group with a skip link |
| Stale locators | `Auto Align All`, `Matched History (1)`, `Account totals`, `Workspace Setup Checklist`, `Sales` | the screens' current words |
| Layout | dashboard's fifth first-screen action 2.23px below the fold at 390x850 | phone header 8px tighter |
| Visual baselines | capture and its verification disagreed (cards caught mid fade-in); Settings measured before it finished loading | wait for finite animations, settle on a stable height, then recapture |
| CI feedback | a failed capture said only "exit code 1" (log and artifact unreachable) | JSON report replayed into the step summary and the run's annotations |

---

## Second wave — the Chaim-Richard fork PRs (2026-11-09)

After #539 merged, eleven more PRs from `Chaim-Richard/ledgerflow` were open. Every one was checked against main with `gh pr view <n> --json files` plus a merge-base-scoped diff, because those branches sit 1.6k–2.8k commits behind and a plain `git diff main <branch>` reports thousands of phantom deletions.

### Disposition

| PR | Verdict | Where it went |
|---|---|---|
| #564 A-268 Standard Cost Variance | **merged to main on its own** | `00b37fc9`…`3af16abb`, including the later CSV-currency fixes; a duplicate merge of the same content on this branch was dropped |
| #562 audit delta | **merged to main on its own** | `009ba035` |
| #560 security audit | **merged** | `audit/ai6/security-audit-2026-11-05.md` via #577 (`0dab66eb`) |
| #558 independent audit | **merged** | `audit/INDEPENDENT_AUDIT_REPORT_2026.md` via #577 |
| #559 AF-011/AF-012 | **merged** | AF-011/AF-012 docs kept from main (main's wording is the more accurate one — the branch claims "no money figure is changed"; the tax figures shown before filing are exactly what changes); probes and SCORECARD taken from the branch |
| #557 audit findings | **merged** | `audit/agent8-2026-11-08/03-accurate-findings-list-2026-11-08.md` via #577 |
| #556 final list | **merged** | `audit/FINAL_ACCURATE_LIST_2026-11-08.md` + agent7 checkpoint via #577 |
| #533 S-22 narrowing | **merged** | the 2-line correction to `docs/verification/ai6-s22-rate-limit-audit-2026-10-28.md` and both copies of the COORDINATION entry |
| #561 S-37–S-40 | **closed, nothing to take** | all 533 lines it adds to COORDINATION.md are already on main; its only other change deletes an AF-001 evidence doc main still cites |
| #525 G-9 country samples | **closed, superseded** | main has `countryDemoWorkspace` plus `canUseDemoSandbox` / `buildResetDemoWorkspace` and a picker wired into `HelpGuideView` |
| #526 S-01…S-05 security | **closed, not merged** | redefines the shared rate limiter that main's `1a47f4e3` already superseded with an atomic fail-closed version; its CSP test conflicts add/add with main's newer one; `user-rate-limiters.test.ts` mixes `jest.fn()` into `node:test` |

### Doc conflicts, resolved the same way as the first wave

- `docs/BUG_PATTERNS.md` is **generated**. It was regenerated with `scripts/bug-patterns.ts`, never hand-merged; regenerating reproduces the committed file byte for byte. `silent-catch` drops 53 → 51 and the baseline test passes because the ratchet only forbids rises.
- `docs/LINE_COUNT.md` is written daily by `scripts/line-count.sh`. The branches carried older-valued rows for 2026-11-06…08 against main's newer ones, so main's file was left alone in every merge.
- `docs/COORDINATION.md`: only genuinely new lines were taken (the S-22 correction, the A-268 entry). The three large rewrites (#561, #533, #564) were not.

### One thing the lead should know

`docs/COORDINATION.md` on main carries the 2026-10-28 AI #6 S-22 entry **twice** — one copy arrived with #561's merge (`7b5538af`), the other with #428 (`5ca5c89b`). #533's narrowed wording is applied to both, so no claim is wrong, but the duplicate is still there and pruning it is the lead's call.

### Verification

`tsc --noEmit` clean; `eslint . --max-warnings 42` 0 errors / exactly 42 warnings; unit suite 1,069 / 1,184 / 1,145 / 1,092 across four shards with no failure except the known `A-206` report-timing flake, which fails identically on pristine main; `bug-patterns` 11/11 plus the browser-wait and registry guards. PR #577: **23/23 checks pass**, merged as `0dab66eb`.
