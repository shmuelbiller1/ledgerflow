import { normalizeSearchText } from './textNormalization';
import { isEmailShape } from './textShape';
/**
 * Bulk import of records from a spreadsheet (K-01): customers, vendors, items and accounts.
 * One set of rules used by the import screen (preview with per-row problems) and by the server
 * (which checks every row again and saves all of them in one database transaction, or none).
 *
 * Flow: CSV rows → guessMapping (columns by header name) → applyMapping (field → raw text per
 * row) → prepareImport (checked, typed document fields per row, or the row's problems).
 */

export const IMPORT_KINDS = ['customers', 'vendors', 'items', 'accounts'] as const;
export type ImportKind = typeof IMPORT_KINDS[number];
export const MAX_IMPORT_ROWS = 2000;

type FieldType = 'text' | 'longText' | 'email' | 'money' | 'count' | 'status' | 'accountType' | 'code' | 'accountCode' | 'currency' | 'yesNo';

export interface ImportField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Header names that map to this field (compared without case, spaces or punctuation). */
  aliases: string[];
}

export interface ImportKindDefinition {
  id: ImportKind;
  label: string;
  /** Database collection the records go to. */
  collection: 'customers' | 'vendors' | 'inventory' | 'chartAccounts';
  fields: ImportField[];
}

// Spreadsheet data may use Hebrew headings; UI labels and enum choices stay English.
const HEBREW_HEADERS: Record<string, string[]> = {
  name: ['שם', 'שם לקוח', 'שם ספק', 'שם חברה', 'שם פריט', 'שם מוצר', 'שם חשבון'],
  email: ['דואל', 'דואר אלקטרוני', 'אימייל'], phone: ['טלפון', 'נייד'],
  taxId: ['מספר מס', 'חפ', 'עוסק מורשה'], address: ['כתובת'], website: ['אתר'],
  currency: ['מטבע'], paymentTerms: ['תנאי תשלום'], notes: ['הערות'], status: ['סטטוס'],
  category: ['קטגוריה'], sku: ['מקט', 'קוד פריט', 'ברקוד'], description: ['תיאור'],
  unitPriceCents: ['מחיר מכירה', 'מחיר יחידה', 'מחיר'], unitCostCents: ['עלות', 'מחיר קניה', 'מחיר רכישה'],
  quantityAtHand: ['כמות', 'כמות במלאי', 'מלאי'], reorderPoint: ['נקודת הזמנה', 'מלאי מינימום'],
  measurementUnit: ['יחידה', 'יחידת מידה'], code: ['קוד', 'קוד חשבון', 'מספר חשבון'],
  type: ['סוג', 'סוג חשבון'], subtype: ['תת סוג'],
};

const f = (key: string, label: string, type: FieldType, aliases: string[], required = false): ImportField =>
  ({ key, label, type, aliases: [key, label, ...aliases, ...(HEBREW_HEADERS[key] || [])], required });

const CONTACT_FIELDS = [
  f('email', 'Email', 'email', ['e-mail', 'email address', 'mail', 'emailaddress']),
  f('phone', 'Phone', 'text', ['telephone', 'tel', 'phone number', 'mobile', 'phonenumber', 'mobile number']),
  f('taxId', 'Tax ID', 'text', ['vat', 'vat number', 'tax number', 'ein', 'abn', 'gst number', 'business number', 'taxnumber']),
];

export const IMPORT_DEFINITIONS: Record<ImportKind, ImportKindDefinition> = {
  customers: {
    id: 'customers',
    label: 'Customers',
    collection: 'customers',
    fields: [
      f('name', 'Name', 'text', ['customer', 'customer name', 'company', 'company name', 'display name', 'client', 'client name', 'contact name', 'contactname'], true),
      ...CONTACT_FIELDS,
      f('address', 'Address', 'longText', ['billing address', 'street', 'street address']),
      f('website', 'Website', 'text', ['web', 'url', 'site']),
      f('currency', 'Currency', 'currency', ['currency code']),
      f('paymentTerms', 'Payment terms', 'text', ['terms']),
      f('notes', 'Notes', 'longText', ['note', 'memo', 'comments']),
      f('status', 'Status', 'status', ['active']),
    ],
  },
  vendors: {
    id: 'vendors',
    label: 'Vendors',
    collection: 'vendors',
    fields: [
      f('name', 'Name', 'text', ['vendor', 'vendor name', 'supplier', 'supplier name', 'company', 'company name', 'display name', 'payee', 'contact name', 'contactname'], true),
      ...CONTACT_FIELDS,
      f('address', 'Address', 'longText', ['billing address', 'street', 'street address', 'mailing address']),
      f('category', 'Category', 'text', ['vendor type', 'type']),
      f('is1099', '1099 vendor', 'yesNo', ['1099', 'track 1099', 'eligible for 1099']),
      f('status', 'Status', 'status', ['active']),
    ],
  },
  items: {
    id: 'items',
    label: 'Items',
    collection: 'inventory',
    fields: [
      f('name', 'Name', 'text', ['item', 'item name', 'product', 'product name', 'product/service', 'product service', 'title', 'itemname'], true),
      f('sku', 'SKU', 'code', ['item code', 'product code', 'code', 'part number', 'barcode', 'itemcode']),
      f('description', 'Description', 'longText', ['sales description', 'details']),
      f('unitPriceCents', 'Sale price', 'money', ['price', 'unit price', 'sales price', 'rate', 'selling price', 'sales unit price', 'salesunitprice']),
      f('unitCostCents', 'Cost', 'money', ['unit cost', 'purchase cost', 'purchase price', 'cost price', 'purchases unit price', 'purchasesunitprice']),
      f('quantityAtHand', 'Quantity on hand', 'count', ['quantity', 'qty', 'qty on hand', 'on hand', 'stock', 'in stock', 'quantityonhand']),
      f('reorderPoint', 'Reorder point', 'count', ['reorder level', 'min stock', 'minimum stock']),
      f('measurementUnit', 'Unit', 'text', ['uom', 'unit of measure', 'units']),
      f('category', 'Category', 'text', ['item category', 'group']),
    ],
  },
  accounts: {
    id: 'accounts',
    label: 'Accounts',
    collection: 'chartAccounts',
    fields: [
      f('name', 'Name', 'text', ['account', 'account name', 'full name'], true),
      f('code', 'Code', 'accountCode', ['account code', 'number', 'account number', 'acct', 'no']),
      f('type', 'Type', 'accountType', ['account type', 'class', 'classification'], true),
      f('category', 'Category', 'text', ['detail type', 'group']),
      f('subtype', 'Subtype', 'text', ['sub type', 'sub-type']),
      f('description', 'Description', 'longText', ['details', 'notes']),
      f('currency', 'Currency', 'currency', ['currency code']),
    ],
  },
};

// ----- reading values -----

const normalizeHeader = (h: string) => normalizeSearchText(h).replace(/[^\p{L}\p{M}\p{N}]/gu, '');

/** Money text → integer cents, or null when it isn't a number. "1,234.50", "$12", "(5.00)",
 *  "1.234,50" and "12,5" are read the usual way; "1,250" is one thousand two hundred fifty. */
export function parseMoneyCents(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,+-]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : (s.split(',').length === 2 ? s.replace(',', '.') : s);
  } else if (s.split('.').length > 2) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const fraction = (m[2] || '').padEnd(3, '0');
  let cents = Number(m[1]) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents) || cents > 1e13) return null;
  return negative ? -cents : cents;
}

type AccountTypeResult = { type: string; category?: string; subtype?: string };
const ACCOUNT_TYPE_RULES: Array<[RegExp, AccountTypeResult]> = [
  // CE-09 / BK-03: Wave's and Xero's own names, before the general words they contain
  [/expected payments from customers/, { type: 'asset', category: 'Accounts Receivable' }],
  [/expected payments to vendors/, { type: 'liability', category: 'Accounts Payable' }],
  [/customer prepayments|sales tax|due for payroll|due to you/, { type: 'liability' }],
  [/owner contribution|drawing|retained earnings/, { type: 'equity' }],
  [/gain on foreign exchange|^discount/, { type: 'revenue' }],
  [/loss on foreign exchange|processing fee|payroll expense|^depreciation$/, { type: 'expense' }],
  [/property, plant|equipment|depreciation and amortization/, { type: 'asset', category: 'Fixed Assets' }],
  [/money in transit|prepayment/, { type: 'asset' }],
  [/^(bank|cash|checking|savings)/, { type: 'asset', category: 'Cash', subtype: 'bank' }],
  [/accounts receivable|a\/r|^receivables?$/, { type: 'asset', category: 'Accounts Receivable' }],
  [/inventory|stock/, { type: 'asset', category: 'Inventory' }],
  [/fixed asset/, { type: 'asset', category: 'Fixed Assets' }],
  [/asset/, { type: 'asset' }],
  [/accounts payable|a\/p|^payables?$/, { type: 'liability', category: 'Accounts Payable' }],
  [/credit card/, { type: 'liability', subtype: 'credit_card' }],
  [/liabilit|loan/, { type: 'liability' }],
  [/equity|capital/, { type: 'equity' }],
  [/cost of (goods|sales)|cogs|direct cost/, { type: 'cost_of_goods' }],
  [/other income/, { type: 'revenue', category: 'Other Income' }],
  [/income|revenue|sales/, { type: 'revenue' }],
  [/other expense/, { type: 'expense', category: 'Other Expense' }],
  [/expense|overhead/, { type: 'expense' }],
];

/** "Bank", "Accounts receivable (A/R)", "Other Current Liability", "Cost of Goods Sold", … →
 *  the account type (and the category that makes resolveAccountRole find its role). */
export function parseAccountType(raw: string): AccountTypeResult | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  for (const [pattern, result] of ACCOUNT_TYPE_RULES) if (pattern.test(s)) return result;
  return null;
}

// ----- mapping columns -----

/** Field key → column position (-1 = not in the file). */
export type FieldMapping = Record<string, number>;
/** Field key → the cell text of one row. */
export type ImportRow = Record<string, string>;

export function guessMapping(kind: ImportKind, header: string[]): FieldMapping {
  const columns = header.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: FieldMapping = {};
  for (const field of IMPORT_DEFINITIONS[kind].fields) {
    const names = field.aliases.map(normalizeHeader);
    const index = columns.findIndex((c, i) => !used.has(i) && c !== '' && names.includes(c));
    mapping[field.key] = index;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

export function applyMapping(kind: ImportKind, dataRows: string[][], mapping: FieldMapping): ImportRow[] {
  const fields = IMPORT_DEFINITIONS[kind].fields;
  return dataRows.map(cells => {
    const row: ImportRow = {};
    for (const field of fields) {
      const index = mapping[field.key];
      if (index !== undefined && index >= 0 && index < cells.length) row[field.key] = cells[index] ?? '';
    }
    return row;
  });
}

// ----- checking rows -----

export interface ImportIssue {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  field?: string;
  message: string;
}

export type ImportValue = string | number | boolean;

export interface PreparedRecord {
  row: number;
  data: Record<string, ImportValue>;
  /** Identity used to find duplicates ("name:acme", "sku:a-1", "code:1000"). */
  keys: string[];
  label: string;
}

export interface PreparedImport {
  records: PreparedRecord[];
  errors: ImportIssue[];
}

/** Collapses spaces (keeping line breaks in long text) and drops control characters. */
const clean = (s: string, max: number, keepLines = false) =>
  Array.from(keepLines ? s.replace(/[^\S\n]+/g, ' ') : s.replace(/\s+/g, ' '))
    .filter(ch => ch === '\n' || (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127))
    .join('').trim().slice(0, max);

const identity = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Keys that make two records "the same" (a duplicate) for one kind. */
export function identityKeys(kind: ImportKind, data: Record<string, unknown>): string[] {
  const name = identity(String(data.name ?? ''));
  if (kind === 'items') return data.sku ? [`sku:${identity(String(data.sku))}`] : [`name:${name}`];
  if (kind === 'accounts') return [`name:${name}`, ...(data.code ? [`code:${identity(String(data.code))}`] : [])];
  return [`name:${name}`];
}

function readValue(field: ImportField, raw: string): { value?: ImportValue; error?: string; extra?: Record<string, string> } {
  const text = raw.trim();
  switch (field.type) {
    case 'text': return { value: clean(text, 200) };
    case 'longText': return { value: clean(text, 2000, true) };
    case 'email':
      // Validate the trimmed view, but preserve the imported email value. E-37 cleanup is an
      // explicit user choice; this shared reader must not lowercase/trim email behind the preview.
      return isEmailShape(text) && raw.length <= 200 ? { value: raw } : { error: `"${text}" is not an email address` };
    case 'money': {
      const cents = parseMoneyCents(text);
      if (cents === null) return { error: `"${text}" is not an amount` };
      if (cents < 0) return { error: 'must not be negative' };
      return { value: cents };
    }
    case 'count': {
      const s = text.replace(/,/g, '').replace(/\.0+$/, '');
      if (!/^\d{1,9}$/.test(s)) return { error: `"${text}" is not a whole number` };
      return { value: Number(s) };
    }
    case 'status': {
      const s = text.toLowerCase();
      if (['active', 'yes', 'true', '1', 'enabled'].includes(s)) return { value: 'active' };
      if (['inactive', 'no', 'false', '0', 'disabled', 'archived'].includes(s)) return { value: 'inactive' };
      return { error: `"${text}" should be active or inactive` };
    }
    case 'yesNo': {
      const s = text.toLowerCase();
      if (['yes', 'y', 'true', '1', 'x'].includes(s)) return { value: true };
      if (['no', 'n', 'false', '0'].includes(s)) return { value: false };
      return { error: `"${text}" should be yes or no` };
    }
    case 'code':
      return /^[A-Za-z0-9_.\-/]{1,40}$/.test(text) ? { value: text } : { error: `"${text}" may only use letters, digits and - _ . /` };
    case 'accountCode':
      return /^[A-Za-z0-9_.-]{1,20}$/.test(text) ? { value: text } : { error: `"${text}" may only use letters, digits and - _ .` };
    case 'currency':
      return /^[A-Za-z]{3}$/.test(text) ? { value: text.toUpperCase() } : { error: `"${text}" is not a 3-letter currency code` };
    case 'accountType': {
      const parsed = parseAccountType(text);
      if (!parsed) return { error: `"${text}" is not an account type (asset, liability, equity, income, expense, cost of goods sold, bank, …)` };
      const extra: Record<string, string> = {};
      if (parsed.category) extra.category = parsed.category;
      if (parsed.subtype) extra.subtype = parsed.subtype;
      return { value: parsed.type, extra };
    }
  }
}

const DEFAULTS: Record<ImportKind, Record<string, ImportValue>> = {
  customers: { status: 'active' },
  vendors: { status: 'active', category: 'Standard' },
  items: { sku: '', unitPriceCents: 0, unitCostCents: 0, quantityAtHand: 0, reorderPoint: 0 },
  accounts: {},
};

/**
 * Checks and converts every row. Rows with problems are listed in `errors` (all of them, so the
 * whole file can be fixed at once); two rows that are the same record are an error too.
 */
export function prepareImport(kind: ImportKind, rows: ImportRow[], firstRowNumber = 2): PreparedImport {
  const definition = IMPORT_DEFINITIONS[kind];
  const records: PreparedRecord[] = [];
  const errors: ImportIssue[] = [];
  const seen = new Map<string, number>();

  rows.forEach((raw, index) => {
    const row = firstRowNumber + index;
    const data: Record<string, ImportValue> = { ...DEFAULTS[kind] };
    const implied: Record<string, string> = {};
    let rowOk = true;
    for (const field of definition.fields) {
      const text = typeof raw[field.key] === 'string' ? raw[field.key] : '';
      if (!text.trim()) {
        if (field.required) {
          errors.push({ row, field: field.key, message: `${field.label} is missing` });
          rowOk = false;
        }
        continue;
      }
      const { value, error, extra } = readValue(field, text);
      if (error !== undefined) {
        errors.push({ row, field: field.key, message: `${field.label}: ${error}` });
        rowOk = false;
      } else if (field.required && (value === undefined || value === '')) {
        // PREV-6: a cell of only control characters is empty once cleaned
        errors.push({ row, field: field.key, message: `${field.label} is missing` });
        rowOk = false;
      } else if (value !== undefined && value !== '') {
        data[field.key] = value;
        Object.assign(implied, extra);
      }
    }
    // A category or subtype in its own column wins over the one implied by the account type.
    for (const [key, value] of Object.entries(implied)) if (data[key] === undefined) data[key] = value;
    if (!rowOk) return;

    const keys = identityKeys(kind, data);
    const firstRow = keys.map(k => seen.get(k)).find(r => r !== undefined);
    if (firstRow !== undefined) {
      errors.push({ row, message: `Same ${kind === 'items' && data.sku ? 'SKU' : kind === 'accounts' ? 'name or code' : 'name'} as row ${firstRow}` });
      return;
    }
    keys.forEach(k => seen.set(k, row));
    records.push({ row, data, keys, label: String(data.name) });
  });
  return { records, errors };
}

/** Opening stock value of imported items: quantity × cost, integer cents. */
export function openingStockCents(records: Pick<PreparedRecord, 'data'>[]): number {
  return records.reduce((sum, r) => sum + (Number(r.data.quantityAtHand) || 0) * (Number(r.data.unitCostCents) || 0), 0);
}
