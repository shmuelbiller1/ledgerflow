import React, { useMemo, useState } from 'react';
import { build1099Preview, threshold1099Cents, us1099ReviewCsvRows } from '../../lib/tax/us1099Preview';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CSV_HEADERS = ['Tax year', 'Form', 'Box', 'Vendor', 'Name', 'TIN (masked/missing)', 'Amount', 'Note'] as const;

type TotalsInput = { vendorId: string; vendorName: string; form: '1099-NEC' | '1099-MISC'; box: '1a' | '1' | '2' | '3' | '10'; paidCents: number; tinLastFour?: string };

/**
 * C-121: US 1099 preview — conservative draft from verified payment totals.
 * Thresholds from IRS instructions; filingReady false; TIN last-4 only.
 */
export default function Us1099PreviewReportView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const payments = useLedgerStore(s => s.payments);
  const vendors = useLedgerStore(s => s.vendors);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const { loading } = useLedgerCollections('payments', 'vendors');

  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [form, setForm] = useState<'1099-NEC' | '1099-MISC'>('1099-NEC');
  const [box, setBox] = useState<'1a' | '1' | '2' | '3' | '10'>('1a');
  const [usePosted, setUsePosted] = useState(true);

  // Build totals from payments: group by vendor, sum posted made payments for the year that are in home currency
  const derivedTotals: TotalsInput[] = useMemo(() => {
    if (!payments.length) return [];
    const year = taxYear;
    const home = (workspace?.currency || 'USD').toUpperCase();
    const map = new Map<string, TotalsInput>();
    const vendorNames = new Map(vendors.map(v => [v.id, v.name]));
    for (const p of payments as unknown as Array<{ workspaceId: string; date: string; amountCents: number; contactId: string; direction: string; status?: string; currency?: string }>) {
      if (workspaceId && p.workspaceId !== workspaceId) continue;
      if (usePosted && p.status && p.status !== 'posted' && p.status !== 'paid') continue;
      if (p.direction !== 'made') continue;
      if ((p.currency || home).toUpperCase() !== home) continue;
      const d = p.date?.slice(0, 10);
      if (!d || Number(d.slice(0, 4)) !== year) continue;
      const key = p.contactId;
      const cur = map.get(key);
      const add = Number.isSafeInteger(p.amountCents) && p.amountCents >= 0 ? p.amountCents : 0;
      if (!cur) map.set(key, { vendorId: key, vendorName: vendorNames.get(key) || key, form, box, paidCents: add });
      else map.set(key, { ...cur, paidCents: cur.paidCents + add, form, box });
    }
    // Attach tinLastFour if known vendor has it in metadata? Try to read safely
    for (const [id, total] of map) {
      const v = vendors.find(x => x.id === id) as unknown as { metadata?: { taxId?: string } } | undefined;
      const raw = v?.metadata?.taxId;
      if (typeof raw === 'string' && /^\d{9}$/.test(raw.replaceAll('-', ''))) total.tinLastFour = raw.replaceAll('-', '').slice(-4);
    }
    return [...map.values()];
  }, [payments, vendors, workspace, workspaceId, taxYear, form, box, usePosted]);

  const [manualEdits, setManualEdits] = useState<TotalsInput[] | null>(null);
  const totals = manualEdits || derivedTotals;

  const preview = useMemo(() => {
    try {
      return build1099Preview(totals, taxYear);
    } catch {
      return null;
    }
  }, [totals, taxYear]);

  const threshold = useMemo(() => {
    try { return threshold1099Cents(taxYear, form, box); } catch { return null; }
  }, [taxYear, form, box]);

  return <section aria-label="US 1099 preview" className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>US 1099 Preview (review only)</h2>
      <p className="text-sm text-[var(--muted)]">
        Conservative draft from <b>verified payment totals</b> already aggregated — not an IRS paper form or IRIS upload. Payer/recipient TINs, state data, corrections and specialized boxes need the tax workflow. Thresholds: <b>{threshold !== null ? formatCurrency(threshold, workspace?.currency || 'USD') : '—'}</b> for {form} box {box} in {taxYear} (IRS 2026 instructions). <b>filingReady false</b> — deliberately not for filing.
      </p>
      <p className="text-xs text-[var(--muted)]">Sources: <a className="underline" href="https://www.irs.gov/businesses/small-businesses-self-employed/am-i-required-to-file-a-form-1099-or-other-information-return" target="_blank" rel="noreferrer">IRS 1099 filing guide</a> and <a className="underline" href="https://www.irs.gov/instructions/i1099mec" target="_blank" rel="noreferrer">i1099mec</a>. Box 2 royalties $10, box 10 attorney $600, otherwise {taxYear >= 2026 ? '$2,000' : '$600'} — see <code>src/lib/tax/us1099Preview.ts</code>.</p>
    </div>

    <div className="flex flex-wrap gap-3 items-end p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <label className="block text-sm">Tax year
        <input type="number" className={field + ' mt-1'} value={taxYear} onChange={e => setTaxYear(Number(e.target.value) || 2026)} min={2020} max={2099} />
      </label>
      <label className="block text-sm">Form
        <select className={field + ' mt-1'} value={form} onChange={e => { const v = e.target.value as typeof form; setForm(v); setBox(v === '1099-NEC' ? '1a' : '1'); setManualEdits(null); }}>
          <option value="1099-NEC">1099-NEC</option>
          <option value="1099-MISC">1099-MISC</option>
        </select>
      </label>
      <label className="block text-sm">Box
        <select className={field + ' mt-1'} value={box} onChange={e => { setBox(e.target.value as typeof box); setManualEdits(null); }}>
          {form === '1099-NEC' ? <option value="1a">1a</option> : ['1', '2', '3', '10'].map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm min-h-11">
        <input type="checkbox" checked={usePosted} onChange={e => { setUsePosted(e.target.checked); setManualEdits(null); }} />
        Only posted outgoing payments
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!preview || !preview.forms.length} onClick={() => preview && downloadCsv(`us-1099-preview-${taxYear}`, [...CSV_HEADERS], us1099ReviewCsvRows(preview))}>Export review CSV</button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => setManualEdits(null)}>Reset to workspace payments</button>
    </div>

    {loading && <p role="status">Loading vendors and payments…</p>}
    {!loading && !derivedTotals.length && !manualEdits && <p className="text-sm text-[var(--muted)]">No posted outgoing payments in {taxYear} in {workspace?.currency || 'USD'} to preview. Create a payment to a vendor (marked 1099) and set a TIN to see it here. The review below is empty until payments exist.</p>}

    {preview && <>
      <div className="rounded border border-[var(--line)] p-3 bg-[var(--panel)] text-sm space-y-1">
        <p><b>{preview.forms.length} form(s) at or above</b> {threshold !== null ? formatCurrency(threshold, workspace?.currency || 'USD') : 'threshold'} · <b>{preview.excluded} excluded</b> below threshold · <b>filingReady:</b> {String(preview.filingReady)} — NOT for filing</p>
        <p className="text-xs text-[var(--muted)]">Each vendor+form+box has its total summed before the threshold is applied; vendor+box pairs below threshold are counted in excluded, not shown as forms. Totals are whole cents; unsafe totals throw.</p>
        {preview.form1096.map(f => <p key={f.form} className="text-xs">1096 {f.form}: {f.forms} form(s), total {formatCurrency(f.totalCents, workspace?.currency || 'USD')} in {f.taxYear}</p>)}
      </div>

      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption className="text-left font-semibold text-[var(--text)] pb-1">1099 drafts that meet the threshold — review only, NOT IRIS</caption>
          <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">{['Vendor', 'Form/Box', 'Amount', 'Threshold', 'TIN (last 4)', 'Needs details'].map(h => <th key={h} scope="col" className="text-left py-1 px-2">{h}</th>)}</tr></thead>
          <tbody>
            {preview.forms.map(row => <tr key={`${row.vendorId}-${row.form}-${row.box}`} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.vendorName}</bdi><div className="text-xs text-[var(--muted)]"><code>{row.vendorId}</code></div></th>
              <td className="py-1 px-2">{row.form} · {row.box}</td>
              <td className="py-1 px-2 tabular-nums">{formatCurrency(row.amountCents, workspace?.currency || 'USD')}</td>
              <td className="py-1 px-2 tabular-nums">{formatCurrency(row.thresholdCents, workspace?.currency || 'USD')}</td>
              <td className="py-1 px-2 font-mono">{row.tinLastFour ? `****${row.tinLastFour}` : 'MISSING'}</td>
              <td className="py-1 px-2 text-xs">{row.needsTaxDetails ? 'Yes — needs payer/recipient details, state, corrections before filing' : 'No'}</td>
            </tr>)}
          </tbody>
        </table>
      </ReportTableScroll>

      {/* Manual totals editor for demo/review */}
      <details className="rounded border border-[var(--line)] p-2">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Edit totals for this preview (review only, not saved)</summary>
        <p className="text-xs text-[var(--muted)]">Totals here are the aggregated vendor payments for the chosen form/box/year. Editing does not change payments; it previews what the 1099 check sees. TIN shows last 4 only.</p>
        <div className="space-y-2 mt-2">
          {totals.map((t, idx) => <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <label className="block text-sm">Vendor <input className={field + ' w-full mt-1'} value={t.vendorName} onChange={e => {
              const next = [...totals]; next[idx] = { ...next[idx], vendorName: e.target.value, vendorId: next[idx].vendorId || `manual-${idx}` }; setManualEdits(next);
            }} /></label>
            <label className="block text-sm">Paid cents <input inputMode="numeric" className={field + ' w-full mt-1'} value={String(t.paidCents)} onChange={e => {
              const n = Number(e.target.value); const next = [...totals]; next[idx] = { ...next[idx], paidCents: Number.isSafeInteger(Math.round(n)) && n >= 0 ? Math.round(n) : 0 }; setManualEdits(next);
            }} /></label>
            <label className="block text-sm">TIN last 4 <input className={field + ' w-full mt-1'} value={t.tinLastFour || ''} onChange={e => {
              const v = e.target.value.replaceAll(/\D/g, '').slice(-4); const next = [...totals]; next[idx] = { ...next[idx], tinLastFour: v || undefined }; setManualEdits(next);
            }} placeholder="####" maxLength={4} /></label>
            <button type="button" className="min-h-11 px-3 rounded border border-[var(--line)]" onClick={() => { const next = totals.filter((_, i) => i !== idx); setManualEdits(next); }}>Remove</button>
          </div>)}
          <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => setManualEdits([...totals, { vendorId: `manual-${totals.length}`, vendorName: 'New vendor', form, box, paidCents: 0 }])}>Add vendor total</button>
        </div>
      </details>
    </>}

    {!preview && <p role="alert" className="text-sm text-amber-700">Preview error: check tax year (2020–2099), form/box pairing and that each total is a whole-cent non-negative number with a vendor name. This screen never files.</p>}

    <p className="text-xs text-[var(--muted)]">Capability: <b>Internal, test or demo only</b> — review drafts only; payer info, state withholding, corrections and the portal are separate. The CSV says “REVIEW ONLY — NOT IRIS” on every row.</p>
  </section>;
}
