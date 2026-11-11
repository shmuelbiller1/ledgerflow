# AI #6 — S-22 rate-limit audit delta — 28 October 2026

**Status: bounded, source-pinned audit only. S-22 remains open.** No application or database code was changed, no production auth configuration was inspected, and this is not a whole-product launch audit or release-gate sign-off. It is a current-source correction and test record for the S-22 rate-limit lane. It does not duplicate AI #8's broader audit in [PR #424](https://github.com/shmuelbiller1/ledgerflow/pull/424).

## Snapshot and scope

- Reviewed application source at upstream `main` **`b4a92158dcd804438e4791e02c53594613f6c75f`**. The audit branch's pre-report merge commit is `100e9dbe831e6706a35f08c9f6898115c2350347`; both trees are `b6ff715761889b6059d66e6cfca03829a61485df`.
- Relevant source files were traced across Express registration, limiter identity, route authentication, API-key handling, and the browser's Supabase Auth calls. This is a 13-file, path-specific inspection; no total-function denominator or repo-wide review percentage is claimed.
- No production Supabase project settings, deployed proxy chain, live sign-in/reset traffic, or real user accounts were accessed. Provider-side rate limits may exist and remain **unverified**.
- Blob IDs below pin the reviewed code, independently of later documentation-only commits.

| File                                         | Reviewed source lines | Git blob at pinned tree                    |
| -------------------------------------------- | --------------------: | ------------------------------------------ |
| `server.ts`                                  |         69–85, 97–151 | `21fc601b90d752736727cdb90d68bd14b6dc7abb` |
| `src/server/middleware/rateLimiters.ts`      |   4–11, 46–75, 81–108 | `58f3b9fef7739ffe27a79aebb2f605b9e287d714` |
| `src/server/middleware/sharedRateLimiter.ts` |                49–128 | `b97bbb32e16030f7434e70eea658f4e777225f1f` |
| `src/server/routes/brainRoutes.ts`           |        18–25, 218–224 | `f6859b97edce3d7ae2e36c62e1895ec1593242e7` |
| `src/server/routes/developerApiRoutes.ts`    |               307–320 | `bb02666fb654c9c47cefc0254718a6e8327f1dac` |
| `src/server/routes/aiRoutes.ts`              |                 48–66 | `37571115b6f87560256965d5c521ad26af87a460` |
| `src/server/auth/apiAuthenticate.ts`         |        11–19, 147–204 | `1968880da1976fbb46fbe6665b66f09a0d5d29d4` |
| `src/server/routes/authRoutes.ts`            |                 11–61 | `ba3f3145df43368838883714af7ba6d4eff2223e` |
| `src/server/http/securityMiddleware.ts`      |                 14–35 | `4d88f6df33dda15629933286c4bf5d7cfb99fb38` |
| `src/App.tsx`                                |               274–322 | `a751a1ca6d63f4f100ed8ef4b89aed7616e7bf94` |
| `src/lib/db/auth.ts`                         |               224–299 | `578879dac5a4a2b41d9d1cac6bc0af56b7bc57b9` |
| `src/services/aiService.ts`                  |                 20–35 | `79b476c1af3ac6389b5f8f176a0d1f0cd6fad72a` |
| `src/components/intelligence/Copilot.tsx`    |               132–146 | `fb485c2f5f8590706bc74d4b3a141c24f2231d5c` |

## Verified findings

### S22-F1 — `/api/v1/brain/*` has a shared 20/minute IP bucket before identity is set

`server.ts` installs `brainRateLimiter` at `/api/v1/brain` before `registerBrainRoutes` and the developer route registration. The affected route declarations then run `apiAuthenticate` (`brainRoutes.ts` analyze/classify; `developerApiRoutes.ts` classify-batch). `apiAuthenticate` is what verifies a bearer/API-key credential and assigns `req.user`; no earlier middleware in `applySecurityMiddleware` authenticates the caller.

The limiter's selector prefers `req.user.uid`/`id` and falls back to `req.ip`, but at the mount point `req.user` is not yet set. Thus the shared PostgreSQL-backed `sharedBrainRateLimiter` actually keys this pre-auth gate by IP: `sharedRateLimiter.ts` sets it to 20 requests per minute, and the source comment in `rateLimiters.ts` also describes it as per-IP. The configured user-ID branch is unreachable at this mount for these routes.

**Observed local reproduction:** I mounted the actual `brainRateLimiter` before a synthetic auth middleware that assigned `user-A`, then `user-B`, on two POSTs from `127.0.0.1`. Both returned 200; PostgreSQL contained one `brain`-namespace counter with count 2 for the IP-derived hash (`rl_69ba885f66e82fe2df9b9a8b63be3757410ccbbcf402028081dd85e910d61ddc`) and no rows for either user-derived hash. This is a route-order harness, not a production-auth test. It confirms that different authenticated users sharing one IP consume the same pre-auth allowance; unauthenticated/invalid-token requests also reach this limiter before route auth.

**Existing protection that must not be omitted:** API-key requests to the `apiAuthenticate` routes get a second, key-specific `express-rate-limit` cap after key validation (`apiKeyRateLimiter`, default 120/minute, configurable 10–10,000). The database test confirms that an API key capped at 10 is refused on request 11 while another key remains independent. Human bearer-token requests do not pass through that API-key limiter. Neither fact makes the shared brain limiter per-user.

### S22-F2 — AI routes have generic IP caps, but no specialized shared per-user AI cap

The statement in merged [PR #404](https://github.com/shmuelbiller1/ledgerflow/pull/404) that `/api/ai` and `/api/v1/ai` “carry no limit at all” is too broad for the current `b4a9215` source:

- Requests to `/api/ai/*` and `/api/v1/ai/*` are subject to the app-wide `express-rate-limit` cap of 1,000 per 15 minutes per IP (`server.ts:79`; configured in `rateLimiters.ts:81–89`).
- Requests to `/api/v1/ai/*` are also subject to the generic 100/minute per-IP `apiLimiter` (`server.ts:97–98`; `rateLimiters.ts:101–107`).
- `/api/v1/brain/*` additionally receives the shared 20/minute IP limiter described above.
- `/api/ai` and `/api/v1/ai` mount the same `aiRouter` (`server.ts:150–151`). Its `/process` handler validates a Supabase bearer token internally, but no AI-specific per-user limiter is mounted or called. `/api/v1/ai` therefore has generic IP limits, not “no limit”; `/api/ai` has the global IP limit, not an AI-specific user limit. The generic `express-rate-limit` calls do not configure a shared Postgres store in this source.

### S22-F3 — the shared auth limiter is configured but not mounted on the browser auth flows

`authRateLimiter` is an exported middleware configured for five attempts per 15 minutes per IP, using the shared database limiter. Repository-wide route search found no mount or invocation of it. The server's `/api/v1/auth/*` handlers are session revocation, account deletion, and signed-in auth-audit recording; no email sign-in, signup, or password-reset route is registered there.

The visible email sign-in, account creation, verification resend, password reset, MFA challenge, and Google OAuth calls use the Supabase Auth client in `src/lib/db/auth.ts`; `src/App.tsx` invokes those wrappers directly. Therefore this unmounted server middleware does not protect those calls. **This does not establish that Supabase itself has no protection**: the project's provider-side rate-limit configuration and production behavior are outside this repository and were not inspected.

## Risk and proposed disposition

S-22 is **not complete** and should not be marked done based on the existence of `brainRateLimiter` or `authRateLimiter`. Current code does provide generic per-IP caps and API-key-specific limits; the verified mismatch is the absence of the requested authenticated-user limiter on human AI traffic, plus an auth limiter that is not wired to the browser's provider-hosted sign-in/reset flows.

This evidence does **not** prove a production exploit, a provider misconfiguration, or a P0 tenant/data-isolation failure. Treat the user-level control as an unresolved abuse-control requirement (candidate P2 from repository evidence alone; raise to a beta prerequisite if the owner confirms provider-side controls are absent or that per-user limits are mandatory). No `RELEASE_GATE.md` row is claimed or changed.

Recommended next decision for AI #1 / owner:

1. Verify the deployed Supabase Auth rate-limit settings and staging behavior for repeated failed sign-ins, signup/resend, and reset-email requests. Do not infer provider controls from client code.
2. Decide whether app-managed per-user AI limits are required for both AI routers. If yes, preserve a cheap pre-auth IP gate, then apply a shared authenticated-UID limit **after** identity verification; keep API-key identity separate. Add tests proving same UID across IPs shares a bucket, different UIDs do not share the user bucket, IP gating still applies to invalid credentials, and counters work across two app instances.
3. Do not change `src/server/` in this audit-only PR; the repository assigns that area to AI #1.

## Verification actually run

Environment: Node **24.12.0**, disposable local **PostgreSQL 18.4**, no production credentials. `HUSKY=0 npm ci --ignore-scripts` succeeded; npm reported 6 dependency advisories (4 low, 2 moderate), not remediated here.

| Check                                                                                   | Result                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:test-setup`                                                                 | Pass on a disposable local Postgres; plain-Postgres stub plus **46 migrations** applied. This verifies this local schema setup, not production migration state.                       |
| Six focused test files                                                                  | **18 pass, 0 fail, 0 skipped.** Includes the two-instance atomic shared-limit test, database outage fail-closed test, and API-key limiter test.                                       |
| Minimal Express/Postgres route-order harness using the exported `brainRateLimiter`      | Pass; two distinct synthetic UIDs on one IP incremented the same hashed IP key. This harness does not validate deployed auth or proxy settings.                                       |
| `npm run test:rules`                                                                    | **ALL RLS TESTS PASSED** on the disposable plain-Postgres test database. Not evidence of production RLS/migration state.                                                              |
| `npm run lint:types`                                                                    | Pass.                                                                                                                                                                                 |
| `npm run lint:eslint`                                                                   | Pass: **0 errors, 42 warnings** (the configured 42-warning cap).                                                                                                                      |
| `npm run build`                                                                         | Pass. Vite emitted existing third-party annotation/chunk-size warnings; esbuild completed.                                                                                            |
| Full `npm test` with the disposable database                                            | **Incomplete:** the unsharded command exceeded the sandbox's 30-minute command limit while still running; the orphaned test process was stopped. No full-suite pass/count is claimed. |
| Playwright/browser, timezone matrix, production Supabase Auth settings or live-auth E2E | Not run.                                                                                                                                                                              |

Focused invocation (with Node 24.12.0, `NODE_ENV=test`, the deterministic test salt, and both database URL variables set to the disposable local database):

```sh
npx tsx --test src/tests/shared-rate-limiter-postgres.test.ts src/tests/shared-rate-limiter-middleware.test.ts src/tests/api-key-rate-limit.test.ts src/tests/auth-gates.test.ts src/tests/brainAnalyze.test.ts src/tests/ai-gateway.test.ts
```

**Separate GitHub status context:** while reviewing, AI #8's PR #424 was open at head `89b5f0e3c6d8e625e983cadaf2a8aa5f02a55605`. Its CI typecheck/lint, database rules, unit shards, build, timezone shards, browser shards, CodeQL and SBOM checks were successful; the Vercel status was `FAILURE` with a Vercel authorization URL. This is a different branch and is not evidence for this audit. Consistent with the owner's note that automatic previews are paused, that Vercel status is not treated as a code/test failure.

The checked-in Code Atlas still points to source revision `74b8318bfba0983ecba05bfbe4c41494ff57a36e` (tree `b59c8d3970fb58361f7cdd3bb0459ec34388996e`), not this reviewed tree. `stats` and `validate` pass for that old snapshot only (2,141 indexed paths; 54 manually inspected; 82 unknown relationships); those numbers are **not** current-tree audit coverage and were not used to certify this slice.

## Scorecard

- **Pinned code revision:** upstream `main` `b4a92158dcd804438e4791e02c53594613f6c75f`; branch source tree matched at review start.
- **Coverage:** 13 relevant source files traced for S-22 routing/auth/limiting; no exhaustive function count, repo-wide percent, or other subsystem coverage claimed.
- **Verified source outcomes:** shared brain limiter is IP-keyed at its current pre-auth mount; generic IP limits exist on AI paths; API-key limiter exists after API-key auth; shared auth limiter is not mounted; browser sign-in/reset calls use Supabase Auth client.
- **Open/uncertain:** deployed Supabase rate settings; real proxy/IP behavior; full unit suite; browser and live-auth E2E; whether the owner requires per-user AI caps as a beta gate.
- **P0/P1 in this slice:** none proven from the evidence collected. S-22 remains an unresolved abuse-control requirement pending provider configuration and owner decision.
- **Next ten-function verification batch if S-22 proceeds:** `apiAuthenticate` bearer branch; `apiAuthenticate` API-key branch; `verifyIdToken`; `SharedRateLimiter.checkAndIncrement`; `sharedRateLimitMiddleware`; `brainRateLimiter`; `/api/v1/brain/analyze`; `/api/v1/brain/classify`; `/api/v1/brain/classify-batch`; `aiRouter.post('/process')`. In addition to those ten source units, the external gate is staging verification of Supabase sign-in/reset limits. Acceptance must prove shared-UID behavior across distinct IPs and two app instances.
