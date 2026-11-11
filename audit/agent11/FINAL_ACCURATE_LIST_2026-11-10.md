# LedgerFlow — final accurate list — 10 November 2026 (Agent #11)

**Lane:** AI #11 — imports, exports and documents (J-1 … J-8 in `docs/COORDINATION.md`).
**Branch:** `arena/37ddbc4d-ledgerflow` · **Fork:** `Chaim-Richard/ledgerflow` · **Base:** `e58fa00a`.
**PR to open:** `https://github.com/Chaim-Richard/ledgerflow/pull/new/arena/37ddbc4d-ledgerflow`.

This document is the accurate state **at the commit it is committed with**, written after running the
code that it describes. Every claim below is either (a) a test I ran today, (b) a probe I executed
against the real function, or (c) a file-and-line read at this commit — never a summary of an earlier
audit document. Where an earlier document contradicts the code, I say so and give the probe.

---

## 1 · What I fixed and shipped in this lane (all tested, all pushed)

| Item | What was wrong | What I changed | Test |
|---|---|---|---|
| **J-1** export → import round trip | The CSV writer protects a value starting with `=`, `+`, `-`, `@` (and a leading zero) by prefixing `'`. The importer only took that guard off for some kinds, so a phone `+1 555 0100`, a note or a name starting with a dash came back with a stray apostrophe — silently corrupting contact data. | `unguardCsvCell` exported from `src/lib/csv.ts`; `recordImport.readValue` uses it. A real apostrophe the user typed is still kept. | `src/tests/j1-export-import-roundtrip.test.ts` (4) |
| **J-2** import preview | The preview showed 5 rows and listed problems in a separate table, without saying in place which rows would be refused. | New `src/lib/importPreview.ts` (`PREVIEW_ROWS = 20`): each of the first 20 rows is marked *Will be imported* / *Will be refused: reason*; the problems table now carries only rows **outside** the preview, so nothing is stated twice. A "showing the first 200 of N" line when the problem list is longer. | `src/tests/j2-import-preview.test.ts` (5) |
| **J-2 (wizard half)** | The QuickBooks migration wizard parsed pasted CSV with its own splitter, which got 3 of 4 realistic inputs wrong (quoted commas, quoted newlines, a BOM). | It now uses the shared `parseCsvChecked`. | `src/tests/j2-qbo-migration-shared-csv.test.ts` (7) |
| **J-4** Excel files | The wizard advertised `.xls`. ExcelJS cannot read legacy BIFF `.xls`, so a real `.xls` died on a raw parser error. | Accept list is `.csv` + `.xlsx`; a dropped `.xls` gets a toast telling the user to save it as `.xlsx`; on-screen help says the same. `.xlsx` was already handled by every list importer. | same suite (7/7) |
| **J-5** Hebrew in exports | Nothing tested that Hebrew survives an export, or that the UTF-8 marker that makes Excel show it correctly is present. | Tests pin the `EF BB BF` bytes in `downloadCsv`, both archive writers, and a word-for-word Hebrew round trip. Behaviour was already correct — now it cannot regress. | `src/tests/j5-hebrew-exports.test.ts` (4) |
| **J-7** Documents screen | It read only the signed-in user's own uploads, showed name/date/size and nothing else, had no filters, no way to open a file from the list, and showed "Vault Depleted" for a failed read (i.e. told the user their files were gone when the read had merely failed). | New `src/lib/documentLibrary.ts`: file type from the MIME type, month, *belongs to* (from `linkedCollection`/`linkedLabel`/`linkedTransactionId`), search, counts, and undated rows never hidden by a month filter. The screen now lists the workspace's documents (the database's own workspace rules still decide who may read), filters by type / record / month with counts, says *Belongs to Invoice INV-1001* on each card, opens the existing preview from the card, and separates **no documents yet** / **nothing matches these filters** (with the reason and a Clear button) / **could not be loaded — try again**. | `src/tests/j7-document-library.test.ts` (7) |
| **J-8** year-end archive | Missing: no way to hand an accountant one file per year. | `src/lib/yearEndArchive.ts` plans it purely (year decides membership from `date`/`issueDate`/`documentDate`/`dueDate`/`createdAt`; a record with no usable date is **counted**, not silently included; customers/vendors/items/accounts are written whole because they carry no document date) and builds the CSVs with the shared writer + BOM. `Settings → Backup & Export → Everything for a year`: shows the exact file list first, then one ZIP of that year's CSVs plus every invoice PDF of the year, from the checksum-verified server backup (the same source as the workspace archive) and the existing document PDF route. | `src/tests/j8-year-end-archive.test.ts` (8) |

Commit trail: `ec71e2a2` (J-1, J-2 wizard) · `f6334cec` (J-2 preview, J-5) · `6b55b7e8` (J-4, J-7) ·
`8aeaea06` (J-8) · plus checkpoint commits `d0a394dd`, `223362e2`. All pushed to the fork.

## 2 · What is still open in this lane

### J-3 — duplicate handling on import (`skip` / `update` / `add anyway`) — **needs the money/server lane**

Not a UI gap. The screen already reports both cases honestly (`willSkip` for an identical name,
`possible` for the same email/phone/tax id under a different name, and it says *"importing will create a
second record"*). What is missing is the server's ability to act on that: `importRecords`
(`src/server/services/recordImportService.ts:77-84`) drops any row whose identity key is taken and the
request schema is `.strict()` with no field to change that. Adding `update` means writing into records
that already exist **inside the transaction that also posts opening stock to the ledger**, and `undoImport`
must then restore previous values. That is AI #1's contract; my proposal, with the exact schema field,
the rules (never blank a column the import does not supply, snapshot for undo, compute inside the
transaction) and six tests, is in **`audit/agent11/J3-DUPLICATES-PROPOSAL.md`**.

### J-6 — invoice PDF content — **finding, money lane**

Executed the real generator (`audit/agent11/probes/j6-invoice-pdf-content.ts`): the PDF does **not**
print the workspace's tax number and does not print the customer's address or tax id. Long item names
wrap correctly. In Israel a tax invoice without the seller's עוסק מורשה number and the buyer's details is
not a valid חשבונית מס; in the US a sales invoice without the buyer's address is a weak audit document.
Not my lane to change — reported with the probe.

### Smaller, verified, unfixed (with the reason)

1. **The bills list export has no importer.** `Purchases.tsx:220` writes `bills_export.csv` (Vendor Name,
   Bill Number, Date, Due Date, Status, Amount, Currency); `IMPORT_KINDS` is
   `customers | vendors | items | accounts`. A user can export bills and cannot bring them back.
   A bill importer has to decide what a bill *is* (it posts to the ledger), so it is a money-lane job.
2. **No "Export CSV" on the invoices list.** `Sales.tsx` has per-invoice PDF/print; the workspace export
   dialog covers ledger/accounts/contacts/bank/trial balance. An accountant who wants the invoice register
   as CSV uses the year-end archive (new) or the workspace dialog — there is no button on the list itself.
3. **IIF item round trip loses Description and mis-files Category.** `INVTYPE=INVENTORY` becomes every
   item's Category and the item Description is dropped; `quantityAtHand` is dropped on purpose (opening
   stock needs a date, which IIF does not carry in a way we can trust). Small, but an accountant will
   notice.
4. **`audit/FINAL_ACCURATE_LIST_2026-11-08.md` is committed with unresolved conflict markers**
   (lines 1 / 59 / 194) — two contradictory documents spliced together, on `upstream/main`. It should be
   split or repaired before anyone cites it.
5. **The Documents list fetches every document's stored bytes.** Each upload is stored as a data URI in
   the row (700 KB cap). The list now shows the whole workspace, so on a workspace with many scans,
   opening Documents is heavier than it needs to be. Fix = a column projection (Firestore `select` /
   the Supabase adapter's `select('id,data')`) plus a per-document read when the preview opens. Not done
   here: previews and scanning read `fileUrl` from the same state, so it is a real, small refactor.

### Cross-checks where the upstream "FINAL" list is wrong (re-executed today)

**#519 / #518 are live in the code**, despite §5 of the upstream list saying the snapshot is preserved
and the silent drop was replaced by a warning. `src/lib/tax/usSalesTaxReturn.ts:60-63` reads the
**customer's current** `metadata.taxPlace` and never the invoice's saved `metadata.taxPlace` that
`saleDestinationSnapshot` writes (`usNexusWatch` already reads it); a defined non-US place yields
`buyerState === undefined` → `continue`, no count, no warning. Probe
`audit-probes/p519.ts` (run against the `upstream/main` export):

```
NY return, customer moved to CA (invoice snapshot says NY) => {"state":"NY","net":0,"tax":0,"docs":0}
NY return, buyer place is non-US (GB)                     => {"state":"NY","net":0,"tax":0,"docs":0}
NY return, customer still NY (control)                    => {"state":"NY","net":800,"tax":800,"docs":1}
  (the return has no `net` key; the figure shown is taxableSales + exemptSales = 800 cents)
```

A filed state return can therefore **understate** a period after a customer's address is edited. That is
a money-lane defect, not mine; it needs the owner's attention before a launch that claims state sales tax
is ready.

Scale figures, measured at `8aeaea06` rather than quoted: **2,478** `.ts`/`.tsx` files under `src/`,
**946** unit test files, **101** e2e specs, **51** SQL migrations.

## 3 · Test evidence (commands actually run)

```
npx tsc --noEmit -p tsconfig.json                               0 errors
npx eslint <touched files> --max-warnings 0                     0 errors, 0 warnings
npx tsx --test src/tests/j1-export-import-roundtrip.test.ts     4/4
npx tsx --test src/tests/j2-qbo-migration-shared-csv.test.ts    7/7
npx tsx --test src/tests/j2-import-preview.test.ts              5/5
npx tsx --test src/tests/j5-hebrew-exports.test.ts              4/4
npx tsx --test src/tests/j7-document-library.test.ts            7/7
npx tsx --test src/tests/j8-year-end-archive.test.ts            8/8
import/export screen regressions (contact/iif/provider screens) 16/16
Vault neighbours (dialog-keyboard, journal-templates)           12/12
ledger-collections-guard                                        4/4
(plus the probe scripts in audit/agent11/probes and audit-probes/)
```

Full suite: started on the untouched checkout (see checkpoint 01) and continued on the changed tree in
batches; **every completed batch reported 0 failures**. This sandbox has **no Postgres and no Chromium**,
so `npm run test:rules`, `npm run test:e2e` and `npm run build` were **not** run here — CI (or a machine
with those services) must run them before merge. I am not claiming them.

## 4 · What the owner (Shmuel) has to decide

1. Merge `arena/37ddbc4d-ledgerflow` (J-1, J-2, J-4, J-5, J-7, J-8 — no money logic touched, no new
   write path, only existing exports composed), then run CI including DB and browser suites.
2. Hand J-3 to the server lane with the proposal in `audit/agent11/J3-DUPLICATES-PROPOSAL.md`.
3. Treat **#519/#518** as live and fix them together (one change: read the invoice's own snapshot and the
   lines' entity labels; count and warn on an unusable place).
4. Decide whether the bills export without an importer ships (it is honest as an export; it is a dead end
   for a round trip).

Nothing here was merged by me, and nothing in this document decides acceptance. All code is on the
branch above; all documents are in Drive (folder `Ledgerflow Agent11 audit 2026-11-10`).
