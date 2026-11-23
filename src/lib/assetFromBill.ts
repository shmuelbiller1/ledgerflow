/**
 * A fixed asset from a bill (X-01): bill lines posted to a fixed-asset account (an asset account
 * that is not cash, a receivable, stock, a prepayment or accumulated depreciation) that are not in
 * the asset register yet. Picking one fills the new asset's name, cost, purchase date and asset
 * account; the asset keeps which bill line it came from, so the line is not offered twice.
 */
import type { Bill, ChartAccount, FixedAsset } from '../types';
import { isCashAccount } from './txFilters';
import { allocateCents } from '../kernel/templates/TransactionTemplates';
import { minorUnitRate } from './currencyMinorUnits';
import { roundCents } from './cents';
import { calculateDocumentTax } from './documentMath';

export interface AssetCandidate {
  billId: string;
  line: number;
  label: string;
  name: string;
  costCents: number;
  date: string;
  accountId: string;
}

const NOT_FIXED = /receivable|inventory|stock|prepaid|prepayment|deposit|undeposited|accumulated|clearing|suspense/i;
const SKIPPED = new Set(['draft', 'void', 'rejected', 'cancelled']);

export function isFixedAssetAccount(account: ChartAccount | undefined): boolean {
  if (!account || String(account.type).toLowerCase() !== 'asset' || isCashAccount(account)) return false;
  return !NOT_FIXED.test(`${account.name} ${account.category || ''} ${account.subtype || ''}`);
}

/**
 * FA-02: the cost a fixed asset gets from a bill line is the net amount the bill posting actually
 * debits to the fixed-asset GL account, in the workspace's functional currency minor units — the
 * line's share of the bill's gross expense (total − recoverable tax, as `TransactionTemplates.
 * buildBillLines` posts it) converted at the bill's own rate. Copying the raw split `amountCents`
 * understated foreign-currency bills (EUR 10,000 @ 1.15 → $10,000 instead of $11,500) and capitalized
 * recoverable input tax on tax-inclusive bills ($1,100 instead of $1,000).
 */
function billLineCostCents(bill: Bill, line: { amountCents: number }, index: number, baseCurrency?: string): number {
  const splits = bill.splits || [];
  // the bill total (the splits' sum when the bill carries no top-level total) and its recoverable tax
  const totalCents = (bill.amountCents || 0) > 0 ? bill.amountCents : splits.reduce((sum, s) => sum + (s.amountCents || 0), 0);
  const taxCents = calculateDocumentTax(bill);
  // the same order as the bill posting (billPosting.ts + buildBillLines): the total and the tax are
  // converted to the books' minor units first, then the net is allocated across the lines — so the
  // assets made from one bill add up to exactly what the bill debited (two EUR 100.01 lines at 1.5
  // post USD 300.03 together, not 150.02 each)
  const rate = minorUnitRate(bill.exchangeRate || 1, String(bill.currency || baseCurrency || 'USD'), baseCurrency);
  const totalBase = roundCents(totalCents * rate);
  const taxBase = roundCents(taxCents * rate);
  return allocateCents(totalBase - taxBase, splits.map(s => s.amountCents))[index];
}

export function assetCandidates(bills: Bill[], accounts: ChartAccount[], assets: Array<Pick<FixedAsset, 'sourceBillId' | 'sourceBillLine'>>, baseCurrency?: string): AssetCandidate[] {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const taken = new Set(assets.filter(a => a.sourceBillId).map(a => `${a.sourceBillId}#${a.sourceBillLine ?? 0}`));
  const out: AssetCandidate[] = [];
  for (const bill of bills) {
    if (SKIPPED.has(String(bill.status)) || (bill as { deletedAt?: unknown }).deletedAt) continue;
    (bill.splits || []).forEach((line, i) => {
      if (!isFixedAssetAccount(byId.get(line.accountId)) || !(line.amountCents > 0) || taken.has(`${bill.id}#${i}`)) return;
      const date = String(bill.issueDate || bill.date || '').slice(0, 10);
      const name = (line.description || '').trim() || `${bill.vendorName || 'Bill'} ${bill.number || ''}`.trim();
      out.push({
        billId: bill.id, line: i, name, costCents: billLineCostCents(bill, line, i, baseCurrency), date, accountId: line.accountId,
        label: `${bill.number ? `Bill ${bill.number}` : 'Bill'}${bill.vendorName ? ` · ${bill.vendorName}` : ''} · ${name} · ${(line.amountCents / 100).toFixed(2)} · ${date}`,
      });
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
