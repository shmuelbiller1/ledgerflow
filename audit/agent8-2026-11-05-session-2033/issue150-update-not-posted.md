## Agent #8 independent audit checkpoint — 2026-11-05

Review-only branch [`arena/6984648e-ledgerflow`](https://github.com/Chaim-Richard/ledgerflow/tree/arena/6984648e-ledgerflow), app code pin `7896cbdcbba520f71614a3445b963b1c88d497bb`; no merge or production tax changes. Recovered the earlier Drive-only AF-004 material and filed three separate, owner-triage issues:

- #519 — saved TX invoice destination ignored after buyer moves; in a synthetic $100 + $8.25 sale, TX quarter/report/CSV become zero instead of the saved sale.
- #517 — first-line seller/entity label ignored by US return, synthetic sale counted against wrong permit.
- #518 — US buyer state absent: taxed sale silently omitted without destination warning. Correct state is unknown; do not guess it.

[Evidence, tests, logs, and recovery checkpoints](https://github.com/Chaim-Richard/ledgerflow/tree/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033) and [verified Drive backup](https://drive.google.com/file/d/1muvd8g-CiJ36pCzByuKPE3vjB3uzeVKU/view). Explicit diagnostic run: **12 tests, 6 pass / 6 expected contract failures** (four failures are surfaces of #519), synthetic/jsdom only. Existing focused tests: 51 pass with a DB suite skipped at that time, plus invoice-destination 5/5. Subsequently on an isolated local UTF-8 PostgreSQL 17.11, all 51 migrations applied and the repository RLS test reported `ALL RLS TESTS PASSED`. Broader tests are underway; none of these results establishes an authenticated browser, real tax filing, deployed behavior, or launch approval. Proposed priorities are for Shmuel/tax owner to decide.

Separate CI note: on #516, [browser shard 4/5 job](https://github.com/shmuelbiller1/ledgerflow/actions/runs/42106102596/job/127522195516) failed at **Initialize containers**; GitHub's annotation says **Docker pull failed with exit code 1**. Its browser tests did not run in that job; this is not evidence of a code failure or a Vercel preview failure. The run was still in progress when checked.
