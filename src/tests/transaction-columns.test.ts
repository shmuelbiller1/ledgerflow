/** Transaction list columns (I-13): one width per cell; switched-off columns leave the layout. */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gridMinWidth, gridTemplate, readHiddenColumns } from '../lib/transactionColumns';

const count = (template: string) => template.split(' ').length;
const none = new Set<string>();

describe('Transaction list columns', () => {
  test('one width per cell the rows draw: 11 on desktop, 6 on a tablet, 4 on a phone', () => {
    assert.equal(count(gridTemplate({ mobile: false, tablet: false, compact: false }, none)), 11);
    assert.equal(count(gridTemplate({ mobile: false, tablet: false, compact: true }, none)), 11);
    assert.equal(count(gridTemplate({ mobile: false, tablet: true, compact: false }, none)), 6);
    assert.equal(count(gridTemplate({ mobile: true, tablet: false, compact: false }, none)), 4);
  });

  test('the row draws 11 cells on desktop (keep this in step with the template)', () => {
    const row = fs.readFileSync('src/components/transactions/TransactionRow.tsx', 'utf8');
    const optional = row.match(/show\('(\w+)'\)/g) || [];
    assert.deepEqual([...new Set(optional)].sort(), ["show('balance')", "show('category')", "show('class')", "show('location')", "show('project')", "show('status')"]);
  });

  test('a switched-off column leaves the template on desktop and tablet, not on a phone', () => {
    const hidden = new Set(['project', 'status']);
    assert.equal(count(gridTemplate({ mobile: false, tablet: false, compact: false }, hidden)), 9);
    assert.equal(count(gridTemplate({ mobile: false, tablet: true, compact: false }, hidden)), 5);
    assert.equal(count(gridTemplate({ mobile: true, tablet: false, compact: false }, hidden)), 4);
  });

  test('the table is never narrower than its columns plus room for the description', () => {
    assert.equal(gridMinWidth('40px 100px 1fr 100px'), 480);
    assert.equal(gridMinWidth(gridTemplate({ mobile: false, tablet: false, compact: false }, none)), 1056);
    // fits beside the 240 px sidebar on a 1440 px screen (it was 1330 px and ran off the right edge)
    assert.ok(gridMinWidth(gridTemplate({ mobile: false, tablet: false, compact: false }, none)) <= 1440 - 240 - 48);
  });

  test('stored choices: unknown names and broken storage are ignored', () => {
    const store = new Map<string, string>([['k', JSON.stringify(['project', 'nonsense', 3])], ['bad', '{']]);
    (globalThis as unknown as { localStorage: Pick<Storage, 'getItem'> }).localStorage = { getItem: (k: string) => store.get(k) ?? null };
    assert.deepEqual([...readHiddenColumns('k')], ['project']);
    assert.deepEqual([...readHiddenColumns('bad')], []);
    assert.deepEqual([...readHiddenColumns('missing')], []);
  });
});

describe('Empty label columns', () => {
  test('project, class and location nobody uses are narrow, not gone; a typed width wins', async () => {
    const { emptyLabelColumns } = await import('../lib/transactionColumns');
    const empty = emptyLabelColumns([{ lines: [{ project: 'P1' }, {}] }, { lines: [{}] }]);
    assert.deepEqual([...empty].sort(), ['class', 'location']);
    const layout = { mobile: false, tablet: false, compact: false };
    const t = gridTemplate(layout, none, undefined, empty);
    assert.equal(count(t), 11);
    assert.equal(t.split(' ').filter(w => w === 'minmax(64px,0.15fr)').length, 2);
    assert.ok(gridMinWidth(t) < gridMinWidth(gridTemplate(layout, none)));
  });
});

describe('Running balance', () => {
  test('income adds, expenses subtract (it used to add both)', async () => {
    const { runningBalances } = await import('../lib/txFilters');
    const { makeChartAccount, makeTransaction } = await import('./fixtures');
    const accounts = new Map([
      ['bank', makeChartAccount({ id: 'bank', name: 'Bank', type: 'asset' })],
      ['sales', makeChartAccount({ id: 'sales', name: 'Sales', type: 'revenue' })],
      ['host', makeChartAccount({ id: 'host', name: 'Hosting', type: 'expense' })],
    ]);
    const sale = makeTransaction({ id: 's', date: '2026-09-01', status: 'completed', lines: [{ accountId: 'bank', amountCents: 1_500_000 }, { accountId: 'sales', amountCents: -1_500_000 }] });
    const bill = makeTransaction({ id: 'h', date: '2026-09-05', status: 'completed', lines: [{ accountId: 'host', amountCents: 1_200_000 }, { accountId: 'bank', amountCents: -1_200_000 }] });
    const out = runningBalances([sale, bill], accounts);
    assert.equal(out.get('s'), 1_500_000);
    assert.equal(out.get('h'), 300_000);
  });
});
