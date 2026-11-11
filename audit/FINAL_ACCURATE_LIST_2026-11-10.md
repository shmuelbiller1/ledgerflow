# LedgerFlow — Final, Accurate List (10 Nov 2026) — AI #3

**This document is FINAL as of the code pin below.** (Owner: "work fast to get the final with
list of accurate stuff … push and test audit so it's saved, the info isn't lost, and you can
state when it's final".) Every status below cites the run or read that earned it. Later
sessions: add a dated correction note at the bottom; do not silently rewrite statuses.

| | |
|---|---|
| **Code pin (main base)** | `dc40739708a013ad080ffb306fe461554a2391fc` — "docs: AI #12 active (N-1…N-10, start note); spare queue AI #13 (R-1…R-5)" |
| **This session's branch** | `arena/3fc8a35d-ledgerflow` (AI #3 batch A-273…A-277) |
| **System size** | ~2,600 files under `src/` (2,596 counted 10 Nov), ~3,500 unit tests |

## A. Verified in this session (executed, not just read)

| Item | Verified result | Evidence |
|---|---|---|
| **A-273** invoice print with a real PDF | **Done.** The print spec stubs the document endpoint with a PDF fixture and checks the invoice number + total in the previewed bytes. 1/1 Chromium. | `e2e/print-styles.spec.ts`; `docs/verification/ai3-a273-a277-2026-11-10.md` |
| **A-274** aging focus regression | **Done.** Arrow-open row 1, Enter-open row 2, focus on row 2. 3/3 file. Proven non-vacuous by reverting the `openerRef` line (test fails). | `e2e/keyboard-reports.spec.ts` |
| **A-275** passkey "not enabled" wording | **Done.** `passkeysOff` matches the server's words as well as its codes; Settings + sign-in show the plain wording. 11/11 unit (2 new, both fail without the fix). | `src/lib/db/auth.ts`; `src/tests/passkeys.test.tsx` |
| **A-276** phone pass, ten A-272 screens | **Done.** 10/10 Chromium at 390 px (layout, 44 px targets, axe serious/critical). Found + fixed 3 real defects: Payments table unreachable (flex min-width blowout), Purchase Orders scroll regions not keyboard-focusable, Audit Trail Export clipped. | `e2e/phone-a272-screens.spec.ts`; `PaymentsView.tsx`, `PurchaseOrdersView.tsx`, `AuditTrail.tsx` |
| **A-277** trial balance / journal print roots | **Done.** Both Ledger views are `data-print-root`s with the Reports paper choice; journal sheet joins the print loop. Full print file 10/10 Chromium (A4 `595×842`, Letter `612×792` from the printed PDF). | `TrialBalanceView.tsx`, `JournalView.tsx`, `e2e/print-styles.spec.ts` |
| Types / lint / build | **Clean.** `tsc` 0 errors; ESLint 0 errors / 42 warnings (cap unchanged); `npm run build` passes. | This session, on the branch |
| Focused unit tests | **39/39** (`passkeys`, `journal-view`, `payments-view`, `purchase-orders-inline`, `empty-error-states-next-ten`, `aging-views`). | This session, on the branch |

## B. Accurate launch status (unchanged by this batch)

- **Stage A (synthetic bookkeeping beta) is READY** — W1, W2, W3, W4, W5, W6, W9, W10, W14 all
  Connected · Verified with worked figures · Browser-tested (`docs/RELEASE_GATE.md`). This batch
  moves no gate row.
- **Stage B remains open:** W11 QuickBooks/CSV import matched to source (AU-4), W13 stock journey,
  ERPNext depth (EG-1 repost engine, EG-2 payment ledger, EG-3 period closing voucher, EG-7 stock
  snapshots). Owners: AI #5/#9 (W11), AI #4/#9 (W13), AI #1/#9 (ERPNext depth).
- **Owner launch actions** (not code): paste the L-123 migration in Supabase, set
  `DATABASE_CA_CERT` in Vercel, rotate the 4 generated secrets (`docs/FOR_YOU.md`).
- **Vercel previews are red by owner choice** (previews paused to save usage), not by code failure.
  Judge code by CI, not by Vercel.

## C. What this session did NOT verify (honest limits)

- **Full unit suite + DB-backed suites** (`npm test` full run, `test:rules`, coverage gate) — the
  full run was started locally; DB-backed tests need `LF_TEST_DATABASE_URL` and run in CI. CI on
  the PR is the gate.
- **Browser runs used a registry-hosted Chromium 153** (`@sparticuz/chromium`) because this
  sandbox cannot download Playwright's browser from its CDN. CI uses stock Chromium; the specs
  are standard Playwright and were green here.
- **No production data, live DB, or deployed site was touched.** No money, posting, tax-maths or
  `src/server/` code was changed.

## D. Bot/review follow-up (this PR)

- Codex P2 + CodeRabbit notes on #595 (the A-268…A-272 batch) map onto this batch: the
  `openerRef` stale-focus finding → A-274 (fix was already in, test added); the invoice-preview
  shell finding → A-273 (real PDF now loaded); the print-coverage handoff note → A-277.
- This PR's own Codex/CodeRabbit comments will be answered on the PR and resolved here; CI must
  be green before merge.

## E. AI #3 queue after this batch

**Empty.** A-268…A-277 are all done. Waiting on AI #1 (lead) for the next batch. Half-done
`[~]` items that need AI #1's server lane (A-72 entity statement PDF/JSON, A-70 dunning send,
A-123 `groupRates` persistence, A-131 per-entity numbering, A-154 AU-4 server check, A-180 email
timeline) stay with the lead — see `docs/COORDINATION.md` Messages.
