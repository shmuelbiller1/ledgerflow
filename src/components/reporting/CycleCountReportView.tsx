import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import {
  COUNT_POSTING_NOTE, countInputProblem, countSheetVariance, enterCount, markReady, openCountSheet,
  readyProblem, type CountSheet,
} from '../../lib/cycleCounts';
import { loadWorkspaceStockMoves } from '../../lib/cycleCountApi';
import { NO_LOCATION, type StockMove } from '../../lib/stockMoves';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CSV_HEADERS = ['Item', 'SKU', 'Expected', 'Counted', 'Difference', 'Unit cost', 'Value', 'Expected figure explained'];

/**
 * A-45: inventory cycle counts. A count sheet for one place: what the stock-moves ledger says is
 * there, what the person counted, the variance in units and at the item's own cost — and a button
 * that only **marks the sheet ready**. Posting the adjustment stays with the Inventory screen's
 * count (the server writes the entry and the history); nothing here changes a quantity or an entry.
 *
 * The sheet lives in this screen while it is being worked on: saving sheets needs a collection of
 * their own (AI #1's lane, asked under Messages). Everything the screen shows — expected quantities,
 * differences, values — is computed by `src/lib/cycleCounts.ts` and shown as it is.
 */
export default function CycleCountReportView({ endDate = '', loadMoves = loadWorkspaceStockMoves }: { endDate?: string; loadMoves?: (workspaceId: string) => Promise<StockMove[]> }) {
  const items = useLedgerStore(state => state.inventory);
  const nodes = useLedgerStore(state => state.dimensionNodes || []);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('inventory');
  const [locationId, setLocationId] = useState<string>(NO_LOCATION);
  const [includeZero, setIncludeZero] = useState(false);
  const [date, setDate] = useState(endDate || getLocalDateISO());
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  const [readProblem, setReadProblem] = useState('');
  const [sheet, setSheet] = useState<CountSheet | null>(null);
  const [note, setNote] = useState('');

  const currency = workspace?.currency || 'USD';
  const locations = useMemo(() => (nodes || []).filter(n => n.dimensionId === 'location' && n.status !== 'archived'), [nodes]);
  const locationName = (id: string) => (id === NO_LOCATION ? 'No location' : resolveDimensionLabel(nodes, id ? 'location' : 'location', id) || id);

  useEffect(() => {
    let live = true;
    if (!workspaceId) return () => { live = false; };
    loadMoves(workspaceId)
      .then(rows => { if (live) { setMoves(rows); setReadProblem(''); } })
      .catch(err => { if (live) { setMoves(null); setReadProblem(err instanceof Error ? err.message : String(err)); } });
    return () => { live = false; };
  }, [workspaceId, loadMoves]);

  const canCount = workspaceId && !loading;

  const begin = () => {
    if (!canCount) return;
    const opened = openCountSheet({
      locationId, date, items, moves: moves || [], includeZero,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setSheet(opened);
    if (!opened.rows.length) toast.info('The ledger puts nothing at this place — tick “every item” for a full count.');
  };

  const variance = sheet ? countSheetVariance(sheet) : null;
  const problem = sheet ? readyProblem(sheet) : null;
  const marked = sheet?.status === 'ready';

  const onMarkReady = () => {
    if (!sheet) return;
    const who = useAuthStore.getState().user?.displayName || useAuthStore.getState().user?.email || 'A person';
    const result = markReady(sheet, who, new Date().toISOString());
    if (result.problem) { toast.error(result.problem); return; }
    setSheet(result.sheet);
    toast.success('Sheet marked ready. The adjustment is posted from the Inventory stock count, not here.');
  };

  return <section aria-label="Inventory cycle count" className="p-4 space-y-4 min-w-0">
    <h2>Inventory cycle count</h2>
    <p className="text-sm text-[var(--muted)]">A count sheet for one place: the ledger's expected quantity, what was counted, and the variance in units and at each item's own cost. {COUNT_POSTING_NOTE}</p>
    <p className="text-sm text-[var(--muted)]">A row left blank is never read as zero — it is listed as not counted. A row whose stock history does not explain its quantity is marked, so a difference is not blamed on the count before the history is checked. Expected quantities come from the stock-moves ledger (per Location); an item with no history uses its own quantity on hand and says so.</p>
    {readProblem && <p role="status" className="text-sm text-[var(--warning,#b45309)]">The stock-moves ledger could not be read ({readProblem}); expected quantities fall back to each item's own quantity on hand.</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">Place
        <select aria-label="Count place" className={field} value={locationId} onChange={event => setLocationId(event.target.value)}>
          <option value={NO_LOCATION}>No location</option>
          {locations.map(node => <option key={node.id} value={node.id}>{node.description || node.id}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">Count date
        <input aria-label="Count date" type="date" className={field} value={date} onChange={event => setDate(event.target.value)} />
      </label>
      <label className="flex items-center gap-2 min-h-11 text-sm text-[var(--text)]">
        <input aria-label="Include every item" type="checkbox" checked={includeZero} onChange={event => setIncludeZero(event.target.checked)} />
        List every item (a full count)
      </label>
      <label className="flex flex-col gap-1">Note
        <input aria-label="Count note" className={field} value={note} onChange={event => setNote(event.target.value)} placeholder="Why this count" />
      </label>
      <button type="button" onClick={begin} disabled={!canCount} className="min-h-11 px-4 rounded bg-[var(--text)] text-[var(--surface)] disabled:opacity-50">Open the count sheet</button>
    </div>

    {!sheet && <p className="text-sm text-[var(--muted)]">{loading ? 'Loading items…' : moves === null && !readProblem ? 'Reading the stock-moves ledger…' : 'Open a count sheet to enter counted quantities.'}</p>}

    {sheet && variance && <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">{locationName(sheet.locationId)} — {sheet.date}{sheet.note ? ` — ${sheet.note}` : ''}</h3>
        <span className={`text-xs px-2 py-1 rounded ${marked ? 'bg-[var(--panel)] text-[var(--text)]' : 'bg-[var(--panel)] text-[var(--muted)]'}`}>{marked ? `Ready — marked by ${sheet.markedReadyBy || 'a person'}` : 'Open'}</span>
        <button type="button" onClick={onMarkReady} disabled={marked || Boolean(problem)} className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50">Mark ready (no posting)</button>
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]"
          onClick={() => downloadCsv(`cycle-count-${sheet.date}`, CSV_HEADERS, sheet.rows.map(row => [
            row.itemName, row.sku || '', row.expected, row.counted ?? '', row.counted === undefined ? '' : row.counted - row.expected,
            row.unitCostCents / 100, row.counted === undefined ? '' : ((row.counted - row.expected) * row.unitCostCents) / 100,
            row.unexplained ? 'No — check the history' : 'Yes',
          ]))}>Export CSV</button>
      </div>

      <p className="text-sm text-[var(--text)]">
        {variance.countedRows.length} of {sheet.rows.length} counted · {variance.differences.length} differ from the ledger · units short {variance.unitsShort} · units found {variance.unitsFound} · variance <strong>{formatCurrency(variance.valueCents, currency)}</strong>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[46rem]">
          <caption className="sr-only">Count sheet and variance</caption>
          <thead>
            <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
              <th scope="col" className="py-2">Item</th>
              <th scope="col">Expected</th>
              <th scope="col">Counted</th>
              <th scope="col">Difference</th>
              <th scope="col">Unit cost</th>
              <th scope="col">Value</th>
              <th scope="col">Expected figure</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map(row => {
              const v = variance.countedRows.find(r => r.itemId === row.itemId);
              return <tr key={row.itemId} className="border-b border-[var(--line)]/40">
                <td className="py-2">{row.itemName}{row.sku ? <span className="text-[var(--muted)]"> ({row.sku})</span> : null}</td>
                <td>{row.expected}</td>
                <td>
                  <input aria-label={`Counted quantity for ${row.itemName}`} inputMode="decimal" className={field} value={row.counted === undefined ? '' : String(row.counted)}
                    onChange={event => {
                      const problem = countInputProblem(event.target.value);
                      if (problem) { toast.error(problem); return; }
                      setSheet(current => current ? enterCount(current, row.itemId, event.target.value) : current);
                    }} />
                </td>
                <td>{row.counted === undefined ? '—' : v?.difference ?? 0}</td>
                <td>{formatCurrency(row.unitCostCents, currency)}</td>
                <td>{row.counted === undefined ? '—' : formatCurrency(v?.valueCents ?? 0, currency)}</td>
                <td className={row.unexplained ? 'text-[var(--warning,#b45309)]' : ''}>{row.unexplained ? row.unexplainedReason || 'No — check the history' : 'Yes'}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {problem && !marked && <p role="status" className="text-sm text-[var(--muted)]">Not ready to mark: {problem}.</p>}
      {variance.notCounted.length > 0 && <p className="text-sm text-[var(--muted)]">Not counted yet ({variance.notCounted.length}): {variance.notCounted.map(r => r.itemName).join(', ')} — a blank row is not zero.</p>}
      {variance.unexplained.length > 0 && <p className="text-sm text-[var(--warning,#b45309)]">The history does not explain the expected figure for {variance.unexplained.map(r => r.itemName).join(', ')}; the sheet cannot be marked ready until someone checks it or records the missing movement.</p>}
    </div>}
  </section>;
}
