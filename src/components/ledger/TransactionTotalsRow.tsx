import { formatCurrency } from '../../lib/utils';

/** Present the existing filtered statistics; this component performs no ledger arithmetic. */
export function TransactionTotalsRow({ inflowCents, outflowCents, count, incomplete }: { inflowCents: number; outflowCents: number; count: number; incomplete: boolean }) {
  return <section aria-label="Filtered transaction totals" className={`sticky bottom-0 z-10 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-2 ${incomplete ? "" : "md:hidden"}`}>
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm tabular-nums">
      <div><dt className="text-[var(--muted)]">Matching records</dt><dd className="font-semibold">{count.toLocaleString()}</dd></div>
      <div><dt className="text-[var(--muted)]">Total inflow</dt><dd className="font-semibold">{formatCurrency(inflowCents)}</dd></div>
      <div><dt className="text-[var(--muted)]">Total outflow</dt><dd className="font-semibold">{formatCurrency(outflowCents)}</dd></div>
    </dl>
    {incomplete && <p role="status" className="mt-2 text-sm">Totals cover the loaded matching records. This ledger is incomplete.</p>}
  </section>;
}
