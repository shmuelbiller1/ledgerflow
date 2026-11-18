# Security incident response

Follow this page when a secret leaks, someone signs in who should not have, a customer reports
seeing data that is not theirs, or an outside integration (AI, email, webhooks) runs up unexpected
traffic. Follow the four ground rules in [README.md](README.md) first: write down what you see,
never edit ledger numbers in the database by hand, and involve the owner before changing deployment
settings or rotating live secrets.

## 1. Roles and escalation

| Role | Who | Owns |
|---|---|---|
| Incident owner | Repository / deployment owner | Live Vercel settings, Supabase dashboard, Stripe/Plaid/Resend keys, customer notification, legal reporting |
| Engineering lead | AI #1 (lead lane) | Server fixes in `src/server/`, database migrations in `supabase/migrations/`, emergency redeploys |
| Security support | AI #6 (security lane) | Evidence review, header/audit checks, CI scanners, regression tests (never changes posting code) |

Record four facts at the start of every incident (never paste passwords, raw API keys, or full card
numbers into notes, tickets, or GitHub issues):

1. **UTC timestamp** when the problem started and when it was spotted;
2. **Affected workspace ID(s)** and **user ID(s)**;
3. **Symptom and evidence** (`x-request-id` header, `auditLogs` entry IDs, `errorLogs` IDs);
4. **First containment action taken** and its UTC time.

---

## 2. Severity and response targets

| Severity | Examples | First containment |
|---|---|---|
| **SEV-1 (Critical)** | Cross-workspace data exposure, leaked production secret (`SESSION_SECRET`, `SYSTEM_SALT`, `STRIPE_SECRET_KEY`, `DATABASE_URL`), active account takeover | Immediately (pause or rotate secret within 30 minutes) |
| **SEV-2 (High)** | Single workspace API key (`lf_id_...`) leaked, forged/replayed webhook volume, unauthorized role or setting change | Revoke affected key/member within 2 hours; audit workspace changes |
| **SEV-3 (Medium)** | Runaway AI or API quota usage in one workspace, missing security header on preview/edge, high-severity dependency alert | Throttle or patch within 24 hours |

---

## 3. Playbooks

### A. Leaked workspace API key (`lf_id_...`) or deployment secret

1. **If it is a workspace API key (`lf_id_<workspaceId>_...`):**
   - Open the workspace → **API Hub** → revoke the key immediately (`apikey.revoke`), or have the
     key owner revoke it (`apikey.revokepersonal`). Verification: calling `/api/v1/transactions`
     with the old key returns HTTP `401`.
   - Open **Audit Trail** (or Admin → Audit Logs) filtered to that `workspaceId` and key owner's
     `userId` from the earliest possible exposure time.
   - Check the key owner's **Settings → Security**: re-verify two-step login, regenerate recovery
     codes, confirm notification emails are not set to `off`, and inspect `/api/v1/account/groups`
     for unexpected shared groups (see issue `#821`).
   - Check customer/vendor email addresses, active customer portal links, and payroll approval
     settings for unauthorized changes (see issue `#823`).
2. **If it is a platform secret in Vercel (`SESSION_SECRET`, `INVITE_SECRET`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `EMAIL_WEBHOOK_SECRET`, Gemini/Plaid credentials):**
   - Generate a fresh 32+ byte random secret (or roll the key in Stripe / Plaid / Resend / Google
     Cloud), replace the variable in **Vercel → Settings → Environment Variables**, and redeploy.
   - **Caution on `SYSTEM_SALT`:** `SecurityService` uses `SYSTEM_SALT` to encrypt stored banking
     tokens and verify forensic hashes. Before rotating `SYSTEM_SALT`, export a backup and plan
     re-encryption or bank-feed reconnection (see [bank-connection-breaks.md](bank-connection-breaks.md)).
   - After redeploy, run:
     - `NODE_ENV=production npx tsx scripts/check-prod-env.ts` (with the updated environment loaded
       locally, never echoed), and
     - `npx tsx scripts/check-security-headers.ts https://<your-domain>`
     - Check `/status` returns healthy across database, auth, email, and webhooks.
   - If the secret was ever committed to Git, treat it as permanently compromised even after
     removing the commit; revoke at the provider first.

### B. Suspected cross-workspace data exposure

1. Collect the exact URL, HTTP method, `x-request-id`, caller user ID, and both workspace IDs.
2. Reproduce only against a local test database (never against another customer's live books).
3. If an active endpoint leaks data across tenants, the owner disables or rolls back the offending
   Vercel deployment to the last known-good build while AI #1 prepares a server/RLS fix.
4. Query `auditLogs` and server request logs for the affected route and time window to list every
   workspace and record ID accessed. Preserve the log export before any retention window expires.
5. Verify the fix with `npm run test:rules`, `npm run test:security`, and
   `src/tests/security-s8-s38-s39-isolation.test.ts` before redeploying.
6. Assess notification duties (for example GDPR Art. 33 72-hour supervisory notice and affected
   customer notice where personal data was exposed).

### C. Compromised user account or unauthorized admin elevation

1. In Supabase Auth (or via server `authAdmin`), revoke the user's active refresh tokens / sessions
   and force a password reset.
2. Inspect `auth.users.raw_app_meta_data` for unexpected `"admin": true` flags and `workspaces` for
   newly added `members`, changed `roles`, or new `invites` and `apiKeys`.
3. Have the user re-enroll TOTP two-step login and generate a fresh set of recovery codes (confirm
   prior `auth.mfa_factors` entries).
4. Review every ledger entry, invoice, bill, payment, and customer portal link created by that
   `userId` during the exposure window. Reverse unauthorized postings through the app's normal
   void/reversal commands so the audit trail stays complete.

### D. Runaway AI spend, API flood, or webhook storm

1. Open **Admin Panel** (search in developer mode) → inspect workspace `computeCreditBalance`,
   `apiQuotaTotalCentsUsed`, `bypassBilling`, and live error counts.
2. For one runaway workspace: lower `apiQuotaMonthlyLimitCents`, set `bypassBilling` to `false`, or
   revoke the noisy API key.
3. For a global AI spike: rotate or temporarily unset the model provider key in Vercel so AI routes
   degrade cleanly without affecting bookkeeping, invoices, payments, or reports.
4. For webhook floods (`/api/webhook/stripe`, `/api/webhook/plaid`, `/api/webhook/email`): verify
   `400`/`401` rejection in logs; confirm `STRIPE_WEBHOOK_SECRET`, `EMAIL_WEBHOOK_SECRET`, and
   `PLAID_WEBHOOK_URL` match the provider dashboards.

---

## 4. Communication templates

### Internal incident log header

```text
Incident ID: INC-YYYY-MM-DD-01
Severity: SEV-1 | SEV-2 | SEV-3
Detected (UTC): YYYY-MM-DDTHH:MMZ
Contained (UTC): YYYY-MM-DDTHH:MMZ
Affected workspaces: <ids only, no customer secrets>
Summary: <what happened in plain language>
Immediate action taken: <key revoked / deployment rolled back / session signed out>
Follow-up issue: #<github-issue-number>
```

### Customer notification template (owner review required before sending)

```text
Subject: Security notice for your LedgerFlow workspace

Hello <Name>,

On <Date, Time UTC>, we identified <plain-language description of what occurred>
affecting workspace "<Workspace Name>".

What we did:
- At <Time UTC>, we <revoked the affected key / signed out sessions / deployed a fix>.
- We reviewed the workspace audit log from <Start UTC> to <End UTC>.

What was and was not affected:
- Affected: <exact records or settings, stated plainly>.
- Not affected: <confirmed unaffected records, stated only where verified>.

What you should do now:
- <Rotate integration key / reset password and confirm two-step login / review listed entries>.

Reply directly to this email with any questions; reference <INC-YYYY-MM-DD-01>.
```

---

## 5. Post-incident close-out checklist

- [ ] Root cause fixed on `main` and verified in production (`/status` + `scripts/check-security-headers.ts`).
- [ ] Regression test added so the same class of failure breaks CI.
- [ ] All temporary credentials, debug exports, and local copies deleted.
- [ ] Affected workspace audit trails checked; any fraudulent postings reversed properly (never edited in SQL).
- [ ] `docs/security/OWASP_ASVS_L1_CHECKLIST.md` and `docs/FOR_YOU.md` updated if launch risk changed.
