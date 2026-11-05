/**
 * Data-health checks (launch step 8; shortcut 11): each check is one entry in DATA_CHECKS with an
 * id, a label and a pure `run` over the workspace's records; the Data Health screen lists the
 * registry and links each finding to its record (Z-32). Adding a check = adding one entry.
 * Money is compared in integer cents with lineAmount() on postable entries (AGENTS.md).
 */
import type { BankStatementLine, Bill, ChartAccount, Customer, DimensionDefinition, Invoice, Payment, RecurringTransaction, Transaction, Vendor } from '../types';
import { isPostable, lineAmount } from './txFilters';
import { calculateAmountDue, cashPostedWithDocumentCents, depositAppliedCents } from './documentMath';
import { convertMinorUnits } from './currencyMinorUnits';
import { BILL_IS_ISSUED, INVOICE_IS_ISSUED } from '../server/reports/computeReports';
import { findTaxDifferences } from './taxRecompute';
import { missingLabels } from './requiredLabels';
import { labelRoleFindings } from './labelRoles';
import { stockHistoryProblem, type StockMove } from './stockMoves';
import { STOCK_INVARIANT_CHECKS, type StockClosing } from './stockInvariants';
import { contactsMissingFilingDetails, itemsMissingPricing } from './dataQualityChecks';
import { formatCurrency } from './moneyFormat';
import { openingDebitCents, resolveAccountRole } from './accountUtils';
import type { RecordType } from './recordLinks';

export { RECORD_TABS } from './recordLinks';
export type { RecordType } from './recordLinks';

export type CheckSeverity = 'high' | 'medium' | 'low';

export interface CheckFinding {
  id: string;
  checkId: string;
  severity: CheckSeverity;
  title: string;
  description: string;
  record?: { type: RecordType; id: string };
}

export interface CheckContext {
  transactions: Transaction[];
  accounts: ChartAccount[];
  invoices: Invoice[];
  bills: Bill[];
  recurring: RecurringTransaction[];
  inventory?: Array<{
    id: string;
    sku?: string;
    name?: string;
    quantityAtHand?: number;
    unitCostCents?: number;
    unitPriceCents?: number;
    itemType?: 'stock' | 'service';
    consignment?: string;
    bundleParts?: Array<{ itemId: string; quantity: number }>;
    status?: string;
  }>;
  bankLines?: BankStatementLine[];
  /** The workspace's today (YYYY-MM-DD). */
  today: string;
  /** Home currency, for documents without one. */
  baseCurrency: string;
  /** Optional home country from workspace tax profiles, for filing-readiness checks (A-196). */
  workspaceCountry?: string;
  /** Customers and vendors, for filing tax-ID and address checks (A-196). */
  customers?: Array<Partial<Customer> & { id: string; name?: string; metadata?: Record<string, unknown> }>;
  vendors?: Array<Partial<Vendor> & { id: string; name?: string; is1099?: boolean; isForeign?: boolean; country?: string; metadata?: Record<string, unknown> }>;
  /** The workspace's labels, with their required-label rules (Z-12). */
  dimensions?: DimensionDefinition[];
  /** The stock-moves ledger (W-02); the nightly check reads it, the browser does not load it. */
  stockMoves?: StockMove[];
  /** EG-7: the stock closing snapshots (server-only), checked against the moves they cover */
  stockClosings?: StockClosing[];
  /** The sources read only up to a cap, by name (nightly caps; the browser's cut collections, EG-10), never an any-collection flag. */
  truncated?: string[];
  /** EG-2 payment-ledger rows (`paymentAllocations`); the nightly check reads them, the browser does not. */
  allocations?: Array<{ id: string; documentId?: string; documentType?: string; kind?: string; amountCents?: number; baseClearedCents?: number }>;
  /** Payment records (CB-23: each has its entry in the ledger). */
  payments?: Array<Partial<Payment> & { id: string; number?: string; status?: string; amountCents?: number; exchangeRate?: number; paymentExchangeRate?: number; paymentDate?: string; date?: string; contactName?: string; entityName?: string }>;
}

export interface DataCheck {
  id: string;
  label: string;
  /** What to do about a finding, in one sentence. */
  remedy: string;
  run: (ctx: CheckContext) => CheckFinding[];
}

const ISSUED = new Set(['sent', 'pending', 'approved', 'paid', 'partially_paid', 'overdue']);
const label = (doc: { number?: string; id: string }) => doc.number || doc.id;

/** Groups by key and returns the groups with more than one member. */
function duplicates<T>(items: T[], key: (item: T) => string | null): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) || []), item]);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

export const DATA_CHECKS: DataCheck[] = [
  {
    id: 'unbalanced',
    label: 'Entries whose debits and credits differ',
    remedy: 'Open the entry and correct its lines, or reverse it.',
    run: ({ transactions }) => transactions.filter(isPostable).flatMap(tx => {
      const lines = tx.lines || [];
      if (lines.length === 0) return [];
      // balanced in the entry's own currency (the server's rule) or after each line's own rate.
      // Only the converted sum used to count, and rounding each converted line makes balanced
      // foreign entries look a cent off (+5.5 → 6, −5.5 → −5; see L-164).
      const sum = lines.reduce((s, l) => s + (l.amountCents || 0), 0);
      if (sum === 0 || lines.reduce((s, l) => s + lineAmount(l, tx), 0) === 0) return [];
      return [{
        id: `unbalanced-${tx.id}`, checkId: 'unbalanced', severity: 'high' as const,
        title: `Entry ${tx.description || tx.id} does not balance`,
        description: `Its debits exceed its credits by ${formatCurrency(sum, tx.currency)} (${tx.date || 'no date'}).`,
        record: { type: 'transaction' as const, id: tx.id },
      }];
    }),
  },
  {
    id: 'missing-account',
    label: 'Entry lines pointing to an account that no longer exists',
    remedy: 'Move the line to an existing account.',
    run: ({ transactions, accounts }) => {
      const ids = new Set(accounts.map(a => a.id));
      return transactions.filter(isPostable).flatMap(tx => (tx.lines || []).flatMap((l, n) => (l.accountId && !ids.has(l.accountId) ? [{
        id: `missing-account-${tx.id}-${n}`, checkId: 'missing-account', severity: 'high' as const,
        title: `Entry ${tx.description || tx.id} uses a missing account`,
        description: `Line ${n + 1} points to "${l.accountName || l.accountId}", which is not in the chart of accounts.`,
        record: { type: 'transaction' as const, id: tx.id },
      }] : [])));
    },
  },
  {
    id: 'duplicate-invoice-number',
    label: 'Two invoices with the same number (Z-07)',
    remedy: 'Give one of them a new number, or void the duplicate.',
    run: ({ invoices }) => duplicates(invoices.filter(i => i.status !== 'void' && i.status !== 'draft'), i => (i.number ? i.number.trim().toLowerCase() : null))
      .map(group => ({
        id: `dup-invoice-${group[0].number}`, checkId: 'duplicate-invoice-number', severity: 'medium' as const,
        title: `Invoice number ${group[0].number} is used ${group.length} times`,
        description: `Customers: ${group.map(i => i.customerName || i.customerId).join(', ')}.`,
        record: { type: 'invoice' as const, id: group[1].id },
      })),
  },
  {
    id: 'duplicate-bill',
    label: 'The same vendor bill entered twice (Z-08)',
    remedy: 'Check both bills; void the one entered by mistake.',
    run: ({ bills }) => duplicates(bills.filter(b => b.status !== 'void' && b.status !== 'draft'), b => (b.number ? `${b.vendorId}|${b.number.trim().toLowerCase()}` : null))
      .map(group => ({
        id: `dup-bill-${group[0].vendorId}-${group[0].number}`, checkId: 'duplicate-bill', severity: 'high' as const,
        title: `Bill ${group[0].number} from ${group[0].vendorName || 'the same vendor'} is entered ${group.length} times`,
        description: `Amounts: ${group.map(b => formatCurrency(b.amountCents, b.currency)).join(', ')}. Paying both would pay the vendor twice.`,
        record: { type: 'bill' as const, id: group[1].id },
      })),
  },
  {
    id: 'future-dated',
    label: 'Entries dated in the future (Z-10)',
    remedy: 'Check the date; future dates are usually typing mistakes.',
    run: ({ transactions, today }) => {
      const limit = today;
      return transactions.filter(tx => isPostable(tx) && typeof tx.date === 'string' && tx.date.slice(0, 10) > limit && !tx.metadata?.scheduled)
        .map(tx => ({
          id: `future-${tx.id}`, checkId: 'future-dated', severity: 'low' as const,
          title: `Entry dated ${tx.date.slice(0, 10)}`,
          description: `${tx.description || tx.id} is dated after today.`,
          record: { type: 'transaction' as const, id: tx.id },
        }));
    },
  },
  {
    id: 'empty-invoice',
    label: 'Issued invoices with no amount, no lines, or lines without an account (Z-14)',
    remedy: 'Add the missing lines or accounts, or void the invoice.',
    run: ({ invoices }) => invoices.filter(i => ISSUED.has(i.status)).flatMap(inv => {
      const items = inv.items || [];
      const problems: string[] = [];
      if (!(inv.amountCents > 0)) problems.push('its total is zero');
      if (items.length === 0) problems.push('it has no lines');
      const noAccount = items.filter(it => (it.amountCents || 0) !== 0 && !it.accountId).length;
      if (noAccount > 0) problems.push(`${noAccount} line(s) have no income account (posted to the default one)`);
      return problems.length === 0 ? [] : [{
        id: `empty-invoice-${inv.id}`, checkId: 'empty-invoice', severity: inv.amountCents > 0 ? 'low' as const : 'medium' as const,
        title: `Invoice ${label(inv)}: ${problems[0]}`,
        description: problems.join('; ') + '.',
        record: { type: 'invoice' as const, id: inv.id },
      }];
    }),
  },
  {
    id: 'overpaid',
    label: 'Invoices and bills paid more than their total',
    remedy: 'Check the payments; refund or keep the extra as a credit.',
    run: ({ invoices, bills }) => [
      ...invoices.map(d => ({ d, type: 'invoice' as const })),
      ...bills.map(d => ({ d, type: 'bill' as const })),
    ].filter(({ d }) => (d.amountPaidCents || 0) > (d.amountCents || 0)).map(({ d, type }) => ({
      id: `overpaid-${type}-${d.id}`, checkId: 'overpaid', severity: 'medium' as const,
      title: `${type === 'invoice' ? 'Invoice' : 'Bill'} ${label(d)} is overpaid`,
      description: `Paid ${formatCurrency(d.amountPaidCents, d.currency)} on a total of ${formatCurrency(d.amountCents, d.currency)}.`,
      record: { type, id: d.id },
    })),
  },
  {
    id: 'foreign-without-rate',
    label: 'Documents in another currency without an exchange rate (Z-15)',
    remedy: 'Set the exchange rate on the document so it is booked at the right amount.',
    run: ({ invoices, bills, baseCurrency }) => [
      ...invoices.map(d => ({ d, type: 'invoice' as const })),
      ...bills.map(d => ({ d, type: 'bill' as const })),
    ].filter(({ d }) => d.currency && d.currency !== baseCurrency && !(Number(d.exchangeRate) > 0 && d.exchangeRate !== 1) && d.status !== 'draft' && d.status !== 'void')
      .map(({ d, type }) => ({
        id: `fx-${type}-${d.id}`, checkId: 'foreign-without-rate', severity: 'high' as const,
        title: `${type === 'invoice' ? 'Invoice' : 'Bill'} ${label(d)} is in ${d.currency} at rate 1`,
        description: `It is booked as if 1 ${d.currency} = 1 ${baseCurrency}.`,
        record: { type, id: d.id },
      })),
  },
  {
    id: 'negative-stock',
    label: 'Items with negative stock (Z-09)',
    remedy: 'Record the missing purchase or correct the stock count.',
    run: ({ inventory }) => (inventory || []).filter(i => (i.quantityAtHand || 0) < 0).map(i => ({
      id: `negative-stock-${i.id}`, checkId: 'negative-stock', severity: 'medium' as const,
      title: `${i.name || i.id}: ${i.quantityAtHand} in stock`,
      description: 'More was sold than was bought or counted.',
      record: { type: 'item' as const, id: i.id },
    })),
  },
  {
    id: 'recurring-problem',
    label: 'Recurring schedules that could not run',
    remedy: 'Open the schedule and fix what it says, or pause it.',
    run: ({ recurring }) => recurring.filter(r => r.isActive && r.lastErrorCode).map(r => ({
      id: `recurring-${r.id}`, checkId: 'recurring-problem', severity: 'medium' as const,
      title: `Recurring "${r.description}" could not run`,
      description: String(r.lastErrorCode),
      record: { type: 'recurring' as const, id: r.id },
    })),
  },
  {
    id: 'stale-receivable',
    label: 'Invoices unpaid for more than 180 days',
    remedy: 'Chase the customer, or write the invoice off as bad debt.',
    run: ({ invoices, today }) => invoices.filter(i => ISSUED.has(i.status) && i.dueDate && calculateAmountDue(i) > 0 && i.dueDate.slice(0, 10) < shiftDays(today, -180))
      .map(i => ({
        id: `stale-${i.id}`, checkId: 'stale-receivable', severity: 'low' as const,
        title: `Invoice ${label(i)} is more than 180 days overdue`,
        description: `Due ${i.dueDate.slice(0, 10)}; ${formatCurrency(calculateAmountDue(i), i.currency)} still due.`,
        record: { type: 'invoice' as const, id: i.id },
      })),
  },
  {
    id: 'tax-posting',
    label: 'Tax in the ledger differs from the document',
    remedy: 'Repost the document (Month-end close → Postings), or have the owner run the tax recompute, which posts an adjusting entry.',
    run: ({ invoices, bills, transactions, baseCurrency }) => findTaxDifferences({ invoices, bills, transactions }).map(d => ({
      id: `tax-${d.id}`, checkId: 'tax-posting', severity: 'medium' as const,
      title: `${d.kind === 'invoice' ? 'Invoice' : 'Bill'} ${d.number}: tax in the ledger is ${formatCurrency(d.postedTaxCents, baseCurrency)}, the document says ${formatCurrency(d.expectedTaxCents, baseCurrency)}`,
      description: `${d.party ? `${d.party}. ` : ''}Difference ${formatCurrency(d.differenceCents, baseCurrency)} (home currency).`,
      record: { type: d.kind, id: d.id },
    })),
  },
  {
    id: 'suspense-balance',
    label: 'Suspense, uncategorized or clearing accounts not at zero (Z-11)',
    remedy: 'Move each entry in it to the right account; these accounts should end at zero.',
    run: ({ accounts, transactions, baseCurrency }) => {
      const holding = accounts.filter(a => SUSPENSE.test(`${a.name || ''} ${a.category || ''} ${a.subtype || ''}`));
      if (holding.length === 0) return [];
      const balance = new Map(holding.map(a => [a.id, { cents: 0, entries: 0 }]));
      for (const tx of transactions) {
        if (!isPostable(tx)) continue;
        for (const l of tx.lines || []) {
          const b = balance.get(l.accountId);
          if (b) { b.cents += lineAmount(l, tx); b.entries += 1; }
        }
      }
      return holding.flatMap(a => {
        const b = balance.get(a.id)!;
        return b.cents === 0 ? [] : [{
          id: `suspense-${a.id}`, checkId: 'suspense-balance', severity: 'medium' as const,
          title: `${a.name} holds ${formatCurrency(Math.abs(b.cents), baseCurrency)}`,
          description: `${b.entries} line(s) are parked there (${b.cents > 0 ? 'debit' : 'credit'} balance); reports show them in the wrong place until they are moved.`,
          record: { type: 'account' as const, id: a.id },
        }];
      });
    },
  },
  {
    id: 'stale-unreconciled',
    label: 'Bank lines waiting more than 30 days to be matched (Z-13)',
    remedy: 'Match each line to its entry in Reconcile, create the entry, or ignore the line if it is not yours.',
    run: ({ bankLines, accounts, today }) => {
      const cutoff = shiftDays(today, -30);
      const waiting = (bankLines || []).filter(l => l.status === 'pending' && typeof l.date === 'string' && l.date.slice(0, 10) < cutoff);
      const byAccount = new Map<string, BankStatementLine[]>();
      for (const line of waiting) byAccount.set(line.accountId || '', [...(byAccount.get(line.accountId || '') || []), line]);
      return [...byAccount.entries()].map(([accountId, lines]) => {
        const oldest = lines.reduce((a, b) => (a.date <= b.date ? a : b), lines[0]);
        const name = accounts.find(a => a.id === accountId)?.name || 'a bank account';
        return {
          id: `stale-bank-${accountId || 'none'}`, checkId: 'stale-unreconciled', severity: 'low' as const,
          title: `${lines.length} bank line(s) in ${name} not matched for over 30 days`,
          description: `The oldest is from ${oldest.date.slice(0, 10)}: ${oldest.description || 'no description'}. The bank balance and the books can't agree until they are matched.`,
          record: { type: 'bankLine' as const, id: oldest.id },
        };
      });
    },
  },
  {
    id: 'cleared-before-issued',
    label: 'Entries the bank cleared before they were made (CB-21)',
    remedy: 'Check the entry\'s date, or whether its statement line belongs to another entry: undo the match in Reconcile and match it again.',
    run: ({ bankLines, transactions }) => {
      const byId = new Map(transactions.filter(isPostable).map(t => [t.id, t]));
      return (bankLines || []).flatMap(line => {
        const tx = line.status === 'matched' && line.matchedTransactionId ? byId.get(line.matchedTransactionId) : undefined;
        const cleared = String(line.date || '').slice(0, 10);
        const made = String(tx?.date || '').slice(0, 10);
        // a few days' difference is how banks and books date the same payment
        if (!tx || !cleared || !made || shiftDays(made, -3) <= cleared) return [];
        return [{
          id: `cleared-early-${line.id}`, checkId: 'cleared-before-issued', severity: 'medium' as const,
          title: `${tx.description || 'An entry'} (${made}) was cleared by a statement line of ${cleared}`,
          description: 'A cheque or payment can\'t clear before it is made: the entry\'s date is wrong, or the statement line was matched to the wrong entry.',
          record: { type: 'transaction' as const, id: tx.id },
        }];
      });
    },
  },
  {
    id: 'payment-ledger',
    label: 'Payments without their entry, or with another amount (CB-23)',
    remedy: 'Open the payment: void it and record it again, or undo the entry that cancelled its posting.',
    run: ({ payments, transactions }) => {
      if (!payments) return [];
      const reversed = new Set(transactions.filter(t => t.metadata?.isReversal || t.metadata?.reversesTxId).map(t => String(t.metadata?.reversesTxId || t.metadata?.reversedTransactionId || '')));
      const posting = new Map<string, Transaction>();
      for (const t of transactions) {
        // older postings carry the payment id without a type; a later application of it is not its posting
        if (t.metadata?.paymentId && t.metadata?.type !== 'payment-application' && isPostable(t) && !t.reversalEventId && !reversed.has(t.id)) posting.set(String(t.metadata.paymentId), t);
      }
      // only payments inside the entries read (the browser reads the newest ones), so none looks missing for that
      const oldest = transactions.reduce((min, t) => (t.date && String(t.date).slice(0, 10) < min ? String(t.date).slice(0, 10) : min), '9999-12-31');
      return payments.filter(p => p.status !== 'void' && (p.amountCents || 0) > 0 && String(p.paymentDate || p.date || '').slice(0, 10) >= oldest).flatMap(p => {
        const name = p.number || p.id;
        const who = p.contactName || p.entityName || '';
        const entry = posting.get(p.id);
        if (!entry) {
          return [{ id: `payment-ledger-${p.id}`, checkId: 'payment-ledger', severity: 'high' as const,
            title: `Payment ${name}${who ? ` (${who})` : ''} has no entry in the ledger`,
            description: 'The payment is recorded but its money is not in the books, so the bank and the receivables or payables disagree with it.' }];
        }
        // a payment at another day's rate books the difference as exchange gain or loss: not compared
        if (p.paymentExchangeRate) return [];
        const expected = Math.round((p.amountCents || 0) * (p.exchangeRate && p.exchangeRate > 0 ? p.exchangeRate : 1));
        const booked = Math.round(Number(entry.totalAmountCents) || 0);
        if (booked === expected) return [];
        return [{ id: `payment-ledger-${p.id}`, checkId: 'payment-ledger', severity: 'high' as const,
          title: `Payment ${name}${who ? ` (${who})` : ''} is ${formatCurrency(expected)}, its entry ${formatCurrency(booked)}`,
          description: 'The payment record and its entry in the ledger say different amounts.',
          record: { type: 'transaction' as const, id: entry.id } }];
      });
    },
  },
  {
    id: 'missing-label',
    label: 'Entries missing a required label (Z-12)',
    remedy: 'Open the entry and fill in the label. The rules (which label on which accounts) are in Settings → Dimensions.',
    run: ({ transactions, accounts, dimensions }) => {
      // an entry that was corrected and its reversal cancel out: only the entry that replaced them counts
      const reversed = new Set(transactions.map(t => t.metadata?.reversesTxId || t.metadata?.reversedTransactionId).filter(Boolean));
      return transactions.flatMap(tx => {
      if (tx.reversalEventId || tx.metadata?.isReversal || tx.metadata?.reversesTxId || reversed.has(tx.id)) return [];
      const missing = missingLabels(tx, dimensions, accounts);
      if (missing.length === 0) return [];
      return [{
        id: `missing-label-${tx.id}`, checkId: 'missing-label', severity: 'low' as const,
        title: `${tx.description || 'Entry'} (${missing[0].date}): ${missing.map(m => `no ${m.dimensionName} on ${m.accountName}`).join('; ')}`,
        description: 'Reports by that label show this entry under "Unassigned" until it is filled in.',
        record: { type: 'transaction' as const, id: tx.id },
      }];
      });
    },
  },
  {
    id: 'label-role',
    label: 'Entries that do not meet a label\'s role (DIM-3)',
    remedy: 'Open the entry and give every line a value of the label; for a self-balancing label, each value\'s lines must add up to zero (split the line). The roles are in Settings → Dimensions.',
    run: ({ transactions, accounts, dimensions }) => {
      const byEntry = new Map<string, ReturnType<typeof labelRoleFindings>>();
      for (const p of labelRoleFindings(transactions, dimensions, accounts)) byEntry.set(p.transactionId, [...(byEntry.get(p.transactionId) || []), p]);
      return [...byEntry.values()].map(problems => {
        const first = problems[0];
        const unbalanced = problems.some(p => p.kind === 'unbalanced');
        return {
          id: `label-role-${first.transactionId}`, checkId: 'label-role', severity: unbalanced ? 'medium' as const : 'low' as const,
          title: `${first.description} (${first.date}): ${problems.map(p => (p.kind === 'unbalanced'
            ? `${p.dimensionName} ${p.value} is off by ${((p.cents || 0) / 100).toFixed(2)}`
            : `no ${p.dimensionName} on ${p.accountName}`)).join('; ')}`,
          description: unbalanced
            ? 'This label is self-balancing: its values\' balance sheets do not balance until each value\'s lines in this entry add up to zero.'
            : 'This label is fully attributed: reports by it show this line under "Unassigned" until it is filled in.',
          record: { type: 'transaction' as const, id: first.transactionId },
        };
      });
    },
  },
  {
    id: 'stock-history',
    label: 'Stock on hand that its history does not explain (W-02)',
    remedy: 'Open the item\'s Stock history on Inventory: the changes listed should end at the quantity on hand. Count the stock to set it right.',
    run: ({ inventory, stockMoves }) => {
      if (!stockMoves?.length) return [];
      const byItem = new Map<string, StockMove[]>();
      for (const m of stockMoves) byItem.set(m.itemId, [...(byItem.get(m.itemId) || []), m]);
      return (inventory || []).flatMap(item => {
        const problem = stockHistoryProblem(item, byItem.get(item.id) || []);
        return problem ? [{ id: `stock-history-${item.id}`, checkId: 'stock-history', severity: 'medium' as const, title: problem, description: 'The quantity changed without a recorded reason, or a change was recorded twice.', record: { type: 'item' as const, id: item.id } }] : [];
      });
    },
  },
  {
    id: 'filing-party-details',
    label: 'Customers and vendors missing tax IDs or addresses needed for filings (A-196)',
    remedy: 'Add the contact\'s tax/VAT ID and postal address on Sales or Purchases before preparing the return.',
    run: ({ customers, vendors, invoices, bills, payments, today, baseCurrency, workspaceCountry }) => {
      const taxYear = Number(today.slice(0, 4)) || 2026;
      return contactsMissingFilingDetails({
        customers,
        vendors,
        invoices,
        bills,
        payments: (payments || []) as Payment[],
        taxYear,
        homeCurrency: baseCurrency,
        workspaceCountry,
      }).map(row => ({
        id: `filing-party-details-${row.kind}-${row.contactId}`,
        checkId: 'filing-party-details',
        severity: 'low' as const,
        title: `${row.name}: missing ${row.missingFields.map(f => (f === 'taxId' ? 'tax ID' : 'address')).join(' and ')}`,
        description: `${row.filingReasons.join('; ')}. Tax ID status: ${row.maskedTaxId}.`,
        record: row.record,
      }));
    },
  },
  {
    id: 'item-missing-pricing',
    label: 'Items without cost or selling price (A-197)',
    remedy: 'Open the item on Inventory and fill in its unit cost and selling price so invoices and COGS post real amounts.',
    run: ({ inventory }) => {
      const fullItems = (inventory || []).filter(i => typeof i.unitCostCents === 'number' || typeof i.unitPriceCents === 'number');
      return itemsMissingPricing(fullItems).map(row => ({
        id: `item-missing-pricing-${row.itemId}`,
        checkId: 'item-missing-pricing',
        severity: 'low' as const,
        title: `${row.name}: missing ${row.missingFields.map(f => (f === 'cost' ? 'unit cost' : 'selling price')).join(' and ')}`,
        description: row.reason,
        record: row.record,
      }));
    },
  },
  // EG-7: stock against the books, stock below zero on a day, stale stock closings (src/lib/stockInvariants.ts)
  ...STOCK_INVARIANT_CHECKS,
  {
    id: 'settlement-ledger',
    label: 'Amount paid on invoices and bills that their payment-ledger rows do not add up to (EG-10)',
    remedy: 'Open the document and compare its payments with what it says is paid; record or void the payment that is missing or extra.',
    run: ({ invoices, bills, allocations, truncated }) => {
      if (!allocations) return [];
      // with rows missing, a document's rows add up to less than it paid: not a mismatch to report
      const cut = (truncated || []).filter(k => k === 'allocations');
      if (cut.length) return [incompleteFinding('settlement-ledger', cut)];
      // signed sum per document (an invoice and a bill may share an id): a reversal row is negative,
      // so originals + reversals = the live total
      const sums = new Map<string, number>();
      for (const r of allocations) {
        // a document's own `manual` / `deposit` row is the cash posted with it, counted below from the document
        if (!r.documentId || r.kind === 'manual' || r.kind === 'deposit') continue;
        const key = `${r.documentType}|${r.documentId}`;
        sums.set(key, (sums.get(key) || 0) + (Number(r.amountCents) || 0));
      }
      const findings: CheckFinding[] = [];
      const withoutRows: Record<'invoice' | 'bill', string[]> = { invoice: [], bill: [] };
      for (const { d, type } of openDocuments(invoices, bills)) {
        const paid = Math.round(paidCents(d));
        // what was paid with the document has no payment record and so no row: the rows cover the rest
        const withDocument = Math.round(cashPostedWithDocumentCents(d));
        const rowsOnly = sums.get(`${type}|${d.id}`);
        if (rowsOnly === undefined) { if (paid - withDocument !== 0) withoutRows[type].push(label(d)); continue; }
        const rows = withDocument + rowsOnly;
        if (rows === paid) continue;
        findings.push({
          id: `settlement-ledger-${type}-${d.id}`, checkId: 'settlement-ledger', severity: 'medium',
          title: `${type === 'invoice' ? 'Invoice' : 'Bill'} ${label(d)} says ${formatCurrency(paid, d.currency)} paid, its payment-ledger rows${withDocument ? ' and the part paid with it' : ''} add up to ${formatCurrency(rows, d.currency)}`,
          description: `Difference ${formatCurrency(paid - rows, d.currency)}.`,
          record: { type, id: d.id },
        });
      }
      for (const type of ['invoice', 'bill'] as const) {
        const docs = withoutRows[type];
        if (docs.length === 0) continue;
        findings.push({
          id: `settlement-ledger-no-rows-${type}`, checkId: 'settlement-ledger', severity: 'low',
          title: `${docs.length} open ${type}(s) with an amount paid have no ledger rows yet, migration may not be applied`,
          description: `Not counted as a mismatch: ${docs.slice(0, 5).join(', ')}${docs.length > 5 ? ', …' : ''}. Payments recorded before the payment ledger have no rows until the backfill runs.`,
        });
      }
      return findings;
    },
  },
  {
    id: 'control-balance',
    label: 'Receivable or payable account balance that differs from the open invoices or bills (EG-10)',
    remedy: 'Look for entries posted to the receivable or payable account by hand, or documents whose posting is missing (Month-end close → Postings).',
    run: ({ invoices, bills, accounts, transactions, allocations, baseCurrency, truncated }) => {
      // a balance over part of the entries or documents is not a difference to report
      const cut = (truncated || []).filter(k => k === 'transactions' || k === 'accounts' || k === 'invoices' || k === 'bills');
      const open = openDocuments(invoices, bills);
      return (['ar', 'ap'] as const).flatMap(role => {
        const controls = accounts.filter(a => resolveAccountRole(a) === role);
        if (controls.length === 0) return [];
        if (cut.length) return role === 'ar' ? [incompleteFinding('control-balance', cut)] : [];
        const control = new Set(controls.map(a => a.id));
        // the opening balances (debit-positive), then the entries
        let ledger = controls.reduce((s, a) => s + openingDebitCents(a), 0);
        for (const tx of transactions) if (isPostable(tx)) for (const l of tx.lines || []) if (control.has(l.accountId)) ledger += lineAmount(l, tx);
        if (role === 'ap') ledger = 0 - ledger; // payables carry a credit balance
        const type = role === 'ar' ? 'invoice' : 'bill';
        const docs = open.filter(o => o.type === type);
        // as posting books it: the original at the document's rate, less each settlement converted and rounded on
        // its own (a ledger row's baseClearedCents; without rows, the amount paid in one conversion), less the deposit
        const cleared = new Map<string, number>();
        for (const r of allocations || []) if (r.documentType === type && r.documentId && Number.isFinite(Number(r.baseClearedCents))) cleared.set(r.documentId, (cleared.get(r.documentId) || 0) + Number(r.baseClearedCents));
        const expected = docs.reduce((s, { d }) => {
          const rate = Number(d.exchangeRate) > 0 ? Number(d.exchangeRate) : 1;
          const home = (cents: number) => convertMinorUnits(cents, rate, d.currency || baseCurrency, baseCurrency);
          const paid = paidCents(d);
          if (calculateAmountDue({ ...d, amountPaidCents: paid }) === 0) return s;
          // the part paid with the document is posted by the document itself (invoicePosting/billPosting), converted
          // on its own; the payment records' part is the rows' cleared amounts, or what is left of the amount paid
          const withDocument = cashPostedWithDocumentCents(d);
          const records = cleared.has(d.id) && cleared.get(d.id) !== 0 ? cleared.get(d.id)! : home(Math.max(0, paid - withDocument));
          const settled = home(withDocument) + records;
          return s + home(Math.max(0, d.amountCents || 0)) - home(depositAppliedCents(d)) - settled;
        }, 0);
        if (ledger === expected) return [];
        const name = role === 'ar' ? 'Accounts receivable' : 'Accounts payable';
        return [{
          id: `control-balance-${role}`, checkId: 'control-balance', severity: 'medium' as const,
          title: `${name} is ${formatCurrency(ledger, baseCurrency)}, the open ${type}s add up to ${formatCurrency(expected, baseCurrency)}`,
          description: `Difference ${formatCurrency(ledger - expected, baseCurrency)} over ${docs.length} open ${type}(s) (home currency).`,
        }];
      });
    },
  },
];

/** Issued, not void or draft, invoices and bills (what the receivable and payable accounts hold), by the reports' rule. */
function openDocuments(invoices: Invoice[], bills: Bill[]) {
  return [
    ...invoices.filter(d => INVOICE_IS_ISSUED.has(d.status)).map(d => ({ d, type: 'invoice' as const })),
    ...bills.filter(d => BILL_IS_ISSUED.has(d.status)).map(d => ({ d, type: 'bill' as const })),
  ];
}

/** What a document has paid, as posting counts it: "Mark as paid" without an amount settles what the deposit left. */
function paidCents(d: Invoice | Bill): number {
  if (d.status !== 'paid' && d.status !== 'partially_paid') return d.amountPaidCents || 0;
  return cashPostedWithDocumentCents({ ...d, settledByRecordsCents: 0 });
}

/** The browser's cut collections, by name (DataHealthView); the store's any-collection flag is not used. */
export function truncatedInputs(truncatedCollections: Record<string, boolean> | undefined): string[] {
  return Object.keys(truncatedCollections || {}).filter(k => truncatedCollections?.[k]);
}

function incompleteFinding(checkId: string, cut: string[]): CheckFinding {
  return {
    id: `${checkId}-incomplete`, checkId, severity: 'low',
    title: 'Not checked: the data read is incomplete',
    description: `Only part of ${cut.join(', ')} was read (a limit was reached), so totals over it would show differences that are not there.`,
  };
}

const SUSPENSE = /suspense|uncategori[sz]ed|ask my accountant|clearing/i;

function shiftDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function runDataChecks(ctx: CheckContext, checks: DataCheck[] = DATA_CHECKS): CheckFinding[] {
  const order: Record<CheckSeverity, number> = { high: 0, medium: 1, low: 2 };
  return checks.flatMap(check => check.run(ctx)).sort((a, b) => order[a.severity] - order[b.severity]);
}
