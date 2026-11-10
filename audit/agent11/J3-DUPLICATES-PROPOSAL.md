# J-3 — duplicate handling on import: what is true today, and the exact change proposed

**Agent #11, 10 Nov 2026.** Queue item J-3 (docs/COORDINATION.md): *"duplicate check on import:
skip/update/add-anyway"*. Status: **not implemented; it is a server change and belongs to AI #1's lane.**
This document is the proposal plus the evidence, so the owner can decide without re-investigating.

## What exists today (verified by reading and running the code at `8aeaea06`)

1. **A pre-import check that only reports.** `contactImportDuplicates` (`src/lib/contactFileImport.ts:219`)
   classifies each incoming customer/vendor row against the workspace's existing records:
   - `willSkip` — the **name is exactly the same** as an existing contact;
   - `possible` — same email, phone or tax id but a different name (the import will create a second record);
   - the screen (`src/components/platform/settings/ImportSettings.tsx:503-527`) says both in words,
     *"the import will skip them — nobody is created twice"* and *"importing will create a second record"*.
   The check is advisory: it changes nothing the server does.
2. **The server skips silently, and only on identity.** `importRecords`
   (`src/server/services/recordImportService.ts:77-84`) builds `identityKeys(kind, data)` for every
   existing record and drops an incoming row whose key is already taken, recording
   `{ row, message: "<label> already exists" }` in `skipped`. There is no way to say *update it instead*
   or *create it anyway*.
3. **Nothing else in the request can change that.** `importRecordsSchema`
   (`src/server/routes/workspaceRoutes.ts:228-233`) is `.strict()` and accepts only
   `kind`, `rows`, `openingDate`, `dryRun`. A new field has to be added deliberately; an old client
   cannot send one by accident.
4. **The UI copy therefore matches the server, but only for exact names.** A row that shares an email
   or a tax id with an existing contact is reported and then **created as a second record** — the screen
   says so before the import, which is honest, but there is no way for the bookkeeper to say "update the
   existing one" or "the tax id changed, this is the same company".

5. **A duplicate inside the file is already refused before the server sees it.** Probe
   `audit/agent11/probes/j3-max-import-rows.ts`: three rows named "Acme Ltd" produce
   `{"records":1, ..., "errors":[{"row":3,"message":"Same name as row 2"},{"row":4,"message":"Same name as row 2"}]}`
   — `prepareImport` keeps the first and refuses the rest by row number, and the import is blocked until
   the file is fixed. The cap is `MAX_IMPORT_ROWS = 2000`. So the only duplicates that reach the server
   are the ones against **records already in the workspace**, which is exactly what this proposal covers.

## The change proposed (server + one screen control)

```ts
// src/server/routes/workspaceRoutes.ts — importRecordsSchema
duplicates: z.enum(['skip', 'update', 'create']).optional()   // default 'skip' = today's behaviour
```
```ts
// src/server/services/recordImportService.ts — inside the existing transaction
// 'skip'   : today's filter (unchanged default, so every existing client keeps its behaviour)
// 'update' : the matched existing document is updated with ONLY the imported field set of that kind
//            (definition in IMPORT_KINDS), inside the same transaction, and counted as `updated`;
//            fields the import does not carry (balances, notes, portal settings, custom fields) are
//            left exactly as they are — the import never blanks a column it did not supply
// 'create' : today's `toCreate` list without the filter, counted as `created`
```

Rules that must hold when this is implemented (they are the reason it is not a one-line change):

- **Never delete.** An update writes only the keys the import provides; nothing is merged into money
  (balances, opening stock) — those stay the ledger's business.
- **Undo must cover updates too.** `undoImport` currently removes the batch's created documents; with
  `update` it must restore the previous values, so the transaction has to snapshot them into the batch
  record (or the feature must refuse `update` when an undo record cannot be written).
- **The duplicate set is computed inside the transaction**, as it is now (`t.get` of the workspace's
  collection), so two simultaneous imports cannot both decide a row is new.
- **The count that comes back must say what happened**: `created`, `skipped`, `updated` — the screen
  already has a "Reported as existing (skipped)" row and would gain one for updated.

## Why it is the lead's call

It changes how a write behaves on records that already exist, in a transaction that also posts opening
stock to the ledger (`stockMovesReady`, opening-equity entry). That is AI #1's lane by
`docs/COORDINATION.md`, and the owner asked that no lane rewrite another lane's server contract. The UI
half (a "When a row matches an existing record: skip / update it / add anyway" radio under the check)
is ~20 lines and follows immediately once the field exists.

## Test plan for whoever implements it

1. `duplicates: 'skip'` on a contacts import with a repeated name → response `skipped` 1, `created` 0,
   nothing written (regression guard for today's behaviour).
2. `duplicates: 'create'` → two records, the second is the new one; `created` 1.
3. `duplicates: 'update'` → one record; a changed phone number is stored; a field the import does not
   carry (e.g. `notes`) is **unchanged**; `undo` restores the previous phone number.
4. `duplicates: 'update'` with a row that matches nothing → created, `updated` 0.
5. The schema rejects an unknown enum value with 400 and touches nothing.
6. A concurrent pair of imports of the same file (sequential in the test) creates one record, not two.
