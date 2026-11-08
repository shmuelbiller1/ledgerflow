import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { getIdToken } from '../../firebase';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { CLOSE_ROLES } from '../../lib/periodLock';
import { byCodeUnit } from '../../lib/codeUnitOrder';

/**
 * The month-end currency revaluation (R-07), shown in the currency tool.
 *
 * Nothing here does arithmetic: the panel asks the server for the plan (`/revaluation/preview`, which
 * posts nothing), shows the same numbers it computed, and only posts when the person presses "Post
 * it". That is also why there is no date to choose — the plan is today's, because today's rate is the
 * rate the exchange service gives, and the entry reverses the next day so the documents keep their
 * own rates.
 */

interface Detail {
  id: string; side: 'customer' | 'vendor'; number: string; partyName: string; currency: string;
  openCents: number; bookedRate: number; todayRate: number; bookedBaseCents: number; todayBaseCents: number; deltaCents: number;
}
interface Line { accountId: string; accountName: string; amountCents: number; description: string }
interface Skip { id: string; number: string; reason: string }

interface Plan {
  date: string;
  reversalDate: string;
  baseCurrency: string;
  posted: boolean;
  transactionId: string | null;
  summary: string;
  lines: Line[];
  details: Detail[];
  skipped: Skip[];
  unpriced: string[];
  currencies: string[];
  netGainCents: number;
}

function normalizePlan(value: unknown): Plan {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    date: typeof data.date === 'string' ? data.date : '',
    reversalDate: typeof data.reversalDate === 'string' ? data.reversalDate : '',
    baseCurrency: typeof data.baseCurrency === 'string' ? data.baseCurrency : 'USD',
    posted: data.posted === true,
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : null,
    summary: typeof data.summary === 'string' ? data.summary : 'The revaluation preview returned no details.',
    lines: Array.isArray(data.lines) ? data.lines as Line[] : [],
    details: Array.isArray(data.details) ? data.details as Detail[] : [],
    skipped: Array.isArray(data.skipped) ? data.skipped as Skip[] : [],
    unpriced: Array.isArray(data.unpriced) ? data.unpriced.filter((item): item is string => typeof item === 'string') : [],
    currencies: Array.isArray(data.currencies) ? data.currencies.filter((item): item is string => typeof item === 'string') : [],
    netGainCents: typeof data.netGainCents === 'number' ? data.netGainCents : 0,
  };
}

async function ask(path: string, body: Record<string, unknown>, method = 'POST'): Promise<unknown> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.message || data.error || 'The revaluation could not be run'));
  return data;
}

export function FxRevaluationPanel() {
  const id = useId();
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const base = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // the pair that may close a period is the pair that may post a period entry
  const canRun = CLOSE_ROLES.includes(useCurrentRole());
  const today = getLocalDateISO();
  const [valuationDate, setValuationDate] = useState(today);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rateCurrencies, setRateCurrencies] = useState<string[]>([]);
  const [manualRates, setManualRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const historical = valuationDate < today;

  const requestRates = (): Record<string, number> => Object.fromEntries(rateCurrencies.flatMap(currency => {
    const text = manualRates[currency]?.trim();
    const rate = text ? Number(text) : Number.NaN;
    return Number.isFinite(rate) && rate > 0 ? [[currency, rate]] : [];
  }));

  const run = async (kind: 'preview' | 'run' | 'undo') => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body = kind === 'undo'
        ? { workspaceId, date: plan?.date || valuationDate }
        : { workspaceId, date: valuationDate, ...(historical ? { rates: requestRates() } : {}) };
      const response = await ask(`/api/v1/transactions/revaluation/${kind}`, body);
      if (kind === 'undo') {
        setPlan(null);
        setRateCurrencies([]);
        setManualRates({});
        setSuccess('The revaluation is reversed.');
        toast.success('The revaluation is reversed.');
        return;
      }
      const data = normalizePlan(response);
      setPlan(data);
      if (historical) {
        setRateCurrencies(previous => [...new Set([...previous, ...data.currencies, ...data.unpriced])].sort(byCodeUnit));
      } else {
        setRateCurrencies([]);
        setManualRates({});
      }
      if (kind === 'preview' && data.lines.length === 0 && data.unpriced.length === 0) toast.info(data.summary);
      if (kind === 'run') toast.success(data.posted ? `Posted. It reverses on ${data.reversalDate}.` : data.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The revaluation could not be run';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const chooseDate = (value: string) => {
    setValuationDate(value);
    setPlan(null);
    setRateCurrencies([]);
    setManualRates({});
    setError('');
    setSuccess('');
  };

  const setRate = (currency: string, value: string) => {
    setManualRates(previous => ({ ...previous, [currency]: value }));
    setPlan(null);
    setError('');
    setSuccess('');
  };

  const money = (cents: number, currency?: string) => formatCurrency(cents, currency || base);
  const nothingToPost = !plan || plan.lines.length === 0 || plan.unpriced.length > 0;

  return (
    <div className="space-y-3 pt-4 border-t border-[var(--line)] mt-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">Revalue open foreign invoices and bills</h3>
        <p className="text-xs text-[var(--muted)]">
          {historical
            ? `For ${valuationDate}, enter that day’s rate for each open foreign currency. The entry is dated ${valuationDate} and reverses on the next day, so your invoices and bills keep their booked rates.`
            : `What the open ${base} balances look like at today’s rates: each document’s own open amount times today’s rate, against what is in the books. The difference goes to an unrealized FX gain/loss account, and the entry reverses the next day. Only an owner or an accountant posts it.`}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-date`} className="block text-xs font-semibold text-[var(--text)]">Date to value balances at</label>
        <input id={`${id}-date`} type="date" value={valuationDate} max={today} aria-describedby={`${id}-date-help`}
          disabled={busy || Boolean(plan?.posted)} onChange={event => chooseDate(event.target.value)}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] disabled:opacity-50" />
        <p id={`${id}-date-help`} className="text-xs text-[var(--muted)]">
          Today uses the live exchange rate. For an earlier date, choose a month-end; you will type that day’s rates after checking which currencies are open.
        </p>
      </div>

      {historical && rateCurrencies.length > 0 && (
        <fieldset disabled={busy || Boolean(plan?.posted)} className="space-y-2 rounded-lg border border-[var(--line)] p-3 disabled:opacity-60">
          <legend className="px-1 text-xs font-semibold text-[var(--text)]">Rates on {valuationDate}</legend>
          <p className="text-xs text-[var(--muted)]">Enter the base-currency value of one unit of each foreign currency. For example, 1 EUR = 1.08 {base}.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {rateCurrencies.map(currency => (
              <div key={currency}>
                <label htmlFor={`${id}-rate-${currency}`} className="mb-1 block text-xs text-[var(--muted)]">1 {currency} in {base} on {valuationDate}</label>
                <input id={`${id}-rate-${currency}`} type="number" min="0.00000001" step="any" inputMode="decimal"
                  value={manualRates[currency] || ''} onChange={event => setRate(currency, event.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]" />
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {error && <p role="alert" className="text-xs text-[var(--neg)]">{error}</p>}
      {success && <p role="status" className="text-xs text-[var(--pos)]">{success}</p>}

      {plan && (
        <div className="space-y-2 text-xs">
          <p role="status" className="font-semibold text-[var(--text)]">{plan.summary}</p>
          {plan.unpriced.length > 0 && (
            <p className="text-[var(--neg)]">This preview is incomplete; no partial entry can be posted. Enter every missing rate and check again.</p>
          )}
          {plan.unpriced.length === 0 && plan.details.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">What the revaluation moves, document by document</caption>
                <thead>
                  <tr className="text-left text-[var(--muted)]">
                    <th scope="col" className="py-1 pr-3 font-semibold">Document</th>
                    <th scope="col" className="py-1 pr-3 font-semibold">Open</th>
                    <th scope="col" className="py-1 pr-3 font-semibold text-right">Booked at</th>
                    <th scope="col" className="py-1 pr-3 font-semibold text-right">{historical ? `Rate on ${valuationDate}` : 'Today at'}</th>
                    <th scope="col" className="py-1 pr-3 font-semibold text-right">In {base}</th>
                    <th scope="col" className="py-1 font-semibold text-right">Moves by</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.details.map(d => (
                    <tr key={`${d.side}:${d.id}`} className="border-t border-[var(--line)]">
                      <th scope="row" className="py-1 pr-3 text-left font-normal text-[var(--text)]">
                        {d.number}<span className="block text-[var(--muted)]">{d.partyName}</span>
                      </th>
                      <td className="py-1 pr-3 text-[var(--text)] whitespace-nowrap">{money(d.openCents, d.currency)}</td>
                      <td className="py-1 pr-3 text-right text-[var(--muted)] tabular-nums">{d.bookedRate.toFixed(4)}</td>
                      <td className="py-1 pr-3 text-right text-[var(--muted)] tabular-nums">{d.todayRate.toFixed(4)}</td>
                      <td className="py-1 pr-3 text-right text-[var(--muted)] tabular-nums whitespace-nowrap">{money(d.bookedBaseCents)} → {money(d.todayBaseCents)}</td>
                      <td className="py-1 text-right font-semibold tabular-nums text-[var(--text)]">{money(d.deltaCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.unpriced.length === 0 && plan.lines.length > 0 && (
            <ul className="space-y-1">
              {plan.lines.map(l => (
                <li key={`${l.accountId}:${l.description}`} className="flex justify-between gap-3">
                  <span className="text-[var(--text)]">{l.accountName}<span className="block text-[var(--muted)]">{l.description}</span></span>
                  <span className="shrink-0 font-semibold tabular-nums text-[var(--text)]">{money(l.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
          {plan.skipped.length > 0 && (
            <details className="text-[var(--muted)]">
              <summary>{plan.skipped.length} {plan.skipped.length === 1 ? 'document' : 'documents'} left out, and why</summary>
              <ul className="mt-1 space-y-1">
                {plan.skipped.map(s => <li key={`${s.id}:${s.reason}`}>{s.number || s.id}: {s.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => run('preview')}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold text-[var(--text)] disabled:opacity-50">
          {busy ? 'Working…' : plan ? `Check rates for ${valuationDate} again` : 'Show what would move'}
        </button>
        {plan && !plan.posted && (
          <button type="button" disabled={busy || nothingToPost || !canRun} onClick={() => run('run')}
            title={canRun ? 'Posts the entry and the one that reverses it tomorrow' : 'Owners and accountants post ledger entries'}
            className="rounded-lg bg-[var(--brass)] px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
            Post it
          </button>
        )}
        {plan?.posted && (
          <button type="button" disabled={busy || !canRun} onClick={() => run('undo')}
            title="Reverses it now instead of waiting for tomorrow"
            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold text-[var(--text)] disabled:opacity-50">
            Undo it
          </button>
        )}
        {plan?.posted && (
          <p className="text-xs text-[var(--muted)]">
            Posted for {plan.date}: entry <code className="font-mono">{String(plan.transactionId || '').slice(0, 8)}</code>, reversing on {plan.reversalDate}.
          </p>
        )}
        {!canRun && <p className="text-xs text-[var(--muted)]">An owner or an accountant can post this; you can see what it would do.</p>}
      </div>
    </div>
  );
}

export default FxRevaluationPanel;
