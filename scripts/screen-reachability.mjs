#!/usr/bin/env node
/**
 * Screen reachability check (AI #2, 21 Oct 2026).
 *
 * `src/lib/workspaceExports.ts` is a waiting room: a library re-exported there is code that exists but
 * may not be reachable by a user. This script answers one question honestly — does every module in
 * that waiting room resolve to a file that the app can actually load?
 *
 * Method: walk real import edges (`import`/`export … from`, dynamic `import()`, `import.meta.glob`)
 * from the entry points the app boots from, then check whether each re-export target is in that
 * reachable set. File-name grep is not used: a module mentioned in a comment is not reachable.
 *
 * Usage:  node scripts/screen-reachability.mjs [--verbose]
 * Exit:   0 when every module is reachable, 1 when any is not (prints the unreachable ones).
 */
import fs from 'node:fs';
import path from 'node:path';
import { importEdges } from './import-edges.mjs';

const root = process.cwd();
const verbose = process.argv.includes('--verbose');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vercel', 'archive']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function resolveImport(importer, source) {
  if (!source.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importer), source);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Build the import graph for every source file. */
function buildGraph() {
  const files = walk(path.join(root, 'src')).concat([path.join(root, 'server.ts')].filter(f => fs.existsSync(f)));
  const graph = new Map();
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const deps = new Set();
    for (const source of importEdges(file, code)) {
      if (source.includes('*')) {
        // import.meta.glob('../plugins/*.tsx') (or a directory glob): every file in that directory
        const dir = path.resolve(path.dirname(file), source.replace(/\/\*.*$/, ''));
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          for (const name of fs.readdirSync(dir)) deps.add(path.join(dir, name));
        }
        continue;
      }
      const resolved = resolveImport(file, source);
      if (resolved) deps.add(resolved);
    }
    graph.set(file, deps);
  }
  return { files, graph };
}

/** Everything the app can load, starting from the real entry points. */
function reachableFrom(entryPoints, graph) {
  const seen = new Set(entryPoints.map(entry => path.resolve(entry)).filter(entry => fs.existsSync(entry)));
  const queue = [...seen];
  while (queue.length) {
    const file = queue.pop();
    for (const dep of graph.get(file) || []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

const { graph } = buildGraph();
const entryPoints = [
  'src/main.tsx',
  'src/App.tsx',
  'server.ts',
  'src/config/registry.tsx',
  ...(fs.existsSync('scripts') ? fs.readdirSync('scripts').filter(f => f.endsWith('.ts')).map(f => `scripts/${f}`) : []),
].map(entry => path.join(root, entry));
const reachable = reachableFrom(entryPoints, graph);

const exportsFile = path.join(root, 'src/lib/workspaceExports.ts');
const modules = [...fs.readFileSync(exportsFile, 'utf8').matchAll(/from\s+'(\.\/[^']+)'/g)]
  .map(match => path.resolve(path.dirname(exportsFile), match[1]))
  .map(base => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()))
  .filter(Boolean);

const unique = [...new Map(modules.map(file => [path.relative(root, file), file])).entries()];
const unreachable = unique.filter(([, file]) => !reachable.has(file));

console.log(`waiting room: ${unique.length} modules`);
console.log(`reachable from a screen: ${unique.length - unreachable.length}`);
if (verbose) for (const [name] of unique) console.log(`  ${unreachable.some(([, f]) => path.relative(root, f) === name) ? 'NOT REACHABLE' : 'reachable    '} ${name}`);

if (unreachable.length) {
  console.log(`\nNot reachable (${unreachable.length}):`);
  for (const [name] of unreachable) console.log(`  ${name}`);
  process.exit(1);
}
console.log('every module in the waiting room reaches a screen');
