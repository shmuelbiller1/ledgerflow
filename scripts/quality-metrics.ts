import fs from 'fs';
import path from 'path';
import { importEdges } from './import-edges.mjs';

export interface QualityMetrics {
  anyCount: number;
  utcDateCount: number;
  arrayIndexKeys: number;
  blankNoOpener: number;
  consoleLog: number;
  serverTsLines: number;
  filesOver800: number;
  orphanFiles: number;
  /** eslint-disable, @ts-ignore and @ts-expect-error in non-test source (the real ESLint warning count is the --max-warnings ceiling in package.json) */
  suppressionCount: number;
  untestedViews: number;
  /** full-screen overlays (`fixed inset-0`) not marked as a dialog (useDialog / role="dialog") or hidden */
  overlaysWithoutDialog: number;
  /**
   * Prompt 2 ("Rebuild the way screens are made"), the counters that may only go down:
   *  - screen files that draw a table by hand instead of using the shared list;
   *  - hand-typed server addresses in the screens;
   *  - direct database writes from the browser;
   *  - actions and reports nothing can reach from the search box;
   *  - screens with more than one filled button (EASE_OF_USE U-2).
   */
  rawTables: number;
  handTypedApiCalls: number;
  directDbWrites: number;
  unreachableActions: number;
  screensWithManyPrimaryButtons: number;
}

function computeOrphanFiles(rootDir: string): number {
  function getAllFiles(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'coverage', 'tests'].includes(file)) {
          getAllFiles(fullPath, fileList);
        }
      } else {
        if (/\.(ts|tsx|js|jsx)$/.test(file)) {
          fileList.push(fullPath);
        }
      }
    }
    return fileList;
  }

  function resolveImportPath(importerPath: string, importSource: string): string | null {
    if (!importSource.startsWith('.')) return null;
    const importerDir = path.dirname(importerPath);
    const resolvedBase = path.resolve(importerDir, importSource);
    const candidates = [
      resolvedBase,
      `${resolvedBase}.ts`,
      `${resolvedBase}.tsx`,
      `${resolvedBase}.js`,
      `${resolvedBase}.jsx`,
      path.join(resolvedBase, 'index.ts'),
      path.join(resolvedBase, 'index.tsx')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    return null;
  }

  function expandGlob(importerPath: string, globPattern: string): string[] {
    if (!globPattern.startsWith('.')) return [];
    const importerDir = path.dirname(importerPath);
    const globClean = globPattern.replace(/\*\.\w+$/, '');
    const targetDir = path.resolve(importerDir, globClean);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) return [];
    return fs.readdirSync(targetDir)
      .map(f => path.join(targetDir, f))
      .filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
  }

  const entryPoints = [
    path.resolve(rootDir, 'src/main.tsx'),
    path.resolve(rootDir, 'src/App.tsx'),
    path.resolve(rootDir, 'server.ts'),
    path.resolve(rootDir, 'src/config/registry.tsx'),
    // scripts run by hand (npx tsx scripts/<name>.ts) are entry points too
    ...(fs.existsSync(path.resolve(rootDir, 'scripts'))
      ? fs.readdirSync(path.resolve(rootDir, 'scripts')).filter(f => f.endsWith('.ts')).map(f => path.resolve(rootDir, 'scripts', f))
      : []),
  ].filter(f => fs.existsSync(f));

  const visited = new Set<string>();
  const queue = [...entryPoints];
  queue.forEach(e => visited.add(path.resolve(e)));

  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    if (!fs.existsSync(currentPath)) continue;

    const content = fs.readFileSync(currentPath, 'utf-8');
    for (const source of importEdges(currentPath, content)) {
      if (source.includes('*')) {
        const globMatches = expandGlob(currentPath, source);
        for (const gm of globMatches) {
          const resolved = path.resolve(gm);
          if (!visited.has(resolved)) {
            visited.add(resolved);
            queue.push(resolved);
          }
        }
      } else {
        const resolved = resolveImportPath(currentPath, source);
        if (resolved && !visited.has(resolved)) {
          visited.add(resolved);
          queue.push(resolved);
        }
      }
    }
  }

  const allSrcFiles = getAllFiles(path.resolve(rootDir, 'src'));
  const rootFiles = ['server.ts', 'vite.config.ts'].map(f => path.resolve(rootDir, f)).filter(f => fs.existsSync(f));
  const codeFiles = [...allSrcFiles, ...rootFiles].map(f => path.resolve(f)).filter(f => {
    const bn = path.basename(f);
    if (bn.endsWith('.test.ts') || bn.endsWith('.test.tsx') || bn.endsWith('.d.ts')) return false;
    return true;
  });

  const ignoredFiles = new Set([
    'src/vite-env.d.ts',
    'vite.config.ts'
  ]);

  let orphans = 0;
  for (const file of codeFiles) {
    const relPath = path.relative(rootDir, file);
    if (ignoredFiles.has(relPath)) continue;
    if (!visited.has(path.resolve(file))) {
      orphans++;
    }
  }
  return orphans;
}

/** Files under `src/components` that are screens (not tests, not the shared list itself). */
function componentFiles(rootDir: string, dir = path.join(rootDir, 'src/components')): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') out.push(...componentFiles(rootDir, full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') && !entry.name.endsWith('.d.ts')) {
      // `.ts` as well as `.tsx`: a store or hook that sits beside its screen makes calls too, and
      // reading only `.tsx` left those seven sites uncounted for the whole life of this ratchet.
      out.push(full);
    }
  }
  return out;
}

/**
 * A table drawn by hand: `<table` in a screen file. The shared list (`TanStackDataGrid.tsx`) is the one
 * place a table is allowed to be built, so it is left out of the count.
 */
function computeRawTables(rootDir: string): number {
  const sharedList = path.join(rootDir, 'src/components/ui/TanStackDataGrid.tsx');
  return componentFiles(rootDir)
    .filter(file => path.resolve(file) !== path.resolve(sharedList))
    .filter(file => /<table\b/.test(fs.readFileSync(file, 'utf8')))
    .length;
}

/**
 * `fetch('/api/…')` typed into a screen: the address should come from one place, not twenty. A call is
 * counted once per `fetch(` whose address starts with the API path, whichever quote style it uses.
 *
 * Two things are deliberately not counted, because neither is a screen calling the server:
 *  - **documentation.** `ApiHubView`'s code samples are template strings inside `<pre>` — a `fetch(` that
 *    the reader copies into their own program. Counting them made the ratchet reward deleting the docs.
 *  - **the one place itself.** `src/lib/runCommand.ts` is where the address is meant to live; the files
 *    that have moved onto it keep no `fetch(` at all, so this only matters as it grows.
 */

/**
 * A hand-typed call is a `fetch` that this app makes to its own API and for which the screen reads a
 * token itself. `runCommand` is the one place that does both.
 *
 * This used to count one thing: `fetch(...)` followed by a literal `/api/` path, inside
 * `src/components`. Both limits hid real calls. A wrapper takes its address as a parameter —
 * `fetch(path, ...)` — so a screen behind a wrapper counted as zero no matter how it was written;
 * and `src/hooks` and `src/services` were never read at all, though 56 of these calls live there.
 * A screen could be converted, or left alone, with the number unmoved either way.
 *
 * The signature that actually distinguishes the two is the token. `runCommand` reads it once; a
 * hand-typed call reads it at the call site. So the count is now `fetch` sites that read a token,
 * across everything that talks to the API.
 */
const NOT_A_SCREEN_CALL = [/^src\/lib\/runCommand\.ts$/, /^src\/components\/platform\/ApiHub(CoreDocs|AnalysisDocs)\.tsx$/];
const API_CALLER_FILES = (rootDir: string) => [
  ...componentFiles(rootDir),
  ...sourceFiles(path.join(rootDir, 'src/services')),
  ...sourceFiles(path.join(rootDir, 'src/hooks')),
];

/** Every non-test `.ts`/`.tsx` under a directory, so a service or hook is not missed. */
function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function computeHandTypedApiCalls(rootDir: string): number {
  let count = 0;
  for (const file of API_CALLER_FILES(rootDir)) {
    const relative = path.relative(rootDir, file).replace(/\\/g, '/');
    if (NOT_A_SCREEN_CALL.some(pattern => pattern.test(relative))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (let i = text.indexOf('fetch('); i !== -1; i = text.indexOf('fetch(', i + 1)) {
      if (sendsOwnToken(text, i)) count++;
    }
  }
  return count;
}

/**
 * Does the `fetch(` at `at` send this app's credential?
 *
 * The token is read either inline (`Bearer ${await getIdToken()}`) or a few lines above into a local
 * and interpolated here — `const token = await getIdToken(); ... fetch(path, { ... Bearer ${token} })`.
 * Both are the same hand-typed call, and a regex over one line only ever saw the first, so the second
 * shape was invisible: the wrapper conversions that remove these calls could not move the number.
 */
function sendsOwnToken(text: string, at: number): boolean {
  // the whole call, so a nested `getIdToken()` in the options is inside the slice
  let depth = 0;
  let end = at;
  for (let j = at + 5; j < text.length; j++) {
    const ch = text[j];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) { end = j + 1; break; }
    }
  }
  const call = text.slice(at, end || text.length);
  // inline, whichever object the token comes from: `getIdToken()`, `user.getIdToken()`,
  // `auth.currentUser?.getIdToken()` all read the caller's credential at the call site
  if (/getIdToken\(\)/.test(call)) return true;
  if (!/Bearer \$\{\s*([\w.?]+)\s*\}/.test(call)) return false;
  const name = /Bearer \$\{\s*([\w.?]+)\s*\}/.exec(call)![1];
  // the token was fetched just above and handed in by name — `await getIdToken()` or
  // `await user.getIdToken()`, which ~20 sites use and the first version of this missed
  const above = text.slice(Math.max(0, at - 600), at);
  const tokenFetched = new RegExp(`(?:const|let|var)\\s+${name.replace(/\./g, '\\.')}\\s*=\\s*await\\s+[\\w.?]*getIdToken\\(\\)`).test(above);
  // `auth.currentUser?.getIdToken()` names the same helper through the auth object
  if (tokenFetched) return true;
  const chained = new RegExp(`(?:const|let|var)\\s+${name.replace(/\./g, '\\.')}\\s*=\\s*await\\s+[\\w.?]*currentUser[.?]+getIdToken\\(\\)`).test(above);
  return chained;
}

/** Writes to the database from the browser: screens call the server, they do not post the books. */
function computeDirectDbWrites(rootDir: string): number {
  const dirs = ['src/components', 'src/hooks', 'src/stores'].map(d => path.join(rootDir, d));
  // The modular Firestore API is called bare (`await updateDoc(ref, …)`), and one call can be written
  // with a leading dot. The pattern must not capture, or `match.length` would count a group, not a call.
  const writes = /\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/g;
  let count = 0;
  const scan = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') scan(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
        const text = fs.readFileSync(full, 'utf8');
        count += [...text.matchAll(writes)].length;
      }
    }
  };
  dirs.forEach(scan);
  return count;
}

/**
 * Registered screens, reports and settings tabs that the search box cannot reach. Zero is the only
 * acceptable number: a screen nothing can open is a feature nobody has.
 */
function computeUnreachableActions(rootDir: string): number {
  const registryPath = path.join(rootDir, 'src/config/registry.tsx');
  const index = fs.readFileSync(path.join(rootDir, 'src/config/pageIndex.ts'), 'utf8');
  if (!fs.existsSync(registryPath)) return 0;
  const registry = fs.readFileSync(registryPath, 'utf8');
  // the index builds itself from the registry (screens, extras, reports, settings), so the honest check
  // lives in src/tests/palette-reachability-guard.test.ts; here we count only a registry that stopped
  // feeding it, which is the shape a regression takes.
  const feedsIndex = ['APP_TABS', 'REPORT_TABS_REGISTRY', 'SCREEN_TABS_REGISTRY', 'SETTINGS_TABS_REGISTRY']
    .filter(name => !index.includes(name));
  void registry;
  return feedsIndex.length;
}

/**
 * Screens that break EASE_OF_USE U-2: more than one filled (primary) button on one screen.
 *
 * Three things are deliberately *not* counted, because each one made the number look worse than the
 * screens were, and a ratchet nobody can satisfy is one people stop watching:
 *
 * - a **selected chip**: a filled class inside `cond ? "…" : "…"`. That is a state, not a button.
 * - an **icon tile**: a filled `<div>` holding an icon. Nothing is pressed.
 * - a screen whose filled buttons are **one per step** of a wizard: the steps are mutually exclusive,
 *   so no reader ever sees two.
 *
 * The counting works on whole elements rather than on lines. An earlier version asked that `<button`
 * appear on the same line as the `className`, and this codebase writes most elements across several
 * lines — so it silently found almost nothing and reported a comfortable zero.
 */
function computeScreensWithManyPrimaryButtons(rootDir: string): number {
  /**
   * A filled button, not a tint. `bg-indigo-600/[0.03]` on a selected row is a wash behind content —
   * `\b` matched it because `/` is not a word character, so a list row counted as a primary action.
   * An opacity modifier of 40% or more is still a fill; anything fainter is a background.
   */
  const filled = /(?:\bbtn-primary\b|\bbg-\[var\(--gold\)\]|\bbg-indigo-600\b(?!\/(?:\[[0-9.]+\]|[1-3]?[0-9]\b)|\/40|\/50))/;
  return componentFiles(rootDir).filter(file => {
    const text = fs.readFileSync(file, 'utf8');
    const perStep = new Map<string, number>();
    let step = '';
    for (const tag of openingButtonTags(text)) {
      const stepHere = [...text.slice(0, tag.index).matchAll(/\{\s*step\s*===\s*([^&]+?)\s*&&\s*\(/g)].at(-1);
      if (stepHere) step = stepHere[1].trim();
      if (!filled.test(tag.attributes)) continue;
      // a class that is one arm of a ternary is a selected state, not an action. Test only the
      // className value, not every attribute: `disabled={a ? b : c}` is not a selected state.
      if (/[?:]\s*["']/.test(classNameValue(tag.attributes) ?? '')) continue;
      perStep.set(step, (perStep.get(step) ?? 0) + 1);
    }
    // A filled button outside every step is on screen at the same time as the current step's button,
    // so it counts against each step rather than living in a group of its own. Grouping it under `''`
    // let a wizard show two filled buttons and still total one per group.
    const shared = perStep.get('') ?? 0;
    if (shared > 1) return true;
    return [...perStep.entries()].some(([key, n]) => key !== '' && n + shared > 1);
  }).length;
}

/** The value of the className attribute in a tag's attribute text, or null when there is none. */
function classNameValue(attributes: string): string | null {
  const match = /className\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{[^}]*\})/.exec(attributes);
  return match ? match[1] : null;
}

/**
 * Every opening `<button>`, `<AsyncButton>` and `<a>` with its full attribute text.
 *
 * A regular expression over `[^>]*` stops at the `>` inside `onClick={() => …}`, which is in most of
 * this codebase's buttons — so it found almost none of them. This walks the tag by hand, tracking
 * quotes, braces and comments, and only ends the tag at a `>` that is outside all three.
 */
function openingButtonTags(text: string): Array<{ index: number; attributes: string }> {
  const tags: Array<{ index: number; attributes: string }> = [];
  const opener = /<(button|AsyncButton|a)\b/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text))) {
    let i = match.index + match[0].length;
    let braces = 0;
    let quote: string | null = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { braces++; continue; }
      if (c === '}') { braces--; continue; }
      if (c === '>' && braces === 0) break;
    }
    tags.push({ index: match.index, attributes: text.slice(match.index, i + 1) });
  }
  return tags;
}

export function computeQualityMetrics(rootDir: string = process.cwd()): QualityMetrics {
  let anyCount = 0;
  let utcDateCount = 0;
  let arrayIndexKeys = 0;
  let blankNoOpener = 0;
  let consoleLog = 0;
  let overlaysWithoutDialog = 0;
  let serverTsLines = 0;
  let filesOver800 = 0;

  function scanFile(fullPath: string) {
    if (!fs.existsSync(fullPath)) return;
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    if (lines.length > 800) {
      filesOver800++;
    }

    if (path.basename(fullPath) === 'server.ts') {
      serverTsLines = lines.length;
    }

    lines.forEach((line, n) => {
      if (/:\s*any\b/.test(line) || /as\s+any\b/.test(line)) {
        anyCount++;
      }
      if (/\bgetUTC(Date|Month|FullYear|Hours|Minutes|Seconds|Day)\b|\bDate\.UTC\b|\btoUTCString\b/.test(line)) {
        utcDateCount++;
      }
      if (/key=\{[^}]*\bindex\b[^}]*\}/.test(line) || /key=\{i\}/.test(line) || /key=\{idx\}/.test(line)) {
        arrayIndexKeys++;
      }
      // the tag's attributes can span lines: look up to the end of the tag
      if (/target="_blank"/.test(line) && !/rel="[^"]*noopener[^"]*"/.test(tagText(lines, n))) {
        blankNoOpener++;
      }
      if (/console\.log\(/.test(line)) {
        consoleLog++;
      }
      if (/\.tsx$/.test(fullPath) && /className="fixed inset-0[ "]/.test(line) && /<(div|motion\.div)\b/.test(line)) {
        const tag = tagText(lines, n);
        if (!/role="dialog"|role="alertdialog"|[dD]ialogProps\}|aria-hidden/.test(tag)) overlaysWithoutDialog++;
      }
    });
  }

  /** From line n to the line that closes the tag (">"), at most 10 lines. */
  function tagText(lines: string[], n: number): string {
    let text = '';
    for (let k = n; k < Math.min(lines.length, n + 10); k++) {
      text += lines[k] + '\n';
      if (/>/.test(lines[k])) break;
    }
    return text;
  }

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'coverage', 'tests'].includes(entry.name)) {
          scanDir(fullPath);
        }
      } else if (
        entry.isFile() &&
        /\.(ts|tsx|js|jsx)$/.test(entry.name) &&
        !entry.name.includes('.test.') &&
        !entry.name.endsWith('.d.ts')
      ) {
        scanFile(fullPath);
      }
    }
  }

  scanDir(path.join(rootDir, 'src'));
  if (fs.existsSync(path.join(rootDir, 'server.ts'))) {
    scanFile(path.join(rootDir, 'server.ts'));
  }
  if (fs.existsSync(path.join(rootDir, 'vite.config.ts'))) {
    scanFile(path.join(rootDir, 'vite.config.ts'));
  }

  const orphanFiles = computeOrphanFiles(rootDir);
  const untestedViews = computeUntestedViews(rootDir);
  const suppressionCount = computeSuppressionCount(rootDir);

  return {
    anyCount,
    utcDateCount,
    arrayIndexKeys,
    blankNoOpener,
    consoleLog,
    serverTsLines,
    filesOver800,
    orphanFiles,
    suppressionCount,
    untestedViews,
    overlaysWithoutDialog,
    rawTables: computeRawTables(rootDir),
    handTypedApiCalls: computeHandTypedApiCalls(rootDir),
    directDbWrites: computeDirectDbWrites(rootDir),
    unreachableActions: computeUnreachableActions(rootDir),
    screensWithManyPrimaryButtons: computeScreensWithManyPrimaryButtons(rootDir),
  };
}

function computeUntestedViews(rootDir: string): number {
  const registryPath = path.resolve(rootDir, 'src/config/registry.tsx');
  if (!fs.existsSync(registryPath)) return 0;
  const content = fs.readFileSync(registryPath, 'utf8');
  const viewKeys = new Set<string>();
  const matchView = /'([^']+)':\s*lazy\(/g;
  let m: RegExpExecArray | null;
  while ((m = matchView.exec(content)) !== null) {
    viewKeys.add(m[1]);
  }
  
  const testDir = path.resolve(rootDir, 'e2e');
  let testContent = '';
  if (fs.existsSync(testDir)) {
    for (const f of fs.readdirSync(testDir)) {
      if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        testContent += fs.readFileSync(path.join(testDir, f), 'utf8') + '\n';
      }
    }
  }

  let untested = 0;
  for (const k of viewKeys) {
    if (!testContent.includes(`'${k}'`) && !testContent.includes(`"${k}"`)) {
      untested++;
    }
  }
  return untested;
}

function computeSuppressionCount(rootDir: string): number {
  let count = 0;
  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'coverage', 'tests'].includes(entry.name)) {
          scan(full);
        }
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.includes('.test.') && !entry.name.endsWith('.d.ts')) {
        const text = fs.readFileSync(full, 'utf8');
        const matches = text.match(/eslint-disable|@ts-ignore|@ts-expect-error/g);
        if (matches) count += matches.length;
      }
    }
  }
  scan(path.join(rootDir, 'src'));
  if (fs.existsSync(path.join(rootDir, 'server.ts'))) {
    const text = fs.readFileSync(path.join(rootDir, 'server.ts'), 'utf8');
    const matches = text.match(/eslint-disable|@ts-ignore|@ts-expect-error/g);
    if (matches) count += matches.length;
  }
  return count;
}
