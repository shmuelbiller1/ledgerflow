## Problem

At upstream code pin `7896cbdcbba520f71614a3445b963b1c88d497bb`, a sale with a recorded US country but no state is silently omitted from state sales-tax return figures. The quarter journey does not identify an unresolved destination in its `problems`. The correct state is not known and must not be guessed; this finding is the missing refusal/warning, not a claim that every such sale belongs in Texas.

## Minimal reproduction

Use Texas books and a TX permit. Supply an issued Q3 invoice of $100.00 net plus $8.25 tax, with both its saved tax place and the customer's tax place `{country:'US'}` (no state). **Observed:** the Texas row is 0 documents / $0 tax and the quarter has no state/destination/unassigned warning. A user can enter country without state in [`PartyModal.tsx:116`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/components/common/PartyModal.tsx#L116) and [`:234–243`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/components/common/PartyModal.tsx#L234-L243). The omission occurs in [`usSalesTaxReturn.ts:60–63`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/lib/tax/usSalesTaxReturn.ts#L60-L63).

The synthetic acceptance test `contract: an incomplete US buyer state is flagged instead of silently dropping a taxed sale` in [Agent #8's test file](https://github.com/Chaim-Richard/ledgerflow/blob/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033/af004-report-contracts.test.ts) fails at this pin. [Full test output](https://github.com/Chaim-Richard/ledgerflow/blob/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033/af004-acceptance-output.txt). No actual browser, persisted DB, or deployed-data reproduction was performed.

## Requested owner review

Proposed **P1/P0 candidate** depending on real-data exposure and pilot scope. Surface an actionable unassigned/unknown-destination count and block or clearly qualify affected return exports/figures, or validate at a suitable write boundary without making unsupported tax assumptions. Test a US state missing on invoice and customer, legacy records, absent customer, foreign customer, credits, genuine counter sales, and complete versus capped data. No duplicate was found in 37 repository issue titles/bodies searched. No financial code was changed by this audit.
