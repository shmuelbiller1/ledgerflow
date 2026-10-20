# Release gate (owner's rule, 18 Oct 2026)

The decision to invite testers or customers follows **this table**, not the number of open issues.
Zero bugs is not the bar; the supported workflows working correctly is. The lead keeps it current
(LEAD_RUNBOOK step 8) and every AI updates its row when it finishes work on that workflow.

## Bug categories

| Category | Examples | Rule |
|---|---|---|
| **Critical integrity** | durable double posting, lost records, wrong workspace access, unsafe restore | fixed before any real financial use |
| **Major functional** | wrong statement dates, report scope, wrong totals | fixed before that workflow is offered as dependable |
| **Ordinary** | broken secondary button, layout, minor navigation | fixed in batches; does not hold back testing |
| **Incomplete feature** | server work without a screen, preview without the final action | keeps being built; not a blocker unless its workflow is in the table |

Label issues with `critical`, `major` or nothing (ordinary); a stage cannot start while a **critical** issue
touches one of its workflows.

## Stages

1. **AI completion (now):** finish known gaps in the workflows below; fix critical and major findings.
2. **Selected bookkeepers on synthetic books:** when every "stage 2" row is Yes/Yes/Yes. They judge usability,
   wording, missing practical steps — what the AIs cannot.
3. **A few paying customers:** when every row is Yes and data recovery, permissions, migration and billing are proven.

C-72/C-73/C-75 local report-control evidence (AI #2, 19 Oct): bill source navigation, filtered delivery-note preview/print/CSV, and copyable quote follow-ups are covered by component and phone/desktop browser tests. W3/W6 retain their existing statuses: these controls do not prove the full posting/payment/delivery journey. See [checks and screenshots](verification/c72-c73-c75-report-follow-ups-2026-10-19.md).

## Workflows

Columns: **Connected** = every step reachable on a screen and saved by the server · **Verified** = a test with
independently worked figures passes · **Browser** = an end-to-end browser test passes on CI.

| # | Workflow | Stage | Connected | Verified | Browser | Remaining blockers |
|---|---|---|---|---|---|---|
| W1 | Sign up → company → chart of accounts → first invoice → first report (P2-1) | 2 | Partly | No | Partly ([D-46 notices only](verification/ai4-d46-mobile-notices.md); [D-85/D-90 overview/navigation](verification/ai4-d85-d90-dashboard-settings.md); [D-92 sidebar](verification/ai4-d92-sidebar-groups.md); [D-95/D-96 settings strip, billing dark mode](verification/ai4-d95-d96-settings-strip-billing.md)) | first-hour journey test (A-151/P2-1); C-127 navigation/disabled-control batch verified locally, complete journey/CI still pending |
| W2 | Invoice → posting → payment → customer statement | 2 | Yes | Partly | Yes ([F-41 journey](../e2e/w2-invoice-payment-statement.spec.ts), CI green 19 Oct) | DIM-1 for separate payment records; [D-86 invoice form evidence](verification/ai4-d86-invoice-form.md) (UI only, final CI pending) |
| W3 | Bill → posting → payment run → vendor statement | 2 | Yes | Partly ([D-33 withholding goldens](verification/ai4-d33-withholding-golden.md)) | Yes ([F-42 journey](../e2e/w3-bill-payment-run-statement.spec.ts), CI green 19 Oct) | golden bills A-147 wired to the posting, DIM-1 payments, #156 inherited withholding rate after expiry |
| W4 | Bank import / feed → reconciliation | 2 | Yes | Partly | Yes ([F-43 journey](../e2e/w4-bank-csv-import-reconcile.spec.ts), CI green 19 Oct) | AU-1 changed/removed lines on the Banking screen, #96; E-30 OFX/QFX preview path added (requires PR tests; no new balance proof); E-31 conservative CAMT.053 XML review (pending independent verification) |
| W5 | Labels (property, project, location) → reports by label | 2 | Yes | Partly ([D-93 failure-state checks](verification/ai4-d93-report-harness.md)) | No ([D-45 filter checks](verification/ai4-d45-report-controls.md); [D-77 heading](verification/ai4-d77-report-heading.md); [D-78 navigation](verification/ai4-d78-report-tabs.md); [D-81/D-82 words](verification/ai4-d81-d82-plain-controls.md); [D-83/D-84 layout](verification/ai4-d83-d84-report-layout.md); [D-80 contrast](verification/ai4-d80-highlighted-ledger-row.md)) | DIM-1 payments, DIM-3 balancing roles |
| W6 | Order with deposit → part invoices → delivery (no double charge) | 2 | Yes | Yes (DEP-1) | Yes ([F-44 journey](../e2e/w6-order-deposit-part-invoices.spec.ts), CI green 19 Oct) | — |
| W7 | Israel VAT month: invoices with allocation numbers → VAT report → PCN874 → close | 2 | Partly | Partly ([D-32 report goldens](verification/ai4-d32-israeli-vat-golden.md), A-146, [A-152 Israel month journey](verification/ai3-a152-israeli-month.md), [A-198 whole golden year](verification/ai3-a198-a199-a106-2026-10-19.md)) | Partly ([browser journey, CI pending](verification/ai3-w7-w8-w9-browser.md)) | CON-3 done ([Eilat on invoices](verification/ai9-con3-eilat-invoices.md)) and CON-4 done ([frequency → report period](verification/ai9-con4-il-vat-frequency.md)), 20 Oct; PCN874 bi-monthly header month unverified against the Tax Authority spec; #160 persisted equipment/report adapter; [C-116/C-119 screen wiring verified](verification/c116-c119-c123-screen-verification-2026-10-19.md); the PCN874 screen builds the historical draft only and is not filing-ready |
| W8 | US quarter: sales tax by state → summary → 1099 preview → close | 2 | Partly | Partly (A-146/147, [A-153 US quarter journey](verification/ai3-a153-us-quarter-journey.md), [A-199 whole golden year](verification/ai3-a198-a199-a106-2026-10-19.md)) | Partly ([browser journey, CI pending](verification/ai3-w7-w8-w9-browser.md)) | CON-1, CON-2 in review ([US nexus watch screen](verification/ai9-con2-us-nexus-watch.md)); [C-123 screen wiring verified](verification/c116-c119-c123-screen-verification-2026-10-19.md) |
| W9 | Month-end close and reopen | 2 | Yes | Yes (AUD-08 race, [A-151 close journey](verification/ai3-a151-close-journey.md)) | Yes ([F-45](../e2e/w9-sealed-period-reopen.spec.ts) and AI #3 close/reopen, CI green 19 Oct) | — |
| W10 | Backup → restore → same reports | 3 | Yes | Yes (AUD-02 done 20 Oct: ledger door, field types, checks inside the writing transaction, consistent export) | No ([D-46 reminder only](verification/ai4-d46-mobile-notices.md)) | F-46 browser test (AI #7) |
| W11 | Import from QuickBooks/CSV → totals match the source (AU-4) | 3 | Partly | No | No | AU-4; E-48 adds source-to-response count comparison (not balance proof); E-57/AI #1 server verification pending |
| W12 | Several books → group report | 3 | Yes | Partly | No | consolidation export, cross-book test; F-47 browser test |
| W13 | Stock: purchase → stock → sale → valuation | 3 | Yes | Partly | Partly ([D-94 inline-editor accessibility](verification/ai4-d94-inline-edit-names.md)) | ISS-130, ISS-131, DIM-2; C-128 item configuration verified locally, full stock journey/CI still pending |
| W14 | Roles and access (owner, accountant, bookkeeper, viewer) | 2 | Yes | Yes (RLS suite; AI #6 adds cross-workspace write assertions for invoice, bill, payment, credit, reconciliation, customer and vendor records; pass on test Postgres 19 Oct) | Partly | AUD-09 for the remaining write families |

**Today (19 Oct, night):** stage 1. **Fully Yes (connected, worked figures, browser): W6, W9.** One column short: W2 (worked figures: DIM-1 for separate payment records), W14 (browser), W3, W4 (worked figures). Critical items still open: AUD-02 rest (W10). Fixed 18–19 Oct: INT-1…5, INT-2 invoices/bills/payments, ISS-141/BUG-04, DIM-1 document payments, the axe 4.14 label-in-name failures.
C-126 local input evidence: the US tax-profile editor can explicitly copy recognized state/ZIP into its draft, preserving other place fields. Four phone/desktop light/dark browser cases pass; this does not establish tax jurisdiction or upgrade W8 readiness. See [verification](verification/c126-us-address-help-2026-10-19.md).


C-125 input guidance (AI #2, 20 Oct): Settings → Tax profiles now exposes optional EU/UK VAT-number format checks using the registration country, with masked results and explicit non-verification wording. W1/W7/W8 statuses are unchanged; no tax support or filing-readiness claim. Four local phone/desktop light/dark browser cases pass, with screenshots; independent CI remains pending. See [scope and checks](verification/c125-vat-number-help-2026-10-20.md).
