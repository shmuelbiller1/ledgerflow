/**
 * The repository's own import graph: every source file under a directory, the file a relative import
 * points at (with the extensions the build resolves), the files a glob import matches, and the set of
 * files reachable from the app's entry points. `scripts/quality-metrics.ts` counts orphans with it and
 * `src/tests/reachability-guard.test.ts` refuses them, so both read the same graph.
 */
import fs from 'fs';
import path from 'path';
import { importEdges } from './import-edges.mjs';

const DEFAULT_SKIP_DIRS = ['node_modules', 'dist', '.git', 'coverage', 'tests'];

/** Every `.ts`/`.tsx`/`.js`/`.jsx` under `dir`, skipping the build and VCS folders. */
export function getAllFiles(dir, fileList = [], skipDirs = DEFAULT_SKIP_DIRS) {
  if (!fs.existsSync(dir)) return fileList;
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!skipDirs.includes(file)) getAllFiles(fullPath, fileList, skipDirs);
    } else if (/\.(ts|tsx|js|jsx)$/.test(file)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/** The file a relative import names, trying the extensions and the index files the build does. */
export function resolveImportPath(importerPath, importSource) {
  if (!importSource.startsWith('.')) return null;
  const resolvedBase = path.resolve(path.dirname(importerPath), importSource);
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
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The files a glob import such as `'../plugins/*.tsx'` matches. */
export function expandGlob(importerPath, globPattern) {
  if (!globPattern.startsWith('.')) return [];
  const globClean = globPattern.replace(/\*\.\w+$/, '');
  const targetDir = path.resolve(path.dirname(importerPath), globClean);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) return [];
  return fs.readdirSync(targetDir)
    .map(f => path.join(targetDir, f))
    .filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
}

/** The app's entry points: the screens' root, the server, the view registry and the hand-run scripts. */
export function entryPoints(rootDir) {
  const scriptsDir = path.resolve(rootDir, 'scripts');
  return [
    path.resolve(rootDir, 'src/main.tsx'),
    path.resolve(rootDir, 'src/App.tsx'),
    path.resolve(rootDir, 'server.ts'),
    path.resolve(rootDir, 'src/config/registry.tsx'),
    ...(fs.existsSync(scriptsDir)
      ? fs.readdirSync(scriptsDir).filter(f => f.endsWith('.ts')).map(f => path.resolve(scriptsDir, f))
      : []),
  ].filter(f => fs.existsSync(f));
}

/** Every file an import walk from the entry points reaches (absolute, resolved paths). */
export function reachableFiles(rootDir) {
  const visited = new Set();
  const queue = entryPoints(rootDir);
  queue.forEach(e => visited.add(path.resolve(e)));

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!fs.existsSync(currentPath)) continue;
    const content = fs.readFileSync(currentPath, 'utf-8');
    for (const source of importEdges(currentPath, content)) {
      if (source.includes('*')) {
        for (const match of expandGlob(currentPath, source)) {
          const resolved = path.resolve(match);
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
  return visited;
}

/** Config and declaration files that are read by the tools rather than imported by the app. */
export const ORPHAN_IGNORED_FILES = ['src/vite-env.d.ts', 'vite.config.ts'];

/**
 * The source files nothing reaches from an entry point, as paths relative to the repository root.
 * `notOrphans` names files the caller's own rule keeps out of the count (the guard test itself).
 */
export function orphanFiles(rootDir, notOrphans = []) {
  const visited = reachableFiles(rootDir);
  const rootFiles = ['server.ts', 'vite.config.ts']
    .map(f => path.resolve(rootDir, f))
    .filter(f => fs.existsSync(f));
  const ignored = new Set([...ORPHAN_IGNORED_FILES, ...notOrphans]);

  return [...getAllFiles(path.resolve(rootDir, 'src')), ...rootFiles]
    .map(f => path.resolve(f))
    .filter(f => {
      const name = path.basename(f);
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx') || name.endsWith('.d.ts')) return false;
      return true;
    })
    .filter(f => !ignored.has(path.relative(rootDir, f)))
    .filter(f => !visited.has(path.resolve(f)))
    .map(f => path.relative(rootDir, f));
}
