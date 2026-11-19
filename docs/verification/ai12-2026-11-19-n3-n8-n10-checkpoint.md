# AI #12 checkpoint — 19 Nov 2026: N-3 / N-8 / N-10 continuation and PR #897 review findings

**Agent:** #12 (Arena) · **Branch:** `arena/c2f61ba0-ledgerflow` (Arena-fixed for this session)
**Base:** `5eacf71f633f00a5db7ae44d3fdba75b4d3700cf` (`origin/main`, 18 Nov 20:14 −0500)
**Scope:** onboarding and help lane only. No money, posting, tax, server, migration or schema change.

---

## 1. Instruction sources actually examined

| Source | What was read |
|---|---|
| `AGENTS.md` (root) | architecture, money/category invariants, bot-review rule |
| `CLAUDE.md` | PR/merge ownership, "keep working" |
| `AI10_SESSION_ADDENDUM_2026-11-17.md` | prior agent's open items, server-lane findings |
| `CURRENT_WORK.md` | "Start of every session", "Rules that never change", open-PR rule |
| `docs/COORDINATION.md` | "Rules for every helper AI", "NOW", the whole §"AI #12: tasks", the latest Messages |
| `src/AGENTS.md`, `src/components/AGENTS.md`, `src/lib/AGENTS.md`, `src/tests/AGENTS.md` | scoped contracts |
| `docs/verification/TODO_LIST_TRUTH_AUDIT_2026-11-17.md` §3.3 | stale-box analysis of AI #12's queue |
| GitHub | open PR list; PR #897 body, 7 commits, review comments, issue comments, check runs; PR #829 state (MERGED) |

---

## 2. State found at session start

- My own open PR **#897** (`arena/145e7090-ledgerflow`, author Chaim-Richard, AI #12's fork identity) carries N-10 and N-3; its body still said N-8 was to come.
- **PR #829 (N-2) was already merged**, but its queue box was still `[~]`.
- Gitar's review on #897 had **one unresolved confirmed defect** (repeated again at 02:55 UTC): the English password refusals render the literal `{min}` placeholder.
- SonarCloud's quality gate on #897 failed on duplicated new code (17.7 %, then 15.0 % on the newer head).
- A **second, concurrent AI #12 session was still pushing to #897** (commits at 02:53 and 02:54 UTC). Its new `e2e/onboarding-first-invoice.spec.ts` covers wizard → invoice → checklist, and it refactored the three translation tables into `src/lib/i18n/stringTable.ts`. No work of that session was overwritten: after fetching, its head was merged into this branch and all of its files were kept (conflicts resolved in its favour, then my fix re-applied).

Arena fixes this session to `arena/c2f61ba0-ledgerflow`, so the only way to work was on this branch. No push or PR targets another branch's work as a replacement.

---

## 3. Findings register

| ID | Severity | Status | Location | Evidence / consequence | Fix |
|---|---|---|---|---|---|
| **F12-01** | Medium (user-visible regression) | **Confirmed, fixed, verified** | `src/core/auth/AuthScreen.tsx:80-87`, `src/core/auth/NewPasswordScreen.tsx:24-33` | The N-10 cut replaced `passwordProblemSentence(code)` with `onboardingText(code, language)` on the English path while filling `{min}` only on the Hebrew branch. An English new user typing a short password saw **"Use at least {min} characters"** instead of "Use at least 10 characters". Repro: sign up or reset-password in English → type `short1!` → submit. | Both screens now call `onboardingTextWith(..., language, { min: MIN_PASSWORD_LENGTH })`; the table stays the single source. Two component tests render the real forms in English and assert the exact sentence. Non-vacuity proved: reverting the source fix produces `actual: 'Use at least {min} characters'` and 2 failing tests; restoring it gives 41/41 passing. |
| **F12-02** | Medium (CI gate) | **Open — owner/lead decision** | SonarCloud on PR #897; translation dictionaries in `src/lib/i18n/` | Quality gate failed at 17.7 % duplicated new code (required ≤ 3 %), then 15.0 % after the other session's `stringTable.ts` refactor. Much of the remainder is bilingual dictionary data — AI #5 used the project's existing intentional-translation CPD exclusion for PCN874 and documented it. | Do **not** weaken the gate. Lead should decide whether the onboarding dictionaries qualify for the same exclusion; the other session's refactor already removed the copy-pasted lookup code (jscpd reported 0 clones over the 68 changed files). |
| **F12-03** | Low (process) | **Fixed in this branch** | `docs/COORDINATION.md` §"AI #12: tasks" | N-2 was merged (#829) but left `[~]`; stale boxes make the next AI rebuild finished work (`TODO_LIST_TRUTH_AUDIT_2026-11-17.md` §3.3 counts 6 of 10). | Ticked N-2 with #829; left N-3/N-8/N-10 as `[~]` with the PR that carries each, correct under "tick only when merged". |
| **F12-04** | Low (coverage gap, not a defect) | **Work added, CI-only verification** | `e2e/first-hour-journey.spec.ts` | The existing journey already did customer → invoice → email → paid → P&L at 390/1280 px, but never opened the invoice preview and did not state the empty starting condition. The other session's new spec covers wizard → invoice → checklist and deliberately leaves the payment step open. | This branch adds an explicit empty-Sales assertion and a preview-from-row leg (dialog names `INV-FIRST`, real PDF iframe, no error state, Escape closes) before the existing email/payment/P&L steps. The two specs are complementary. |

**Suspected, not confirmed:** none in this lane from this session. **No financial or server defect was found or patched.**

---

## 4. Work implemented on this branch

1. Cherry-picked AI #12's five PR #897 commits (N-10, N-3, bundle split, wizard sentence fix, Hebrew e2e fix) onto current `main` because Arena fixes this session to a new branch.
2. **F12-01 fix** + two regression tests (non-vacuity demonstrated).
3. **N-8 journey extension** in `e2e/first-hour-journey.spec.ts` (both viewports).
4. Merged PR #897's later head (02:54 UTC) so none of the concurrent session's work is lost; resolved add/add and content conflicts in favour of its newer `stringTable.ts` refactor, then re-applied the fix and tests.
5. Queue and Messages updated in `docs/COORDINATION.md`.

---

## 5. Checks actually run

| Check | Result |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit -p tsconfig.json` | **exit 0** (default heap OOMs in this 3.8 GB sandbox — infrastructure, not a type error) |
| `npx eslint` on the 4 touched code files, `--max-warnings 2` | **0 errors, 0 warnings** |
| `npx tsx --test ... src/tests/onboarding-hebrew.test.tsx src/tests/error-remedies-hebrew.test.tsx src/tests/onboarding-translation-guard.test.ts` | **41 tests, 41 pass, 0 fail** |
| Non-vacuity probe (reverse-apply only the source fix, rerun) | **2 failures with the exact raw `{min}` string**; fix restored afterwards |
| `npx playwright test --list` for the three onboarding/first-hour specs | **7 tests listed** (2 first-hour, 2 onboarding-first-invoice, 3 onboarding-Hebrew) — specs compile |
| Chromium browser journeys | **not run locally**: no system Chromium and no Playwright browser cache; `LF_TEST_DATABASE_URL` unset. CI runs them. |
| Full unit suite / build | **not run locally** — CI's job per `CURRENT_WORK.md` "Let GitHub CI do the heavy testing" |

**PR #897 CI at 03:00 UTC:** SonarCloud **fail** (F12-02); CodeQL, Schemathesis, Gitar, production build, SBOM, "What changed" **pass**; unit shards and browser shards still pending or being re-run on the newer head. No green claim is made.

---

## 6. PR / commit state

- Session branch: `arena/c2f61ba0-ledgerflow`, base `5eacf71`.
- Commits: `aa2710a4`, `feaa859c`, `29ba2c8f`, `3acc9772`, `36b3a40f` (carried #897 work), `29e961be` (F12-01 + N-8), `0a0479a6` (merge of #897's current head + queue updates).
- PR: stacked fix into `arena/145e7090-ledgerflow` (PR #897's branch), **not** a second PR into `main`. This keeps N-3/N-8/N-10 in one workstream while Arena's branch restriction is respected.
- The concurrent session was told about F12-01 in a comment on #897 so the fix can also be applied there directly.

---

## 7. Google Drive preservation

See the dated addendum uploaded with this checkpoint (`2026-11-19_Agent12_N3-N8-N10_MASTER_RECOVERY_INDEX_ADDENDUM.md`) and the exact recovery patch (`2026-11-19_Agent12_PR897-min-fix.patch`). **File IDs are recorded in the addendum after upload and verification.**

---

## 8. Remaining work / handoff

1. Lead: decide F12-02 (Sonar exclusion for translation data); PR #897 cannot be called ready while its quality gate is red.
2. CI: confirm both browser legs (this branch's preview leg and the other session's wizard→invoice spec) pass at 390 and 1280 px; no local Chromium here.
3. AI #12's queue now has **zero untouched tasks**: N-1, N-2, N-4, N-5, N-6, N-7, N-9 done; N-3, N-8, N-10 done-pending-merge. Per the queue rule, Claude should add more work when #897 lands.
4. No launch judgement is made for the whole application from this lane-scoped session. Lane assessment: **CONDITIONALLY READY** — the onboarding/help work is implemented and unit-verified, with CI/browser and Sonar gates outstanding.
