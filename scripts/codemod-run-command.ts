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


/**
 * The two shapes this rewrites, and no others.
 *
 * Both were confirmed by reading every site rather than assumed: a GET that sets only an auth header, and
 * the `res` / `res.json().catch(() => ({}))` pair that follows it. A site that matches neither is left
 * exactly as it is and stays in the report — the point of the tool is to do the boring half in one pass and
 * leave the decisions visible.
 */
const GET_ONLY_AUTH =
  /const res = await fetch\((`[^`]*`|'[^']*'), \{ headers: \{ Authorization: `Bearer \$\{await getIdToken\(\)\}` \} \}\);/;

function importLine(file: string): string | null {
  const afterSrc = file.split('/src/')[1];
  if (!afterSrc) return null;
  // minus the file itself: src/a/b/C.tsx is two directories up from src/lib
  const up = afterSrc.split('/').length - 1;
  return `${'../'.repeat(up)}lib/runCommand`;
}

/** Adds or widens the runCommand import. Returns null when the file cannot be handled automatically. */
function withImport(source: string, names: string, file: string): string | null {
  const existing = /import \{ ([^}]+) \} from '((?:\.\.\/)+|\.\/)lib\/runCommand';/.exec(source);
  if (existing) {
    const have = existing[1].split(',').map(x => x.trim());
    const want = names.split(',').map(x => x.trim());
    const missing = want.filter(w => !have.includes(w));
    if (!missing.length) return source;
    return source.replace(existing[0], `import { ${[...have, ...missing].join(', ')} } from '${existing[2]}lib/runCommand';`);
  }
  const specifier = importLine(file);
  if (!specifier) return null;
  // after the last import line, keeping whatever blank line followed it
  const anchor = source.lastIndexOf('\nimport ');
  if (anchor === -1) return null;
  // a multi-line import ends at the line that closes it
  const lines = source.split('\n');
  const startLine = source.slice(0, anchor + 1).split('\n').length - 1;
  let end = startLine;
  while (end < lines.length && !lines[end].trimEnd().endsWith(';')) end++;
  const insertAt = lines.slice(0, end + 1).join('\n').length + 1;
  return source.slice(0, insertAt) + `import { ${names} } from '${specifier}';\n` + source.slice(insertAt);
}

/** The GET that sets only the auth header, followed by how its answer is read. */
export function rewrite(source: string, file: string): { source: string; changed: number } {
  let changed = 0;
  let names = 'runCommand, type CommandBody';

  // (a) the GET, the answer read as JSON, and (usually) one `if (!res.ok …)` line right after it.
  //
  // That line is *kept* and only narrowed: `if (!res.ok || !Array.isArray(body.items)) throw …` is two
  // checks in one, and `runCommand` has already done the first. Dropping the whole line would drop the
  // shape check with it; keeping it whole leaves a test for a `res` that no longer exists.
  let next = source;
  while (true) {
    const match = GET_ONLY_AUTH.exec(next);
    if (!match) break;
    const after = next.slice(match.index + match[0].length);
    const tail = /^\n[ \t]*const (\w+) = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\n([ \t]*if \([^\n]*\) \{\n[^\n]*;\n[ \t]*\}\n|[ \t]*if \([^\n]*\) throw[^\n]*;\n)?/s.exec(after);
    if (!tail) break;
    const [, bodyVar, check] = tail;
    let keptCheck = check ?? '';
    if (keptCheck) {
      const condition = /if \(([\s\S]*?)\) (?:\{|throw)/.exec(keptCheck);
      if (condition && /!\(?res\.ok\)?/.test(condition[1])) {
        // `!res.ok` alone is exactly what runCommand throws for; anything `||`-ed onto it still matters
        const rest = condition[1].replace(/!\(?res\.ok\)?\s*\|\|\s*/, '').trim();
        if (rest === '!res.ok' || rest === '') {
          keptCheck = '';
        } else {
          keptCheck = keptCheck
            .replace(condition[0], condition[0].replace(condition[1], rest))
            .replace(/(body|data|answer)\.message \|\| (body|data|answer)\.error \|\| /, `${bodyVar}.message || ${bodyVar}.error || `);
        }
      }
    }
    // `body.message ||` inside a kept check referred to the variable that still exists, so leave it be
    const replacement =
      `const ${bodyVar} = await runCommand<CommandBody>({ path: ${match[1]} }) ?? {};\n` + keptCheck;
    next = next.slice(0, match.index) + replacement +
      next.slice(match.index + match[0].length + (tail[0]).length);
    changed++;
  }

  // (b) the same GET but the answer is only looked at: `if (!res.ok) return; const data = await res.json();`
  while (true) {
    const match = GET_ONLY_AUTH.exec(next);
    if (!match) break;
    const after = next.slice(match.index + match[0].length);
    const tail = /^\n(\s*)if \(!res\.ok\) return;\n\s*const (\w+) = await res\.json\(\);\n/.exec(after);
    if (!tail) break;
    next = next.slice(0, match.index) +
      `const ${tail[2]} = await runCommand<CommandBody>({ path: ${match[1]} }) ?? {};\n` +
      next.slice(match.index + match[0].length + tail[0].length);
    changed++;
  }


  // (c) the same GET written over three lines, and the answer read as JSON with no `res` afterwards
  while (true) {
    const match = /const res = await fetch\((`[^`]*`|'[^']*'), \{\n\s*headers: \{ Authorization: `Bearer \$\{await getIdToken\(\)\}` \},?\n\s*\}\);/ .exec(next);
    if (!match) break;
    const after = next.slice(match.index + match[0].length);
    const tail = /^\n[ \t]*const (\w+) = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\n/.exec(after);
    if (!tail) break;
    next = next.slice(0, match.index) +
      `const ${tail[1]} = await runCommand<CommandBody>({ path: ${match[1]} }) ?? {};\n` +
      next.slice(match.index + match[0].length + tail[0].length);
    changed++;
  }


  // (d) a write: `method`, the two headers typed by hand, and the body serialised by hand. This is the
  // most common remaining shape. The body expression is carried across untouched — it is the caller's.
  while (true) {
    const match = /const res = await fetch\((`[^`]*`|'[^']*'), \{\n[ \t]*method: '(POST|PUT|PATCH|DELETE)',\n[ \t]*headers: \{ 'Content-Type': 'application\/json', Authorization: `Bearer \$\{await getIdToken\(\)\}` \},\n[ \t]*body: JSON\.stringify\(([\s\S]*?)\),\n[ \t]*\}\);\n/.exec(next);
    if (!match) break;
    // a call that carries an AbortSignal is not this shape; leave it for a person
    if (/\bsignal\b/.test(match[0])) break;
    const after = next.slice(match.index + match[0].length);
    const tail = /^[ \t]*const (\w+) = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\n(?:[ \t]*if \(!res\.ok\) throw[^\n]*;\n)?/.exec(after);
    if (!tail) break;
    const [whole, pathArg, method, body] = match;
    // a body that is never read afterwards needs no binding — and reading it was never the point of the call
    const rest = next.slice(match.index + match[0].length + tail[0].length);
    const usedLater = new RegExp(`\\b${tail[1]}\\b`).test(rest);
    const call = `runCommand<CommandBody>({ path: ${pathArg}, method: '${method}', body: ${body.trim()} })`;
    const replacement = usedLater ? `const ${tail[1]} = await ${call} ?? {};\n` : `await ${call};\n`;
    next = next.slice(0, match.index) + replacement + next.slice(match.index + match[0].length + tail[0].length);
    changed++;
  }


  // (e) the same writes, but with the token spread conditionally instead of typed inline. Same edits.
  while (true) {
    const match = /const res = await fetch\((`[^`]*`|'[^']*'), \{\n[ \t]*method: '(POST|PUT|PATCH|DELETE)',\n[ \t]*headers: \{ 'Content-Type': 'application\/json', \.\.\.\(token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\}\) \},\n[ \t]*body: JSON\.stringify\(([\s\S]*?)\),\n[ \t]*\}\);\n/.exec(next);
    if (!match) break;
    const after = next.slice(match.index + match[0].length);
    const tail = /^[ \t]*const (\w+) = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\n(?:[ \t]*if \(!res\.ok\)[^\n]*\n)?/.exec(after);
    if (!tail) break;
    const [, pathArg, method, body] = match;
    const rest = next.slice(match.index + match[0].length + tail[0].length);
    const usedLater = new RegExp(`\\b${tail[1]}\\b`).test(rest);
    const call = `runCommand<CommandBody>({ path: ${pathArg}, method: '${method}', body: ${body.trim()} })`;
    next = next.slice(0, match.index) +
      (usedLater ? `const ${tail[1]} = await ${call} ?? {};\n` : `await ${call};\n`) +
      next.slice(match.index + match[0].length + tail[0].length);
    changed++;
  }

  // (f) a GET with the conditional token spread and no body
  while (true) {
    const match = /const res = await fetch\((`[^`]*`|'[^']*'), \{\n[ \t]*headers: \{ \.\.\.\(token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\}\) \},\n[ \t]*\}\);\n/.exec(next);
    if (!match) break;
    const after = next.slice(match.index + match[0].length);
    const tail = /^[ \t]*const (\w+) = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\n(?:[ \t]*if \(!res\.ok\)[^\n]*\n)?/.exec(after);
    if (!tail) break;
    const rest = next.slice(match.index + match[0].length + tail[0].length);
    const usedLater = new RegExp(`\\b${tail[1]}\\b`).test(rest);
    const call = `runCommand<CommandBody>({ path: ${match[1]} })`;
    next = next.slice(0, match.index) +
      (usedLater ? `const ${tail[1]} = await ${call} ?? {};\n` : `await ${call};\n`) +
      next.slice(match.index + match[0].length + tail[0].length);
    changed++;
  }

  if (!changed) return { source, changed };

  // A site that still reads `res.ok` further down is not the shape these rules were written for (the
  // status decided something other than "throw"). Reverting the file is the honest answer: the report
  // lists it as needing a hand, and `tsc` would otherwise be the one to notice.
  // (a rewritten site leaves no `const … = await fetch(` behind, so a remaining `res.ok` is a read that
  // was not part of the shape)
  const stillReadsStatus = /\bres\.(ok|status|headers)\b/.test(next);
  if (stillReadsStatus) return { source, changed: 0 };

  const imported = withImport(next, names, file);
  if (!imported) return { source, changed: 0 };
  // the hand-typed call was the only user of getIdToken in most of these files; leaving the import
  // behind compiles fine and quietly suggests the token still matters here
  const withoutToken = imported.split('getIdToken').length === 2
    ? imported
        .replace(/^import \{ getIdToken \} from '[^']+';\n/m, '')
        .replace(/\{ ([^}]*?), getIdToken \}/, '{ $1 }')
        .replace(/\{ getIdToken, ([^}]*?) \}/, '{ $1 }')
    : imported;
  return { source: withoutToken, changed };
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
  if (write) {
    let files = 0;
    let sites = 0;
    for (const file of new Set(candidates.filter(c => !c.blockers.length).map(c => c.file))) {
      const before = fs.readFileSync(file, 'utf8');
      const result = rewrite(before, file);
      if (!result.changed) continue;
      fs.writeFileSync(file, result.source);
      files++;
      sites += result.changed;
    }
    console.log(`\n--write: ${sites} call(s) in ${files} file(s). Run \`tsc\` — every site it did not match is still there.`);
  }
}
