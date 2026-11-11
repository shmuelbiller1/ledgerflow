/**
 * Agent #7 probe A7-01 (review-only; changes nothing).
 *
 * Question: `ledger-door-baseline.json` says `"server-direct-ledger-write": 0`, i.e. no server code writes a
 * `transactions` record outside `src/server/services/ledgerDoor.ts`. Is that true?
 *
 * The shipped scanner (`scripts/bug-patterns.ts`, AU-6) only matches a write whose call text itself contains
 * `collection('transactions')` (`db.collection('transactions').doc(id).set(...)`). It cannot see the shape this code
 * base actually uses:
 *     const txRef = db.collection('transactions').doc(id);
 *     t.set(txRef, entry);            //  or  txRef.set(entry) / t.create(refs[i], entry)
 *
 * This probe follows that one extra step with the TypeScript binder (scope-correct, no name guessing): every
 * identifier whose declaration is initialised from `…collection('transactions')….doc(…)` is a ledger reference; every
 * set/update/create call that writes through one, outside the ledger door, is reported, with what guards it:
 *   validator  = what is written is the entry TransactionValidator.validateAndPrepare returned (schema, accounts,
 *                balance, closed period, home-currency settlement), in a function that calls it
 *   partial    = the generic partial update (PUT /transactions/:id { partialUpdate }): lines, amounts and dates are
 *                refused, but status, type and metadata may change (see probe A7-04)
 *   mark-only  = an update whose object literal only carries LEDGER_MARK_FIELDS (what ledgerMark would allow)
 *   UNGUARDED  = none of these: the entry is written as built, with no shared check
 *
 * Run:  npx tsx audit/agent7-2026-11-11/probes/a7-01-ledger-door-dataflow.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { scanFinancialIntegrity } from '../../../scripts/bug-patterns';
import { LEDGER_MARK_FIELDS } from '../../../src/server/services/ledgerDoor';

const root = process.cwd();
const TX_DOC = /collection\(\s*['"]transactions['"]\s*\)[\s\S]*\.doc\(/;
const WRITE = new Set(['set', 'update', 'create']);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const serverFiles = files(path.join(root, 'src/server'));
const program = ts.createProgram(serverFiles, { noResolve: true, noLib: true, allowJs: false, skipLibCheck: true, target: ts.ScriptTarget.Latest });
const checker = program.getTypeChecker();

interface Hit { file: string; line: number; via: string; guard: string; call: string }
const hits: Hit[] = [];

const isLedgerRef = (e: ts.Expression): string => {
  let x: ts.Expression = e;
  while (ts.isElementAccessExpression(x) || ts.isNonNullExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
  if (!ts.isIdentifier(x)) return '';
  const decl = checker.getSymbolAtLocation(x)?.declarations?.[0];
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return '';
  const text = decl.initializer.getText();
  // a reference (or an array of references) to entries; a query result is a read
  return TX_DOC.test(text) && !/\.get\(\s*\)|\.getAll\(/.test(text) ? x.text : '';
};

const enclosingFunction = (n: ts.Node): ts.Node => {
  let x: ts.Node | undefined = n.parent;
  let outermost: ts.Node = n.getSourceFile();
  while (x) {
    if (ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x)) return x;
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) outermost = x; // keep climbing: handlers nest callbacks
    x = x.parent;
  }
  return outermost;
};

for (const sf of program.getSourceFiles()) {
  const rel = path.relative(root, sf.fileName).split(path.sep).join('/');
  if (!rel.startsWith('src/server/') || rel.endsWith('/services/ledgerDoor.ts')) continue;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && WRITE.has(n.expression.name.text)) {
      const kind = n.expression.name.text;
      const direct = isLedgerRef(n.expression.expression);                       // txRef.set(entry)
      const viaArg = n.arguments[0] ? isLedgerRef(n.arguments[0]) : '';          // t.set(txRef, entry)
      const via = direct || viaArg;
      if (via) {
        const payload = direct ? n.arguments[0] : n.arguments[1];
        const fn = enclosingFunction(n);
        const payloadText = payload ? payload.getText(sf) : '';
        const validated = /TransactionValidator\s*\.\s*validateAndPrepare\s*\(/.test(fn.getText(sf))
          && /validated\w*|txToSave|\.\.\.tx\b/.test(payloadText);
        const partial = /safePartial/.test(payloadText);
        const markOnly = kind === 'update' && payload && ts.isObjectLiteralExpression(payload)
          && payload.properties.every(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
            ? LEDGER_MARK_FIELDS.has(p.name.getText(sf)) : false);
        hits.push({ file: rel, line: lineOf(n), via, guard: markOnly ? 'mark-only' : partial ? 'partial' : validated ? 'validator' : 'UNGUARDED', call: n.getText(sf).split('\n')[0].slice(0, 96) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const shipped = scanFinancialIntegrity().filter(f => f.kind === 'server-direct-ledger-write');
const by = (g: string) => hits.filter(h => h.guard === g).length;
console.log(`shipped scanner (scripts/bug-patterns.ts, AU-6): ${shipped.length} direct ledger writes  (ledger-door-baseline.json: ${JSON.parse(fs.readFileSync('ledger-door-baseline.json', 'utf8'))['server-direct-ledger-write']})`);
console.log(`this probe (one step of data flow):              ${hits.length} direct ledger writes in ${new Set(hits.map(h => h.file)).size} files`);
console.log(`  written as validated: ${by('validator')}   generic partial update: ${by('partial')}   mark-only updates: ${by('mark-only')}   UNGUARDED: ${by('UNGUARDED')}`);
for (const h of hits.sort((a, b) => a.guard.localeCompare(b.guard) || a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`  [${h.guard.padEnd(9)}] ${h.file}:${h.line}  via ${h.via}  ${h.call}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Second table (used by A7-07): does each file that writes ledger entries mention a closed-period check at all?
// File level only: a mention does not prove that every path is checked (the dynamic sweep, probe a7-07, does that for
// 14 writers). A file with NONE writes entries with no closed-period check anywhere in it.
const LOCK = /\b(assertPostingOpen|postingLock|assertStillOpen|requireOpenPeriod|assertPeriodOpen|validateAndPrepare)\b/g;
const rows: Array<{ file: string; door: number; direct: number; locks: string }> = [];
for (const sf of program.getSourceFiles()) {
  const rel = path.relative(root, sf.fileName).split(path.sep).join('/');
  if (!rel.startsWith('src/server/') || rel.endsWith('/services/ledgerDoor.ts')) continue;
  const text = sf.getFullText();
  const door = (text.match(/\bledger(Write|Create|Mark)\s*\(/g) || []).length;
  const direct = hits.filter(h => h.file === rel).length;
  if (door + direct === 0) continue;
  const counts = new Map<string, number>();
  for (const m of text.matchAll(LOCK)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  rows.push({ file: rel, door, direct, locks: [...counts].map(([k, v]) => `${k}×${v}`).join(' ') });
}
const none = rows.filter(r => !r.locks);
console.log(`\nfiles under src/server that write ledger entries: ${rows.length}; with no closed-period check mentioned anywhere in the file: ${none.length}`);
for (const r of rows.sort((a, b) => Number(Boolean(a.locks)) - Number(Boolean(b.locks)) || a.file.localeCompare(b.file))) {
  console.log(`  ${r.locks ? 'mentions a check' : 'NONE            '}  ${r.file}  (through the door ${r.door}, direct ${r.direct})${r.locks ? `  ${r.locks}` : ''}`);
}
