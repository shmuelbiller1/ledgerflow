# Person Erasure & Pseudonymisation Design (S-15)

How LedgerFlow removes a deleted user's personal data (`DELETE /api/v1/auth/delete-account` → `src/server/services/accountDeletionService.ts`) while preserving legal bookkeeping facts and cryptographic audit-chain integrity (`src/lib/auditHashChain.ts`).

## 1. Current behaviour at `main` (`accountDeletionService.ts`)

When a person deletes their account:

1. **Workspace ownership protection (`planAccountDeletion`):**
   - Shared workspaces where the person is the sole owner and other members exist **block deletion (`409`)** until ownership is transferred.
   - Shared workspaces with another co-owner or non-owner membership remove the person from `members` and `roles` (`withoutMember`).
   - Solo workspaces (`others.length === 0`) are marked `status = 'pending_deletion'` with the retention purge window (`scheduledPurgeAt`, default 30 days) and purged later by `workspacePurgeService.ts`.
2. **Immediate personal data deletion:**
   - `users/{uid}`
   - `recoveryCodes/{uid}`
   - `customTemplates` where `uid == user.uid`
   - `notifications` where `uid == user.uid`
   - `loginAudits` where `uid == user.uid`
   - `workspaceGroups` owned by `uid`, plus `sharedWith` / `sharedEmails[uid]` cleanup on groups shared with them
   - `auth.users` via `authAdmin.deleteUser(uid)`

## 2. Residual personal data gaps identified in audit

1. **`auditLogs` email fields (`email`, `userEmail`, `actorEmail`) & `details`:**
   - `accountDeletionService.ts` writes `WORKSPACE_DELETION_SCHEDULED` / `MEMBER_LEFT` with the user's raw email and leaves historical `auditLogs` rows untouched.
   - Because `public."auditLogs"` is append-only (`revoke update, delete on public."auditLogs" from authenticated`) and protected by a SHA-256 hash chain (`entryHash` in `src/lib/auditHashChain.ts`, `chainHash` in `src/server/services/auditLogService.ts`), naive mutation of `details` would break historical audit-chain verification.
2. **Other personal-data tables outside `accountDeletionService.ts`:**
   - `supportTickets` (`uid`, `email` / `userEmail`), `supportMessages` (`authorUid`, `authorEmail`), `errorLogs` (`userId`, `userEmail`), and pending `invites` (`email`).

## 3. Hash-chain-safe pseudonymisation design

### Key invariant in `canonicalAuditPayload` (`src/lib/auditHashChain.ts`)

`canonicalAuditPayload(entry, seq, prevHash)` hashes:
`{ v: 1, seq, prevHash, id, workspaceId, timestamp, uid, action, entityType, entityId, details }`

Notice:
- `uid` is an opaque UUID (no email/name PII).
- Top-level `email`, `userEmail`, and `actorEmail` are **excluded** from both `computeAuditEntryHash` and `computeAuditChainHash`.

### Two-layer erasure architecture (for AI #1 server/DB implementation)

1. **Deterministic keyed pseudonym (`pseudonymiseEmailAddress(uid, SYSTEM_SALT)` in `src/lib/auditHashChain.ts`):**
   - Produces `erased-<12-hex>@redacted.invalid` using HMAC/SHA-256 with `SYSTEM_SALT` and `uid`.
   - Keeps distinct erased actors distinguishable in auditor exports without retaining any recoverable PII or breaking correlation per `uid`.
2. **Storage + read-time redaction:**
   - **Top-level email scrub (server migration / `SECURITY DEFINER` erasure helper):** replace `email`, `userEmail`, `actorEmail` on `auditLogs` rows where `uid = $1` with `erased-<12hex>@redacted.invalid`, and scrub/delete user-owned `errorLogs`, `supportTickets`/`supportMessages` author emails, and pending `invites` for the verified email. Because `entryHash` and `chainHash` do not include top-level `email`/`userEmail`/`actorEmail`, **`verifyAuditHashChain()` continues to pass 100%**.
   - **Read/export masking (`maskErasedPersonInAuditEntry` + `erasedAccounts` tombstone table):** for any historical `auditLogs.details` strings (e.g., `details.description` or `details.after.email` written prior to erasure), keep the immutable `details` JSON untouched in Postgres so `verifyAuditHashChain()` verifies every historical digest, and apply `maskErasedPersonInAuditEntry()` when serving audit trails or exporting Evidence Packs (`auditEvidencePack.ts`).
   - **New audit entries at deletion time:** pass `email: pseudonymiseEmailAddress(user.uid, salt)` (never raw `user.email`) when `accountDeletionService.ts` writes `WORKSPACE_DELETION_SCHEDULED` and `MEMBER_LEFT`.

## 4. Verification

See `src/tests/security-s15-person-erasure.test.ts` (executable against Postgres) for:
- Verification of current `deleteAccount` personal-collection erasure & sole-owner blocking.
- Proof that `pseudonymiseEmailAddress` + top-level `auditLogs` email replacement preserves `verifyAuditHashChain()` while removing actor emails, and `maskErasedPersonInAuditEntry()` redacts email strings in `details` on read/export.
