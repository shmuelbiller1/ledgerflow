# Remaining Sonar findings: evidence and owner handoff

Reviewed against `e7303c90ab3d45968e0d1f3858224ceb4e02486f` plus this branch. The uploaded `issues-2.json` contains 56 keys, all in the original 103-key inventory. This note records observations, not a fresh Sonar analysis or production/database test.

## Priority 1 — money-input validation can block the UI

Both `isAmountText` regexes flagged at `src/lib/moneyFormat.ts` (keys `AaGQnPI5E-Km-bl-69bS` and `AaGQnPI5E-Km-bl-69bT`) are reached with an input containing `'-'`, 400 spaces and `'!1'`. On Node 22.22.3 in this sandbox, each mode returned `false` only after roughly **1.95–2.08 seconds** in the warmed process. With 800 spaces, a 15-second external timeout stopped the process before the next result. Runtime is machine/engine dependent; these are observations, not a performance budget or upper bound. The input contains a digit and a single sign, so it passes the preliminary checks. Even a modest paste can stall a synchronous browser render or handler.

Reproduce **only with an external timeout**, since the expression blocks the event loop:

```sh
timeout 15s ./node_modules/.bin/tsx -e 'import {isAmountText} from "./src/lib/moneyFormat"; import {performance} from "node:perf_hooks"; for(const n of [100,200,400,800]) for(const complete of [true,false]) { const text="-"+" ".repeat(n)+"!1"; const t=performance.now(); console.log(n,complete,isAmountText(text,{complete,locale:"en-US"}),Math.round(performance.now()-t),"ms"); }'
```

**Owner action:** replace or guard both modes without changing accepted money formats or parse/rounding behavior. Test grouping separators, negative/parenthesized input, currencies, decimal-comma locales, Hebrew direction marks, partial typing, and bounded adversarial cases. A simple fixed input limit changes a financial input contract and should be decided explicitly by the owner.

## Priority 1 — uncertain posting replies can be retried with a new operation ID

`PettyCashView.tsx` and `LoansView.tsx` create the transaction ID and `x-operation-id` inside `postEntry` on each invocation. Both handlers retain the draft after an error. A retry therefore generates a different operation key; `transactions/crudRoutes.ts` scopes and replays a completed command by the supplied operation ID, so a different key cannot identify the first attempt as the same operation.

Two temporary component probes were run using the existing `loans-view.test.tsx` and `petty-cash-view.test.tsx` fixtures. Each mock recorded requests to `/api/v1/transactions`, rejected the first fetch to simulate a lost reply, returned 200 on the second click, and asserted that both requests had the same displayed transaction amount/reference or description but **different `x-operation-id` values**. Both probes passed (loan suite 5/5; petty-cash suite 8/8); no real server, database, commit or duplicate posting was exercised. If the first request committed before the reply was lost, the second can be treated as a new operation. This is independent of the collision risk from short `Math.random` IDs. The journal modal also generates a new ID on each submit and merits the same lost-reply review.

Loan payments have an additional boundary: `LoansView.tsx` posts the transaction and then separately calls `updateDoc` to record the installment. If that second write fails after a successful post, the catch path retains the retry opportunity; the owner should assess atomicity and recovery along with stable keys. This observation is code-path analysis, not a database reproduction.

**Owner action:** keep one cryptographically strong operation ID and an unchanged request for each pending intended write across uncertain outcomes, workspace switches and retries; distinguish truly new identical operations. Define the server replay/reconciliation behavior and the loan record update boundary. Add component and database tests that simulate commit-then-lost-response, changed drafts, definitive refusals and a post-success loan-update failure. Do not silently replace IDs without ensuring supported Node/browser runtimes and preserving idempotency fingerprints.

## Intent resolver mitigation, not complete remediation

Three of the four flagged entry-pattern sites now have necessary-condition prechecks: all entry patterns need a digit or comma, the split expression needs parentheses, and the leading-amount expression needs a Unicode letter under its original case-insensitive rules. The expressions and parsing/fallback order remain unchanged. The split-item expression is not changed, and adversarial inputs that satisfy the prechecks can still backtrack; normalization and multiple lines can also increase aggregate work. The 500-character guard measures the original line before normalization.

Local comparison of the prior and modified resolver on 20,000 deterministic mixed inputs (including Hebrew, malformed punctuation, Unicode combining marks, multiple lines and exception outcomes) matched exactly; this is evidence, not a proof of equivalence. Targeted regressions include comma-only error behavior, Unicode case folding, numeric descriptions, split amounts, and whole-input fallback. No financial posting or amount conversion was changed.

## Other dispositions and boundaries

- `pgFirestore.ts:561` uses `Math.random` only for non-security transaction backoff jitter. It is not a document ID or a source of amounts. No change recommended for that finding.
- The 10 MB single-file multer limit is bounded per authenticated request but not a proven aggregate concurrency or temporary-disk limit. Measure operational capacity and rate limits before changing it.
- The MD5 hashes provider request URL strings for cache keys, not passwords or signatures. Its collision impact and cache-key migration need a server-owner decision.
- Mailer's HTML-to-text tag regex runs in server code; its caller/input limits and worst-case behavior still need testing. Do not replace sanitization logic without preserving its repeated stripping behavior.
- The SDK and `serverAction.ts` fallback keys identify non-repeatable writes. Their collision and Node 18/no-Web-Crypto compatibility require owner review. The server telemetry fallback is still weak even though normal client error IDs now use Web Crypto.
- The 17 focusable scroll regions/grid, 11 signed 32-bit hash/PRNG coercions, ephemeral CI database credentials, test harness registrations, PostgreSQL null comparisons and required quoted identifiers were reviewed in the original inventory. Do not remove keyboard access, change 32-bit wraparound, or edit old migrations solely to silence the scanner.
- Git and ImageMagick executable lookup still require a trusted PATH. The attempted optional override was removed from PR #588 because changing those callsites created new Sonar security findings. Do not claim these two are resolved.
