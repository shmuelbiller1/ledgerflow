import { RowTable } from '../ui/RowTable';
import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GroupedRowTable } from '../ui/RowTable';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { exportGroupSummaryCsv } from '../../lib/groupSummaryExport';
import { ratesKey, type WorkspaceGroup } from '../../lib/workspaceGroups';
import { averageFromTimeframe, parseRates, rateFromQuote, type TranslationRates } from '../../lib/translationRates';
import { useReportText, fill as fillText } from './useReportText';

interface Figures { income: number; cogs: number; grossProfit: number; expense: number; netIncome: number; totalAssets: number; totalLiabilities: number; totalEquity: number }
interface Member extends Figures { workspaceId: string; name: string; currency: string; isBalanced: boolean; share?: number; associate?: boolean; translated?: Figures & { cta: number } }
interface Issue { workspaceId: string; transactionId: string; date: string; description: string; amountCents: number; currency: string; withName: string | null; reason: 'missing' | 'undone' | 'amount' | 'outside-group' | 'not-open'; otherAmountCents?: number }
interface Eliminated { assets: number; liabilities: number; difference: number; income?: number; cogs?: number; expense?: number; profitDifference?: number; investment?: number; goodwill?: number; belowBookValue?: number }
interface OtherOwners { equity: number; netIncome: number }
interface AccountLine { key: string; section: 'income' | 'cogs' | 'expense' | 'asset' | 'liability' | 'equity'; name: string; code?: string; alsoNamed?: string[]; combined?: string[]; byMember: Record<string, number>; total: number }
const SECTION_ORDER: AccountLine['section'][] = ['income', 'cogs', 'expense', 'asset', 'liability', 'equity'];
const sectionName = (sec: AccountLine['section'], reportText: ReturnType<typeof useReportText>) => ({
  income: reportText('r.gs-income', 'Income'), cogs: reportText('r.gs-cogs', 'Cost of goods sold'), expense: reportText('r.gs-expenses', 'Expenses'),
  asset: reportText('r.gs-assets', 'Assets'), liability: reportText('r.gs-liabilities', 'Liabilities'), equity: reportText('r.gs-equity', 'Equity'),
}[sec]);
interface Summary { group: { id: string; name: string }; members: Member[]; total: (Figures & { currency: string; cta?: number; eliminated?: Eliminated; otherOwners?: OtherOwners; associates?: { profit: number; equity: number } }) | null; parent?: { workspaceId: string; name: string } | null; accountLines?: AccountLine[]; lineMerges?: { canCombine: boolean; merges: Record<string, string> }; notIncluded: number; intercompany?: { matched: number; unmatched: Issue[] } }

/** Why an intercompany entry has no match (Z-19), in words. */
const whyUnmatched = (i: Issue, reportText: ReturnType<typeof useReportText>) => ({
  missing: fillText(reportText('r.gs-match-missing', 'Its match in {0} is missing'), { 0: i.withName ?? '' }),
  undone: fillText(reportText('r.gs-match-undone', 'Its match in {0} was undone'), { 0: i.withName ?? '' }),
  amount: fillText(reportText('r.gs-match-amount', '{0} in {1}'), { 0: formatCurrency(i.otherAmountCents || 0, i.currency), 1: i.withName ?? '' }),
  'outside-group': reportText('r.gs-outside-group', 'The other company is not in this group'),
  'not-open': reportText('r.gs-not-open', 'The other company is not one you can open'),
}[i.reason]);
type Entered = Record<string, Partial<Record<keyof TranslationRates, string>>>;

const rowsFor = (reportText: (key: string, fallback: string) => string): Array<{ key: keyof Figures; label: string; report: 'pnl' | 'balance-sheet'; strong?: boolean }> => [
  { key: 'income', label: reportText('r.section-income', 'Income'), report: 'pnl' },
  { key: 'cogs', label: reportText('r.section-cogs', 'Cost of goods sold'), report: 'pnl' },
  { key: 'grossProfit', label: reportText('r.gross-profit', 'Gross profit'), report: 'pnl', strong: true },
  { key: 'expense', label: reportText('r.section-expense', 'Expenses'), report: 'pnl' },
  { key: 'netIncome', label: reportText('r.net-income', 'Net income'), report: 'pnl', strong: true },
  { key: 'totalAssets', label: reportText('r.total-assets', 'Total assets'), report: 'balance-sheet' },
  { key: 'totalLiabilities', label: reportText('r.total-liabilities', 'Total liabilities'), report: 'balance-sheet' },
  { key: 'totalEquity', label: reportText('r.equity-with-this-year-s-profit', 'Equity (with this year’s profit)'), report: 'balance-sheet' },
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
  const reportText = useReportText();
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
      toast.error(commandErrorMessage(err, uiLanguageNow()));
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
      toast.error(commandErrorMessage(err, uiLanguageNow()));
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
        <h2 id="group-summary-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.group-summary', 'Group summary')}</h2>
        {summary && (
          <button
            type="button"
            onClick={() => exportGroupSummaryCsv(summary, startDate, endDate)}
            className="btn-secondary min-h-11 px-4 rounded-xl text-sm font-semibold"
          >
            {reportText('r.export-csv', 'Export CSV')}
          </button>
        )}
      </div>
      {groups !== null && groups.length === 0 && !error && (
        <p className="text-sm text-[var(--muted)]">{reportText('r.you-have-no-groups-of-books-yet-settings-groups', 'You have no groups of books yet (Settings → Groups of books). This workspace can be shown on its own, in another currency too.')}</p>
      )}
      {groups !== null && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.group', 'Group')}
            <select value={groupId} onChange={e => setGroupId(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              {current && <option value={selfId}>{reportText('r.this-workspace-only', 'This workspace only (')}{current.name})</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.from', 'From')}
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.to', 'To')}
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          </label>
          <label className="flex items-center gap-2 text-[var(--muted)] pb-1.5">
            <input type="checkbox" checked={byAccount} onChange={e => setByAccount(e.target.checked)} /> {reportText('r.account-by-account', 'Account by account')}
          </label>
          {memberCurrencies.length > 0 && (
            <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.in-one-currency', 'In one currency')}
              <select value={reportCurrency} onChange={e => setReportCurrency(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
                <option value="">{reportText('r.each-in-its-own', 'Each in its own')}</option>
                {memberCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {foreign.map(currency => (
        <fieldset key={currency} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--line)] p-3 text-xs">
          <legend className="px-1 font-semibold text-[var(--text)]">{reportText('r.1', '1')} {currency} {reportText('r.in', 'in')} {reportCurrency}</legend>
          {rateInput(currency, 'closing', fillText(reportText('r.gs-rate-closing', 'At {0} (assets, liabilities)'), { 0: formatDate(endDate) }))}
          {rateInput(currency, 'average', reportText('r.gs-rate-average', 'Average (income, costs)'))}
          {rateInput(currency, 'historical', reportText('r.gs-rate-historical', 'Historical (equity)'))}
          <button type="button" onClick={() => void fill(currency)} disabled={filling !== ''} className="rounded-lg border border-[var(--line)] px-2.5 py-1 font-semibold text-[var(--text)] disabled:opacity-50">
            {reportText('r.fill-from-the-rate-service', 'Fill from the rate service')}<span className="sr-only"> {reportText('r.for', 'for')} {currency}</span>
          </button>
        </fieldset>
      ))}
      {'problem' in parsed && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{parsed.problem} {reportText('r.to-see-the-group-in', 'to see the group in')} {reportCurrency}.</p>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {summary && (
        <>
          {summary.parent && (
            <p className="text-xs text-[var(--muted)]">
              {reportText('r.parent', 'Parent:')} <bdi>{summary.parent.name}</bdi>{reportText('r.each-company-it-owns-is-added-in-full-the-part-t', '. Each company it owns is added in full; the part that belongs to its other owners is shown under the total.')}
            </p>
          )}
          {summary.notIncluded > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{summary.notIncluded === 1 ? reportText('r.one-workspace-not-included', '1 workspace in this group is no longer open to you and is not included.') : fillText(reportText('r.n-workspaces-not-included', '{n} workspaces in this group are no longer open to you and are not included.'), { n: summary.notIncluded })}</p>}
          {!summary.total && summary.members.length > 1 && currencies.size > 1 && (
            <p className="text-xs text-[var(--muted)]">{reportText('r.no-group-total-these-books-are-in', 'No group total: these books are in')} {[...currencies].join(', ')}{reportText('r.choose-one-currency-to-add-them-up', '. Choose one currency to add them up.')}</p>
          )}
          {summary.members.filter(m => !m.isBalanced).map(m => (
            <p key={m.workspaceId} role="alert" className="text-xs text-amber-700 dark:text-amber-400">{reportText('r.the-balance-sheet-of', 'The balance sheet of')} {m.name} {reportText('r.does-not-balance-check-it-in-its-own-books', 'does not balance: check it in its own books.')}</p>
          ))}
          <div className="overflow-x-auto">
            <GroupedRowTable
              caption={<>{summary.group.name}{reportText('r.each-company-side-by-side', ': each company side by side')}</>}
              captionClassName="sr-only"
              tableClassName="w-full text-sm"
              head={[{ className: "border-b border-[var(--line)] text-[var(--muted)]", cells: [
                { scope: 'col', className: "text-left font-semibold py-2", content: <span className="sr-only">{reportText('r.figure', 'Figure')}</span> },
                ...summary.members.map(m => ({ key: m.workspaceId, scope: 'col', className: "text-right font-semibold py-2 px-2", content: <><bdi>{m.name}</bdi>{summary.parent && m.workspaceId !== summary.parent.workspaceId && <span className="block text-xs font-normal">{m.share ?? 100}{reportText('r.owned', '% owned')}{m.associate ? reportText('r.equity-method-not-added', ': equity method, not added') : ''}</span>}</> })),
                ...summary.total ? [{ scope: 'col', className: "text-right font-semibold py-2 px-2", content: reportText('r.group-total', 'Group total') }] : [],
              ] }]}
              groups={[{ rows: [
                ...rowsFor(reportText).map(row => ({ key: row.key, className: `border-b border-[var(--line)]/50 ${row.strong ? 'font-semibold' : ''}`, cells: [
                  { scope: 'row', className: "text-left font-normal py-1.5", content: row.label },
                  ...summary.members.map(m => ({ key: m.workspaceId, className: "text-right font-mono py-1.5 px-2", content: (
                    <button type="button" onClick={() => open(m, row.report)} className="hover:underline" title={fillText(reportText('r.open-the-0-of-1', 'Open the {0} of {1}'), { 0: row.report === 'pnl' ? reportText('r.profit-and-loss-lc', 'profit and loss') : reportText('r.balance-sheet-lc', 'balance sheet'), 1: m.name })}>
                      {m.translated && summary.total ? formatCurrency(m.translated[row.key], summary.total.currency) : formatCurrency(m[row.key], m.currency)}<span className="sr-only"> {row.label} {reportText('r.of', 'of')} {m.name}{reportText('r.open-its-report', ': open its report')}</span>
                    </button>
                  ) })),
                  ...summary.total ? [{ className: "text-right font-mono py-1.5 px-2", content: formatCurrency(summary.total[row.key], summary.total.currency) }] : [],
                ] })),
                summary.members.some(m => m.translated) && summary.total && ({ key: 'translation-difference', className: "border-b border-[var(--line)]/50 text-[var(--muted)]", cells: [
                  { scope: 'row', className: "text-left font-normal py-1.5", content: reportText('r.of-which-translation-difference', 'of which translation difference') },
                  ...summary.members.map(m => ({ key: m.workspaceId, className: "text-right font-mono py-1.5 px-2", content: formatCurrency(m.translated?.cta || 0, summary.total!.currency) })),
                  { className: "text-right font-mono py-1.5 px-2", content: formatCurrency(summary.total.cta || 0, summary.total.currency) },
                ] }),
                summary.total?.otherOwners && ([['netIncome', 'of which net income of other owners'], ['totalEquity', 'of which equity of other owners']] as const).map(([key, label]) => ({ key, className: "border-b border-[var(--line)]/50 text-[var(--muted)]", cells: [
                  { scope: 'row', className: "text-left font-normal py-1.5", content: label },
                  ...summary.members.map(m => {
                    const figure = m.translated ? m.translated[key] : m[key];
                    return { key: m.workspaceId, className: "text-right font-mono py-1.5 px-2", content: m.associate ? '' : formatCurrency(Math.round(figure * (100 - (m.share ?? 100)) / 100), m.translated ? summary.total!.currency : m.currency) };
                  }),
                  { className: "text-right font-mono py-1.5 px-2", content: formatCurrency(summary.total!.otherOwners![key === 'netIncome' ? 'netIncome' : 'equity'], summary.total!.currency) },
                ] })),
                summary.total?.associates && ([['profit', 'of which net income: share of associates\' profit'], ['equity', 'of which equity: share of associates\' equity since bought']] as const).map(([key, label]) => ({ key, className: "border-b border-[var(--line)]/50 text-[var(--muted)]", cells: [
                  { scope: 'row', className: "text-left font-normal py-1.5", content: label },
                  ...summary.members.map(m => ({ key: m.workspaceId, className: "py-1.5 px-2", content: '' })),
                  { className: "text-right font-mono py-1.5 px-2", content: formatCurrency(summary.total!.associates![key], summary.total!.currency) },
                ] })),
              ] }]}
            />
          </div>
          {byAccount && summary.accountLines && summary.total && (
            <div className="overflow-x-auto">
              <GroupedRowTable
                caption={<>{reportText('r.each-account-across-the-companies-matched-by-cod', 'Each account across the companies (matched by code, else by name), as each company\'s books have it; what is taken out between the companies comes off the totals above, not these lines.')}</>}
                captionClassName="text-left text-xs text-[var(--muted)] pb-1"
                tableClassName="w-full text-sm"
                head={[{ className: "border-b border-[var(--line)] text-[var(--muted)]", cells: [
                  { scope: 'col', className: "text-left font-semibold py-2", content: reportText('r.account', 'Account') },
                  ...summary.members.map(m => ({ key: m.workspaceId, scope: 'col', className: "text-right font-semibold py-2 px-2", content: <bdi>{m.name}</bdi> })),
                  { scope: 'col', className: "text-right font-semibold py-2 px-2", content: reportText('r.together', 'Together') },
                ] }]}
                groups={SECTION_ORDER.filter(sec => summary.accountLines!.some(l => l.section === sec)).map(sec => ({
                  key: sec,
                  rows: [
                    { cells: [{ scope: 'rowgroup', colSpan: summary.members.length + 2, className: "text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)] pt-3", content: sectionName(sec, reportText) }] },
                    ...summary.accountLines!.filter(l => l.section === sec).map(l => ({ key: l.key, className: "border-b border-[var(--line)]/50", cells: [
                      { scope: 'row', className: "text-left font-normal py-1", content: (<>
                          {l.code ? <span className="font-mono text-xs text-[var(--muted)]">{l.code} </span> : null}<bdi>{l.name}</bdi>
                          {l.alsoNamed && <span className="block text-[10px] text-[var(--muted)]">{reportText('r.also-called', 'also called')} {l.alsoNamed.join(', ')}</span>}
                          {summary.lineMerges?.canCombine && (
                            <span className="flex flex-wrap gap-2 text-[10px]">
                              <select aria-label={fillText(reportText('r.combine-0-with', 'Combine {0} with'), { 0: l.name })} value="" className="max-w-[12rem] border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]"
                                onChange={e => { if (e.target.value) void combine({ ...summary.lineMerges!.merges, [l.key]: e.target.value }); }}>
                                <option value="">{reportText('r.combine-with', 'Combine with…')}</option>
                                {summary.accountLines!.filter(o => o.section === l.section && o.key !== l.key).map(o => <option key={o.key} value={o.key}>{o.code ? `${o.code} ` : ''}{o.name}</option>)}
                              </select>
                              {(l.combined || []).map(from => (
                                <button key={from} type="button" className="text-indigo-600 dark:text-indigo-400 hover:underline"
                                  onClick={() => { const next = { ...summary.lineMerges!.merges }; delete next[from]; void combine(next); }}>
                                  {reportText('r.undo', 'Undo')} {from.split('|')[1]?.replace(/^(code|name):/, '')}
                                </button>
                              ))}
                            </span>
                          )}
                        </>) },
                      ...summary.members.map(m => ({ key: m.workspaceId, className: "text-right font-mono py-1 px-2", content: l.byMember[m.workspaceId] ? formatCurrency(l.byMember[m.workspaceId], summary.total!.currency) : '' })),
                      { className: "text-right font-mono py-1 px-2", content: formatCurrency(l.total, summary.total!.currency) },
                    ] })),
                  ],
                }))}
              />
            </div>
          )}
          {byAccount && !summary.total && <p className="text-xs text-[var(--muted)]">{reportText('r.account-by-account-needs-one-currency-choose-it', 'Account by account needs one currency: choose it above.')}</p>}
          {summary.total?.eliminated && (summary.total.eliminated.assets !== 0 || summary.total.eliminated.liabilities !== 0) && (
            <p className="text-xs text-[var(--muted)]">
              {reportText('r.taken-out-of-the-group-total', 'Taken out of the group total:')} {formatCurrency(summary.total.eliminated.assets, summary.total.currency)} {reportText('r.owed-to-the-companies-by-each-other-and', 'owed to the companies by each other, and')} {formatCurrency(summary.total.eliminated.liabilities, summary.total.currency)} {reportText('r.they-owe-each-other', 'they owe each other.')}
            </p>
          )}
          {summary.total?.eliminated && Boolean(summary.total.eliminated.income || summary.total.eliminated.cogs || summary.total.eliminated.expense) && (
            <p className="text-xs text-[var(--muted)]">
              {reportText('r.sales-between-the-companies-taken-out', 'Sales between the companies taken out:')} {formatCurrency(summary.total.eliminated.income || 0, summary.total.currency)} {reportText('r.of-income-and', 'of income, and')} {formatCurrency((summary.total.eliminated.cogs || 0) + (summary.total.eliminated.expense || 0), summary.total.currency)} {reportText('r.of-costs-on-the-other-side', 'of costs on the other side.')}
            </p>
          )}
          {summary.total?.eliminated && Boolean(summary.total.eliminated.profitDifference) && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              {reportText('r.the-two-sides-of-the-sales-between-the-companies', 'The two sides of the sales between the companies differ by')} {formatCurrency(summary.total.eliminated.profitDifference || 0, summary.total.currency)} {reportText('r.kept-in-net-income-so-it-stays-each-company-s-ow', '(kept in net income, so it stays each company\'s own): see the dealings below.')}
            </p>
          )}
          {summary.total?.eliminated?.investment ? (
            <p className="text-xs text-[var(--muted)]">
              {reportText('r.the-parent-s-investment-in-its-companies', 'The parent\'s investment in its companies,')} {formatCurrency(summary.total.eliminated.investment, summary.total.currency)}{reportText('r.is-taken-out-of-the-total-assets-and-equity', ', is taken out of the total assets and equity')}
              {summary.total.eliminated.goodwill !== undefined
                ? <>{reportText('r.except-goodwill', ', except goodwill:')} {formatCurrency(summary.total.eliminated.goodwill, summary.total.currency)} {reportText('r.paid-above-its-share-of-the-companies-book-value', 'paid above its share of the companies\' book value on the day bought, kept in the total.')}{summary.total.eliminated.belowBookValue ? <> {reportText('r.it-paid', 'It paid')} {formatCurrency(summary.total.eliminated.belowBookValue, summary.total.currency)} {reportText('r.below-that-share-for-some-of-them-left-in-equity', 'below that share for some of them (left in equity).')}</> : null}</>
                : <> {reportText('r.give-the-day-each-company-was-bought-in-settings', '(give the day each company was bought in Settings → Groups of books to see the goodwill).')}</>}
            </p>
          ) : null}
          {summary.total?.eliminated && summary.total.eliminated.difference !== 0 && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              {reportText('r.what-the-companies-say-they-owe-each-other-diffe', 'What the companies say they owe each other differs by')} {formatCurrency(summary.total.eliminated.difference, summary.total.currency)} {reportText('r.kept-in-equity-so-the-total-balances-see-the-dea', '(kept in equity so the total balances): see the dealings below.')}
            </p>
          )}
          {summary.intercompany && (summary.intercompany.matched > 0 || summary.intercompany.unmatched.length > 0) && (
            <section aria-labelledby="group-dealings-title" className="space-y-2">
              <h3 id="group-dealings-title" className="text-sm font-semibold text-[var(--text)]">{reportText('r.dealings-between-the-companies', 'Dealings between the companies')}</h3>
              <p className="text-xs text-[var(--muted)]">
                {summary.intercompany.matched} {reportText('r.matched-on-both-sides', 'matched on both sides')}{summary.intercompany.unmatched.length ? fillText(reportText('r.0-without-a-match', '; {0} without a match:'), { 0: summary.intercompany.unmatched.length }) : '.'}
              </p>
              {summary.intercompany.unmatched.length > 0 && (
                <RowTable
caption={reportText('r.dealings-between-the-companies-without-a-match', 'Dealings between the companies without a match')}
captionClassName={"sr-only"}
tableClassName={"w-full text-xs"}
headRowClassName={''}
headerRowClassName={"border-b border-[var(--line)] text-[var(--muted)]"}
bodyClassName={''}
rows={summary.intercompany.unmatched.map((i) => { const member = summary.members.find(m => m.workspaceId === i.workspaceId);
return { i, member }; })}
rowKey={({ i }) => `${i.workspaceId}-${i.transactionId}`}
rowHeaderClassName={'font-normal text-start'}
rowClassName={"border-b border-[var(--line)]/50"}
columns={[
{ header: reportText('r.company', 'Company'), headClassName: "text-left font-semibold py-1", className: "py-1", cell: ({ i, member }) => (<bdi>{member?.name || i.workspaceId}</bdi>) },
{ header: reportText('r.entry', 'Entry'), headClassName: "text-left font-semibold py-1", className: "py-1", cell: ({ i }) => (<button type="button" className="text-indigo-600 dark:text-indigo-400 hover:underline"
                              onClick={() => { setCurrentWorkspaceId(i.workspaceId); openRecord({ type: 'transaction', id: i.transactionId }); }}>
                              {i.date}: <bdi>{i.description || reportText('r.entry-2', 'entry')}</bdi>
                            </button>) },
{ header: reportText('r.amount', 'Amount'), headClassName: "text-right font-semibold py-1", className: "py-1 text-right font-mono", cell: ({ i }) => (formatCurrency(i.amountCents, i.currency)) },
{ header: reportText('r.what-is-wrong', 'What is wrong'), headClassName: "text-left font-semibold py-1 pl-2", className: "py-1 pl-2", cell: ({ i }) => (whyUnmatched(i, reportText)) }
]}
/>
              )}
            </section>
          )}
          <p className="text-xs text-[var(--muted)]">{reportText('r.each-company-is-read-from-its-own-books-as-you-c', 'Each company is read from its own books, as you can see them. Balances and sales between the companies are taken out of the total, and the parent\'s investment when its account is chosen in Settings → Groups of books.')}</p>
        </>
      )}
    </section>
  );
}
