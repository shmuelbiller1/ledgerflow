/**
 * A-114: stock moved between locations. Every move is read back from the stock-moves ledger as the
 * pair the server wrote (moved out, moved in); a half whose pair is not in the loaded history is
 * shown on its own with the reason, never dropped and never paired by force. Moving stock is done
 * from an item's Stock history window — this screen only reports. Read-only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, limit, orderBy, query, where } from '../../lib/db/firestore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { downloadCsv } from '../../lib/csvExport';
import { NO_LOCATION, type StockMove } from '../../lib/stockMoves';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import { stockTransfersCsvRows, STOCK_TRANSFERS_CSV_HEADERS, transferPairs } from '../../lib/stockTransfers';
import ReportSchedule from './ReportSchedule';
import { useReportDates } from './useReportDates';
import { useReportText, fill } from './useReportText';

/** The newest moves read; reaching it means older moves (and possibly pairs) are not shown. */
const MOVES_CAP = 5000;

type Loader = () => Promise<StockMove[]>;
export default function StockTransfersReportView({ loadMoves }: { loadMoves?: Loader } = {}) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const uid = useAuthStore(s => s.user?.uid);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  return <Transfers key={JSON.stringify([workspaceId, uid, guest])} workspaceId={workspaceId} loader={loadMoves} />;
}

function Transfers({ workspaceId, loader }: { workspaceId: string; loader?: Loader }) {
  const reportText = useReportText();
  const dates = useReportDates();
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const [loaded, setLoaded] = useState<{ moves?: StockMove[]; capped?: boolean; error?: string } | null>(null);
  const [search, setSearch] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    const read = loader ? loader().then(moves => ({ moves, capped: moves.length >= MOVES_CAP }))
      : getDocs(query(collection(db, 'stockMoves'), where('workspaceId', '==', workspaceId), orderBy('date', 'desc'), limit(MOVES_CAP)))
        .then(snap => ({ moves: snap.docs.map(d => ({ ...(d.data() as StockMove), id: d.id })), capped: snap.docs.length >= MOVES_CAP }));
    read.then(result => { if (live) setLoaded({ ...result, moves: result.moves.filter(m => m.workspaceId === workspaceId) }); },
      err => { if (live) setLoaded({ error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [workspaceId, loader, attempt]);
  const moves = loaded?.moves ?? null, capped = !!loaded?.capped, error = loaded?.error;

  const locationName = useCallback((id: string) => (id === NO_LOCATION || !id ? 'No location' : resolveDimensionLabel(nodes, 'location', id)), [nodes]);
  const displayLocation = useCallback((id: string) => id && id !== NO_LOCATION ? locationName(id) : reportText('r.no-location', 'No location'), [locationName, reportText]);
  const pairs = useMemo(() => transferPairs(moves || []), [moves]);
  const incomplete = useMemo(() => pairs.filter(p => !p.complete).length, [pairs]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return pairs.filter(p =>
      (!incompleteOnly || !p.complete)
      && (!term || `${p.itemName} ${displayLocation(p.from)} ${displayLocation(p.to)}`.toLocaleLowerCase().includes(term)));
  }, [pairs, search, incompleteOnly, displayLocation]);

  return (
    <section aria-label={reportText('r.stock-transfers', 'Stock transfers')} className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>{reportText('r.stock-transfers', 'Stock transfers')}</h2>
          {moves && <p className="text-sm text-[var(--muted)]">
            {pairs.length} {reportText('r.move-s-between-locations-newest-first', 'move(s) between locations, newest first')}
            {incomplete ? fill(reportText('r.0-shown-without-their-pair-which-is-not-in-the-l', '; {0} shown without their pair, which is not in the loaded history'), { 0: incomplete }) : ''}{reportText('r.moving-stock-is-done-from-an-item-s-stock-histor', '. Moving stock is done from an item\'s Stock history window.')}
          </p>}
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('stock-transfers', STOCK_TRANSFERS_CSV_HEADERS, stockTransfersCsvRows(visible, locationName))}
          disabled={!visible.length || capped || !!error}
          className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          data-print-hide
        >
          {reportText('r.download-csv', 'Download CSV')}
        </button>
      </div>

      {moves === null && !error && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-the-stock-history', 'Loading the stock history…')}</p>}
      {error && <div><p role="alert" className="text-sm text-[var(--text)]">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {error}</p>
        <button type="button" className="min-h-11 underline" onClick={() => { setLoaded(null); setAttempt(n => n + 1); }}>{reportText('r.retry', 'Retry')}</button></div>}
      {capped && (
        <p role="alert" className="text-sm text-[var(--text)]">
          {reportText('r.only-the-newest', 'Only the newest')} {MOVES_CAP} {reportText('r.stock-changes-are-read-older-moves-are-not-shown', 'stock changes are read; older moves are not shown and a pair cut off by that limit shows without its half.')}
        </p>
      )}

      {pairs.length > 0 && <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">{reportText('r.find-item-or-location', 'Find item or location')}
          <input aria-label={reportText('r.find-item-or-location', 'Find item or location')} dir="auto" value={search} onChange={e => setSearch(e.target.value)}
            className="min-h-11 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
        <label className="flex items-center gap-2 min-h-11 text-sm text-[var(--text)]">
          <input type="checkbox" aria-label={reportText('r.only-moves-missing-their-pair', 'Only moves missing their pair')} checked={incompleteOnly}
            onChange={e => setIncompleteOnly(e.target.checked)} />
          {reportText('r.only-moves-missing-their-pair', 'Only moves missing their pair')}
        </label>
      </div>}

      {moves !== null && visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]" data-testid="transfers-empty">
          {capped ? reportText('r.transfer-no-loaded-match', 'No matching moves in the loaded history. Older moves may be missing.') : pairs.length === 0
            ? reportText('r.nothing-has-been-moved-between-locations-yet-mov', 'Nothing has been moved between locations yet. Move stock from an item’s Stock history window on Inventory.')
            : reportText('r.no-moves-match-these-filters', 'No moves match these filters.')}
        </p>
      ) : moves === null ? null : (
        <ReportSchedule columnControls allowDisplayedExport={!capped && !error}
          caption={reportText('r.moves-between-locations-newest-first', 'Moves between locations, newest first')} rows={visible} rowKey={pair => pair.key}
          columns={[
            { header: reportText('r.item', 'Item'), cell: p => <bdi>{p.itemName}</bdi> },
            { header: reportText('r.date-2', 'Date'), cell: p => <time dateTime={p.date} className="whitespace-nowrap">{dates.dateText(p.date) || '—'}</time> },
            { header: reportText('r.quantity', 'Quantity'), align: 'right', cell: p => p.quantity },
            { header: reportText('r.from', 'From'), cell: p => <bdi>{displayLocation(p.from)}</bdi> },
            { header: reportText('r.to', 'To'), cell: p => <bdi>{displayLocation(p.to)}</bdi> },
            { header: reportText('r.complete', 'Complete'), cell: p => p.complete ? reportText('r.yes', 'Yes') : reportText('r.no', 'No') },
            { header: reportText('r.note', 'Note'), cell: p => !p.problem ? '—' : p.key.startsWith('out:')
              ? reportText('r.transfer-no-in', 'Its move-in half is not in the loaded history.')
              : reportText('r.transfer-no-out', 'Its move-out half is not in the loaded history.') },
          ]} />
      )}
    </section>
  );
}
