import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Table, Search } from 'lucide-react';
import { Transaction } from '../../types';

import { cn, formatDate } from '../../lib/utils';
import { lineAmount } from '../../lib/txFilters';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { runCommand } from '../../lib/runCommand';
import { RowTable } from '../ui/RowTable';
import { buildExplainBody, parseExplanation, type ExplainRequest, type Explanation } from '../../lib/reportExplain';

/** N-12: the request and the answer's shape live in src/lib/reportExplain.ts, shared with R-7's panel. */
export type { ExplainRequest } from '../../lib/reportExplain';

/** The lines behind a figure, from the full history on the server (src/server/reports/explain.ts). */
function Explained({ request, formatCurrency, onOpen, onFail }: { request: ExplainRequest; formatCurrency: (val: number) => string; onOpen: () => void; onFail: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const openRecord = useUIStore(s => s.openRecord);
  const [data, setData] = React.useState<Explanation | null>(null);
  const sign = request.sign || 1;
  // sent in the body: a total over a large chart of accounts is too long for a link
  const query = workspaceId ? buildExplainBody(workspaceId, request) : '';
  React.useEffect(() => {
    if (!query) return;
    let live = true;
    (async () => {
      // `query` is already the request text (it is also the effect's key), so it goes on the wire as-is —
      // passing it as `body` would JSON-encode the string and wrap the whole request in quotes
      const body = await runCommand<Partial<Explanation> | null>({ path: '/api/v1/reports/explain', method: 'POST', rawBody: query });
      return parseExplanation(body);
    })().then(d => { if (live) setData(d); }).catch(() => { if (live) onFail(); });
    return () => { live = false; };
  }, [query, onFail]);

  if (!data) return <p className="text-sm text-[var(--muted)]">Loading the entries behind this figure…</p>;
  const total = sign * data.totalCents;
  const differs = request.expectedCents !== undefined && Math.round(request.expectedCents) !== total;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        {request.label || (request.startDate ? `${formatDate(request.startDate)} – ${formatDate(request.endDate || '')}` : `As of ${request.endDate ? formatDate(request.endDate) : 'today'}`)} · posted entries only · {data.entries} entr{data.entries === 1 ? 'y' : 'ies'}, from the full history
      </p>
      {differs && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">These lines add up to {formatCurrency(total)}, not the {formatCurrency(request.expectedCents!)} shown: the report on screen may be from a partial list. Refresh the report.</p>}
      <RowTable
        rowHeaderColumn={false}
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>Entries behind this amount</>)}
        rows={data.lines}
        rowKey={l => l.key}
        tableClassName="w-full text-sm"
        headRowClassName="text-xs text-[var(--muted)] border-b border-[var(--line)]"
        bodyClassName=""
        footer={<tr className="font-semibold">
            <th scope="row" colSpan={3} className="text-left py-2">Total</th>
            <td className="py-2 text-right font-mono">{formatCurrency(total)}</td>
          </tr>}
        columns={[
          { header: "Date", className: "py-1 font-mono text-xs", headClassName: "text-left font-semibold py-1", cell: (l) => l.date ? formatDate(l.date) : '' },
          { header: "Entry", className: "py-1", headClassName: "text-left font-semibold py-1", cell: (l) => (<>{l.document ? (
                  <button type="button" className="text-left text-indigo-600 dark:text-indigo-400 hover:underline"
                    onClick={() => { onOpen(); openRecord({ type: l.document!.type, id: l.document!.id }); }}>
                    <bdi>{l.description || l.payee || 'Entry'}</bdi>
                    <span className="sr-only"> (open the {l.document.type === 'transaction' ? 'entry' : l.document.type})</span>
                  </button>
                ) : <span><bdi>{l.description}</bdi></span>}
                <span className="block text-[10px] text-[var(--muted)]"><bdi>{l.accountName}</bdi>{l.attachments > 0 ? ` · ${l.attachments} file${l.attachments === 1 ? '' : 's'}` : ''}</span></>) },
          { header: "Bank", className: "py-1 text-xs", headClassName: "text-left font-semibold py-1", cell: (l) => l.bankMatched ? 'Matched' : '' },
          { header: "Amount", align: 'right', className: "py-1 font-mono", headClassName: "font-semibold py-1", cell: (l) => formatCurrency(sign * l.amountCents) },
        ]}
      />
    </div>
  );
}

interface DrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountName: string;
  transactions: Transaction[];
  formatCurrency: (val: number) => string;
  /** where the drill-down came from, shown as a breadcrumb: e.g. 'Profit & Loss' (I-16) */
  from?: string;
  /** N-12: the figure's filter; the lines then come from the server and add up to the figure */
  explain?: ExplainRequest;
}

export default function DrillDownModal({ isOpen, onClose, accountName, transactions, formatCurrency, from, explain }: DrillDownModalProps) {
  const [displayLimit, setDisplayLimit] = React.useState(50);
  // the server could not explain it (offline, a guest workspace): the list this screen loaded, said to be partial
  const [explainFailed, setExplainFailed] = React.useState(false);
  const failExplain = React.useCallback(() => setExplainFailed(true), []);
  const explained = explain && !explainFailed ? explain : undefined;
  const { dialogProps, titleId } = useDialog(onClose, isOpen);
  return (
    <AnimatePresence>
      {isOpen && (
        <div {...dialogProps} className="fixed inset-0 z-[600] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative w-full max-w-4xl max-h-[85dvh] bg-[var(--surface)] rounded-[40px] shadow-2xl flex flex-col overflow-hidden border border-[var(--line)]"
          >
            <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]/50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-900 text-white rounded-[32px] flex items-center justify-center shadow-lg shadow-ledger-ink/20">
                  <Table size={24} />
                </div>
                <div>
                  {from && (
                    <nav aria-label="Breadcrumb" className="text-xs text-[var(--muted)] mb-1">
                      <button type="button" onClick={onClose} className="hover:underline">{from}</button>
                      <span aria-hidden="true"> › </span>
                      <span aria-current="page">{accountName}</span>
                    </nav>
                  )}
                  <h2 id={titleId} className="text-2xl font-black text-[var(--text)] tracking-tight">{accountName}</h2>
                  <p className="micro-label">{explained ? 'Where this number comes from' : `Transaction Drill-Down • ${transactions.length} matched events (from what this screen loaded${explainFailed ? '; the full history could not be read, so this may be partial' : ''})`}</p>
                </div>
              </div>
              <button aria-label="Close" 
                onClick={onClose}
                className="p-3 hover:bg-[var(--surface)] rounded-[32px] transition-all shadow-sm border border-transparent hover:border-[var(--line)]"
              ><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-8 custom-scrollbar">
              {explained ? <Explained request={explained} formatCurrency={formatCurrency} onOpen={onClose} onFail={failExplain} /> : <>
              <table className="w-full text-left border-separate border-spacing-y-2">
                <caption className="sr-only">Entries behind this amount</caption>
                {explain?.accountIds?.length ? (
                  <p className="text-xs text-[var(--muted)] pb-2">
                    {explain.label ? `${explain.label} · ` : ''}the lines of the {explain.accountIds.length === 1 ? 'account' : `${explain.accountIds.length} accounts`} this figure is made of, from the entries this screen loaded.
                  </p>
                ) : null}
                <thead>
                  <tr className="micro-label text-[var(--muted)]">
                    <th scope="col" className="pb-4 pl-4 font-black">Date</th>
                    <th scope="col" className="pb-4 font-black">Description</th>
                    <th scope="col" className="pb-4 text-right pr-4 font-black">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, displayLimit).map((tx) => {
                    // A statement total is made of several accounts, so the fallback list adds up the
                    // lines of those accounts (the caller passes them); a single account's drill-down
                    // keeps matching by its name or id.
                    const amount = explain?.accountIds?.length
                      ? (tx.lines || []).filter(l => explain.accountIds.includes(l.accountId)).reduce((sum, l) => sum + lineAmount(l, tx), 0)
                      : (() => {
                        const matchedLine = tx.lines?.find(l => l.accountName === accountName || l.accountId === accountName);
                        return matchedLine ? matchedLine.amountCents : tx.totalAmountCents;
                      })();

                    return (
                      <tr key={tx.id} className="group hover:bg-[var(--ink)] transition-all rounded-[32px] overflow-hidden">
                        <td className="py-4 pl-4 text-xs font-black text-[var(--muted)] font-mono rounded-l-2xl border-y border-l border-[var(--line)] group-hover:border-slate-300">
                          {tx.date ? formatDate(tx.date) : 'N/A'}
                        </td>
                        <td className="py-4 text-sm font-bold text-[var(--text)] border-y border-[var(--line)] group-hover:border-slate-300">
                           <div className="flex flex-col">
                             <span>{tx.description}</span>
                             {tx.payee && <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider">{tx.payee}</span>}
                           </div>
                        </td>
                        <td className={cn(
                          "py-4 text-right pr-4 font-black font-mono border-y border-r border-[var(--line)] group-hover:border-slate-300 rounded-r-2xl tabular-nums",
                          amount >= 0 ? "text-emerald-600" : "text-rose-600"
                        )}>
                          {amount >= 0 ? '+' : ''}{formatCurrency(amount)}
                        </td>
                      </tr>
                    );
                  })}
                  {transactions.length > displayLimit && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center border border-dashed border-[var(--line)] rounded-[32px]">
                        <button 
                          onClick={() => setDisplayLimit(prev => prev + 50)}
                          className="px-6 py-2 bg-[var(--surface)] hover:bg-[var(--ink)] text-indigo-600 font-bold text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer"
                        >
                          Load Next 50 (Showing {displayLimit} of {transactions.length})
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {transactions.length === 0 && (
                <div className="py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-[var(--surface)] rounded-[32px] flex items-center justify-center text-slate-300 mx-auto">
                    <Search size={32} />
                  </div>
                  <p className="text-sm text-[var(--muted)] font-medium italic">No underlying transactions found for this period.</p>
                </div>
              )}
              </>}
            </div>

            <div className="p-4 md:p-8 border-t border-[var(--line)] bg-[var(--surface)]/30">
               <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em]">End of Drill-Down View</p>
                  <button onClick={onClose} className="btn-secondary" aria-label="Close Report">Close Report</button>
               </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
