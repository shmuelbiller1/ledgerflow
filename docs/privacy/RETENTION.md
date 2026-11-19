# Retention (BJ-04)

How long each kind of data is kept, as the code does it today. Decisions still open are in
`docs/FOR_YOU.md` (items 15–16). Owners can change the periods marked *setting* per workspace
(Settings → Security → Data retention, `src/lib/retention.ts`); the daily job applies them
(`retentionService.ts`). **Legal hold** on a workspace stops all pruning and purging.

| Data | Kept | Then |
|---|---|---|
| The books (entries, invoices, bills, payments, contacts, items, bank lines…) | While the workspace exists | Deleted 30 days after the workspace is deleted (`workspacePurgeService.ts`, every table: guard test `workspace-purge-db.test.ts`) |
| A deleted workspace | 30 days, *setting* 30–365 (an owner can keep it: banner "Keep this workspace") | Purged, unless on legal hold |
| Audit trail (`auditLogs`) | Permanently, also after the workspace is purged | — (legal record of the books; FOR_YOU item 16) |
| Filed tax returns (`taxReturns`) | With the workspace; a backup restore never removes them | Purged with the workspace |
| Notifications | Read ones 60 days, all 180 days (`pruneNotifications`) | Deleted daily |
| Personal data of a deleted account (profile, templates, notifications, sign-in log) | Until the account is deleted | Deleted at once (`accountDeletionService.ts`; audit pseudonymisation design in [ERASE_AND_PSEUDONYMISE.md](ERASE_AND_PSEUDONYMISE.md)) |
| Browser error reports (`errorLogs`) | 90 days, *setting* 30–365 (reports from before sign-in: 90 days) | Deleted daily |
| Email send log (`emailEvents`: sent, failed, delivered) | 2 years, *setting* 90 days–10 years or forever | Deleted daily |
| Bounce and spam reports (`emailEvents`: bounced, complaint) | Permanently (they keep those addresses from being emailed again) | Purged with the workspace |
| Backups downloaded by owners | Outside LedgerFlow (the owner's own copy) | — |

Countries' rules on keeping accounting records (often 5–10 years) apply to the workspace's
owner; LedgerFlow keeps the books as long as the workspace exists.
