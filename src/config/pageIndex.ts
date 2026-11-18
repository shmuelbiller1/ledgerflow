import { APP_TABS, REPORT_TABS_REGISTRY, SCREEN_TABS_REGISTRY, SETTINGS_TABS_REGISTRY } from './registry';
import type { PinnedPage } from '../lib/pinnedPages';
import { isModuleOn, MODULES, moduleOfTab, type Modules } from '../lib/modules';

/** Words people type when looking for a setting (BB-09 settings search). */
const SETTINGS_KEYWORDS_HE: Record<string, string> = {
  branding: 'לוגו צבע מסמכים',
  numbering: 'מספר חשבונית רצף חשבוניות',
  modules: 'להפעיל שכר להדליק מודול תכונות',
};

const SETTINGS_KEYWORDS: Record<string, string> = {
  rules: 'automation auto categorize bank rules',
  dimensions: 'class location department labels tags',
  appearance: 'theme dark light font size density display',
  team: 'users members invite roles permissions people',
  billing: 'plan subscription payment card upgrade',
  templates: 'custom templates',
  security: 'password two-step 2fa mfa login session delete workspace',
  rule: 'ai copilot assistant',
  developer: 'api keys webhooks integration',
  import: 'csv excel upload customers vendors items accounts spreadsheet',
  emails: 'email reminders templates thank you dunning overdue receipt',
  branding: 'logo color colour footer terms pdf look address',
  numbering: 'invoice number prefix sequence bill estimate',
  defaults: 'default accounts receivable payable sales expense bank tax deposits prepayments prepaid mapping',
  schedule: 'cron jobs daily run reminders statements recurring when next time',
  'incoming-events': 'webhooks stripe online payment card email bounced delivered spam events log',
  tags: 'labels tag rename merge remove categories groups',
  'scheduled-reports': 'email reports schedule weekly monthly automatic send profit loss balance sheet aging',
  alerts: 'notify warn reminder close month budget overspent over budget cash low balance threshold',
  modules: 'features turn on off hide show payroll assets loans purchase orders petty cash intercompany forecasting quotes simple advanced',
  groups: 'group portfolio holding companies clients workspaces entities related folders',
  export: 'backup download restore data archive',
  shortcuts: 'keyboard keys speed dial hotkeys',
};

export interface PageEntry {
  page: PinnedPage;
  label: string;
  keywords: string;
  disabledModuleId?: string;
}

/**
 * The words people type for a report, when those words are not in its name. "profit and loss" must find
 * Profit & Loss, and someone who does not yet know the accounting name says "who owes me". Kept next to
 * the index (not inside each report) so one list answers "can I find it by a plain word?".
 */
const REPORT_KEYWORDS_HE: Record<string, string> = {
  pnl: 'דוח הכנסות והוצאות',
  'balance-sheet': 'מה יש לנו ומה חייבים נכסים והתחייבויות',
  'ar-aging': 'מי חייב לי חשבוניות שלא שולמו',
  'ap-aging': 'למי אני חייב חובות ספקים',
  'cash-flow': 'כסף נכנס כסף יוצא תנועת מזומנים',
};

const REPORT_KEYWORDS: Record<string, string> = {
  pnl: 'profit and loss income statement earnings revenue expenses results',
  'balance-sheet': 'statement of financial position what we own what we owe net worth',
  'ar-aging': 'who owes me unpaid invoices customers owe receivables ageing aging ar',
  'ap-aging': 'who i owe unpaid bills vendors payables ageing aging ap',
  'aged-receivables-by-rep': 'who owes me receivables by sales rep',
  'stock-aging': 'stock sitting too long old inventory',
  'cash-flow': 'money in money out cash movement run out of cash',
  'trial-balance': 'debits credits check the books',
  'israel-vat-report': 'vat vat return tax to report maam',
  'general-ledger': 'all entries ledger book of record',
  'customer-cohorts': 'customer groups by month retention',
  'budget-actual': 'budget versus actual overspent plan',
  'one-sided-transfers': 'transfers that only one side posted mistakes',
};

/**
 * Folding used for search only: "&" is typed as "and", punctuation joins words rather than separating
 * them, and runs of space collapse. The stored labels and ids are untouched.
 */
export function foldForSearch(text: string): string {
  return text
    .replace(/&/g, ' and ')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\//g, ' ')
    .replace(/[.,:;()'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type Labelled = { id: string; label: Record<string, string>; developerOnly?: boolean };
const name = (entry: Labelled, language: string) => entry.label[language] || entry.label.en;

/** Every page someone can go to: main screens, each report and each settings tab, plus turned-off module links. */
export function pageIndex(language = 'en', opts: { developerMode?: boolean; modules?: Modules } = {}): PageEntry[] {
  // BB-07: a module turned off leaves the active screens out, while offering a shortcut to turn it on in Settings → Modules
  // every sidebar screen is listed, developers-only ones only in developer mode. The Admin Panel used to
  // be missing from this list entirely, so only the two places that already knew its name could open it.
  const main = (APP_TABS as Labelled[]).filter(t => (!t.developerOnly || opts.developerMode) && (!moduleOfTab(t.id) || isModuleOn(opts.modules, moduleOfTab(t.id)!)))
    .map(t => ({ page: { tab: t.id }, label: name(t, language), keywords: `${t.id} ${name(t, 'en')}` }));
  // Screens that exist outside the sidebar (Audit checks, Time Machine, Tax Manager, Consolidation,
  // Assisted Entry, Ask Ledger, the Architecture Map) were reachable only from a sub-tab of a sub-tab,
  // or not at all. They are listed here so one search reaches every registered screen (prompt 2, part 5).
  const sidebarIds = new Set<string>(APP_TABS.map(t => t.id));
  const extras = (SCREEN_TABS_REGISTRY as Labelled[])
    .filter(t => !sidebarIds.has(t.id) && t.id !== 'accept-invite')
    .filter(t => !t.developerOnly || opts.developerMode)
    .map(t => ({
      page: { tab: t.id },
      label: name(t, language),
      keywords: foldForSearch(`${t.id.replace(/-/g, ' ')} ${name(t, 'en')} screen`),
    }));
  const reports = (REPORT_TABS_REGISTRY as Labelled[]).map(r => ({
    page: { tab: 'reports', sub: r.id },
    label: `Report: ${name(r, language)}`,
    keywords: foldForSearch(`report ${r.id.replace(/-/g, ' ')} ${name(r, 'en')} ${REPORT_KEYWORDS[r.id] || ''} ${language === 'he' ? REPORT_KEYWORDS_HE[r.id] || '' : ''}`),
  }));
  const settings = (SETTINGS_TABS_REGISTRY as Labelled[]).map(s => ({
    page: { tab: 'settings', sub: s.id },
    label: `Settings: ${name(s, language)}`,
    keywords: foldForSearch(`settings ${s.id.replace(/-/g, ' ')} ${SETTINGS_KEYWORDS[s.id] || ''} ${language === 'he' ? SETTINGS_KEYWORDS_HE[s.id] || '' : ''}`),
  }));
  const allScreens = [...main, ...extras];
  const disabledModules: PageEntry[] = opts.modules
    ? MODULES.filter(m => !isModuleOn(opts.modules, m.id)).map(m => {
      const localTabNames = (APP_TABS as Labelled[]).filter(t => m.tabs.includes(t.id)).map(t => name(t, language)).join(' ');
      return {
        page: { tab: 'settings', sub: 'modules' },
        label: language === 'he'
          ? `${localTabNames || m.name} (כבוי) — להפעלה בהגדרות → מודולים`
          : `${m.name} (off) — turn on in Settings → Modules`,
        keywords: `${m.id} ${m.name} ${m.about} ${m.tabs.join(' ')} module turn on enable settings ${localTabNames} ${language === 'he' ? 'להפעיל להדליק הפעלה' : ''}`,
        disabledModuleId: m.id,
      };
    })
    : [];
  return [...allScreens, ...reports, ...settings, ...disabledModules];
}

/**
 * Pages whose name or keywords contain every typed word. Both sides are folded the same way, so
 * "profit and loss" finds "Profit & Loss" and "aged receivable" finds "Aged Receivables".
 */
export function searchPages(index: PageEntry[], query: string): PageEntry[] {
  const words = foldForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  return index.filter(p => {
    const hay = foldForSearch(`${p.label} ${p.keywords}`);
    return words.every(w => hay.includes(w));
  });
}
