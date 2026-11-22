# Period close — partial review

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7faa73705`. Not a release opinion. The probe used a synthetic workspace and documents in isolated local PostgreSQL 18.7 with migrations and stub auth, not hosted Supabase or customer records. The actual document HTTP router was exercised with an injected test identity; `closePeriod` was invoked at the service boundary, not over the authenticated close route.

## PC-01 — Month-end draft with timestamp is missed by close guard (P2)

**Observed:** A draft invoice with date `2026-05-31T12:00:00Z` was saved successfully through the document router. A hard May close then succeeded and locked through May 31 despite the draft remaining. An attempt to change that invoice to sent afterward was refused with `Period Locked: 2026-05-31 is in a closed period`. The date-only equivalent is intended to block closing, as described and tested by the repository. The effect is a missed close completeness safeguard and a stranded draft requiring an authorized reopen or re-date; the test does **not** show that the draft was posted into the closed period or that a statement was misstated.

**Mechanism:** The invoice schema accepts a date string (`src/schemas.ts:259`); `closePeriod` queries drafts with `date <= '2026-05-31'` (`src/server/services/periodCloseService.ts:144-151`), which excludes a lexicographically later timestamp on that same date. The posting lock instead truncates the string to 10 date characters (`src/lib/periodLock.ts:49-53`), so it sees May 31 as locked. This mismatch also warrants examining other document date representations, missing dates and issue-date-only bills; those cases have not been reproduced in this probe.

**Acceptance:** Use a consistent validated business-date representation at write and close, or an inclusive end-of-day range; preserve legacy dates and timezones correctly. Test date-only/timestamp and timezone representations at both boundaries, all draft document collections, redating/deletion after close, role controls, reopening, and concurrent draft creation or close. Draft completeness alone is not a substitute for reconciling a close.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/close-draft-database.test.ts
```

The diagnostic passed asserting the current defect and removes its synthetic data. An initial attempt was refused because the synthetic chart lacked required accounts; after setup was corrected it passed. The separate 97-test real-DB workflow batch included existing monthly close and reopen cases that passed. A subsequent 36-test isolated-DB batch (`focused-database-suite.log`) also passed, including `eg3-period-closing.test.ts`'s year-end worked example, reopen/versioning, bill-stock, credit, and close-at-commit cases. Those cases do not exhaust concurrency, legacy date shapes or actual hosted RLS. No code was changed.
