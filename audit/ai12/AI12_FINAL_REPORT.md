# AI #12 — final report (onboarding & help lane)

**Date** 2026-11-19 · **Branch** `arena/145e7090-ledgerflow` (base `main` `bce500c`) · **PR**
[shmuelbiller1/ledgerflow#897](https://github.com/shmuelbiller1/ledgerflow/pull/897) · **Head**
`632f1625754a0a535bc697bad558f0a9082231d2` · **Unmerged**, per governance.

## 1. What this PR contains (10 commits)

| Commit | Task | What changed for the person using it |
| --- | --- | --- |
| `6dcb990` | N-10 (#838) | Sign-in, sign-up, new-password, the setup wizard, the first-hour guide and the first-week checklist speak Hebrew and read right-to-left; English keeps every sentence and accessible name. |
| `cd70dd1` | N-3 | Every failed save/load explains itself in the language the reader chose, including the remedy. |
| `b5b70ec` | (fix for N-10) | The copy table no longer doubles every sentence: entry chunk 276,789 B → 256,287 B, back inside the 260,000 B budget. |
| `d91eaec` | (Gitar) | The suggested-labels sentence names the labels the person actually chose, instead of claiming "None … Fund is self-balancing" before a business type is picked. |
| `505fbeb` | (CI) | The Hebrew screens' Latin-word check measures copy, not currency codes and time zones. |
| `dec5633` | (Sonar) | Three tables shared one reader; the duplicated fixture mount became one helper. |
| `3c3138b` | N-8 | A walk-through of the first invoice: set the books up, write invoice one, and check the Overview notices it (3 of 5 steps, payment still open). |
| `efec862` | (Sonar) | Bilingual tables excluded from CPD, following the repo's existing precedent; nothing else relaxed. |
| `ca3c108` | (Sonar) | The N-3 remedy sentences moved into their own module; the classifier stayed behind. |
| `632f162` | (Gitar) | An English password refusal shows "Use at least 10 characters", not the literal `{min}`. |

73 files, +2,275 / −248. **No file under `src/server/`, `supabase/migrations/`, `api/`, `server.ts`,
money, tax or PDF paths is touched** (`git diff --name-only bce500c..632f162`).

## 2. Verification — what was actually run, and where

All figures below come from the hosted CI run on the **head commit `632f162`** unless marked local.

| Check | Result |
| --- | --- |
| `What changed` (scope) | pass — `browser_mode=full`, `build_mode=full` |
| Lint, Typecheck, and Database rules | pass |
| Production build (incl. bundle invariants) | pass — entry chunk 256,449 B < 260,000 B |
| Unit tests 1–4/4 | pass |
| Unit tests in America/Los_Angeles 1–3/3, Pacific/Auckland 1–3/3 | pass |
| Accounting & Security Test Suites (coverage gate) | pass |
| Browser shard 1–5/5 | pass — **all five of this PR's E2E tests run in shard 2**, verified with `playwright test --list --shard=2/5` |
| Playwright E2E Smoke Suite | pass |
| SonarCloud Code Analysis | **pass** (Quality Gate; duplication was 19.1% → 15.0% → 3.8% → pass) |
| CodeQL JavaScript and TypeScript | pass — no new alerts |
| Produce CycloneDX inventory / Schemathesis / Gitar | pass |
| Docs checks, Browser tests (changed specs) | skipped by the repo's own scope rules |

**Total: 26 of 26 checks pass, 2 skipped by design, `mergeStateStatus: CLEAN`, `mergeable`.**

Local (fast checks before each push, per the owner's rule): `tsc --noEmit` clean on every commit,
ESLint clean on changed files, focused suites green (onboarding/guard/wizard/checklist/guide/remedy
suites 57/57), `npm run build` exit 0.

**Two tests were proven non-vacuous rather than assumed:** the `{min}` regressions fail with
`actual: 'Use at least {min} characters'` when the old code is restored, and the Hebrew spec's
Latin-word check was fixed only after reading what it actually counted (see findings register
AI12-N10-06).

## 3. Bot and reviewer comments

| Thread | State |
| --- | --- |
| Gitar — Hebrew `Fund` in the wizard sentence | answered, fixed in `d91eaec` (and a larger defect it did not mention) |
| Gitar — English `{min}` placeholder | answered, fixed in `632f162`, with non-vacuous tests |
| SonarCloud — quality gate failing | resolved; gate now passes on `632f162` |
| Gitar — Code Review "✅ Approved, 🟢 Low risk" | on record |
| Parallel AI #12 session — coordination note | answered with what landed here and what did not (PR #920 not merged: 150 unrelated files) |

## 4. Honest limits

- **Browser tests cannot be run in this sandbox**: the Playwright browser CDN is outside the
  network allowlist. Every E2E claim above rests on the hosted CI run, and the shard assignment was
  verified separately so a green shard is not mistaken for "my spec ran".
- **CI logs and artifacts are not downloadable from the sandbox** (GitHub blob storage is
  unreachable). Failures were diagnosed from check-run annotations and step lists; two of them
  (the 30 KB bundle growth, the `{min}` placeholder) were reproduced locally instead.
- **SonarCloud's CPD exclusion** is the one judgement call here: the four bilingual tables are now
  excluded from duplicate-line detection, exactly like the repo's existing
  `screenTranslations.ts` / `reportTranslationsMore2.ts` / `screenHelp*.ts` / `helpCenterArticles.ts`.
  No issue, coverage or security analysis is affected. The real duplication (shared lookup code) was
  removed rather than excluded.
- **The sandbox was re-provisioned mid-session** (`HEAD` back at `bce500c`, 68 files of uncommitted
  change from an earlier session). Nothing was discarded: the commits were restored from the remote
  with `git stash` + `merge --ff-only`, and the tree verified file-by-file before continuing.
- This is not an assessment of the whole application. It covers the onboarding and help lane and the
  defects CI exposed in this branch.

## 5. Remaining risks

1. **Shared branch**: another AI #12 session pushes to this same branch. Any comment posted here may
   describe work that session did. This report covers commits `6dcb990`…`632f162` only.
2. **Israeli/Hebrew copy review**: the Hebrew is written by this agent. It is checked for
   completeness, script and right-to-left rendering by tests, but a native speaker should read the
   18 screens' worth of copy before launch. Not verified: tone, terminology preference, and whether
   "תגית" is the word the target audience uses for a dimension.
3. **`e2e/onboarding-first-invoice.spec.ts` asserts the checklist reading, not a database write.**
   The journey harness stubs the request boundary; a live end-to-end (Supabase) proof is a separate
   gate.
4. Nothing in this lane blocks the other lanes; PR #897 is unmerged and can be merged or revised
   independently.

## 6. Assessment

**Conditionally ready.** The onboarding and help lane is code-complete and its PR is green on its
head commit, with two conditions before launch: a native Hebrew copy review of the new strings, and
a decision by the owner on the CPD exclusion (the mechanism is the repo's own precedent, but it is
the owner's call whether these tables qualify). Neither is a code defect.

## 7. Addendum — final head

After this report was first written, three documentation-only commits were added
(`514948f`, `5460c2e`, and one formatting commit). The authoritative head is therefore
**`5460c2e585290f541127ae34ee44e9db9d6882e3`**, and the hosted result recorded against *that*
commit — read directly from the API, not from an earlier run — is:

- 28 check runs, **26 success**, 2 skipped by the repo's own scope rules (`Docs checks`,
  `Browser tests (changed specs)`), nothing failing, nothing cancelled, nothing pending;
- `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`;
- the code commits (`6dcb990`…`632f162`) are unchanged, so the per-check table in section 2 still
  describes the code that is being merged; the three later commits add only `audit/ai12/**` docs.

Section 2's figures were taken from the run on `632f162` and are accurate for it. Where they differ
from the final head, the final-head numbers above take precedence.
