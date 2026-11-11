import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importEdges } from '../../scripts/import-edges.mjs';

function getAllFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git' && file !== 'tests') {
        getAllFiles(fullPath, fileList);
      }
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

function resolveImportPath(importerPath: string, importSource: string): string | null {
  if (!importSource.startsWith('.')) {
    return null;
  }
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
  // e.g. '../plugins/*.tsx'
  if (!globPattern.startsWith('.')) return [];
  const importerDir = path.dirname(importerPath);
  const globClean = globPattern.replace(/\*\.\w+$/, '');
  const targetDir = path.resolve(importerDir, globClean);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) return [];

  const files = fs.readdirSync(targetDir);
  return files.map(f => path.join(targetDir, f)).filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
}

test('Reachability Guard: True import graph walk from entry points (static + dynamic + globs)', () => {
  const rootDir = process.cwd();
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
    if (bn === 'reachability-guard.test.ts') return false;
    return true;
  });

  const ignoredFiles = [
    'src/vite-env.d.ts', // Vite type declarations
    'vite.config.ts' // Vite bundler configuration file
  ];

  const orphanedFiles: string[] = [];
  for (const file of codeFiles) {
    const relPath = path.relative(rootDir, file);
    if (ignoredFiles.includes(relPath)) continue;
    if (!visited.has(path.resolve(file))) {
      orphanedFiles.push(relPath);
    }
  }

  assert.deepStrictEqual(
    orphanedFiles,
    [],
    `Found ${orphanedFiles.length} orphaned source files not reachable via import graph from entry points:\n` + orphanedFiles.join('\n')
  );
});


