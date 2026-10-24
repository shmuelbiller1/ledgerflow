# AI #5 queue audit — 23 Oct 2026 (E-17 … E-57)

Re-read of every open item in my queue (`docs/COORDINATION.md`, "AI #5" sections) against `main` at `5ab0915` and
this branch, so the list says what is actually true rather than what was true in October's earlier passes. Each row
names the evidence found in the source, or the exact thing that is missing.

Legend: **done** (delivered with tests, reachable by a user where the item asks for a screen) · **partial** (part of
it works, the missing half is named) · **open** (nothing of it exists) · **blocked** (cannot be finished honestly
without a specification, an owner decision or another lane's work).

| Item | Status now | Evidence / what is missing |
|---|---|---|
| E-17 Form 856 CSV writer | **partial — blocked on the authority's layout** | `src/lib/tax/form856.ts` + `form856ReviewExport.ts` + Reports → Form 856 compute and export a **review worksheet** CSV per vendor (`form-856.test.ts`, `form856-review-export.test.ts`, `form-856-view.test.tsx`). The export says in code that the authority's file is **not** CSV: the published 2017–2025 interface is fixed-width 60/70/80 records at 218 bytes. Writing that without the verified layout would be a fake file; keep the worksheet until the specification is checked. |
| E-33 Uniform file (קובץ אחיד) | **open — blocked** | No BKMVDATA/INI writer. Needs the authority's fixed-width record list (field widths, record codes, INI keys) verified from the published specification; E-54's note is the prerequisite. |
| E-34 SAF-T-like XML export | **open — blocked** | Nothing in the tree. "SAF-T-like" needs a chosen schema (OECD SAF-T 2.x or a country profile) before a schema-validated export means anything. |
| **E-35 Receipt OCR fixtures** | **done (this branch)** | 20 images + answer key `src/tests/fixtures/receipts/`, scorer `src/lib/receiptFixtures.ts`, harness `npm run eval:receipts`, `receipt-fixtures.test.ts` 10/10. See `docs/RECEIPT_FIXTURES.md`. |
| E-44 Xero CSV export import (chart, contacts, invoices) | **partial** | Invoices/bills: `src/lib/xeroDocumentsImport.ts` + Settings → Import data panel + `xero-documents-import.test.ts` / `-view.test.tsx`, fixtures in `src/tests/fixtures/xero/`. Chart of accounts and contacts: **no provider-tagged path and no Xero fixture** — they only reach the generic importer (`recordImport.ts`), whose header aliases happen to cover some Xero names. Missing: a Xero chart/contacts fixture and a preview that names the source as Xero. |
| E-45 Wave CSV import | **open** | Only Wave's *account names* are recognised in `parseAccountType` (`recordImport.ts:158`, CE-09/BK-03). No Wave fixture, no verified header set, no provider path. |
| E-46 Zoho Books CSV import | **open** | No mention in `src/lib`, `src/components` or the fixtures. |
| E-47 Sage 50 CSV import | **open** | No mention outside my queue line. |
| E-49 Import undo (one batch) | **done — tick it** | Server: `undoImport()` in `src/server/services/recordImportService.ts` (per-batch `importBatchId`, refuses system records and in-use records, reverses opening stock through the normal validated posting path, keeps history); route `POST /api/v1/workspaces/:id/import-records/:batchId/undo` with the role guard (`src/server/routes/workspaceRoutes.ts:293`); screen: "Undo" on the recent-imports card in `src/components/platform/settings/ImportSettings.tsx`; tests in `record-import.test.ts` and `stock-moves.test.tsx`. Delivered by another lane; the posting half is AI #1's and already merged. |
| E-50 Receipt e-mail inbox → draft bills | **open — blocked** | Nothing in the tree, and it needs an inbound mail provider plus server attachment handling (AI #1's lane) before a staging parser has anything to read. |
| E-51 Attachment OCR text search | **open — blocked** | Nothing in the tree. Needs an OCR provider and stored text per attachment; without it, a "text search" would be a claim about files nobody read (the same honesty rule AUD-14 enforces for receipts). E-35's fixtures are the evaluation half for whichever OCR path is chosen. |
| E-52 Full workspace ZIP with CSVs and a manifest | **done — tick it (delivered by E-21)** | `src/lib/workspaceArchive.ts` builds one stored ZIP with every collection in the authoritative server backup as exact JSON **and** spreadsheet-safe CSV, plus a manifest and the backup's own checksum, owned by Settings → Backup & Export (owner only, server read, no browser-cache fallback); `workspace-archive.test.ts`, `WORKSPACE_ARCHIVE_ZIP.md`. Its own README states what the backup does not include. |
| E-53 QuickBooks IIF export | **open — next real writer task** | Only the reader exists (`src/lib/iifImport.ts`, E-29). No writer anywhere; the Settings → Backup & Export screen still tells users to take the CSV instead. A writer is bounded work: `!HDR`/`!ACCNT`/`!CUST`/`!VEND`/`!ITEM` sections from the workspace lists, with a round-trip test through the existing reader, and **no** `!TRNS`/`!SPL` transaction sections (meaning posting). |
| E-54 Mivne Achid research note + fixture | **open** | No note. It is the prerequisite for E-33; it must quote the authority's field widths, so it cannot be written from memory. |
| E-55 PCN874 writer finish | **partial** | `src/lib/tax/pcn874Draft.ts` (draft, 131-character header, sourced to the Tax Authority's Appendix A) + `docs/PCN874_DRAFT.md`; missing: the transaction/detail record layout verified, a totals/reconciliation check, and the validation screen the item asks for. |
| E-56 Real-file corpus (30 files) | **partial** | Existing fixtures: 12 bank statements, 25 parser files, 3 Xero, 1 IIF (`src/tests/fixtures/`). Now **21 receipts** (20 images + manifest) from E-35, but rendered rather than photographed and scored on transcription. Missing: anonymised *real-shaped* photographs and real QuickBooks/Xero exports with expected end-to-end results, run in CI. |
| E-57 Migration proof screen | **partial** | `src/lib/migrationTrialBalanceProof.ts` + `MigrationTrialBalanceProof` panel wired in Settings → Import data (`ImportSettings.tsx:659`) with `migration-trial-balance-proof.test.ts`: a QuickBooks trial balance CSV is compared per account against the server's snapshot. Missing: A/R, A/P, cash and tax payable next to the source's totals, which is what the item asks for and what the server check (AI #1) would reconcile against. |

## What I would take next, in order

1. **E-53** QuickBooks IIF export (writer + round-trip test through the E-29 reader) — bounded, no money, useful to accountants who need a Desktop file.
2. **E-44** finish Xero (chart + contacts fixture and a provider-named preview) — small, and it makes the existing generic path an actual "Xero import".
3. **E-57** the four statement totals beside the trial-balance proof — needs AI #1's server snapshot to carry A/R, A/P, cash and tax payable; ask there first.
4. **E-54 → E-33** only when the fixed-width specification can be quoted from the authority.

E-45/E-46/E-47 need a real export from each product before anything is written; a parser invented from a guessed header set is a claim, not a control (the same reasoning that made E-43 one header-driven reader instead of four invented per-bank layouts).

## No code was changed for this audit

This page is a re-read: nothing was ticked in `docs/CAPABILITIES.md` and no source file was touched. The two items
that are already delivered (E-49, E-52) are recorded here rather than silently re-implemented, so the queue stops
counting them as work.
