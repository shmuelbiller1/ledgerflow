import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { doc, updateDoc } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { BUSINESS_TEMPLATES } from '../../lib/businessTemplates';
import { describeError } from '../../lib/errorRemedies';

import { BUSINESS_PRESETS, presetForBusiness, presetDimensions } from '../../lib/businessPresets';
/** Business type selects optional starter accounts and labels; opening figures live on Overview. */
const STEPS = ['Your business', 'Chart of accounts', 'Done'] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'JPY', 'INR'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const user = useAuthStore(s => s.user);
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
      <main className="flex-1 flex items-center justify-center p-6 text-[var(--text)]">
        <p className="max-w-md text-center text-[var(--muted)]">This workspace isn&apos;t set up yet. Ask an owner or accountant to finish the setup.</p>
      </main>
    );
  }

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user?.getIdToken()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'The setup step failed');
    return data;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onStarted();
    try {
      await action();
    } catch (err) {
      const described = describeError(err, 'update');
      toast.error(described.title, { description: described.remedy });
    } finally {
      setBusy(false);
    }
  };

  const saveBusiness = () => run(async () => {
    const fields = { businessType, dimensions: presetDimensions(workspace.dimensions, businessType), name: name.trim() || workspace.name, currency, timezone, fiscalYearStartMonth: fiscalStart, fiscalYearStartDay: 1 };
    const changed = businessType !== workspace.businessType || JSON.stringify(fields.dimensions) !== JSON.stringify(workspace.dimensions) || fields.name !== workspace.name || currency !== workspace.currency || timezone !== workspace.timezone
      || fiscalStart !== (workspace.fiscalYearStartMonth || 1);
    if (changed) {
      await updateDoc(doc(db, 'workspaces', workspace.id), { ...fields, updatedAt: new Date().toISOString() });
      const store = useAuthStore.getState();
      store.setWorkspaces(store.workspaces.map(w => (w.id === workspace.id ? { ...w, ...fields } : w)));
    }
    setStep(1);
  });

  const applyChart = () => run(async () => {
    if (templateId) {
      await call('apply-template', { templateId });
      if (templateId !== businessType) await updateDoc(doc(db, 'workspaces', workspace.id), { businessType });
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
    <main className="flex-1 p-4 sm:p-8 text-[var(--text)]">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">Set up your books</h1>
          <ol className="flex flex-wrap gap-2 text-xs" aria-label="Setup steps">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? 'step' : undefined}
                className={`px-2.5 py-1 rounded-md border ${i === step ? 'border-[var(--brass)] text-[var(--text)] font-semibold' : 'border-[var(--line)] text-[var(--muted)]'}`}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </header>

        {step === 0 && (
          <section className="space-y-4" aria-labelledby="setup-business">
            <h2 id="setup-business" className="text-lg font-semibold">What kind of business?</h2>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="text-sm text-[var(--muted)] mb-3">Choose a starting point. You can change the accounts and labels later.</legend>
              {BUSINESS_PRESETS.map(preset => <label key={preset.id} className="flex items-center gap-3 min-h-11 p-3 rounded-lg border border-[var(--line)]">
                <input type="radio" name="business-type" checked={businessType === preset.id} onChange={() => { setBusinessType(preset.id); setTemplateId(preset.id); }} />
                {preset.name}
              </label>)}
            </fieldset>
            <p className="text-sm text-[var(--muted)]">Suggested labels: {BUSINESS_PRESETS.find(p => p.id === businessType)?.labels.map(d => d.name).join(' and ') || 'None'}. Existing labels stay unchanged. Fund is self-balancing for a new non-profit label.</p>
            <div className="space-y-1">
              <label htmlFor="setup-name" className="micro-label">Business name</label>
              <input id="setup-name" className={field} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="setup-currency" className="micro-label">Home currency</label>
                <select id="setup-currency" className={field} value={currency} onChange={e => setCurrency(e.target.value)}>
                  {[...new Set([currency, ...CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="setup-fiscal" className="micro-label">Financial year starts in</label>
                <select id="setup-fiscal" className={field} value={fiscalStart} onChange={e => setFiscalStart(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="setup-tz" className="micro-label">Time zone</label>
                <select id="setup-tz" className={field} value={timezone} onChange={e => setTimezone(e.target.value)}>
                  {timeZones(timezone).map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-[var(--muted)]">The home currency can&apos;t be changed once there are entries.</p>
            <div className="flex justify-between">
              <button type="button" className="btn-tonal min-h-11" onClick={startFromZero} disabled={busy}>Skip setup</button>
              <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={saveBusiness} disabled={busy || !businessType}>{busy ? 'Saving…' : 'Next'}</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4" aria-labelledby="setup-chart">
            <h2 id="setup-chart" className="text-lg font-semibold">Chart of accounts</h2>
            {accounts.length > 0 && (
              <p className="text-sm text-[var(--muted)]">This workspace has {accounts.length} accounts. Keep them, or pick a template to replace them (only possible before the first entry).</p>
            )}
            <fieldset className="space-y-2">
              <legend className="micro-label">Start from a template for your kind of business</legend>
              {accounts.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-[var(--line)]">
                  <input id="tpl-keep" type="radio" name="template" checked={templateId === ''} onChange={() => setTemplateId('')} />
                  <label htmlFor="tpl-keep" className="text-sm font-semibold">Keep my accounts</label>
                </div>
              )}
              {Object.values(BUSINESS_TEMPLATES).map(t => (
                <div key={t.id} className="flex items-start gap-2 p-3 rounded-lg border border-[var(--line)]">
                  <input id={`tpl-${t.id}`} type="radio" name="template" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} aria-describedby={`tpl-${t.id}-desc`} />
                  <div className="text-sm">
                    <label htmlFor={`tpl-${t.id}`} className="font-semibold">{t.name}</label>
                    <p id={`tpl-${t.id}-desc`} className="text-xs text-[var(--muted)]">{t.description}</p>
                  </div>
                </div>
              ))}
            </fieldset>
            <div className="flex justify-between">
              <button type="button" className="btn-tonal min-h-11" onClick={() => setStep(0)} disabled={busy}>Back</button>
              <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={applyChart} disabled={busy || (!templateId && accounts.length === 0)}>
                {busy ? 'Applying…' : 'Next'}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4" aria-labelledby="setup-done">
            <h2 id="setup-done" className="text-lg font-semibold flex items-center gap-2"><CheckCircle2 className="text-[var(--pos)]" aria-hidden="true" /> Your books are set up</h2>
            <p className="text-sm text-[var(--muted)]">
              Your starter settings are ready. If you have previous books, use “Bring in last year's numbers” on Overview when you are ready.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary min-h-11 bg-[var(--text)] text-[var(--surface)]" onClick={() => finish('sales')}>Create the first invoice</button>
              <button type="button" className="btn-tonal min-h-11" onClick={() => finish('banking')}>Connect or import a bank account</button>
              <button type="button" className="btn-tonal min-h-11" onClick={() => finish()}>Go to Overview</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
