#!/usr/bin/env node
// Generators, so boilerplate never has to be written by hand (or by an AI):
//   npm run scaffold:plugin -- MyCustomView
//   npm run scaffold:algo -- my-new-math
//   npm run scaffold:report -- SalesByRegion
// LF_SCAFFOLD_ROOT points the output at another folder (used by the tests).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.LF_SCAFFOLD_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [type, name] = process.argv.slice(2);

function write(relPath, content) {
  const full = path.join(root, relPath);
  if (fs.existsSync(full)) {
    console.error(`✖ ${relPath} already exists; nothing was changed.`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`✅ ${relPath}`);
}

function usage() {
  console.log('Usage: node scripts/scaffold.js <plugin|algo|report> <Name>');
  console.log('  plugin MyCustomView   → src/plugins/MyCustomView.tsx');
  console.log('  algo my-new-math      → src/lib/algorithms/my-new-math.ts');
  console.log('  report SalesByRegion  → report math + screen + test, and the 2 registry lines to add');
  process.exit(1);
}

if (!type || !name) usage();

if (type === 'plugin') {
  write(`src/plugins/${name}.tsx`, `import React from 'react';

export default function ${name}() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">${name} Plugin</h1>
      <p className="mt-4 text-[var(--muted)]">This view was auto-generated. Edit src/plugins/${name}.tsx to customize.</p>
    </div>
  );
}
`);
  console.log('It will be discovered by the plugin engine and added to the sidebar.');
} else if (type === 'algo') {
  const algoId = Date.now().toString().slice(-4);
  write(`src/lib/algorithms/${name}.ts`, `import { AlgorithmDefinition, buildHelper } from './types';

export const ${name.replace(/-([a-z])/g, (g) => g[1].toUpperCase())}: AlgorithmDefinition = {
  id: 'algo_${algoId}',
  name: '${name.replace(/-/g, ' ')}',
  description: 'Auto-generated algorithm module.',
  inputs: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 100, step: 1, defaultValue: 50 }
  ],
  compute: buildHelper((txs, accounts, inputs) => {
    return {
      metrics: [ { label: 'Result', value: inputs.threshold } ],
      charts: [],
      insights: ['Calculated successfully']
    };
  })
};
`);
  console.log('To use it, import it in src/lib/algorithms/index.ts and add it to FINANCIAL_ALGORITHMS.');
} else if (type === 'report') {
  if (!/^[A-Z][A-Za-z0-9]{2,59}$/.test(name)) {
    console.error('✖ Report names are PascalCase, e.g. SalesByRegion.');
    process.exit(1);
  }
  const camel = name[0].toLowerCase() + name.slice(1);
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const title = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  write(`src/server/reports/${camel}Report.ts`, `import type { ChartAccount, Transaction } from '../../types';
import { isPostable, isTransactionInDateRange, lineAmount } from '../../lib/txFilters';

export interface ${name}Row {
  accountId: string;
  accountName: string;
  amountCents: number;
}

export interface ${name}Report {
  rows: ${name}Row[];
  totalCents: number;
}

/**
 * ${title}: posted amounts per account in the period (a starting point — change the grouping
 * and the measures). Money rules: isPostable() filters, lineAmount() gives base-currency cents.
 */
export function compute${name}(transactions: Transaction[], accounts: ChartAccount[], startDate?: string, endDate?: string): ${name}Report {
  const names = new Map(accounts.map(a => [a.id, a.name]));
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    if (!isPostable(tx) || ((startDate || endDate) && !isTransactionInDateRange(tx, startDate, endDate))) continue;
    for (const line of tx.lines || []) {
      totals.set(line.accountId, (totals.get(line.accountId) || 0) + lineAmount(line, tx));
    }
  }
  const rows = Array.from(totals, ([accountId, amountCents]) => ({ accountId, accountName: names.get(accountId) || accountId, amountCents }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
  return { rows, totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0) };
}
`);

  write(`src/components/reporting/${name}View.tsx`, `import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency } from '../../lib/utils';
import { compute${name} } from '../../server/reports/${camel}Report';

interface Props {
  /** The Reports page passes the chosen period. */
  startDate?: string;
  endDate?: string;
}

export default function ${name}View({ startDate, endDate }: Props) {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const report = useMemo(() => compute${name}(transactions || [], accounts || [], startDate, endDate), [transactions, accounts, startDate, endDate]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto p-4 sm:p-6 text-[var(--text)]">
      <h2 className="text-lg font-bold">${title}</h2>
      <p className="text-xs text-[var(--muted)]">{startDate} to {endDate}</p>
      {report.rows.length === 0 ? (
        <div className="text-center py-12 bg-[var(--panel)] rounded-lg border border-[var(--line)] text-[var(--muted)] text-xs">Nothing posted in this period.</div>
      ) : (
        <table className="w-full text-left text-xs bg-[var(--panel)] border border-[var(--line)] rounded-lg">
          <caption className="sr-only">${title}</caption>
          <thead className="bg-[var(--surface)] text-[var(--muted)] uppercase">
            <tr><th scope="col" className="py-2 px-4">Account</th><th scope="col" className="py-2 px-4 text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {report.rows.map(r => (
              <tr key={r.accountId}><td className="py-2 px-4">{r.accountName}</td><td className="py-2 px-4 text-right font-mono">{formatCurrency(r.amountCents)}</td></tr>
            ))}
          </tbody>
          <tfoot className="font-bold border-t border-[var(--line)]">
            <tr><th scope="row" className="py-2 px-4 text-left">Total</th><td className="py-2 px-4 text-right font-mono">{formatCurrency(report.totalCents)}</td></tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
`);

  write(`src/tests/${kebab}-report.test.ts`, `import test from 'node:test';
import assert from 'node:assert/strict';
import { compute${name} } from '../server/reports/${camel}Report';
import { makeChartAccount, makeTransaction } from './fixtures';

test('${title}: posted amounts per account, drafts and other periods left out', () => {
  const accounts = [makeChartAccount({ id: 'cash', name: 'Cash' }), makeChartAccount({ id: 'sales', name: 'Sales', type: 'revenue', category: 'Revenue' })];
  const sale = (id: string, date: string, cents: number, status: 'completed' | 'draft' = 'completed') => makeTransaction({
    id, date, status, lines: [{ accountId: 'cash', amountCents: cents }, { accountId: 'sales', amountCents: -cents }],
  });
  const report = compute${name}([sale('a', '2026-03-05', 1000), sale('b', '2026-03-20', 500, 'draft'), sale('c', '2026-04-01', 700)], accounts, '2026-03-01', '2026-03-31');
  assert.deepEqual(report.rows.map(r => [r.accountName, r.amountCents]), [['Cash', 1000], ['Sales', -1000]]);
  assert.equal(report.totalCents, 0);
});
`);

  console.log('\nAdd these 2 lines to src/config/registry.tsx, then add the report ID to REPORT_TAB_IDS in src/config/routeIds.ts:');
  console.log(`  REPORT_COMPONENTS:     '${name}View': lazy(() => import('../components/reporting/${name}View')),`);
  console.log(`  REPORT_TABS_REGISTRY:  { id: '${kebab}', label: { en: '${title}', he: '${title}' }, componentName: '${name}View', icon: FileText },`);
  console.log(`  REPORT_TAB_IDS:        append '${kebab}' in src/config/routeIds.ts`);
} else {
  usage();
}
