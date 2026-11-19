/** Node ESM helper signatures for the standalone check-perf-budgets.mjs utility (D-27). */

/** Budget keys measured from the built client bundle. */
export const BUNDLE_BUDGET_KEYS: readonly string[];
/** Bytes per KB used for every reported size. */
export const KB: number;

export interface BundleMeasurement {
  firstLoadGzipKb: number;
  totalJsGzipKb: number;
  maxChunkGzipKb: number;
  cssGzipKb: number;
  maxChunk: string;
  firstLoadFiles: number;
}

export interface BundleBudget {
  firstLoadGzipKb: number;
  totalJsGzipKb: number;
  maxChunkGzipKb: number;
  cssGzipKb: number;
}

export interface BudgetViolation {
  key: string;
  budgetKb: number;
  actualKb: number;
  overByKb: number;
}

export function validateBudgets(budgets: unknown): string[];
export function gzipKb(buffer: Buffer): number;
export function measureBundle(distDir: string): {
  ok: boolean;
  missing: string[];
  measured?: BundleMeasurement;
};
export function evaluateBudgets(measured: Partial<BundleMeasurement>, bundleBudgets: Partial<BundleBudget>): BudgetViolation[];
export function formatReport(measured: BundleMeasurement, bundleBudgets: Partial<BundleBudget>): string;
