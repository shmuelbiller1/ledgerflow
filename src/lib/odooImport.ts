/**
 * EU-A4b: Odoo list exports (Favorites → Export, "Export all data") → the app's own import columns.
 *
 * Odoo writes the field labels of the model it exports. With "I want to update data
 * (import-compatible export)" ticked it writes the technical selection values instead, so both are
 * read. The labels and values used here are Odoo 16–18's own:
 * - Chart of Accounts (`account.account`): `Code`, `Account Name`, `Type` (`account_type`),
 *   `Allow Reconciliation`, `Deprecated`. Types: Receivable `asset_receivable`, Bank and Cash
 *   `asset_cash`, Current Assets `asset_current`, Non-current Assets `asset_non_current`,
 *   Prepayments `asset_prepayments`, Fixed Assets `asset_fixed`, Payable `liability_payable`,
 *   Credit Card `liability_credit_card`, Current Liabilities `liability_current`, Non-current
 *   Liabilities `liability_non_current`, Equity `equity`, Current Year Earnings
 *   `equity_unaffected`, Income `income`, Other Income `income_other`, Expenses `expense`,
 *   Depreciation `expense_depreciation`, Cost of Revenue `expense_direct_cost`, Off-Balance Sheet
 *   `off_balance`.
 * - Contacts (`res.partner`): `Name` / `Display Name`, `Email`, `Phone`, `Mobile`, `Street`,
 *   `Street2`, `City`, `State`, `Zip`, `Country`, `Website`, `Tax ID`, `Active`.
 * - Products (`product.template`): `Name`, `Internal Reference`, `Barcode`, `Sales Price`, `Cost`,
 *   `Product Category`, `Unit of Measure`, `Sales Description`.
 *
 * Honesty rules, as for the other importers: a type is translated only through the table above;
 * Off-Balance Sheet (no counterpart here) and Current Year Earnings (computed by the books, never a
 * stored account) are left blank so the preview lists them for the person to fix. Balances and
 * quantities on hand are never read: a list import carries no figures. Nothing here posts or writes.
 */
import type { ImportKind } from './recordImport';
import { columnText, joinedAddress } from './providerListCsv';

const ACCOUNTS_HEADER = ['Name', 'Code', 'Type', 'Category', 'Subtype', 'Description', 'Currency', 'Status'];
const CONTACTS_HEADER = ['Name', 'Email', 'Phone', 'Address', 'Website', 'Tax ID', 'Status'];
const ITEMS_HEADER = ['Name', 'SKU', 'Description', 'Sale price', 'Cost', 'Quantity on hand', 'Reorder point', 'Unit', 'Category'];

/** Odoo's account types (label or technical value) → words the shared `parseAccountType` reads. */
const ODOO_ACCOUNT_TYPES: Record<string, string> = {
  receivable: 'Accounts Receivable', asset_receivable: 'Accounts Receivable',
  'bank and cash': 'Cash', asset_cash: 'Cash',
  'current assets': 'Other Current Assets', asset_current: 'Other Current Assets',
  'non-current assets': 'Other Assets', asset_non_current: 'Other Assets',
  prepayments: 'Prepayment', asset_prepayments: 'Prepayment',
  'fixed assets': 'Fixed Assets', asset_fixed: 'Fixed Assets',
  payable: 'Accounts Payable', liability_payable: 'Accounts Payable',
  'credit card': 'Credit Card', liability_credit_card: 'Credit Card',
  'current liabilities': 'Other Current Liabilities', liability_current: 'Other Current Liabilities',
  'non-current liabilities': 'Long Term Liabilities', liability_non_current: 'Long Term Liabilities',
  equity: 'Equity',
  income: 'Income',
  'other income': 'Other Income', income_other: 'Other Income',
  expenses: 'Expenses', expense: 'Expenses',
  depreciation: 'Depreciation', expense_depreciation: 'Depreciation',
  'cost of revenue': 'Cost of Sales', expense_direct_cost: 'Cost of Sales',
  // Off-Balance Sheet / off_balance and Current Year Earnings / equity_unaffected: no stored
  // counterpart here, so they stay blank and the preview lists the row to fix
};

const yes = (raw: string) => ['true', 'yes', '1'].includes(raw.trim().toLowerCase());
const no = (raw: string) => ['false', 'no', '0'].includes(raw.trim().toLowerCase());

/** Pure normalisation; validation, duplicates, permissions and the write stay where they are. */
export function normalizeOdooCsv(kind: ImportKind, table: readonly (readonly string[])[]): string[][] {
  if (!table.length) return [];
  const [header, ...rows] = table;

  if (kind === 'accounts') {
    return [ACCOUNTS_HEADER, ...rows.map(row => {
      const code = columnText(header, row, 'Code');
      const typeRaw = columnText(header, row, 'Type', 'account_type');
      const deprecated = columnText(header, row, 'Deprecated');
      return [
        columnText(header, row, 'Account Name', 'Name') || code,
        code,
        typeRaw ? (ODOO_ACCOUNT_TYPES[typeRaw.toLowerCase()] ?? '') : '',
        '', '', '',
        columnText(header, row, 'Account Currency', 'Currency'),
        yes(deprecated) ? 'inactive' : no(deprecated) ? 'active' : '',
      ];
    })];
  }

  if (kind === 'customers' || kind === 'vendors') {
    return [CONTACTS_HEADER, ...rows.map(row => {
      const active = columnText(header, row, 'Active');
      return [
        columnText(header, row, 'Name', 'Display Name', 'Company Name'),
        columnText(header, row, 'Email'),
        columnText(header, row, 'Phone', 'Mobile'),
        joinedAddress(
          columnText(header, row, 'Street'), columnText(header, row, 'Street2'), columnText(header, row, 'City'),
          columnText(header, row, 'State'), columnText(header, row, 'Zip'), columnText(header, row, 'Country'),
        ),
        columnText(header, row, 'Website'),
        columnText(header, row, 'Tax ID'),
        no(active) ? 'inactive' : yes(active) ? 'active' : '',
      ];
    })];
  }

  return [ITEMS_HEADER, ...rows.map(row => {
    const ref = columnText(header, row, 'Internal Reference');
    return [
      columnText(header, row, 'Name') || ref,
      ref || columnText(header, row, 'Barcode'),
      columnText(header, row, 'Sales Description', 'Description for Customers'),
      columnText(header, row, 'Sales Price'),
      columnText(header, row, 'Cost'),
      '', // never stage opening stock from a catalogue export
      '',
      columnText(header, row, 'Unit of Measure'),
      columnText(header, row, 'Product Category'),
    ];
  })];
}
