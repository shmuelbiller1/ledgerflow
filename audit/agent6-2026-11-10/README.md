# Agent #6 — 2026-11-10 — read me first

**Pin:** upstream `main` `dc40739708a013ad080ffb306fe461554a2391fc`.
**Branch:** `arena/9bdf6e26-ledgerflow` on the fork `Chaim-Richard/ledgerflow` (PR to
`shmuelbiller1/ledgerflow` `main`; Agent #6 never merges).

| File | Read it for |
|---|---|
| `02-findings.md` | **the report** — F-01 (P1 tax), F-08 (P1 screen/API), F-03b (P1 latent), F-02 (P2), F-03 (P2), F-04…F-07 |
| `04-scorecard.md` | what was read, run, and skipped; the order to fix things in |
| `01-checkpoint.md` | session state, the stale-checkout discovery, next actions |
| `03-gates.md` | the exact commands and results |
| `probes/*.test.ts` | runnable reproductions (14 assertions, all passing = all defects confirmed) |

Run the probes from the repository root of a fresh `git archive` of upstream `main`:

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test \
  audit/agent6-2026-11-10/probes/af004-taxplace-key-mismatch.test.ts \
  audit/agent6-2026-11-10/probes/af012-rule-chain-order.test.ts \
  audit/agent6-2026-11-10/probes/f8-tax-return-two-universes.test.ts \
  audit/agent6-2026-11-10/probes/s7-route-guards.test.ts
python3 audit/agent6-2026-11-10/probes/lf-rules-coverage.py
```
