/**
 * The sweep this PR started, pinned as rules rather than as a description.
 *
 * `codemod-row-table.ts` moves a hand-written table onto `RowTable`. A codemod is dangerous precisely because it
 * is fast, and the two ways it could destroy a screen are both silent:
 *
 *  - it drops a part of the table a column list cannot express — a totals row in a `<tfoot>`, a row that changes
 *    class with its data, a cell that reads the row in its class;
 *  - it turns code into text — an interpolated class `${th}` becoming the literal string `${th}`, which type-checks
 *    and renders wrong.
 *
 * So each of those is a case here: the table that must be refused is refused *with a reason*, and the table that
 * may convert keeps its classes as expressions. The last test is the agreement between this sweep and the counter:
 * touching a screen this test approves must keep `rawTables` where the baseline puts it.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptConvert, convertTable } from '../../scripts/codemod-row-table.js';

/** Convert the only table in `source`. */
const convert = (source: string) => {
  const at = source.indexOf('<table');
  assert.ok(at >= 0, 'the fixture has no table');
  return attemptConvert(source, at);
};

const page = (table: string) => `export function Screen() {\n  return (\n    <section>\n${table}\n    </section>\n  );\n}\n`;

describe('the codemod only takes the tables it can reproduce exactly', () => {
  test('a caption, literal headers and one mapped body convert into a column list', () => {
    const { conversion, reason } = convert(page(`      <table className="w-full text-sm">
        <caption>Every order and its value</caption>
        <thead><tr className="text-xs">
          <th scope="col" className="text-left py-1">Order</th>
          <th scope="col" className="text-right py-1">Value</th>
        </tr></thead>
        <tbody>
          {orders.map(order => (
            <tr key={order.id}>
              <th scope="row" className="text-left py-1 font-mono">{order.number}</th>
              <td className="text-right py-1 font-mono">{money(order.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>`));
    assert.equal(reason, '');
    assert.ok(conversion);
    // the caption becomes the accessible name, and the money column keeps its own alignment and class
    assert.match(conversion.after, /caption=\{\(<>Every order and its value<\/>\)\}/);
    assert.match(conversion.after, /rows=\{orders\}/);
    assert.match(conversion.after, /rowKey=\{order => order\.id\}/);
    assert.match(conversion.after, /\{ header: "Order", className: "py-1 font-mono", cell: \(order\) => order\.number \}/);
    assert.match(conversion.after, /\{ header: "Value", align: 'right', className: "py-1 font-mono", cell: \(order\) => money\(order\.cents\) \}/);
    // and no `th`/`td`/`table` survives: the markup now lives in one place
    assert.doesNotMatch(conversion.after, /<t[hd]\b|<table\b/);
  });

  test('a totals row in the footer is refused: a sum is not a column', () => {
    const { conversion, reason } = convert(page(`      <table>
        <caption>Per vendor</caption>
        <thead><tr><th scope="col">Vendor</th><th scope="col">Paid</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{money(row.cents)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><td>{money(total)}</td></tr></tfoot>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /totals row/);
  });

  test('a row whose class reads the row is refused, because a row class is fixed for the table', () => {
    const { conversion, reason } = convert(page(`      <table>
        <caption>Movements</caption>
        <thead><tr><th scope="col">Date</th></tr></thead>
        <tbody>{movements.map(m => <tr key={m.id} className={m.amount < 0 ? 'text-rose-700' : ''}><th scope="row">{m.date}</th></tr>)}</tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /row class that reads the row/);
  });

  test('a cell class computed from the row is refused, because a column class is evaluated once', () => {
    const { conversion, reason } = convert(page(`      <table>
        <caption>Box movements</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Amount</th></tr></thead>
        <tbody>{movements.map(m => <tr key={m.id}><th scope="row">{m.date}</th>
          <td className={cn('p-3', m.amountCents < 0 ? 'text-[var(--neg)]' : 'text-[var(--pos)]')}>{money(m.amountCents)}</td></tr>)}</tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /class computed from the row/);
  });

  test('an interpolated class stays an expression instead of becoming the text of one', () => {
    const { conversion } = convert(page(`      <table>
        <caption>Per vendor</caption>
        <thead><tr><th scope="col" className={\`text-left \${th}\`}>Vendor</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row" className={\`text-left \${th}\`}>{row.name}</th></tr>)}</tbody>
      </table>`));
    assert.ok(conversion);
    // the variable is still a variable: the class entry is `className: \`text-left ${th}\``, not a quoted string
    assert.match(conversion.after, /className: `text-left \$\{th\}`/);
    assert.doesNotMatch(conversion.after, /"text-left \$\{th\}"/);
  });

  test('an empty-state row beside the rows is refused rather than dropped', () => {
    const { conversion, reason } = convert(page(`      <table>
        <caption>Open advances</caption>
        <thead><tr><th scope="col">Advance</th></tr></thead>
        <tbody>{rows.length === 0 && <tr><td>Nothing open.</td></tr>}{rows.map(r => <tr key={r.id}><th scope="row">{r.id}</th></tr>)}</tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /empty-state row/);
  });

  test('a table with no caption is refused: inventing one is a decision, not a rewrite', () => {
    const { conversion, reason } = convert(page(`      <table><tbody>{rows.map(r => <tr key={r.id}><td>{r.id}</td></tr>)}</tbody></table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /no caption/);
  });

  test('a nested map in the last cell becomes one repeated column, not one column per item', () => {
    const { conversion } = convert(page(`      <table>
        <caption>Cohorts by month</caption>
        <thead><tr><th scope="col" className="text-left">Cohort</th>{months.map(month => <th key={month} scope="col" className="text-right">{month}</th>)}</tr></thead>
        <tbody>{report.rows.map(row => (
          <tr key={row.cohort}>
            <th scope="row" className="text-left">{row.cohort}</th>
            <td className="text-right tabular-nums">{row.months.map(month => <span key={month}>{row[month]}</span>)}</td>
          </tr>
        ))}</tbody>
      </table>`));
    assert.ok(conversion, 'the matrix table is the shape the repeated column exists for');
    assert.match(conversion.after, /over: row\.months/);
    assert.match(conversion.after, /cell: \(row, month\) =>/);
  });
});

describe('the sweep and the counter agree', () => {
  test('the files the codemod approves no longer contain a hand-written table', () => {
    // a converted table cannot leave a `<table` behind, or the counter would still see the file and the sweep
    // would run again on its own output
    const { conversion } = convert(page(`      <table className="w-full text-sm">
        <caption>Labels</caption>
        <thead><tr><th scope="col">Name</th></tr></thead>
        <tbody>{labels.map(label => <tr key={label.id}><th scope="row">{label.name}</th></tr>)}</tbody>
      </table>`));
    assert.ok(conversion);
    assert.doesNotMatch(conversion.after, /<table\b/);
    // and the conversion is a component, not a string: the caller adds the import the codemod reports
    assert.match(conversion.after, /^ {6}<RowTable$/m);
  });
});

describe('convertTable is the same answer as attemptConvert', () => {
  test('a table that is hand work yields no conversion from either entry point', () => {
    const source = page(`      <table><tbody>{rows.map(r => <tr key={r.id}><td>{r.id}</td></tr>)}</tbody></table>`);
    const at = source.indexOf('<table');
    assert.equal(convertTable(source, at), undefined);
    assert.equal(attemptConvert(source, at).conversion, undefined);
    assert.ok(attemptConvert(source, at).reason.length > 0, 'and it says why');
  });
});
