## Problem

At upstream code pin `7896cbdcbba520f71614a3445b963b1c88d497bb`, the US state sales-tax return ignores an issued invoice's recorded destination and instead uses the customer's **current** tax place. Moving a customer can therefore silently remove the old sale and tax from the original state's quarter report and CSV. The quarter journey is read-only and does not itself file or pay; no production occurrence has been verified.

## Reproduction with independent figures

1. Books have Texas sales-tax permit `3200`. Issue one sale in Q3 2026 for $100.00 net + $8.25 tax = $108.25, saving `metadata.taxPlace = {country:'US',state:'TX'}`. Buyer initially has the same Texas place.
2. The Texas return is 1 document, $100.00 gross/taxable sales, $8.25 tax. Now change only the customer's current tax place to Oklahoma; the invoice remains unchanged and still records Texas.
3. **Expected:** the saved Texas destination keeps the sale in the Texas quarter: 1 / $100.00 / $8.25. **Observed:** 0 / $0.00 / $0.00 in the return, quarter journey, its rendered jsdom component, and CSV.

Reproducible acceptance cases (intentionally fail at this pin; 6 failures total across the broader two-file run, including two other distinct mechanisms):

```sh
npm exec --yes --package=node@24 -- sh -c 'NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic node --import tsx --test audit/agent8-2026-11-05-session-2033/af004-report-contracts.test.ts audit/agent8-2026-11-05-session-2033/af004-quarter-view.test.tsx'
```

[Tests and output on Agent #8 branch](https://github.com/Chaim-Richard/ledgerflow/tree/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033). This run used synthetic data, not Postgres, a real browser, or live filings.

## Evidence / affected path

- Invoice save retains the snapshot: [`InvoiceModal.tsx:217–242`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/components/sales/InvoiceModal.tsx#L217-L242); explicit snapshot contract: [`usInvoiceTax.ts:127–148`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/lib/tax/usInvoiceTax.ts#L127-L148).
- Return reads mutable customer metadata rather than invoice metadata: [`usSalesTaxReturn.ts:53–63`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/lib/tax/usSalesTaxReturn.ts#L53-L63); quarter computation: [`usQuarterJourney.ts:253–273`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/lib/usQuarterJourney.ts#L253-L273).
- Related [#255](https://github.com/shmuelbiller1/ledgerflow/pull/255) fixes destination precedence for the **nexus watch**, not this state-return path. No duplicate was found in the 37 repository issue titles/bodies searched.

## Requested owner review

Proposed **P0 candidate before real-data tax reliance**, subject to Shmuel/tax-owner triage. Choose and implement an authoritative destination precedence for issued invoices and credit notes, preserving the documented legacy fallback when a snapshot is absent; do not infer unknown state as a fact. Acceptance should include TX→OK edits, reversal/credit notes, absent/null/legacy snapshots, separate workspaces/entities, source-to-render/CSV consistency, and an isolated persisted round trip. No code fix is included in this audit.

## Additional browser evidence (2026-11-05)

A new real headless-Chromium acceptance test mounts the actual quarter report with synthetic workspace/stores and stubbed API responses. Its Texas control passes; after changing only the customer's current state to Oklahoma, the retained Texas snapshot still displays **0 / $0.00 / $0.00**, rather than **1 / $100.00 / $8.25**. [Test](https://github.com/Chaim-Richard/ledgerflow/blob/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033/af004-browser-journey.spec.ts) · [Output](https://github.com/Chaim-Richard/ledgerflow/blob/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033/06-af004-browser-acceptance-output.txt). This is still not a persisted invoice, real authentication, a filing, or a deployment test. Chromium 153 was a non-default binary; the 1/2 failure is the intended contract diagnostic.
