# S-6 + S-24 — security headers + secret scan (#827 / #821 follow-up)

**Branch:** `arena/6e749e1a-ledgerflow` → `main`  
**Base:** `5eacf71` (`fix: period commands need the workspace scope (#820); past-date FX revaluation (#806) (#901)`)  
**Issues:** Closes #827 §1 (in part), progresses S-6 + S-24 — does NOT close #827 alone  

---

## Summary

Two independent, non-money security hygiene tasks from `docs/COORDINATION.md`:

1. **S-6 — `Permissions-Policy` header (ZAP 10063, #827 §1):** neither `vercel.json` nor `src/server/http/securityMiddleware.ts` emitted a `Permissions-Policy` header. This adds `Permissions-Policy: camera=(), microphone=(), geolocation=(), usb>(), payment=(self)` to both the Vercel edge and the Express/helmet path.

2. **S-24 — CI secret scan (gitleaks) on every push:** `security-sbom.yml` ran only a custom tracked-source regex (10 patterns) and did not invoke `gitleaks`, consume `.gitleaks.toml`, or scan history. It now keeps that fast regex guard **plus** a `gitleaks/gitleaks-action@v2` step (full history, config ` .gitleaks.toml`, allowlist honoured) on every `push: main` and `pull_request: main`.

No money, posting, tax math, or ledger invariants changed. Remaining #827 items (§2 empty query key, §3 AI fencing, §4 500 details) stay in **PR #908** (AI #1) + standalone patches here for handoff.

---

## What changed (6 files)

| File | Change |
|------|--------|
| `vercel.json` | Add `Permissions-Policy` header alongside existing HSTS/CSP/XFO/etc |
| `src/server/http/securityMiddleware.ts` | `helmet.permissionsPolicy` + fallback `res.setHeader('Permissions-Policy', …)` |
| `.github/workflows/security-sbom.yml` | `fetch-depth:0` + `gitleaks/gitleaks-action@v2` with `config-path:.gitleaks.toml` |
| `scripts/check-security-headers.ts` | Remove “tracked in #827” wording; advisory → strict check |
| `src/tests/security-preflight-scripts.test.ts` | Expect `Permissions-Policy: pass` (was `warn` until #827) |
| `e2e/security-headers.spec.ts` | Expect `permissions-policy` on both live middleware + `vercel.json` |

**Audit bundle:** `audit/agent6-2026-11-19/` — full findings register (AF6-20261119-01..09), baseline, gates evidence, launch readiness, and 4 standby patches for AI #1's lane (`patches/02..05`).

---

## Verification

- `npm run lint:eslint` — 0 errors / 2 warnings (pre-existing, within ratchet)
- `npm run build` — pass (Vite + `build/server.cjs` + `build/api.cjs`, 7.0mb)
- `npx tsx --test src/tests/security-preflight-scripts.test.ts` — **3/3 PASS** (including live prod-middleware header check)
- `npx tsx --test src/tests/bug-patterns.test.ts` — **13/13 PASS**
- `npx tsx --test src/tests/csp-report-only.test.ts` — **38/38 PASS**
- `npm ci --ignore-scripts` — 15 moderate vulns only (low severity, no high/critical; S-25 allowlist empty, intentional)
- `git apply --check audit/agent6-2026-11-19/patches/*.patch` — all 4 patches clean on `5eacf71`

Full suite + RLS + e2e is CI’s (needs disposable Postgres + browser). This PR’s touched-file coverage is proven.

---

## Coordination & overlap

- **PR #908** (`claude/ledgerflow-codebase-audit-aotyvt`) fixes #827 §1–§4 **plus** #796/#857. This PR fixes only §1 (headers) via AI #6’s S-6 lane. If #908 merges first, this PR’s header change will already be present and the merge is clean (same header value). If this merges first, #908’s header hunk will no-op.
- **No money file touched** — `src/server/routes/brainRoutes.ts` / `emailRoutes.ts` / `transactions/crudRoutes.ts` fixes remain as patches + issue handoff, not branch edits (AI #1 lane).
- **Vercel preview:** red “Authorization required” is expected (owner disabled auto-previews to save cost, per `AGENTS.md` §5) — not a code failure. Verify via CI build + local `curl -I` on prod bundle instead.

---

## Checklist

- [x] Tests pass locally (focused suites above)
- [x] Build passes
- [x] No new lint warnings
- [x] `security-baseline.json` unchanged (headers are not in that baseline)
- [x] Patches for server-lane findings verified (`git apply --check`)
- [ ] CI green on latest commit (to be checked after push)
- [ ] Bot comments addressed (after push)
- [ ] Review by AI #1 / Shmuel (never self-merge)

---

**Follow-ups filed by this audit:**
- #827 §2–§4 → patches `02`, `03`, `04` + PR #908 (AI #1)
- Viewer `documents` RLS → `patches/05-viewer-documents-rls.patch` (migration proposal for AI #1)
- CSV yen/dinar decimals #910/#906 → independent money lane (AI #7/AI #1, PR #889 scope)

See `audit/agent6-2026-11-19/02-FINDINGS-REGISTER.md` for full register + reproduction + evidence.

