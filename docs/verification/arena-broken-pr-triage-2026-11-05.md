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
