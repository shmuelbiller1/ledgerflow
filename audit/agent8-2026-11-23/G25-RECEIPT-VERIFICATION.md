# AI #8 G-25 checkpoint — 23 November 2026

**Disposition: partial (`[~]`), not phone/device acceptance and not a release certification.** At the pinned revision, source and existing tests support the web flow for taking or selecting an image, saving a vendor-bill draft with a document reference, and sending no ledger transaction entries for a new draft. They do not show that a physical phone opened its native camera, and the product question in #894 is still unanswered. No product, server, posting, schema, or production-data changes were made.

## Snapshot and scope

- Branch: `arena/7917fa2f-ledgerflow`; source revision: `9c7f9fbd1f881a5915c030e066ded6f596113938` (main merge commit). The working tree was clean at review start.
- Scope: AI #8's queue item G-25, which refers to the **AI queue's G-18** receipt-to-draft-expense promise. The separate `docs/FIRST_TESTERS_GATE.md` row also numbered G-18 is about exit/lock-in and is not being evaluated or changed here.
- This is a focused source/test review, not the repo-wide function audit required by `docs/INDEPENDENT_AUDIT_AGENT.md`; no function-count denominator or audit-scorecard update is claimed.
- No local tests were run: this checkout has Node `v22.22.3` while `package.json` requires Node 24.x, `node_modules` is absent, and no local Playwright browser was found. No physical iOS or Android device was available.

## Source-backed flow at the pinned revision

1. `src/components/layout/QuickCreateMenu.tsx:106-122` offers **Snap a receipt** and mounts `SnapReceiptDialog` when selected. The action is gated by the normal create permission.
2. `src/components/layout/SnapReceiptDialog.tsx:191-192` uses an image file input with `accept="image/*" capture="environment"`. This is a browser/platform capture hint; it is not proof that a particular OS launches its camera. `:89-97` accepts image MIME types, rejects files over the limit, and reads a preview. `src/lib/snapReceipt.ts:12-13` sets the maximum to 700,000 bytes.
3. On Save, `SnapReceiptDialog.tsx:141-160` first saves the image as a document, creates a bill using the returned document ID, then updates that same document to link it to the bill. A link failure is surfaced as a warning while keeping the photo in Documents; a bill-save failure says the image is in Documents. These are visible, non-atomic client-side steps, not a single demonstrated database transaction.
4. `src/lib/snapReceipt.ts:53-71` constructs a **vendor bill** with `status: 'draft'`, `posted: false`, zero paid, a Receipt split, and `metadata: { source: 'phone-receipt', receiptDocId }`. It is not a reimbursement claim.
5. `src/services/ledgerPost/billPosting.ts:87-94` takes the draft early-return path before ordinary bill posting. The path may still send the bill mutation so the draft is persisted; it sends no ledger transaction entries for a new draft. `postingCore.ts:301-314` confirms that an empty transaction list plus an entity mutation still reaches the host. Thus “posts nothing” here means **no GL transaction entries**, not “no server request or write.”
6. For a signed-in workspace, `src/hooks/useEntityOperations.ts:339-344` sends the bill through the existing `bill.create` command. No server route or posting code was changed or exercised against a live database in this checkpoint.

Pinned Git blob IDs for the relevant files:

| Path | Blob SHA |
|---|---|
| `src/components/layout/QuickCreateMenu.tsx` | `a09322e10c77ed9d8f0939bcea417631dbdaaedc` |
| `src/components/layout/SnapReceiptDialog.tsx` | `1df0402eb7c4c5cb6345ebb7ff830183e5e850f6` |
| `src/lib/snapReceipt.ts` | `5531d32114bb535983d4139fe47c19080e133847` |
| `src/hooks/useEntityOperations.ts` | `c0ec2da1ba3a87a941b3db905b393e6059cd7196` |
| `src/services/ledgerPost/billPosting.ts` | `229b98abc665d86821ba2931a0c2c6af20f051d1` |
| `src/services/ledgerPost/postingCore.ts` | `c1363e2eef9fc830fb8b896c7d0c866b95f9c92f` |
| `src/tests/eu-c4-snap-receipt.test.ts` | `76bf540177838c7ddaebe86dfdaaa09cfca6103d` |
| `src/tests/eu-c4-snap-receipt-dialog.test.tsx` | `dabeda89d470505376c7b286d7f6e53258c8810e` |
| `src/tests/draft-documents-saved.test.ts` | `d6c9c55f08e692ae2606281530a74a9869d77f38` |
| `e2e/eu-d2-phone-jobs.spec.ts` | `092e647ea7618bedc7cc9ab28a9e4478b75ab990` |

## Existing test evidence and its boundary

- `src/tests/eu-c4-snap-receipt-dialog.test.tsx:55-105` drives the component and asserts the write order `document.save → bill.create → document.save`, the draft payload and receipt ID, and the link payload. The signed-in branch mocks `fetch`; it does not run a real database or persist/read back the photo.
- `src/tests/draft-documents-saved.test.ts:54-61` calls `LedgerPostService.postBillLedger` for a new draft and checks that the bill-post request contains no `transactions` field. The fetch is stubbed; this tests the client posting boundary, not the server's real database behavior.
- `src/tests/eu-c4-snap-receipt.test.ts:69-72` has an additional source-text guard for the draft early return. It is not itself a behavioral posting test.
- `e2e/eu-d2-phone-jobs.spec.ts:33-65` opens the phone-width dialog, verifies the `capture="environment"` attribute, supplies a synthetic image with Playwright `setInputFiles`, checks the preview, rotates the viewport and checks that controls remain reachable. It does **not** click Save, check bill/document persistence, or interact with a native camera. A 390-pixel Chromium viewport is not a physical phone.
- Historical corroboration only: merged PR #885 (`7eab28219c6b190012f887c019dcd46995b69e45`) addressed the attachment link and landscape clipping. Its description reports a disposable-Postgres `document.save → bill.create → document.save` drill with one linked photo, one draft bill and zero ledger transactions. This was not a physical-device check, and is not being substituted for a current rerun.

## Hosted CI evidence

GitHub Actions run [#45283355096](https://github.com/shmuelbiller1/ledgerflow/actions/runs/45283355096) was a `push` to `main` at the pinned SHA and concluded `success` on 23 Nov. GitHub job metadata shows successful production build, all four unit-test shards, the six timezone shards, lint/typecheck/database rules, the accounting/security coverage gate, all five Playwright browser shards, and the Playwright report/gate job. Five `playwright-shard-*` reports and a combined report were uploaded. `playwright.config.ts` uses `testDir: './e2e'`, and the main-push CI route selects the full browser matrix, so the existing EU-D2 synthetic Chromium scenario is in the hosted browser suite at this revision.

A direct per-spec CI log read failed with `EOF` while fetching the Actions log from its external results receiver. The job conclusions and uploaded artifact metadata were available; I did not inspect the test-level report or independently confirm which shard listed EU-D2. The hosted run is evidence for this source revision, not a native-camera test.

Draft PR [#1032](https://github.com/shmuelbiller1/ledgerflow/pull/1032), head `1fe68c8e51548d1e544e72752bdaa0b152b09efc`, has completed its **docs-only** checks. `What changed`, `Docs checks`, the accounting/security coverage gate, CodeQL, CycloneDX, Schemathesis (report-only), SonarCloud, Gitar, and the Playwright smoke aggregator all passed; Gitar approved with no findings, and Sonar reported no new issues. The Playwright full/targeted shards, unit and timezone shards, lint/typecheck/database rules, and production build were skipped by the docs-only path; the smoke aggregator passed with browser execution skipped. Therefore **no functional suite was rerun on the PR head**. The main-push run above is the hosted functional test evidence for the unchanged source revision.

## Open question, issue review, and disposition

- Issue [#894](https://github.com/shmuelbiller1/ledgerflow/issues/894) is still open. Its product decision is whether the vendor-bill draft above satisfies the AI queue's G-18, or whether capture must create a separate reimbursement draft with its own payee, permission, attachment-retention, and draft-to-submit rules.
- Issues #888 and #892 are closed; merged PR #885 fixed the mobile dialog clipping and signed-in receipt-link path. Approval issues #857 and #921 are closed separately; that does not answer the reimbursement-vs-vendor-bill product question.
- On 23 Nov AI #8 posted the evidence and decision request to [issue comment #7117405000](https://github.com/shmuelbiller1/ledgerflow/issues/894#issuecomment-7117405000). No owner/AI #1 decision was visible at review time.
- Physical iOS/Android camera behavior, picker/file compatibility (including the 700 KB cap), and a saved-bill/no-ledger round trip on a disposable database remain unverified in this session.

**G-25 stays `[~]`; do not tick the AI queue's G-18 or claim device acceptance yet.** Next: get the owner/AI #1 scope decision on #894. If the vendor-bill path is accepted, arrange an isolated, witnessed iOS and Android check of camera launch, file size/format, bill and link persistence, and zero ledger entries. If reimbursement is required, obtain the defined workflow and an authorized implementation task first. No `docs/RELEASE_GATE.md` status was changed; `docs/FIRST_TESTERS_GATE.md` remains its separate, not-certified checklist.
