import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Receipt, FileCheck2, AlertTriangle } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency, getLocalDateISO, workspaceYearMonth } from '../../lib/utils';
import { buildTaxReturn, returnChanges, taxByRate } from '../../lib/taxReturnDocs';
import type { TaxableDocument } from '../../lib/taxReturnDocs';
import { TAX_TREATMENTS } from '../../lib/taxCodes';
import type { TaxReturnBox, TaxTreatment } from '../../lib/taxCodes';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { wholeWorkspaceReturn } from '../../lib/tax/filedReturns';
import { RowTable } from '../ui/RowTable';

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
  const Heading = embedded ? 'h2' : 'h1';
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  useLedgerCollections('bills', 'creditNotes', 'invoices', 'vendorCredits');
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

  const [filed, setFiled] = useState<FiledReturn[] | null>(null);
  const [version, setVersion] = useState(0);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tax-returns`;
  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) return undefined;
    api(base).then(d => { if (!cancelled) setFiled(d.returns || []); }).catch(() => { if (!cancelled) setFiled([]); });
    return () => { cancelled = true; };
  }, [base, workspaceId, version]);

  // CON-4b review: this view is the whole workspace's return; a return filed for one registration is not compared with it
  const filedThisPeriod = wholeWorkspaceReturn(filed, startDate, endDate);
  const changes = filedThisPeriod ? returnChanges(filedThisPeriod, taxReturn) : [];
  const money = (cents: number) => formatCurrency(cents, currency);

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
            <Heading className="text-xl font-bold">Tax return</Heading>
            <p className="text-xs text-[var(--muted)]">Tax on sales and purchases for the period, in {currency}. Drafts and voided documents are left out.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div>
          <label htmlFor="tax-from" className="block text-xs font-semibold mb-1">From</label>
          <input id="tax-from" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-1.5 text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg" />
        </div>
        <div>
          <label htmlFor="tax-to" className="block text-xs font-semibold mb-1">To</label>
          <input id="tax-to" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-1.5 text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg" />
        </div>
        <p className="text-xs text-[var(--muted)]">{taxReturn.documentCount} documents</p>
      </div>

      {filedThisPeriod && (
        <div className={`p-4 rounded-xl border text-sm ${changes.length ? 'border-[var(--neg)]' : 'border-[var(--pos)]'}`} role="status">
          <p className="font-semibold inline-flex items-center gap-2">
            {changes.length ? <AlertTriangle className="w-4 h-4 text-[var(--neg)]" aria-hidden="true" /> : <FileCheck2 className="w-4 h-4 text-[var(--pos)]" aria-hidden="true" />}
            Filed on {filedThisPeriod.filedAt.slice(0, 10)}{filedThisPeriod.reference ? ` (${filedThisPeriod.reference})` : ''}
          </p>
          {changes.length === 0
            ? <p className="text-xs text-[var(--muted)] mt-1">Nothing has changed since it was filed.</p>
            : (
              <>
                <p className="text-xs mt-1">Documents in this period changed after filing. Report the difference in your next return (or correct this one with the tax office):</p>
                <ul className="text-xs mt-1 space-y-0.5">
                  {changes.map(c => <li key={c.key}>Box {c.key} {c.label}: filed {money(c.filedCents)}, now {money(c.nowCents)} ({c.nowCents - c.filedCents >= 0 ? '+' : ''}{money(c.nowCents - c.filedCents)})</li>)}
                </ul>
              </>
            )}
        </div>
      )}

      <table className="w-full text-sm border border-[var(--line)] rounded-xl overflow-hidden">
        <caption className="sr-only">Tax return boxes</caption>
        <thead className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
          <tr><th scope="col" className="text-left p-3 w-16">Box</th><th scope="col" className="text-left p-3">Description</th><th scope="col" className="text-right p-3">Amount</th></tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {taxReturn.boxes.map(b => (
            <tr key={b.key} className={b.key === '5' ? 'font-bold' : ''}>
              <td className="p-3 font-mono">{b.key}</td>
              <td className="p-3">{b.label}</td>
              <td className="p-3 text-right font-mono tabular-nums">{money(b.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(['sales', 'purchases'] as const).map(side => (
          <RowTable
            key={side}
            rowHeaderColumn={false}
            caption={(<>{side === 'sales' ? 'Sales' : 'Purchases'} by treatment</>)}
            rows={treatments.filter(t => taxReturn[side][t].netCents !== 0 || taxReturn[side][t].taxCents !== 0)}
            rowKey={t => t}
            captionClassName="text-left font-semibold p-2"
            tableClassName="w-full text-xs border border-[var(--line)] rounded-xl overflow-hidden"
            headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
            columns={[
              { header: "Treatment", className: "p-2", headClassName: "text-left p-2", cell: (t) => TAX_TREATMENTS[t] },
              { header: "Excluding tax", align: 'right', className: "p-2 font-mono", headClassName: "p-2", cell: (t) => money(taxReturn[side][t].netCents) },
              { header: "Tax", align: 'right', className: "p-2 font-mono", headClassName: "p-2", cell: (t) => money(taxReturn[side][t].taxCents) },
            ]}
          />
        ))}
      </div>
      {byRate.length > 0 && (
        <RowTable
          rowHeaderColumn={false}
          caption={(<>Tax by rate (collected minus paid)</>)}
          rows={byRate}
          rowKey={r => `${r.name}|${r.rate}`}
          captionClassName="text-left font-semibold p-2"
          tableClassName="w-full text-xs border border-[var(--line)] rounded-xl overflow-hidden"
          headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
          columns={[
            { header: "Tax", className: "p-2", headClassName: "text-left p-2", cell: (r) => (<>{r.name} {r.rate}%</>) },
            { header: "Taxable sales", align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => money(r.salesNetCents) },
            { header: "Collected", align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => money(r.salesTaxCents) },
            { header: "Taxable purchases", align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => money(r.purchasesNetCents) },
            { header: "Paid", align: 'right', className: "p-2 font-mono tabular-nums", headClassName: "p-2", cell: (r) => money(r.purchasesTaxCents) },
            { header: "Net", align: 'right', className: "p-2 font-mono tabular-nums font-semibold", headClassName: "p-2", cell: (r) => money(r.netTaxCents) },
          ]}
        />
      )}
      {taxReturn.sales.out_of_scope.netCents !== 0 && (
        <p className="text-xs text-[var(--muted)]">Sales of {money(taxReturn.sales.out_of_scope.netCents)} have no tax code and are not in the boxes. If they are taxable, zero-rated or exempt, set a tax code on those invoices.</p>
      )}

      {canFile && !filedThisPeriod && (
        <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-[var(--line)]">
          <div>
            <label htmlFor="tax-ref" className="block text-xs font-semibold mb-1">Reference (optional)</label>
            <input id="tax-ref" value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="e.g. Q3 2026" className="px-3 py-1.5 text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg" />
          </div>
          <button type="button" disabled={busy || !workspaceId} onClick={fileReturn} className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">
            File this return
          </button>
          <p className="text-xs text-[var(--muted)]">Keeps a copy of these numbers. Submitting to the tax office is done on their website.</p>
        </div>
      )}

      {filed && filed.length > 0 && (
        <RowTable
          rowHeaderColumn={false}
          caption={(<>Filed returns</>)}
          rows={filed}
          rowKey={r => r.id}
          captionClassName="text-left font-semibold p-2"
          tableClassName="w-full text-xs border border-[var(--line)] rounded-xl overflow-hidden"
          headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
          columns={[
            { header: "Period", className: "p-2", headClassName: "text-left p-2", cell: (r) => <button type="button" className="underline" onClick={() => { setStartDate(r.startDate); setEndDate(r.endDate); }}>{r.startDate} – {r.endDate}</button> },
            { header: "Reference", className: "p-2", headClassName: "text-left p-2", cell: (r) => r.reference || '—' },
            { header: "Filed", className: "p-2", headClassName: "text-left p-2", cell: (r) => r.filedAt.slice(0, 10) },
            { header: "Net tax", align: 'right', className: "p-2 font-mono", headClassName: "p-2", cell: (r) => money(r.boxes.find(b => b.key === '5')?.cents || 0) },
          ]}
        />
      )}
    </div>
  );
}
