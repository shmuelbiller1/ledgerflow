/**
 * Bug-pattern scanner (owner, 13 Oct: "make a test that finds all bugs like that").
 *
 * Public issues #96–#111 come from six repeated mistakes. This reads every client file's syntax
 * tree and lists each place one of them can happen. `src/tests/bug-patterns.test.ts` keeps the
 * count from rising (a ratchet in `bug-patterns-baseline.json`) and checks the scanner still
 * finds the places named in the issues. Run `npx tsx scripts/bug-patterns.ts` for the list.
 *
 *  swallowing-action   an async action catches its error and resolves normally, so a caller
 *                      cannot tell failure from success (#105, #108, #110, #111)
 *  success-after-call  a success message right after awaiting a swallowing action (#105, #97)
 *  unchecked-write     a write request (POST/PUT/PATCH/DELETE) whose response is never checked
 *  write-in-loop       a write awaited inside a loop: half the rows can save (#98, #106, #109)
 *  stale-async         state set after an await with no "is this still the same request /
 *                      workspace?" check (#99, #100, #102, #107)
 *  silent-catch        a catch that drops the error (empty, or only logs to the console)
 *  effect-before-write  a file download, print, e-mail or window opens before the write it
 *                      describes is confirmed (#109: bank file exported before payments saved)
 */
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

export type Kind = 'swallowing-action' | 'success-after-call' | 'unchecked-write' | 'write-in-loop' | 'stale-async' | 'silent-catch' | 'effect-before-write';
export interface Finding { kind: Kind; file: string; line: number; name: string; }

const ROOTS = ['src/components', 'src/hooks', 'src/stores', 'src/services', 'src/core'];
const WRITE_METHOD = /^(POST|PUT|PATCH|DELETE)$/;
const WRITE_NAME = /^(post|put|patch|del|apiPost|apiPut|apiDelete|handle[A-Z]\w*|add[A-Z]\w*|update[A-Z]\w*|save[A-Z]\w*|delete[A-Z]\w*|remove[A-Z]\w*|post[A-Z]\w*|create[A-Z]\w*|upsert\w*|bulk[A-Z]\w*|record[A-Z]\w*|import[A-Z]\w*|approve\w*|markAs\w*)$/;
const GUARD = /cancel|abort|aborted|alive|mounted|stale|ignore|isCurrent|current(Request|Id|Workspace)|requestId|generation|latest|signal|seq\b|token\s*!==|workspaceId\s*!==|!==\s*workspaceId|stillSame|scoped/i;
const SUCCESS = /toast\.success\(|setSuccess\w*\(|toast\.info\(|onSuccess\??\.?\(|onSaved\??\.?\(/;

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);

function fnName(fn: ts.Node): string {
  const p = fn.parent;
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return p.name.getText();
  if (ts.isMethodDeclaration(fn)) return fn.name.getText();
  return '(anonymous)';
}

function calleeName(call: ts.CallExpression): string {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}

/** fetch / fetchWithAuth / apiFetch with a write method in its options. */
function isWriteRequest(call: ts.CallExpression): boolean {
  const name = calleeName(call);
  if (!/^(fetch|fetchWithAuth|apiFetch|authFetch|serverFetch)$/.test(name)) return false;
  const opts = call.arguments[1];
  if (!opts || !ts.isObjectLiteralExpression(opts)) return false;
  return opts.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText() === 'method'
    && ts.isStringLiteralLike(p.initializer) && WRITE_METHOD.test(p.initializer.text));
}

const inLoop = (n: ts.Node, stop: ts.Node): boolean => {
  for (let p = n.parent; p && p !== stop; p = p.parent) {
    if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return true;
    if (ts.isCallExpression(p) && /^(forEach|map)$/.test(calleeName(p)) && p.arguments.some(a => isFn(a) && a.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))) return true;
  }
  return false;
};

const nearestFn = (n: ts.Node): ts.Node | undefined => { let p = n.parent; while (p && !isFn(p)) p = p.parent; return p; };

export function scan(root = process.cwd()): Finding[] {
  const out: Finding[] = [];
  const all = ROOTS.flatMap(r => files(path.join(root, r)));
  const sources = all.map(f => ({ f, sf: ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true) }));
  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');
  const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // pass 1: actions that swallow their errors
  const swallowing = new Set<string>();
  for (const { f, sf } of sources) {
    const visit = (n: ts.Node) => {
      if (isFn(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) && n.body && ts.isBlock(n.body)) {
        const name = fnName(n);
        if (WRITE_NAME.test(name)) {
          let catches = 0, rethrows = 0, returnsResult = false;
          const walk = (m: ts.Node) => {
            if (m !== n && isFn(m)) return;
            if (ts.isCatchClause(m)) { catches++; if (/\bthrow\b/.test(m.block.getText(sf))) rethrows++; }
            if (ts.isReturnStatement(m) && m.expression && !/^(undefined|null)$/.test(m.expression.getText(sf))) returnsResult = true;
            ts.forEachChild(m, walk);
          };
          walk(n.body);
          const safeAsyncSwallow = /safeAsync\(/.test(n.body.getText(sf)) && !/\bthrow\b/.test(n.body.getText(sf));
          if (((catches > 0 && rethrows < catches) || safeAsyncSwallow) && !returnsResult) {
            swallowing.add(name);
            out.push({ kind: 'swallowing-action', file: rel(f), line: lineOf(sf, n), name });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // pass 2: call sites and the other patterns
  for (const { f, sf } of sources) {
    const visit = (n: ts.Node) => {
      if (ts.isAwaitExpression(n) && ts.isCallExpression(n.expression)) {
        const call = n.expression;
        const name = calleeName(call);
        const fn = nearestFn(n);
        // success shown after awaiting an action that cannot report failure
        if (swallowing.has(name) && fn) {
          const after = fn.getText(sf).slice(n.getEnd() - fn.getStart(sf));
          const stmtEnd = after.indexOf('\n}') === -1 ? after.length : after.indexOf('\n}');
          if (SUCCESS.test(after.slice(0, Math.min(stmtEnd, 600)))) out.push({ kind: 'success-after-call', file: rel(f), line: lineOf(sf, n), name });
        }
        // writes inside loops
        if (fn && (isWriteRequest(call) || (WRITE_NAME.test(name) && !/^(handleSubmit|handleChange|handleClick)$/.test(name))) && inLoop(n, fn)) {
          out.push({ kind: 'write-in-loop', file: rel(f), line: lineOf(sf, n), name: name || 'fetch' });
        }
        // write request whose response is dropped
        if (isWriteRequest(call) && ts.isExpressionStatement(n.parent)) {
          out.push({ kind: 'unchecked-write', file: rel(f), line: lineOf(sf, n), name });
        }
      }
      if (isFn(n) && n.body && ts.isBlock(n.body) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        // state set after an await, with no staleness guard anywhere in the function
        const text = n.body.getText(sf);
        const firstAwait = text.indexOf('await ');
        if (firstAwait >= 0) {
          const after = text.slice(firstAwait);
          const setsState = /\bset[A-Z]\w*\(|useLedgerStore\.setState\(|\.setState\(/.test(after);
          const loads = /\b(fetch|fetchWithAuth|getDocs|getDoc|\.get\(\)|loadCollection|load[A-Z]\w*|parse\w*|extract\w*|ai\w*)\(/.test(after);
          if (setsState && loads && !GUARD.test(text) && !SUCCESS.test(after.slice(0, 0))) {
            out.push({ kind: 'stale-async', file: rel(f), line: lineOf(sf, n), name: fnName(n) });
          }
        }
      }
      if (isFn(n) && n.body && ts.isBlock(n.body) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
        // something irreversible leaves the app before the write it depends on is confirmed
        const text = n.body.getText(sf);
        const effect = text.search(/\b(download[A-Z]\w*|downloadCsv|downloadFile|window\.print|window\.open|navigator\.clipboard\.writeText|sendEmail\w*)\(/);
        const write = text.search(/await\s+(\w+\.)?(record[A-Z]\w*|post[A-Z]?\w*|save[A-Z]\w*|create[A-Z]\w*|update[A-Z]\w*|handle[A-Z]\w*|fetch\w*)\(/);
        if (effect >= 0 && write > effect) out.push({ kind: 'effect-before-write', file: rel(f), line: lineOf(sf, n), name: fnName(n) });
      }
      if (ts.isCatchClause(n)) {
        const stmts = n.block.statements;
        const silent = stmts.length === 0 || stmts.every(s => /^console\.(log|warn|error|debug)\(/.test(s.getText(sf).trim()));
        if (silent && !/intentional|ignore|best[- ]effort|optional|non-?critical/i.test(n.getFullText(sf))) {
          out.push({ kind: 'silent-catch', file: rel(f), line: lineOf(sf, n), name: fnName(nearestFn(n) || n) });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
}

export function counts(found: Finding[]): Record<Kind, number> {
  const c = { 'swallowing-action': 0, 'success-after-call': 0, 'unchecked-write': 0, 'write-in-loop': 0, 'stale-async': 0, 'silent-catch': 0, 'effect-before-write': 0 } as Record<Kind, number>;
  for (const x of found) c[x.kind]++;
  return c;
}

/** Financial/server scanner. These are *risk paths*, not proof that any running DB was corrupted.
 * The browser is not the only trust boundary: privileged server writes can bypass client RLS.
 * Findings carry stable identities so CI can block new categories without letting counts cancel.
 */
export interface FinancialFinding { kind: string; file: string; line: number; name: string; issue?: number; }

export function scanFinancialIntegrity(root = process.cwd()): FinancialFinding[] {
  const findings: FinancialFinding[] = [];
  const serverFiles = files(path.join(root, 'src/server'));
  for (const file of serverFiles) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const relative = path.relative(root, file).split(path.sep).join('/');
    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        // Whole-record financial patches require the same validators as the singular edit.
        if (name === 'update' && n.arguments.some(a => /\.\.\.updateData\b/.test(a.getText(sf)))
          && /transactions\/(bulkRoutes|crudRoutes)\.ts$/.test(relative)) {
          findings.push({ kind: 'server-unrestricted-ledger-patch', file: relative, line: line(n), name: 'batch.update', issue: 112 });
        }
        // A commit in a loop makes the request partially durable when a later chunk fails.
        if (name === 'commit' && inLoop(n, sf)) {
          findings.push({ kind: 'server-partial-batch-commit', file: relative, line: line(n), name: 'batch.commit', issue: /transactions\/bulkRoutes/.test(relative) ? 113 : undefined });
        }
        // Payment creation that bypasses the idempotent path remains a backwards-compatible risk.
        if (name === 'createPaymentAtomic' && relative.endsWith('/paymentRoutes.ts')) {
          findings.push({ kind: 'server-unkeyed-payment-path', file: relative, line: line(n), name: 'createPaymentAtomic', issue: 114 });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // The database's trusted-server exemption is intentional; flag it for review so every caller
  // must provide equivalent server validation. This is NOT itself a database security flaw.
  const migrationRoot = path.join(root, 'supabase/migrations');
  if (fs.existsSync(migrationRoot)) {
    for (const name of fs.readdirSync(migrationRoot).filter(n => n.endsWith('.sql'))) {
      const full = path.join(migrationRoot, name);
      const sql = fs.readFileSync(full, 'utf8');
      const match = /if\s+not\s+public\.lf_is_client\(\)\s+then\s+return/gi;
      let m: RegExpExecArray | null;
      while ((m = match.exec(sql))) {
        findings.push({ kind: 'sql-trusted-server-exemption', file: path.relative(root, full).split(path.sep).join('/'),
          line: sql.slice(0, m.index).split('\n').length, name: 'lf_guard' });
      }
    }
  }
  return findings.sort((a,b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && /bug-patterns\.ts$/.test(process.argv[1])) {
  const found = scan();
  const write = process.argv.includes('--write-baseline');
  if (write) fs.writeFileSync('bug-patterns-baseline.json', JSON.stringify(counts(found), null, 2) + '\n');
  const md = ['# Bug patterns (generated by scripts/bug-patterns.ts)', '', '| Pattern | Count |', '|---|---:|',
    ...Object.entries(counts(found)).map(([k, v]) => `| ${k} | ${v} |`), '',
    ...found.map(x => `- [ ] \`${x.kind}\` ${x.file}:${x.line} — ${x.name}`)].join('\n');
  fs.writeFileSync('docs/BUG_PATTERNS.md', md + '\n');
  const financial = scanFinancialIntegrity();
  fs.appendFileSync('docs/BUG_PATTERNS.md', [
    '', '## Server and database integrity review (not confirmed incidents)', '',
    ...financial.map(f => `- [ ] \`${f.kind}\` ${f.file}:${f.line} — ${f.name}${f.issue ? ` (#${f.issue})` : ''}`),
    '',
  ].join('\n'));
  console.log({ client: counts(found), serverAndSql: financial.length });
}
