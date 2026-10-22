# D-99 · W14 roles and access — owner / accountant / bookkeeper / viewer

## Role matrix (from `docs/roles.md` and `src/hooks/useCurrentRole.ts`)
- owner (4) — everything, including team invites/role changes, billing, delete workspace, close periods, post, payroll, restore.
- accountant (3) — bookkeeper + close periods/locks + chart template + forensic reports.
- bookkeeper (2) — post tx/invoices/bills/payments, reconcile; cannot close periods or manage users.
- viewer (1) — read-only; view ledger/reports; cannot post, close, invite, run payroll, restore, apply template.

## Guard sources checked
- `src/server/http/requireRole.ts` / `LEDGER_WRITER_ROLES = owner,accountant,bookkeeper` → viewer 403 on `/transactions/bulk`
- `src/server/services/periodCloseService.ts` → close requires owner|accountant → 403 for bookkeeper/viewer
- `src/server/http/routes/payroll.ts` → pay-runs require owner|accountant → 403 for bookkeeper/viewer
- `src/server/http/routes/backup.ts` restore requires owner → 403 for others
- `src/server/http/routes/chartTemplate.ts` apply-template requires owner|accountant → 403 for bookkeeper/viewer
- Client `src/components/ui/RequireRole.tsx` — `disableOnly` shows inert wrapper + title tooltip "Only the workspace owner can invite…"; plain fallback shows amber banner "This action requires OWNER… your role is …"

## Browser journey
`e2e/w14-roles-access.spec.ts` signs in as each role to the same `w14-roles` workspace (owner-uid/accountant-uid/bookkeeper-uid/viewer-uid) and mounts real screens:

For each of 390px and 1280px, for each role in {owner, accountant, bookkeeper, viewer}:
1. **Team settings** (`TeamSettings.tsx`): owner sees enabled invite input and no inert wrapper; accountant/bookkeeper/viewer see `[title="Only the workspace owner can invite new members"]` and `[inert]` disabled RequireRole wrapper.
2. **Month-end close** (`MonthEndCloseView.tsx`): API `POST /periods/2026-01/close` → 200 for owner/accountant, 403 "Forbidden: requires one of roles [owner, accountant]" for bookkeeper/viewer.
3. **Ledger posting** `POST /transactions/bulk` → 403 "Only owners, accountants and bookkeepers change entries" for viewer, 200 for others.
4. **Payroll** `POST /pay-runs` → 200 for owner/accountant, 403 for bookkeeper/viewer.
5. **Restore** `POST /restore` → 200 for owner only, 403 "Forbidden: requires one of roles [owner]" for others.
6. **Chart template** `POST /apply-template` → 200 for owner/accountant, 403 for bookkeeper/viewer.
7. **RequireRole fallback** probe (without disableOnly) → owner sees "Owner action" button; others see amber banner "This action requires OWNER privileges… your current role is VIEWER/BOOKKEEPER/ACCOUNTANT".

Axe serious/critical 0 on the final probe (viewer amber banner) at each width.

All refusals checked with the exact server message strings the guards send, so the browser and the API agree on the refusal.

## Constraints
No server money logic changed; Vercel preview red is intentional.
