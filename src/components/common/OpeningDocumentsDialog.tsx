import ReportSchedule from '../reporting/ReportSchedule';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { currentIdentity, useAuthStore } from '../../stores/useAuthStore';
import { identityScope } from '../../lib/serverAction';
import { openingRowsCsv } from '../../lib/partyOpeningBalance';
import type { OpenItemRow } from '../../lib/openItemImport';
import { formatCurrency } from '../../lib/utils';

import { BRAND_NAME } from '../../config/brand';
import { commandErrorMessage, runCommand, ServerCommandError } from '../../lib/runCommand';
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
  // This helper answers with a result object rather than throwing, so a refusal is unpacked here — including
  // the server's own reason, which is what the dialog shows next to the rows it could not read.
  try {
    const json = await runCommand<ServerResult>({ path: `/api/v1/open-items/${mode}`, method: 'POST', body });
    if (!json || json.status !== 'success') return { status: 'error', message: json?.message || 'The open items could not be read', rows: json?.rows || [] };
    return json;
  } catch (error) {
    // A refusal still carries the **rows**: this one says which line failed and why ("Already in the books for
    // this contact"), and that sentence next to the row is the whole reason the dialog shows a table. Dropping
    // the rows here left the person with a message and no idea which line to fix.
    const body = error instanceof ServerCommandError ? error.body : null;
    const refusal = (body && typeof body === 'object' ? body : {}) as { message?: string; rows?: OpenItemRow[] };
    return {
      status: 'error',
      message: refusal.message || commandErrorMessage(error, uiLanguageNow()),
      rows: Array.isArray(refusal.rows) ? refusal.rows : [],
    };
  }
}

export default function OpeningDocumentsDialog(props: { side: 'customer' | 'vendor'; onClose: () => void }) {
  // A checked file is valid only for the person, books and document side that checked it.
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const identity = useAuthStore(() => currentIdentity());
  return <ScopedOpeningDocumentsDialog key={JSON.stringify([identity, workspaceId, props.side])} {...props} />;
}

function ScopedOpeningDocumentsDialog({ side, onClose }: { side: 'customer' | 'vendor'; onClose: () => void }) {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const signedIn = useAuthStore(s => Boolean(s.user));
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const captureScope = () => identityScope(currentIdentity, () => useAuthStore.getState().currentWorkspaceId);
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
    if (!file.csv || busy || inFlight.current || !workspace) return;
    const scope = captureScope();
    if (!scope.uid || scope.workspaceId !== workspace.id) return;
    const isCurrent = () => mounted.current && scope.isCurrent();
    inFlight.current = true;
    setBusy('preview');
    setError(null);
    try {
      const result = await callOpenItems('preview', { workspaceId: workspace.id, side, csv: file.csv });
      if (!isCurrent()) return;
      if (result.status !== 'success') { setChecked(null); setError(result.message || 'The lines could not be checked'); return; }
      setChecked({ csv: file.csv, lines: file.lines, rows: result.rows || [], openTotalCents: result.openTotalCents || 0 });
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusy(null);
    }
  };

  const add = async () => {
    if (!current || !ok.length || problems || busy || inFlight.current || !workspace) return;
    const scope = captureScope();
    if (!scope.uid || scope.workspaceId !== workspace.id) return;
    const isCurrent = () => mounted.current && scope.isCurrent();
    inFlight.current = true;
    setBusy('confirm');
    setError(null);
    try {
      const result = await callOpenItems('confirm', { workspaceId: workspace.id, side, csv: current.csv });
      if (!isCurrent()) return;
      if (result.status !== 'success') {
        setError(result.message || 'Nothing was added');
        if (result.rows?.length) setChecked({ ...current, rows: result.rows });
        return;
      }
      const added = result.created?.length || 0;
      toast.success(`${added} opening ${word}${added === 1 ? '' : 's'} added`);
      if (added) onClose();
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusy(null);
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
          {!signedIn && <p className="text-xs text-[var(--muted)]">Sign in to check and import opening documents.</p>}
          <p className="text-xs text-[var(--muted)]">Saving can stop after some lines are added. If an answer is lost or an import fails, check the books before trying again and remove already saved lines from the file.</p>
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {current && rows.length > 0 && (
            <ReportSchedule
              caption={
                <>
                  Preview: {ok.length} to add · {formatCurrency(current.openTotalCents, currency)}
                  {problems
                    ? ` · ${problems} with a problem: fix ${problems === 1 ? 'it' : 'them'} or take ${problems === 1 ? 'it' : 'them'} out, nothing is added until every line is right`
                    : ''}
                </>
              }
              captionClassName="text-left text-xs font-semibold text-[var(--muted)] mb-1"
              tableClassName="w-full text-xs"
              headRowClassName="text-[var(--muted)]"
              bodyClassName=""
              rowClassName={(r) => (r.problem ? 'text-rose-700' : '')}
              rows={rows}
              rowKey={(r) => r.line}
              rowHeaderClassName="font-normal text-start"
              columns={[
                { header: 'Line', headClassName: 'text-left', cell: (r) => pastedLine(r) },
                { header: side === 'customer' ? 'Customer' : 'Vendor', headClassName: 'text-left', cell: (r) => <bdi>{r.contactName}</bdi> },
                { header: 'Number', headClassName: 'text-left', cell: (r) => r.number },
                { header: 'Date', headClassName: 'text-left', cell: (r) => r.date },
                { header: 'Due', headClassName: 'text-left', cell: (r) => r.dueDate },
                {
                  header: 'Owed',
                  headClassName: 'text-right', className: 'text-right tabular-nums',
                  cell: (r) => (r.problem ? r.problem : formatCurrency(r.openCents, currency)),
                },
              ]}
            />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-[var(--muted)] hover:underline">Cancel</button>
            <button type="button" onClick={() => void preview()} disabled={!signedIn || !file.csv || !!busy || !!current}
              className="px-4 py-2 rounded-lg border border-[var(--line)] text-[var(--text)] font-semibold disabled:opacity-50">
              {busy === 'preview' ? 'Checking…' : 'Check'}
            </button>
            <button type="button" onClick={() => void add()} disabled={!signedIn || !current || !ok.length || !!problems || !!busy}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50">
              {busy === 'confirm' ? 'Adding…' : `Add ${ok.length} opening ${word}${ok.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
