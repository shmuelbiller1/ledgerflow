/**
 * Modules (BB-07): simple until needed. One app that grows, never a "simple" and an "advanced"
 * version. A module is a set of screens a business may not need (payroll, fixed assets, loans…).
 * Turned off, its screens leave the menu and the page search; nothing is deleted, and turning it back
 * on shows everything again. A new workspace starts with the advanced modules off; a workspace made
 * before modules existed keeps everything on. Owners and accountants change them in
 * Settings → Modules (saved by the server, src/server/services/moduleService.ts).
 */

export interface ModuleDefinition {
  id: string;
  name: string;
  /** what it is for, in one sentence */
  about: string;
  /** the registry tabs (src/config/registry.tsx APP_TABS) it shows */
  tabs: string[];
}

export const MODULES: ModuleDefinition[] = [
  { id: 'estimates', name: 'Quotes and sales orders', about: 'Quotes a customer accepts become orders, invoiced in one go or in parts.', tabs: ['estimates'] },
  { id: 'purchase-orders', name: 'Purchase orders', about: 'Orders to vendors, goods received and three-way matching with the bill.', tabs: ['purchase-orders'] },
  { id: 'payroll', name: 'Payroll', about: 'Employees, pay runs, payslips and time off.', tabs: ['payroll'] },
  { id: 'fixed-assets', name: 'Fixed assets', about: 'The asset register, depreciation, disposal and transfers.', tabs: ['assets'] },
  { id: 'loans', name: 'Loans', about: 'Loans with their repayment schedule, posted month by month.', tabs: ['loans'] },
  { id: 'petty-cash', name: 'Petty cash', about: 'A cash box: spending, top-ups and counting it.', tabs: ['petty-cash'] },
  { id: 'intercompany', name: 'Intercompany', about: 'Dealings between related companies.', tabs: ['intercompany'] },
  { id: 'forecasting', name: 'Forecasting', about: 'Cash-flow forecasts and scenarios.', tabs: ['forecaster'] },
  { id: 'query-builder', name: 'Query builder', about: 'Searches written in a query language, for power users.', tabs: ['query-builder'] },
  { id: 'inventory', name: 'Stock', about: 'Items with quantities and cost: bought on bills, sold on invoices, counted and moved.', tabs: ['inventory'] },
  { id: 'projects', name: 'Projects', about: 'Projects with their pipeline and profitability.', tabs: ['projects'] },
  { id: 'budgets', name: 'Budgets', about: 'Budgets by account, compared with what actually happened.', tabs: ['budgets'] },
];

export type Modules = Record<string, boolean>;

/** What a new workspace starts with: the everyday screens on, the rest off until wanted. */
export const NEW_WORKSPACE_MODULES: Modules = {
  estimates: true,
  'purchase-orders': false,
  payroll: false,
  'fixed-assets': false,
  loans: false,
  'petty-cash': false,
  intercompany: false,
  forecasting: false,
  'query-builder': false,
  inventory: false,
  projects: false,
  budgets: false,
};

const BUSINESS_MODULE_EXTRAS: Record<string, string[]> = {
  retail: ['inventory', 'purchase-orders'],
  construction: ['projects', 'purchase-orders', 'budgets'],
  service: ['projects'],
  creative: ['projects'],
  software_agency: ['projects'],
  realestate: ['projects', 'loans', 'fixed-assets'],
  nonprofit: ['projects', 'budgets'],
};

/** Starter modules tailored to the chosen business type, keeping advanced modules off unless relevant. */
export function modulesForBusiness(businessType: string | undefined): Modules {
  const next: Modules = { ...NEW_WORKSPACE_MODULES };
  for (const id of BUSINESS_MODULE_EXTRAS[businessType || ''] || []) {
    if (id in next) next[id] = true;
  }
  return next;
}

const BY_TAB = new Map(MODULES.flatMap(m => m.tabs.map(tab => [tab, m.id] as const)));

/** The module a menu tab belongs to, if any (tabs outside modules always show). */
export const moduleOfTab = (tabId: string | undefined) => (tabId ? BY_TAB.get(tabId) : undefined);

/** On unless the workspace turned it off (a workspace without settings has everything on). */
export const isModuleOn = (modules: Modules | undefined, id: string) => modules?.[id] !== false;

/** Why these module settings can't be saved, or null. */
export function modulesProblem(modules: unknown): string | null {
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return 'Send which modules are on';
  for (const [id, on] of Object.entries(modules as Record<string, unknown>)) {
    if (!MODULES.some(m => m.id === id)) return `There is no module "${id}"`;
    if (typeof on !== 'boolean') return `Say whether ${id} is on (true or false)`;
  }
  return null;
}
