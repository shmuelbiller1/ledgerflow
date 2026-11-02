# Stage 6 Verification Report — Deep Forensic Vercel, Serverless Trace & Bundle Footprint Reduction

- **Date**: `2026-11-02`
- **Branch**: `arena/4984c23f-ledgerflow` (`PR #486`)
- **Baseline Commits**:
  - Original pre-optimization baseline: `093cdcf6` (`main` prior to Stage 1 `PR #454`)
  - Stage 6 immediate `Before` baseline: `31a54141ee60e916585196fc0832162ac20815b4` (`main` after Stage 5 `PR #483`), fast-forwarded cleanly onto `a55cbc82` (`PR #484`)
- **Runtime & Measurement Environment**: Node `v24.22.2` (`@vercel/nft@0.29.2`, Linux x64 sandbox, peak RSS sampled at 25 ms intervals + process `exit`)

---

## 1. Forensic Root-Cause Findings Addressed in Stage 6

1. **Unbundled `--packages=external` Serverless Trace Inflation (`21.12 MiB` / `1,081` files -> `8.50 MiB` / `53` files)**:
   - Because `build/api.cjs` previously compiled with `--packages=external`, `@vercel/nft` had to trace whole third-party packages across `node_modules/`, pulling in `node_modules/plaid/dist/api.js` (`8.66 MiB` unminified OpenAPI monolith), both `.cjs` (`839.9 KiB`) and `.mjs` (`835.9 KiB`) copies of `@google/genai` (`1.64 MiB`), `194` `stripe` files including `TestHelpers` (`1.01 MiB`), `96` `zod` files including unused locales (`0.97 MiB`), `3x` duplicate `mime-db/db.json` copies (`562 KiB`), and `84` `jose` files.
   - Bundling pure-JS backend dependencies with esbuild (`--target=node24 --external:pdfkit --external:pg-native --minify-syntax --minify-whitespace`) while keeping `pdfkit` external for font-engine asset compatibility cuts `@vercel/nft` by **`-95.1%` files (`1,081 -> 53`)** and **`-59.7%` bytes (`21.12 MiB -> 8.50 MiB`)**, while accelerating serverless cold-start import by **`-31.1%` (`628.1 ms -> 432.9 ms`)** and cutting cold-start RSS by **`-26.2 MiB` (`162.9 MiB -> 136.7 MiB`)**.

2. **Server-Side `@supabase/supabase-js` Umbrella Elimination (`src/server/storage/supabaseStorage.ts`)**:
   - `supabaseStorage.ts` was the sole server importer of `@supabase/supabase-js`, pulling `@supabase/auth-js`, `@supabase/realtime-js`, `@supabase/postgrest-js`, and `ws` (`~892 KiB` raw) into the backend solely to call `.list()` and `.remove()` on Supabase Storage.
   - Switched `supabaseStorage.ts` to Supabase's official standalone `StorageClient` from `@supabase/storage-js` (preserving legacy JWT `service_role` Bearer headers, modern `sb_secret_` / `sb_publishable_` `apikey`-only headers, 1,000-item pagination, 1,000-key batch deletion, and `StorageNotConfiguredError`), and locked `@supabase/supabase-js`, `@supabase/auth-js`, `@supabase/realtime-js`, and `@supabase/postgrest-js` out of the server bundle in `src/tests/server-bundle-boundary.test.ts`.

3. **Initial Frontend Bootstrap Decoupling (`assets/app-[hash].js`: `459.17 kB -> 193.33 kB`, `-57.9%`)**:
   - Two leaf imports (`InitializationScreen.tsx -> SYSTEM_GLOSSARY` and `useUIStore.ts -> reportPreferences.ts -> REPORT_TABS_REGISTRY / SCREEN_TABS_REGISTRY / SETTINGS_TABS_REGISTRY`) pulled the entire `src/config/registry.tsx` (`71.6 KiB`) plus English/Hebrew screen-help prose (`screenHelp.ts` `67.2 KiB` + `screenHelpHe.ts` `32.1 KiB` = `99.3 KiB` of screen-help prose, `170.9 KiB` combined with `registry.tsx`) into the initial HTML bootstrap chunk before `RootLayout` even mounted.
   - Extracted `src/config/systemGlossary.ts` (re-exported by `registry.tsx`), `src/config/pluginDiscovery.ts` (shared Vite plugin route discovery), and `src/config/routeIds.ts` (including dynamically discovered plugin route IDs, enforced 1-to-1 with `registry.tsx` in unit tests), and moved `decimal.js` into long-term cached `vendor-utils`.

4. **Chart `d3` Submodule Tree-Shaking & `package.json` Hygiene**:
   - Replaced umbrella `from 'd3'` imports in `AccountIcicle.tsx` and `ChartExploration.tsx` with direct `d3-hierarchy` and `d3-shape` imports and narrowed `vite.config.ts` (`optimizeDeps.include` + `vendor-viz`), trimming `320` unused modules from the Vite production graph (`5,157 -> 4,837` modules) and shrinking `vendor-viz` from `493.95 kB` to `465.36 kB`.
   - Removed 6 unused `@radix-ui/react-*` packages with zero repository imports (`react-checkbox`, `react-dialog`, `react-dropdown-menu`, `react-select`, `react-tabs`, `react-tooltip`) plus the unused `d3` / `@types/d3` umbrella packages, and moved build-only `vite`, `@vitejs/plugin-react`, and `@tailwindcss/vite` from `dependencies` to `devDependencies` (`74` fewer installed packages in `node_modules`).

---

## 2. Before vs After Measurements (Node `v24.22.2`)

| Metric | Original Baseline (`093cdcf6`) | Stage 6 Before (`31a54141`) | Stage 6 After (`arena/4984c23f-ledgerflow`) | Stage 6 Delta | Cumulative vs Original |
|---|---:|---:|---:|---:|---:|
| **Traced serverless function (`@vercel/nft` on `api/index.mjs`)** | `2,922` files / `61,404,590 B` (`58.56 MiB`) | `1,081` files / `22,143,845 B` (`21.12 MiB`) | **`53` files / `8,917,507 B` (`8.50 MiB`)** | **`-1,028` files (`-95.1%`) / `-13,226,338 B` (`-59.7%`)** | **`-2,869` files (`-98.2%`) / `-52,487,083 B` (`-85.5%`)** |
| **Backend bundle (`build/api.cjs` / `build/server.cjs`)** | `10,968,104 B` *(unbundled ext, leaked UI+Vite)* | `2,015,048 B` / `2,027,933 B` *(unbundled `--packages=external`)* | **`6,950,077 B` / `6,960,054 B`** *(self-contained minified; unbundled source graph `2,013,412 B`)* | Self-contained (`-12.61 MiB` / `-13,226,338 B` net traced function weight) | **`-85.5%` net serverless package** |
| **Frontend initial download (`index.html` + initial JS/CSS, `7` files)** | `1,970,876 B` raw / `543,535 B` gz | `1,381,714 B` raw / `381,283 B` gz (`app-*.js`: `459.17 kB`) | **`1,148,684 B` raw / `312,055 B` gz** (`app-*.js`: **`193.33 kB`**) | **`-233,030 B` raw (`-16.9%`) / `-69,228 B` gz (`-18.2%`)** (`app-*.js`: **`-57.9%`**) | **`-822,192 B` raw (`-41.7%`) / `-231,480 B` gz (`-42.6%`)** |
| **PWA precache (`dist/sw.js`)** | `277` entries / `8,535,204 B` raw / `2,550,699 B` gz | `85` entries / `1,814,152 B` raw / `540,120 B` gz (`vendor-viz`: `493.95 kB`) | **`86` entries / `1,822,777 B` raw / `543,914 B` gz** (`vendor-viz`: **`465.36 kB`**, **`-28.59 kB`**) | `+8,625 B` raw (`+0.5%`) / `+3,794 B` gz (`+0.7%`) | **`-6,712,427 B` raw (`-78.6%`) / `-2,006,785 B` gz (`-78.7%`)** |
| **Build duration & Peak RSS (`npm run build`)** | `35,210 ms` / `~1,810 MiB` | `31,317 ms` / `1,827.2 MiB` (`5,157` Vite modules) | **`29,063 ms` / `1,721.4 MiB`** (**`4,837` Vite modules**) | **`-2,254 ms` (`-7.2%`) / `-105.8 MiB` (`-5.8%`)** | **`-6,147 ms` (`-17.5%`)** |
| **Serverless API cold-start (`import("./api/index.mjs")`)** | `918.0 ms` / `224.6 MiB` RSS | `628.1 ms` / `162.9 MiB` RSS | **`432.9 ms` / `136.7 MiB` RSS** | **`-195.2 ms` (`-31.1%`) / `-26.2 MiB` (`-16.1%`)** | **`-485.1 ms` (`-52.8%`) / `-87.9 MiB` (`-39.1%`)** |
| **Standalone prod HTTP boot (`build/server.cjs` -> `/api/health` 200)** | `~920 ms` / `~225 MiB` RSS | `642.7 ms` / `158.7 MiB` RSS | **`438.9 ms` / `132.9 MiB` RSS** | **`-203.8 ms` (`-31.7%`) / `-25.8 MiB` (`-16.3%`)** | **`-52.3%` time / `-40.9%` RSS** |

---

## 3. Vercel ~9 GB Usage Attribution

- **Live Vercel billing/dashboard meter**: `unknown` from repository-only inspection (Vercel dashboard telemetry is required to confirm the exact billing line item).
- **Measured per-deployment artifact footprint after Stage 6**:
  - Traced serverless function (`api/index.mjs` via `@vercel/nft`): **`8.50 MiB`** (`53` files, down from `58.56 MiB` originally and `21.12 MiB` after Stage 1).
  - Static frontend `dist/` output: **`~8.6 MiB`**.
  - `.vercelignore`-filtered source upload context: **`~13.5 MiB`**.
- **Hypothesized categories approaching ~9 GB (pending Vercel dashboard confirmation)**: Because a single deployment's combined build output (`~17.1 MiB` total static + serverless function) and source upload (`~13.5 MiB`) are each well under `20 MiB`, a ~9 GB meter cannot come from a single deploy; the primary repository-consistent hypotheses are **cumulative `Build Outputs` / `Deployment Source Uploads` retained across high-frequency CI/preview deployments** (`>1,200` historical commits/deployments) or **`Fast Origin Transfer` / `Function Invocations`** across repeated preview traffic, with Vercel Usage dashboard data required to confirm which line item dominates. Independently of dashboard billing attribution, cutting the traced serverless function from `58.56 MiB -> 21.12 MiB -> 8.50 MiB` (`-85.5%` cumulative) directly reduces per-deploy serverless artifact footprint and cold-start unpacking overhead.

---

## 4. Verification Gates Executed

- `npm ci --dry-run --ignore-scripts`: **PASS**
- `npm run lint:types` (`tsc --noEmit`): **PASS (`0` errors)**
- `npm run lint:eslint` (`eslint . --max-warnings 42`): **PASS (`0` errors, `42` warnings; `0` warnings on all touched/added files)**
- `npx tsx scripts/bug-patterns.ts --check`: **PASS**
- `npm run check:tax-tables`: **PASS (`54` modules, `32` tables, `1,149` rows, `0` problems)**
- `npm run lint:rule-packs`: **PASS (`584` rules, `0` problems)**
- `npm audit --audit-level=high`: **PASS (`0` high/critical vulnerabilities)**
- `src/tests/quality-ratchet.test.ts`: **PASS (`filesOver800 = 0`)**
- `npm run test:bundle` (`LF_REQUIRE_BUILT_DIST=1` post-build invariant suite: `server-bundle-boundary.test.ts`, `pwa-bundle-optimization.test.ts`, `stage6-footprint-optimization.test.ts`, plus `vercel-ignore-boundary.test.ts`, wired into `.github/workflows/ci.yml`'s `build` job): **PASS**
- `scripts/db-test.ts setup && scripts/db-test.ts rls` (PGlite 48 migrations + RLS policy suite) & `src/tests/document-pdf.test.ts` (`15/15` incl. DB-backed PDF branding preview): **PASS**
- Full CI Unit Shards `1/4..4/4`, Timezone Shards (`America/Los_Angeles` `1..3`, `Pacific/Auckland` `1..3`), Coverage Gate (`lines 77.07%`, `branches 77.91%`, `functions 77.78%`), Playwright Browser Shards `1/5..5/5`, and `Playwright E2E Smoke Suite`: **PASS**
