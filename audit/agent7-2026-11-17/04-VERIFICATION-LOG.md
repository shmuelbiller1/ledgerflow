# Agent #7 (2026-11-17) — Verification Log

Every command below was run on `arena/985167b2-ledgerflow` at `f69e2b4` (or in a detached worktree of `f69e2b4` where noted).
A blank/clean result is the pass condition unless stated.

## 1. Environment

| Step | Command | Result |
|---|---|---|
| Node | `node -v` | v22.22.3 |
| Install | `npm ci --ignore-scripts` (Arena image, no `initdb`) | 1,208 packages, 15 moderate audit warnings (pre-existing) |
| Branch | `git branch --show-current && git log --oneline -1` | `arena/985167b2-ledgerflow` at `f69e2b4 The first two rows a person needs are commands too (direct browser writes 88 → 86) (#758)` |
| Prior lane | `gh pr view 753 --json state,mergedAt` | `MERGED 2026-11-17T01:18:39Z` — 7 fixes on `main` |

PostgreSQL 16.2 is **not available in this Arena sandbox** (`initdb` not in image). DB gates that require a live PG
(`db:test-setup`, `test:rules`, `test:rules` against proposed migrations, live probes for tickets/documents) were
**not re-run here** — they were green on `3a4ad7d` with the same migration set (`ALL RLS TESTS PASSED`) and are
recorded there (`audit/agent7-2026-11-16/04-VERIFICATION-LOG.md` §2). This session's DB claims are static-read
plus `git apply --check` against `f69e2b4`; a PG-bearing runner must re-check before any reserved patch is merged.

## 2. Static Gates on `f69e2b4` + This Session's Audit Docs

| Gate | Command | Result |
|---|---|---|
| Types | `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` | **clean** (0 errors) |
| ESLint whole repo | `npm run lint:eslint` (`eslint . --max-warnings 2`) | **0 errors / 0 warnings** (cap 2, 0 used) |
| Layers | `npm run check:layers` (`src/tests/layers-guard.test.ts`) | **pass** — 4/4 |
| Bug patterns | `npx tsx scripts/bug-patterns.ts` | See §3 |
| Prior fixes | `NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test --test-force-exit src/tests/agent7-2026-11-16-remediations.test.tsx src/tests/agent7-2026-11-16-vault-remediations.test.tsx` | **28/28 pass / 0 fail** |
| Code Atlas | `node scripts/code-atlas.mjs stats` | 2,141 files (201 archived), 1,967 code, 259 computed API calls, 82 unknowns, source `74b8318` (stale — `rev-parse --verify` fails, atlas needs regeneration on `f69e2b4`) |
| Code Atlas validate | `node scripts/code-atlas.mjs validate` | `fatal: Needed a single revision` (same stale pin) — not a code defect |

## 3. Bug-Pattern Scanner vs. Baselines

```
$ npx tsx scripts/bug-patterns.ts
{
  client: {
    'swallowing-action': 93,      baseline 96  — ↓3
    'success-after-call': 6,      baseline 12  — ↓6
    'unchecked-write': 1,          baseline 2   — ↓1
    'write-in-loop': 7,            baseline 13  — ↓6
    'stale-async': 28,             baseline 81  — ↓53
    'silent-catch': 48,            baseline 54  — ↓6
    'effect-before-write': 0,      baseline 0   — →
  },
  serverAndSql: 30
}
bug-patterns-baseline.json  (committed cap):  swallowing-action 96, success-after-call 12, unchecked-write 2,
                                              write-in-loop 13, stale-async 81, silent-catch 54, effect-before-write 0
```

All client buckets are **at or below** their ratchet baseline — no rise introduced by this session (which adds only `*.md`/`*.patch`/`*.ts` probe files). The `serverAndSql` bucket is informational.

## 4. Reserved-Lane Evidence (no DB)

### 4.1 Probe 08 — Group translation (A7N-10) + API scope (A7S-01)

```
$ npx tsx audit/agent7-2026-11-17/probes/probe-08-translation-and-api-scope.ts   # on f69e2b4, unpatched
A7N-10 yen member, $ report: {"income":6700,"cogs":0,"grossProfit":6700,"expense":0,"netIncome":6700,"totalAssets":6700,"totalLiabilities":0,"totalEquity":6700,"cta":0}
AssertionError: ¥1,000,000 at 0.0067 is 670,000 cents ($6,700.00) — 6700 !== 670000
```

The probe also asserts all eleven `period.*` commands must scope to `write:workspaces`; on `f69e2b4` four of them
return `write:transactions` and the probe would fail at the same assertion for `period.yearclose` /
`period.balancesrebuild` / `period.fxrevaluation` / `period.fxrevaluationundo` if the first assertion were
bypassed. With `patches/08`+`10` applied (verified on `3a4ad7d` — same code on `f69e2b4`):

```
A7N-10 yen member, $ report: {"income":670000,"netIncome":670000,"totalAssets":670000,"cta":0}
A7N-10 KWD member, $ report: {"income":325000,"netIncome":325000}  (KWD 1,000.000 at 3.25 = $3,250.00 = 325,000 cents)
A7S-01 period command scopes: all 11 → write:workspaces
probe 08: all assertions held
```

### 4.2 Static Evidence for the Remaining Reserved Patches

| Patch | Check on `f69e2b4` | Result |
|---|---|---|
| `09` (asset undo) | `grep -n metadata.assetId src/server/services/assetDisposalService.ts` | no hits — only `workspaceId` checked (line 174) |
| `10` draft-trap half | `grep -n trappedDrafts src/server/commands/periods.ts` | no hits — `period.yearclose` locks without draft check (lines 84–110) |
| `11` document link | `grep -n linkedTransactionId src/components/forensics/Vault.tsx` | line 272 `updateDoc(doc(db,'documents',…),{linkedTransactionId})` — direct write still present |
| `11` ticket scope | `grep -n ticket_read supabase/migrations/0001_init.sql` (and `lf_rules` dump) | member-level `ticket_read`/`ticket_update` still grant any member + support-side keys allowlisted — unchanged since `3a4ad7d` |
| `06` statement FX | `grep -n toBaseCents src/server/reports/computeReports.ts` | no hits — still sums `inv.amountCents` raw (lines 368–412) |

### 4.3 `git apply --check` Against a Detached `f69e2b4` Worktree

```
$ git apply --check audit/agent7-2026-11-16/patches/08-group-report-non2dec-translation.patch          → clean
$ git apply --check audit/agent7-2026-11-16/patches/09-asset-undo-entry-ownership.patch                → clean
$ git apply --check audit/agent7-2026-11-16/patches/10-year-close-draft-trap-and-period-scope.patch    → clean
$ git apply --check --exclude=src/components/forensics/Vault.tsx audit/agent7-2026-11-16/patches/11-document-ledger-link-and-ticket-visibility.patch → clean (server halves)
$ git apply --check audit/agent7-2026-11-13/patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch → clean
$ git apply --check audit/agent7-2026-11-13/patches/01-*.patch  → conflict (creditService:7, ledgerDoor:38) — carry-forward
$ git apply --check audit/agent7-2026-11-13/patches/02-*.patch  → conflict (crudRoutes:20) — carry-forward
$ git apply --check audit/agent7-2026-11-13/patches/03-*.patch  → conflict (taxCodes/taxRecompute/taxReturnDocs/taxReturnService)
$ git apply --check audit/agent7-2026-11-13/patches/04-*.patch  → conflict (fxRevaluationService:111) — still open, needs rebase
$ git apply --check audit/agent7-2026-11-13/patches/05-*.patch  → conflict — superseded by 20261116000000
```

In this session's own `audit/agent7-2026-11-17/patches/` (copies of the above):

```
$ git apply --check audit/agent7-2026-11-17/patches/*.patch   # with Vault.tsx excluded for 11
  06 clean, 08 clean, 09 clean, 10 clean, 11-server clean
```

## 5. Regression Proven Against Pre-Fix Code (inherited from 2026-11-16, not re-run here)

The 28 behavioural tests in `src/tests/agent7-2026-11-16-*.test.tsx` were each reverted (`git checkout -- <file>`,
run, restore) on `3a4ad7d` and shown to fail where the defect exists — see `audit/agent7-2026-11-16/04-VERIFICATION-LOG.md`
§3. On `f69e2b4` they pass (above), so the fixes are durable; the negative cases were not re-run in this short
session but remain as evidence that the tests are not tautological.

## 6. Full Suite `npm test` (6,229 tests)

Not re-run in this session (wall-clock ~23 min, needs PG for some suites). The last run that included this migration
set was on PR #753 (commit `724ffb2` at `3a4ad7d`):

```
# tests 6229   # pass 6226   # fail 2   # skipped 1   # ~23 min
```

The two failures were **wall-clock perf budgets** (`R-5` every report view <1000 ms, `A-206` heaviest reports <1000 ms)
that also fail on the untouched base `3a4ad7d` in this sandbox (CPU slower than budget assumes) — not a regression
from the branch. GitHub Actions on the same commit was **green end-to-end**: 4 unit shards, 6 timezone shards,
5 browser shards, Playwright smoke, lint/typecheck/DB rules, build, SonarCloud, CodeQL, SBOM. `f69e2b4` differs only
by the merge of #753 plus #754–#758 (direct-write ratchet), none of which touches reporting perf; a PG-bearing runner
should re-check before a release.

## 7. CI on This Session's Branch

PR for this session will be opened as `arena/985167b2-ledgerflow` → `shmuelbiller1/ledgerflow:main` (this log
written before push — update with run URL after push).

Prior session's CI (for reference): run `43984640500` on `arena/93656b5f-ledgerflow` — **success**.

## 8. Sandbox Incidents Worth Recording

1. **PostgreSQL not in image.** `initdb`/`pg_ctl` are not in this Arena sandbox; DB gates are static/`apply --check`
   + probe-08 (no DB) + prior session's PG transcript.
2. **Vercel preview red is not a code defect.** Automatic previews are disabled to save minutes (per `docs/RELEASE_GATE.md`
   and `AGENTS.md` §6); investigate CI/build/tests independently.
3. **Stale Code Atlas pin.** `node scripts/code-atlas.mjs stats` reports `74b8318bfba…` which `rev-parse --verify` cannot
   find — the atlas was generated off a detached SHA and needs regeneration on `f69e2b4`.
4. **Vault.tsx rebase for patch 11.** The `Vault.tsx` hunk of `11-document-ledger-link-and-ticket-visibility.patch`
   is against `3a4ad7d`; `f69e2b4` carries the A7C-04/05 hunks now on `main`, so it conflicts — the server halves
   (migration + `attachmentRoutes.ts`) are the security boundary and are `apply --check` clean with `Vault.tsx` excluded.

