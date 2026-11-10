# Agent #6 — LedgerFlow audit, 2026-11-10 — INDEX OF EVERYTHING SAVED

Pin audited: upstream `main` = **`dc40739708a013ad080ffb306fe461554a2391fc`** (2026-11-10 03:07Z).
Branch: **`arena/9bdf6e26-ledgerflow`** on `Chaim-Richard/ledgerflow`, tip **`35f027e3`**, pushed and verified.

## Where the code is
* Branch: https://github.com/Chaim-Richard/ledgerflow/tree/arena/9bdf6e26-ledgerflow
* **Open the PR with this one-click link** (the fork token is refused `createPullRequest`):
  https://github.com/shmuelbiller1/ledgerflow/compare/main...Chaim-Richard:ledgerflow:arena/9bdf6e26-ledgerflow?expand=1
* Paste the body from `PR-BODY.md`. Do **not** merge — Shmuel decides.

## Drive folder
`LedgerFlow-Agent6-2026-11-10` — https://drive.google.com/drive/folders/1gXiKgFoNYDyHgVO2PEAtyNfPE-GO-rrD
(inside `Ledgerflow Agent Backups`, `1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`)

## Files

| Drive file | id | What it is |
|---|---|---|
| `2026-11-10_Agent6_Ledgerflow_FINDINGS_v5.md` | `1P6umCn88Fh5EFsniLbIpAJ9TtXIOBUgs` | **THE REPORT — use this one.** F-01, F-08, F-09 (P1) · F-01b, F-02, F-03, F-07, F-10 (P2) · F-03b (P1-latent) · F-04–F-06 (P3) |
| `2026-11-10_Agent6_Ledgerflow_SCORECARD_v2.md` | `1xOS2Kq67ZV4HuRMtt_ZutmTq0JPfFcEd` | coverage counts, findings register (F-01…F-10), fix order |
| `2026-11-10_Agent6_Ledgerflow_HANDOFF_v2.md` | `1PlmIlCwZ_lHMke96cTMNJ6pK5UzBsqYH` | **use this one** — finished / unfinished / one-paragraph summary for Shmuel |
| `2026-11-10_Agent6_Ledgerflow_CHECKPOINT-01.md` | `19rL7LSUZh1qEVKCDHvS5ehuBnQSyIijD` | pin reconstruction, stale-checkout discovery |
| `2026-11-10_Agent6_Ledgerflow_GATES_v4.md` | `1m7VpZozNe0bf2rgP-jgqHwO96EeJJM1f` | **use this one** — every command run and its result: `tsc` 0 errors / 2,513 files, ESLint 0 errors + 42 standing warnings, **all 4 unit shards = 8,026 tests / 8,007 pass / 0 product failures**, probes 20/20, and the not-run list |
| `2026-11-10_Agent6_Ledgerflow_GATES.md` (older, superseded) | `1fQkclrChBx2qlFzlUdsDqPJvEKAY3VhV` | first upload, before the gate results were appended (3,059 bytes) |
| `2026-11-10_Agent6_Ledgerflow_PR-BODY.md` | `1_rObGX3tyeRAPdLnpvzP8E_zFb6yhs7q` | ready-to-paste PR body |
| `2026-11-10_Agent6_Ledgerflow_ALL-7-commits-2371b13a.patch` | `14UZYeeFwhPlJIIx0D7BI071waJ7c5rSc` | `git am`-able snapshot at `2371b13a`; sha256 `b393bee2c5951f07`. Later commits are on the branch itself — re-run `git format-patch` for the newest. |
| `probe_af004-taxplace-key-mismatch.test.ts.txt` | `1lAn-hirfXT3S_fYfug1gRwfnIoqc3zTM` | 4/4 — TX sale dropped by `region` |
| `probe_f8-tax-return-two-universes.test.ts.txt` | `1qmFPX1et3wSW5R1_UBy8t70oOd6ov0_q` | 4/4 — one filing marks every state |
| `probe_af012-rule-chain-order.test.ts.txt` | `13mls8wZnA7ZZ0CkMUWq5aFRsi4McqpDJ` | 2/2 — #161 on the shipped function |
| `probe_s7-route-guards.test.ts.txt` | `19DMwxLwQ1aYxwo1rb4wABDGRzGfEOugy` | 4/4 — routes with no middleware |
| `probe_f9-audit-trail-coverage.test.ts.txt` | `1cAHwVo3gmsxu0cBluudfZSGjspZ89BvY` | 3/3 — 23 of 33 money-writing handlers unaudited; USER_LOGIN is browser-only |
| `probe_f10-handwritten-idempotency.test.ts.txt` | `1nGT2QXTxGJYc5S6MD3ejBm41eng_DF0v` | 3/3 — no status, no request hash on 3 money routes |
| `probe_lf-rules-coverage.py.txt` | `1OmmHRPSpEtPzrhURTr8wfcCmLRPrwrrV` | 47 of 68 collections without a field allowlist |
| `2026-11-10_Agent6_Ledgerflow_CHECKPOINT-01.md` (older upload, superseded) | `1wcw6VoxljAcv0f1QVvOL82pGFWYHAm-n` | first checkpoint, kept, not deleted |
| `2026-11-10_Agent6_Ledgerflow_FINDINGS.md` (older upload, superseded) | `1fIO1DJkhwSvh1rAdcTKlIF_We4MxIWiX` | v1 before F-08 was added |

Superseded files stay in the folder on purpose: nothing is deleted, only superseded.

## Sample commands

```sh
# the whole audit at the pin, with the env the npm script sets
cd /home/user/lf-pin   # (extract upstream main with `git archive` first — see checkpoint 01)
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test --test-force-exit audit/agent6-2026-11-10/probes/*.test.ts      # 20/20

# the unit suite, the way CI runs it (this sets SYSTEM_SALT for you)
TEST_SHARD=1/4 npm run test:shard
```

## What a next agent must know
1. This Arena checkout (`e58fa00a`) is **not** a commit in upstream history — it is a stale
   reconstruction (exactly upstream `4376cab4`, ~214 commits behind). Re-extract upstream `main`
   with `git archive` before trusting any line number in this audit against a newer pin.
2. Upstream `main` still commits `audit/FINAL_ACCURATE_LIST_2026-11-08.md` **with `<<<<<<<` conflict
   markers** in it. Fix that or stop calling it FINAL.
3. The fork token cannot open cross-fork PRs, issues, or comments. Push + one-click link is the
   working path, same as AI #8's 5 Nov note.
