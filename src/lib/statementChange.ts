/**
 * R-7: "Why did this number change?" — the accounts behind a move in a statement figure.
 *
 * A statement shows two figures: this period (or this date) and the one it is compared with. The
 * difference between them is real money, and the reader's next question is always *which accounts*
 * and *which entries* made it. This module answers the first half; the panel asks the server for the
 * entries behind an account (`/api/v1/reports/explain`, the same route the drill-down uses).
 *
 * What is deliberately *not* here:
 * - **No money is recalculated.** Every figure is the one the statement already shows, passed in.
 *   The totals are the rows' own effects added up, so a panel cannot disagree with the statement by
 *   using a second formula — a test checks that the parts add to the total.
 * - **No sign is invented.** Each section's contribution to the figure being explained is given by
 *   the caller (`signs`): income adds to net profit, cost of goods and expenses take away from it;
 *   on the balance sheet every section adds to its own side. An account whose change has no effect
 *   on the figure (net 0) is counted, not listed.
 *
 * Reading the result:
 * - `rows` is every account that moved, ranked by how much it moved the figure — the biggest share
 *   first — with ties broken by the size of the raw change and then by account code and name, so the
 *   order never depends on the hash order of an object.
 * - `changeCents` is this figure minus the figure it is compared with. For a balance sheet it is
 *   the movement between the two dates; for a profit and loss it is the difference between the two
 *   periods' flows. `movementWindow` gives the day range whose posted entries are that movement.
 */

import { addToDateISO } from './calendarDate';

/** The statement sections a change can come from. */
export type StatementSection = 'income' | 'cogs' | 'expense' | 'assets' | 'liabilities' | 'equity';

/** One account as a statement holds it: the balance in cents, already in the report's own sign. */
export interface StatementAccountValue {
  name: string;
  code?: string;
  balance: number;
}

/** The accounts of one side of the comparison, by section. A section that is absent has no accounts. */
export type StatementSides = Partial<Record<StatementSection, Record<string, StatementAccountValue>>>;

export interface StatementChangeOptions {
  /**
   * What each section adds to the figure being explained: `1` where the section raises it, `-1`
   * where it lowers it. A section left out contributes nothing and its accounts are not ranked
   * (they are still counted as unchanged).
   */
  signs: Partial<Record<StatementSection, 1 | -1>>;
}

export interface StatementChangeRow {
  accountId: string;
  name: string;
  code?: string;
  section: StatementSection;
  /** this side's figure for the account, in cents, in the report's sign */
  currentCents: number;
  /** the compared side's figure; 0 when the account did not exist there */
  priorCents: number;
  /** current − prior, in the report's sign */
  changeCents: number;
  /** what the change did to the figure being explained: `changeCents × signs[section]` */
  effectCents: number;
}

export interface StatementChangeSet {
  /** every account whose effect on the figure is not zero, biggest share first */
  rows: StatementChangeRow[];
  /** accounts that moved by 0, or whose section does not count toward this figure */
  unchangedCount: number;
  currentTotalCents: number;
  priorTotalCents: number;
  /** currentTotalCents − priorTotalCents; equal to the sum of `rows[].effectCents` */
  changeCents: number;
}

const SECTION_ORDER: readonly StatementSection[] = ['income', 'cogs', 'expense', 'assets', 'liabilities', 'equity'];

/** Tuple compare so the ranking is stable: bigger effect first, then bigger raw change, then code, then name. */
function compareRows(a: StatementChangeRow, b: StatementChangeRow): number {
  const byEffect = Math.abs(b.effectCents) - Math.abs(a.effectCents);
  if (byEffect !== 0) return byEffect;
  const byChange = Math.abs(b.changeCents) - Math.abs(a.changeCents);
  if (byChange !== 0) return byChange;
  const byCode = (a.code || '').localeCompare(b.code || '');
  if (byCode !== 0) return byCode;
  return a.name.localeCompare(b.name);
}

/**
 * The accounts behind a statement figure's change, ranked by how much each one moved it.
 *
 * `current` and `prior` are the two sides' account maps; an account present on only one side is
 * compared with 0, which is what the statement shows for it.
 */
export function buildStatementChange(
  current: StatementSides | null | undefined,
  prior: StatementSides | null | undefined,
  options: StatementChangeOptions,
): StatementChangeSet {
  const rows: StatementChangeRow[] = [];
  let unchangedCount = 0;
  let currentTotalCents = 0;
  let priorTotalCents = 0;

  for (const section of SECTION_ORDER) {
    const sign = options.signs[section];
    const currentAccounts = current?.[section] || {};
    const priorAccounts = prior?.[section] || {};
    const ids = new Set([...Object.keys(currentAccounts), ...Object.keys(priorAccounts)]);
    for (const accountId of ids) {
      const now = currentAccounts[accountId];
      const before = priorAccounts[accountId];
      const currentCents = Math.round(now?.balance || 0);
      const priorCents = Math.round(before?.balance || 0);
      // totals count every section that has a sign, whether or not the section is on screen
      if (sign) {
        currentTotalCents += sign * currentCents;
        priorTotalCents += sign * priorCents;
      }
      const changeCents = currentCents - priorCents;
      const effectCents = sign ? changeCents * sign : 0;
      if (effectCents === 0) {
        unchangedCount += 1;
        continue;
      }
      rows.push({
        accountId,
        name: now?.name || before?.name || accountId,
        ...(now?.code || before?.code ? { code: now?.code || before?.code } : {}),
        section,
        currentCents,
        priorCents,
        changeCents,
        effectCents,
      });
    }
  }

  rows.sort(compareRows);
  return {
    rows,
    unchangedCount,
    currentTotalCents,
    priorTotalCents,
    changeCents: currentTotalCents - priorTotalCents,
  };
}

/**
 * A change as a percentage of the figure it is compared with, or `null` when that figure is 0:
 * a percentage of nothing is not 100%, it is undefined.
 */
export function changePercent(changeCents: number, priorCents: number): number | null {
  if (!priorCents) return null;
  return (changeCents / Math.abs(priorCents)) * 100;
}

/**
 * The posted entries that make up a movement between two dates: the day after the compared date
 * through the later date. Returns `null` when the two dates are not in ascending order, because the
 * range would then be empty or backwards and "no movement" would be a wrong answer rather than an
 * empty one.
 */
export function movementWindow(priorDate: string, asOfDate: string): { start: string; end: string } | null {
  const before = (priorDate || '').slice(0, 10);
  const after = (asOfDate || '').slice(0, 10);
  if (!before || !after || before >= after) return null;
  // the calendar, not a time zone: a stored date is a civil date
  return { start: addToDateISO(before, { days: 1 }), end: after };
}

/**
 * The accounts of one statement section, as the change builder wants them: the chart's names and
 * codes with the balances the report holds for that date. Accounts with no balance on either side
 * still come through (they may have moved to 0), which is what makes "unchanged" honest.
 */
export function accountValues(
  accounts: readonly { id: string; name: string; code?: string; type?: string }[],
  balances: Record<string, number> | null | undefined,
  type: string,
): Record<string, StatementAccountValue> {
  const values: Record<string, StatementAccountValue> = {};
  for (const account of accounts) {
    if (account.type !== type) continue;
    values[account.id] = {
      name: account.name,
      ...(account.code ? { code: account.code } : {}),
      balance: Math.round(balances?.[account.id] || 0),
    };
  }
  return values;
}
