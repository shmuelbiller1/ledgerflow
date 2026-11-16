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
    assert.match(conversion.after, /\{ header: "Order", className: "text-left py-1 font-mono", headClassName: "text-left py-1", cell: \(order\) => order\.number \}/);
    assert.match(conversion.after, /\{ header: "Value", align: 'right', className: "py-1 font-mono", headClassName: "py-1", cell: \(order\) => money\(order\.cents\) \}/);
    // and no `th`/`td`/`table` survives: the markup now lives in one place
    assert.doesNotMatch(conversion.after, /<t[hd]\b|<table\b/);
  });

  test('a header that maps a literal list of names becomes one column per name', () => {
    const { conversion } = convert(page(`      <table className="w-full text-sm">
        <caption>Bank holidays</caption>
        <thead>
          <tr>{['Date', 'Day', 'Holiday'].map(head => <th key={head} scope="col" className="text-left py-1">{head}</th>)}</tr>
        </thead>
        <tbody>{rows.map(row => (
          <tr key={row.date}>
            <th scope="row" className="text-left py-1">{row.date}</th>
            <td className="py-1">{row.day}</td>
            <td className="py-1">{row.name}</td>
          </tr>
        ))}</tbody>
      </table>`));
    assert.ok(conversion, 'the array header is the shape most report tables are written in');
    assert.match(conversion.after, /\{ header: "Date",/);
    assert.match(conversion.after, /\{ header: "Holiday",/);
    assert.match(conversion.after, /rows=\{rows\}/);
  });

  test('a header class that reads the header item is refused: a column cannot see it', () => {
    const { conversion, reason } = convert(page(`      <table className="w-full text-sm">
        <caption>Claims</caption>
        <thead>
          <tr>{['Employee', 'Amount'].map(head => <th key={head} scope="col" className={\`\${head === 'Amount' ? 'text-right' : 'text-left'} py-1\`}>{head}</th>)}</tr>
        </thead>
        <tbody>{rows.map(row => (
          <tr key={row.id}>
            <th scope="row">{row.employee}</th>
            <td>{money(row.cents)}</td>
          </tr>
        ))}</tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /a header class that reads the header item/);
  });

  test('an empty-state row and the rows as one ternary become the empty row and the rows', () => {
    const { conversion } = convert(page(`      <table className="w-full">
        <caption>Transfers</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Amount</th></tr></thead>
        <tbody>
          {transfers.length === 0 ? (
            <tr><td colSpan={2} className="py-12">No transfers recorded.</td></tr>
          ) : (
            transfers.map(t => (
              <tr key={t.id}><td>{t.date}</td><td>{t.amount}</td></tr>
            ))
          )}
        </tbody>
      </table>`));
    assert.ok(conversion, 'the empty row and the rows are one expression, and both halves convert');
    assert.match(conversion.after, /rows=\{transfers\}/);
    assert.match(conversion.after, /emptyRow=\{<tr>/);
    assert.match(conversion.after, /colSpan=\{2\}/);
    assert.doesNotMatch(conversion.after, /\.length === 0/);
  });

  test('a totals row in the footer becomes the footer, not a column', () => {
    const { conversion } = convert(page(`      <table>
        <caption>Per vendor</caption>
        <thead><tr><th scope="col">Vendor</th><th scope="col">Paid</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{money(row.cents)}</td></tr>)}</tbody>
        <tfoot className="border-t-2 border-[var(--line)]"><tr><th scope="row">Total</th><td>{money(total)}</td></tr></tfoot>
      </table>`));
    assert.ok(conversion);
    // the sum is still a row under the body, with the class the footer had
    assert.match(conversion.after, /footer=\{<tr><th scope="row">Total<\/th><td>\{money\(total\)\}<\/td><\/tr>\}/);
    assert.match(conversion.after, /footerClassName="border-t-2 border-\[var\(--line\)\]"/);
    // and nothing of it leaked into a column
    assert.doesNotMatch(conversion.after, /header: "Total"/);
  });

  test('an empty-state row stays a row inside the body, under the columns it is about', () => {
    const { conversion } = convert(page(`      <table>
        <caption>Waiting lines</caption>
        <thead><tr><th scope="col">Order</th></tr></thead>
        <tbody>
          {releasable.length === 0 && <tr><td colSpan={2} className="py-2 text-[var(--muted)]">Nothing is waiting.</td></tr>}
          {releasable.map(r => <tr key={r.id}><th scope="row">{r.number}</th></tr>)}
        </tbody>
      </table>`));
    assert.ok(conversion);
    assert.match(conversion.after, /emptyRow=\{<tr><td colSpan=\{2\} className="py-2 text-\[var\(--muted\)\]">Nothing is waiting\.<\/td><\/tr>\}/);
    // the rows are still the one map, and the body is no longer two expressions
    assert.match(conversion.after, /rows=\{releasable\}/);
    assert.doesNotMatch(conversion.after, /length === 0/);
  });

  test('a conditional row that is not about the list being empty is still refused', () => {
    const { conversion, reason } = convert(page(`      <table>
        <caption>Lines</caption>
        <thead><tr><th scope="col">Line</th></tr></thead>
        <tbody>
          {canAdd && <tr><td colSpan={1}>Add a line</td></tr>}
          {lines.map(l => <tr key={l.id}><th scope="row">{l.name}</th></tr>)}
        </tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /a body that is not one expression/);
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
            <td className="text-right tabular-nums">{months.map(month => <span key={month}>{row[month]}</span>)}</td>
          </tr>
        ))}</tbody>
      </table>`));
    assert.ok(conversion, 'the matrix table is the shape the repeated column exists for');
    // `over` is the header's list: the columns array is outside every row callback, so `row.months` would not be
    // in scope there, and the two lists lining up is the whole contract of a repeated column
    assert.match(conversion.after, /over: months\b/);
    assert.doesNotMatch(conversion.after, /over: row\./);
    assert.match(conversion.after, /head: \(month\) => month/);
    assert.match(conversion.after, /cell: \(row, month\) =>/);
  });

  test('a nested map over a list the header does not map is refused, not silently re-scoped', () => {
    const { conversion, reason } = convert(page(`      <table>
        <caption>Cohorts by month</caption>
        <thead><tr><th scope="col">Cohort</th>{months.map(month => <th key={month} scope="col">{month}</th>)}</tr></thead>
        <tbody>{report.rows.map(row => (
          <tr key={row.cohort}>
            <th scope="row">{row.cohort}</th>
            <td>{row.months.map(month => <span key={month}>{row[month]}</span>)}</td>
          </tr>
        ))}</tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /a nested map over a list the header does not map/);
  });
  test('a header cell keeps its own class, and the default weight does not leak into the body', () => {
    const { conversion } = convert(page(`      <table className="w-full text-xs">
        <caption>Depreciation</caption>
        <thead><tr><th scope="col" className="text-left py-1">Year</th><th scope="col" className="text-left pl-3 py-1">Posted</th><th scope="col">Note</th></tr></thead>
        <tbody>{years.map(y => <tr key={y.year}><th scope="row" className="text-left py-1">{y.year}</th><td className="py-1 pl-3 text-[var(--muted)]">{y.posted}</td><td>{y.note}</td></tr>)}</tbody>
      </table>`));
    assert.ok(conversion);
    // the header's `pl-3` stays on the header, and the body cell keeps its own class list
    assert.match(conversion.after, /header: "Posted", className: "py-1 pl-3 text-\[var\(--muted\)\]", headClassName: "text-left pl-3 py-1",/);
    // a header with no class of its own says so, so `py-2 font-semibold` is not invented for it
    assert.match(conversion.after, /headClassName: "",/);
    // no column declared `align`, so no column gets an alignment class it did not have
    assert.doesNotMatch(conversion.after, /align: 'right'/);
  });

  test('a visible caption stays visible, and the head keeps the class it had on the thead', () => {
    const { conversion } = convert(page(`      <table className="w-full text-sm">
        <caption>Currencies used besides {home}</caption>
        <thead className="sticky top-0 bg-[var(--panel)]"><tr><th scope="col">Code</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.code}><th scope="row">{r.code}</th></tr>)}</tbody>
      </table>`));
    assert.ok(conversion);
    // a `<caption>` with no class was a line on the screen; `sr-only` is the component's default, not this table's
    assert.match(conversion.after, /captionClassName=""/);
    // and `sticky top-0` lives on the `<thead>`, which is the element the component classes
    assert.match(conversion.after, /headRowClassName="sticky top-0 bg-\[var\(--panel\)\]"/);
  });

  test('a header that mixes text and an expression stays an expression, not the text of one', () => {
    const { conversion } = convert(page(`      <table className="w-full text-xs">
        <caption>Opening balances</caption>
        <thead><tr><th scope="col">Account</th><th scope="col">Balance ({currency})</th></tr></thead>
        <tbody>{accounts.map(a => <tr key={a.id}><th scope="row">{a.name}</th><td>{a.cents}</td></tr>)}</tbody>
      </table>`));
    assert.ok(conversion);
    assert.match(conversion.after, /header: \(<>Balance \(\{currency\}\)<\/>\)/);
    assert.doesNotMatch(conversion.after, /header: "Balance \(\{currency\}\)"/);
  });

  test('a table with a name this component has no prop for is hand work, not a lost name a11y', () => {
    const { conversion, reason } = convert(page(`      <table aria-label="Profit and loss">
        <caption>Profit and loss</caption>
        <thead><tr><th scope="col">Line</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}><th scope="row">{l.name}</th></tr>)}</tbody>
      </table>`));
    assert.equal(conversion, undefined);
    assert.match(reason, /table attribute a rewrite would drop/);
  });

  test('a table mapped in a list keeps its key', () => {
    const { conversion } = convert(page(`      {(['sales', 'purchases'] as const).map(side => (
        <table key={side} className="w-full text-xs">
          <caption>By treatment</caption>
          <thead><tr><th scope="col">Treatment</th></tr></thead>
          <tbody>{treatments.map(t => <tr key={t}><th scope="row">{t}</th></tr>)}</tbody>
        </table>
      ))}`));
    assert.ok(conversion);
    // without the key React re-uses the first table's DOM for the second
    assert.match(conversion.after, /key=\{side\}/);
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
    // the source keeps the indent that precedes `<table`, so the component's first line carries none
    assert.match(conversion.after, /^<RowTable$/m);
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
