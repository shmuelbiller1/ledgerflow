# Agent #6 — LedgerFlow audit, 2026-11-10 — INDEX OF EVERYTHING SAVED

Pin audited: upstream `main` = **`dc40739708a013ad080ffb306fe461554a2391fc`** (2026-11-10 03:07Z).
Branch: **`arena/9bdf6e26-ledgerflow`** on `Chaim-Richard/ledgerflow`, 12 commits, pushed and verified.
(Verify the current tip with `git ls-remote origin arena/9bdf6e26-ledgerflow` — it moves with each commit;
the tip was `3f60e2dc` when the FINAL-13 patch was cut; the commits after it are documentation-only.)

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
| `2026-11-10_Agent6_Ledgerflow_FINDINGS_v5.md` | `1P6umCn88Fh5EFsniLbIpAJ9TtXIOBUgs` | **THE REPORT — read this first.** F-01, F-08, F-09 (P1) · F-01b, F-02, F-03, F-07, F-10 (P2) · F-03b (P1-latent) · F-04–F-06 (P3) |
| `2026-11-10_Agent6_Ledgerflow_FINAL-26-commits-253db73.patch` | `1zy-u1XBr6hFU4F7blSDNKqn8W5SNxAY_` | **THE backup to restore from**: all 26 commits `e58fa00..HEAD`, tip `253db73`, 170,556 B, sha256 `a060b9fbabef36bb`. Verified: `git am` onto `e58fa00` exits 0 and reproduces **all 15 audit files byte-for-byte**. |
| `2026-11-10_Agent6_Ledgerflow_FINAL-23-commits-fa93999.patch` | `1whzuUcru1EuWDT2Wp6Ku7tmu94NbL6im` | earlier verified backup (23 commits), kept |
| `2026-11-10_Agent6_Ledgerflow_FINAL-22-commits-4a3fa09.patch` | `1qB7eTVSYIKwhchCbBMkrY7EvEyvg6dfa` | earlier verified backup (22 commits), kept |
| `2026-11-10_Agent6_Ledgerflow_COMPLETE-20-commits-dc3fed4.patch` | `1eNt9B-lo1Rx4lGLbq-vcwAK-7J-jS90Y` | earlier verified backup (20 commits), kept |
| `2026-11-10_Agent6_Ledgerflow_COMPLETE-19-commits.patch` | `1JJTYoV2J3LhN1Ahat0b0ncfNAQ7iFG6T` | earlier verified backup (19 commits), kept |
| ~~`FINAL-15-commits-8a423a05.patch`, `FINAL-13`, `FINAL-12`, `FINAL-11`, `ALL-7`, `ALL-4`, `branch-commit-e2cadf3b`~~ | — | **DO NOT USE — all of these are INCOMPLETE.** They were cut with `git format-patch -N`, which counts from `HEAD` and therefore silently dropped commit 1 (`1ef64361`, the F-08 commit that *creates* `02-findings.md`). Proven only by `git am` failing on patch 2/15. Removed from this index; the files are still in Drive, labelled obsolete. |
| `2026-11-10_Agent6_Ledgerflow_SCORECARD_v2.md` | `1xOS2Kq67ZV4HuRMtt_ZutmTq0JPfFcEd` | coverage counts, findings register (F-01…F-10), fix order |
| `2026-11-10_Agent6_Ledgerflow_HANDOFF_v3-FINAL.md` | `1q41ZKCCFxq1nDnTzXS7MEquKpISPr50h` | **use this one** — one line per gate, finished / unfinished, one-paragraph summary for Shmuel |
| `2026-11-10_Agent6_Ledgerflow_CHECKPOINT-01.md` | `19rL7LSUZh1qEVKCDHvS5ehuBnQSyIijD` | pin reconstruction, stale-checkout discovery |
| `2026-11-10_Agent6_Ledgerflow_GATES_v5-FINAL.md` | `1kp6er7L2WwcXqu78pGiOGzz6bZLCzgAv` | **use this one** — every command and result: `tsc` 0 errors / 2,513 files, ESLint 0 errors + 42 warnings, **all 4 unit shards = 8,026 tests / 8,007 pass / 0 product failures**, **`npm run build` PASSES** (4,885 modules, `server.cjs` 6.8 MB + `api.cjs` 6.7 MB), probes 20/20, and the only two unrun gates (DB/RLS, Playwright) |
| `2026-11-10_Agent6_Ledgerflow_GATES.md` (older, superseded) | `1fQkclrChBx2qlFzlUdsDqPJvEKAY3VhV` | first upload, before the gate results were appended (3,059 bytes) |
| `2026-11-10_Agent6_Ledgerflow_PR-BODY.md` | `1_rObGX3tyeRAPdLnpvzP8E_zFb6yhs7q` | ready-to-paste PR body |
| `2026-11-10_Agent6_Ledgerflow_FINAL-11-commits-060788af.patch` | `1oPxEV3cTlwVb1ci-ixOQE75zmSLhNpH2` | previous snapshot, kept |
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

# cut a backup patch that is actually complete - NEVER `git format-patch -N`
git format-patch e58fa00a..HEAD --stdout > agent6-complete.patch    # 19 commits
# then prove it: am it onto the base in a scratch repo and compare the audit files
```

## What a next agent must know
1. This Arena checkout (`e58fa00a`) is **not** a commit in upstream history — it is a stale
   reconstruction (exactly upstream `4376cab4`, ~214 commits behind). Re-extract upstream `main`
   with `git archive` before trusting any line number in this audit against a newer pin.
2. Upstream `main` still commits `audit/FINAL_ACCURATE_LIST_2026-11-08.md` **with `<<<<<<<` conflict
   markers** in it. Fix that or stop calling it FINAL.
3. The fork token cannot open cross-fork PRs, issues, or comments. Push + one-click link is the
   working path, same as AI #8's 5 Nov note.
