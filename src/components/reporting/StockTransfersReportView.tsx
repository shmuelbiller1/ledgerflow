/**
 * A-114: stock moved between locations. Every move is read back from the stock-moves ledger as the
 * pair the server wrote (moved out, moved in); a half whose pair is not in the loaded history is
 * shown on its own with the reason, never dropped and never paired by force. Moving stock is done
 * from an item's Stock history window — this screen only reports. Read-only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, limit, orderBy, query, where } from '../../lib/db/firestore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { downloadCsv } from '../../lib/csvExport';
import { NO_LOCATION, type StockMove } from '../../lib/stockMoves';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import { stockTransfersCsvRows, STOCK_TRANSFERS_CSV_HEADERS, transferPairs } from '../../lib/stockTransfers';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

/** The newest moves read; reaching it means older moves (and possibly pairs) are not shown. */
const MOVES_CAP = 5000;

export default function StockTransfersReportView({ loadMoves }: { loadMoves?: () => Promise<StockMove[]> } = {}) {
  const reportText = useReportText();
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const [loaded, setLoaded] = useState<{ workspaceId: string; moves: StockMove[]; capped: boolean } | null>(null);
  const [failure, setFailure] = useState<{ workspaceId: string; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // A loader passed inline is a new function every render; reading through a ref keeps one read per workspace.
  const loaderRef = useRef(loadMoves);
  useEffect(() => { loaderRef.current = loadMoves; });

  useEffect(() => {
    let live = true;
    const wid = workspaceId || '';
    const loader = loaderRef.current;
    const read: Promise<{ moves: StockMove[]; capped: boolean }> = loader
      ? loader().then(moves => ({ moves, capped: false }))
      : getDocs(query(
        collection(db, 'stockMoves'),
        where('workspaceId', '==', wid),
        orderBy('date', 'desc'),
        limit(MOVES_CAP),
      )).then(snap => ({
        moves: snap.docs.map(d => ({ ...(d.data() as StockMove), id: d.id })),
        capped: snap.docs.length >= MOVES_CAP,
      }));
    read.then(
      result => { if (live) setLoaded({ workspaceId: wid, ...result }); },
      err => { if (live) setFailure({ workspaceId: wid, message: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { live = false; };
  }, [workspaceId]);
  // A result for another workspace is still loading: nothing stale is ever shown.
  const wid = workspaceId || '';
  const moves = loaded && loaded.workspaceId === wid ? loaded.moves : null;
  const capped = loaded !== null && loaded.workspaceId === wid ? loaded.capped : false;
  const error = failure && failure.workspaceId === wid ? failure.message : '';

  const locationName = useCallback((id: string) => (id === NO_LOCATION || !id ? 'No location' : resolveDimensionLabel(nodes, 'location', id)), [nodes]);
  const pairs = useMemo(() => transferPairs(moves || []), [moves]);
  const incomplete = useMemo(() => pairs.filter(p => !p.complete).length, [pairs]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return pairs.filter(p =>
      (!incompleteOnly || !p.complete)
      && (!term || `${p.itemName} ${locationName(p.from)} ${locationName(p.to)}`.toLocaleLowerCase().includes(term)));
  }, [pairs, search, incompleteOnly, locationName]);

  return (
    <section aria-label={reportText('r.stock-transfers', 'Stock transfers')} className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>{reportText('r.stock-transfers', 'Stock transfers')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {pairs.length} {reportText('r.move-s-between-locations-newest-first', 'move(s) between locations, newest first')}
            {incomplete ? fill(reportText('r.0-shown-without-their-pair-which-is-not-in-the-l', '; {0} shown without their pair, which is not in the loaded history'), { 0: incomplete }) : ''}{reportText('r.moving-stock-is-done-from-an-item-s-stock-histor', '. Moving stock is done from an item\'s Stock history window.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('stock-transfers', STOCK_TRANSFERS_CSV_HEADERS, stockTransfersCsvRows(visible, locationName))}
          disabled={!visible.length}
          className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          data-print-hide
        >
          {reportText('r.download-csv', 'Download CSV')}
        </button>
      </div>

      {moves === null && !error && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-the-stock-history', 'Loading the stock history…')}</p>}
      {error && <p role="alert" className="text-sm text-amber-700">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {error}</p>}
      {capped && (
        <p role="alert" className="text-sm text-amber-700">
          {reportText('r.only-the-newest', 'Only the newest')} {MOVES_CAP} {reportText('r.stock-changes-are-read-older-moves-are-not-shown', 'stock changes are read; older moves are not shown and a pair cut off by that limit shows without its half.')}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">{reportText('r.find-item-or-location', 'Find item or location')}
          <input aria-label={reportText('r.find-item-or-location', 'Find item or location')} dir="auto" value={search} onChange={e => setSearch(e.target.value)}
            className="min-h-11 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
        <label className="flex items-center gap-2 min-h-11 text-sm text-[var(--text)]">
          <input type="checkbox" aria-label={reportText('r.only-moves-missing-their-pair', 'Only moves missing their pair')} checked={incompleteOnly}
            onChange={e => setIncompleteOnly(e.target.checked)} />
          {reportText('r.only-moves-missing-their-pair', 'Only moves missing their pair')}
        </label>
      </div>

      {moves !== null && visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]" data-testid="transfers-empty">
          {pairs.length === 0
            ? reportText('r.nothing-has-been-moved-between-locations-yet-mov', 'Nothing has been moved between locations yet. Move stock from an item’s Stock history window on Inventory.')
            : reportText('r.no-moves-match-these-filters', 'No moves match these filters.')}
        </p>
      ) : moves === null ? null : (
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption>{reportText('r.moves-between-locations-newest-first', 'Moves between locations, newest first')}</caption>
            <thead>
              <tr>{[reportText('r.date-2', 'Date'), reportText('r.item', 'Item'), reportText('r.quantity', 'Quantity'), reportText('r.from', 'From'), reportText('r.to', 'To'), reportText('r.complete', 'Complete'), reportText('r.note', 'Note')].map(head =>
                <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map(pair => (
                <tr key={pair.key} className="border-b border-[var(--line)]/50">
                  <td className="py-1 px-2">{pair.date || '—'}</td>
                  <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{pair.itemName}</bdi></th>
                  <td className="py-1 px-2 tabular-nums">{pair.quantity}</td>
                  <td className="py-1 px-2"><bdi>{pair.from ? locationName(pair.from) : reportText('r.no-location', 'No location')}</bdi></td>
                  <td className="py-1 px-2"><bdi>{pair.to ? locationName(pair.to) : reportText('r.no-location', 'No location')}</bdi></td>
                  <td className="py-1 px-2">{pair.complete ? reportText('r.yes', 'Yes') : reportText('r.no', 'No')}</td>
                  <td className="py-1 px-2">{pair.problem || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTableScroll>
      )}
    </section>
  );
}
