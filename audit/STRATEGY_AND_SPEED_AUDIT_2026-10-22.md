# LedgerFlow — Deep Strategy & Delivery-Speed Audit

**Date:** 22 October 2026
**Scope:** the whole thing — the idea, the architecture, the plan, and the *pipeline that turns the plan into shipped code*.
**Code changed:** none. This is an analysis file only.
**Target:** `main` at `67901c3b362076b3549972121052c4b9338e0178` (the same commit this branch is cut from).

> **How to read this.** Every number in this document came from a command I ran, listed in
> **Appendix A**. Numbers are tagged by source: **[GH]** = GitHub API (2,054 commits, 275 PRs,
> 2,070 Actions runs), **[CI]** = timestamps GitHub recorded for a real workflow run,
> **[LOCAL]** = I ran it in this sandbox. Where I could not verify something I say so plainly
> instead of estimating.
>
> Section 5 lists **measured claims already written in this repository that I could not reproduce
> or that have gone stale** — including the number that justifies a planned 13-item refactor.
> If you read only one section, read that one and Section 7.

---

## 1. The one-page answer

**The product strategy is sound and it is accelerating. The delivery pipeline is now the
bottleneck, not the plan.**

Three measured facts explain almost all of the remaining slowness:

| # | Fact | Number | Source |
|---|---|---|---|
| 1 | The CI gate every change waits on | **16.2 min** wall clock; the unit-coverage step alone is **14.0 min = 86%** of it | [CI] |
| 2 | `main` is red when you branch from it | **26%** of pushes to `main` (57 failed / 154 passed / 9 cancelled) | [GH] |
| 3 | What makes it red | **100%** of recent `main` failures were the **Playwright browser suite** (8 of 8); on PRs it is involved in **10 of 13** failures | [GH] |

Add two more that are cheap to fix and large in effect:

| # | Fact | Number | Source |
|---|---|---|---|
| 4 | The browser tests run **single-threaded inside each shard** | `workers: 1` in `playwright.config.ts` | [LOCAL] |
| 5 | The unit suite runs **three times** per CI run | coverage job + 2 time-zone jobs = 14.0 + 10.9 + 11.0 min | [CI] |

**The headline recommendation:** cut the gate from 16.2 min to roughly 5–6 min (§7.1) and stop
`main` being red (§7.2). Together those take ~10 minutes off **every** feedback loop — 1,274 CI
runs so far — and remove the single most expensive loop in a nine-agent workflow: *"is this my
bug, or was main already broken?"*

**The strategic observation nobody has written down yet** (§2.4): of the 9 workflows Stage A
needs, **6 are done**. Of the **3 that remain**, two are *browser-journey* work — the most
expensive category per item, and the same category that is currently breaking CI. **The last
10% of Stage A is gated on the slowest and least reliable part of the pipeline.** That makes
§7.1–7.2 not "nice engineering hygiene" but the critical path to inviting testers.

---

## 2. Where the strategy actually is — the trajectory, measured

### 2.1 The idea is right

The core thesis in `README.md` and `AGENTS.md` — three decoupled layers (data / pure math /
registered views), one posting path, dated tax rules as *data* not code, every report a read-only
view of posted entries — is a good architecture for this problem, and I found no evidence against
it. Two structural claims I tested and confirmed:

- **No dead code.** 0 of 1,285 non-test source files are unreachable. Specifically: **0 of 480
  `src/components/*.tsx`** and **0 of `src/lib/*`** are unimported, and all **58 algorithm files**
  are imported by `src/lib/algorithms/index.ts`. [LOCAL] The "built but not reachable" problem
  that `docs/PLAN.md` §13 flagged on 13 Oct (25 of 43 libraries used by no screen) has genuinely
  been closed — the C-102…C-126 wiring lane did what it said it would.
- **The type and lint gates are real.** `tsc --noEmit` is clean in **46 s**; `eslint .` returns
  **0 errors** in **77 s**. [LOCAL]

### 2.2 The velocity curve — this project is 7 weeks old, not 15

Commits per ISO week, all 2,054 of them: [GH]

| Week | Commits | | Week | Commits |
|---|---|---|---|---|
| 27 (5 Jul) | 3 | | 39 | 69 |
| 29 | 1 | | 40 | 115 |
| 30 | 19 | | **41** | **657** |
| 31 | 18 | | **42** | **441** |
| 32 | 9 | | **43** | **490** |
| 33 | 12 | | | |
| 36 (from 31 Aug) | 92 | | | |
| 37 | 72 | | | |
| 38 | 56 | | | |

- **53 of 110 calendar days had zero commits.** The gap is 16 Jul → 30 Aug: six weeks with almost
  nothing. [GH]
- **1,588 of 2,054 commits (77%) landed in the last three weeks** (weeks 41–43). [GH]
- Median on an active day: 11 commits. Busiest day: 205 (11 Oct). [GH]

**What this means strategically:** the repository *looks* like a 15-week project but is a
**7-week project** whose rate is still climbing. That is good news and it changes the risk
picture: the team is not slowing down under complexity, it is accelerating. It also means the
process was never tuned for the current rate — the pipeline was built when CI took 1.6 minutes
(§4.3) and is now running at 13–16.

### 2.3 Stage A is 6 of 9 workflows complete

From `docs/RELEASE_GATE.md` (Stage A needs W1–W6, W9, W10, W14) cross-read with
`CURRENT_WORK.md`: [LOCAL]

| Workflow | State | What is left |
|---|---|---|
| W2 invoice → posting → payment → statement | ✅ done | — |
| W3 bill → posting → payment run → statement | ✅ done | — |
| W4 bank import/feed → reconciliation | ✅ done | — |
| W5 labels → reports by label | ✅ done | — |
| W6 order with deposit → part invoices | ✅ done | — |
| W9 sealed period → reopen | ✅ done | — |
| **W1** sign-up → first report | ⚠️ **status contradicts itself** (see below) | worked figures |
| **W10** backup → restore | ❌ | browser journey (D-98) |
| **W14** roles and access | ❌ | browser journey (D-99) |
| **G-02** first hour without dead ends | ❌ | authenticated G-24 journey |

**A real coordination defect, found by reading the two files side by side:** `RELEASE_GATE.md`
marks W1 **Verified = Yes** and links `verification/ai9-w1-gold.md`; `CURRENT_WORK.md` says for W1
"left: worked figures (W1-GOLD)". **The two authoritative status files disagree about whether the
same workflow is verified.** With nine agents reading these files to pick work, a contradiction
here is not cosmetic — it is how two agents end up doing the same task or both skipping it.

### 2.4 The strategic risk that follows from §2.3

The three remaining workflows are **W10 (browser journey), W14 (browser journey), G-02
(authenticated browser journey)**. Three out of three are browser work.

Now put that next to §1 fact #3: **the browser suite is what breaks `main` 100% of the time and is
involved in 77% of PR failures.**

> **The last 10% of Stage A depends entirely on the one part of the pipeline that is both the
> slowest and the least reliable.** Every hour spent making the browser suite fast and stable
> returns directly as Stage A shipping sooner. This is the strongest argument in this document.

One more number belongs here. The quality ratchet reports **`untestedViews: 44`** — 44 registered
views have no registry smoke test (§5.4b). Stage A is precisely about proving that real screens
work end to end, so that is the most relevant open metric in the repository, and it is not on the
`CURRENT_WORK.md` short list.

---

## 3. What the complex stuff actually cost

### 3.1 Commits-per-task by lane — a 4.3× spread

I extracted every task ID from all 2,054 commit messages (473 distinct IDs) and counted commits
per ID per lane: [GH]

| Lane | Commits | Tasks | **Commits / task** | Reading |
|---|---|---|---|---|
| **A** (AI #3, Arena) | 167 | 97 | **1.7** | batches 5–15 tasks per PR; mostly pure functions + tables |
| **L / Y / H / BA / BG / K** | ~80 | ~70 | 1.0–1.2 | small, self-contained |
| **C** (AI #2, Codex) | 124 | 51 | **2.4** | one PR per task, screenshot cycle each |
| **D** (AI #4) | 98 | 38 | **2.6** | browser journeys — expensive by nature |
| **DIM / AUD / CON** | 54 | 14 | 3.9–6.8 | correctness work with re-verification |
| **E** (AI #5) | **220** | **30** | **7.3** | ⚠️ highest churn in the repo |

`docs/PLAN.md` §13 already noticed AI #3 is faster and guessed why. The measurement makes it
precise: **the A lane uses 4.3× fewer round trips per task than the E lane.** Concrete examples of
the E-lane pattern: **E-57 = 14 commits in 2 days**, **E-27 = 14 commits in 1 day**,
**E-21 = 13 in 2 days**, **E-23 = 12 in 2 days**. [GH]

Fourteen commits for one task means roughly fourteen CI runs. At the measured 13–16 min gate
(§4.1), **that is 3–4 hours of gate-waiting on a single work item.** The fix is not "work faster"
— it is batching (what the A lane already does) plus a faster gate (§7.1).

### 3.2 Which items dragged

Longest calendar span from first to last commit: [GH]

| Task | Span | Commits | Note |
|---|---|---|---|
| S-02 | 15 d | 3 | security lane, fork-based (PR round trip) |
| A-7 | 15 d | 4 | |
| D-7 | 13 d | 4 | |
| **E-25** | **13 d** | **10** | high churn *and* long span |
| E-24 | 13 d | 4 | |
| **E-20** | **12 d** | **8** | high churn *and* long span |
| AU-4 | 9 d | 3 | migration reconciliation |

Only **67 of 473** task IDs were touched on more than one distinct day — so most work *does* land
in a day. The drag is concentrated in a small number of items that combine high churn with long
span (E-20, E-25 above). Those are worth a direct look: an item that takes 10 commits across 13
days is usually blocked on something, not merely big.

### 3.3 PR throughput is genuinely excellent

| Metric | Value | Source |
|---|---|---|
| PRs total / merged | 275 / 217 (**79%** merge rate) | [GH] |
| Median time open → merged | **0.9 h** | [GH] |
| Merged in under 1 h | 126 of 217 (58%) | [GH] |
| p90 | 4.5 h | [GH] |
| Slowest ever | #3, 407 h (a Dependabot bump — ignore) | [GH] |
| Merged per week | wk40: 8 → wk41: 30 → wk42: 60 → **wk43: 115** | [GH] |

A 0.9 h median merge cycle with 115 merges in one week is a very healthy review loop. **Review is
not the bottleneck.** Waiting on CI is. That is the whole argument of §7.

---

## 4. The feedback-loop economy (the dimension the plan does not measure)

`docs/PLAN.md` §14 documents *what* runs in CI and defends the choice well. It does not record
*what it costs*, and the cost has grown 8× since the policy was written.

### 4.1 The critical path, step by step

From a real successful run on `main` (run `39706885385`, 22 Oct 01:38 UTC), using GitHub's own
per-step timestamps: [CI]

| Job | Total | Longest step | That step |
|---|---|---|---|
| **Lint, Typecheck, and Test** | **16.2 min** ← critical path | `npm run test:cov` | **14.0 min (86%)** |
| Unit tests in Pacific/Auckland | 11.5 min | `npm test` | 10.9 min |
| Browser shard 1/2 | 12.2 min | Playwright | ~11 min |
| Unit tests in America/Los_Angeles | 11.6 min | `npm test` | 11.0 min |
| Browser shard 2/2 | 8.8 min | Playwright | ~7.5 min |
| Production build | **0.6 min** | build | 16 s |
| Playwright E2E Smoke Suite (gate) | 0.5 min | — | — |

Everything else in the critical-path job is trivial by comparison: `npm ci` **9 s**, type check
**31 s**, ESLint **57 s**, migrations **~1 s**, RLS tests **~0 s**, `npm audit` **2 s**. [CI]

Two conclusions fall straight out of this table:

1. **The gate is 86% one step.** Nothing you do to lint, typecheck, install, build or the database
   will move the needle. Only the unit suite matters.
2. **The two shards are badly balanced** — 12.2 min vs 8.8 min, a 39% gap. Shard 1 is also the
   one that fails more often (7 failures vs 5 in the sampled PR failures). Balancing them is
   nearly free.

I verified the fast steps are genuinely fast, not silently skipped: `supabase/migrations/` is
**39 files / 1,906 lines of SQL** and `rls.test.sql` is **652 lines**, so ~1 s is plausible. I
also checked the failure behaviour directly — `npx tsx scripts/db-test.ts rls` **exits 1** both
with no `LF_TEST_DATABASE_URL` and with an unreachable one. **These gates cannot pass silently.** [LOCAL]

*(I want to be explicit about this one because it looked alarming at first: the 1-second timing
made me suspect the security-rule tests were no-ops. They are not. I tested it and was wrong.)*

### 4.2 The same suite runs three times

`validate` runs it with coverage (14.0 min); both `timezones` jobs run it again without (10.9 and
11.0 min). That is **~36 minutes of runner compute for one suite**, on a 4-core runner, on every
PR. Total runner compute per CI run: **~61 min**; wall clock: **16.2 min**. [CI]

The time-zone runs are *not* waste — `PLAN.md` §14 is right that dates are where money software
breaks quietly, and they have caught real bugs. But running them on every PR is paying a
permanent tax for a check whose value is mostly on merge. §7.4 has the cheaper version.

### 4.3 The gate got 8× more expensive — and 3.4× more trustworthy

| Month | CI runs | Median wall clock | Failure rate |
|---|---|---|---|
| Sep 2026 | 351 | **1.6 min** | **77.5%** |
| Oct 2026 | 923 | **13.3 min** | **23.0%** |

[GH]

Read this carefully, because the naive reading is wrong. September's 1.6-minute median is **not**
efficiency — it is **fast failure**. Three runs in four died in the first two minutes at
typecheck or lint. The pipeline was red so often that "CI green" carried almost no information.

October is the opposite: runs go the full 13 minutes because they usually pass. **The gate became
8× more expensive and 3.4× more trustworthy at the same time.** That trade was correct. But the
price is now paid 923 times a month, and it was never re-examined after the switch. **That is the
opportunity in §7.**

### 4.4 Total spend so far

**2,070 workflow runs ≈ 243 hours of runner compute**, of which the `CI` workflow alone is
**1,274 runs / 200.8 hours** at a **38.1% failure rate**. [GH] On a public repo the minutes are
free — the cost is entirely in **agent waiting time and rework**, which is the expensive kind.

---

## 5. Claims in this repository I could not reproduce

I checked the measured numbers that `docs/TRACKER.md` and the 18-Oct audit rest on. **Three did
not survive checking (§5.1–5.3), two guards are weaker than their names suggest (§5.4, §5.5), and
one number is far better than the repository records (§5.4b).**

**This matters because Shortcut #1 in `docs/TRACKER.md` — worth 13 tracker items and ~900 deleted
lines — is justified by the first one.**

### 5.1 "Sales.tsx vs Purchases.tsx = 61% identical" — I measure 10%

`docs/TRACKER.md`, "What the code shows (measured)". I applied the same customer↔vendor
substitution (plus invoice↔bill, AR↔AP, sales↔purchases) and measured three ways: [LOCAL]

| Metric | Result |
|---|---|
| Ordered line similarity (`SequenceMatcher`) | **10.4%** |
| Distinct-line set overlap (Jaccard) | **10.8%** (95 shared of 565 / 413) |
| Token multiset overlap | **44.2%** |

I cannot get to 61% by any of these. The closest is 44% token overlap, which counts shared
*vocabulary*, not shared *structure* — and two files in the same domain share vocabulary for free.
The files are also very different sizes now (799 vs 562 lines), which the 61% figure cannot
accommodate.

**What I recommend:** do not spend the Shortcut #1 refactor on the strength of that number.
Re-measure with a stated method first. There *is* real overlap (44% of tokens is not nothing) and
the `InvoiceModal`/`BillModal` pair is a much stronger case — I measured **35.3% ordered
similarity** there, and those two are 799 + 727 lines of near-parallel line-item editing. If you
want one de-duplication, start with the modals, not the list screens.

### 5.2 "platform/ = 10,945 lines, nearly as big as ledger/ (12,274)" — it is now bigger

Current line counts: [LOCAL]

| Directory | TRACKER says | **Now** | Change |
|---|---|---|---|
| `src/components/platform/` | 10,945 | **15,903** | **+45%** |
| `src/components/ledger/` | 12,274 | **14,475** | +18% |
| `src/components/reporting/` | — | **17,836** | — |

`platform/` no longer *approaches* the accounting core — **it is 10% larger than it**, and
`reporting/` is larger than both. This is the clearest structural signal in the codebase: the
admin/settings/tooling surface has outgrown the product it administers. It is not a bug, but it
should be a conscious decision, and it argues for the report-shell shortcut (#4) over more
platform screens.

### 5.3 "eslint-plugin-react not installed" — it is installed

`package.json:116` has `"eslint-plugin-react": "^7.37.5"` and it is present in `node_modules`.
[LOCAL] Stale finding; the autofix it recommends (`jsx-no-target-blank`) may already be available.

### 5.4 ESLint is at exactly its cap — and the ratchet does not track it

`eslint . --max-warnings 205` returns **205 warnings, 0 errors**. [LOCAL] The cap is set to the
exact current count, so **any agent who adds one warning anywhere fails CI**, on a rule that has
nothing to do with their change. In a nine-agent setup this converts a cosmetic issue into a full
red-gate round trip. §7.5 fixes it in one sitting.

There is a second, subtler problem. `quality-baseline.json` has a field called
**`eslintWarnings: 3`** — but `scripts/quality-metrics.ts:282` `computeEslintWarnings()` does not
count ESLint warnings at all. It counts the strings `eslint-disable`, `@ts-ignore` and
`@ts-expect-error` in non-test source. **So the ratchet is tracking suppressions (3), not
warnings (205), under a name that says warnings.** [LOCAL]

The practical consequence: **the 205-warning ceiling is enforced only by `--max-warnings` in
`package.json`, not by the ratchet.** The ratchet cannot stop the warning count climbing — someone
has to lower the flag by hand. Rename the field to `suppressionCount` and add a real
`eslintWarnings` metric.

### 5.4b The ratchet *is* working — and better than TRACKER records

Because I read the baseline, I have to correct the repository's own numbers in the other
direction. `quality-baseline.json` today: [LOCAL]

| Metric | TRACKER records | **Baseline now** |
|---|---|---|
| `anyCount` | 1,287 → 1,210 | **50** |
| `filesOver800` | 15 | **0** |
| `arrayIndexKeys` | 64 | **0** |
| `consoleLog` | 8 | **0** |
| `utcDateCount` | 40 | **35** |
| `orphanFiles` | — | **0** (matches my independent check, §2.1) |
| `untestedViews` | 77 | **44** |

`any` went **1,287 → 50**, and files over 800 lines went **15 → 0** (my own scan confirms it: the
largest source file is 799 lines). The ratchet from `docs/TRACKER.md` STEP 0b is the most
successful process idea in this repository and `docs/TRACKER.md` has not been updated to say so.

**The one metric still open is `untestedViews: 44`** — 44 registered views are not covered by the
registry smoke test. Given §2.3 (Stage A's remaining work is all about proving journeys on real
screens), that number is the most relevant one in the file and deserves to be on the
`CURRENT_WORK.md` short list.

### 5.5 One guard that is weaker than it looks

`src/tests/no-orphan-modules.test.ts` is the guard behind PLAN §13's "code a user cannot reach is
not a feature". Its matching logic reduces to *"does this filename appear as a substring anywhere
in any non-test file"* — the `content.includes(fileName)` clause makes the whole preceding `||`
chain redundant, and the computed `thisFileName` is unused (that is literally one of the 205
warnings, at line 48). It also covers **only `src/lib`**, not `src/components`.

To be fair and precise: **it is not currently lying.** I reimplemented a strict import-path check
and got the same answer it does — **0 orphans in `src/lib`** — and **0 orphans across all 480
components**. So the guard's conclusion is right today. The risk is that a substring match will
keep passing after a real orphan appears (any file whose name is a substring of another will mask
it), and that components are unguarded. Tighten it while it is cheap.

---

## 6. Easier strategies

Ranked by value ÷ effort. These are *alternatives to* or *reorderings of* work already planned —
not new scope.

### 6.1 Batch the E lane the way the A lane already does — free, 4.3×

The measurement in §3.1 is the cheapest win in this document. The A lane gets 1.7 commits/task by
putting 5–15 tasks in one PR; the E lane spends 7.3. `docs/PLAN.md` §13 already identified this
for AI #3 but as a *reason it is fast*, not as a rule for everyone. **Make it a rule:** any lane
whose tasks are independent must land ≥5 per PR. At the current gate cost that is worth roughly
**3 hours of waiting per task avoided** in the E lane alone.

### 6.2 Do the three remaining Stage A items in one browser-work push

W10, W14 and G-02 are all browser journeys and all currently assigned across AI #4 / AI #7
(§2.3). They share fixtures, auth setup and the same flaky surface. Three separate agents will
each pay the browser-suite setup cost and each hit the same flakes independently. **One agent, one
branch, three journeys, one PR** is the cheaper shape — and it is exactly the shape that produced
the A lane's 1.7.

### 6.3 Stop hand-writing verification prose

`docs/verification/` holds **83 markdown files / 12 MB**. Each is a hand-written account of a
journey that a browser test also proves. The prose is valuable for the owner, but it is written
*after* the test passes, so it is a transcription step. Generating a short standard summary from
the Playwright JSON reporter (which CI already produces — `PLAYWRIGHT_JSON_OUTPUT_NAME` is set in
`ci.yml`) would remove the transcription without losing the evidence. [LOCAL/CI]

### 6.4 Re-measure before refactoring

This is a process rule more than a strategy, but §5 is the evidence: **three of the numbers that
justify planned refactors did not survive a re-measurement (§5.1–5.3)**, and one of them (§5.1) is
the stated justification for a 13-item refactor. A cheap standing rule — *any refactor justified
by a similarity or size number must include the command that produced it* — would have caught all
three, and would also have surfaced §5.4b (the ratchet has done far better than TRACKER claims).

### 6.5 What I would **not** change

- **Do not restructure the three-layer architecture.** It holds up, there is no dead code behind
  it, and the 18-Oct external audit reached the same conclusion.
- **Do not reduce test coverage to gain speed.** Shard instead (§7.1). The coverage is what makes
  the 0.9 h merge cycle safe.
- **Do not drop the time-zone runs** — make them cheaper (§7.4).
- **The PolyForm licensing, the staged A/B/C gate, and "bookkeeping before payroll/tax filing"
  (PLAN §17) are the right calls.** Nothing I measured argues against them.

---

## 7. The leverage set: changes that make other changes faster

This is the section the request was really about. Each item states the change, the evidence, the
expected saving, and the risk. Ordered by (saving ÷ effort).

### 7.1 ⭐ Shard the unit suite — the single biggest win

**Evidence:** the gate is 16.2 min and **86% of it is one step**, `npm run test:cov` at 14.0 min
[CI]. The suite is **736 test files** (421 `.ts` + 315 `.tsx`) [LOCAL]. The `e2e` job already
proves the team knows how to shard — it does it in two.

**Change:** run the unit suite across 4 parallel jobs (`--test-shard` is not in `node --test`, so
split the file list 4 ways with a matrix, exactly as `e2e_shards` does). Keep coverage on one
shard, or aggregate.

**Expected:** 14.0 min → **~4 min**; gate **16.2 min → ~6 min**.
**Also:** the browser shards are 12.2 vs 8.8 min — rebalancing them removes another ~3 min from
that job. And `playwright.config.ts` has **`workers: 1`**; raising it to 4 on a 4-core runner
should take the browser job from ~12 min to **~3–4 min** on its own. [LOCAL config read]
**Risk:** low. Sharding can mask cross-file state coupling — but `fullyParallel: true` is already
set for Playwright and the unit files are already separate processes, so isolation is unchanged.
**Combined effect: the gate goes from 16.2 min to roughly 5–6 min. That is ~10 minutes off every
one of 1,274 CI runs, and ~10 minutes off every agent's inner loop.**

### 7.2 ⭐ Quarantine the flaky browser specs — makes `main` trustworthy again

**Evidence:** **100%** of sampled `main` failures are the Playwright suite (8/8); it is involved
in **10 of 13** sampled PR failures [GH]. `playwright.config.ts` sets `retries: 2` in CI, which
hides flakiness *and* triples the runtime of any failing spec. Issue **#146** is an open, known
flaky drawer.

**Change:** tag known-flaky specs, move them into a **non-blocking** job until fixed, and make the
blocking browser job contain only specs with a clean history. Track the quarantine list as a
ratchet that can only shrink.

**Expected:** `main` red rate **26% → near 0**.
**Why this is worth more than its minutes:** in a nine-agent workflow, a red `main` means every
agent that branches from it inherits an unexplained failure and burns a full investigate-fix-retry
loop discovering it is not theirs. That loop costs far more than 16 minutes. **This is the change
that makes every other change faster in the way the request asked about.**
**Risk:** real, and must be managed honestly — a quarantined spec is not testing anything. Cap the
list, publish it, and shrink it weekly.

### 7.3 ⭐ Balance the browser shards and raise `workers`

**Evidence:** shard 1 = 12.2 min, shard 2 = 8.8 min (39% imbalance) and shard 1 fails more often
[CI/GH]. `workers: 1` [LOCAL].
**Change:** `workers: 4` under CI; move to 3–4 shards; or use Playwright's
`--shard` with a stored timing profile so shards equalise by measured duration.
**Expected:** browser job 12.2 → **3–4 min**. **Risk:** very low. This is the cheapest item here.

### 7.4 Make the time-zone runs cheaper, not rarer

**Evidence:** the suite runs 3× per CI run: 14.0 + 10.9 + 11.0 min [CI].
**Change:** keep both time-zone runs on **push to `main`** (where their value is real — they
guard the merged result). On **pull requests**, run them only when the diff touches date/time
code — a `paths` filter on the date, fiscal-calendar, period-close and report files.
**Expected:** removes ~22 min of runner compute from most PR runs without losing the check where
it matters. **Risk:** low; a date bug in an unfiltered file would be caught at merge instead of at
PR. `PLAN.md` §14's reasoning survives intact.

### 7.5 Clear the 205 ESLint warnings once, then keep the cap low

**Evidence:** exactly **205 warnings at a cap of 205** — zero headroom [LOCAL]. The suppressions
are already almost gone (3 in all of `src`, §5.4b), so these are genuine lint findings, not hidden
ones — and a large share look mechanical (unused vars, `no-explicit-any`).
**Change:** one batch PR to clear them (much is autofixable), then set the cap near 0. Add a real
`eslintWarnings` metric to the ratchet (§5.4) so the ceiling defends itself.
**Expected:** removes an entire class of CI failure that is unrelated to the change being tested.
**Risk:** none, if done as its own PR with no functional edits.

### 7.6 Close the "local green ≠ CI green" gap

**Evidence:** **147 of 736 test files (20%)** reference `LF_TEST_DATABASE_URL` [LOCAL]. Locally
they skip; in CI they run against real Postgres. **This is already known inside the project** —
`docs/archive/audit/AUDIT_PROGRESS.md:75` records *"Output contained 125 `LF_TEST_DATABASE_URL not set`
notices. TAP's final leaf skipped count was 0; therefore this result does not claim DB/RLS
coverage."* That last clause is the sharp part: **TAP reports zero skips while 125 files silently
did nothing**, so the suite's own summary looks complete when it is not.

So an agent's local `npm test` pass covers materially less than CI does, and the output does not
say so. That gap is a direct input to the 26% red-`main` rate (§1).
**Change:** make `npm test` print a bright, counted list of database-skipped files at the end, and
**fail loudly** when the database is missing in a development context. Or ship a one-command local
Postgres (`docker compose` or `scripts/db-local.sh`) so the 20% actually runs.
**Expected:** fewer "passed for me" round trips. **Risk:** low; the skip behaviour is deliberate,
so make it *visible* rather than removed.

### 7.7 Reduce the per-file process cost (smaller, later)

**Evidence:** 736 files, each spawned as its own `tsx` process; a 47-line test file costs
**0.63 s** end to end, of which **~0.59 s** is bare `tsx` startup [LOCAL]. That is ~7.2 min of
serial startup in the suite.
**Clean measurement of test cost, serial, on an idle 2-core box** [LOCAL]:

| Kind | Files | Measured | Per file |
|---|---|---|---|
| jsdom `.tsx` | 315 | 12 files / 56 tests in **11.46 s** | **955 ms** |
| pure `.ts` | 421 | 12 files / 48 tests in **3.16 s** | **263 ms** |

A jsdom test file costs **3.6×** a pure one. Options: prebundle the test tree (esbuild is already
a dependency), or switch to `node --experimental-strip-types` to drop `tsx` per-file startup.
**Caveat, stated honestly:** these local numbers **exclude all 147 database-backed tests**, which
skip without Postgres. That is why my serial estimate (~7 min) is well below CI's 10.9–14.0 min,
and why I am ranking this *below* sharding rather than above it. I could not decompose the
DB-backed share — there is no Postgres or Docker in this sandbox.

### 7.8 Fix the two status files disagreeing

**Evidence:** §2.3 — `RELEASE_GATE.md` says W1 Verified = Yes; `CURRENT_WORK.md` says worked
figures are still outstanding.
**Change:** one source of truth. `RELEASE_GATE.md` holds the table; `CURRENT_WORK.md` links to it
instead of restating it.
**Expected:** stops duplicate and skipped work across nine agents. **Risk:** none. **Effort:** minutes.

### 7.9 Summary: what the leverage set is worth

| Item | Gate before | Gate after | Effort | Risk |
|---|---|---|---|---|
| 7.1 Shard unit suite | 16.2 min | ~6 min | half a day | low |
| 7.3 `workers: 4` + balance shards | 12.2 min | ~3.5 min | an hour | very low |
| 7.4 Time-zone runs on main only | — | −22 min compute/PR | an hour | low |
| 7.5 Clear 205 warnings | — | one failure class gone | a day | none |
| 7.2 Quarantine flakes | 26% red main | ~0% | a day + weekly triage | medium, managed |
| 7.6 Loud DB skips | — | fewer false greens | half a day | low |
| 7.8 One status source | — | fewer duplicate tasks | minutes | none |

**7.1 + 7.3 alone: gate 16.2 min → ~5 min, for well under a day of work.** Everything else in the
pipeline — including the last three Stage A workflows — gets that much faster for free.

---

## 8. Suggested sequence (if you want a plan)

**Day 1 — make the loop fast (7.3, 7.1).** `workers: 4`, rebalance shards, shard the unit suite
4-way. Measure the gate before and after and write the number into `docs/CI_STRATEGY.md`.
**Day 2 — make `main` trustworthy (7.2, 7.8).** Quarantine the flaky specs with a published,
shrinking list; collapse the two status files into one.
**Day 3 — remove friction (7.5, 7.4, 7.6).** Clear the 205 warnings; time-zone runs to main-only
plus a date-path filter on PRs; make DB skips loud.
**Day 4–5 — ship Stage A (6.2).** One agent, one branch, W10 + W14 + G-02 as browser journeys in
a single PR — now running against a 5-minute gate and a green `main`.

Then, and only then, revisit the 15 shortcuts in `docs/TRACKER.md` — starting with a re-measured
§5.1 and with the modals (§5.1) rather than the list screens.

---

## 9. What I could not check

Stated plainly, so you can weigh the rest:

- **I did not run the full unit suite to completion locally.** It was still running after 75
  minutes on this 2-core sandbox with no database configured, so I stopped it. The 14.0 min /
  10.9 min figures are GitHub's own timestamps from a real 4-core CI run, which is the more
  authoritative source anyway — but I have no local end-to-end test count to compare against the
  test totals this repository quotes, which themselves disagree: `docs/PLAN.md:33` says **2,785**
  unit tests, while `audit/ARCHITECTURE_AND_STRATEGY_REVIEW.md:47` and `docs/archive/audit/AUDIT_PROGRESS.md:75`
  say **2,799**.
- **No Postgres or Docker exists in this sandbox**, so I could not run `db:test-setup`,
  `test:rules`, or any of the 147 database-backed tests. Everything about the database layer here
  is read-from-source plus the verified exit-code behaviour, not executed.
- **The clone is shallow** (1 commit), so all history-based numbers come from the GitHub API rather
  than local `git log`.
- **I did not run the browser suite.** The Playwright findings are from `playwright.config.ts`,
  `ci.yml`, and recorded CI outcomes — not from reproducing a flake.
- **I changed no code.** Nothing in this file has been applied.

---

## Appendix A — reproduce every number

```bash
# Repository shape [LOCAL]
find src -name '*.ts' -o -name '*.tsx' | grep -v '\.test\.' | grep -v '^src/tests/' | xargs cat | wc -l   # 198,205
ls src/tests/*.test.tsx | wc -l        # 315
ls src/tests/*.test.ts src/lib/*.test.ts src/server/utils/*.test.ts | wc -l   # 421
ls e2e/*.spec.ts | wc -l               # 84
ls supabase/migrations | wc -l         # 39

# Orphan check (0 results = no dead code) [LOCAL]
#   see §5.5 — strict import-path scan over src/components and src/lib

# Gates [LOCAL]
time npx tsc --noEmit                                  # 46 s, clean
time npx eslint . --max-warnings 205                   # 77 s, 205 warnings / 0 errors
npx tsx scripts/db-test.ts rls; echo $?                # exits 1 without a database

# Per-file test cost, serial, idle machine [LOCAL]
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-concurrency=1 <12 .tsx files>  # 11.46 s / 56 tests
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-concurrency=1 <12 .ts files>   # 3.16 s / 48 tests
grep -rl LF_TEST_DATABASE_URL src/ | wc -l             # 147

# Quality ratchet state (§5.4b) [LOCAL]
cat quality-baseline.json                              # anyCount 50, filesOver800 0, untestedViews 44
sed -n '282,307p' scripts/quality-metrics.ts           # computeEslintWarnings counts suppressions, not warnings

# History, PRs and CI [GH]
gh api "repos/shmuelbiller1/ledgerflow/commits?per_page=1" -i | grep -i '^link:'   # 2,054 commits
gh api "repos/shmuelbiller1/ledgerflow/pulls?state=all&per_page=100&page=N"        # 275 PRs
gh api "repos/shmuelbiller1/ledgerflow/actions/runs?per_page=100&page=N"           # 2,070 runs
# Critical-path step timings (§4.1): run 39706885385
gh api "repos/shmuelbiller1/ledgerflow/actions/runs/39706885385/jobs?per_page=50"
```

---

## Appendix B — what AI #1 did with this audit (22 Oct)

Each recommendation checked against `main` first; corrections to the audit are marked **Correction**.

| § | Recommendation | Done |
|---|---|---|
| 7.1 | Shard the unit suite | **Done.** Four parallel parts (`node --test --test-shard=n/4`, `npm run test:shard:cov`). **Correction:** `--test-shard` *is* in `node --test` (Node ≥ 20.5; CI runs 24). Coverage is kept, not dropped: each part writes lcov and `scripts/coverage-merge.mjs` merges them and applies the same 75/72/73 thresholds, counting lines exactly as Node does (checked: one run and the merged parts give identical percentages). `scripts/coverage-merge.test.mjs` keeps both sets of thresholds equal. |
| 7.3 | Browser `workers: 4` + balance shards | **Shards 2 → 4. `workers` stays 1**: the tests in a shard share one dev server and one database, so more workers there changes isolation; four separate machines give the speed without that risk. |
| 7.4 | Time-zone runs cheaper | **Each time zone now runs in two parts** (every PR keeps both zones; wall clock about halves). No path filter: a date bug in a file the filter missed would only show on `main`. |
| 7.2 | Quarantine flaky browser specs | **Not done, deliberately.** The project rule is never to skip or quarantine a test to get green. The recorded flakes have been root-caused instead (e.g. the Plaid script loading on mount, fixed 21 Oct; F-48/F-49 in AI #8's queue). |
| 7.5 | Clear the ESLint warnings | **205 → 106**, cap lowered to 106. All 102 unused-variable warnings cleared except 5 imports that are the only thing keeping 4 modules "reachable" (see 5.5). Left: 65 `no-explicit-any`, 26 React-hook warnings — judgement, not mechanical. |
| 5.4 | Ratchet field named `eslintWarnings` counts suppressions | **Renamed `suppressionCount`.** The ratchet test now also fails when a metric has no baseline (a renamed or new metric was silently never checked). The real warning count stays guarded by `--max-warnings`, lowered automatically by the ESLint ratchet workflow. |
| 5.5 | Orphan guard is a substring match | **Correction: there was dead code.** The strict guard (`reachability-guard.test.ts`, import graph from the entry points) already existed, but its ignore list held exactly the dead files: `src/constants.ts`, `src/domain/Accounts.ts` and the unused auth singleton chain (`services/auth/index.ts`, `services/auth/types.ts`, `infra/auth/FirebaseAuthAdapter.ts`). All five deleted, the ignore list cut to `vite-env.d.ts` and `vite.config.ts`, and the weaker `no-orphan-modules.test.ts` removed (reachable from an entry point implies imported). **Found while clearing warnings:** `PartyDetailView`, `partySides`, `entityFramework` and `taxRateDefaults` are reachable only through unused imports — built, not on any screen. Recorded in TRACKER; the first two are the start of shortcut 1. |
| 7.6 | Database-skipped tests invisible | **Done.** `src/tests/database-tests-notice.test.ts`: without the database it is one skipped test whose reason names how many files (150) did not run; with `CI=true` and no database it fails. |
| 7.8 | W1 status contradicts itself | **Fixed, and the cause found:** `RELEASE_GATE.md` held a stale second copy of the W1–W14 rows from an old merge; removed. W1 is done (W1-GOLD #291). `CURRENT_WORK.md` now lists only what is left and points to RELEASE_GATE. `src/tests/release-gate-table.test.ts` fails on a duplicated row or a workflow listed both open and done. |
| 5.1–5.3, 5.4b | Stale numbers in TRACKER | **Re-measured with the method written down.** Sales/Purchases **21%** (my wider name swap; the audit's 10% used a narrower one — either way not 61%). **Correction to the plan:** the AR/AP aging views and Customer/Vendor modals are *already* one component each; the strongest remaining mirror is CustomerDetailView/VendorDetailView at **84%**, then InvoiceModal/BillModal at 38%. Shortcut 10's ratchet numbers updated (`any` 1,287 → 50 etc.). New rule: a refactor justified by a number includes the command. |
| 6.1 | Batch small tasks | Rule 10 added to COORDINATION's rules for every helper AI. |
| 6.2 | W10 + W14 + G-02 as one browser push | W10 and W14 are already one agent's (AI #4: D-98, D-99); G-02 waits on G-24. |
| 6.3 | Generate verification summaries | Not done (no code change needed to keep shipping); noted for AI #4. |
