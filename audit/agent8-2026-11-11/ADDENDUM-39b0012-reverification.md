# Agent #8 addendum — re-verification at `39b0012` (11 Nov 2026, second slice)

> **Post-port status correction (12 Nov):** The AF-007 unbounded `REPORT_CACHE` finding / issue #645 was fixed by merged PR #660 after this historic pin. The historical raw probe output below is retained as dated evidence; use the rewritten `function-audit/probes/af007-report-cache-growth.ts` to test the actual current bounded cache, not the obsolete unbounded-map copy.

**Supersedes the status claims in** [`../FINAL_ACCURATE_LIST_2026-11-11-agent8.md`](../FINAL_ACCURATE_LIST_2026-11-11-agent8.md)
**and** [`../function-audit/SCORECARD-2026-11-11-agent8.md`](../function-audit/SCORECARD-2026-11-11-agent8.md),
which were written at pin `ec3ff49`. Those two documents are left as the record of what was true at that SHA;
**their three "live defect" rows are now fixed and must not be quoted as open.**

**New pin:** `39b0012881fdc78edab2479fb62b0b632234aa82` (upstream `main`, merge of PR #635, 2026-11-11T17:27Z) —
**29 commits ahead** of `ec3ff49`.
**Raw evidence:** [`probe-output-39b0012.txt`](probe-output-39b0012.txt) — 20 OK / 5 DEFECT across five probes.

---

## 1. Why this slice exists

The three defects reported earlier today were filed as **#627**, **#628** and **#629**, and AI #1 closed all three
as `completed` within hours, with **zero comments on any of them** — the same pattern as the 10 Nov closure wave
this agent had just spent a slice establishing was not always backed by a real fix. So the closures were treated as
claims to verify, not as facts.

AI #1's own PR body for #635 states the gap this slice closes:

> *"The auditor's probe file named in the issues (`af004-614-residual.ts`) is not in the repository, so I did not
> run it."*

That was true when they wrote it — the probe was on this agent's fork branch, not on `main`. It is on `main` now, so
**the acceptance test named in both issues has been run.** This is the result.

## 2. Verdict: all three fixes are genuine

| Issue | Fixed by | Verdict at `39b0012` | Evidence |
|---|---|---|---|
| **#627** quarter journey's certificate step diverged from the state return | **PR #635** (`claude/tax-profile-borders`) | **FIXED — verified** | probe cases **R1b, R1c, R2b all flipped DEFECT → OK**; control **R2c still OK** (counts 1 for the unlabelled sale), so R2b's zero is not vacuous |
| **#628** `resolveSellerProfile` inherited across countries | **PR #635** | **FIXED — verified** | **R3a, R3b, R3c, R3d all flipped DEFECT → OK**; scope control **R3e still OK**. The older probe's **P1, P2, P7 also flipped DEFECT → OK** |
| **#629** `FxService` raw axios, no timeout | **PR #634** (`claude/fx-timeout`) | **FIXED — verified** | `grep -rn axios src/server/` → **no matches**; `FxService.ts:10` now `safeFetch(url, { allowedHostnames: [RATE_HOST], timeoutMs })` with `RATE_TIMEOUT_MS = 10_000` and a `withDeadline` wrapper. **Both halves** of the report are addressed, including the second, smaller gap: `ratesOf` (lines 23-28) now validates the rates table and refuses an unusable answer instead of resolving `undefined` |

**All eleven cases of `af004-614-residual.ts` now pass.** The file is therefore a **regression guard** for #627 and
#628: if any case prints DEFECT, one of those fixes has been undone. Its header now records that history and the two
SHAs, so the next agent does not have to reconstruct it.

Concrete before/after, from the executed output:

| Case | at `ec3ff49` | at `39b0012` |
|---|---|---|
| R1b certificate step after the customer moves CA → TX | `attention`, "1 without a recorded certificate" | **`not-applicable` both times** — the step's answer no longer changes |
| R2b IL-labelled sale, journey vs return | return 0 documents, journey **1** zero-tax US sale | **both 0 — they agree** |
| R3a Israeli entity's resolved place | `{country:'IL', state:'CA'}` | **`{country:'IL'}`** |
| R3b IL branch over-the-counter sale in the CA return | `documentCount=1, grossSalesCents=10000` | **`documentCount=0, grossSalesCents=0`** |
| R3c `world:us` under Israeli books (the repo's own fixture) | `{country:'US', city:'Tel Aviv'}` + `["vat:IL:514000000"]` | **`{country:'US'}` + `[]`** |
| R3d Texas entity with no own city | `{country:'US', city:'Tel Aviv', state:'TX'}` | **`{country:'US', state:'TX'}`** |
| P7 US-labelled sale in the IL VAT return | `documentCount=1, taxableSalesCents=10000` | **`documentCount=0`** |

### What PR #635 changed, and one disclosed test-expectation change

`usSaleDestination` was extracted out of `usSalesTaxReturn` into one exported rule used by **both** the return and
the journey — exactly the shape recommended in #627 ("one rule, not two that must be kept in step by hand, which is
what drifted here"). The journey's seller moved to `documentEntityLabels`. `resolveSellerProfile` now treats the
nearest level that names a country as the entity's country; a farther level in a different country passes down only
its name and accounting basis, and the skipped levels are reported in a new `otherCountry` field.

PR #635 also **changed one existing test expectation**, disclosed in its body: `tax-profiles-settings.test.tsx`
expected a US/NY branch to show the Israeli books' city (Jerusalem) as inherited. That expectation *was* the #628
behaviour, so it had to move; it now expects "Not set". This agent checked that this is a consequence of the fix and
not a weakening of an unrelated assertion: the suite passes (63 tests across the five tax/FX suites run here, 0 fail),
and the new `tax-profile.test.ts` cases cover both directions, same-country-unchanged, a level with no country, and
country-code case sensitivity. **No test input or expected figure was altered by this agent.**

## 3. New finding filed this slice: #645 (AF-007)

**[`#645`](https://github.com/shmuelbiller1/ledgerflow/issues/645) — `REPORT_CACHE` never evicts (P2, AI #1's lane).**
`src/server/routes/reportRoutes.ts:37` holds whole P&L and balance-sheet bodies in a module-level `Map` with a 60 s
TTL, and nothing ever removes an entry: no `delete`, no `clear`, no sweep, no cap (grep-verified at `39b0012`). Lines
113-114 and 146-147 check `expiry` and leave the expired entry in place, so **peak size is permanent for the life of
the process** — the TTL stops stale answers but never reclaims memory.

Two independent amplifiers, both reproduced against the **real exported `getCacheKey`** by the new probe
`audit/function-audit/probes/af007-report-cache-growth.ts`:

- **C1** — line 51 hashes the raw `req.query` while the handler uses the stripped `result.data`, and
  `ReportRangeSchema` is not `.strict()`, so a parameter the report *ignores* mints a new key. Four requests for the
  identical report produced **4 distinct keys**: each a cache miss, each recomputing the report *and* storing a new
  permanent entry.
- **C1b** — no crafted input needed: varying only `endDate` across one year of valid dates gives **365 distinct keys**.
- **C2** — a 2000-entry burst is still **2000 entries after every one expired** (≈13.7 MB against a 7 KB stand-in
  body; a real busy-workspace report is larger, so that is a floor).

Recorded honestly in the issue so it is not over-claimed: **C2b passes** — an expired entry is never *served*, so this
is not a stale-data or wrong-figures defect; and the key includes the caller's uid, so it is **not** cross-tenant
exposure. It is unbounded growth. **C3** is the control that makes it a defect rather than a style preference: the
other four module-level caches in `src/server/` are all bounded, one of them (`cspViolations.ts`) with a tested cap
and a comment explaining why — *"small enough that nobody can grow it into a leak"*. `REPORT_CACHE` is the only one
with nothing.

## 4. Still open, unchanged

| ID | Sev | Status |
|---|---|---|
| **AF-004-P6** | P2 latent | **still DEFECT** at `39b0012` — `composeFacts` keeps the first occurrence of a set-valued fact, so a value stated both declared and verified reports `verified=false`. Conservative (a false negative, never a false positive). Carried since the 8 Nov register; no issue filed, because it cannot produce an unsafe answer and the fix is a product decision about which copy wins |
| **A8-1111-F5** | P3 | **still present** — `itemReports.ts` docstring claims items keep no movement history; false since `inventoryAsOf` shipped |
| **#131** | open | recommend narrowing, per the earlier list; unchanged by these 29 commits |

## 5. Gates re-run at `39b0012`

`npm run lint:types` **0 errors** · `npm run lint:eslint` **0 errors / 42 warnings** (cap unchanged, no baseline
raised) · `fx-no-invented-rates` + `tax-profile` + `us-quarter-journey` + `us-sales-tax-return` +
`tax-profiles-settings` = **63 pass / 0 fail** · five probes **20 OK / 5 DEFECT** (the 5 being P6 and AF-007's four
cases) · `af012` chain order and shipped packs unchanged (18 packs / 584 rules / 67 overrides / 0 nested chains).
**Not run and not claimed:** full `npm test`, `npm run test:rules`, RLS, migrations, Playwright — no local Postgres
and no Docker in this sandbox.

## 6. Environment hazard discovered this slice (for any agent resuming here)

Between turns the sandbox **restored the working tree from a snapshot that predates this agent's commit**: `HEAD`
was silently back at the branch base `ec3ff49`, the commit `5110113` was gone from the local branch, and its content
reappeared as unstaged modifications. `node_modules` was also wiped (it is excluded from snapshots).

Recovery that lost nothing, and the procedure to reuse:

```bash
git fetch origin <branch>          # the pushed commit is the truth, not the local .git
git rev-parse FETCH_HEAD           # confirm it is the commit you pushed
git reset --mixed FETCH_HEAD       # restores HEAD and the index WITHOUT touching the working tree
```

`--mixed`, not `--hard`: the working tree already held the same content, so `--hard` would have been needlessly
destructive, and `--mixed` cannot lose an untracked file. **Lesson recorded in the checkpoint: after any turn
boundary, verify `git rev-parse HEAD` before trusting local history — the remote and the Drive archive are the
durable record, the local `.git` is not.** This is also why every artifact is uploaded to Drive with its MD5
compared against the local file.

## 7. Note on this agent's earlier PR

The 11 Nov slice reached `main` through commit `6366767` ("Resolve PR #637 audit merge conflict and CodeRabbit
findings") after **PR #637** (from this same branch) was closed. All eight of that commit's files are present
upstream, including this agent's COORDINATION message, and upstream's copy of `af004-tax-authority-probe.ts` is
**better** than the version pushed — someone added a non-vacuity control for P4 during review. This agent therefore
**took upstream's copies rather than its own** when the branch was rebased, so that improvement was not overwritten.
That is the reason fork PR #21 was closed as superseded instead of being force-pushed.
