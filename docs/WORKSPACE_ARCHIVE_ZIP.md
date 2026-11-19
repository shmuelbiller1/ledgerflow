# E-21 Workspace archive ZIP

In Settings → Backup & Export, the workspace owner can download a ZIP based on the existing server JSON backup. The archive is read-only and uses the existing authenticated export endpoint. The source SHA-256 digest, schema version, workspace, record scope and reported counts are checked first. The screen refuses missing, altered or partial source data.

The archive contains a manifest, original backup.json, workspace.json, and a JSON and CSV copy for each collection included in the server backup. Empty collections are retained. The CSV is encoded as UTF-8 with the original Record JSON column for nested fields and the shared spreadsheet-safe quoting.

ZIP entries use the stored method, UTF-8 filenames and CRC32. The ZIP32 size limit is enforced. No additional package, migration, posting operation or server route is introduced.

## Coverage (BK-10)

The server backup (exportWorkspaceBackup in workspaceRestoreService) now holds every workspace record table: the ledger, the documents, the contacts, the settings tables (tax rates, dimensions, numbering, periods), and since BK-10 also invoice templates, learned bank-rule patterns, forecast scenarios, loans, filed tax returns, the fixed-asset table, client queries and the `documents` rows that are records (tasks, time entries, stage and rate settings). The workspace document (workspace.json) carries the settings; on restore the lock dates come back only forward (a backup never reopens a closed month) and the opening-balance date only where none is set.

Uploaded files: the archive lists attachment details (name, size, type and the linked record), not the file bytes. The `fileSha256` field hashes the stored link (`fileUrl`), not the file contents. Restore does not replace or delete stored attachments. It checks for a stored attachment with the same ID and, when the backup has a hash, the same link hash. Settings shows how many attachments did not match; that count does not mean the records restore failed. A match does not verify that the file itself is available or unchanged. Keep and verify copies of those files separately.

Left out on purpose (`NOT_IN_BACKUP`): members and invitations, API keys, bank connections and their tokens, the audit trail, notifications and e-mail logs, support tickets, derived training data and system tables.

A table added by BK-10 is replaced only when the backup has its key, so a backup made before BK-10 leaves those tables as they are.

## Restore

A signed-in owner can choose a ZIP or JSON in **Settings → Backup & Export → Restore Workspace**. ZIP validation checks each entry’s CRC32, the manifest and the SHA-256 checksum of `backup.json`. After validation, the screen names the file and workspace and asks whether to replace records. Cancel closes the dialog without sending anything. Only **Replace workspace records** sends the original JSON text to the existing restore endpoint. The server still decides whether the restore is permitted, including workspace and closed-book checks.

If the full JSON export service is unavailable, the separate **Download partial copy** option contains only browser-loaded records. This file is marked partial, cannot be restored, and does not satisfy the backup reminder. The reminder is a browser-local record that a download was started, not proof that a file was saved. If the browser refuses the reminder update, Settings reports it separately from the download. Older reminder dates may include a partial download and are not rewritten; keep a new full backup if you cannot confirm what was saved. Workspace exports do not check hosting-provider backups or recover uploaded file contents.

## Verification

Unit tests inspect the binary ZIP directory and checksums, preserve Hebrew text and exact source JSON, check CSV formula escaping, and refuse altered snapshots or wrong workspaces. Screen tests check owner access, server refusal and workspace changes. Complete repository CI is required before merge.

src/tests/bk10-archive-restore.test.ts (database) archives a seeded workspace, wipes it, restores the ZIP and checks the trial balance, profit and loss, balance sheet, record counts, settings and attachment list against hand-worked figures.
