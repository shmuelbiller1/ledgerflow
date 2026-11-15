import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { exportGroupSummaryCsv } from '../../lib/groupSummaryExport';
import { ratesKey, type WorkspaceGroup } from '../../lib/workspaceGroups';
import { averageFromTimeframe, parseRates, rateFromQuote, type TranslationRates } from '../../lib/translationRates';

interface Figures { income: number; cogs: number; grossProfit: number; expense: number; netIncome: number; totalAssets: number; totalLiabilities: number; totalEquity: number }
interface Member extends Figures { workspaceId: string; name: string; currency: string; isBalanced: boolean; share?: number; associate?: boolean; translated?: Figures & { cta: number } }
interface Issue { workspaceId: string; transactionId: string; date: string; description: string; amountCents: number; currency: string; withName: string | null; reason: 'missing' | 'undone' | 'amount' | 'outside-group' | 'not-open'; otherAmountCents?: number }
interface Eliminated { assets: number; liabilities: number; difference: number; income?: number; cogs?: number; expense?: number; profitDifference?: number; investment?: number; goodwill?: number; belowBookValue?: number }
interface OtherOwners { equity: number; netIncome: number }
interface AccountLine { key: string; section: 'income' | 'cogs' | 'expense' | 'asset' | 'liability' | 'equity'; name: string; code?: string; alsoNamed?: string[]; combined?: string[]; byMember: Record<string, number>; total: number }
const SECTION_NAMES: Record<AccountLine['section'], string> = { income: 'Income', cogs: 'Cost of goods sold', expense: 'Expenses', asset: 'Assets', liability: 'Liabilities', equity: 'Equity' };
interface Summary { group: { id: string; name: string }; members: Member[]; total: (Figures & { currency: string; cta?: number; eliminated?: Eliminated; otherOwners?: OtherOwners; associates?: { profit: number; equity: number } }) | null; parent?: { workspaceId: string; name: string } | null; accountLines?: AccountLine[]; lineMerges?: { canCombine: boolean; merges: Record<string, string> }; notIncluded: number; intercompany?: { matched: number; unmatched: Issue[] } }

/** Why an intercompany entry has no match (Z-19), in words. */
const whyUnmatched = (i: Issue) => ({
  missing: `Its match in ${i.withName} is missing`,
  undone: `Its match in ${i.withName} was undone`,
  amount: `${formatCurrency(i.otherAmountCents || 0, i.currency)} in ${i.withName}`,
  'outside-group': 'The other company is not in this group',
  'not-open': 'The other company is not one you can open',
}[i.reason]);
type Entered = Record<string, Partial<Record<keyof TranslationRates, string>>>;

const ROWS: Array<{ key: keyof Figures; label: string; report: 'pnl' | 'balance-sheet'; strong?: boolean }> = [
  { key: 'income', label: 'Income', report: 'pnl' },
  { key: 'cogs', label: 'Cost of goods sold', report: 'pnl' },
  { key: 'grossProfit', label: 'Gross profit', report: 'pnl', strong: true },
  { key: 'expense', label: 'Expenses', report: 'pnl' },
  { key: 'netIncome', label: 'Net income', report: 'pnl', strong: true },
  { key: 'totalAssets', label: 'Total assets', report: 'balance-sheet' },
  { key: 'totalLiabilities', label: 'Total liabilities', report: 'balance-sheet' },
  { key: 'totalEquity', label: 'Equity (with this year’s profit)', report: 'balance-sheet' },
];

async function get<T>(url: string): Promise<T> {
  return runCommand<T>({ path: url });
}

/** Z-17: keep the rates used for a period on the group; a convenience, so a failure only means retyping. */
async function keepRates(groupId: string, body: Record<string, unknown>): Promise<WorkspaceGroup | null> {
  try {
    const data = await runCommand<{ group?: WorkspaceGroup }>({
      path: `/api/v1/account/groups/${encodeURIComponent(groupId)}/rates`,
      method: 'PUT',
      body,
    });
    return data.group ?? null;
  } catch {
    return null;
  }
}

/**
 * Group summary (Z-20): one of your groups of books (Settings → Groups of books) for a period, each
 * company's profit and loss and balance sheet side by side, and the group's total when they all keep
 * their books in the same currency. Each figure opens that company's own report. Read under your own
 * access, never copied (src/server/reports/groupReport.ts). In one currency (Z-17, Z-18): each other
 * currency is translated with the closing, average and historical rates entered (or filled from the
 * rate service), and the translation difference has its own line. Rates that worked are kept on the
 * group for that currency and period, and fill in when the same period is opened again.
 */
export default function GroupSummaryReportView() {
  const setCurrentWorkspaceId = useAuthStore(s => s.setCurrentWorkspaceId);
  // N-07: this workspace on its own, e.g. to show its figures in another currency
  const current = useAuthStore(s => s.getCurrentWorkspace());
  const selfId = current ? `ws:${current.id}` : '';
  const goToPage = useUIStore(s => s.goToPage);
  const openRecord = useUIStore(s => s.openRecord);
  const [groups, setGroups] = useState<WorkspaceGroup[] | null>(null);
  const [picked, setGroupId] = useState('');
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  // the group chosen, else the first one, else this workspace on its own
  const groupId = picked || groups?.[0]?.id || (groups ? selfId : '');
  const [reportCurrency, setReportCurrency] = useState('');
  // Z-20: each account across the companies as well
  const [byAccount, setByAccount] = useState(false);
  // Z-20: asked again after the owner combines lines
  const [version, setVersion] = useState(0);
  // what was typed, for one reporting currency and period; over the rates kept for it (Z-17)
  const [typed, setTyped] = useState<{ key: string; values: Entered }>({ key: '', values: {} });
  const [filling, setFilling] = useState('');
  const periodKey = groupId && reportCurrency ? `${groupId}|${ratesKey(reportCurrency, startDate, endDate)}` : '';
  const kept = groups?.find(g => g.id === groupId)?.rates?.[ratesKey(reportCurrency, startDate, endDate)];
  const entered: Entered = {
    ...Object.fromEntries(Object.entries(kept || {}).map(([c, r]) => [c, { closing: String(r.closing), average: String(r.average), historical: String(r.historical) }])),
    ...(typed.key === periodKey ? typed.values : {}),
  };
  const setEntered = (change: (e: Entered) => Entered) => setTyped({ key: periodKey, values: change(entered) });
  // Z-20: the group's own chart mapping (the owner combines a line into another of its section)
  const combine = async (merges: Record<string, string>) => {
    try {
      await runCommand({ path: `/api/v1/account/groups/${encodeURIComponent(groupId)}/lines`, method: 'PUT', body: { merges } });
      setVersion(v => v + 1);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    }
  };
  const memberCurrencies = [...new Set((summary?.members || []).map(m => m.currency))];
  const foreign = reportCurrency ? memberCurrencies.filter(c => c !== reportCurrency) : [];
  const parsed = parseRates(foreign, entered);
  const translation = reportCurrency && 'rates' in parsed ? { reportCurrency, rates: JSON.stringify(parsed.rates) } : null;
  const query = groupId && startDate && endDate ? new URLSearchParams({ groupId, startDate, endDate, ...(translation || {}), ...(byAccount ? { detail: 'accounts', ...(version ? { v: String(version) } : {}) } : {}) }).toString() : '';

  useEffect(() => {
    let live = true;
    get<{ groups: WorkspaceGroup[] }>('/api/v1/account/groups')
      .then(data => { if (live) setGroups(data.groups || []); })
      .catch(err => { if (live) { setGroups([]); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!query) return;
    let live = true;
    get<Summary>(`/api/v1/reports/group-summary?${query}`)
      .then(data => {
        if (!live) return;
        setSummary(data);
        setError('');
        // Z-17: rates that worked are kept for this period (the group then opens with them)
        const asked = new URLSearchParams(query);
        if (asked.get('rates')) {
          void keepRates(String(asked.get('groupId')), { reportCurrency: asked.get('reportCurrency'), startDate: asked.get('startDate'), endDate: asked.get('endDate'), rates: JSON.parse(String(asked.get('rates'))) })
            .then(group => { if (group) setGroups(list => (list || []).map(g => (g.id === group.id ? group : g))); });
        }
      })
      .catch(err => { if (live) { setSummary(null); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { live = false; };
  }, [query]);

  // Z-17: the rate service fills the three rates of a currency (1 unit in the reporting currency)
  const fill = async (currency: string) => {
    setFilling(currency);
    try {
      const at = (date: string) => get<{ quotes?: Record<string, number> }>(`/api/v1/currency/historical?${new URLSearchParams({ date, source: reportCurrency, currencies: currency })}`);
      const [closing, opening, days] = await Promise.all([
        at(endDate), at(startDate),
        get<{ quotes?: Record<string, Record<string, number>> }>(`/api/v1/currency/timeframe?${new URLSearchParams({ start_date: startDate, end_date: endDate, source: reportCurrency, currencies: currency })}`),
      ]);
      const next = { closing: rateFromQuote(closing.quotes, reportCurrency, currency), average: averageFromTimeframe(days.quotes, reportCurrency, currency), historical: rateFromQuote(opening.quotes, reportCurrency, currency) };
      if (!next.closing || !next.average || !next.historical) throw new Error(`The rate service has no rates for ${currency} on these dates: enter them`);
      setEntered(e => ({ ...e, [currency]: { closing: String(next.closing), average: String(next.average), historical: String(next.historical) } }));
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setFilling('');
    }
  };
  const rateInput = (currency: string, key: keyof TranslationRates, label: string) => (
    <label className="flex flex-col gap-0.5 text-[var(--muted)]">{label}
      <input inputMode="decimal" value={entered[currency]?.[key] ?? ''} onChange={e => setEntered(x => ({ ...x, [currency]: { ...x[currency], [key]: e.target.value } }))}
        className="w-28 px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)] text-right font-mono" />
    </label>
  );

  const open = (member: Member, report: 'pnl' | 'balance-sheet') => {
    setCurrentWorkspaceId(member.workspaceId);
    goToPage({ tab: 'reports', sub: report });
    toast.message(`Opened ${member.name}`);
  };
  const currencies = new Set((summary?.members || []).map(m => m.currency));

  return (
    <section aria-labelledby="group-summary-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="group-summary-title" className="text-lg font-bold text-[var(--text)]">Group summary</h2>
        {summary && (
          <button
            type="button"
            onClick={() => exportGroupSummaryCsv(summary, startDate, endDate)}
            className="btn-secondary min-h-11 px-4 rounded-xl text-sm font-semibold"
          >
            Export CSV
          </button>
        )}
      </div>
      {groups !== null && groups.length === 0 && !error && (
        <p className="text-sm text-[var(--muted)]">You have no groups of books yet (Settings → Groups of books). This workspace can be shown on its own, in another currency too.</p>
      )}
      {groups !== null && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">Group
            <select value={groupId} onChange={e => setGroupId(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              {current && <option value={selfId}>This workspace only ({current.name})</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">From
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">To
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          </label>
          <label className="flex items-center gap-2 text-[var(--muted)] pb-1.5">
            <input type="checkbox" checked={byAccount} onChange={e => setByAccount(e.target.checked)} /> Account by account
          </label>
          {memberCurrencies.length > 0 && (
            <label className="flex flex-col gap-1 text-[var(--muted)]">In one currency
              <select value={reportCurrency} onChange={e => setReportCurrency(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
                <option value="">Each in its own</option>
                {memberCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {foreign.map(currency => (
        <fieldset key={currency} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--line)] p-3 text-xs">
          <legend className="px-1 font-semibold text-[var(--text)]">1 {currency} in {reportCurrency}</legend>
          {rateInput(currency, 'closing', `At ${endDate} (assets, liabilities)`)}
          {rateInput(currency, 'average', 'Average (income, costs)')}
          {rateInput(currency, 'historical', 'Historical (equity)')}
          <button type="button" onClick={() => void fill(currency)} disabled={filling !== ''} className="rounded-lg border border-[var(--line)] px-2.5 py-1 font-semibold text-[var(--text)] disabled:opacity-50">
            Fill from the rate service<span className="sr-only"> for {currency}</span>
          </button>
        </fieldset>
      ))}
      {'problem' in parsed && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{parsed.problem} to see the group in {reportCurrency}.</p>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {summary && (
        <>
          {summary.parent && (
            <p className="text-xs text-[var(--muted)]">
              Parent: <bdi>{summary.parent.name}</bdi>. Each company it owns is added in full; the part that belongs to its other owners is shown under the total.
            </p>
          )}
          {summary.notIncluded > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{summary.notIncluded} workspace{summary.notIncluded === 1 ? '' : 's'} in this group {summary.notIncluded === 1 ? 'is' : 'are'} no longer open to you and {summary.notIncluded === 1 ? 'is' : 'are'} not included.</p>}
          {!summary.total && summary.members.length > 1 && currencies.size > 1 && (
            <p className="text-xs text-[var(--muted)]">No group total: these books are in {[...currencies].join(', ')}. Choose one currency to add them up.</p>
          )}
          {summary.members.filter(m => !m.isBalanced).map(m => (
            <p key={m.workspaceId} role="alert" className="text-xs text-amber-700 dark:text-amber-400">The balance sheet of {m.name} does not balance: check it in its own books.</p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{summary.group.name}: each company side by side</caption>
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                  <th scope="col" className="text-left font-semibold py-2"><span className="sr-only">Figure</span></th>
                  {summary.members.map(m => (
                    <th key={m.workspaceId} scope="col" className="text-right font-semibold py-2 px-2">
                      <bdi>{m.name}</bdi>{summary.parent && m.workspaceId !== summary.parent.workspaceId && <span className="block text-xs font-normal">{m.share ?? 100}% owned{m.associate ? ': equity method, not added' : ''}</span>}
                    </th>
                  ))}
                  {summary.total && <th scope="col" className="text-right font-semibold py-2 px-2">Group total</th>}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(row => (
                  <tr key={row.key} className={`border-b border-[var(--line)]/50 ${row.strong ? 'font-semibold' : ''}`}>
                    <th scope="row" className="text-left font-normal py-1.5">{row.label}</th>
                    {summary.members.map(m => (
                      <td key={m.workspaceId} className="text-right font-mono py-1.5 px-2">
                        <button type="button" onClick={() => open(m, row.report)} className="hover:underline" title={`Open the ${row.report === 'pnl' ? 'profit and loss' : 'balance sheet'} of ${m.name}`}>
                          {m.translated && summary.total ? formatCurrency(m.translated[row.key], summary.total.currency) : formatCurrency(m[row.key], m.currency)}<span className="sr-only"> {row.label} of {m.name}: open its report</span>
                        </button>
                      </td>
                    ))}
                    {summary.total && <td className="text-right font-mono py-1.5 px-2">{formatCurrency(summary.total[row.key], summary.total.currency)}</td>}
                  </tr>
                ))}
                {summary.members.some(m => m.translated) && summary.total && (
                  <tr className="border-b border-[var(--line)]/50 text-[var(--muted)]">
                    <th scope="row" className="text-left font-normal py-1.5">of which translation difference</th>
                    {summary.members.map(m => <td key={m.workspaceId} className="text-right font-mono py-1.5 px-2">{formatCurrency(m.translated?.cta || 0, summary.total!.currency)}</td>)}
                    <td className="text-right font-mono py-1.5 px-2">{formatCurrency(summary.total.cta || 0, summary.total.currency)}</td>
                  </tr>
                )}
                {summary.total?.otherOwners && ([['netIncome', 'of which net income of other owners'], ['totalEquity', 'of which equity of other owners']] as const).map(([key, label]) => (
                  <tr key={key} className="border-b border-[var(--line)]/50 text-[var(--muted)]">
                    <th scope="row" className="text-left font-normal py-1.5">{label}</th>
                    {summary.members.map(m => {
                      const figure = m.translated ? m.translated[key] : m[key];
                      return <td key={m.workspaceId} className="text-right font-mono py-1.5 px-2">{m.associate ? '' : formatCurrency(Math.round(figure * (100 - (m.share ?? 100)) / 100), m.translated ? summary.total!.currency : m.currency)}</td>;
                    })}
                    <td className="text-right font-mono py-1.5 px-2">{formatCurrency(summary.total!.otherOwners![key === 'netIncome' ? 'netIncome' : 'equity'], summary.total!.currency)}</td>
                  </tr>
                ))}
                {summary.total?.associates && ([['profit', 'of which net income: share of associates\' profit'], ['equity', 'of which equity: share of associates\' equity since bought']] as const).map(([key, label]) => (
                  <tr key={key} className="border-b border-[var(--line)]/50 text-[var(--muted)]">
                    <th scope="row" className="text-left font-normal py-1.5">{label}</th>
                    {summary.members.map(m => <td key={m.workspaceId} />)}
                    <td className="text-right font-mono py-1.5 px-2">{formatCurrency(summary.total!.associates![key], summary.total!.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {byAccount && summary.accountLines && summary.total && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="text-left text-xs text-[var(--muted)] pb-1">Each account across the companies (matched by code, else by name), as each company's books have it; what is taken out between the companies comes off the totals above, not these lines.</caption>
                <thead>
                  <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                    <th scope="col" className="text-left font-semibold py-2">Account</th>
                    {summary.members.map(m => <th key={m.workspaceId} scope="col" className="text-right font-semibold py-2 px-2"><bdi>{m.name}</bdi></th>)}
                    <th scope="col" className="text-right font-semibold py-2 px-2">Together</th>
                  </tr>
                </thead>
                {(Object.keys(SECTION_NAMES) as AccountLine['section'][]).filter(sec => summary.accountLines!.some(l => l.section === sec)).map(sec => (
                  <tbody key={sec}>
                    <tr><th scope="rowgroup" colSpan={summary.members.length + 2} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-3">{SECTION_NAMES[sec]}</th></tr>
                    {summary.accountLines!.filter(l => l.section === sec).map(l => (
                      <tr key={l.key} className="border-b border-[var(--line)]/50">
                        <th scope="row" className="text-left font-normal py-1">
                          {l.code ? <span className="font-mono text-xs text-[var(--muted)]">{l.code} </span> : null}<bdi>{l.name}</bdi>
                          {l.alsoNamed && <span className="block text-[10px] text-[var(--muted)]">also called {l.alsoNamed.join(', ')}</span>}
                          {summary.lineMerges?.canCombine && (
                            <span className="flex flex-wrap gap-2 text-[10px]">
                              <select aria-label={`Combine ${l.name} with`} value="" className="max-w-[12rem] border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]"
                                onChange={e => { if (e.target.value) void combine({ ...summary.lineMerges!.merges, [l.key]: e.target.value }); }}>
                                <option value="">Combine with…</option>
                                {summary.accountLines!.filter(o => o.section === l.section && o.key !== l.key).map(o => <option key={o.key} value={o.key}>{o.code ? `${o.code} ` : ''}{o.name}</option>)}
                              </select>
                              {(l.combined || []).map(from => (
                                <button key={from} type="button" className="text-indigo-600 dark:text-indigo-400 hover:underline"
                                  onClick={() => { const next = { ...summary.lineMerges!.merges }; delete next[from]; void combine(next); }}>
                                  Undo {from.split('|')[1]?.replace(/^(code|name):/, '')}
                                </button>
                              ))}
                            </span>
                          )}
                        </th>
                        {summary.members.map(m => <td key={m.workspaceId} className="text-right font-mono py-1 px-2">{l.byMember[m.workspaceId] ? formatCurrency(l.byMember[m.workspaceId], summary.total!.currency) : ''}</td>)}
                        <td className="text-right font-mono py-1 px-2">{formatCurrency(l.total, summary.total!.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {byAccount && !summary.total && <p className="text-xs text-[var(--muted)]">Account by account needs one currency: choose it above.</p>}
          {summary.total?.eliminated && (summary.total.eliminated.assets !== 0 || summary.total.eliminated.liabilities !== 0) && (
            <p className="text-xs text-[var(--muted)]">
              Taken out of the group total: {formatCurrency(summary.total.eliminated.assets, summary.total.currency)} owed to the companies by each other, and {formatCurrency(summary.total.eliminated.liabilities, summary.total.currency)} they owe each other.
            </p>
          )}
          {summary.total?.eliminated && Boolean(summary.total.eliminated.income || summary.total.eliminated.cogs || summary.total.eliminated.expense) && (
            <p className="text-xs text-[var(--muted)]">
              Sales between the companies taken out: {formatCurrency(summary.total.eliminated.income || 0, summary.total.currency)} of income, and {formatCurrency((summary.total.eliminated.cogs || 0) + (summary.total.eliminated.expense || 0), summary.total.currency)} of costs on the other side.
            </p>
          )}
          {summary.total?.eliminated && Boolean(summary.total.eliminated.profitDifference) && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              The two sides of the sales between the companies differ by {formatCurrency(summary.total.eliminated.profitDifference || 0, summary.total.currency)} (kept in net income, so it stays each company's own): see the dealings below.
            </p>
          )}
          {summary.total?.eliminated?.investment ? (
            <p className="text-xs text-[var(--muted)]">
              The parent's investment in its companies, {formatCurrency(summary.total.eliminated.investment, summary.total.currency)}, is taken out of the total assets and equity
              {summary.total.eliminated.goodwill !== undefined
                ? <>, except goodwill: {formatCurrency(summary.total.eliminated.goodwill, summary.total.currency)} paid above its share of the companies' book value on the day bought, kept in the total.{summary.total.eliminated.belowBookValue ? <> It paid {formatCurrency(summary.total.eliminated.belowBookValue, summary.total.currency)} below that share for some of them (left in equity).</> : null}</>
                : <> (give the day each company was bought in Settings → Groups of books to see the goodwill).</>}
            </p>
          ) : null}
          {summary.total?.eliminated && summary.total.eliminated.difference !== 0 && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              What the companies say they owe each other differs by {formatCurrency(summary.total.eliminated.difference, summary.total.currency)} (kept in equity so the total balances): see the dealings below.
            </p>
          )}
          {summary.intercompany && (summary.intercompany.matched > 0 || summary.intercompany.unmatched.length > 0) && (
            <section aria-labelledby="group-dealings-title" className="space-y-2">
              <h3 id="group-dealings-title" className="text-sm font-semibold text-[var(--text)]">Dealings between the companies</h3>
              <p className="text-xs text-[var(--muted)]">
                {summary.intercompany.matched} matched on both sides{summary.intercompany.unmatched.length ? `; ${summary.intercompany.unmatched.length} without a match:` : '.'}
              </p>
              {summary.intercompany.unmatched.length > 0 && (
                <table className="w-full text-xs">
                  <caption className="sr-only">Dealings between the companies without a match</caption>
                  <thead>
                    <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                      <th scope="col" className="text-left font-semibold py-1">Company</th>
                      <th scope="col" className="text-left font-semibold py-1">Entry</th>
                      <th scope="col" className="text-right font-semibold py-1">Amount</th>
                      <th scope="col" className="text-left font-semibold py-1 pl-2">What is wrong</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.intercompany.unmatched.map(i => {
                      const member = summary.members.find(m => m.workspaceId === i.workspaceId);
                      return (
                        <tr key={`${i.workspaceId}-${i.transactionId}`} className="border-b border-[var(--line)]/50">
                          <td className="py-1"><bdi>{member?.name || i.workspaceId}</bdi></td>
                          <td className="py-1">
                            <button type="button" className="text-indigo-600 dark:text-indigo-400 hover:underline"
                              onClick={() => { setCurrentWorkspaceId(i.workspaceId); openRecord({ type: 'transaction', id: i.transactionId }); }}>
                              {i.date}: <bdi>{i.description || 'entry'}</bdi>
                            </button>
                          </td>
                          <td className="py-1 text-right font-mono">{formatCurrency(i.amountCents, i.currency)}</td>
                          <td className="py-1 pl-2">{whyUnmatched(i)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}
          <p className="text-xs text-[var(--muted)]">Each company is read from its own books, as you can see them. Balances and sales between the companies are taken out of the total, and the parent's investment when its account is chosen in Settings → Groups of books.</p>
        </>
      )}
    </section>
  );
}
