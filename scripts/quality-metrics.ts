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
