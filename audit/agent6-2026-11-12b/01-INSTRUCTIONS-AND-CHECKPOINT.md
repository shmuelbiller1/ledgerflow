# Agent #6 — second session, 2026-11-12 (UTC) — instructions examined and checkpoint

- **Agent:** #6 (independent accounting, financial-operations, security and launch-readiness audit)
- **Branch:** `arena/b33f6cd0-ledgerflow` on the fork `Chaim-Richard/ledgerflow` (Arena fixes the name)
- **Pin everything below was read and run against:** upstream `shmuelbiller1/ledgerflow` `main`
  **`e33b3f2bc8273ab2fcecf3affc34e0652d7d594c`** — "Merge pull request #696 from shmuelbiller1/ai9/eu-queue-2",
  2026-11-12T22:22:42Z. (The Arena checkout this session opened on was a *stale reconstruction*: it held no
  `audit/agent6-2026-11-12/` and no `agent7/11/13` folders, and differed from `main` in 460 files. The branch was
  therefore reset onto `upstream/main` before any work — the same lesson Agent #6 recorded on 10 Nov.)
- **Commits on the branch:** `d390685` (report conversion, #651), `d58ecca` (document-entry guards, #652/#662),
  `6b8260e` (flag/annotate allowance refinement), plus this documentation commit.

## 1. Instruction sources actually examined in this session

| Source | What was taken from it |
|---|---|
| `AGENTS.md` | money rules: absolute `totalAmountCents`, direction from lines, `isPostable()` on every report, plural account categories, dynamic role resolution, top-level collections; the rule that money/posting/tax maths/`src/server/` belong to AI #1 and problems there are to be reported |
| `CLAUDE.md` | git workflow (PR into `main`, CI before merge, docs may go straight to `main`), "keep working" instruction, Vercel preview caveat |
| `CURRENT_WORK.md` (at `main`) | stage A status, the short list of what is not done, the fork→upstream PR procedure, "check your own open PRs first" |
| `docs/COORDINATION.md` | helper-AI rules, the AI #6 security queue (`S-01..S-40`), and every message through 11 Nov: AI #7's `#662`/`#652`/`#653`/`#654` findings, AI #13's `#641`/`#648`/`#651`, AI #11's J-9 and CAMT.053 notes, AI #10's H-7/H-8 note |
| `src/AGENTS.md`, `src/lib/AGENTS.md`, `src/components/AGENTS.md`, `src/tests/AGENTS.md` | layer boundaries (`npm run check:layers`), pure deterministic libs, integer minor units, node:test conventions and `SYSTEM_SALT` |
| `docs/RELEASE_GATE.md`, `docs/PLAN.md` §15–§17, `docs/FIRST_TESTERS_GATE.md` | the finish line (14 workflows), stages A/B/C and what is parked |
| `docs/INDEPENDENT_AUDIT_AGENT.md` | audit protocol (AF-001…AF-010), probe standards: assert today's behaviour, independent arithmetic, controls |
| `security_spec.md`, `docs/SECURITY_CONTROLS.md` | two-boundary model (RLS/`lf_guard` vs privileged `pgFirestore`), S-items |
| `audit/agent6-2026-11-12/*` (this agent, earlier today) | the 19-finding register AF6-001…AF6-019, the seven patches, the post-review corrections, and what it left unapplied |
| `audit/agent6-2026-11-10/*`, `audit/agent7-2026-11-11/*`, `audit/agent13-2026-11-11/*`, `audit/function-audit/*` | earlier findings this session re-verified rather than repeated |
| GitHub | issues #641, #646, #648, #650–#654, #657, #661, #662; PR #673 (merged 15:35Z, whose patches 02–07 were landed by AI #1 afterwards) and the fork's open PRs (#21–#27) |
| Google Drive | **not available in this session** — see §3 |

## 2. Conflicts found, and which instruction was followed

| # | Conflict | Resolution followed |
|---|---|---|
| C-1 | Session mandate to *fix* real defects vs `AGENTS.md`/COORDINATION: money, posting and `src/server/` belong to AI #1 — report, do not patch | Same harmonisation the earlier session used and the owner accepted (PR #673 merged): **integrity** defects in the ledger door (`#652`, `#662`, `#653`'s guard family) and *verified worked-figure* money-maths corrections are committed on this branch **with tests**, clearly separated into commits, so AI #1 can review, cherry-pick or revert one without touching the other. Nothing merges without the owner. |
| C-2 | "one branch and PR per task" vs Arena's single session branch | All work on `arena/b33f6cd0-ledgerflow`, one PR from the fork, commits split by concern. |
| C-3 | Arena's "current branch" (a stale reconstruction with no common ancestor content) vs "start from the owner's latest `main`" | Branch reset onto `upstream/main` `e33b3f2` (fork `origin/main` is the same commit), which is also what makes the PR reviewable instead of showing 460 files. |
| C-4 | Red Vercel preview vs CI health | Only real gates recorded; Vercel not treated as evidence. |

## 3. Environment facts (what is and is not executable here)

| Gate | This sandbox |
|---|---|
| Node / npm | v22.22.3 / 10.9.8, 2 vCPU, 3.9 GB |
| `node_modules` | installed with `npm ci` at the pin |
| PostgreSQL (`LF_TEST_DATABASE_URL`) | **absent at first, obtained later**: the `pgserver` wheel from PyPI (PostgreSQL 16.2) plus a small TCP proxy onto its socket; `npm run db:test-setup` applied the stub and all 24 migrations, so `npm run test:rules`, the DB-gated unit tests and the new endpoint test were run for real (see `03-TEST-AND-EVIDENCE.md`). No Docker |
| Playwright browsers | **absent** — browser suites cannot run here |
| Google Drive | **not connected to this account** (the owner confirmed it and directed that everything be preserved through GitHub only). Nothing was uploaded and nothing is claimed to be on Drive. |

## 4. What was already fixed before this session started (verified, not assumed)

At `e33b3f2` the following earlier findings **no longer reproduce** — checked by reading the code and, where a
pure function is involved, by running it:

| Earlier finding | Evidence at this pin |
|---|---|
| #641 / #648 — `toBaseCents` ignored minor units (aging, party balances, FX revaluation, approval limit) | `partyReports.toBaseCents` now calls `convertMinorUnits(amount, rate, from, to)`; the af008 probe's V1–V6 are OK (aging 67,000 = ledger 67,000; revaluation gain 3,000 = $30.00; a $670 invoice over a $500 limit needs approval) |
| Agent #6 AF6-003 / AF6-019 (manual FX journal `exchangeRate²`, `withReversal` not negating `baseAmountCents`) | fixed in the merged PR #673; `src/tests/home-currency-balance.test.ts` present |
| AF6-004 (IRS Pub 15-T Step-2 tables) | `makeStep2Brackets(std, step1gAdjustment)`; the probe's own relation `2 × Step2(W/2) === Std(W)` holds for every $5,000 of wages to $300,000 (gap 0 cents) |
| AF6-006 (audit hash-chain verifier) | `verifyAuditHashChain` accepts either `chainHash` or `entryHash` links, and the cache is not written from inside an uncommitted caller transaction; this session's chain probe is OK 7/7 including tamper detection |
| AF6-005 (`fxRevaluation` minor units), AF6-007–AF6-011 (GL delete/batch/reconcile guards, copy-mark, SQL triggers), AF6-012–AF6-015 | patches 02–07 of 12 Nov are **applied on `main`**: `convertMinorUnits` in `fxRevaluation.ts`; `crudRoutes` DELETE refuses completed/reconciled/document-linked entries inside the transaction; `documentRoutes` takes `readOnly` copy marks and `assertWorkspaceAccess`; migration `20261112100000_close_ledger_and_settlement_trigger_gaps.sql` is present |
| Agent #6 10 Nov F-01 (`taxPlace.region` vs `state`) | `usSalesTaxReturn` now resolves the place from the document, the invoice, the customer and the seller via `usSaleDestination`; `sampleBusinessYear` reads `state || region` |
| Agent #6 10 Nov F-08 ("one filing marks every state") | `usQuarterJourney` matches a filing by `registration` (or the whole quarter) and labels a period-only record "Period record only (not per state)"; the server's `taxReturnService` writes `kind: 'sales_tax'` returns as well as VAT |
| #651 part 1/2 — see this session's register, now fixed | `src/tests/currency-minor-units-reports.test.ts`; af008 V7/V8 OK |

## 5. Branch state when this checkpoint was written

```
e33b3f2  main (pin)
d390685  fix(reports): convert foreign payments with minor units in commission and cash basis (#651)
d58ecca  fix(ledger): refuse document-entry edits/reversals and in-place un-posting on the generic routes
6b8260e  fix(ledger): allow flagging/annotating a document entry, refuse only financial changes
```
Pushed to `origin/arena/b33f6cd0-ledgerflow` (fork). PR body: `PR-BODY.md` in this folder.
