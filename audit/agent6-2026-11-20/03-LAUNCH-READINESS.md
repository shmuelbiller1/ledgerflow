# Launch-readiness slice — Agent #6 — 2026-11-20

**Assessor:** Agent #6 (security lane). **Pinned revision:** `d1f2c8d` + this branch.
**Standard applied:** `docs/RELEASE_GATE.md` (14 workflows: connected / verified with worked figures /
browser-tested) and `docs/FIRST_TESTERS_GATE.md`. This is a **security-perimeter slice**, not a
whole-product certification; it does not re-certify US/IL payroll, inventory costing or bank sync.

---

## Verdict for the security perimeter: **CONDITIONALLY READY** for invited testers on synthetic data;
**NOT READY** for real customer money until the P0 list below is closed.

The four defects closed on this branch were all real, all reachable without any privileged position, and
none of them was in the money/posting lane — which is the part of the perimeter this agent can actually
fix rather than report.

---

## What this branch changes about the perimeter

| Area | Before | After |
|------|--------|-------|
| CSV exports (every screen) | Formula injection blocked only when the formula was the very first character | Blocked behind the whitespace a spreadsheet skips (space, NBSP, ZWSP, BOM); round-trip unchanged; guard covers the inverse direction too |
| Public token pages | `index, follow` + `robots.txt Allow: /` | `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` on all four prefixes at the edge (`vercel.json`, first response) + the same directive on the page meta before render + `robots.txt` blocking only `/api/` (token pages stay fetchable so the `noindex` is readable) + a guard that a new token route, a re-disallowed prefix or a lost header fails the build |
| Client error reporting | A second, inline path that POSTed raw stacks to a route that does not exist, without consent | One path: the app's own tracker (consent, redaction, de-dupe, scope-clear), started before the first render |
| CSP bookkeeping | Report-Only policy pinned a hash for an inline script | No inline scripts ship; no stale hash; preflight rule requires the Report-Only `script-src` to drop `'unsafe-inline'` |

## P0 — blocks real customer books (owner or server lane)

1. **#941 (Critical/High)** — a workspace `write:transactions` API key can read `loginAudits`, revoke
   sessions and delete the creator's `auth.users` account through `/api/v1/auth/*`; `legacyRoute: true`
   bypasses `aal2` on `workspace.restorebackup`. *Server lane.*
2. **#942 (High)** — headerless retries double-post money on `/transactions`, `/payments`,
   `/transactions/intercompany/post`; `payout-run` loops Stripe outside `executeCommand`. *Server lane.*
3. **AF6-20261120-01 (this session, Medium)** — the workspace CSV export writes unguarded formulas and
   wrong-currency amounts; patch ready. *Server lane.*
4. **#944 / #943 / #945** — personal data left behind by `deleteAccount()`; platform-admin audit gaps;
   login-anomaly alerts, post-auth AI rate limiting, per-session revocation. *Server/DB lane.*
5. **Owner actions** (unchanged, `docs/FOR_YOU.md`): rotate the four generated secrets, set
   `DATABASE_CA_CERT`, turn Vercel Deployment Protection off for Production, email provider + Stripe live
   keys, Supabase PITR on, one restore drill with dated evidence.

## P1 — before claiming "secure" to a customer or auditor

- `X-Robots-Tag: noindex` on `/i/*`, `/c/*`, `/e/*`, `/invite/*` at the edge/server (the client half is
  done here; this is the half a crawler cannot ignore).
- Flip CSP from report-only to enforce (`CSP_TIGHTEN=enforce`) once the admin report summary is empty
  across a real week of traffic; it is a one-variable change and the policy is already tested.
- A human pen-test against a deployed preview (not the live site), mapped to
  `docs/security/OWASP_ASVS_L1_CHECKLIST.md`.
- `security-audit-allowlist.json` stays empty: the moment a production advisory appears, it needs an
  owner and an expiry, not a quiet waiver.

## What this report is not

- Not a whole-product launch certificate, and not a re-assessment of the nine stage-A workflows.
- Not live-environment evidence: no production database, no deployed headers, no backup attestation.
- No production data was read or changed; no live-site scan was performed (SEC-SCAN-1 owner rule).
