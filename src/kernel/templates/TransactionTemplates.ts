import { TransactionLine } from '../../types';

export interface AccountRef {
  id: string;
  name: string;
}

/** A document line's account and its amount as entered (used only as a weight). */
export interface LineAccountWeight {
  account: AccountRef;
  weightCents: number;
  /** the line's labels (BF-09): posted on its share, so reports by label include it */
  dimensions?: Record<string, string>;
}

const labelKey = (dimensions?: Record<string, string>) =>
  dimensions && Object.keys(dimensions).length > 0 ? JSON.stringify(Object.entries(dimensions).sort(([a], [b]) => a.localeCompare(b))) : '';

/**
 * Splits an amount over weights so the parts add up exactly (largest remainder). Used to post
 * revenue / expense to the accounts chosen on the document's lines (L-115).
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const positive = weights.map(w => Math.max(0, w));
  const sum = positive.reduce((s, w) => s + w, 0);
  if (sum <= 0 || weights.length === 0) return weights.map((_, i) => (i === 0 ? totalCents : 0));
  const exact = positive.map(w => (totalCents * w) / sum);
  const parts = exact.map(x => Math.floor(x));
  let remainder = totalCents - parts.reduce((s, p) => s + p, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) parts[order[k].i] += 1;
  return parts;
}

/**
 * One posting line per account and labels: lines on the same account with the same labels are added
 * together; the same account with different labels (Property 5, Property 6) stays two lines (BF-09).
 */
function splitByAccount(totalCents: number, fallback: AccountRef, lineAccounts: LineAccountWeight[] | undefined): Array<{ account: AccountRef; amountCents: number; dimensions?: Record<string, string> }> {
  if (!lineAccounts || lineAccounts.length === 0) return [{ account: fallback, amountCents: totalCents }];
  const parts = allocateCents(totalCents, lineAccounts.map(l => l.weightCents));
  const byAccount = new Map<string, { account: AccountRef; amountCents: number; dimensions?: Record<string, string> }>();
  lineAccounts.forEach((l, i) => {
    const key = `${l.account.id}|${labelKey(l.dimensions)}`;
    const entry = byAccount.get(key) || { account: l.account, amountCents: 0, ...(labelKey(l.dimensions) ? { dimensions: { ...l.dimensions } } : {}) };
    entry.amountCents += parts[i];
    byAccount.set(key, entry);
  });
  return [...byAccount.values()].filter(e => e.amountCents !== 0);
}


/**
 * DIM-1: the other side of an entry (receivable/payable, tax, discount, retainage) carries the
 * document lines' labels too, in the same proportions as the lines, so every label's part of the
 * entry balances on its own. Lines that already have labels are left as they are; each split adds
 * up exactly to the line it replaces, so the entry still balances.
 */
export function spreadLabels(lines: TransactionLine[], lineAccounts: LineAccountWeight[] | undefined): TransactionLine[] {
  if (!lineAccounts || !lineAccounts.some(l => labelKey(l.dimensions))) return lines;
  const groups = new Map<string, { dimensions?: Record<string, string>; weight: number }>();
  for (const l of lineAccounts) {
    const key = labelKey(l.dimensions);
    const g = groups.get(key) || { ...(key ? { dimensions: { ...l.dimensions } } : {}), weight: 0 };
    g.weight += Math.max(0, l.weightCents);
    groups.set(key, g);
  }
  const list = [...groups.values()].filter(g => g.weight > 0);
  if (list.length === 0) return lines;
  // the document lines' own revenue/expense lines keep exactly the labels they were given
  const ownAccounts = new Set(lineAccounts.map(l => l.account.id));
  const isLabelled = (l: TransactionLine) => Object.keys((l as { dimensions?: Record<string, string> }).dimensions || {}).length > 0;
  const toSpread = lines.filter(l => !ownAccounts.has(l.accountId) && !isLabelled(l));
  if (toSpread.length === 0) return lines;
  // #152: the largest of those lines takes, per label, whatever makes that label's slice balance;
  // the others are split by weight. Each label then balances exactly, and every account's total is
  // unchanged (the entry balanced before, so the balancing parts add up to that line's amount).
  const balancer = toSpread.reduce((a, b) => (Math.abs(b.amountCents) > Math.abs(a.amountCents) ? b : a), toSpread[0]);
  const sliceSum = new Map<string, number>(list.map(g => [labelKey(g.dimensions), 0]));
  const out: TransactionLine[] = [];
  for (const line of lines) {
    if (line === balancer) continue;
    if (!toSpread.includes(line)) {
      out.push(line);
      const key = labelKey((line as { dimensions?: Record<string, string> }).dimensions);
      if (sliceSum.has(key)) sliceSum.set(key, sliceSum.get(key)! + line.amountCents);
      continue;
    }
    const parts = allocateCents(line.amountCents, list.map(g => g.weight));
    list.forEach((g, i) => {
      if (parts[i] === 0) return;
      sliceSum.set(labelKey(g.dimensions), sliceSum.get(labelKey(g.dimensions))! + parts[i]);
      out.push({ ...line, amountCents: parts[i], ...(g.dimensions ? { dimensions: { ...g.dimensions } } : {}) } as TransactionLine);
    });
  }
  const balancingParts = list.map(g => -(sliceSum.get(labelKey(g.dimensions)) || 0));
  if (balancingParts.reduce((a, b) => a + b, 0) !== balancer.amountCents) {
    // a line outside the label groups (e.g. labelled differently) — keep the plain proportional split
    allocateCents(balancer.amountCents, list.map(g => g.weight)).forEach((c, i) => { if (c) out.push({ ...balancer, amountCents: c, ...(list[i].dimensions ? { dimensions: { ...list[i].dimensions } } : {}) } as TransactionLine); });
    return out;
  }
  list.forEach((g, i) => {
    if (balancingParts[i] !== 0) out.push({ ...balancer, amountCents: balancingParts[i], ...(g.dimensions ? { dimensions: { ...g.dimensions } } : {}) } as TransactionLine);
  });
  return out;
}

export interface InvoiceTemplateParams {
  invoiceNumber: string;
  customerName: string;
  totalCents: number;
  taxCents?: number;
  discountCents?: number;
  retainageCents?: number;
  exchangeRate?: number;
  arAccount: AccountRef;
  revenueAccount: AccountRef;
  /** The income account of each invoice line; revenue is posted to them in proportion. */
  lineAccounts?: LineAccountWeight[];
  taxAccount?: AccountRef | null;
  /** EG-12: the tax the document used (its code, treatment and parts), kept on the tax line */
  taxStamp?: Partial<TransactionLine>;
  discountAccount?: AccountRef | null;
  retainageAccount?: AccountRef | null;
}

export interface BillTemplateParams {
  billNumber: string;
  vendorName: string;
  totalCents: number;
  taxCents?: number;
  discountCents?: number;
  retainageCents?: number;
  exchangeRate?: number;
  apAccount: AccountRef;
  expenseAccount: AccountRef;
  /** The expense account of each bill line; the cost is posted to them in proportion. */
  lineAccounts?: LineAccountWeight[];
  taxAccount?: AccountRef | null;
  /** EG-12: the tax the document used (its code, treatment and parts), kept on the tax line */
  taxStamp?: Partial<TransactionLine>;
  discountAccount?: AccountRef | null;
  retainageAccount?: AccountRef | null;
}

export interface PaymentTemplateParams {
  documentNumber: string;
  entityName: string;
  amountCents: number;
  exchangeRate?: number;
  cashAccount: AccountRef;
  offsetAccount: AccountRef;
  isReceipt: boolean; // true = customer payment (DR Cash, CR A/R), false = vendor payment (DR A/P, CR Cash)
  /** DIM-1: the paid document's lines, so the payment carries their labels in the same proportions */
  lineAccounts?: LineAccountWeight[];
}

export class TransactionTemplates {
  /**
   * Generates balanced double-entry lines for an Invoice.
   * Debits: A/R (net of retainage), Retainage Receivable, Sales Discounts.
   * Credits: Sales Revenue, Sales Tax Payable.
   */
  public static buildInvoiceLines(params: InvoiceTemplateParams): TransactionLine[] {
    const rate = params.exchangeRate || 1;
    const taxCents = params.taxCents || 0;
    const discountCents = params.discountCents || 0;
    const retainageCents = params.retainageCents || 0;
    const netArCents = params.totalCents - retainageCents;
    const grossRevenueCents = params.totalCents + discountCents - taxCents;

    const lines: TransactionLine[] = [
      {
        accountId: params.arAccount.id,
        accountName: params.arAccount.name,
        amountCents: netArCents, // Debit A/R
        description: `Accounts Receivable posting for Invoice ${params.invoiceNumber}`,
        exchangeRate: rate
      }
    ];

    if (retainageCents > 0 && params.retainageAccount) {
      lines.push({
        accountId: params.retainageAccount.id,
        accountName: params.retainageAccount.name,
        amountCents: retainageCents, // Debit Retainage Receivable
        description: `Retainage withheld on Invoice ${params.invoiceNumber}`,
        exchangeRate: rate
      });
    }

    if (discountCents > 0 && params.discountAccount) {
      lines.push({
        accountId: params.discountAccount.id,
        accountName: params.discountAccount.name,
        amountCents: discountCents, // Debit Sales Discounts
        description: `Sales discount applied on Invoice ${params.invoiceNumber}`,
        exchangeRate: rate
      });
    }

    for (const part of splitByAccount(grossRevenueCents, params.revenueAccount, params.lineAccounts)) {
      lines.push({
        accountId: part.account.id,
        accountName: part.account.name,
        amountCents: -part.amountCents, // Credit Sales Revenue
        description: `Sales Revenue for Invoice ${params.invoiceNumber} (${params.customerName})`,
        exchangeRate: rate,
        ...(part.dimensions ? { dimensions: part.dimensions } : {})
      });
    }

    if (taxCents > 0 && params.taxAccount) {
      lines.push({
        accountId: params.taxAccount.id,
        accountName: params.taxAccount.name,
        amountCents: -taxCents, // Credit Tax Payable
        description: `Sales tax collected on Invoice ${params.invoiceNumber}`,
        exchangeRate: rate,
        ...params.taxStamp
      });
    }

    return spreadLabels(lines, params.lineAccounts);
  }

  /**
   * Generates balanced double-entry lines for a Bill.
   * Debits: Expense/COGS, Input Tax Asset.
   * Credits: A/P (net of retainage), Retainage Payable, Purchase Discounts.
   */
  public static buildBillLines(params: BillTemplateParams): TransactionLine[] {
    const rate = params.exchangeRate || 1;
    const taxCents = params.taxCents || 0;
    const discountCents = params.discountCents || 0;
    const retainageCents = params.retainageCents || 0;
    const netApCents = params.totalCents - retainageCents;
    const grossExpenseCents = params.totalCents + discountCents - taxCents;

    const lines: TransactionLine[] = splitByAccount(grossExpenseCents, params.expenseAccount, params.lineAccounts).map(part => ({
      accountId: part.account.id,
      accountName: part.account.name,
      amountCents: part.amountCents, // Debit Expense/COGS
      description: `Expense posting for Bill ${params.billNumber} (${params.vendorName})`,
      exchangeRate: rate,
      ...(part.dimensions ? { dimensions: part.dimensions } : {})
    }));

    if (taxCents > 0 && params.taxAccount) {
      lines.push({
        accountId: params.taxAccount.id,
        accountName: params.taxAccount.name,
        amountCents: taxCents, // Debit Tax Asset / Recoverable Tax
        description: `Input tax recoverable on Bill ${params.billNumber}`,
        exchangeRate: rate,
        ...params.taxStamp
      });
    }

    lines.push({
      accountId: params.apAccount.id,
      accountName: params.apAccount.name,
      amountCents: -netApCents, // Credit A/P
      description: `Accounts Payable posting for Bill ${params.billNumber}`,
      exchangeRate: rate
    });

    if (retainageCents > 0 && params.retainageAccount) {
      lines.push({
        accountId: params.retainageAccount.id,
        accountName: params.retainageAccount.name,
        amountCents: -retainageCents, // Credit Retainage Payable
        description: `Retainage withheld on Bill ${params.billNumber}`,
        exchangeRate: rate
      });
    }

    if (discountCents > 0 && params.discountAccount) {
      lines.push({
        accountId: params.discountAccount.id,
        accountName: params.discountAccount.name,
        amountCents: -discountCents, // Credit Purchase Discounts
        description: `Purchase discount earned on Bill ${params.billNumber}`,
        exchangeRate: rate
      });
    }

    return spreadLabels(lines, params.lineAccounts);
  }

  /**
   * Generates exact reversal lines for a prior transaction.
   */
  public static buildReversalLines(originalLines: TransactionLine[], txDescription: string): TransactionLine[] {
    return (originalLines || []).map((l) => ({
      ...l,
      amountCents: -l.amountCents,
      description: `Reversal: ${l.description || txDescription}`
    }));
  }

  /**
   * Generates balanced double-entry lines for a Payment (Receipt or Outflow).
   */
  public static buildPaymentLines(params: PaymentTemplateParams): TransactionLine[] {
    const rate = params.exchangeRate || 1;
    const amount = params.amountCents;

    if (params.isReceipt) {
      // DR Cash, CR offset (e.g. A/R)
      return spreadLabels([
        {
          accountId: params.cashAccount.id,
          accountName: params.cashAccount.name,
          amountCents: amount, // Debit
          description: `Cash collection for Invoice ${params.documentNumber}`,
          exchangeRate: rate
        },
        {
          accountId: params.offsetAccount.id,
          accountName: params.offsetAccount.name,
          amountCents: -amount, // Credit
          description: `A/R clearance for Invoice ${params.documentNumber}`,
          exchangeRate: rate
        }
      ], params.lineAccounts);
    } else {
      // DR offset (e.g. A/P), CR Cash
      return spreadLabels([
        {
          accountId: params.offsetAccount.id,
          accountName: params.offsetAccount.name,
          amountCents: amount, // Debit
          description: `Accounts Payable clearance for Bill ${params.documentNumber}`,
          exchangeRate: rate
        },
        {
          accountId: params.cashAccount.id,
          accountName: params.cashAccount.name,
          amountCents: -amount, // Credit
          description: `Cash payment for Bill ${params.documentNumber}`,
          exchangeRate: rate
        }
      ], params.lineAccounts);
    }
  }
}
