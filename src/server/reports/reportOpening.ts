/**
 * L-123 step 2 (docs/design/L-123-server-balances.md): the server reports read their opening from
 * `balancesAsOf` (a year-end snapshot plus the entries after it) instead of every entry since the books began.
 *
 * A report at D reads the balances through the day before D, then the entries dated D (or the period) with the
 * same query as before. The split is at the day before, not at D, so an entry stored with a clock time on day D
 * is treated as it always was by the report's own date query (left out of a report ending on D); every figure is
 * the same to the byte.
 *
 * The opening is not used (null: the caller reads every entry, as before) when the report needs more than the
 * snapshot holds:
 * - `gross`: the debits and credits per account (the trial balance), or the lines per account, which tell lines
 *   on accounts outside the chart (the balance sheet lists them one by one as orphaned lines);
 * - a snapshot built before step 2 has neither, until it is rebuilt.
 */
import type { ChartAccount } from '../../types';
import type { Firestore } from '../db/firestore';
import { balancesAsOf, snapshotsOf, UNASSIGNED, type BalancesAsOf } from '../services/balanceService';
import type { OpeningCents, OpeningGross } from './computeReports';
import type { LabelOpening } from './byLabel';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * What goes into the report cache key: every snapshot an opening at `date` could read, with its checksum and its
 * stale mark. A snapshot marked stale, rebuilt, or stale again (a new `staleSince`) changes the key, so the cache
 * never answers with a figure made from another state of the closed years.
 */
export async function openingKey(db: Firestore, workspaceId: string, date: string | undefined): Promise<string> {
  if (!date || !DATE.test(date)) return 'none';
  const last = dayBefore(date);
  const snapshots = (await snapshotsOf(db, workspaceId)).filter(s => s.asOf <= last).sort((a, b) => a.asOf.localeCompare(b.asOf));
  return snapshots.length ? snapshots.map(s => `${s.asOf}:${s.checksum}:${s.stale === true ? `stale@${s.staleSince || ''}` : 'fresh'}`).join('|') : 'none';
}

/** The balances through the day before `date`, or null when the report must read every entry (see above). */
export async function openingBefore(db: Firestore, workspaceId: string, accounts: ChartAccount[], date: string, options: { byLabel?: boolean; gross?: boolean } = {}): Promise<BalancesAsOf | null> {
  if (!DATE.test(date)) return null;
  const opening = await balancesAsOf(db, workspaceId, dayBefore(date), { byLabel: options.byLabel });
  if (!options.gross) return opening;
  if (!opening.lines || !opening.debits || !opening.credits || (options.byLabel && !opening.labelLines)) return null;
  const chart = new Set(accounts.map(a => a.id));
  return Object.keys(opening.lines).every(id => chart.has(id)) ? opening : null;
}

export const grossOf = (opening: BalancesAsOf): OpeningGross => ({ debits: opening.debits || {}, credits: opening.credits || {} });

/** The by-label opening of one value and of the lines with no value (a kind no entry carried: every line has none). */
export function labelOpeningOf(opening: BalancesAsOf, dimensionId: string, value: string): LabelOpening {
  const kind = dimensionId.normalize('NFC').toLowerCase().trim();
  const values = opening.byLabel && Object.hasOwn(opening.byLabel, kind) ? opening.byLabel[kind] : undefined;
  const lines = opening.labelLines && Object.hasOwn(opening.labelLines, kind) ? opening.labelLines[kind] : undefined;
  const allLines = Object.values(opening.lines || {}).reduce((a, b) => a + b, 0);
  const unlabelled = {
    cents: values ? (Object.hasOwn(values, UNASSIGNED) ? values[UNASSIGNED] : {}) : opening.accounts,
    lines: lines ? (Object.hasOwn(lines, UNASSIGNED) ? lines[UNASSIGNED] : 0) : (values ? 0 : allLines),
  };
  // asked for "Unassigned" itself: those lines are the value's (getLineDimension answers "Unassigned"), none are left over
  if (value === UNASSIGNED) return { value: unlabelled.cents as OpeningCents, notLabelled: {}, notLabelledLines: 0 };
  return { value: (values && Object.hasOwn(values, value) ? values[value] : {}) as OpeningCents, notLabelled: unlabelled.cents, notLabelledLines: unlabelled.lines };
}
