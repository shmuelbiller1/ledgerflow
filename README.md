# LedgerFlow

## License

LedgerFlow is **source-available, not open source**. It is licensed under the [PolyForm Strict License 1.0.0](LICENSE.md), which permits limited noncommercial use but does **not** permit distribution, modifications, or commercial deployment. Commercial use, resale, managed hosting, or other public business offerings require separate written permission from the copyright holder. The public repository is not permission to commercialize LedgerFlow.


LedgerFlow is double-entry bookkeeping for small businesses and their accountants, built with TypeScript, React 19 and Vite. It covers the main path: books, bank, money in and out, labels, payments, reconciliation (LedgerFlow suggests matches, a person confirms), reports that explain each figure, period close, and backup and restore. Several companies can be grouped and seen side by side; full consolidation is not there yet.

**What works today, with its limits and the tests behind it: [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md).** Where this README says more than that table, the table is right.

---

## 🛠 Tech Stack & Environment

- **Frontend:** React `^19.0.0`, Vite `^6.2.0`, TypeScript `~5.8.2`, Tailwind CSS `^4.1.14`
- **State Management:** Zustand `^5.0.14`
- **Database & Auth:** Supabase — Postgres with row level security, Supabase Auth (email + password, Google, authenticator-app two-step login), Realtime. The app keeps a Firestore-style data API on top (`src/lib/db/` in the browser, `src/server/db/pgFirestore.ts` on the server).
- **Backend Server:** Express `^5.2.1`, Node.js (TypeScript via `tsx` and bundled with `esbuild`)
- **Payments & Billing:** Stripe `^22.2.1`
- **Banking Integrations:** Plaid `^42.2.0`, `react-plaid-link` `^4.1.1`
- **Document Generation:** PDFKit `^0.20.2` (custom native PDF stream engine with `/api/v1/workspaces/:workspaceId/documents/:type/:id/pdf`)
- **Visualization:** Recharts `^2.15.1`, D3 `^7.9.0`
- **Animations:** Motion `^12.23.24` (`motion/react`)

---

## 🏛 Three-Layer System Architecture

LedgerFlow strictly separates data, computation, and rendering into three decoupled layers:

### Layer 1: Data Source of Truth (Zustand & Supabase Postgres)
- All client-side runtime ledger state is managed via `useLedgerStore` (`src/stores/useLedgerStore.ts`).
- Canonical data lives in **top-level collections** (`transactions`, `chartAccounts`, `invoices`, `bills`, `projects`, `recurring`, `bankLines`, `auditLogs`), one Postgres table each (`supabase/migrations/`), scoped strictly by `workspaceId`.
- No nested subcollections are used.

### Layer 2: Pure Math Financial Algorithms (`src/lib/algorithms/`)
- Financial formulas are 100% pure math functions that never fetch external data or mutate state.
- Each algorithm implements the `AlgorithmDefinition` interface, taking `AlgorithmContext` (`transactions`, `accounts`, `period`, `asOfDate`, `reportingCurrency`) and inputs to produce `{ metrics, charts, insights }`.
- Central registry: `FINANCIAL_ALGORITHMS` (`src/lib/algorithms/index.ts`).

### Layer 3: Dynamic Views, Registries & Plugins (`src/config/registry.tsx`)
- Views are modular React components registered lazily in `VIEW_COMPONENTS` and categorized under `NAV_GROUPS`.
- Zero-configuration plugin discovery via `src/plugins/` using `import.meta.glob`.
- Interactive operational documentation available via the Help Guide (`help` tab / top-bar `?` icon).

---

## 🚀 Core Features & Modules

1. **Continuous Double-Entry Ledger:**
   - Strict debit/credit equilibrium on every transaction.
   - Dynamic account role resolution (`resolveAccountRole`) — no hardcoded accounts.
   - Absolute transaction totals (`totalAmountCents`) with directionality defined strictly by line items.
   - Filtered via `isPostable()` to exclude non-posting drafts or rejected lines.

2. **Closed-Period Governance ("Reverse & Correct"):**
   - Locked fiscal periods strictly reject direct edits or deletions.
   - A correction posts an equal-and-opposite reversal (in the original's month while it is open, otherwise today) linked to the replacement entry, with its audit trail.

3. **Sales & Customer Invoicing:**
   - Invoicing with tax-inclusive or tax-exclusive calculations, discounts, and retainage.
   - Real-time PDF document preview and generation with native streaming endpoints.
   - Bad debt write-off modal for overdue balances.

4. **Purchases & Accounts Payable:**
   - Vendor bill tracking, multi-category split allocation, and receipt attachments.
   - Settlement payment processing with automated oldest-first allocation across open bills/invoices.

5. **Banking & Zero-Variance Reconciliation:**
   - Bank feeds via Plaid (needs Plaid credentials and a check per bank).
   - Bank statement imports (CSV, OFX, QBO).
   - Zero-variance statement balancing before finalizing reconciliation statements.

6. **Financial Statements & Analytics:**
   - Balance Sheet, Profit & Loss (P&L), Cash Flow Statement, A/R & A/P Aging, and Tax Liability reports.
   - Monte Carlo cash flow forecasting and runway simulator.

---

## ⚡ Quick Start & CLI Scripts

**New here? Follow [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)**: Node version, settings, the test
database, running the app safely (without settings, local development stays in isolated guest mode;
configure your own Supabase project to sign in) and a full bookkeeping round to check it all works. The commands below are the
short version.

```bash
# 1. Install dependencies
npm install

# 2. Start local development server (binds on port 3000)
npm run dev

# 3. Execute full TypeScript typecheck & ESLint validation
npm run lint

# 4. Run automated test suite
npm test

# 4b. Database tests (needs a local Postgres and an empty database; CI starts one automatically)
createdb -h localhost -U postgres lf_test
export LF_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lf_test
npm run db:test-setup   # apply supabase/migrations to the test database
npm run test:rules      # row level security tests
npm test                # now also runs the database layer and sign-in tests

# 5. Build for production (bundles Vite client + standalone server.cjs)
npm run build

# 6. Start production server
npm start

# 7. Grant platform admin privileges to a user (DATABASE_URL = Supabase connection string)
npm run grant-admin -- <uid-or-email>

# 8. Scaffold new tools
npm run scaffold:plugin <name>
npm run scaffold:algo <name>
```

---

### 🔒 Security & Verification Standards

- **Server-Side API Keys:** All third-party secrets (`GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Plaid credentials) reside exclusively server-side.
- **Data Encryption:** Sensitive fields are encrypted using AES-256-GCM.
- **PII Scrubbing:** Automated sanitization of SSNs, credit card numbers, and secret tokens in logs.
- **Role-Based Access Control:** Postgres row level security (`supabase/migrations/`, tested by `supabase/tests/rls.test.sql`) enforces workspace boundaries, roles, allowed fields, closed-period write lockdown and two-step login.
