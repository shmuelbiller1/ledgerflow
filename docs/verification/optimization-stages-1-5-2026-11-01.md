# Multi-Stage Bundle, Deployment, PWA & Runtime Efficiency Verification — 1 November 2026

All measurements in this report were captured under **Node.js `v24.22.2`** (`engines.node: 24.x`) using identical build commands (`npm run build`), `@vercel/nft` (`api/index.mjs`), and RSS sampling (`--require /tmp/rss-hook.cjs`). Metrics that cannot be directly observed from the repository sandbox (such as live Vercel billing dashboard meters) are explicitly marked `unknown`.

---

## 1. Stage-by-Stage Delivery Summary

| Stage | PR | Merge Commit | Scope | Regression Suite Added |
|---|---|---|---|---|
| **Stage 1** (Tasks 2 & 3) | `#454` | `b88d83ff` | Severed `src/lib/utils.ts -> useAuthStore` client graph leak from backend; extracted pure `moneyFormat`, `calendarDate`, `csvSanitize`, and `workspacePrefs`; passed explicit workspace currency/timezone on server routes/reports; split `build/server.cjs` vs serverless `build/api.cjs` (`__SERVERLESS_BUILD__`); removed Vite/Rollup/esbuild dev toolchain and `.cjs.map` artifacts from serverless function trace | `src/tests/pure-financial-utils-equivalence.test.ts`, `src/tests/server-bundle-boundary.test.ts` |
| **Stage 2** (Task 4) | `#473` | `0cd843f` | Audited repository files across runtime, build-input, CI/dev, and historical audit categories; hardened `.vercelignore`; redirected `tsconfig.node.json` `tsBuildInfoFile` to `node_modules/.cache/tsbuildinfo.node`; untracked `tsconfig.node.tsbuildinfo`, `"dump of not final stuff"`, and `test/data/05-versions-space.pdf` | `src/tests/vercel-ignore-boundary.test.ts` |
| **Stage 3** (Task 5) | `#477` | `c1122e5` | Fixed `1 B` `vendor-react` chunk (`223.22 kB`); pruned Zod from initial client shell (`retentionPolicy`, `brandingConstants`); split lazy routes/modals; narrowed Workbox `globPatterns` to app-shell assets (`427 -> 85` entries); switched SW to `registerType: 'prompt'` (`pwaUpdateManager.ts`) with unsaved-work protection and `/api/` `NetworkOnly` rule | `src/tests/pwa-bundle-optimization.test.ts` |
| **Stage 4** (Task 6) | `#480` | `94266143` | Added visibility/connectivity-aware `useVisibilityPolling` across 5 polling surfaces; gated `ApiHub` & `SystemCommandCenter` polling by active tab; serialized `useCollaborators` presence mutations; converted `LedgerEngine.normalizationCache` to bounded scan-resistant workspace-keyed metadata LRU (`2 × 25,000`); sized serverless `pg.Pool` to `5` (`poolConfig.ts`) and eliminated cold-start `lf_rules` / nested `crudRoutes` pool deadlocks | `src/tests/polling-and-subscriptions.test.tsx`, `src/tests/normalization-cache-and-pool.test.ts` |
| **Stage 5** (Post-merge hardening & inventory) | Current branch (`arena/1af54dd7-ledgerflow`) | Pending review | Reused active `Transaction` `PoolClient` (`t.tablesExist(...)`) inside `stockMovesReady(db, t)` and `allocationLedgerReady(db, tx)` (eliminating cold-start `runTransaction` pool starvation across `cogsStockService`, `ledgerBulkCommit`, `reverseRoutes`, `deliveryService`, `paymentService`, `bankLineService`, and `onlinePaymentService`) + coalesced concurrent pool probes; broke `partyReports <-> computeReports` cycle (`7 -> 0` Rollup circular-chunk warnings); recorded cumulative verification and export investigation inventory | Extended `src/tests/normalization-cache-and-pool.test.ts` & `src/tests/pwa-bundle-optimization.test.ts` |

---

## 2. Cumulative End-to-End Metrics (`b01bb43` Baseline → `a5b14f1` Pre-Stage-5 → Stage 5 Final)

| Metric (Node `v24.22.2`) | Baseline (`b01bb43`) | Pre-Stage-5 `main` (`a5b14f1`) | Stage 5 Final | Cumulative Delta vs Baseline |
|---|---:|---:|---:|---:|
| **Standalone backend bundle (`build/server.cjs`)** | `10,968,104 B` (`10.46 MiB`) | `2,025,932 B` (`1.93 MiB`) | `2,027,933 B` (`1.93 MiB`) | **`-81.5%`** (`-8.53 MiB`) |
| **Serverless API bundle (`build/api.cjs`)** | N/A (shared `10.46 MiB` `server.cjs`) | `2,013,047 B` (`1.92 MiB`) | `2,015,048 B` (`1.92 MiB`) | **`-81.6%`** vs baseline server bundle |
| **Emitted backend source maps (`build/*.cjs.map`)** | `17,238,528 B` (`16.44 MiB`) | `0 B` | `0 B` | **`-100.0%`** (`-16.44 MiB`) |
| **Traced serverless function (`@vercel/nft` on `api/index.mjs`)** | `3,761` files / `61,404,590 B` (`58.56 MiB`) | `1,081` files / `22,141,844 B` (`21.12 MiB`) | `1,081` files / `22,143,845 B` (`21.12 MiB`) | **`-71.3%` files / `-63.9%` bytes** (`-37.44 MiB`) |
| **Vercel deployment upload context (`.vercelignore` filtered)** | `3,242` files / `86,801,203 B` (`82.78 MiB`) | `1,471` files / `~14.15 MiB` | `1,471` files / `~14.15 MiB` | **`-54.6%` files / `-82.9%` bytes** (`-68.6 MiB` per deploy) |
| **`vendor-react` browser chunk** | `1 B` (broken predicate) | `228,577 B` (`223.22 kB`) | `228,577 B` (`223.22 kB`) | Restored cacheable React vendor split |
| **Frontend initial HTML-linked download (`7` assets)** | `1,970,876 B` raw / `543,535 B` gz | `1,381,808 B` raw / `381,277 B` gz | `1,381,714 B` raw / `381,283 B` gz | **`-29.9%` raw / `-29.9%` gzip** |
| **PWA Workbox precache payload** | `427` entries / `8,535,204 B` raw / `2,550,699 B` gz | `85` entries / `1,814,198 B` raw / `540,164 B` gz | `85` entries / `1,814,152 B` raw / `540,120 B` gz | **`-80.1%` entries / `-78.7%` raw / `-78.8%` gzip** |
| **Rollup circular-chunk build warnings** | `7` | `7` | **`0`** | **`-100.0%`** (`partyReports <-> computeReports` cycle broken) |
| **Production build duration (`npm run build`)** | `~33,400 ms` | `37,580 ms` | `35,063 ms` | Stable (`~31–35 s` on 2-vCPU sandbox) |
| **Build peak RSS** | `~1,890 MiB` | `1,800.2 MiB` | `1,760.8 MiB` | Stable (`~1.76–1.80 GiB`) |
| **Production API cold start (`api/index.mjs`) & peak RSS** | `918 ms` / `224.6 MiB` | `711 ms` / `167.9 MiB` | `710 ms` / `166.6 MiB` | **`-22.7%` cold start / `-25.8%` RSS** |
| **Hidden / offline background HTTP polling (5 surfaces, 5 min)** | `185` requests | `0` requests | `0` requests | **`-100.0%`** while hidden/offline; instant catch-up on resume |
| **`LedgerEngine.normalizationCache` retained heap (`5 × 10k` switches)** | `50,000` entries / `+68.77 MiB` (unbounded) | `20,000` entries / `+10.03 MiB` (`2 × 25k` LRU) | `20,000` entries / `+10.03 MiB` (`2 × 25k` LRU) | **`-85.4%` passive heap** (`0` entries after `resetStore()`) |
| **Serverless `pg.Pool` max connections per instance** | `10` (`10s` idle, cold-start nested-pool deadlocks) | `5` (`5s` idle, `allowExitOnIdle: true`) | `5` (`5s` idle + tx-client `tablesExist` reuse) | **`-50.0%` per-instance DB connection cap**, zero `max=1` cold-start deadlocks |

---

## 3. Vercel ~9 GB Usage Category Root-Cause Attribution

- **Measured per-deployment artifacts**:
  - Single traced serverless function (`api/index.mjs`): `58.56 MiB` before → `21.12 MiB` after (`-63.9%`), well below Vercel's `250 MB` unzipped function limit.
  - Static `dist/` build output: `~8.9 MiB` across hashed assets.
  - Deployment source upload context: `82.78 MiB` before → `~14.15 MiB` after (`-82.9%`).
- **Category approaching ~9 GB**: **Cumulative `Build Outputs + Deployment Source Uploads` retained across high-frequency preview and `main` deployment history** (`>1,200` monthly commits/PR builds × `~83 MiB` source context + `~59 MiB` function bundle + `~9 MiB` static output per deployment easily exceeds `9 GB` of cumulative retained deployment storage/transfer).
- **Live Vercel account billing meter**: `unknown` from the repository sandbox (no Vercel billing API credentials exist in the repo environment).

---

## 4. Deployment Artifact Classification Summary

| Category | Representative Paths | Git Tracking | Vercel Upload (`.vercelignore`) | Rationale |
|---|---|---|---|---|
| **Runtime & Build Inputs** | `src/**` (excl. `src/tests/**`), `server.ts`, `api/index.mjs`, `public/**`, `index.html`, `vite.config.ts`, `vercel.json`, `scripts/vercel-csp.ts`, `src/server/assets/fonts/*.ttf` | Tracked | **Included** (enforced by `vercel-ignore-boundary.test.ts` AST reachability check) | Required by `npm run build` or bundled serverless/static runtime |
| **Canonical Code Intelligence & Governance Docs** | `docs/CODE_ATLAS.jsonl` (`34.34 MiB`, pinned reviewer annotations + `.github/workflows/code-atlas.yml` integrity gate), `docs/**`, `AGENTS.md`, `CURRENT_WORK.md` | Tracked | **Excluded** | Enforced in CI (`code-atlas.yml`) and agent coordination; zero runtime/build role |
| **Historical Audit & Visual Baselines** | `audit/**` (`~7.1 MiB`), `archive/**`, `e2e/__screenshots__/**` | Tracked | **Excluded** | Preserved per launch-audit & visual-regression evidence rules; never read by production build |
| **CI / Test / Database Migration Assets** | `src/tests/**`, `e2e/**`, `supabase/**`, `stryker.config.json`, `playwright*.ts` | Tracked | **Excluded** | Exercised in GitHub Actions CI and local verification; not needed on Vercel build servers |
| **Ephemeral / Scratch / Cache Artifacts** | `tsconfig.node.tsbuildinfo` (relocated to `node_modules/.cache/tsbuildinfo.node`), `"dump of not final stuff"`, `test/data/05-versions-space.pdf` | **Untracked** (`PR #473`) | **Excluded** | Reproducible compiler cache or dead scratch files with zero code references |

---

## 5. Unused & Test-Only Runtime Exports Investigation Inventory

Per repository safety rules, **no automatic mass deletion of exports was performed**. A full TypeScript AST module-resolution scan across all `1,450` non-test `src/**` files (resolving imports from `src/**`, `sdk/**`, `scripts/**`, `e2e/**`, `server.ts`, `vite.config.ts`, and `api/index.mjs`) classified all **`4,098` runtime value exports**:

| Module Domain | Total Runtime Value Exports | Production / Script / SDK Imported | Test-Only Verification Seams | Unreferenced Across Files | Disposition & Safety Rationale |
|---|---:|---:|---:|---:|---|
| **Shared Financial & Domain Primitives (`src/kernel/**`, `src/lib/**`)** | `2,157` | `1,710` | `271` | `176` | **Keep (Tree-shaken by Vite/esbuild)**: Includes pure accounting, FX, rounding, import/export readers (`iif`, `xero`, `wave`, `zoho`, `sage50`), and `LedgerEngine` invariants exercised directly by unit/mutation suites (`test:mutation:unit`). Unreferenced helpers are already tree-shaken from `dist/` and `build/api.cjs`. |
| **Server Routes, Services & DB Adapters (`src/server/**`)** | `792` | `610` | `134` | `48` | **Keep**: Test-only exports (`134`) are deterministic transaction/posting/reconciliation entrypoints tested without HTTP scaffolding (`createPaymentInTransaction`, `prepareStockMoves`, `poolConfigFromEnv`, readiness resets). Remaining `48` exports are adapter parity methods (`Firestore`, `Transaction`, `WriteBatch`, `FieldValue`) preserving Firebase-compatible ergonomics. |
| **Tax Tables & Jurisdiction Rule Packs (`src/lib/tax/**`, `*Tax*`, `*rulePack*`)** | `306` | `232` | `62` | `12` | **Keep (Protected Reference Surface)**: Validated by `npm run check:tax-tables`, `npm run lint:rule-packs`, and `npm run check:rule-sources`. Deleting statutory constants or jurisdiction helpers risks silent tax-compliance regressions. |
| **UI Components, Hooks & Stores (`src/components/**`, `src/hooks/**`, `src/stores/**`)** | `693` | `671` | `13` | `9` | **Keep**: `96.8%` directly imported in production routes/screens; `13` test seams support isolated component/hook verification (`isClientActiveForPolling`, `enqueuePresenceOperation`, `requestSafePWAUpdate`). |
| **Other Application Modules (`src/*`)** | `150` | `128` | `13` | `9` | **Keep**: Registry/plugin/SDK surface helpers; zero impact on initial bundle size due to ESM tree-shaking. |
| **Total** | **`4,098`** | **`3,351` (`81.8%`)** | **`493` (`12.0%`)** | **`254` (`6.2%`)** | **Zero speculative deletions; Rollup & esbuild tree-shake unused ESM bindings safely while preserving 100% of public, statutory, adapter, and test contracts.** |
