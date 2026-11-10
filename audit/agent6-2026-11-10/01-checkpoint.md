# Agent #6 (Arena) — checkpoint 1 — 2026-11-10

## Where the work is
* **Branch:** `arena/9bdf6e26-ledgerflow` (Arena fixes the name; do not rename). Fork
  `Chaim-Richard/ledgerflow` → PR target `shmuelbiller1/ledgerflow` `main`.
* **Pin audited:** upstream `main` `dc40739708a013ad080ffb306fe461554a2391fc` (2026-11-10 03:07Z).
* **Important pin fact:** this Arena checkout's own HEAD (`e58fa00a`) is a *reconstructed, stale
  snapshot* — not any commit in upstream history. A scripted rule ("keep local file, else take the
  earlier upstream version") reproduces the tree exactly at upstream `4376cab4f843c9b0480c59b81120764704920f88`
  (2026-11-09 05:43Z): `src/`, `docs/`, `audit/`, `e2e/`, `scripts/` are ~214 commits *older* than
  `main`, while `package.json`, `AGENTS.md`, `supabase/`, `public/`, `api/` match it. **Every
  finding in this session was produced against a clean `git archive` of upstream `main` at
  `dc40739`, extracted to `/home/user/lf-pin`, not against the stale checkout.**
* **Closed container bug also found:** upstream `main`'s `audit/FINAL_ACCURATE_LIST_2026-11-08.md`
  is committed **with literal `<<<<<<<` / `>>>>>>>` conflict markers** (line 1 and line 194, a
  merge of Agent #7's list and Agent #4's list). The repo calls that document FINAL.

## Documents in this folder
| File | What it is |
|---|---|
| `01-checkpoint.md` | this file |
| `02-findings.md` | THE report: F-01 … F-07, each with mechanism, lines, reproduction, severity, fix shape |
| `03-gates.md` | the exact gate commands and their results (filled as long gates finish) |
| `probes/af004-taxplace-key-mismatch.test.ts` | 4/4 pass — `TaxPlace.state` vs `region`; TX sale vanishes from the return |
| `probes/s7-route-guards.test.ts` | 4/4 pass — registrations without middleware; D-30 cannot see them |
| `probes/af012-rule-chain-order.test.ts` | 2/2 pass — shipped `evaluateRules` order-dependence (#161) |
| `probes/lf-rules-coverage.py` | re-runnable parse: 68 collections, 47 without a field allowlist |
| `probes/f8-tax-return-two-universes.test.ts` | 4/4 pass — one filing marks every state "Recorded as filed"; the server can only file `kind: 'vat'` |
| `04-scorecard.md` | coverage counts, findings register, the order a next session should work in |

## Verified so far (with a run)
1. **F-01** (P1, tax): `usSalesTaxReturn` reads `place.state`; the seeded sample book and
   `invoice-destination.test.tsx` write `place.region`. A Texas taxable sale is dropped from the
   TX return silently. 4/4 probe assertions.
2. **F-02** (P2): `POST /api/v1/system/recurring/process` and `.../telemetry/errors/digest` have
   **no middleware** (in-handler `isSystemJobAuthorized` only); `POST /api/v1/admin/integrity/orphan-scan`
   is `authenticate`-only. `route-policy-coverage.test.ts` passes because it greps file text.
3. **F-03** (P2): 47/68 `lf_rules` collections have no field allowlist and no cap.
4. **F-03b** (P1-latent): #161/AF-012 reproduced with the shipped function.
5. **F-04/F-05/F-06** (P3): `check-prod-env` not wired anywhere; `authRateLimiter` dead code;
   no gitleaks, no audit hash chain.
6. **F-07** (P2/P3): AF-001-F1/F2/F3 genuinely fixed (AF suites re-run, 20/20); AF-001-F4
   (`success:false` on a zero-change sync) still in the route and now pinned by a test that calls it
   the "observed contract".

## In flight when this checkpoint was written
* `tsc --noEmit` at the pin (2 vCPU; the 5 Nov session OOM-killed at 2 GB, this box has 3.9 GB).
* Unit shard 1/4 at the pin — 2,392 subtests passed, **0 failed**, still running.
* Not run at all: ESLint, build, `npm run test:rules`, Playwright — no Postgres and no browser here.

## Next actions (in order)
1. Finish/record shard 1/4, `tsc`, ESLint, build in `03-gates.md`.
2. Copy this audit folder into the session branch, commit, push to the fork, open the PR
   (owner merges — Agent #6 never merges).
3. Upload every artifact to Drive folder `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`, then re-download and
   compare sizes/hashes; write the Drive index file with ids.
4. If time remains: reproduce #517/#519 (line-level entity label, seller profile), and add a
   registration-level version of the route matrix to the repo as the D-30 replacement.
