import { APP_TABS, REPORT_TABS_REGISTRY, SETTINGS_TABS_REGISTRY } from './registry';
import type { PinnedPage } from '../lib/pinnedPages';
import { isModuleOn, MODULES, moduleOfTab, type Modules } from '../lib/modules';

/** Words people type when looking for a setting (BB-09 settings search). */
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

type Labelled = { id: string; label: Record<string, string>; developerOnly?: boolean };
const name = (entry: Labelled, language: string) => entry.label[language] || entry.label.en;

/** Every page someone can go to: main screens, each report and each settings tab, plus turned-off module links. */
export function pageIndex(language = 'en', opts: { developerMode?: boolean; modules?: Modules } = {}): PageEntry[] {
  // BB-07: a module turned off leaves the active screens out, while offering a shortcut to turn it on in Settings → Modules
  const main = (APP_TABS as Labelled[]).filter(t => (!t.developerOnly || opts.developerMode) && (!moduleOfTab(t.id) || isModuleOn(opts.modules, moduleOfTab(t.id)!)))
    .map(t => ({ page: { tab: t.id }, label: name(t, language), keywords: `${t.id} ${name(t, 'en')}` }));
  const reports = (REPORT_TABS_REGISTRY as Labelled[]).map(r => ({
    page: { tab: 'reports', sub: r.id },
    label: `Report: ${name(r, language)}`,
    keywords: `report ${r.id.replace(/-/g, ' ')} ${name(r, 'en')}`,
  }));
  const settings = (SETTINGS_TABS_REGISTRY as Labelled[]).map(s => ({
    page: { tab: 'settings', sub: s.id },
    label: `Settings: ${name(s, language)}`,
    keywords: `settings ${s.id.replace(/-/g, ' ')} ${SETTINGS_KEYWORDS[s.id] || ''}`,
  }));
  const disabledModules: PageEntry[] = opts.modules
    ? MODULES.filter(m => !isModuleOn(opts.modules, m.id)).map(m => ({
      page: { tab: 'settings', sub: 'modules' },
      label: `${m.name} (off) — turn on in Settings → Modules`,
      keywords: `${m.id} ${m.name} ${m.about} ${m.tabs.join(' ')} module turn on enable settings`,
      disabledModuleId: m.id,
    }))
    : [];
  return [...main, ...reports, ...settings, ...disabledModules];
}

/** Pages whose name or keywords contain every typed word. */
export function searchPages(index: PageEntry[], query: string): PageEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return index.filter(p => {
    const hay = `${p.label} ${p.keywords}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
