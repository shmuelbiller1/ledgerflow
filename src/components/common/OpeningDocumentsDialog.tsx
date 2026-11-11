import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { getIdToken } from '../../firebase';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { openingRowsCsv } from '../../lib/partyOpeningBalance';
import type { OpenItemRow } from '../../lib/openItemImport';
import { formatCurrency } from '../../lib/utils';

import { BRAND_NAME } from '../../config/brand';
/**
 * Opening invoices or bills (CA-08, on the EG-14 import): paste the unpaid invoices (bills) of the old system from a
 * spreadsheet — contact, number, date, due date, amount still owed — check them, and add them. The dialog makes no
 * document itself: "Check" sends the lines to POST /api/v1/open-items/preview, which reads them against the books and
 * names each row's problem; "Add" sends the very same file to /confirm, which reads it again and saves every row as an
 * open invoice (bill) against Opening Balance Equity, or nothing when a row has a problem. A contact not in the books
 * is refused (owner decision, FOR_YOU EG-14): add it first.
 */
interface ServerResult { status: 'success' | 'error'; message?: string; rows?: OpenItemRow[]; openTotalCents?: number; created?: string[]; cutOverDate?: string }

async function callOpenItems(mode: 'preview' | 'confirm', body: { workspaceId: string; side: 'customer' | 'vendor'; csv: string }): Promise<ServerResult> {
  const res = await fetch(`/api/v1/open-items/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null) as ServerResult | null;
  if (!res.ok || !json || json.status !== 'success') return { status: 'error', message: json?.message || `The server answered ${res.status}`, rows: json?.rows || [] };
  return json;
}

export default function OpeningDocumentsDialog({ side, onClose }: { side: 'customer' | 'vendor'; onClose: () => void }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const currency = workspace?.currency || 'USD';
  const startDate = workspace?.openingBalanceDate;
  const { dialogProps, titleId } = useDialog(onClose, true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null);
  // the file the preview was made from: confirm sends exactly this, so it is the file that was checked
  const [checked, setChecked] = useState<{ csv: string; lines: number[]; rows: OpenItemRow[]; openTotalCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useMemo(() => openingRowsCsv(text), [text]);
  const word = side === 'customer' ? 'invoice' : 'bill';
  const current = checked && checked.csv === file.csv ? checked : null;
  const rows = current?.rows || [];
  const ok = rows.filter(r => !r.problem);
  const problems = rows.length - ok.length;
  const pastedLine = (r: OpenItemRow) => current?.lines[r.line - 2] ?? r.line;

  const preview = async () => {
    if (!file.csv || busy || !workspace) return;
    setBusy('preview');
    setError(null);
    try {
      const result = await callOpenItems('preview', { workspaceId: workspace.id, side, csv: file.csv });
      if (result.status !== 'success') { setChecked(null); setError(result.message || 'The lines could not be checked'); return; }
      setChecked({ csv: file.csv, lines: file.lines, rows: result.rows || [], openTotalCents: result.openTotalCents || 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!current || !ok.length || problems || busy || !workspace) return;
    setBusy('confirm');
    setError(null);
    try {
      const result = await callOpenItems('confirm', { workspaceId: workspace.id, side, csv: current.csv });
      if (result.status !== 'success') {
        setError(result.message || 'Nothing was added');
        if (result.rows?.length) setChecked({ ...current, rows: result.rows });
        return;
      }
      const added = result.created?.length || 0;
      toast.success(`${added} opening ${word}${added === 1 ? '' : 's'} added`);
      if (added) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Opening {word}s</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]"><X aria-hidden="true" className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-[var(--muted)]">
            The {word}s still unpaid when you start with {BRAND_NAME}, copied from a spreadsheet: one per line, columns
            {' '}{side === 'customer' ? 'customer' : 'vendor'} · number · date · due date (optional) · amount still owed. Dates as YYYY-MM-DD.
            {startDate ? ` Dated on or before ${startDate}, the day the books start.` : ''} Each contact must already be in your {side === 'customer' ? 'customers' : 'vendors'}. They count towards {side === 'customer' ? 'what customers owe' : 'what you owe'}, not as {side === 'customer' ? 'sales' : 'expenses'}.
          </p>
          <label className="block">
            <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Paste the {word}s</span>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={6} dir="auto"
              placeholder={side === 'customer' ? 'Acme Ltd\tINV-0912\t2026-08-14\t2026-09-13\t1,250.00' : 'Paper Co\tB-77\t2026-08-20\t2026-09-19\t310.00'}
              className="w-full px-3 py-2 font-mono text-xs bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]" />
          </label>
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {current && rows.length > 0 && (
            <table className="w-full text-xs">
              <caption className="text-left text-xs font-semibold text-[var(--muted)] mb-1">Preview: {ok.length} to add · {formatCurrency(current.openTotalCents, currency)}{problems ? ` · ${problems} with a problem: fix ${problems === 1 ? 'it' : 'them'} or take ${problems === 1 ? 'it' : 'them'} out, nothing is added until every line is right` : ''}</caption>
              <thead><tr className="text-[var(--muted)]"><th scope="col" className="text-left">Line</th><th scope="col" className="text-left">{side === 'customer' ? 'Customer' : 'Vendor'}</th><th scope="col" className="text-left">Number</th><th scope="col" className="text-left">Date</th><th scope="col" className="text-left">Due</th><th scope="col" className="text-right">Owed</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.line} className={r.problem ? 'text-rose-700' : ''}>
                    <td>{pastedLine(r)}</td>
                    <td><bdi>{r.contactName}</bdi></td>
                    <td>{r.number}</td>
                    <td>{r.date}</td>
                    <td>{r.dueDate}</td>
                    <td className="text-right tabular-nums">{r.problem ? r.problem : formatCurrency(r.openCents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-[var(--muted)] hover:underline">Cancel</button>
            <button type="button" onClick={() => void preview()} disabled={!file.csv || !!busy || !!current}
              className="px-4 py-2 rounded-lg border border-[var(--line)] text-[var(--text)] font-semibold disabled:opacity-50">
              {busy === 'preview' ? 'Checking…' : 'Check'}
            </button>
            <button type="button" onClick={() => void add()} disabled={!current || !ok.length || !!problems || !!busy}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50">
              {busy === 'confirm' ? 'Adding…' : `Add ${ok.length} opening ${word}${ok.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
