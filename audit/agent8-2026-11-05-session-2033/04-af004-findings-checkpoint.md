# Agent #8 — AF-004 current-pin findings and recovery checkpoint

**UTC:** 2026-11-05, approximately 20:43.
**Application under review:** upstream `7896cbdcbba520f71614a3445b963b1c88d497bb`; branch `arena/6984648e-ledgerflow`.
**Latest pushed commit before this checkpoint:** `f58a02f5259ef462b9ed565192a33e6780c30389` (recovered prior work).
**Backup folder:** [Ledgerflow Agent Backups](https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK); [recovery checkpoint 03, read back](https://drive.google.com/file/d/1OTQOgQP9ZdLVmdLDYHXzG9f1wnjWNhM7/view).

This is a **bounded independent audit**, not a full-system review, deployment verification, tax opinion, or launch approval. The tax/financial owners must decide remediation and priority. The tests below use synthetic data; no production data or actual filing was touched. A red Vercel preview is not treated as a code-test result.

## Verified mechanisms — reproduce before real-data tax reliance

### 1. Historical sales-tax return changes when a customer moves

- **Reproduced:** the invoice retains `metadata.taxPlace = US/TX` as designed, but `usSalesTaxReturn` reads the **current customer** place (`src/lib/tax/usSalesTaxReturn.ts:53–63`). A synthetic issued sale of $100.00 net plus $8.25 tax is counted in Texas while the customer is in Texas; changing only the customer's place to Oklahoma makes the same saved Texas invoice vanish from the Texas result: **1 / $100.00 / $8.25 → 0 / $0.00 / $0.00**. The quarter journey, rendered jsdom component, and generated CSV carry the zero. This is one root mechanism with multiple failing assertions, not four separate defects.
- **Trace:** invoice form passes its saved destination snapshot (`src/components/sales/InvoiceModal.tsx:217–242`); its explicit historical contract and fallback are in `src/lib/tax/usInvoiceTax.ts:127–148`. `src/lib/usQuarterJourney.ts:253–273` calls the affected return; `src/components/reporting/UsQuarterJourneyReportView.tsx:85–104,142–143,181–203` renders and exports it. Existing PR [#255](https://github.com/shmuelbiller1/ledgerflow/pull/255) addressed the related **nexus watch**, not this return path; no matching issue was found in the 37 issue titles/bodies searched.
- **Impact / priority:** incorrect historical planning/report figures and CSV if a customer moves after an issued sale; the screen is read-only and does not itself file or pay. **Proposed P0 candidate for real-data tax reliance**, not a demonstrated synthetic-preview blocker or deployed incident. Validate appropriate credit-note and legacy-record fallback rules with the tax owner.
- **Evidence:** `af004-report-contracts.test.ts` tests the helper and quarter; `af004-quarter-view.test.tsx` tests rendered component and CSV. Both are review-only acceptance tests with intentional failures at this pin. Separate issue draft: `issue-draft-destination-snapshot.md`.

### 2. US return ignores the first-line seller/entity label

- **Reproduced:** with a Texas books permit and an Israeli entity that has its **own** VAT registration, a one-line invoice labeled only at `items[0].dimensions.world = il` is included in the Texas return (**1 document; expected 0** under the documented seller-permit rule). The same label at `doc.dimensions` is correctly excluded in the passing control; `documentEntityLabels` identifies the first-line label and its own VAT registration in another passing control.
- **Trace:** invoice form saves `items` (`InvoiceModal.tsx:217–235`) and uses `items[0]?.dimensions` for tax suggestions (`:504`); the Israel return's existing `documentEntityLabels` explicitly describes and reads that storage shape (`src/lib/tax/ilVatReturn.ts:38–55`). The US return instead calls `resolveSellerProfile(..., doc.dimensions, ...)` (`src/lib/tax/usSalesTaxReturn.ts:57`). Existing US-return fixtures use top-level `dimensions`, so their pass does not exercise the UI shape.
- **Impact / priority:** multi-entity or multi-label books can attribute the wrong seller's document and tax to a permit. **Proposed P0 candidate for real-data tax reliance**; no DB/browser-issued invoice or production occurrence has been shown. Mixed-entity lines and credit-note ownership require separate decisions/tests. This extends the prior Drive-only AF-004 F2, rather than claiming it as a new discovery. Separate issue draft: `issue-draft-first-line-owner.md`.

### 3. US buyer with no state is omitted without a destination warning

- **Reproduced:** with an otherwise valid taxed $108.25 invoice and both invoice/customer tax place `{country:'US'}`, the quarter's Texas row shows **0 documents / 0 tax**, and `journey.problems` contains no destination/state warning. `PartyModal.tsx:116,234–243` allows a tax country with the state blank; `usSalesTaxReturn.ts:60–63` silently continues when the state is undefined.
- **Impact / priority:** incomplete destination may make a taxable sale disappear from the prepared figures. The correct state is **not known** and must not be guessed; warn/hold or validate, subject to owner decision. Proposed **P1/P0 candidate** depending on actual exposure and launch scope. No end-to-end saved-customer reproduction was performed here. Separate issue draft: `issue-draft-unassigned-state.md`.

### Confirmed observation, not yet a defect decision

`taxProfilesProblem` accepts a US/TX books profile plus an IL label with no own registration; `resolveSellerProfile` then yields an IL place with inherited TX state/city and the TX permit (passing characterization test). Profiles intentionally support inheritance and a label may represent a location rather than a distinct legal entity; the owner must decide safe cross-country semantics. Earlier probe P2/P7 exercises consequences, but synthetic examples do not by themselves prove legal ownership or live reachability. Likewise the prior AF-004 F4/F5 are retained as historical observations, not newly certified fixes or production incidents.

## Tests actually run at this pin

- Explicit acceptance command:

  ```sh
  npm exec --yes --package=node@24 -- sh -c 'NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic node --import tsx --test audit/agent8-2026-11-05-session-2033/af004-report-contracts.test.ts audit/agent8-2026-11-05-session-2033/af004-quarter-view.test.tsx'
  ```

  **Exit 1: 12 tests, 6 pass and 6 fail, 0 skipped.** The failures are the purpose of the diagnostic: four assertions for mechanism 1 (helper, journey, jsdom UI, CSV), one for mechanism 2, one for mechanism 3. Full output: `af004-acceptance-output.txt`. These files are outside the default `npm test` glob; they are not hidden as passing tests.
- Existing eight focused tax suites: **51 tests pass, 0 fail**, with one database-gated **suite** explicitly skipped because `LF_TEST_DATABASE_URL` was unset (the runner's summary reports 0 skipped tests, but printed the skipped suite). They do not cover these missing contracts.
- Existing `src/tests/invoice-destination.test.tsx`: **5/5 pass**, including jsdom invoice form snapshot behavior and nexus-watch worked figures; not a real browser or persisted DB test.
- ESLint on the three recovered/new TS/TSX diagnostic sources: exit 0, no diagnostics. `npm ci` under Node 24 passed. Atlas `stats`/`validate` ran, but the stored atlas pin is `74b8318`, not this revision; `validate ok` means consistency of that old artifact, not a current inventory audit.
- **Not yet run:** full unit suite, RLS/real-Postgres concurrency, actual browser journey, live provider or deployment checks. Historical suite/CI counts must not be represented as this session's results.

## Recovery / next actions

1. Commit/push this checkpoint, exact tests/log, and issue drafts to the fixed branch; verify remote SHA. Upload and read back this checkpoint and the tests/log in the Drive folder.
2. Send the three distinct source-backed mechanisms to the owner through issues/PR if permissions allow, without modifying reserved money/server code. Separate verified behavior from legal or deployment assumptions. Check current open work before any further implementation.
3. Attempt required broader checks with Node 24 while tracking skips, resource limits and failures. Run DB/RLS/browser journeys only with an authorized isolated environment; otherwise explicitly leave them open.
4. Record latest branch/commit, PR and issue links, backup IDs, final counts, remaining release gates and resumption steps. No merging or owner decisions by this agent.
