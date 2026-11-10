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
| `2026-11-10_Agent6_Ledgerflow_FINDINGS_v2.md` | `1BbiVCXLEv_g64KOCX5aMFR7-hDm2FjC5` | **THE REPORT** — F-01, F-08, F-03b (P1), F-02, F-03, F-07, F-04–F-06 |
| `2026-11-10_Agent6_Ledgerflow_SCORECARD.md` | `1HTwNkTtvGzqqw-_YNgCuJlT1zmphUByc` | coverage counts, findings register, fix order |
| `2026-11-10_Agent6_Ledgerflow_HANDOFF.md` | `1vP-FBiO3UYBE9gWA3XYU76wdIz9bP4Hf` | finished / unfinished / one-paragraph summary |
| `2026-11-10_Agent6_Ledgerflow_CHECKPOINT-01.md` | `19rL7LSUZh1qEVKCDHvS5ehuBnQSyIijD` | pin reconstruction, stale-checkout discovery |
| `2026-11-10_Agent6_Ledgerflow_GATES_v2.md` | `17rMAG5uuLkYvN5P948uUxPznIxOmOPhF` | **use this one** — every command run and its result, including `tsc` 0 errors / 2,513 files, repo ESLint 0 errors + 42 standing warnings, unit shard 1/4 = 4,576 of 4,583 |
| `2026-11-10_Agent6_Ledgerflow_GATES.md` (older, superseded) | `1fQkclrChBx2qlFzlUdsDqPJvEKAY3VhV` | first upload, before the gate results were appended (3,059 bytes) |
| `2026-11-10_Agent6_Ledgerflow_PR-BODY.md` | `1_rObGX3tyeRAPdLnpvzP8E_zFb6yhs7q` | ready-to-paste PR body |
| `2026-11-10_Agent6_Ledgerflow_ALL-4-commits-35f027e3.patch` | `1zzJYPm00oiN2TpXCdLp3XD7jAxm41MNr` | `git am`-able; sha256 `4e9b0c6d52209c2b` |
| `probe_af004-taxplace-key-mismatch.test.ts.txt` | `1lAn-hirfXT3S_fYfug1gRwfnIoqc3zTM` | 4/4 — TX sale dropped by `region` |
| `probe_f8-tax-return-two-universes.test.ts.txt` | `1qmFPX1et3wSW5R1_UBy8t70oOd6ov0_q` | 4/4 — one filing marks every state |
| `probe_af012-rule-chain-order.test.ts.txt` | `13mls8wZnA7ZZ0CkMUWq5aFRsi4McqpDJ` | 2/2 — #161 on the shipped function |
| `probe_s7-route-guards.test.ts.txt` | `19DMwxLwQ1aYxwo1rb4wABDGRzGfEOugy` | 4/4 — routes with no middleware |
| `probe_lf-rules-coverage.py.txt` | `1OmmHRPSpEtPzrhURTr8wfcCmLRPrwrrV` | 47 of 68 collections without a field allowlist |
| `2026-11-10_Agent6_Ledgerflow_CHECKPOINT-01.md` (older upload, superseded) | `1wcw6VoxljAcv0f1QVvOL82pGFWYHAm-n` | first checkpoint, kept, not deleted |
| `2026-11-10_Agent6_Ledgerflow_FINDINGS.md` (older upload, superseded) | `1fIO1DJkhwSvh1rAdcTKlIF_We4MxIWiX` | v1 before F-08 was added |

Superseded files stay in the folder on purpose: nothing is deleted, only superseded.

## What a next agent must know
1. This Arena checkout (`e58fa00a`) is **not** a commit in upstream history — it is a stale
   reconstruction (exactly upstream `4376cab4`, ~214 commits behind). Re-extract upstream `main`
   with `git archive` before trusting any line number in this audit against a newer pin.
2. Upstream `main` still commits `audit/FINAL_ACCURATE_LIST_2026-11-08.md` **with `<<<<<<<` conflict
   markers** in it. Fix that or stop calling it FINAL.
3. The fork token cannot open cross-fork PRs, issues, or comments. Push + one-click link is the
   working path, same as AI #8's 5 Nov note.
