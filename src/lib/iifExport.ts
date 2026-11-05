/**
 * E-53: workspace lists → a **QuickBooks Desktop IIF** file, for accountants who still need one
 * (Settings → Backup & Export). Lists only: accounts, customers, vendors, items.
 *
 * **No transaction sections (`!TRNS`/`!SPL`) are ever written.** An IIF that carries TRNS rows
 * posts money in QuickBooks the moment it is imported; this export is a list hand-off, not a
 * posting path, and the companion reader (E-29, src/lib/iifImport.ts) refuses the same sections
 * for the same reason. Balances and opening balances are not in the file either: only names,
 * types, addresses and item catalogue prices. Money is never computed here — an item's price
 * and cost are copied verbatim from the item.
 *
 * The file is the mirror of the reader, so it round-trips: every account-type code written here
 * is a code the reader accepts (`ACCOUNT_TYPES` in iifImport.ts), every column the writer emits
 * is one the reader maps, and the round-trip is a test (iif-export.test.ts).
 *
 * IIF is tab-separated with **no quoting** (QuickBooks Desktop does not quote), so tabs, line
 * breaks and control characters inside a name or note are flattened to spaces — that changes a
 * name, and the change is visible on the export screen rather than silently embedded.
 *
 * Names are de-duplicated per section (QuickBooks keys lists by name and would silently merge
 * the second record); an archived or nameless record is not written and is counted with the
 * reason instead of being dropped quietly.
 */
import type { ChartAccount, Customer, Vendor, InventoryItem } from '../types';

export interface IifExportLists {
  accounts?: readonly ChartAccount[];
  customers?: readonly Customer[];
  vendors?: readonly Vendor[];
  items?: readonly InventoryItem[];
}

export interface IifExportResult {
  /** The IIF file text, tab-separated, `\n` line endings, UTF-8. */
  text: string;
  counts: { accounts: number; customers: number; vendors: number; items: number };
  /** Records deliberately not written: archived, nameless, or a duplicate name in the same section. */
  skipped: Array<{ section: 'ACCNT' | 'CUST' | 'VEND' | 'ITEM'; name: string; reason: string }>;
}

/** Tabs, line breaks and control characters out of one cell (IIF has no quoting). */
const cell = (value: unknown): string => {
  const spaced = String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  // The remaining C0 controls and DEL go by code point instead of a control-character regex;
  // a for…of loop keeps astral characters whole, exactly as the old code-unit ranges did.
  let clean = '';
  for (const ch of spaced) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) clean += ch;
  }
  return clean.replace(/ +/g, ' ').trim();
};

/** Item catalogue money, exactly as stored: integer cents → a plain decimal figure. */
const money = (cents: unknown): string => {
  const value = Number(cents);
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
};

/**
 * The workspace account's QuickBooks Desktop type code. Every code here is in the reader's
 * ACCOUNT_TYPES table, so the export always imports back without a "type not recognised" row.
 * The rule order matters: a category or subtype that QuickBooks has a code for wins
 * (a bank that is an asset is BANK, not OCASSET); anything asset-like without its own code is
 * Other Current Asset, anything liability-like but not long-term debt is Other Current Liability.
 */
export function quickBooksAccountType(account: Pick<ChartAccount, 'type' | 'category' | 'subtype'>): string {
  const category = String(account.category || '').trim().toLowerCase();
  const subtype = String(account.subtype || '').trim().toLowerCase();
  if (subtype === 'bank' || category === 'cash') return 'BANK';
  if (category === 'receivables' || category === 'accounts receivable') return 'AR';
  if (category === 'payables' || category === 'accounts payable') return 'AP';
  if (subtype === 'credit_card' || subtype === 'credit card') return 'CCARD';
  if (account.type === 'asset') {
    if (category === 'fixed assets') return 'FIXASSET';
    return 'OCASSET';
  }
  if (account.type === 'liability') return category === 'debt' ? 'LTLIAB' : 'OCLIAB';
  if (account.type === 'equity') return 'EQUITY';
  if (account.type === 'cost_of_goods') return 'COGS';
  if (account.type === 'expense') return 'EXPENSE';
  return 'INCOME'; // 'income' or 'revenue'
}

/** The columns the writer emits, in the reader's own order (iifImport.ts maps these). */
const SECTION_HEADERS = {
  ACCNT: ['NAME', 'ACCNTTYPE', 'DESC', 'ACCNUM'],
  CUST: ['NAME', 'BADDR1', 'PHONE1', 'EMAIL', 'NOTE', 'TERMS'],
  VEND: ['NAME', 'BADDR1', 'PHONE1', 'EMAIL', 'VTYPE'],
  ITEM: ['NAME', 'INVITEMTYPE', 'DESC', 'SALESDESC', 'PRICE', 'COST', 'SKU'],
} as const;

export function buildIifExport(lists: IifExportLists): IifExportResult {
  // One !HDR line, exactly the shape QuickBooks Desktop writes (see the E-29 fixture
  // src/tests/fixtures/iif/lists.iif); no HDR data row, so the reader has nothing extra to report.
  const lines: string[] = [['!HDR', 'PROD', 'VER', 'REL', 'IIF', 'EDITION'].join('\t')];
  const skipped: IifExportResult['skipped'] = [];
  const counts: IifExportResult['counts'] = { accounts: 0, customers: 0, vendors: 0, items: 0 };

  const writeSection = (
    section: 'ACCNT' | 'CUST' | 'VEND' | 'ITEM',
    records: readonly string[][],
  ) => {
    lines.push(['!' + section, ...SECTION_HEADERS[section]].join('\t'));
    for (const record of records) lines.push([section, ...record].join('\t'));
  };

  const dedupe = <T>(records: readonly T[], name: (record: T) => string, section: 'ACCNT' | 'CUST' | 'VEND' | 'ITEM'): Array<{ record: T; name: string }> => {
    const seen = new Set<string>();
    const kept: Array<{ record: T; name: string }> = [];
    for (const record of records) {
      const cleaned = cell(name(record));
      if (!cleaned) {
        skipped.push({ section, name: '(no name)', reason: 'a record without a name cannot sit in a list QuickBooks keys by name.' });
        continue;
      }
      const key = cleaned.toLowerCase();
      if (seen.has(key)) {
        skipped.push({ section, name: cleaned, reason: `another record named "${cleaned}" is already in this file; QuickBooks would silently merge the second one, so only the first is written.` });
        continue;
      }
      seen.add(key);
      kept.push({ record, name: cleaned });
    }
    return kept;
  };

  const accounts = dedupe(
    (lists.accounts || []).filter(account => {
      if (account.archived || account.isArchived) {
        skipped.push({ section: 'ACCNT', name: String(account.name || '(no name)'), reason: 'archived accounts are not exported; restore it if the accountant needs it.' });
        return false;
      }
      return true;
    }),
    account => String(account.name ?? ''),
    'ACCNT',
  ).map(({ record: account, name }) => [
    name,
    quickBooksAccountType(account),
    cell(account.description),
    cell(account.code),
  ]);
  counts.accounts = accounts.length;

  const customers = dedupe(lists.customers || [], customer => String(customer.name ?? ''), 'CUST')
    .map(({ record: customer, name }) => [
      name,
      cell(customer.address),
      cell(customer.phone),
      cell(customer.email),
      cell(customer.notes),
      cell((customer as { paymentTerms?: string }).paymentTerms),
    ]);
  counts.customers = customers.length;

  const vendors = dedupe(lists.vendors || [], vendor => String(vendor.name ?? ''), 'VEND')
    .map(({ record: vendor, name }) => [
      name,
      cell(vendor.address),
      cell(vendor.phone),
      cell(vendor.email),
      cell(vendor.category || vendor.type),
    ]);
  counts.vendors = vendors.length;

  const items = dedupe(lists.items || [], item => String(item.name ?? ''), 'ITEM')
    .map(({ record: item, name }) => {
      const description = cell(item.description);
      return [
        name,
        item.itemType === 'service' ? 'SERV' : 'INVENTORY',
        description,
        description,
        money(item.unitPriceCents),
        money(item.unitCostCents),
        cell(item.sku),
      ];
    });
  counts.items = items.length;

  writeSection('ACCNT', accounts);
  writeSection('CUST', customers);
  writeSection('VEND', vendors);
  writeSection('ITEM', items);

  return { text: lines.join('\n') + '\n', counts, skipped };
}
