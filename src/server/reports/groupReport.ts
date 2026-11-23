/**
 * The group summary (Z-20, first step of the multi-entity design Z-16): for one of the person's
 * groups of books (DA-01) and a period, each member's profit and loss and balance sheet side by side,
 * and the group's total when all members keep their books in the same currency. Each member is read
 * under the person's own access, never copied into another ledger; members the person can no longer
 * open are not included, and the answer says how many. Every figure is the member's own report, so it
 * can be opened in its own books.
 *
 * Translation (Z-17, Z-18): with a reporting currency, each member in another currency is translated
 * with the rates given for it (1 unit of its currency in the reporting currency): the closing rate
 * at the end date for assets and liabilities, the period's average rate for its income and costs,
 * and the historical rate for its equity and the profit of earlier periods. The difference that
 * leaves is the translation difference (CTA), shown on its own line so the group still balances.
 * Rates are never invented: a missing one is refused.
 *
 * Dealings between the companies (Z-19): an entry posted as intercompany (`metadata.isIntercompany`,
 * with the other company and its entry) needs its match there. Matched pairs are counted; the rest
 * are listed with why: the match is missing, was undone, or has another amount, or the other company
 * is outside the group (or not one the person can open).
 *
 * Eliminations (CB-26, Z-16 step 5): what the companies owe each other (balances on their
 * intercompany accounts: role 'intercompany', or "Intercompany" in the name) is taken out of the
 * group's total assets and liabilities. If the two sides differ, the difference is said, and kept in
 * equity so the total still balances. Their sales to each other in the period (the income and the
 * costs of intercompany entries in force between members) are taken out of the total income, cost of
 * goods sold and expenses; net income stays the companies' own, so if the two sides disagree, the
 * difference is said and stays in it.
 *
 * Parent and ownership (Z-16): when the group names its parent company, every other member is one the
 * parent controls (owned above 50%), so its books are added in full and the part that belongs to its
 * other owners (non-controlling interest) is said: their share of its equity and of its profit. A
 * group with a parent is a consolidation, so it is refused while any of its companies is not one the
 * person can open, never quietly short. The parent's investment in each company (the balance of the
 * account named for it in the parent's books) is taken out of the total assets and equity. When the day
 * the parent bought the company is given, what it paid above its share of the company's book value
 * (the company's equity at the end of that day) is goodwill: it stays in the total assets and equity
 * and is said. Paid below the book value is said too, and nothing is added. An account holding several
 * companies has goodwill only when the day each was bought is given. This figure is a book-value
 * estimate only: it does not measure the identifiable net assets at acquisition-date fair value, so it
 * is not the statutory goodwill of a business combination under IFRS 3 (see GC-02).
 *
 * Associates (Z-16, the equity method): a company the parent owns 20% to 50% of is shown side by side
 * but not added to the total. Instead the parent's investment in it (left in the total) grows by the
 * parent's share of the company's equity since the day bought, and the parent's share of its profit
 * after that day, in the period, is added to the group's net income (said on its own line). Its
 * balances and sales with the others are not taken out.
 */
import type { Firestore } from '../db/firestore';
import { canReadGroup, openable } from '../services/workspaceGroupService';
import { isAssociate, shareOf } from '../../lib/workspaceGroups';
import { addDaysYMD } from '../../lib/fiscalCalendar';
import { groupAccountLines, type GroupAccountLine, type LineAccount, type LineSection } from './groupAccounts';
import { computeBalanceSheet, computeProfitAndLoss } from './computeReports';
import type { ChartAccount, Transaction } from '../../types';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { convertMinorUnits, minorUnitRate } from '../../lib/currencyMinorUnits';
import { resolveAccountRole } from '../../lib/accountUtils';

export class GroupReportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GroupReportError';
  }
}

export interface GroupFigures {
  income: number;
  cogs: number;
  grossProfit: number;
  expense: number;
  netIncome: number;
  totalAssets: number;
  totalLiabilities: number;
  /** equity accounts and the profit not yet closed into them */
  totalEquity: number;
}

export interface TranslationRates {
  /** at the end date: assets and liabilities */
  closing: number;
  /** over the period: income and costs */
  average: number;
  /** when the equity was put in: equity and earlier profit */
  historical: number;
}

export interface GroupMember extends GroupFigures {
  workspaceId: string;
  name: string;
  currency: string;
  isBalanced: boolean;
  /** Z-16: the parent's share of this company, in percent (100 without a parent) */
  share: number;
  /** Z-16: owned 50% or less: on the equity method, not added to the total */
  associate?: boolean;
  /** in the reporting currency, when one was asked for */
  translated?: GroupFigures & { cta: number; rates: TranslationRates | null };
}

export interface GroupSummary {
  group: { id: string; name: string };
  startDate: string;
  endDate: string;
  members: GroupMember[];
  /** the group's total: in the reporting currency, or when every member uses the same currency */
  total: (GroupFigures & { currency: string; cta: number; eliminated: Eliminated; otherOwners?: OtherOwners; associates?: Associates }) | null;
  /** Z-16: the parent company, when the group names one */
  parent: { workspaceId: string; name: string } | null;
  /** members of the group this person can no longer open (left out) */
  notIncluded: number;
  /** Z-19: dealings between the members in the period */
  intercompany: IntercompanySummary;
  /** Z-20: account by account, when asked for and there is a total */
  accountLines?: GroupAccountLine[];
  /** whether this person may combine lines (the group's owner), and the combinations saved */
  lineMerges?: { canCombine: boolean; merges: Record<string, string> };
}

/** Z-16: the associates on the equity method, inside the total */
export interface Associates {
  /** the parent's share of their profit after the day bought, in the period (in net income) */
  profit: number;
  /** the parent's share of their equity since the day bought (added to its investment, in assets and equity) */
  equity: number;
}

/** Z-16: what belongs to the companies' other owners (non-controlling interest), inside the total */
export interface OtherOwners {
  /** of total equity */
  equity: number;
  /** of net income */
  netIncome: number;
}

export interface Eliminated {
  /** owed to members by members, taken out of total assets */
  assets: number;
  /** owed by members to members, taken out of total liabilities */
  liabilities: number;
  /** assets − liabilities: what the two sides disagree on (kept in equity) */
  difference: number;
  /** sales between the companies in the period, taken out of total income */
  income: number;
  /** their cost of goods sold and expenses on the other side, taken out of those totals */
  cogs: number;
  expense: number;
  /** income − cogs − expense taken out: what the two sides disagree on (kept in net income) */
  profitDifference: number;
  /** Z-16: the parent's investment in the companies it owns, taken out of total assets and equity */
  investment: number;
  /** Z-16: what the parent paid above its share of the book value of the companies it bought (kept in assets) */
  goodwill?: number;
  /** what it paid below that share (said only) */
  belowBookValue?: number;
  /** GC-03: the profit on inventory the companies sold to each other and the buyers still hold at
   * the end of the period, taken out of the total assets, equity and net income */
  unrealizedProfit?: number;
}

/** An account holding what a company owes or is owed by the others in its group. */
export const isIntercompanyAccount = (acc: Pick<ChartAccount, 'name'> & { role?: string }) => acc.role === 'intercompany' || /intercompany/i.test(acc.name || '');

export type IntercompanyReason = 'missing' | 'undone' | 'amount' | 'outside-group' | 'not-open';

export interface IntercompanyIssue {
  workspaceId: string;
  transactionId: string;
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  withWorkspaceId: string;
  /** the other company's name, when it is in the group */
  withName: string | null;
  reason: IntercompanyReason;
  /** the other side's amount, when it differs */
  otherAmountCents?: number;
}

export interface IntercompanySummary {
  /** pairs found on both sides, in force, with the same amount */
  matched: number;
  unmatched: IntercompanyIssue[];
}

const inForce = (tx: Transaction) => isPostable(tx) && !tx.reversalEventId && !tx.metadata?.isReversal;

/**
 * Each intercompany entry in force, dated in the period, against its match in the other company.
 * `entries` are each member's intercompany entries up to the end date (a match may be dated earlier).
 */
export function matchIntercompany(members: Array<{ workspaceId: string; name: string; currency: string; entries: Transaction[] }>, open: Set<string>, startDate: string, endDate: string): IntercompanySummary {
  const byWorkspace = new Map(members.map(m => [m.workspaceId, m]));
  let matched = 0;
  const unmatched: IntercompanyIssue[] = [];
  for (const m of members) {
    for (const e of m.entries) {
      const date = String(e.date || '').slice(0, 10);
      if (!inForce(e) || date < startDate || date > endDate) continue;
      const meta = (e.metadata || {}) as Record<string, unknown>;
      const withWorkspaceId = String(meta.targetWorkspaceId || meta.sourceWorkspaceId || '');
      const otherId = String(meta.targetTxId || meta.sourceTxId || '');
      const other = byWorkspace.get(withWorkspaceId);
      const issue = (reason: IntercompanyReason, extra: Partial<IntercompanyIssue> = {}) => unmatched.push({
        workspaceId: m.workspaceId, transactionId: e.id, date, description: e.description || '', amountCents: Math.round(Number(e.totalAmountCents) || 0),
        currency: m.currency, withWorkspaceId, withName: other?.name || null, reason, ...extra,
      });
      if (!other) { issue(open.has(withWorkspaceId) ? 'outside-group' : 'not-open'); continue; }
      const match = other.entries.find(x => x.id === otherId);
      if (!match) { issue('missing'); continue; }
      if (!inForce(match)) { issue('undone'); continue; }
      const otherAmountCents = Math.round(Number(match.totalAmountCents) || 0);
      if (other.currency === m.currency && otherAmountCents !== Math.round(Number(e.totalAmountCents) || 0)) {
        // reported once, from the side that started it
        if (meta.targetWorkspaceId) issue('amount', { otherAmountCents });
        continue;
      }
      if (meta.targetWorkspaceId) matched += 1;
    }
  }
  return { matched, unmatched };
}

const FIGURES: Array<keyof GroupFigures> = ['income', 'cogs', 'grossProfit', 'expense', 'netIncome', 'totalAssets', 'totalLiabilities', 'totalEquity'];

type ReadMember = Omit<GroupMember, 'share'> & { equityWhenBought: number | null; profitSinceBought: number; earlierProfit: number; equityAccounts: number; intercompany: Transaction[]; owedBy: number; owedTo: number; withinGroup: { income: number; cogs: number; expense: number }; assetBalances: Record<string, number>;
  chart: LineAccount[]; sections: Record<LineSection, Record<string, number>>;
  icSales: IntercompanyGoodsSale[]; icPurchases: IntercompanyGoodsPurchase[]; inventoryOnHand: number; inventoryOpening: number };

/** GC-03: one intercompany sale by this company to another group company: its income and the seller's own
 * cost of goods linked to it (both in the seller's minor units). */
interface IntercompanyGoodsSale { id: string; pairId: string; buyer: string; date: string; incomeCents: number; cogsCents: number }
/** GC-03: inventory this company capitalized from an intercompany purchase (its minor units). */
interface IntercompanyGoodsPurchase { id: string; pairId: string; seller: string; date: string; inventoryCents: number }

/** Document links that tie a cost-of-goods entry to a sale of its own (an external invoice, a delivery). */
const DOCUMENT_LINKS = ['invoiceId', 'cogsForInvoiceId', 'deliveryId', 'creditNoteId', 'billId', 'orderId'];

/** The entry on the other company's books that an intercompany entry is paired with. */
const pairOf = (tx: Transaction) => String(tx.metadata?.targetTxId || tx.metadata?.sourceTxId || '');

/** The other company of an intercompany entry. */
const otherCompany = (tx: Transaction) => String(tx.metadata?.targetWorkspaceId || tx.metadata?.sourceWorkspaceId || '');

async function memberFigures(db: Firestore, workspaceId: string, startDate: string, endDate: string, group: Set<string>, boughtOn?: string, joinedOn: Record<string, string> = {}): Promise<ReadMember> {
  const ws = (await db.collection('workspaces').doc(workspaceId).get()).data() || {};
  const accounts = (await db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  const transactions = (await db.collection('transactions').where('workspaceId', '==', workspaceId).where('date', '<=', endDate).get()).docs
    .map(d => ({ ...d.data(), id: d.id }) as Transaction);
  // GC-01: a controlled subsidiary joins the group on the day control is obtained, not from the
  // beginning of the period. A company with a known acquisition date counts from the day after it,
  // and its balance sheet is included only once the acquisition is on or before the end date;
  // before that it is outside the consolidated group entirely. A company with no acquisition date
  // was never bought in this group and is included in full.
  const acquiredOn = boughtOn ? String(boughtOn).slice(0, 10) : undefined;
  // excluded = a known acquisition that is after the period end (the company is not yet owned)
  const excluded = Boolean(acquiredOn) && acquiredOn! > endDate;
  // excluded: the acquisition is after the period end — no profit of that company is the group's
  const plStart = excluded ? addDaysYMD(endDate, 1) : (Boolean(acquiredOn) && acquiredOn! >= startDate ? addDaysYMD(acquiredOn!, 1) : startDate);
  const pl = computeProfitAndLoss(accounts, transactions, plStart, endDate);
  const emptyBs = { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, netIncome: 0, isBalanced: true, assets: {} as Record<string, number>, liabilities: {} as Record<string, number>, equity: {} as Record<string, number> };
  const bs = excluded ? emptyBs : computeBalanceSheet(accounts, transactions, endDate);
  const intercompany = transactions.filter(tx => tx.metadata?.isIntercompany === true);
  // Z-16: its equity at the end of the day the parent bought it (its book value then)
  const then = boughtOn && boughtOn <= endDate ? computeBalanceSheet(accounts, transactions, boughtOn) : null;
  // the period's profit after that day (the part an associate's owner takes in)
  const from = boughtOn && boughtOn >= startDate ? addDaysYMD(boughtOn, 1) : startDate;
  const profitSinceBought = !then ? 0 : from === startDate ? pl.netIncome : from <= endDate ? computeProfitAndLoss(accounts, transactions, from, endDate).netIncome : 0;
  // GC-01 (both sides): an entry with another company is a dealing within the group only once both
  // companies are in it — after this company's acquisition and after the other company's. Before
  // that, the other company was an outside party, and nothing is eliminated.
  const inGroupOn = (tx: Transaction) => {
    const day = String(tx.date || '').slice(0, 10);
    const other = otherCompany(tx);
    const otherJoined = joinedOn[other] ? String(joinedOn[other]).slice(0, 10) : undefined;
    return (!acquiredOn || day > acquiredOn) && (!otherJoined || day > otherJoined);
  };
  const groupDealings = intercompany.filter(tx => inForce(tx) && group.has(otherCompany(tx)) && inGroupOn(tx));
  // CB-26: the income and costs of its dealings in force with the other companies of the group
  const within = computeProfitAndLoss(accounts, groupDealings, plStart, endDate);
  // GC-03: the profit on the inventory this company sold to the other companies of the group, sale by
  // sale and buyer by buyer, so the part the buyers still hold (unrealized profit, IFRS 10 B86(c)) is
  // found per buyer, not from the whole group's inventory.
  const isCogsAccount = (acc: ChartAccount) =>
    acc.type === 'cost_of_goods' || acc.category === 'COGS' || acc.category === 'Direct Costs' || resolveAccountRole(acc) === 'cogs';
  const isInventoryAccount = (acc: ChartAccount) => resolveAccountRole(acc) === 'inventory';
  const accountOf = new Map(accounts.map(a => [a.id, a]));
  const sumWhere = (tx: Transaction, pick: (acc: ChartAccount) => boolean) =>
    (tx.lines || []).reduce((sum, l) => { const acc = accountOf.get(l.accountId); return acc && pick(acc) ? sum + lineAmount(l, tx) : sum; }, 0);
  // the seller's own cost of goods on a sale is a separate entry: linked to it explicitly
  // (metadata.intercompanyTxId, or the cost of goods of the invoice the sale carries), or else a plain
  // cost-of-goods journal of the same day (only cost of goods against inventory, tied to no document of
  // its own, so an external sale's cost is never taken) — each entry is used for one sale only
  const costCandidates = transactions.filter(tx => inForce(tx) && !tx.metadata?.isIntercompany && sumWhere(tx, isCogsAccount) !== 0);
  const used = new Set<string>();
  const linkedCost = (sale: Transaction): number => {
    const saleInvoice = typeof sale.metadata?.invoiceId === 'string' ? sale.metadata.invoiceId : undefined;
    const explicit = costCandidates.filter(tx => !used.has(tx.id) && (tx.metadata?.intercompanyTxId === sale.id
      || (saleInvoice && (tx.metadata?.cogsForInvoiceId === saleInvoice || tx.metadata?.invoiceId === saleInvoice))));
    const day = String(sale.date || '').slice(0, 10);
    const plain = explicit.length > 0 ? [] : costCandidates.filter(tx => !used.has(tx.id) && String(tx.date || '').slice(0, 10) === day
      && !tx.metadata?.intercompanyTxId && !DOCUMENT_LINKS.some(k => tx.metadata?.[k])
      && (tx.lines || []).every(l => { const acc = accountOf.get(l.accountId); return Boolean(acc && (isCogsAccount(acc) || isInventoryAccount(acc))); }));
    const chosen = explicit.length > 0 ? explicit : plain;
    chosen.forEach(tx => used.add(tx.id));
    return chosen.reduce((sum, tx) => sum + sumWhere(tx, isCogsAccount), 0);
  };
  const isIncomeAccount = (acc: ChartAccount) => ['income', 'revenue', 'other_income'].includes(String(acc.type));
  // income is a credit: its lines are negative, so the sale's income is their negated sum
  const icSales: IntercompanyGoodsSale[] = groupDealings
    .map(tx => ({ tx, income: -sumWhere(tx, isIncomeAccount) }))
    .filter(x => x.income > 0)
    .map(({ tx, income }) => ({ id: tx.id, pairId: pairOf(tx), buyer: otherCompany(tx), date: String(tx.date || '').slice(0, 10), incomeCents: income, cogsCents: linkedCost(tx) }));
  // what the company bought from the other companies of the group as inventory, purchase by purchase
  const icPurchases: IntercompanyGoodsPurchase[] = groupDealings
    .map(tx => ({ id: tx.id, pairId: pairOf(tx), seller: otherCompany(tx), date: String(tx.date || '').slice(0, 10), inventoryCents: sumWhere(tx, isInventoryAccount) }))
    .filter(x => x.inventoryCents !== 0);
  const inventoryOnHand = accounts.filter(isInventoryAccount).reduce((sum, a) => sum + (bs.assets[a.id] || 0), 0);
  // its inventory the day before the report starts, for the unrealized profit already in the opening books
  const openingBs = excluded ? emptyBs : computeBalanceSheet(accounts, transactions, addDaysYMD(startDate, -1));
  const inventoryOpening = accounts.filter(isInventoryAccount).reduce((sum, a) => sum + (openingBs.assets[a.id] || 0), 0);
  return {
    workspaceId,
    name: String(ws.name || workspaceId),
    currency: String(ws.currency || 'USD'),
    income: pl.income.total,
    cogs: pl.cogs.total,
    grossProfit: pl.grossProfit,
    expense: pl.expense.total,
    netIncome: pl.netIncome,
    totalAssets: bs.totalAssets,
    totalLiabilities: bs.totalLiabilities,
    totalEquity: bs.totalEquity + bs.netIncome,
    isBalanced: bs.isBalanced,
    equityAccounts: bs.totalEquity,
    equityWhenBought: then ? then.totalEquity + then.netIncome : null,
    profitSinceBought,
    // profit before the period that is not closed into equity yet
    earlierProfit: bs.netIncome - pl.netIncome,
    intercompany,
    withinGroup: { income: within.income.total, cogs: within.cogs.total, expense: within.expense.total },
    assetBalances: Object.fromEntries(accounts.filter(a => a.type === 'asset').map(a => [a.id, bs.assets[a.id] || 0])),
    // Z-20: each account's figure, for the account-by-account view
    chart: accounts.map(a => ({ id: a.id, name: a.name, code: a.code })),
    sections: {
      income: Object.fromEntries(Object.entries(pl.income.accounts).map(([id, a]) => [id, a.balance])),
      cogs: Object.fromEntries(Object.entries(pl.cogs.accounts).map(([id, a]) => [id, a.balance])),
      expense: Object.fromEntries(Object.entries(pl.expense.accounts).map(([id, a]) => [id, a.balance])),
      asset: bs.assets, liability: bs.liabilities, equity: bs.equity,
    },
    // CB-26: balances with the other companies (assets: owed to it; liabilities: it owes)
    owedBy: accounts.filter(a => a.type === 'asset' && isIntercompanyAccount(a)).reduce((s, a) => s + (bs.assets[a.id] || 0), 0),
    owedTo: accounts.filter(a => a.type === 'liability' && isIntercompanyAccount(a)).reduce((s, a) => s + (bs.liabilities[a.id] || 0), 0),
    icSales, icPurchases, inventoryOnHand, inventoryOpening,
  };
}

const ratesProblem = (currency: string, r: TranslationRates | undefined) =>
  !r || ![r.closing, r.average, r.historical].every(x => Number.isFinite(x) && x > 0)
    ? `Enter the closing, average and historical rates for ${currency} (1 ${currency} in the reporting currency)`
    : null;

/**
 * One member's figures in the reporting currency (whole minor units), and its translation difference.
 * `from`/`to` are the member's and the report's currencies: the rate is quoted for major units, so the
 * digits difference has to travel with it (BM-04) — a yen member's whole yen are not cents.
 */
export function translate(
  m: GroupFigures & { equityAccounts: number; earlierProfit: number },
  r: TranslationRates | null,
  from?: string,
  to?: string,
): GroupFigures & { cta: number } {
  const at = (cents: number, rate: number) => convertMinorUnits(cents, rate, from, to);
  if (!r) return { income: m.income, cogs: m.cogs, grossProfit: m.grossProfit, expense: m.expense, netIncome: m.netIncome, totalAssets: m.totalAssets, totalLiabilities: m.totalLiabilities, totalEquity: m.totalEquity, cta: 0 };
  const income = at(m.income, r.average);
  const cogs = at(m.cogs, r.average);
  const expense = at(m.expense, r.average);
  const netIncome = at(m.netIncome, r.average);
  const totalAssets = at(m.totalAssets, r.closing);
  const totalLiabilities = at(m.totalLiabilities, r.closing);
  const equity = at(m.equityAccounts + m.earlierProfit, r.historical) + netIncome;
  const cta = totalAssets - totalLiabilities - equity;
  return { income, cogs, grossProfit: income - cogs, expense, netIncome, totalAssets, totalLiabilities, totalEquity: equity + cta, cta };
}

export async function groupSummary(db: Firestore, input: { uid: string; groupId: string; startDate: string; endDate: string; reportCurrency?: string; rates?: Record<string, TranslationRates>; detail?: 'accounts' }): Promise<GroupSummary> {
  if (input.startDate > input.endDate) throw new GroupReportError(400, 'The period starts after it ends');
  const open = await openable(db, input.uid);
  // N-07: "ws:<id>" is one workspace on its own (its figures in another currency), when the person can open it
  const self = input.groupId.startsWith('ws:') ? input.groupId.slice(3) : null;
  let group: Record<string, unknown> | undefined;
  if (self) {
    if (!open.has(self)) throw new GroupReportError(404, 'Workspace not found');
    group = { ownerUid: input.uid, name: String((await db.collection('workspaces').doc(self).get()).data()?.name || self), workspaceIds: [self] };
  } else {
    group = (await db.collection('workspaceGroups').doc(input.groupId).get()).data();
    // someone else's group answers like a missing one, unless it was shared with this person (DA-01)
    if (!group || !canReadGroup(group, input.uid)) throw new GroupReportError(404, 'Group not found');
  }
  const ids = (Array.isArray(group.workspaceIds) ? group.workspaceIds as string[] : []);
  const shown = ids.filter(id => open.has(id));
  const structure = {
    parentId: typeof group.parentId === 'string' ? group.parentId : undefined,
    ownership: (group.ownership || {}) as Record<string, number>,
    investments: (group.investments || {}) as Record<string, string>,
    acquired: (group.acquired || {}) as Record<string, string>,
  };
  if (structure.parentId && shown.length < ids.length) {
    const n = ids.length - shown.length;
    throw new GroupReportError(403, `This group adds up its companies under a parent, and ${n} of them ${n === 1 ? 'is' : 'are'} not open to you: ask for access, or take ${n === 1 ? 'it' : 'them'} out of the group`);
  }
  // Z-16: companies owned 50% or less are on the equity method, not added to the total
  const associate = (id: string) => Boolean(structure.parentId) && id !== structure.parentId && isAssociate(structure, id);
  const inTotal = new Set(shown.filter(id => !associate(id)));
  const read: ReadMember[] = [];
  // GC-01: the day each bought company joined the group (only companies the parent invested in have one)
  const joinedOn: Record<string, string> = {};
  for (const id of shown) if (structure.parentId && structure.investments[id] && structure.acquired[id]) joinedOn[id] = structure.acquired[id];
  for (const id of shown) read.push(await memberFigures(db, id, input.startDate, input.endDate, inTotal, joinedOn[id], joinedOn));
  const added = read.filter(m => inTotal.has(m.workspaceId));
  const reportCurrency = input.reportCurrency;
  if (reportCurrency) {
    for (const currency of new Set(read.map(m => m.currency).filter(c => c !== reportCurrency))) {
      const problem = ratesProblem(currency, input.rates?.[currency]);
      if (problem) throw new GroupReportError(400, problem);
    }
  }
  const intercompany = matchIntercompany(read.map(m => ({ workspaceId: m.workspaceId, name: m.name, currency: m.currency, entries: m.intercompany })), open, input.startDate, input.endDate);
  const members: GroupMember[] = read.map(({ equityWhenBought: _bought, profitSinceBought: _since, earlierProfit, equityAccounts, intercompany: _entries, owedBy: _by, owedTo: _to, withinGroup: _within, assetBalances: _balances, chart: _chart, sections: _sections, icSales: _icSales, icPurchases: _icPurchases, inventoryOnHand: _onHand, inventoryOpening: _opening, ...rest }) => {
    const m = { ...rest, share: shareOf(structure, rest.workspaceId), ...(associate(rest.workspaceId) ? { associate: true } : {}) };
    if (!reportCurrency) return m;
    const rates = m.currency === reportCurrency ? null : input.rates![m.currency];
    return { ...m, translated: { ...translate({ ...m, earlierProfit, equityAccounts }, rates, m.currency, reportCurrency || m.currency), rates } };
  });
  const currencies = new Set(members.map(m => m.currency));
  // CB-26: balances between the companies, at the closing rate when translated
  // A member's figures are in its own minor units; the report's are not (BM-04), so every conversion
  // goes through the digits-aware helper rather than a bare multiply.
  const toReport = (m: ReadMember, cents: number, kind: 'closing' | 'average' | 'historical'): number => {
    if (!reportCurrency || m.currency === reportCurrency) return cents;
    const rates = input.rates![m.currency];
    return convertMinorUnits(cents, kind === 'closing' ? rates.closing : kind === 'average' ? rates.average : rates.historical, m.currency, reportCurrency);
  };
  const owedBy = added.reduce((s, m) => s + toReport(m, m.owedBy, 'closing'), 0);
  const owedTo = added.reduce((s, m) => s + toReport(m, m.owedTo, 'closing'), 0);
  // sales and costs between the companies, at the average rate when translated
  const within = (f: 'income' | 'cogs' | 'expense') => added.reduce((s, m) => s + toReport(m, m.withinGroup[f], 'average'), 0);
  const [income, cogs, expense] = [within('income'), within('cogs'), within('expense')];
  // GC-03: the profit on intercompany inventory still held inside the group is not the group's (IFRS 10
  // B86(c)). It is found buyer by buyer: the profit the sellers made on their sales to a buyer, times the
  // part of what that buyer bought from the group it still holds (inventory bought from outside the group
  // is assumed sold first) — so another company's own stock never counts as unsold intercompany goods.
  // The balance sheet takes out the unrealized profit at the end; the period's profit takes out only its
  // change since the start (what was unrealized at the start is in the opening equity already).
  const byWorkspace = new Map(added.map(m => [m.workspaceId, m]));
  const startDay = input.startDate;
  const unrealizedAt = (through: 'opening' | 'closing') => {
    let total = 0;
    for (const buyer of added) {
      const counts = (date: string) => (through === 'closing' ? true : date < startDay);
      const bought = buyer.icPurchases.filter(p => byWorkspace.has(p.seller) && counts(p.date))
        .reduce((sum, p) => sum + toReport(buyer, p.inventoryCents, 'closing'), 0);
      if (bought <= 0) continue;
      const onHand = toReport(buyer, through === 'closing' ? buyer.inventoryOnHand : buyer.inventoryOpening, 'closing');
      const held = Math.min(1, Math.max(0, onHand) / bought);
      // only goods: a sale whose paired entry on the buyer's books put the goods in inventory (a
      // recharge or service income has no inventory behind it), its goods part when an entry mixes both
      const inventoryOf = new Map(buyer.icPurchases.map(p => [p.id, p.inventoryCents]));
      const profit = added.reduce((sum, seller) => sum + seller.icSales
        .filter(x => x.buyer === buyer.workspaceId && counts(x.date) && (inventoryOf.get(x.pairId) || 0) > 0)
        .reduce((ss, x) => {
          // the buyer's inventory is in its own currency and minor units, the seller's income in the
          // seller's: both are translated to the report's at the same (average) rate before dividing,
          // so the goods part is a true fraction whatever currencies the two companies keep
          const inventoryReport = toReport(buyer, inventoryOf.get(x.pairId) || 0, 'average');
          const incomeReport = toReport(seller, x.incomeCents, 'average');
          const goodsPart = incomeReport > 0 ? Math.min(1, inventoryReport / incomeReport) : 0;
          return ss + toReport(seller, Math.round((x.incomeCents - x.cogsCents) * goodsPart), 'average');
        }, 0), 0);
      total += Math.round(profit * held);
    }
    return total;
  };
  const unrealizedProfit = unrealizedAt('closing');
  const unrealizedChange = unrealizedProfit - unrealizedAt('opening');
  // the cost of goods side of the elimination: the transfer price of the goods bought from the group in
  // the period (it is in the buyer's inventory or, once resold, in its cost of goods — never the group's
  // cost), less the profit still unrealized at the end, plus what was unrealized at the start. Goods held
  // at the end leave the seller's cost in place; goods resold leave only the group's original cost.
  const goodsBought = added.reduce((sum, buyer) => sum + buyer.icPurchases
    .filter(p => byWorkspace.has(p.seller) && p.date >= startDay)
    .reduce((ss, p) => ss + toReport(buyer, p.inventoryCents, 'average'), 0), 0);
  const icCogsToEliminate = goodsBought - unrealizedChange;
  // Z-16: the parent's investment in the companies it owns, from its own balance sheet
  const parentRead = read.find(m => m.workspaceId === structure.parentId);
  let investment = 0;
  let goodwill = 0;
  let belowBookValue = 0;
  let anyBought = false;
  if (parentRead) {
    // one account may hold several companies: counted once, with the book value of each
    const accounts = new Map<string, ReadMember[]>();
    for (const [memberId, accountId] of Object.entries(structure.investments)) {
      const member = read.find(m => m.workspaceId === memberId);
      if (!member || associate(memberId)) continue;
      if (!(accountId in parentRead.assetBalances)) {
        throw new GroupReportError(400, `The investment account chosen for ${member.name} is not an asset account of ${parentRead.name} any more: choose it again in Settings → Groups of books`);
      }
      accounts.set(accountId, [...(accounts.get(accountId) || []), member]);
    }
    for (const [accountId, held] of accounts) {
      const paid = toReport(parentRead, parentRead.assetBalances[accountId], 'closing');
      investment += paid;
      if (!held.every(m => m.equityWhenBought !== null)) continue;
      anyBought = true;
      // the parent's share of each company's equity on the day bought, at the historical rate
      const bookValue = held.reduce((s, m) => s + Math.round(toReport(m, m.equityWhenBought!, 'historical') * shareOf(structure, m.workspaceId) / 100), 0);
      if (paid > bookValue) goodwill += paid - bookValue; else belowBookValue += bookValue - paid;
    }
  }
  const eliminated: Eliminated = {
    assets: owedBy, liabilities: owedTo, difference: owedBy - owedTo, income, cogs: cogs + icCogsToEliminate, expense, profitDifference: income - cogs - icCogsToEliminate - expense, investment,
    ...(anyBought ? { goodwill, belowBookValue } : {}),
    ...(unrealizedProfit ? { unrealizedProfit } : {}),
  };
  const sum = (all: Array<GroupFigures & { cta: number }>, currency: string) => {
    const figures = all.filter((_, i) => !members[i].associate);
    const t = Object.fromEntries([...FIGURES, 'cta' as const].map(f => [f, figures.reduce((s, x) => s + x[f], 0)])) as unknown as GroupFigures & { cta: number };
    // Z-16: the other owners' part of each company the parent owns less than all of (and adds in full)
    const others = (f: 'totalEquity' | 'netIncome') => all.reduce((s, x, i) => s + (members[i].associate ? 0 : Math.round(x[f] * (100 - members[i].share) / 100)), 0);
    const otherOwners = structure.parentId ? { otherOwners: { equity: others('totalEquity'), netIncome: others('netIncome') } } : {};
    // the associates: the parent's share of their profit after the day bought, and of their equity since then
    let associates: Associates | null = null;
    read.forEach((m, i) => {
      if (!members[i].associate || m.equityWhenBought === null) return;
      const share = members[i].share / 100;
      associates = associates || { profit: 0, equity: 0 };
      associates.profit += Math.round(toReport(m, m.profitSinceBought, 'average') * share);
      associates.equity += Math.round((all[i].totalEquity - toReport(m, m.equityWhenBought, 'historical')) * share);
    });
    const picked = (associates || { profit: 0, equity: 0 }) as Associates;
    // net income stays the companies' own: what the two sides disagree on stays in it, and is said
    return {
      currency, ...t, income: t.income - income, cogs: t.cogs - cogs - icCogsToEliminate, grossProfit: t.grossProfit - income + cogs + icCogsToEliminate, expense: t.expense - expense,
      // GC-03: the profit on inventory still inside the group is not the group's: it leaves net income
      netIncome: t.netIncome + picked.profit - unrealizedChange,
      totalAssets: t.totalAssets - owedBy - investment + goodwill + picked.equity - unrealizedProfit, totalLiabilities: t.totalLiabilities - owedTo,
      totalEquity: t.totalEquity - eliminated.difference - investment + goodwill + picked.equity - unrealizedProfit, eliminated, ...otherOwners, ...(associates ? { associates: picked } : {}),
    };
  };
  const total = members.length === 0 ? null
    : reportCurrency ? sum(members.map(m => m.translated!), reportCurrency)
      : currencies.size === 1 ? sum(members.map(m => ({ ...m, cta: 0 })), members[0].currency) : null;
  const parent = members.find(m => m.workspaceId === structure.parentId);
  // Z-20: account by account, in the total's currency (so only when there is a total)
  let accountLines: GroupAccountLine[] | undefined;
  if (input.detail === 'accounts' && total) {
    accountLines = groupAccountLines(read.flatMap((m, i) => {
      if (members[i].associate) return [];
      const r = reportCurrency && m.currency !== reportCurrency ? input.rates![m.currency] : null;
      // the screens multiply this member's minor units by this factor, so it carries the digits too
      const rate = (section: LineSection) => (!r ? 1 : minorUnitRate(
        section === 'asset' || section === 'liability' ? r.closing : section === 'equity' ? r.historical : r.average,
        m.currency, reportCurrency,
      ));
      const translated = members[i].translated;
      // the same rounding groupAccountLines applies to each equity line, so the lines add up to totalEquity exactly
      const equityLines = Object.values(m.sections.equity).reduce((sum, cents) => sum + Math.round(cents * rate('equity')), 0);
      const cta = translated?.cta || 0;
      const totalEquity = translated ? translated.totalEquity : m.totalEquity;
      return [{ workspaceId: m.workspaceId, accounts: m.chart, sections: m.sections, rate, extraEquity: { profit: totalEquity - cta - equityLines, cta } }];
    }), (group.lineMerges && typeof group.lineMerges === 'object' ? group.lineMerges : {}) as Record<string, string>);
  }
  return {
    group: { id: input.groupId, name: String(group.name || '') }, startDate: input.startDate, endDate: input.endDate, members, total,
    parent: parent ? { workspaceId: parent.workspaceId, name: parent.name } : null, notIncluded: ids.length - shown.length, intercompany,
    ...(accountLines ? {
      accountLines,
      lineMerges: { canCombine: !self && group.ownerUid === input.uid, merges: (group.lineMerges && typeof group.lineMerges === 'object' ? group.lineMerges : {}) as Record<string, string> },
    } : {}),
  };
}
