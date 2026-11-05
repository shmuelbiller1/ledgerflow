## Problem

At upstream code pin `7896cbdcbba520f71614a3445b963b1c88d497bb`, `usSalesTaxReturn` resolves seller ownership from `doc.dimensions`, although the invoice editor stores the document's entity label on the first invoice line. The function can include another entity's sale and saved tax under the books' state permit. The issue is reproduced with a synthetic one-line invoice; no production occurrence or live filing is claimed.

## Minimal reproduction

- Books: Texas permit `sales_tax:US-TX:3200`. Entity `world:il` has its **own** Israeli VAT registration and no US sales-tax registration. A Q3 2026, $100.00 net + $8.25 tax sale to a TX customer has only `items[0].dimensions = {world:'il'}`.
- **Expected per the seller-permit rule:** the Texas books' return includes **0** documents for the separately registered Israeli entity.
- **Observed:** return includes **1**. Passing controls show that `documentEntityLabels` identifies the Israeli label and VAT registration, and the identical label at `doc.dimensions` is excluded. The only difference is label location.

Run the intentionally failing acceptance cases:

```sh
npm exec --yes --package=node@24 -- sh -c 'NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic node --import tsx --test audit/agent8-2026-11-05-session-2033/af004-report-contracts.test.ts audit/agent8-2026-11-05-session-2033/af004-quarter-view.test.tsx'
```

[Tests and output on Agent #8 branch](https://github.com/Chaim-Richard/ledgerflow/tree/arena/6984648e-ledgerflow/audit/agent8-2026-11-05-session-2033). The full run has 12 tests, 6 controls/observations passing and 6 failing assertions across this and two other mechanisms.

## Source trace and prior work

- [`InvoiceModal.tsx:217–235`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/components/sales/InvoiceModal.tsx#L217-L235) saves items; [`InvoiceModal.tsx:504`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/components/sales/InvoiceModal.tsx#L504) passes the first line's labels to tax suggestions.
- [`ilVatReturn.ts:38–55`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/lib/tax/ilVatReturn.ts#L38-L55) documents/reads the first-line storage shape; [`usSalesTaxReturn.ts:53–58`](https://github.com/shmuelbiller1/ledgerflow/blob/7896cbdcbba520f71614a3445b963b1c88d497bb/src/lib/tax/usSalesTaxReturn.ts#L53-L58) reads only `doc.dimensions`.
- Earlier Agent #8's Drive-only AF-004 F2 discovered the synthetic discrepancy; this session recovered that evidence and added controlled comparisons at the newer pin. No duplicate issue was found in the 37 repository issue titles/bodies searched.

## Requested owner review

Proposed **P0 candidate before real-data tax reliance**, subject to owner/tax-lane triage. Align seller ownership with the saved document model; define handling for credits, invoices with multiple entity labels, legacy document-level labels, and entity registrations explicitly. Add hand-worked return, screen/CSV, cross-workspace and isolated persisted tests. This report makes no financial/server code change.
