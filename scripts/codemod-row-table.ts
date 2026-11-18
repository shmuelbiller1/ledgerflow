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
import { guardedTableColumns, onlyAttributes } from './guarded-table-columns';

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
  let at = index;
  while (at < source.length) {
    const ch = source[at];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return at + 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      at = endOfString(source, at);
      continue;
    }
    at++;
  }
  return source.length;
}

/** `index` (at a quote) moved to just past the matching quote, a backslash escape included. */
function endOfString(source: string, index: number): number {
  const quote = source[index];
  let at = index + 1;
  while (at < source.length) {
    if (source[at] === '\\') {
      at += 2;
      continue;
    }
    if (source[at] === quote) return at + 1;
    at++;
  }
  return source.length;
}

/** `index` moved to just past the opening tag that starts at `index`. */
function skipOpeningTag(source: string, index: number): number {
  let at = index;
  while (at < source.length) {
    if (source[at] === '{') {
      at = skipExpression(source, at);
      continue;
    }
    if (source[at] === '>') return at + 1;
    at++;
  }
  return source.length;
}

/** The `)` that closes the `(` at `index`, or `-1`. Comments, strings and `{…}` are skipped. */
function closingParen(source: string, index: number): number {
  let depth = 0;
  let at = index;
  while (at < source.length) {
    const ch = source[at];
    if (ch === '{') {
      at = skipExpression(source, at);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      at = endOfString(source, at);
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return at;
    }
    at++;
  }
  return -1;
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

export function classOf(tag: string): string[] {
  const at = tag.search(/\bclassName=/);
  if (at === -1) return [];
  const value = tag.slice(at + 'className='.length);
  // one anchored alternative each, so no pattern can backtrack over the tag: a quoted class, a template
  // literal, or a template literal inside an expression (`{`text-left ${th}`}`)
  const quoted = /^"([^"]*)"|^'([^']*)'/.exec(value);
  if (quoted) return (quoted[1] ?? quoted[2] ?? '').split(/\s+/).filter(Boolean);
  const template = /^\{`([^`]*)`\}/.exec(value);
  if (template) return template[1].split(/\s+/).filter(Boolean);
  // Examine template delimiters once instead of backtracking over overlapping text.
  if (!value.startsWith('{')) return [];
  const openingTick = value.indexOf('`', 1);
  if (openingTick === -1 || value.slice(1, openingTick).includes('}')) return [];
  const closingTick = value.indexOf('`', openingTick + 1);
  if (closingTick === -1) return [];
  const closingBrace = value.indexOf('}', closingTick + 1);
  if (closingBrace === -1) return [];
  const secondTemplate = value.indexOf('`', closingTick + 1);
  if (secondTemplate !== -1 && secondTemplate < closingBrace) return []; // ambiguous: do not guess
  return value.slice(openingTick + 1, closingTick).split(/\s+/).filter(Boolean);
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
/** `align: 'right'` only when the header cell and the body cell both said right — one side alone is that side's. */
function alignEntry(headClasses: string[], cellClasses: string[]): string {
  return headClasses.includes('text-right') && cellClasses.includes('text-right') ? "align: 'right'" : '';
}

function classesOf(headRaw: string | undefined, cellRaw: string | undefined, headClasses: string[], cellClasses: string[]): string[] {
  const isExpression = (raw?: string) => Boolean(raw && (raw.includes('${') ||
    (raw.startsWith('{') && !/^\{\s*["'][^"']*["']\s*\}$/.test(raw))));
  const source = (raw: string) => {
    const inner = raw.startsWith('{') ? raw.slice(1, -1).trim() : raw.slice(1, -1);
    return inner;
  };
  // `text-right` leaves the class lists only when the column declares `align: 'right'`, so the alignment class
  // is written once; a side that said it alone keeps it, because moving it would move that side's text
  const both = alignEntry(headClasses, cellClasses) !== '';
  const keep = (classes: string[]) => classes.filter(name => !(both && name === 'text-right'));
  const entries: string[] = [];
  if (cellRaw && isExpression(cellRaw)) {
    entries.push(`className: ${source(cellRaw)}`);
  } else {
    const names = keep(cellClasses);
    if (names.length) entries.push(`className: ${JSON.stringify(names.join(' '))}`);
  }
  if (headRaw && isExpression(headRaw)) {
    entries.push(`headClassName: ${source(headRaw)}`);
  } else {
    entries.push(`headClassName: ${JSON.stringify(keep(headClasses).join(' '))}`);
  }
  return entries;
}

/**
 * The attributes of an opening tag other than `className`, as their name and their value exactly as written.
 *
 * A cell carries more than a class: `dir="rtl"` on a Hebrew cell, an `aria-label` that explains a bare symbol.
 * Those are not decoration — they are what a screen reader says — so a column keeps them, and a table whose cell
 * carries an attribute this list does not cover is refused rather than quietly stripped.
 */
function attributesOf(tag: string): { name: string; raw: string }[] {
  const attributes: { name: string; raw: string }[] = [];
  const pattern = /\s([A-Za-z_][-\w:.]*)\s*=\s*/g;
  const open = tag.slice(0, tag.length - (tag.endsWith('/>') ? 2 : 1));
  for (let match = pattern.exec(open); match; match = pattern.exec(open)) {
    const name = match[1];
    const valueAt = match.index + match[0].length;
    const quote = open[valueAt];
    let raw: string;
    if (quote === '{') {
      raw = open.slice(valueAt, skipExpression(open, valueAt));
    } else if (quote === '"' || quote === "'") {
      const end = open.indexOf(quote, valueAt + 1);
      raw = open.slice(valueAt, end === -1 ? open.length : end + 1);
    } else {
      raw = /^[^\s>]*/.exec(open.slice(valueAt))?.[0] ?? '';
    }
    if (name !== 'className') attributes.push({ name, raw });
    pattern.lastIndex = valueAt + raw.length;
  }
  return attributes;
}

/** The attributes a cell may keep: `scope` and `className` are the component's, the rest are the screen's. */
const CELL_ATTRIBUTES = new Set(['scope', 'className']);

/**
 * `cellProps: { 'aria-label': … , dir: "rtl" }` for a column, or `''` when the cell carried nothing extra.
 *
 * A column is declared outside the row, so an attribute that reads the row — `aria-label` naming the row's own
 * currency — becomes a function of the row instead, which is the only scope where that name exists.
 */
function cellPropsEntry(attributes: { name: string; raw: string }[], row: string): string {
  if (attributes.length === 0) return '';
  const readsRow = new RegExp(`\\b${row}\\.`);
  const values = attributes.map(({ name, raw }) => {
    const value = raw.startsWith('{') ? raw.slice(1, -1).trim() : raw;
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`;
    return { key, value };
  });
  const body = values.map(({ key, value }) => `${key}: ${value}`).join(', ');
  return readsRow.test(body) ? `cellProps: (${row}) => ({ ${body} })` : `cellProps: { ${body} }`;
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

interface Mapped {
  /** The list the map iterates, as written. */
  list: string;
  /** The name the map gives one item. */
  parameter: string;
  /** The expression the map returns for one item. */
  rendered: string;
}

/**
 * `{list.map((item) => rendered)}` read as its three parts, or `undefined` when it is another shape.
 *
 * Scanned rather than matched: a pattern that finds `{`…`.map(`…`)` by lazy repetition is super-linear on the
 * long, deeply nested one-line JSX these screens are written in, and one of them is 40 KB on a single line.
 */
function readMapped(source: string): Mapped | undefined {
  const text = source.trim();
  if (!text.startsWith('{') || skipExpression(text, 0) !== text.length) return undefined;
  const inner = text.slice(1, -1);
  const mapAt = inner.indexOf('.map(');
  if (mapAt <= 0) return undefined;
  const list = inner.slice(0, mapAt).trim();
  if (!list) return undefined;
  const arrowAt = inner.indexOf('=>', mapAt);
  if (arrowAt === -1) return undefined;
  // `(item) =>`, `item =>`, `(item: string) =>` name one item; `(item, index) =>` reads a second one, which a
  // column cannot carry, so it is refused here rather than silently dropped from the output
  const signature = inner.slice(mapAt + 5, arrowAt).trim();
  const bare = signature.startsWith('(') && signature.endsWith(')') ? signature.slice(1, -1) : signature;
  const colonAt = bare.indexOf(':');
  const parameter = (colonAt === -1 ? bare : bare.slice(0, colonAt)).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(parameter)) return undefined;
  const closeAt = closingParen(inner, mapAt + 4);
  if (closeAt === -1 || inner.slice(closeAt + 1).trim()) return undefined;
  const rendered = inner.slice(arrowAt + 2, closeAt).trim();
  return rendered ? { list, parameter, rendered } : undefined;
}

/** `<th scope="col" …>text</th>`, where the text holds no tag and no expression. */
const LITERAL_HEAD_CELL = /^<th\b((?:[^>{}]|\{[^{}]*\})*)>([^<>{}]*)<\/th>$/;

function readHead(inner: string): HeadShape | undefined {
  // one `{list.map(param => …)}` around the whole row is how the array and computed shapes are written
  const mapped = readMapped(inner);
  if (mapped) {
    const { list, parameter, rendered } = mapped;
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
      const mappedTail = readMapped(trimmed.slice(at, end));
      if (!mappedTail) return undefined;
      if (trimmed.slice(end).trim()) return undefined;
      const { list, parameter, rendered } = mappedTail;
      const open = openTagAt(rendered, rendered.indexOf('<'));
      const content = rendered.slice(skipOpeningTag(rendered, rendered.indexOf('<')), rendered.lastIndexOf('</th>')).trim();
      const key = attributeOf(open, 'key');
      if (!key) return undefined;
      return { kind: 'virtual', fixed: cells, list, parameter, text: content.replace(/^\{|\}$/g, ''), headTag: open, cellTag: open, key };
    }
    const end = skipElement(trimmed, at, 'th');
    const source = trimmed.slice(at, end);
    if (!onlyAttributes(openTagAt(source, 0), ['scope', 'className'])) return undefined;
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
  /** Attributes the cell carried besides its class — `dir`, `aria-label` — written as they were. */
  extra: { name: string; raw: string }[];
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
    const nested = readMapped(content);
    cells.push({
      tag: tag[1] as 'td' | 'th',
      rowHeader: isHeader,
      rawClass: classSource(open),
      classes: classOf(open),
      content,
      extra: attributesOf(open).filter(attribute => !CELL_ATTRIBUTES.has(attribute.name)),
      nested: nested && !nested.rendered.includes('.map(')
        ? { list: nested.list, parameter: nested.parameter, content: nested.rendered }
        : undefined,
    });
    at = end;
  }
  return cells;
}

/** The names of `['Date', 'Day']`, or `undefined` when the list is not written out. */
function headerNames(list: string): string[] | undefined {
  const text = list.trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
  const names: string[] = [];
  const inner = text.slice(1, -1);
  let at = 0;
  while (at < inner.length) {
    const quote = inner[at];
    if (quote === ',' || /\s/.test(quote)) {
      at++;
      continue;
    }
    if (quote !== "'" && quote !== '"') return undefined; // an identifier, a template, a spread
    const end = inner.indexOf(quote, at + 1);
    if (end === -1) return undefined;
    names.push(inner.slice(at + 1, end));
    at = end + 1;
  }
  return names;
}

/**
 * `cell: (row) => …`, with the row named `_row` when the cell never reads it — an unused argument is a lint
 * warning, and the sweep may not add one. The argument stays, because a column that drops it is the one the
 * component has to infer `over`'s item type from.
 */
function cellArrow(row: string, content: string): string {
  const value = jsxValue(content);
  return new RegExp(`\\b${row}\\b`).test(value) ? `(${row}) => ${value}` : `(_${row}) => ${value}`;
}

/** The `{…}` groups a body is made of, or `undefined` when it is not only those. */
function splitExpressions(source: string): string[] | undefined {
  const chunks: string[] = [];
  let at = 0;
  const text = source.trim();
  while (at < text.length) {
    if (/\s/.test(text[at])) {
      at++;
      continue;
    }
    if (text[at] !== '{') return undefined;
    const end = skipExpression(text, at);
    if (end === at) return undefined;
    chunks.push(text.slice(at, end));
    at = end;
  }
  return chunks;
}

/** The first `target` at nesting depth zero, skipping strings. */
export function topLevelIndexOf(text: string, target: string): number {
  let depth = 0;
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === "'" || char === '"' || char === '`') {
      const end = endOfString(text, at);
      if (end === -1) return -1;
      at = end;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (depth === 0 && text.startsWith(target, at)) return at;
    at++;
  }
  return -1;
}

/** The `:` that closes the ternary opened by the `?` at `from`. */
export function matchingColon(text: string, from: number): number {
  let depth = 0;
  let questions = 0;
  let at = from + 1;
  while (at < text.length) {
    const char = text[at];
    if (char === "'" || char === '"' || char === '`') {
      const end = endOfString(text, at);
      if (end === -1) return -1;
      at = end;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
    else if (depth === 0 && char === '?') questions++;
    else if (depth === 0 && char === ':') {
      if (questions === 0) return at;
      questions--;
    }
    at++;
  }
  return -1;
}

/**
 * `list.length === 0`, with the `&&` or `?` that follows it — the *whole* condition of an empty state. A
 * condition that only contains an emptiness test (`!loading && rows.length === 0`, or `other.length === 0` above
 * a different list) would show the sentence at the wrong time once the component decides when to show it, so it
 * is not an empty state at all.
 */
function isEmptyTestOf(condition: string, list: string): boolean {
  const test = condition
    .trim()
    .replace(/(&&|\?)$/, '')
    .trim()
    .replace(/^\(([\s\S]*)\)$/, '$1')
    .trim();
  const escaped = list.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:${escaped}\\.length\\s*===?\\s*0|!\\s*${escaped}\\.length)$`).test(test);
}

/**
 * `{list.length === 0 ? <tr>…</tr> : list.map(row => <tr>…</tr>)}` — the sentence and the rows as one
 * expression, in either order — read as the map and the row it stands in for.
 */
function readEmptyStateTernary(chunk: string): { map: string; row: string; condition: string } | undefined {
  const text = chunk.slice(1, -1).trim();
  const questionAt = topLevelIndexOf(text, '?');
  if (questionAt === -1) return undefined;
  const colonAt = matchingColon(text, questionAt);
  if (colonAt === -1) return undefined;
  const condition = text.slice(0, questionAt).trim();
  if (!/(\.length\s*===?\s*0|!\s*[A-Za-z_$][\w$.]*\s*\.length)/.test(condition)) return undefined;
  const whenEmpty = text.slice(questionAt + 1, colonAt).trim();
  const whenRows = text.slice(colonAt + 1).trim();
  // `(\n <tr>…</tr>\n)` and `(\n list.map(…)\n)` are the same branches without their wrapper
  const unwrap = (value: string): string => {
    const text = value.trim();
    return text.startsWith('(') && closingParen(text, 0) === text.length - 1 ? text.slice(1, -1).trim() : text;
  };
  for (const [side, other] of [[whenEmpty, whenRows], [whenRows, whenEmpty]] as const) {
    const mapped = unwrap(side);
    if (!readMapped(`{${mapped}}`)) continue;
    const row = unwrap(other);
    if (!/^<tr\b/.test(row)) continue;
    const end = skipElement(row, 0, 'tr');
    if (end === 0 || row.slice(end).trim() !== '') continue;
    return { map: mapped, row: row.slice(0, end), condition };
  }
  return undefined;
}

/**
 * `{list.length === 0 && <tr>…</tr>}` — the sentence a report prints inside its body when it has no rows — as
 * the row itself. A row that appears conditionally for another reason is not an empty state and is refused: the
 * condition has to be about the list being empty.
 */
export function readEmptyStateRow(chunk: string, list: string): string | undefined {
  const text = chunk.slice(1, -1).trim();
  // Find an actual <tr boundary without a regex that can backtrack on long whitespace.
  let tagAt = text.indexOf('<tr');
  while (tagAt !== -1 && /[A-Za-z0-9_]/.test(text[tagAt + 3] ?? '')) {
    tagAt = text.indexOf('<tr', tagAt + 3);
  }
  if (tagAt === -1) return undefined;
  let rowAt = tagAt;
  while (rowAt > 0 && /\s/.test(text[rowAt - 1])) rowAt--;
  if (text[rowAt - 1] === '(') rowAt--;
  if (rowAt <= 0) return undefined;
  const condition = text.slice(0, rowAt).trim();
  const body = text.slice(rowAt).trim().replace(/^\(/, '').trimStart();
  const end = skipElement(body, 0, 'tr');
  if (end === 0) return undefined;
  // `{cond && <tr>…</tr>}`, `{cond ? <tr>…</tr> : null}`, and either of those inside parentheses
  const trailing = body.slice(end).trim().replace(/^\)/, '').trim();
  if (trailing !== '' && trailing !== ': null' && trailing !== ':null') return undefined;
  if (!isEmptyTestOf(condition, list)) return undefined;
  return body.slice(0, end);
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
  const guardedHead = guardedTableColumns(headInner, true);
  const head = readHead(guardedHead?.inner ?? headInner);
  if (!head) return { reason: 'a header row that is not one of the shapes the table can take' };

  // the totals row keeps its own markup and moves into the component's `footer`, which renders it as a `<tfoot>`:
  // a sweep that dropped it would silently delete a sum from a report
  const footAt = table.indexOf('<tfoot');
  const footEnd = footAt === -1 ? -1 : skipElement(table, footAt, 'tfoot');
  const footerInner = footAt === -1
    ? undefined
    : table.slice(skipOpeningTag(table, footAt), footEnd - '</tfoot>'.length).trim();
  if (footAt !== -1 && !footerInner) return { reason: 'an empty footer' };
  const footerClass = footAt === -1 ? '' : classOf(openTagAt(table, footAt)).join(' ');
  const otherParts = table
    .replace(/<caption[\s\S]*?<\/caption>/, '')
    .replace(/<thead[\s\S]*?<\/thead>/, '')
    .replace(/<tbody[\s\S]*?<\/tbody>/, '')
    .replace(/<tfoot[\s\S]*?<\/tfoot>/, '')
    .replace(/<\/?table\b[^>]*>/g, '')
    .trim();
  if (otherParts) return { reason: 'something outside the caption, header and body that a rewrite would drop' };

  const bodyAt = table.indexOf('<tbody');
  if (bodyAt === -1) return { reason: 'no body to take the rows from' };
  const tbodyOpen = openTagAt(table, bodyAt);
  const tbodyEnd = skipElement(table, bodyAt, 'tbody');
  const bodyInner = table.slice(skipOpeningTag(table, bodyAt), tbodyEnd - '</tbody>'.length).trim();
  const chunks = splitExpressions(bodyInner);
  const notOneExpression = { reason: 'a body that is not one expression: an empty-state row beside the rows, or a literal row' };
  if (!chunks || chunks.length === 0) return notOneExpression;
  const maps = chunks.filter(chunk => readMapped(chunk) !== undefined);
  if (maps.length > 1) return { reason: 'a body with more than one map' };
  // `{cond ? <tr>empty</tr> : list.map(…)}` is one expression, not a map: read both halves out of it
  const ternary = maps.length === 0 && chunks.length === 1 ? readEmptyStateTernary(chunks[0]) : undefined;
  if (maps.length === 0 && !ternary) return { reason: 'a body that is not a map' };
  const extra = maps.length > 0 ? chunks.filter(chunk => chunk !== maps[0]) : [];
  if (extra.length > 1) return { reason: 'a body with more than one map' };
  const emptyChunk = ternary ? undefined : extra.length === 1 ? extra[0] : undefined;
  const expression = (ternary ? ternary.map : maps[0].slice(1, -1).trim()).trim();
  const mapAt = expression.indexOf('.map(');
  if (mapAt === -1) return { reason: 'a body that is not a map' };
  const list = expression.slice(0, mapAt).trim();
  // the row a report shows when its list is empty stays a row inside the body: the component renders it in place
  // of the rows, so the table, its head and its columns are still there to say what the sentence is about. The
  // condition has to be *this* list being empty — that is the whole of it, not a part of `!loading && …`
  if (ternary && !isEmptyTestOf(ternary.condition, list)) {
    return { reason: 'an empty state whose condition is not this list being empty' };
  }
  const emptyRow = ternary ? ternary.row : emptyChunk === undefined ? undefined : readEmptyStateRow(emptyChunk, list);
  if (emptyChunk !== undefined && emptyRow === undefined) return notOneExpression;
  // the map's own callback: everything from its `(` to the `)` that closes it, found by balance so a nested
  // `map` inside a cell does not end the body
  const close = closingParen(expression, mapAt + 4);
  if (close === -1) return { reason: 'a body this script could not read as one map' };
  if (expression.slice(close + 1).trim()) return { reason: 'a body with more than one map' };
  const callback = expression.slice(mapAt + 5, close).trim();
  const arrowAt = callback.indexOf('=>');
  if (arrowAt === -1) return { reason: 'a callback that is destructured, or has a body this script would have to rewrite' };
  // `(row) => …`, `row => …` and `(row: Row) => …` name the row; `({ id }) => …` does not, and a callback the
  // script would have to rewrite is hand work
  const signature = callback.slice(0, arrowAt).trim();
  const bare = signature.startsWith('(') && signature.endsWith(')') ? signature.slice(1, -1) : signature;
  const colonAt = bare.indexOf(':');
  const row = (colonAt === -1 ? bare : bare.slice(0, colonAt)).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(row)) {
    return { reason: 'a callback that is destructured, or has a body this script would have to rewrite' };
  }
  const trimmed = callback.slice(arrowAt + 2).trim();
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
  if (!onlyAttributes(trOpen, ['key', 'className'])) {
    return { reason: 'a row attribute a rewrite would drop' };
  }
  const rowClassName = classOf(trOpen).join(' ');

  const rowInner = rendered.slice(skipOpeningTag(rendered, trAt), trEnd - '</tr>'.length);
  const guardedBody = guardedTableColumns(rowInner, false);
  if (guardedHead || guardedBody) {
    if (!guardedHead || !guardedBody || guardedHead.guards.length !== guardedBody.guards.length ||
        guardedHead.guards.some((guard, index) => guard !== guardedBody.guards[index] || guard === row)) {
      return { reason: 'a conditional column whose header and cell do not share a table-level flag' };
    }
  }
  const cells = readCells(guardedBody?.inner ?? rowInner);
  if (!cells) return { reason: 'a cell this script could not read as one column' };
  const rowHeaderAt = cells.findIndex(cell => cell.rowHeader);

  // a class that reads the row (`cn('p-3', m.amountCents < 0 ? …)`) is computed per row: it has to stay inside
  // the cell, because a column-level `className` is evaluated once, outside the row's scope
  const readsRow = new RegExp(`\\b${row}\\.`);
  // and a *header* class that reads the header's own item (`\`${head === 'Amount' ? 'text-right' : 'text-left'}\``)
  // is the same problem one level up: the item exists inside the header's map, not in the column list
  const headClassSource = 'cellTag' in head ? classSource(head.cellTag) ?? '' : '';
  if ('parameter' in head && headClassSource.includes('${') && new RegExp(`\\b${head.parameter}\\b`).test(headClassSource)) {
    return { reason: 'a header class that reads the header item, which a column cannot see' };
  }
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
  if (classSource(trOpen)?.startsWith('{')) return { reason: 'a computed row class this script cannot preserve' };
  if (cells.some((cell, index) => cell.rowHeader && (index !== rowHeaderAt || cell.nested || guardedBody?.guards[index]))) {
    return { reason: 'a row header that is repeated or conditional' };
  }

  const tableClass = classOf(tableOpen).join(' ');
  // the head's class is on the `<thead>` when it is `sticky top-0`, and on the `<tr>` when it is a colour:
  // both move onto the one element `RowTable` classes, the `<thead>`, so neither is dropped
  const headRowClass = [...new Set([...classOf(theadOpen), ...classOf(headRow)])].join(' ');
  const bodyClass = classOf(tbodyOpen).join(' ');

  const entries: string[] = [];
  const entry = (parts: (string | string[] | false | undefined)[], guard?: string) =>
    `${guard ? `${guard} ? ` : ''}{ ${parts.flat().filter(Boolean).join(', ')} }${guard ? ' : false' : ''},`;

  /** `cell: row => …` for a literal cell, from the row's name and the cell's own expression. */
  const cellCallback = (content: string, extra?: string) =>
    extra ? `(${row}) => (${extra}, ${content})` : `(${row}) => ${content}`;
  void cellCallback;

  const fixedHeaders = head.kind === 'literal' ? head.headers : head.kind === 'virtual' ? head.fixed : [];
  // a header cell's own attributes (`aria-label`, `dir`) would have to travel as `headProps`; no converted table
  // needs one, so a table that has one is hand work rather than a header that loses its name
  if (fixedHeaders.some(header => header.raw !== undefined && attributesOf(header.raw).length > 0)) {
    return { reason: 'a header cell with an attribute of its own this script would drop' };
  }
  const nestedCells = cells.filter(cell => cell.nested);
  const literalCells = cells.filter(cell => !cell.nested);
  if (nestedCells.length > 1) return { reason: 'more than one nested map in a row' };
  if (nestedCells.length === 1 && head.kind === 'literal') return { reason: 'a nested map under a header that does not declare it' };
  if (nestedCells.length === 1 && cells.indexOf(nestedCells[0]) !== cells.length - 1) {
    return { reason: 'a nested map that is not the last column' };
  }
  // the columns a header declares: its own cells, or the names it maps over when the header is a literal list.
  // The array shape used to be compared against an empty list, so every one of them was refused
  const arrayNames = head.kind === 'array' ? headerNames(head.list) : undefined;
  if (head.kind === 'array' && arrayNames === undefined) {
    return { reason: 'a header list that is computed, not written out' };
  }
  // the repeated column is one column, and an array header has no other written-out cells to put beside it
  if (head.kind === 'array' && nestedCells.length === 1 && literalCells.length > 0) {
    return { reason: 'an array header whose row mixes written-out cells with a nested map' };
  }
  const declaredColumns = head.kind === 'array'
    ? (nestedCells.length === 1 ? 0 : arrayNames!.length)
    : fixedHeaders.length;
  if (literalCells.length !== declaredColumns) {
    return { reason: 'a row that does not line up with its header' };
  }

  fixedHeaders.forEach((header, index) => {
    const cell = literalCells[index];
    const text = header.content;
    entries.push(entry([
      /[<{]/.test(text) ? `header: ${jsxValue(text)}` : `header: ${literal(text)}`,
      index > 0 && cell.rowHeader && 'rowHeader: true',
      alignEntry(header.classes, cell.classes),
      ...classesOf(header.raw, cell.rawClass, header.classes, cell.classes),
      cellPropsEntry(cell.extra, row),
      `cell: ${cellArrow(row, cell.content)}`,
    ], guardedHead?.guards[index]));
  });

  if (nestedCells.length === 1) {
    if (head.kind === 'literal') return { reason: 'a nested map under a header that does not declare it' };
    const nested = nestedCells[0].nested!;
    // `over` sits in the `columns` array, outside every row callback, so it can only be the list the header
    // itself maps. A body cell that maps `row.months` under a header that maps `months` would convert to
    // `over: row.months`, where `row` is not in scope — and nothing would line the two lists up if they differ.
    if (nested.list.replace(/\s+/g, '') !== (head.list ?? '').replace(/\s+/g, '')) {
      return { reason: 'a nested map over a list the header does not map, so the columns would not line up' };
    }
    const headClasses = classOf(head.cellTag);
    entries.push(entry([
      `over: ${head.list}`,
      `head: (${nested.parameter}) => ${head.kind === 'array' ? nested.parameter : head.text}`,
      alignEntry(headClasses, nestedCells[0].classes),
      ...classesOf(classSource(head.cellTag), nestedCells[0].rawClass, headClasses, nestedCells[0].classes),
      cellPropsEntry(nestedCells[0].extra, row),
      `cell: (${row}, ${nested.parameter}) => ${jsxValue(nested.content)}`,
    ]));
  } else if (head.kind === 'array') {
    // `{['Date', 'Day', 'Holiday'].map(head => <th>{head}</th>)}`: the columns are the literal list itself
    (arrayNames ?? []).forEach((name, index) => {
      const cell = literalCells[index];
      entries.push(entry([
        `header: ${literal(name)}`,
        index > 0 && cell.rowHeader && 'rowHeader: true',
        alignEntry(classOf(head.headTag), cell.classes),
        ...classesOf(classSource(head.headTag), cell.rawClass, classOf(head.headTag), cell.classes),
        cellPropsEntry(cell.extra, row),
        `cell: ${cellArrow(row, cell.content)}`,
      ]));
    });
  } else if (head.kind === 'computed') {
    return { reason: 'a computed column whose cells are written one by one' };
  }

  if (entries.length === 0) return { reason: 'a table with no columns this script could write' };

  const props: string[] = [];
  if (tableKey) props.push(`        key={${tableKey}}`);
  if (rowHeaderAt === -1) props.push('        rowHeaderColumn={false}');
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
  if (emptyRow !== undefined) props.push(`        emptyRow={${jsxValue(emptyRow)}}`);
  if (footerInner !== undefined) props.push(`        footer={${jsxValue(footerInner)}}`);
  if (footerClass) props.push(`        footerClassName=${attr(footerClass)}`);

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
