import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { saveWorkspacePriceLists } from '../../../services/workspacePriceLists';
import { guestReady, guestSession, SAMPLE_WORKSPACE_ID } from '../../../lib/db/guestDatabase';
import { downloadCsv } from '../../../lib/csvExport';
import ReportTableScroll from '../../reporting/ReportTableScroll';
import {
  readPriceListCsv, planPriceListImport,
  type PriceListImportReadResult, type PriceListImportPlan,
} from '../../../lib/priceListImport';
import type { PriceList } from '../../../lib/priceLists';

const PROBLEM_CSV_HEADERS = ['Record', 'Problem'];

/**
 * A-80 (screen task A-174): import price lists from a spreadsheet (CSV). The file is read first
 * (bad rows are named by their record number and left out), then a preview shows what changes —
 * never saving before the import is confirmed — and after saving, Undo restores the lists as they
 * were. Saving uses the same server path and the same list rules as Settings → Price lists, so a
 * customer is still on one list per currency. Owners and accountants import; the sample company saves locally.
 */
export default function PriceListImportView() {
  useLedgerCollections('inventory');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const isGuest = useAuthStore(s => s.isGuest);
  const localSample = isGuest && workspace?.id === SAMPLE_WORKSPACE_ID && guestReady();
  const items = useLedgerStore(s => s.inventory) || [];
  const failed = useDataNeedsStore(s => s.failed);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [text, setText] = useState('');
  const [read, setRead] = useState<PriceListImportReadResult | null>(null);
  const [undoPlan, setUndoPlan] = useState<PriceListImportPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const lists = useMemo(() => workspace?.priceLists || [], [workspace?.priceLists]);
  const home = workspace?.currency || 'USD';
  const itemName = (id: string) => items.find(i => i.id === id)?.name || id;

  const plan = useMemo(() => {
    if (!read || !read.rows.length) return null;
    // New list ids follow the price-list id pattern (pl_…), are deterministic per plan and never
    // collide with a saved list.
    const taken = new Set(lists.map(l => l.id));
    const stamp = (index: number) => {
      const base = `pl_csv${String(index).padStart(3, '0')}`;
      let id = base;
      let n = 1;
      while (taken.has(id)) { n += 1; id = `${base}q${n}`; }
      taken.add(id);
      return id;
    };
    return planPriceListImport(lists, read.rows, stamp, home);
  }, [read, lists, home]);

  if (!workspace) return null;

  const runRead = () => {
    setUndoPlan(null);
    setRead(readPriceListCsv(text, items.filter(i => i.sku).map(i => ({ id: i.id, sku: i.sku }))));
  };

  const save = async (next: PriceList[], done: string, undo?: PriceListImportPlan) => {
    const workspaceWroteTo = workspace.id;
    setBusy(true);
    try {
      const sampleSession = guestSession();
      const lists = await saveWorkspacePriceLists(workspaceWroteTo, next);
      if (guestSession() !== sampleSession) return;
      // A workspace change while the save was in flight never gets the old answer applied to it.
      if (useAuthStore.getState().currentWorkspaceId !== workspaceWroteTo) return;
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspaceWroteTo ? { ...w, priceLists: lists } : w)));
      toast.success(done);
      if (undo) setUndoPlan(undo);
      if (undo) setRead(null); else setUndoPlan(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const example = 'Item,List,Price\nSKU-001,Wholesale,12.50\nSKU-002,Wholesale,8\nSKU-003,Export EUR,10.25';

  return <section aria-label="Import price lists" className="p-4 space-y-4 min-w-0">
    <h2>Import price lists</h2>
    <p className="text-sm text-[var(--muted)]">
      Bring prices per item and list from a spreadsheet, as CSV with the columns <b>Item</b> (the SKU), <b>List</b>,
      and <b>Price</b> or <b>Discount %</b> (an optional <b>Currency</b> column takes a three-letter code). The file is
      read first: rows that cannot be read are named by their record number and left out, and the preview shows
      what changes before anything is saved. After saving, Undo restores the lists exactly as they were. A list
      is matched by name in the same currency; a new name becomes a new list with no customers yet.
    </p>

    {!canChange && <p className="text-sm text-[var(--muted)]">Importing price lists takes an owner or accountant.</p>}
    {isGuest && <p className="text-sm text-[var(--muted)]">{localSample ? "Imports save only in this browser tab’s sample company. Leaving the demo discards them." : "A guest workspace has no server, so the import can be read and previewed but not saved."}</p>}
    {failed.inventory && <p role="alert" className="text-sm text-[var(--muted)]">The items failed to load, so SKUs cannot be matched now.</p>}

    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-sm">CSV text (or choose a file below)
        <textarea aria-label="CSV to import" rows={7} className="border rounded p-2 bg-[var(--panel)] text-[var(--text)] font-mono text-xs"
          placeholder={example} value={text} onChange={event => { setText(event.target.value); setRead(null); setUndoPlan(null); }} />
      </label>
      <input type="file" accept=".csv,text/csv,text/plain" aria-label="Choose a CSV file"
        className="text-sm" data-print-hide
        onChange={async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          setText(await file.text());
          setRead(null);
          setUndoPlan(null);
        }} />
      <div className="flex flex-wrap gap-3" data-print-hide>
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!text.trim() || busy}
          onClick={runRead}>Read the file</button>
        {read?.problems.length ? <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]"
          onClick={() => downloadCsv('price-list-import-problems', PROBLEM_CSV_HEADERS, read.problems.map(p => [p.line, p.message]))}>
          Export problems CSV</button> : null}
      </div>
    </div>

    {read?.headerProblem && <p role="alert" className="text-sm">{read.headerProblem}</p>}

    {read && !read.headerProblem && <div className="space-y-2">
      <p className="text-sm">
        {read.rows.length} row(s) read, {read.problems.length} row(s) left out{read.rows.length ? '' : ' — nothing to import'}
      </p>
      {read.problems.length > 0 && <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>Rows left out of the import</caption>
          <thead><tr>{['Record', 'Problem'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr></thead>
          <tbody>
            {read.problems.map(p => <tr key={p.line} className="border-b border-[var(--line)]/50">
              <td className="py-1 px-2">{p.line}</td>
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{p.message}</bdi></th>
            </tr>)}
          </tbody>
        </table>
      </ReportTableScroll>}
    </div>}

    {plan && <div className="space-y-2 border rounded p-3 border-[var(--line)]">
      <h3 className="text-base font-semibold">Preview: {plan.pricesSet} price(s) set on {new Set(read?.rows.map(r => r.list.normalize('NFC').toLocaleLowerCase())).size} list(s){plan.createdLists ? ` · ${plan.createdLists} new list(s) created` : ''}</h3>
      {plan.problem
        ? <p role="alert" className="text-sm">{plan.problem} — the import cannot be saved like this; fix the file or the lists.</p>
        : <>
          <ReportTableScroll>
            <table className="w-full text-sm">
              <caption>The lists after the import</caption>
              <thead><tr>{['List', 'Currency', 'Prices on it', 'Discount'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr></thead>
              <tbody>
                {plan.lists.map(l => <tr key={l.id} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{l.name}</bdi>{plan.previous.every(p => p.id !== l.id) ? ' (new)' : ''}</th>
                  <td className="py-1 px-2">{l.currency || home}</td>
                  <td className="py-1 px-2">{Object.keys(l.prices || {}).length}</td>
                  <td className="py-1 px-2">{l.discountPercent ? `${l.discountPercent}%` : '—'}</td>
                </tr>)}
              </tbody>
            </table>
          </ReportTableScroll>
          <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={busy || !canChange || (isGuest && !localSample)}
            onClick={() => plan && save(plan.lists, `Price lists imported: ${plan.pricesSet} price(s) set${plan.createdLists ? `, ${plan.createdLists} list(s) created` : ''}. Undo is available on this screen.`, plan)}>
            {busy ? 'Saving…' : 'Save the import'}</button>
        </>}
    </div>}

    {undoPlan && <div className="border rounded p-3 border-[var(--line)] space-y-2">
      <p className="text-sm">The import saved {undoPlan.pricesSet} price(s){undoPlan.createdLists ? ` and created ${undoPlan.createdLists} list(s)` : ''}. Undo restores the price lists as they were before it.</p>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={busy || !canChange || (isGuest && !localSample)}
        onClick={() => save(undoPlan.previous, 'The import was undone; the price lists are as they were.')}>
        {busy ? 'Saving…' : 'Undo the import'}</button>
    </div>}

    {read && read.rows.length > 0 && <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Rows that import</caption>
        <thead><tr>{['Record', 'Item', 'List', 'Price (minor units)', 'Discount', 'Currency'].map(head => <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr></thead>
        <tbody>
          {read.rows.map(row => <tr key={row.line} className="border-b border-[var(--line)]/50">
            <td className="py-1 px-2">{row.line}</td>
            <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{itemName(row.itemId)}</bdi></th>
            <td className="py-1 px-2"><bdi>{row.list}</bdi></td>
            <td className="py-1 px-2">{row.priceCents ?? ''}</td>
            <td className="py-1 px-2">{row.discountPercent !== undefined ? `${row.discountPercent}%` : ''}</td>
            <td className="py-1 px-2">{row.currency || home}</td>
          </tr>)}
        </tbody>
      </table>
    </ReportTableScroll>}
  </section>;
}
