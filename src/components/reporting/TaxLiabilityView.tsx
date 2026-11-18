import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Receipt, FileCheck2, AlertTriangle } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency, getLocalDateISO, workspaceYearMonth } from '../../lib/utils';
import { buildTaxReturn, returnChanges, taxByRate } from '../../lib/taxReturnDocs';
import type { TaxableDocument } from '../../lib/taxReturnDocs';
import { TAX_TREATMENTS } from '../../lib/taxCodes';
import type { TaxReturnBox, TaxTreatment } from '../../lib/taxCodes';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { wholeWorkspaceReturn } from '../../lib/tax/filedReturns';
import { RowTable } from '../ui/RowTable';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useReportText } from './useReportText';

const TAX_RETURN_COLLECTIONS = ['bills', 'creditNotes', 'invoices', 'vendorCredits'] as const;

/**
 * The tax return for a period (T-06): boxes in the home currency from invoices, bills, credit
 * notes and vendor credits, plus sales and purchases by treatment. "File this return" keeps a copy
 * on the server (T-07); later changes to that period show as differences against the copy.
 */

interface FiledReturn { id: string; startDate: string; endDate: string; boxes: TaxReturnBox[]; filedAt: string; reference?: string; registration?: string }

interface ReturnsAnswer { returns?: FiledReturn[] }
async function api(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) {
  return runCommand<ReturnsAnswer>({ path, method: init?.method, rawBody: init?.body as string | undefined });
}

interface TaxLiabilityViewProps {
  startDate?: string;
  endDate?: string;
  /** Reports already supplies the page h1; a standalone tax return supplies its own. */
  embedded?: boolean;
}

export default function TaxLiabilityView({ startDate: pageStartDate, endDate: pageEndDate, embedded = false }: TaxLiabilityViewProps = {}) {
  const reportText = useReportText();
  const Heading = embedded ? 'h2' : 'h1';
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const { loading } = useLedgerCollections('bills', 'creditNotes', 'invoices', 'vendorCredits');
  const dataHealth = useScreenDataHealth(TAX_RETURN_COLLECTIONS);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const role = useCurrentRole();
  const canFile = role === 'owner' || role === 'accountant';

  // Follow the Reports page period when it gives one; local edits survive ordinary rerenders.
  const [startDate, setStartDate] = usePageSyncedState(pageStartDate || '', pageStartDate, () => `${workspaceYearMonth().year}-01-01`);
  const [endDate, setEndDate] = usePageSyncedState(pageEndDate || '', pageEndDate, getLocalDateISO);

  const taxReturn = useMemo(() => buildTaxReturn({
    invoices: (invoices || []) as unknown as TaxableDocument[],
    bills: (bills || []) as unknown as TaxableDocument[],
    creditNotes: (creditNotes || []) as unknown as TaxableDocument[],
    vendorCredits: (vendorCredits || []) as unknown as TaxableDocument[],
    startDate, endDate, baseCurrency: currency,
  }), [invoices, bills, creditNotes, vendorCredits, startDate, endDate, currency]);

  const byRate = useMemo(() => taxByRate({
    invoices: (invoices || []) as unknown as TaxableDocument[],
    bills: (bills || []) as unknown as TaxableDocument[],
    creditNotes: (creditNotes || []) as unknown as TaxableDocument[],
    vendorCredits: (vendorCredits || []) as unknown as TaxableDocument[],
    startDate, endDate, baseCurrency: currency,
  }), [invoices, bills, creditNotes, vendorCredits, startDate, endDate, currency]);

  const [filedState, setFiledState] = useState<{ workspaceId: string; returns: FiledReturn[] | null; error: string | null }>({
    workspaceId: '',
    returns: null,
    error: null,
  });
  const filed = filedState.workspaceId === workspaceId ? filedState.returns : null;
  const filedError = filedState.workspaceId === workspaceId ? filedState.error : null;
  const [version, setVersion] = useState(0);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tax-returns`;
  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) return undefined;
    api(base)
      .then(d => {
        if (!cancelled) {
          setFiledState({ workspaceId, returns: d.returns || [], error: null });
        }
      })
      .catch(err => {
        if (!cancelled) {
          setFiledState({
            workspaceId,
            returns: null,
            error: err instanceof Error ? err.message : 'Check your connection, then try again.',
          });
        }
      });
    return () => { cancelled = true; };
  }, [base, workspaceId, version]);

  // CON-4b review: this view is the whole workspace's return; a return filed for one registration is not compared with it
  const filedThisPeriod = wholeWorkspaceReturn(filed, startDate, endDate);
  const changes = filedThisPeriod ? returnChanges(filedThisPeriod, taxReturn) : [];
  const money = (cents: number) => formatCurrency(cents, currency);
  const renderMoney = (cents: number) => (
    <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{money(cents)}</bdi>
  );

  const fileReturn = async () => {
    if (!window.confirm(`File the return for ${startDate} to ${endDate}? A copy is kept and can't be changed.`)) return;
    setBusy(true);
    try {
      await api(base, { method: 'POST', body: JSON.stringify({ startDate, endDate, ...(reference.trim() ? { reference: reference.trim() } : {}) }) });
      toast.success('Tax return filed. Consider closing the period so it can\'t change.');
      setVersion(v => v + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The return could not be filed');
    } finally {
      setBusy(false);
    }
  };

  const treatments = Object.keys(TAX_TREATMENTS) as TaxTreatment[];
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto text-[var(--text)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <div className="flex items-center gap-3">
          <Receipt className="w-6 h-6 text-[var(--brass)]" aria-hidden="true" />
          <div>
            <Heading className="text-xl font-bold">{reportText('r.tax-return', 'Tax return')}</Heading>
            <p className="text-xs text-[var(--muted)]">{reportText('r.tax-on-sales-and-purchases-for-the-period-in', 'Tax on sales and purchases for the period, in')} {currency}{reportText('r.drafts-and-voided-documents-are-left-out', '. Drafts and voided documents are left out.')}</p>
          </div>
        </div>
      </div>

      <ScreenDataNotice
        failedKeys={dataHealth.failedKeys}
        message={dataHealth.message}
        onRetry={dataHealth.retry}
        what={reportText('r.this-tax-return', 'this tax return')}
      />
      {filedError && (
        <div role="status" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs">
          <p className="text-[var(--muted)]">
            <strong className="text-[var(--text)]">{reportText('r.couldn-t-load-previously-filed-returns', 'Couldn\'t load previously filed returns.')}</strong> {filedError}
          </p>
          <button
            type="button"
            onClick={() => setVersion(v => v + 1)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] px-4 text-xs font-bold text-[var(--text)] hover:bg-[var(--panel)]"
          >
            {reportText('r.try-again', 'Try again')}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div>
          <label htmlFor="tax-from" className="block text-xs font-semibold mb-1">{reportText('r.from', 'From')}</label>
          <input id="tax-from" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="min-h-11 px-3 py-1.5 text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg" />
        </div>
        <div>
          <label htmlFor="tax-to" className="block text-xs font-semibold mb-1">{reportText('r.to', 'To')}</label>
          <input id="tax-to" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="min-h-11 px-3 py-1.5 text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg" />
        </div>
        <p className="text-xs text-[var(--muted)]">{taxReturn.documentCount} {reportText('r.documents', 'documents')}</p>
      </div>

      {!loading && dataHealth.failedKeys.length === 0 && taxReturn.documentCount === 0 && (
        <div data-testid="tax-return-empty-period" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs">
          <p className="text-[var(--muted)]">
            <strong className="text-[var(--text)]">{reportText('r.no-taxable-sales-or-purchases-in-this-period', 'No taxable sales or purchases in this period.')}</strong>{' '}
            {reportText('r.choose-another-date-range-or-issue-an-invoice-or', 'Choose another date range, or issue an invoice or approve a supplier bill to include it here.')}
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('sales')}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--elevated)]"
          >
            {reportText('r.open-invoices', 'Open Invoices')}
          </button>
        </div>
      )}

      {filedThisPeriod && (
        <div className={`p-4 rounded-xl border text-sm ${changes.length ? 'border-[var(--neg)]' : 'border-[var(--pos)]'}`} role="status">
          <p className="font-semibold inline-flex items-center gap-2">
            {changes.length ? <AlertTriangle className="w-4 h-4 text-[var(--neg)]" aria-hidden="true" /> : <FileCheck2 className="w-4 h-4 text-[var(--pos)]" aria-hidden="true" />}
            {reportText('r.filed-on', 'Filed on')} {filedThisPeriod.filedAt.slice(0, 10)}{filedThisPeriod.reference ? ` (${filedThisPeriod.reference})` : ''}
          </p>
          {changes.length === 0
            ? <p className="text-xs text-[var(--muted)] mt-1">{reportText('r.nothing-has-changed-since-it-was-filed', 'Nothing has changed since it was filed.')}</p>
            : (
              <>
                <p className="text-xs mt-1">{reportText('r.documents-in-this-period-changed-after-filing-re', 'Documents in this period changed after filing. Report the difference in your next return (or correct this one with the tax office):')}</p>
                <ul className="text-xs mt-1 space-y-0.5">
                  {changes.map(c => <li key={c.key}>{reportText('r.box', 'Box')} {c.key} {c.label}{reportText('r.filed', ': filed')} {money(c.filedCents)}{reportText('r.now', ', now')} {money(c.nowCents)} ({c.nowCents - c.filedCents >= 0 ? '+' : ''}{money(c.nowCents - c.filedCents)})</li>)}
                </ul>
              </>
            )}
        </div>
      )}

      <table className="w-full text-sm border border-[var(--line)] rounded-xl overflow-hidden">
        <caption className="sr-only">{reportText('r.tax-return-boxes', 'Tax return boxes')}</caption>
        <thead className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
          <tr><th scope="col" className="text-start p-3 w-16">{reportText('r.box', 'Box')}</th><th scope="col" className="text-start p-3">{reportText('r.description', 'Description')}</th><th scope="col" className="text-right p-3">{reportText('r.amount', 'Amount')}</th></tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {taxReturn.boxes.map(b => (
            <tr key={b.key} className={b.key === '5' ? 'font-bold' : ''}>
              <td className="p-3 font-mono">{b.key}</td>
              <td className="p-3">{b.label}</td>
              <td className="p-3 text-right font-mono tabular-nums">{renderMoney(b.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(['sales', 'purchases'] as const).map(side => (
          <RowTable
            key={side}
            rowHeaderColumn={false}
            caption={(<>{side === 'sales' ? reportText('r.sales', 'Sales') : reportText('r.purchases', 'Purchases')} {reportText('r.by-treatment', 'by treatment')}</>)}
            rows={treatments.filter(t => taxReturn[side][t].netCents !== 0 || taxReturn[side][t].taxCents !== 0)}
            rowKey={t => t}
            captionClassName="text-start font-semibold p-2"
            tableClassName="w-full text-xs border border-[var(--line)] rounded-xl overflow-hidden"
            headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
            columns={[
              { header: reportText('r.treatment', 'Treatment'), className: "p-2", headClassName: "text-start p-2", cell: (t) => TAX_TREATMENTS[t] },
              { header: reportText('r.excluding-tax', 'Excluding tax'), align: 'right', className: "p-2 font-mono", headClassName: "p-2", cell: (t) => renderMoney(taxReturn[side][t].netCents) },
              { header: reportText('r.tax', 'Tax'), align: 'right', className: "p-2 font-mono", headClassName: "p-2", cell: (t) => renderMoney(taxReturn[side][t].taxCents) },
            ]}
          />
        ))}
      </div>
      {byRate.length > 0 && (
        <div className="min-w-0 overflow-x-auto print:overflow-visible" role="region"
          aria-label={reportText('r.tax-by-rate-collected-minus-paid', 'Tax by rate (collected minus paid)')} tabIndex={0}>{/* NOSONAR: S6845 — keyboard access to the wide table */}
          <RowTable
            rowHeaderColumn={false}
            caption={(<>{reportText('r.tax-by-rate-collected-minus-paid', 'Tax by rate (collected minus paid)')}</>)}
            rows={byRate}
            rowKey={r => `${r.name}|${r.rate}`}
            captionClassName="text-start font-semibold p-2"
            tableClassName="w-full text-xs border border-[var(--line)] rounded-xl overflow-hidden"
            headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
            columns={[
              { header: reportText('r.tax', 'Tax'), className: "p-2", headClassName: "text-start p-2", cell: (r) => (<>{r.name} {r.rate}%</>) },
              { header: reportText('r.taxable-sales', 'Taxable sales'), align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => renderMoney(r.salesNetCents) },
              { header: reportText('r.collected', 'Collected'), align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => renderMoney(r.salesTaxCents) },
              { header: reportText('r.taxable-purchases', 'Taxable purchases'), align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => renderMoney(r.purchasesNetCents) },
              { header: reportText('r.paid', 'Paid'), align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => renderMoney(r.purchasesTaxCents) },
              { header: reportText('r.net', 'Net'), align: 'right', className: "p-2 font-mono tabular-nums font-semibold", headClassName: "p-2", cell: (r) => renderMoney(r.netTaxCents) },
            ]}
          />
        </div>
      )}
      {taxReturn.sales.out_of_scope.netCents !== 0 && (
        <p className="text-xs text-[var(--muted)]">{reportText('r.sales-of', 'Sales of')} {renderMoney(taxReturn.sales.out_of_scope.netCents)} {reportText('r.have-no-tax-code-and-are-not-in-the-boxes-if-the', 'have no tax code and are not in the boxes. If they are taxable, zero-rated or exempt, set a tax code on those invoices.')}</p>
      )}

      {canFile && !filedThisPeriod && (
        <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-[var(--line)]">
          <div>
            <label htmlFor="tax-ref" className="block text-xs font-semibold mb-1">{reportText('r.reference-optional', 'Reference (optional)')}</label>
            <input id="tax-ref" value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder={reportText('r.e-g-q3-2026', 'e.g. Q3 2026')} className="min-h-11 px-3 py-1.5 text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg" />
          </div>
          <button type="button" disabled={busy || !workspaceId || loading || filed === null || Boolean(filedError) || dataHealth.failedKeys.length > 0} onClick={fileReturn} className="min-h-11 px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">
            {reportText('r.file-this-return', 'File this return')}
          </button>
          <p className="text-xs text-[var(--muted)]">{reportText('r.keeps-a-copy-of-these-numbers-submitting-to-the', 'Keeps a copy of these numbers. Submitting to the tax office is done on their website.')}</p>
        </div>
      )}

      {filed && filed.length > 0 && (
        <div className="min-w-0 overflow-x-auto print:overflow-visible" role="region"
          aria-label={reportText('r.filed-returns', 'Filed returns')} tabIndex={0}>{/* NOSONAR: S6845 — keyboard access to the wide table */}
          <RowTable
            rowHeaderColumn={false}
            caption={(<>{reportText('r.filed-returns', 'Filed returns')}</>)}
            rows={filed}
            rowKey={r => r.id}
            captionClassName="text-start font-semibold p-2"
            tableClassName="w-full text-xs border border-[var(--line)] rounded-xl overflow-hidden"
            headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
            columns={[
              { header: reportText('r.period', 'Period'), className: "p-2", headClassName: "text-start p-2", cell: (r) => <button type="button" className="underline" onClick={() => { setStartDate(r.startDate); setEndDate(r.endDate); }}><bdi>{r.startDate} – {r.endDate}</bdi></button> },
              { header: reportText('r.reference', 'Reference'), className: "p-2", headClassName: "text-start p-2", cell: (r) => r.reference || '—' },
              { header: reportText('r.filed-2', 'Filed'), className: "p-2", headClassName: "text-start p-2", cell: (r) => <bdi>{r.filedAt.slice(0, 10)}</bdi> },
              { header: reportText('r.net-tax', 'Net tax'), align: 'right', className: "p-2 font-mono", headClassName: "p-2", cell: (r) => renderMoney(r.boxes.find(b => b.key === '5')?.cents || 0) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
