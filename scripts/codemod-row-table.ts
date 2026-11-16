/**
 * `RowTable` codemod: move the regular raw tables onto the declarative table without changing a cell.
 *
 * `codemod-table-to-grid.ts` answers "which tables *could* move to the shared grid". This answers the
 * cheaper question — "which ones can move **tonight**, mechanically" — and then moves them.
 *
 * Four shapes cover almost every table in the app, and each is recognised structurally rather than by a
 * regex over the whole element:
 *
 *  - **literals** — `<thead><tr><th scope="col">Date</th>…` and a body of one `map` over literal cells.
 *    Every column is text, every cell is a plain cell. The most conservative shape.
 *  - **array header** — `<th>`s come from `{['Date', 'Day'].map(head => <th …>{head}</th>)}` and the body
 *    repeats the same `map` over its cells. The columns are declared once in the source, so the column list
 *    the table needs is the same list.
 *  - **computed columns** — `{columns.map(column => <th …>{column.name}</th>)}` over a `.map` body. The
 *    column name, the cell and the class per column are the three expressions the map already computes, so
 *    each becomes one entry in the declarative list.
 *  - **nested** — a cell renders another `map` (a month per cell, a dimension per cell). That is one column
 *    whose cell is a list, which is exactly what the original table said.
 *
 * What it will not do is guess: a conditional column, a cell with a click handler, a `rowSpan`, a table with
 * no caption, or a row with a class of its own all leave the table alone and report why. Those are the hand
 * list, and the checklist counts them.
 *
 * The conversion is deliberately **look-preserving**: the head row class, every header cell class and every
 * body cell class move across as they were, and the first body cell stays a row header, so a screen that
 * already looked right looks the same. What is added is the caption when the table had none, and the
 * `scope` a header was missing.
 *
 *     npx tsx scripts/codemod-row-table.ts                 # what would move, and why the rest will not
 *     npx tsx scripts/codemod-row-table.ts --files         # …with every one of them named
 *     npx tsx scripts/codemod-row-table.ts --write         # move them
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface Conversion {
  file: string;
  line: number;
  before: string;
  after: string;
}

export interface Attempt {
  conversion?: Conversion;
  /** Why this table is hand work. Empty when it converted. */
  reason: string;
}

/* ───────────────────────────── the small scanner these tables need ───────────────────────────── */

/** `index` moved to just past the expression that starts with `{` at `index`. */
function skipExpression(source: string, index: number): number {
  let depth = 0;
  for (let at = index; at < source.length; at++) {
    const ch = source[at];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return at + 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      for (at++; at < source.length; at++) {
        if (source[at] === '\\') at++;
        else if (source[at] === quote) break;
      }
    }
  }
  return source.length;
}

/** `index` moved to just past the opening tag that starts at `index`. */
function skipOpeningTag(source: string, index: number): number {
  for (let at = index; at < source.length; at++) {
    if (source[at] === '{') { at = skipExpression(source, at) - 1; continue; }
    if (source[at] === '>') return at + 1;
  }
  return source.length;
}

/** The `<tag>`/`</tag>` element starting at `index`, to just past its closing tag. */
function skipElement(source: string, index: number, tag: string): number {
  if (!/^<([A-Za-z][\w.]*)/.test(source.slice(index))) return index;
  // a self-closing element (`<AlertCircle … />`) ends where its opening tag does
  const selfClosing = skipOpeningTag(source, index);
  if (source.slice(selfClosing - 2, selfClosing) === '/>') return selfClosing;
  let depth = 1;
  let at = index;
  while (at < source.length) {
    const next = source.slice(at + 1).search(/<\/?[A-Za-z]/);
    if (next === -1) return source.length;
    const tagStart = at + 1 + next;
    if (source.startsWith(`</${tag}>`, tagStart)) {
      depth--;
      at = tagStart + tag.length + 3;
      if (depth === 0) return at;
      continue;
    }
    if (source.startsWith(`<${tag}`, tagStart) && /[\s>/]/.test(source[tagStart + tag.length + 1] ?? ' ')) depth++;
    at = tagStart;
    at = skipOpeningTag(source, at) - 1;
  }
  return source.length;
}

const openTagAt = (source: string, index: number) => source.slice(index, skipOpeningTag(source, index));

/* ───────────────────────────── attributes and classes, as text ───────────────────────────── */

/** The raw text of a `className`, quotes and all, so an interpolated class can be kept as an expression. */
function classSource(tag: string): string | undefined {
  const at = tag.search(/\bclassName=/);
  if (at === -1) return undefined;
  const start = at + 'className='.length;
  if (tag[start] === '{') return tag.slice(start, skipExpression(tag, start)); // `{`…${a}…`}`
  const quote = tag[start];
  const end = tag.indexOf(quote, start + 1);
  return end === -1 ? undefined : tag.slice(start, end + 1);
}

function classOf(tag: string): string[] {
  const match = tag.match(/\bclassName=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*`([^`]*)`[^}]*\}|\{'([^']*)'\})/);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4] ?? '').split(/\s+/).filter(Boolean);
}

/** The value of `name=` on a tag, unwrapped from quotes or braces. */
function attributeOf(tag: string, name: string): string | undefined {
  const found = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`));
  if (found) return found[1] ?? found[2];
  const braced = tag.match(new RegExp(`\\b${name}=\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}`));
  return braced?.[1]?.trim();
}

/** A double-quoted attribute. */
const attr = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '&quot;')}"`;

const literal = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const ALIGNMENT = new Set(['text-left', 'text-right']);

/** The content between a JSX opening and closing tag, as one expression. */
function jsxValue(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && skipExpression(trimmed, 0) === trimmed.length) {
    return trimmed.slice(1, -1).trim();
  }
  const tag = /^<([A-Za-z][\w.]*)/.exec(trimmed)?.[1];
  if (tag && skipElement(trimmed, 0, tag) === trimmed.length) return trimmed;
  // more than one child (a tag, then text and values): a fragment is the expression that renders exactly them
  return `(<>${trimmed}</>)`;
}

/**
 * The class entries of a column. A header cell and a body cell keep **their own** classes: `RowTable` gives a
 * header cell `py-2 font-semibold` and a body cell nothing, so merging the two lists both drops a header's
 * `pl-3` and bolds a body cell that was never bold. The header entry is always written, `""` when the header
 * carried no class, so a plain `<th scope="col">` does not silently pick up the default weight.
 */
function classesOf(headRaw: string | undefined, cellRaw: string | undefined, headClasses: string[], cellClasses: string[]): string[] {
  const isExpression = (raw?: string) => Boolean(raw && (raw.includes('${') ||
    (raw.startsWith('{') && !/^\{\s*["'][^"']*["']\s*\}$/.test(raw))));
  const source = (raw: string) => {
    const inner = raw.startsWith('{') ? raw.slice(1, -1).trim() : raw.slice(1, -1);
    return inner;
  };
  const entries: string[] = [];
  if (cellRaw && isExpression(cellRaw)) {
    entries.push(`className: ${source(cellRaw)}`);
  } else {
    const names = cellClasses.filter(name => !ALIGNMENT.has(name));
    if (names.length) entries.push(`className: ${JSON.stringify(names.join(' '))}`);
  }
  if (headRaw && isExpression(headRaw)) {
    entries.push(`headClassName: ${source(headRaw)}`);
  } else {
    entries.push(`headClassName: ${JSON.stringify(headClasses.filter(name => !ALIGNMENT.has(name)).join(' '))}`);
  }
  return entries;
}

/* ───────────────────────────── the shapes ───────────────────────────── */

interface LiteralHead {
  kind: 'literal';
  headers: { content: string; classes: string[]; raw?: string }[];
}

interface ArrayHead {
  kind: 'array';
  list: string;
  /** The parameter the map names a header with, which the body names a cell with. */
  parameter: string;
  headTag: string;
  cellTag: string;
  key: string;
}

interface ComputedHead {
  kind: 'computed';
  list: string;
  parameter: string;
  text: string;
  headTag: string;
  cellTag: string;
  key: string;
}

interface VirtualHead {
  kind: 'virtual';
  /** A column the header writes out itself, before the computed ones. */
  fixed: { content: string; classes: string[]; raw?: string }[];
  list: string;
  parameter: string;
  text: string;
  headTag: string;
  cellTag: string;
  key: string;
}

type HeadShape = LiteralHead | ArrayHead | ComputedHead | VirtualHead;

/** `<th scope="col" …>text</th>`, where the text holds no tag and no expression. */
const LITERAL_HEAD_CELL = /^<th\b((?:[^>{}]|\{[^{}]*\})*)>([^<>{}]*)<\/th>$/;

function readHead(inner: string): HeadShape | undefined {
  // one `{list.map(param => …)}` around the whole row is how the array and computed shapes are written
  const mapped = /^\{([\s\S]+?)\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)?\s*=>\s*([\s\S]+)\)\}\s*$/.exec(inner.trim());
  if (mapped) {
    const [, list, parameter, rendered] = mapped;
    const tag = /^\s*<th\b/.test(rendered) ? 'th' : 'td';
    const open = openTagAt(rendered, rendered.indexOf('<'));
    const content = rendered.slice(skipOpeningTag(rendered, rendered.indexOf('<')), rendered.lastIndexOf(`</${tag}>`)).trim();
    if (!content) return undefined;
    const key = attributeOf(open, 'key');
    if (!key) return undefined;
    const isIdentity = content === `{${parameter}}`;
    if (isIdentity) return { kind: 'array', list, parameter, headTag: open, cellTag: open, key };
    const named = content.match(new RegExp(`^\\{${parameter}[.?].*\\}$`));
    if (named) return { kind: 'computed', list, parameter, text: named[0].slice(1, -1).trim(), headTag: open, cellTag: open, key };
    return undefined;
  }

  // literal header cells, possibly after one written-out cell of their own
  const cells: { content: string; classes: string[]; raw?: string }[] = [];
  let at = 0;
  const trimmed = inner.trim();
  while (at < trimmed.length) {
    const next = trimmed.slice(at).search(/<th\b|\{/);
    if (next === -1) {
      if (trimmed.slice(at).trim()) return undefined;
      break;
    }
    at += next;
    if (trimmed[at] === '{') {
      // a `{list.map(…)}` that is not the whole row: the "virtual" shape, a fixed column and then columns
      const end = skipExpression(trimmed, at);
      const mappedTail = /^\{([\s\S]+?)\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)?\s*=>\s*([\s\S]+)\)\}$/.exec(trimmed.slice(at, end).replace(/\s+/g, ' '));
      if (!mappedTail) return undefined;
      if (trimmed.slice(end).trim()) return undefined;
      const [, list, parameter, rendered] = mappedTail;
      const open = openTagAt(rendered, rendered.indexOf('<'));
      const content = rendered.slice(skipOpeningTag(rendered, rendered.indexOf('<')), rendered.lastIndexOf('</th>')).trim();
      const key = attributeOf(open, 'key');
      if (!key) return undefined;
      return { kind: 'virtual', fixed: cells, list, parameter, text: content.replace(/^\{|\}$/g, ''), headTag: open, cellTag: open, key };
    }
    const end = skipElement(trimmed, at, 'th');
    const source = trimmed.slice(at, end);
    const literalCell = LITERAL_HEAD_CELL.exec(source.replace(/\s+/g, ' '));
    if (literalCell) {
      cells.push({ content: literalCell[2].trim(), classes: classOf(`<th${literalCell[1]}>`), raw: classSource(`<th${literalCell[1]}>`) });
    } else {
      // a header cell with markup inside it (`<span class="sr-only">`) is a literal column whose name is markup
      const open = openTagAt(source, 0);
      if (!/\bscope="col"/.test(open)) return undefined;
      const body = source.slice(skipOpeningTag(source, 0), source.lastIndexOf('</th>')).trim();
      if (!body || /onClick=|onKeyDown=/.test(open)) return undefined;
      cells.push({ content: body, classes: classOf(open), raw: classSource(open) });
    }
    at = end;
  }
  if (cells.length === 0) return undefined;
  return { kind: 'literal', headers: cells };
}

interface Cell {
  tag: 'td' | 'th';
  rowHeader: boolean;
  /** The cell's own `className`, kept as written so an interpolated class survives the move. */
  rawClass?: string;
  classes: string[];
  content: string;
  /** The list a nested `map` renders, when the cell is a list rather than a value. */
  nested?: { list: string; parameter: string; content: string };
}

function readCells(rowInner: string): Cell[] | undefined {
  const cells: Cell[] = [];
  let at = 0;
  const trimmed = rowInner.trim();
  while (at < trimmed.length) {
    if (/\s/.test(trimmed[at])) { at++; continue; }
    if (trimmed[at] !== '<') return undefined;
    const tag = /^<(td|th)\b/.exec(trimmed.slice(at));
    if (!tag) return undefined;
    const end = skipElement(trimmed, at, tag[1]);
    const source = trimmed.slice(at, end);
    const open = openTagAt(source, 0);
    if (/\browSpan=|\bcolSpan=|\bonClick=|\bonKeyDown=|\bonChange=/.test(open)) return undefined;
    const isHeader = tag[1] === 'th';
    if (isHeader && !/\bscope="row"/.test(open)) return undefined;
    const content = source.slice(skipOpeningTag(source, 0), source.lastIndexOf(`</${tag[1]}>`)).trim();
    if (!content) return undefined;
    const nested = /^\{([\s\S]+?)\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)?\s*=>\s*([\s\S]+)\)\}$/.exec(content);
    cells.push({
      tag: tag[1] as 'td' | 'th',
      rowHeader: isHeader,
      rawClass: classSource(open),
      classes: classOf(open),
      content,
      nested: nested && !/\.map\(/.test(nested[3]) ? { list: nested[1], parameter: nested[2], content: nested[3] } : undefined,
    });
    at = end;
  }
  return cells;
}

/** Convert the table that starts at `start`, or say why it cannot. */
export function attemptConvert(source: string, start: number): Attempt {
  const line = source.slice(0, start).split('\n').length;
  const tableOpen = openTagAt(source, start);
  if (!/^<table\b/.test(tableOpen)) return { reason: 'not a table' };
  const tableEnd = skipElement(source, start, 'table');
  const table = source.slice(start, tableEnd);

  // a `<table key={side}>` in a map keeps its key, or React re-uses the previous table's DOM; any other
  // attribute of the table (`aria-label`, `id`) is a name this component does not have a prop for, so the
  // table is hand work rather than silently losing the name a screen reader announces it by
  const tableKey = attributeOf(tableOpen, 'key');
  const otherAttributes = [...tableOpen.matchAll(/\s([A-Za-z_][-\w:.]*)\s*=/g)]
    .map(match => match[1])
    .filter(name => name !== 'className' && name !== 'key');
  if (otherAttributes.length > 0) {
    return { reason: `a table attribute a rewrite would drop (${otherAttributes.join(', ')})` };
  }

  const captionAt = table.indexOf('<caption');
  if (captionAt === -1) return { reason: 'no caption: a caption the script would invent is a hand decision' };
  const captionEnd = skipElement(table, captionAt, 'caption');
  const captionBody = table.slice(skipOpeningTag(table, captionAt), captionEnd - '</caption>'.length).trim();
  const captionClass = classOf(openTagAt(table, captionAt)).join(' ');
  if (!captionBody) return { reason: 'an empty caption' };

  const headAt = table.indexOf('<thead');
  if (headAt === -1) return { reason: 'no header row to take the columns from' };
  const theadEnd = skipElement(table, headAt, 'thead');
  const thead = table.slice(headAt, theadEnd);
  const headRowAt = thead.indexOf('<tr');
  if (headRowAt === -1) return { reason: 'a header row this script could not read' };
  const theadOpen = openTagAt(table, headAt);
  const headRow = openTagAt(thead, headRowAt);
  const headInner = thead.slice(skipOpeningTag(thead, headRowAt), thead.lastIndexOf('</tr>'));
  if (attributeOf(headRow, 'onClick') !== undefined) return { reason: 'a sortable header row (the grid owns sorting)' };
  const head = readHead(headInner);
  if (!head) return { reason: 'a header row that is not one of the shapes the table can take' };

  // a table with a footer has a totals row; a sweep that dropped it would silently delete a sum from a report,
  // so every other part of the table has to be accounted for before this can go ahead
  if (/<tfoot\b/.test(table)) return { reason: 'a totals row in a footer (a sum is not a column)' };
  const otherParts = table
    .replace(/<caption[\s\S]*?<\/caption>/, '')
    .replace(/<thead[\s\S]*?<\/thead>/, '')
    .replace(/<tbody[\s\S]*?<\/tbody>/, '')
    .replace(/<\/?table\b[^>]*>/g, '')
    .trim();
  if (otherParts) return { reason: 'something outside the caption, header and body that a rewrite would drop' };

  const bodyAt = table.indexOf('<tbody');
  if (bodyAt === -1) return { reason: 'no body to take the rows from' };
  const tbodyOpen = openTagAt(table, bodyAt);
  const tbodyEnd = skipElement(table, bodyAt, 'tbody');
  const bodyInner = table.slice(skipOpeningTag(table, bodyAt), tbodyEnd - '</tbody>'.length).trim();
  if (!bodyInner.startsWith('{') || skipExpression(bodyInner, 0) !== bodyInner.length) {
    return { reason: 'a body that is not one expression: an empty-state row beside the rows, or a literal row' };
  }
  const expression = bodyInner.slice(1, -1).trim();
  const mapAt = expression.indexOf('.map(');
  if (mapAt === -1) return { reason: 'a body that is not a map' };
  const list = expression.slice(0, mapAt).trim();
  // the map's own callback: everything from its `(` to the `)` that closes it, found by balance so a nested
  // `map` inside a cell does not end the body
  let depth = 0;
  let close = -1;
  for (let at = mapAt + 4; at < expression.length; at++) {
    const ch = expression[at];
    if (ch === '{') { at = skipExpression(expression, at) - 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      for (at++; at < expression.length && expression[at] !== ch; at++) if (expression[at] === '\\') at++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { close = at; break; } }
  }
  if (close === -1) return { reason: 'a body this script could not read as one map' };
  if (expression.slice(close + 1).trim()) return { reason: 'a body with more than one map' };
  const callback = expression.slice(mapAt + 5, close).trim();
  const arrow = callback.match(/^\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)?\s*=>\s*([\s\S]*)$/);
  if (!arrow) return { reason: 'a callback that is destructured, or has a body this script would have to rewrite' };
  const [, row, renderedRaw] = arrow;
  const trimmed = renderedRaw.trim();
  // a parenthesised body, `=> ( <tr>…</tr> )`, is the same row
  const rendered = /^\([\s\S]*\)$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
  if (!/^\(?\s*<tr\b/.test(rendered)) return { reason: 'a map that does not return a row' };
  const trAt = rendered.indexOf('<tr');
  const trEnd = skipElement(rendered, trAt, 'tr');
  if (rendered.length !== trEnd) return { reason: 'a row with more than the row itself in it' };
  const trOpen = openTagAt(rendered, trAt);
  const trKey = attributeOf(trOpen, 'key');
  if (!trKey) return { reason: 'a row with no key, and the screen key is the one to keep' };
  if (/\bonClick=|\bonKeyDown=|\bonDoubleClick=|\btabIndex=/.test(trOpen)) return { reason: 'a row the user acts on' };
  const rowClassName = classOf(trOpen).join(' ');

  const cells = readCells(rendered.slice(skipOpeningTag(rendered, trAt), trEnd - '</tr>'.length));
  if (!cells) return { reason: 'a cell this script could not read as one column' };
  const rowHeaderColumn = cells[0].rowHeader;

  // a class that reads the row (`cn('p-3', m.amountCents < 0 ? …)`) is computed per row: it has to stay inside
  // the cell, because a column-level `className` is evaluated once, outside the row's scope
  const readsRow = new RegExp(`\\b${row}\\.`);
  if (cells.some(cell => cell.rawClass && readsRow.test(cell.rawClass))) {
    return { reason: 'a class computed from the row, which belongs inside the cell' };
  }
  const headTag = 'headTag' in head ? head.headTag : undefined;
  if (headTag && readsRow.test(headTag)) {
    return { reason: 'a header class that reads the row' };
  }
  if (classSource(tableOpen) && readsRow.test(classSource(tableOpen)!)) return { reason: 'a table class that reads the row' };
  if (classSource(trOpen) && readsRow.test(classSource(trOpen)!)) {
    return { reason: 'a row class that reads the row, so the row changes with its data' };
  }
  if (cells.slice(1).some(cell => cell.rowHeader)) return { reason: 'a row header after the first column' };

  const tableClass = classOf(tableOpen).join(' ');
  // the head's class is on the `<thead>` when it is `sticky top-0`, and on the `<tr>` when it is a colour:
  // both move onto the one element `RowTable` classes, the `<thead>`, so neither is dropped
  const headRowClass = [...new Set([...classOf(theadOpen), ...classOf(headRow)])].join(' ');
  const bodyClass = classOf(tbodyOpen).join(' ');

  const entries: string[] = [];
  const entry = (parts: (string | string[] | false | undefined)[]) =>
    `{ ${parts.flat().filter(Boolean).join(', ')} },`;

  /** `cell: row => …` for a literal cell, from the row's name and the cell's own expression. */
  const cellCallback = (content: string, extra?: string) =>
    extra ? `(${row}) => (${extra}, ${content})` : `(${row}) => ${content}`;
  void cellCallback;

  const fixedHeaders = head.kind === 'literal' ? head.headers : head.kind === 'virtual' ? head.fixed : [];
  const nestedCells = cells.filter(cell => cell.nested);
  const literalCells = cells.filter(cell => !cell.nested);
  if (nestedCells.length > 1) return { reason: 'more than one nested map in a row' };
  if (nestedCells.length === 1 && head.kind === 'literal') return { reason: 'a nested map under a header that does not declare it' };
  if (nestedCells.length === 1 && cells.indexOf(nestedCells[0]) !== cells.length - 1) {
    return { reason: 'a nested map that is not the last column' };
  }
  if (literalCells.length !== fixedHeaders.length) {
    return { reason: 'a row that does not line up with its header' };
  }

  fixedHeaders.forEach((header, index) => {
    const cell = literalCells[index];
    const text = header.content;
    entries.push(entry([
      /[<{]/.test(text) ? `header: ${jsxValue(text)}` : `header: ${literal(text)}`,
      header.classes.includes('text-right') || cell.classes.includes('text-right') ? "align: 'right'" : '',
      ...classesOf(header.raw, cell.rawClass, header.classes, cell.classes),
      `cell: (${row}) => ${jsxValue(cell.content)}`,
    ]));
  });

  if (nestedCells.length === 1) {
    if (head.kind === 'literal') return { reason: 'a nested map under a header that does not declare it' };
    const nested = nestedCells[0].nested!;
    const headClasses = classOf(head.cellTag);
    entries.push(entry([
      `over: ${nested.list}`,
      `head: (${nested.parameter}) => ${head.kind === 'array' ? nested.parameter : head.text}`,
      headClasses.includes('text-right') || nestedCells[0].classes.includes('text-right') ? "align: 'right'" : '',
      ...classesOf(classSource(head.cellTag), nestedCells[0].rawClass, headClasses, nestedCells[0].classes),
      `cell: (${row}, ${nested.parameter}) => ${jsxValue(nested.content)}`,
    ]));
  } else if (head.kind === 'array') {
    // `{['Date', 'Day', 'Holiday'].map(head => <th>{head}</th>)}`: the columns are the literal list itself
    const items = list.match(/^\[([\s\S]*)\]$/);
    if (!items) return { reason: 'a header list that is computed, not written out' };
    const names = [...items[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(match => match[1] ?? match[2]);
    if (names.length !== literalCells.length || names.some(name => name === undefined)) {
      return { reason: 'a header list that does not match the cells of a row' };
    }
    names.forEach((name, index) => {
      const cell = literalCells[index];
      entries.push(entry([
        `header: ${literal(name)}`,
        classOf(head.headTag).includes('text-right') || cell.classes.includes('text-right') ? "align: 'right'" : '',
        ...classesOf(classSource(head.headTag), cell.rawClass, classOf(head.headTag), cell.classes),
        `cell: (${row}) => ${jsxValue(cell.content)}`,
      ]));
    });
  } else if (head.kind === 'computed') {
    return { reason: 'a computed column whose cells are written one by one' };
  }

  if (entries.length === 0) return { reason: 'a table with no columns this script could write' };

  const props: string[] = [];
  if (tableKey) props.push(`        key={${tableKey}}`);
  if (!rowHeaderColumn) props.push('        rowHeaderColumn={false}');
  if (rowClassName) props.push(`        rowClassName=${attr(rowClassName)}`);
  props.push(`        caption={${jsxValue(captionBody)}}`);
  props.push(`        rows={${list}}`);
  props.push(`        rowKey={${row} => ${trKey}}`);
  // every class the original table had, and the absence of one: `<thead>` with no class must not inherit the
  // component's default `text-[var(--muted)]`, and a bare `<tbody>` must not gain `divide-y`
  if (captionClass !== 'sr-only') props.push(`        captionClassName=${attr(captionClass)}`);
  if (tableClass !== 'w-full text-xs') props.push(`        tableClassName=${attr(tableClass)}`);
  if (headRowClass !== 'text-[var(--muted)]') props.push(`        headRowClassName=${attr(headRowClass)}`);
  if (bodyClass !== 'divide-y divide-[var(--line)]') props.push(`        bodyClassName=${attr(bodyClass)}`);

  const lineStart = source.lastIndexOf('\n', start) + 1;
  const lineIndent = (source.slice(lineStart, start).match(/^\s*/) ?? [''])[0];
  // the source keeps whatever precedes `<table` on its line, the indent included, so the first line of the
  // replacement carries none of its own
  const replacement = [
    '<RowTable',
    ...props.map(row => `${lineIndent}  ${row.trimStart()}`),
    `${lineIndent}  columns={[`,
    ...entries.map(row => `${lineIndent}    ${row.trimStart()}`),
    `${lineIndent}  ]}`,
    `${lineIndent}/>`,
  ].join('\n');

  return { conversion: { file: '', line, before: table, after: replacement }, reason: '' };
}

/** The conversion for the table at `start`, or `undefined` when it is hand work. */
export function convertTable(source: string, start: number): Conversion | undefined {
  return attemptConvert(source, start).conversion;
}

/**
 * Whether the replacement is syntactically valid JSX. The scanner is a scanner, not a parser: a `5 > 3` in a
 * caption's text would end an opening tag early and produce a plausible-looking, wrong table. Parsing the
 * result is a cheap way to refuse anything the scanner merely *thinks* it understood.
 */
export function parses(replacement: string): boolean {
  const wrapped = `const table = (\n${replacement}\n);\n`;
  const file = ts.createSourceFile('probe.tsx', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return (file as unknown as { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length === 0;
}

/* ───────────────────────────── the sweep ───────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** The import each file needs, relative to `src/components`. */
function importFor(file: string): string {
  const from = path.dirname(path.relative(path.join(process.cwd(), 'src/components'), file));
  const up = from.split(path.sep).filter(part => part && part !== '.').length;
  return up <= 0 ? './RowTable' : `${'../'.repeat(up)}ui/RowTable`;
}

function addImport(source: string, file: string): string {
  if (/from '[^']*RowTable'/.test(source)) return source;
  const line = `import { RowTable } from '${importFor(file)}';\n`;
  const imports = [...source.matchAll(/^import [\s\S]*?from '[^']+';\n/gm)];
  if (imports.length > 0) {
    const end = imports[imports.length - 1].index! + imports[imports.length - 1][0].length;
    return `${source.slice(0, end)}${line}${source.slice(end)}`;
  }
  return `${line}${source}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const write = process.argv.includes('--write');
  const files = walk(path.join(process.cwd(), 'src/components'));
  const handWork = new Map<string, string[]>();
  let converted = 0;
  for (const file of files) {
    const relative = path.relative(process.cwd(), file);
    let source = fs.readFileSync(file, 'utf8');
    const starts: number[] = [];
    for (const match of source.matchAll(/<table\b/g)) starts.push(match.index!);
    let changed = false;
    // back to front, so replacing one table does not move the offset of a table before it
    for (const start of starts.reverse()) {
      const attempt = attemptConvert(source, start);
      const conversion = attempt.conversion && parses(attempt.conversion.after) ? attempt.conversion : undefined;
      const reason = attempt.conversion ? 'the replacement does not parse (a `>` in text, or markup the scanner joined)' : attempt.reason;
      if (!conversion) {
        if (!handWork.has(reason)) handWork.set(reason, []);
        handWork.get(reason)!.push(`${relative}:${source.slice(0, start).split('\n').length}`);
        continue;
      }
      source = `${source.slice(0, start)}${conversion.after}${source.slice(start + conversion.before.length)}`;
      changed = true;
      converted++;
    }
    if (!changed) continue;
    source = addImport(source, file);
    if (write) fs.writeFileSync(file, source);
    console.log(`${write ? 'converted' : 'would convert'} ${relative}`);
  }
  const missed = [...handWork.values()].reduce((total, places) => total + places.length, 0);
  console.log(`\n${write ? 'converted' : 'would convert'} ${converted} table(s); ${missed} left for hand work:`);
  for (const [reason, places] of [...handWork].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(places.length).padStart(3)}  ${reason}`);
    if (process.argv.includes('--files')) for (const place of places) console.log(`         ${place}`);
  }
}
