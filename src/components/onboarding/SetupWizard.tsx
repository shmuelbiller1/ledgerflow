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
import { isOpeningBalanceEquity, openingBalanceAccounts, openingEntry } from '../../lib/openingBalances';
import { formatCurrency, getLocalDateISO, monthBoundsISO } from '../../lib/utils';
import { describeError } from '../../lib/errorRemedies';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import type { ChartAccount } from '../../types';

import { BRAND_NAME } from '../../config/brand';
/**
 * First-run setup (L-19, BO-03): the business's basics, a chart of accounts, and the opening
 * balances, posted as one entry that balances by construction (the difference goes to Opening
 * Balance Equity), so the books start with a balanced trial balance. "Start from zero" skips the
 * balances. Owners and accountants; others are told to ask one.
 */

const STEPS = ['Your business', 'Chart of accounts', 'Opening balances', 'Done'] as const;
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

/** The entry the balances would post, or null while one can't be built. */
function previewEntry(...args: [ChartAccount[], Array<{ accountId: string; amountCents: number }>, ChartAccount | undefined]) {
  const [accounts, balances, equity] = args;
  if (!equity) return null;
  try {
    return openingEntry(accounts, balances, equity);
  } catch {
    return null;
  }
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
  const [templateId, setTemplateId] = useState('');
  const [startDate, setStartDate] = useState(() => monthBoundsISO(getLocalDateISO()).start);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [posted, setPosted] = useState<{ debitsCents: number; equityCents: number } | null>(null);

  const eligible = useMemo(() => openingBalanceAccounts(accounts), [accounts]);
  const equity = accounts.find(a => isOpeningBalanceEquity(a) && !a.isArchived);
  const balances = eligible.map(a => ({ accountId: a.id, amountCents: TruthEngine.parseAmountToCentsOrZero(amounts[a.id] || '0') }));
  const preview = previewEntry(accounts, balances, equity);
  const money = (cents: number) => formatCurrency(cents, currency);

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
    const fields = { name: name.trim() || workspace.name, currency, timezone, fiscalYearStartMonth: fiscalStart, fiscalYearStartDay: 1 };
    const changed = fields.name !== workspace.name || currency !== workspace.currency || timezone !== workspace.timezone
      || fiscalStart !== (workspace.fiscalYearStartMonth || 1);
    if (changed) {
      await updateDoc(doc(db, 'workspaces', workspace.id), { ...fields, updatedAt: new Date().toISOString() });
      const store = useAuthStore.getState();
      store.setWorkspaces(store.workspaces.map(w => (w.id === workspace.id ? { ...w, ...fields } : w)));
    }
    setStep(1);
  });

  const applyChart = () => run(async () => {
    if (templateId) await call('apply-template', { templateId });
    setStep(2);
  });

  const recordBalances = () => run(async () => {
    const result = await call('opening-balances', { date: startDate, balances: balances.filter(b => b.amountCents !== 0) });
    setPosted({ debitsCents: result.debitsCents || 0, equityCents: result.equityCents || 0 });
    setStep(3);
  });

  const startFromZero = () => run(async () => {
    await call('setup-complete');
    setPosted({ debitsCents: 0, equityCents: 0 });
    setStep(3);
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
            <h2 id="setup-business" className="text-lg font-semibold">Your business</h2>
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
              <button type="button" className="btn-tonal" onClick={startFromZero} disabled={busy}>Skip setup</button>
              <button type="button" className="btn-primary" onClick={saveBusiness} disabled={busy}>{busy ? 'Saving…' : 'Next'}</button>
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
              <button type="button" className="btn-tonal" onClick={() => setStep(0)} disabled={busy}>Back</button>
              <button type="button" className="btn-primary" onClick={applyChart} disabled={busy || (!templateId && accounts.length === 0)}>
                {busy ? 'Applying…' : 'Next'}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4" aria-labelledby="setup-opening">
            <h2 id="setup-opening" className="text-lg font-semibold">Opening balances</h2>
            <p className="text-sm text-[var(--muted)]">
              What the business had and owed on the day you start using {BRAND_NAME} (from your last balance sheet or bank statements).
              Customers&apos; and vendors&apos; unpaid amounts are added as invoices and bills instead, so you know who owes what.
            </p>
            <div className="space-y-1">
              <label htmlFor="setup-start" className="micro-label">Start date</label>
              <input id="setup-start" type="date" className={`${field} sm:w-48`} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            {!equity ? (
              <p className="text-sm text-[var(--neg)]">Add an &quot;Opening Balance Equity&quot; account to the chart of accounts first, or start from zero.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Opening balance per account</caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)]"><th scope="col" className="py-1">Account</th><th scope="col" className="py-1 text-right">Balance ({currency})</th></tr>
                </thead>
                <tbody>
                  {eligible.map(a => (
                    <tr key={a.id} className="border-t border-[var(--line)]">
                      <td className="py-1.5"><label htmlFor={`ob-${a.id}`}>{a.code ? `${a.code} · ` : ''}{a.name}</label></td>
                      <td className="py-1.5 text-right">
                        <input id={`ob-${a.id}`} type="number" step="0.01" inputMode="decimal" className={`${field} w-36 text-right font-mono`}
                          value={amounts[a.id] || ''} placeholder="0.00" onChange={e => setAmounts({ ...amounts, [a.id]: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview && preview.lines.length > 0 && (
              <p className="text-sm tabular-nums" aria-live="polite">
                Debits {money(preview.debitsCents)} = credits {money(preview.creditsCents)}.{' '}
                {preview.equityCents !== 0 && <>{money(Math.abs(preview.equityCents))} goes to {equity?.name} {preview.equityCents > 0 ? '(what the business is worth)' : '(it owes more than it has)'}.</>}
              </p>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className="btn-tonal" onClick={() => setStep(1)} disabled={busy}>Back</button>
              <div className="flex gap-2">
                <button type="button" className="btn-tonal" onClick={startFromZero} disabled={busy}>Start from zero</button>
                <button type="button" className="btn-primary" onClick={recordBalances} disabled={busy || !equity || !preview || preview.lines.length === 0}>
                  {busy ? 'Recording…' : 'Record opening balances'}
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4" aria-labelledby="setup-done">
            <h2 id="setup-done" className="text-lg font-semibold flex items-center gap-2"><CheckCircle2 className="text-[var(--pos)]" aria-hidden="true" /> Your books are set up</h2>
            <p className="text-sm text-[var(--muted)]">
              {posted && posted.debitsCents > 0
                ? `Opening balances recorded on ${startDate}: debits and credits are both ${money(posted.debitsCents)}, so the trial balance balances.`
                : 'You start from zero; the trial balance balances.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => finish('sales')}>Create the first invoice</button>
              <button type="button" className="btn-tonal" onClick={() => finish('banking')}>Connect or import a bank account</button>
              <button type="button" className="btn-tonal" onClick={() => finish()}>Go to the dashboard</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
