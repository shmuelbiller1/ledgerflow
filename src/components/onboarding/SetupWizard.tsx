import { runCommand } from '../../lib/runCommand';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { saveWorkspaceSettings, saveWorkspaceAxes } from '../../lib/workspaceSettingsSave';
import { BUSINESS_TEMPLATES } from '../../lib/businessTemplates';
import { describeError } from '../../lib/errorRemedies';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import { modulesForBusiness } from '../../lib/modules';
import {
  businessPresetName, businessTemplateDescription, businessTemplateName, fillOnboarding, monthNames, onboardingText,
} from '../../lib/i18n/onboardingTranslations';
import { directionOf, useUiLanguage } from '../../lib/i18n/useUiLanguage';

import { BUSINESS_PRESETS, presetForBusiness, presetDimensions } from '../../lib/businessPresets';
/** Business type selects optional starter accounts and labels; opening figures live on Overview. */
const STEP_KEYS = [
  { key: 'setup.step.business', fallback: 'Your business' },
  { key: 'setup.step.chart', fallback: 'Chart of accounts' },
  { key: 'setup.step.done', fallback: 'Done' },
] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'JPY', 'INR'];

function supportedTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') || [];
  } catch {
    return [];
  }
}

function timeZones(current: string): string[] {
  return [...new Set([current, 'UTC', ...supportedTimeZones()])];
}

interface Props {
  /** The wizard started writing: keep it on screen until it is finished. */
  onStarted: () => void;
  /** Finished or skipped. */
  onDone: () => void;
}

export default function SetupWizard({ onStarted, onDone }: Props) {
  // AI12-N10-01 (#838): the wizard speaks the language chosen in Accessibility & language.
  const language = useUiLanguage();
  const t = (key: Parameters<typeof onboardingText>[0], fallback: string) => onboardingText(key, language, fallback);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const role = useCurrentRole();
  const accounts = useLedgerStore(s => s.accounts);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const deviceZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }, []);
  const [name, setName] = useState(workspace?.name || '');
  const [currency, setCurrency] = useState(workspace?.currency || 'USD');
  const [timezone, setTimezone] = useState(workspace?.timezone || deviceZone);
  const [fiscalStart, setFiscalStart] = useState(workspace?.fiscalYearStartMonth || 1);
  const [businessType, setBusinessType] = useState(() => presetForBusiness(workspace?.businessType)?.id || '');
  const [templateId, setTemplateId] = useState(() => accounts.length ? '' : (presetForBusiness(workspace?.businessType)?.id || ''));
  if (!workspace) return null;
  if (role !== 'owner' && role !== 'accountant') {
    return (
      <main lang={language} dir={directionOf(language)} className="flex-1 flex items-center justify-center p-6 text-[var(--text)]">
        <p className="max-w-md text-center text-[var(--muted)]">{t('setup.notSetUp', "This workspace isn't set up yet. Ask an owner or accountant to finish the setup.")}</p>
      </main>
    );
  }

  const call = async (path: string, body?: unknown) =>
    runCommand<Record<string, unknown>>({ path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/${path}`, method: 'POST', body });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onStarted();
    try {
      await action();
    } catch (err) {
      const described = describeError(err, 'update', uiLanguageNow());
      toast.error(described.title, { description: described.remedy });
    } finally {
      setBusy(false);
    }
  };

  const saveBusiness = () => run(async () => {
    const workspaceId = workspace.id;
    // the axes are not a setting (they have their own command); the rest of the step is
    const dimensions = presetDimensions(workspace.dimensions, businessType);
    const fields = { businessType, name: name.trim() || workspace.name, currency, timezone, fiscalYearStartMonth: fiscalStart, fiscalYearStartDay: 1 };
    const axesChanged = JSON.stringify(dimensions) !== JSON.stringify(workspace.dimensions);
    const changed = businessType !== workspace.businessType || axesChanged || fields.name !== workspace.name || currency !== workspace.currency || timezone !== workspace.timezone
      || fiscalStart !== (workspace.fiscalYearStartMonth || 1);
    if (changed) {
      if (axesChanged) await saveWorkspaceAxes(workspaceId, dimensions);
      await saveWorkspaceSettings(workspaceId, fields);
      const nextModules = businessType && businessType !== workspace.businessType ? modulesForBusiness(businessType) : workspace.modules;
      if (businessType && businessType !== workspace.businessType) {
        await runCommand({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/modules`, method: 'PUT', body: { modules: nextModules } });
      }
      const store = useAuthStore.getState();
      if (store.currentWorkspaceId && store.currentWorkspaceId !== workspaceId) return;
      store.setWorkspaces(store.workspaces.map(w => (w.id === workspaceId ? { ...w, ...fields, dimensions, ...(nextModules ? { modules: nextModules } : {}) } : w)));
    }
    setStep(1);
  });

  const applyChart = () => run(async () => {
    if (templateId) {
      await call('apply-template', { templateId });
      if (templateId !== businessType) await saveWorkspaceSettings(workspace.id, { businessType });
      const store = useAuthStore.getState();
      store.setWorkspaces(store.workspaces.map(w => w.id === workspace.id ? { ...w, businessType } : w));
    }
    await call('setup-complete');
    setStep(2);
  });

  const startFromZero = () => run(async () => {
    await call('setup-complete');
    setStep(2);
  });

  const finish = (tab?: string) => {
    const store = useAuthStore.getState();
    store.setWorkspaces(store.workspaces.map(w => (w.id === workspace.id ? { ...w, setupCompletedAt: new Date().toISOString() } : w)));
    if (tab) useUIStore.getState().setActiveTab(tab);
    onDone();
  };

  const field = 'w-full px-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-sm';
  return (
    <main lang={language} dir={directionOf(language)} className="flex-1 p-4 sm:p-8 text-[var(--text)]">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">{t('setup.title', 'Set up your books')}</h1>
          <ol className="flex flex-wrap gap-2 text-xs" aria-label={t('setup.stepsLabel', 'Setup steps')}>
            {STEP_KEYS.map((entry, i) => (
              <li key={entry.key} aria-current={i === step ? 'step' : undefined}
                className={`px-2.5 py-1 rounded-md border ${i === step ? 'border-[var(--brass)] text-[var(--text)] font-semibold' : 'border-[var(--line)] text-[var(--muted)]'}`}>
                {i + 1}. {t(entry.key, entry.fallback)}
              </li>
            ))}
          </ol>
        </header>

        {step === 0 && (
          <section className="space-y-4" aria-labelledby="setup-business">
            <h2 id="setup-business" className="text-lg font-semibold">{t('setup.business.heading', 'What kind of business?')}</h2>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="text-sm text-[var(--muted)] mb-3">{t('setup.business.legend', 'Choose a starting point. You can change the accounts and labels later.')}</legend>
              {BUSINESS_PRESETS.map(preset => <label key={preset.id} className="flex items-center gap-3 min-h-11 p-3 rounded-lg border border-[var(--line)]">
                <input type="radio" name="business-type" checked={businessType === preset.id} onChange={() => { setBusinessType(preset.id); setTemplateId(preset.id); }} />
                {businessPresetName(preset.id, preset.name, language)}
              </label>)}
            </fieldset>
            {/* EU-A4: people moving from another package start with their own books, not a blank set */}
            <div className="rounded-lg border border-[var(--line)] bg-[var(--ink)] p-3 text-sm flex flex-wrap items-center gap-3" data-testid="setup-coming-from">
              <span className="flex-1 min-w-[12rem]">{t('setup.comingFrom', 'Coming from QuickBooks, Xero or Wave? Bring in your customers, vendors, items, chart of accounts and opening balances; it ends by checking your trial balance matches.')}</span>
              <button type="button" onClick={() => { useUIStore.getState().goToPage({ tab: 'settings', sub: 'import' }); onDone(); }} disabled={busy}
                className="min-h-11 px-3 rounded-lg border border-[var(--line)] font-semibold">{t('setup.comingFrom.button', 'Bring in my books')}</button>
            </div>
            {/* What the template writes into the person's own chart stays as stored; only the sentence is translated. */}
            <p className="text-sm text-[var(--muted)]">{fillOnboarding(
              t('setup.suggestedLabels', 'Suggested labels: {labels}. Existing labels stay unchanged. Fund is self-balancing for a new non-profit label.'),
              { labels: BUSINESS_PRESETS.find(p => p.id === businessType)?.labels.map(d => d.name).join(language === 'he' ? ' ו' : ' and ') || t('setup.labels.none', 'None') })}</p>
            <div className="space-y-1">
              <label htmlFor="setup-name" className="micro-label">{t('setup.field.name', 'Business name')}</label>
              <input id="setup-name" className={field} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="setup-currency" className="micro-label">{t('setup.field.currency', 'Home currency')}</label>
                <select id="setup-currency" className={field} value={currency} onChange={e => setCurrency(e.target.value)}>
                  {[...new Set([currency, ...CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="setup-fiscal" className="micro-label">{t('setup.field.fiscal', 'Financial year starts in')}</label>
                <select id="setup-fiscal" className={field} value={fiscalStart} onChange={e => setFiscalStart(Number(e.target.value))}>
                  {monthNames(language).map((m, i) => <option key={m} value={i + 1} dir="auto">{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="setup-tz" className="micro-label">{t('setup.field.timezone', 'Time zone')}</label>
                <select id="setup-tz" className={field} value={timezone} onChange={e => setTimezone(e.target.value)}>
                  {timeZones(timezone).map(z => <option key={z} value={z} dir="ltr">{z}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-[var(--muted)]">{t('setup.currencyLocked', "The home currency can't be changed once there are entries.")}</p>
            <div className="flex justify-between">
              <button type="button" className="btn-tonal min-h-11" onClick={startFromZero} disabled={busy}>{t('setup.skip', 'Skip setup')}</button>
              <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={saveBusiness} disabled={busy || !businessType}>{busy ? t('setup.saving', 'Saving…') : t('setup.next', 'Next')}</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4" aria-labelledby="setup-chart">
            <h2 id="setup-chart" className="text-lg font-semibold">{t('setup.chart.heading', 'Chart of accounts')}</h2>
            {accounts.length > 0 && (
              <p className="text-sm text-[var(--muted)]">{fillOnboarding(
                t('setup.chart.existing', 'This workspace has {count} accounts. Keep them, or pick a template to replace them (only possible before the first entry).'),
                { count: accounts.length })}</p>
            )}
            <fieldset className="space-y-2">
              <legend className="micro-label">{t('setup.chart.legend', 'Start from a template for your kind of business')}</legend>
              {accounts.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-[var(--line)]">
                  <input id="tpl-keep" type="radio" name="template" checked={templateId === ''} onChange={() => setTemplateId('')} />
                  <label htmlFor="tpl-keep" className="text-sm font-semibold">{t('setup.chart.keep', 'Keep my accounts')}</label>
                </div>
              )}
              {Object.values(BUSINESS_TEMPLATES).map(template => (
                <div key={template.id} className="flex items-start gap-2 p-3 rounded-lg border border-[var(--line)]">
                  <input id={`tpl-${template.id}`} type="radio" name="template" checked={templateId === template.id} onChange={() => setTemplateId(template.id)} aria-describedby={`tpl-${template.id}-desc`} />
                  <div className="text-sm">
                    <label htmlFor={`tpl-${template.id}`} className="font-semibold">{businessTemplateName(template.id, template.name, language)}</label>
                    <p id={`tpl-${template.id}-desc`} className="text-xs text-[var(--muted)]">{businessTemplateDescription(template.id, template.description, language)}</p>
                  </div>
                </div>
              ))}
            </fieldset>
            <div className="flex justify-between">
              <button type="button" className="btn-tonal min-h-11" onClick={() => setStep(0)} disabled={busy}>{t('setup.back', 'Back')}</button>
              <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={applyChart} disabled={busy || (!templateId && accounts.length === 0)}>
                {busy ? t('setup.applying', 'Applying…') : t('setup.next', 'Next')}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4" aria-labelledby="setup-done">
            <h2 id="setup-done" className="text-lg font-semibold flex items-center gap-2"><CheckCircle2 className="text-[var(--pos)]" aria-hidden="true" /> {t('setup.done.heading', 'Your books are set up')}</h2>
            <p className="text-sm text-[var(--muted)]">
              {t('setup.done.body', "Your starter settings are ready. If you have previous books, use “Bring in last year's numbers” on Overview when you are ready.")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={() => finish('sales')}>{t('setup.done.invoice', 'Create the first invoice')}</button>
              <button type="button" className="btn-tonal min-h-11" onClick={() => finish('banking')}>{t('setup.done.bank', 'Connect or import a bank account')}</button>
              <button type="button" className="btn-tonal min-h-11" onClick={() => finish()}>{t('setup.done.overview', 'Go to Overview')}</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
