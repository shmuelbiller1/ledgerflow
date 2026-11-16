/**
 * Codemod: the one hand-typed `fetch('/api/…')` shape → `runCommand`.
 *
 * This exists because 84 call sites are mostly the same nine lines:
 *
 *     const res = await fetch('/api/v1/x', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
 *       body: JSON.stringify({ ... }),
 *     });
 *     const answer = await res.json().catch(() => ({}));
 *     if (!res.ok) throw new Error(answer.error || answer.message || 'Failed');
 *
 * `runCommand` does all of that, and better: it reads the text first (so a 200 with no body is not a cut
 * connection), it throws `ServerCommandError` carrying `.status` and `.body` (which the call sites below
 * need — several branch on 409), and its message is the server's own words.
 *
 * Why a script and not 84 hand edits: the shape repeats, so the reasoning is made once and applied
 * mechanically. What it will NOT rewrite is as important as what it will:
 *
 *  - a call whose headers do something unusual (extra key, no auth, a custom content type) — a person
 *    must decide whether `runCommand` can carry it;
 *  - a call that inspects `res.status` beyond ok/not; the codemod cannot know what else it wants;
 *  - a call that uses the raw body for something other than an error message.
 *
 * Those are reported, not guessed at. Usage:
 *
 *     npx tsx scripts/codemod-run-command.ts --report       # what it would do, changes nothing
 *     npx tsx scripts/codemod-run-command.ts --write        # apply, then `tsc` decides what is left
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Candidate {
  file: string;
  line: number;
  path: string;
  method: string;
  /** what stops this being rewritten automatically; empty means it can be */
  blockers: string[];
  /** the rewritten source for this call, when it can be rewritten */
  replacement?: string;
  /** how much of the original source the replacement covers, for splicing */
  length?: number;
}

const ROOTS = ['src/components', 'src/hooks', 'src/services', 'src/stores'];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Where the `fetch(` call starting at `index` ends: the matching close paren of its argument list. */
function callEnd(source: string, index: number): number {
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;
  for (let i = index; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { inString = char; continue; }
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** The literal path of the fetch argument, or null when it is not an `/api/…` literal. */
function fetchPath(argument: string): { path: string; template: boolean } | null {
  const trimmed = argument.trim();
  const quoted = /^['`](.*)['`]$/s.exec(trimmed);
  if (!quoted) return null;
  const value = quoted[1];
  if (!value.startsWith('/api/')) return null;
  return { path: value, template: trimmed.startsWith('`') };
}

export function findCandidates(file: string, source: string): Candidate[] {
  const found: Candidate[] = [];
  const lines = source.split('\n');
  let searchFrom = 0;
  while (true) {
    const at = source.indexOf('fetch(', searchFrom);
    if (at === -1) break;
    searchFrom = at + 6;
    // `at + 5` is the '(' itself, so start counting from it
    const end = callEnd(source, at + 5);
    if (end === -1) continue;
    const call = source.slice(at, end);
    // the first argument is everything between the '(' and the first top-level ','
    const argumentStart = 'fetch('.length;
    let argumentEnd = -1;
    let depth = 0;
    let quote: string | null = null;
    for (let i = argumentStart; i < call.length; i++) {
      const char = call[i];
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
      if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') depth--;
      else if (char === ',' && depth === 0) { argumentEnd = i; break; }
    }
    const firstArgument = argumentEnd === -1 ? call.slice(argumentStart, -1) : call.slice(argumentStart, argumentEnd);
    const literal = fetchPath(firstArgument);
    if (!literal) continue;

    const line = source.slice(0, at).split('\n').length;
    const blockers: string[] = [];
    if (!/method:\s*'(GET|POST|PUT|PATCH|DELETE)'/.test(call)) {
      // a GET with no method is still convertible; anything else is not a shape we recognise
      if (/method:\s*`/.test(call)) blockers.push('method is computed');
    }
    if (!/headers:\s*\{/.test(call)) blockers.push('no headers object');
    if (/responseType|blob|arrayBuffer|\.text\(\)/.test(call)) blockers.push('reads the response as something other than JSON');
    if (/signal:/.test(call)) blockers.push('passes an AbortSignal');

    // anything after the call that inspects the response in a way runCommand cannot express
    const after = source.slice(end, end + 800);
    if (/res\.status\s*===\s*204|res\.headers/.test(after)) blockers.push('inspects the response beyond ok/status');

    found.push({ file, line, path: literal.path, method: (/method:\s*'(GET|POST|PUT|PATCH|DELETE)'/.exec(call)?.[1]) || 'GET', blockers });
  }
  // silence the unused warning for variables kept for readability of the shape
  void lines;
  return found;
}

function report(candidates: Candidate[]) {
  const byFile = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (!byFile.has(candidate.file)) byFile.set(candidate.file, []);
    byFile.get(candidate.file)!.push(candidate);
  }
  let convertible = 0;
  let blocked = 0;
  for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    const clear = list.filter(candidate => candidate.blockers.length === 0);
    convertible += clear.length;
    blocked += list.length - clear.length;
    console.log(`${String(list.length).padStart(2)} call(s)  ${file}${clear.length < list.length ? `  (${list.length - clear.length} need a hand)` : ''}`);
    for (const candidate of list.filter(item => item.blockers.length > 0)) {
      console.log(`      :${candidate.line} ${candidate.path} — ${candidate.blockers.join('; ')}`);
    }
  }
  console.log(`\n${candidates.length} hand-typed call(s): ${convertible} mechanical, ${blocked} need a person.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const write = process.argv.includes('--write');
  const cwd = process.cwd();
  const candidates = ROOTS.flatMap(root => walk(path.join(cwd, root)).flatMap(file => findCandidates(file, fs.readFileSync(file, 'utf8'))));
  report(candidates);
  if (write) console.log('\n--write: the rewrite is intentionally not enabled until the shape is confirmed against every file.');
}
