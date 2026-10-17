#!/usr/bin/env node
/** Offline code intelligence: committed Git blobs are the input, JSONL is the canonical store.
 * No production modules are imported/executed. See docs/CODE_ATLAS.md for limits and review rules.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isBuiltin } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const SCHEMA = 1;
const SELF = fileURLToPath(import.meta.url);
const DEFAULT_INDEX = 'docs/CODE_ATLAS.jsonl';
const ARTIFACTS = new Set([DEFAULT_INDEX, 'docs/CODE_ATLAS_VALIDATION.md']);
const CODE = /\.(?:[cm]?[jt]sx?|sql|sh|css|html)$/;
const JS = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /(?:^|\/)(?:tests?|e2e)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAX_BUFFER = 128 * 1024 * 1024;
const git = (root, args, input) => execFileSync('git', ['-C', root, ...args], { input, maxBuffer: MAX_BUFFER });
const txt = (root, args) => git(root, args).toString('utf8').trim();
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const unique = xs => [...new Set(xs)];
const slash = x => x.split(path.sep).join('/');
const compact = (s, max = 260) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);
const literal = n => n && ts.isStringLiteralLike(n) ? n.text : null;
const relative = (root, p) => slash(path.relative(root, p));
export const revision = (root, rev) => txt(root, ['rev-parse', '--verify', `${rev}^{commit}`]);

export function inventory(root, rev) {
  return git(root, ['ls-tree', '-r', '-z', '--full-tree', revision(root, rev)]).toString('utf8').split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'), header = row.slice(0, tab), file = row.slice(tab + 1);
    const [mode, objectType, blobSha] = header.split(' ');
    return { path: file, mode, objectType, blobSha };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function readIndex(file) {
  if (!fs.existsSync(file)) return { meta: null, files: [], workflows: [] };
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((s, i) => {
    try { return JSON.parse(s); } catch { throw new Error(`Invalid JSONL at line ${i + 1}`); }
  });
  return { meta: rows.find(x => x.record === 'meta') || null, files: rows.filter(x => x.record === 'file'), workflows: rows.filter(x => x.record === 'workflow') };
}
function writeIndex(file, meta, files, workflows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const target = `${file}.tmp`;
  fs.writeFileSync(target, [...[meta], ...files, ...workflows].map(x => JSON.stringify(x)).join('\n') + '\n');
  fs.renameSync(target, file);
}
function category(file, binary) {
  if (binary) return file.startsWith('e2e/') ? 'binary-test-asset' : 'binary-asset';
  if (file.startsWith('archive/')) return 'archive';
  if (/fixtures?\//.test(file)) return 'fixture';
  if (TEST.test(file)) return 'test';
  if (file.startsWith('supabase/migrations/')) return 'migration';
  if (file.startsWith('src/server/')) return 'server';
  if (file.startsWith('scripts/') || file.startsWith('.husky/')) return 'script';
  if (file.startsWith('src/')) return 'application';
  if (/\.md$/.test(file)) return 'documentation';
  if (file.startsWith('.github/')) return 'automation';
  if (file.startsWith('public/')) return 'asset';
  if (file.startsWith('sdk/') || file.startsWith('api/') || file === 'server.ts') return 'server-or-client-entry';
  return 'configuration-or-support';
}
function sqlFacts(text) {
  // Deliberately not a SQL parser. Preserve dynamic declarations as unknowns; never claim deployed schema.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, m => ' '.repeat(m.length));
  const result = { method: 'textual-sql-evidence-not-deployed-schema', tables: [], functions: [], policies: [], dynamic: [] };
  const scan = (regex, kind, into) => {
    for (const m of clean.matchAll(regex)) into.push({ kind, name: m[1].replace(/"/g, ''), line: clean.slice(0, m.index).split('\n').length, excerpt: compact(m[0]) });
  };
  scan(/\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table)\s+((?:public\.)?(?:"[^"]+"|[a-zA-Z_][\w]*))/gi, 'table-ddl', result.tables);
  scan(/\bcreate\s+(?:or\s+replace\s+)?function\s+((?:public\.)?(?:"[^"]+"|[a-zA-Z_][\w]*))/gi, 'function-ddl', result.functions);
  scan(/\bcreate\s+policy\s+([^\s]+)[\s\S]*?\bon\s+(?:public\.)?(?:"[^"]+"|[a-zA-Z_][\w]*)/gi, 'policy-ddl', result.policies);
  for (const m of clean.matchAll(/\b(all_tables)\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]/gi)) {
    for (const table of m[2].matchAll(/'([^']+)'/g)) result.tables.push({ kind: 'dynamic-template-array-candidate', name: table[1], line: clean.slice(0, m.index).split('\n').length, excerpt: 'all_tables array; inspect FOREACH/format DDL before assuming creation' });
  }
  for (const m of clean.matchAll(/\bexecute\s+format\s*\(/gi)) result.dynamic.push({ kind: 'runtime-formatted-sql', line: clean.slice(0, m.index).split('\n').length, status: 'unknown-until-SQL-reviewed' });
  return result;
}
export function extract(file, buffer) {
  const binary = buffer.includes(0);
  const text = binary ? '' : buffer.toString('utf8');
  const f = { binary, bytes: buffer.length, lines: binary ? null : text.split('\n').length, category: category(file, binary), isCode: CODE.test(file), modules: [], symbols: [], calls: [], routes: [], api: [], data: [], registrations: [], errors: [], safeguards: [], tests: [], comments: [], parseErrors: [], headings: [] };
  if (binary) return f;
  if (ARTIFACTS.has(file)) { f.category = 'generated-atlas-artifact'; f.contentInspection = 'inventory/blob metadata only; deliberately not recursively indexed'; return f; }
  if (file.endsWith('.sql')) { f.sql = sqlFacts(text); return f; }
  if (!JS.test(file)) {
    f.headings = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map(m => m[1]);
    f.supportEvidence = text.split('\n').map((s, i) => ({ line: i + 1, text: compact(s, 240) })).filter(x => x.text).slice(0, 4);
    return f;
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const short = n => n ? compact(n.getText(sf)) : '';
  const evidence = n => ({ line: line(n), excerpt: short(n) });
  const exported = n => Boolean(n.modifiers?.some(x => x.kind === ts.SyntaxKind.ExportKeyword));
  const enclosing = n => {
    for (let p = n.parent; p; p = p.parent) if (ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return p.name ? short(p.name) : '(anonymous)';
    return '(module)';
  };
  const moduleEdge = (n, specifier, kind, bindings = []) => f.modules.push({ ...evidence(n), specifier, expression: specifier === null ? short(n.arguments?.[0] || n.moduleSpecifier || n) : undefined, kind, bindings });
  const vars = new Map();
  const seedVars = n => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) vars.set(n.name.text, n.initializer); ts.forEachChild(n, seedVars); };
  seedVars(sf);
  function dataOrigin(expr, seen = new Set()) {
    if (!expr) return null;
    if (ts.isIdentifier(expr) && vars.has(expr.text) && !seen.has(expr.text)) return dataOrigin(vars.get(expr.text), new Set([...seen, expr.text]));
    if (ts.isPropertyAccessExpression(expr)) return dataOrigin(expr.expression, seen);
    if (ts.isCallExpression(expr)) {
      const name = short(expr.expression);
      if (name === 'collection' || name.endsWith('.collection') || name === 'doc' || (name.endsWith('.from') && /client|supabase|firestore|\bdb\b/i.test(name))) {
        const idx = name === 'collection' || name === 'doc' ? 1 : 0;
        return { table: literal(expr.arguments[idx]), expression: short(expr.arguments[idx]), sourceLine: line(expr) };
      }
      if (ts.isPropertyAccessExpression(expr.expression)) return dataOrigin(expr.expression.expression, seen);
    }
    return null;
  }
  function walk(n) {
    if (ts.isImportDeclaration(n)) {
      const b = [], c = n.importClause;
      if (c?.name) b.push({ local: c.name.text, imported: 'default' });
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) b.push({ local: c.namedBindings.name.text, imported: '*' });
        else for (const e of c.namedBindings.elements) b.push({ local: e.name.text, imported: (e.propertyName || e.name).text });
      }
      moduleEdge(n, literal(n.moduleSpecifier), c?.isTypeOnly ? 'type-import' : 'import', b);
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier) moduleEdge(n, literal(n.moduleSpecifier), n.isTypeOnly ? 'type-export' : 're-export', n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map(e => ({ local: e.name.text, imported: (e.propertyName || e.name).text })) : []);
    const fn = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ? n : ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? n.initializer : null);
    if (fn || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEnumDeclaration(n) || (ts.isVariableStatement(n) && exported(n))) {
      const names = ts.isVariableStatement(n) ? n.declarationList.declarations.map(d => short(d.name)) : [n.name ? short(n.name) : '(anonymous)'];
      for (const name of names) {
        const row = { name, kind: ts.SyntaxKind[n.kind], line: line(n), endLine: sf.getLineAndCharacterOfPosition(n.end).line + 1, exported: exported(n), default: Boolean(n.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)), signature: fn ? `${name}(${fn.parameters.map(short).join(', ')})${fn.type ? ': ' + short(fn.type) : ''}` : name };
        if (ts.isInterfaceDeclaration(n) || ts.isClassDeclaration(n)) row.members = n.members.map(m => ({ name: m.name ? short(m.name) : '(signature)', type: m.type ? short(m.type) : null, line: line(m) }));
        f.symbols.push(row);
      }
    }
    if (ts.isThrowStatement(n)) f.errors.push({ ...evidence(n), kind: 'throw', owner: enclosing(n) });
    if (ts.isCatchClause(n)) f.errors.push({ ...evidence(n), kind: 'catch', owner: enclosing(n), behavior: 'source excerpt only; rethrow/side effects require review' });
    if (ts.isIfStatement(n) && (/throw|return|status\(|refus|forbid|invalid|lock|workspace|role|authoriz|safeInteger|pending/i.test(n.thenStatement.getText(sf) + n.expression.getText(sf)))) f.safeguards.push({ line: line(n), condition: short(n.expression), consequence: short(n.thenStatement), owner: enclosing(n), certainty: 'syntactic-guard-not-enforcement-proof' });
    if (ts.isCallExpression(n)) {
      const name = short(n.expression), args = n.arguments.map(short);
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') moduleEdge(n, literal(n.arguments[0]), n.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require');
      if (name === 'import.meta.glob') {
        const arg = n.arguments[0], patterns = arg && ts.isArrayLiteralExpression(arg) ? arg.elements.map(literal) : [literal(arg)];
        f.modules.push({ ...evidence(n), kind: 'glob', specifier: null, patterns, expression: short(arg), bindings: [] });
      }
      if (/^(?:test|it|describe)(?:\.|$)/.test(name) && literal(n.arguments[0]) !== null) f.tests.push({ ...evidence(n), title: literal(n.arguments[0]), kind: name });
      if (/\.(get|post|put|patch|delete|use|all|head|options)$/.test(name)) {
        const receiver = name.slice(0, name.lastIndexOf('.'));
        if (/router|^app$|Router$/.test(receiver)) f.routes.push({ ...evidence(n), receiver, method: name.split('.').at(-1), path: literal(n.arguments[0]), pathExpression: args[0] || null, handlers: args.slice(literal(n.arguments[0]) === null ? 0 : 1).map(x => compact(x, 180)), scope: 'local-router-only; combine mount/auth separately' });
      }
      if (name === 'fetch' || name === 'safeFetch' || /^(?:axios|apiClient|client)\.(?:get|post|put|patch|delete)$/.test(name)) f.api.push({ ...evidence(n), call: name, url: literal(n.arguments[0]), urlExpression: args[0] || null, resolution: literal(n.arguments[0]) === null ? 'runtime-computed-unknown' : 'literal-callsite', owner: enclosing(n) });
      if (/^(?:collection|doc|useLedgerCollections)$/.test(name) || (/\.collection$/.test(name) || (/\.from$/.test(name) && /client|supabase|firestore|\bdb\b/i.test(name)))) {
        const data = name === 'useLedgerCollections' ? null : dataOrigin(n);
        f.data.push({ ...evidence(n), kind: name === 'useLedgerCollections' ? 'cache-demand' : 'collection-reference', call: name, ...data, args, certainty: data?.table ? 'literal-reference-not-access-proof' : 'runtime-or-cache-reference' });
      }
      if (name === 'rpc' || name.endsWith('.rpc')) f.data.push({ ...evidence(n), kind: 'rpc-call', name: literal(n.arguments[name === 'rpc' ? 1 : 0]), expression: args[name === 'rpc' ? 1 : 0] || null, certainty: 'callsite-only' });
      if (/^(?:setDoc|updateDoc|deleteDoc|addDoc|getDoc|getDocs|onSnapshot)$/.test(name) || /\.(?:get|set|create|update|delete|commit|runTransaction)$/.test(name)) {
        const origin = dataOrigin(name.includes('.') && ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : n.arguments[0]);
        if (origin || /^(?:setDoc|updateDoc|deleteDoc|addDoc|getDoc|getDocs|onSnapshot)$/.test(name) || /\.(?:commit|runTransaction)$/.test(name)) f.data.push({ ...evidence(n), kind: 'data-operation-candidate', call: name, table: origin?.table || null, originExpression: origin?.expression || args[0] || null, owner: enclosing(n), certainty: 'syntactic-candidate; aliases and transaction callbacks may be unknown' });
      }
      // Resolve imported bindings separately from the syntax; this is not whole-program call analysis.
      if (/^[\w$]+(?:\.[\w$]+)*$/.test(name)) f.calls.push({ name, line: line(n), owner: enclosing(n) });
    }
    if (ts.isPropertyAssignment(n)) {
      const container = enclosing(n), name = short(n.name);
      if (/REGISTRY|VIEW_COMPONENTS|FINANCIAL_ALGORITHMS/.test(container) || name === 'componentName') f.registrations.push({ ...evidence(n), container, key: name, expression: short(n.initializer), literal: literal(n.initializer), status: 'syntactic-registration; reachability/operation-unverified' });
    }
    ts.forEachChild(n, walk);
  }
  walk(sf);
  f.parseErrors = sf.parseDiagnostics.map(d => ({ message: ts.flattenDiagnosticMessageText(d.messageText, ' '), offset: d.start }));
  const ranges = ts.getLeadingCommentRanges(text, 0) || [];
  f.comments = ranges.map(r => compact(text.slice(r.pos, r.end), 700));
  // Calls that cannot be associated with imports/declarations are deliberately not invented edges.
  return f;
}
function globRegex(pattern) {
  if (/[\[\]{}!]/.test(pattern)) return null;
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.slice(i, i + 3) === '**/') { out += '(?:.*/)?'; i += 2; }
    else if (pattern.slice(i, i + 2) === '**') { out += '.*'; i++; }
    else if (pattern[i] === '*') out += '[^/]*';
    else if (pattern[i] === '?') out += '[^/]';
    else out += pattern[i].replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(out + '$');
}

function compilerOptions(snapshot) {
  const configPath = path.join(snapshot, 'tsconfig.json');
  if (!fs.existsSync(configPath)) return { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true };
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, ' '));
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, snapshot).options;
}
function resolveModules(files, snapshot, options) {
  const byPath = new Map(files.map(f => [f.path, f]));
  const cache = ts.createModuleResolutionCache(snapshot, x => x, options);
  for (const f of files) {
    f.dependencies = [];
    f.unknownRelationships = [];
    for (const raw of f.mechanical.modules) {
      if (raw.kind === 'glob') {
        const targets = [];
        for (const p of raw.patterns) {
          const pattern = p && slash(path.posix.normalize(path.posix.join(path.posix.dirname(f.path), p)));
          const regex = pattern && globRegex(pattern);
          if (!regex) f.unknownRelationships.push({ kind: 'glob', line: raw.line, expression: raw.expression, reason: 'computed-or-unsupported-glob' });
          else targets.push(...files.filter(x => regex.test(x.path)).map(x => x.path));
        }
        f.dependencies.push({ ...raw, resolution: raw.patterns.every(p => p && globRegex(p)) ? 'static-glob' : 'partial-or-unknown-glob', targets: unique(targets).sort(), target: null });
        continue;
      }
      if (raw.specifier === null) {
        f.dependencies.push({ ...raw, resolution: 'runtime-computed-unknown', target: null });
        f.unknownRelationships.push({ kind: raw.kind, line: raw.line, expression: raw.expression, reason: 'non-literal-module' });
        continue;
      }
      const resolved = ts.resolveModuleName(raw.specifier, path.join(snapshot, f.path), options, ts.sys, cache).resolvedModule;
      const local = resolved ? relative(snapshot, resolved.resolvedFileName) : null;
      const external = resolved?.isExternalLibraryImport || local?.startsWith('node_modules/') || local?.startsWith('../');
      const target = local && byPath.has(local) ? local : null;
      // Vite's CSS/assets may be compiler-unresolved; retain a separate exact asset reference, not a TS edge.
      const asset = raw.specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(f.path), raw.specifier)) : null;
      const assetTarget = !resolved && asset && byPath.has(asset) && !JS.test(asset) ? asset : null;
      const resolution = target ? 'typescript-resolved' : external ? 'typescript-external' : (isBuiltin(raw.specifier) || raw.specifier.startsWith('virtual:')) ? (isBuiltin(raw.specifier) ? 'node-builtin' : 'runtime-provided-unknown') : assetTarget ? 'asset-reference-compiler-unresolved' : 'unresolved';
      f.dependencies.push({ ...raw, resolution, target, assetTarget, package: external ? raw.specifier : undefined });
      if (!target && !external && resolution !== 'node-builtin') f.unknownRelationships.push({ kind: raw.kind, line: raw.line, specifier: raw.specifier, reason: resolution });
    }
    const bindings = new Map(f.dependencies.flatMap(d => d.bindings.map(b => [b.local, { file: d.target, imported: b.imported, resolution: d.resolution }])));
    f.callReferences = f.mechanical.calls.filter(c => bindings.has(c.name.split('.')[0])).map(c => ({ ...c, importedBinding: bindings.get(c.name.split('.')[0]), certainty: 'syntactic-import-use; not runtime dispatch proof' }));
    f.inbound = [];
  }
  for (const f of files) for (const d of f.dependencies) {
    for (const target of unique([d.target, d.assetTarget, ...(d.targets || [])].filter(Boolean))) byPath.get(target)?.inbound.push({ path: f.path, kind: d.kind, line: d.line, test: TEST.test(f.path), certainty: d.resolution });
  }
  for (const f of files) {
    f.verification = { directTestImporters: unique(f.inbound.filter(x => x.test).map(x => x.path)).sort(), evidence: 'test-file import, not tested-symbol coverage or pass evidence', suggested: checklist(f) };
    f.purpose = { certainty: 'inferred-from-source-structure', text: f.mechanical.comments[0] || (f.mechanical.symbols.length ? `Declares ${f.mechanical.symbols.slice(0, 7).map(x => x.name).join(', ')}; inspect recorded signatures, guards and I/O before reuse.` : `${f.mechanical.category}: ${f.mechanical.headings.slice(0, 3).join('; ') || 'see source evidence and classification'}`) };
    f.potentialData = f.mechanical.data.map(d => ({ ...d, migrations: files.filter(m => (d.table && m.mechanical.sql?.tables.some(t => t.name.replace(/^public\./, '') === d.table)) || (d.kind === 'rpc-call' && d.name && m.mechanical.sql?.functions.some(t => t.name.replace(/^public\./, '') === d.name))).map(m => m.path), migrationCertainty: 'textual-table-name-candidate; does not establish deployment or complete schema' }));
  }
}
function checklist(f) {
  const checks = ['Read applicable AGENTS.md and current coordination reservations.', 'Inspect actual callers/contracts; source evidence is not a passing test.'];
  if (f.mechanical.isCode) checks.push('Run focused owning tests, typecheck and lint; retain existing quality budgets.');
  if (f.path.includes('server/') || f.potentialData?.length || f.mechanical.data.length) checks.push('Verify authenticated role, wrong workspace, refused write and persistence/reopen at the real DB boundary.');
  if (/ledger|payment|posting|stock|invoice|bill|tax|period|currency|credit|reconcil/i.test(f.path)) checks.push('Independent integer-minor-unit/precision/FX, signed reversal, closed-period and replay fixtures; preserve financial-owner boundary.');
  if (/components\//.test(f.path)) checks.push('Check pending/refusal draft retention, stale workspace responses, keyboard/focus, phone and mixed Hebrew data in Chromium.');
  if (/report|statement|algorithm/i.test(f.path)) checks.push('Check scope/basis/date/currency/completeness and screen/drilldown/CSV/PDF parity; label previews and provider unknowns.');
  return checks;
}
function staleReview(review, byPath) {
  if (!review) return null;
  const changed = (review.basedOn || []).filter(r => byPath.get(r.path)?.blobSha !== r.blobSha);
  return { ...review, status: changed.length ? 'stale' : 'current', changedSources: changed.map(r => r.path) };
}
export function generate(root, rev, output = path.join(root, DEFAULT_INDEX), fresh = false) {
  const pinned = revision(root, rev), tree = inventory(root, pinned), old = readIndex(fs.existsSync(output) ? output : path.join(root, DEFAULT_INDEX));
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerflow-atlas-'));
  const extractorHash = digest(fs.readFileSync(SELF));
  let reused = 0;
  try {
    execFileSync('tar', ['-xf', '-', '-C', snapshot], { input: git(root, ['archive', '--format=tar', pinned]), maxBuffer: MAX_BUFFER });
    const modules = path.join(root, 'node_modules');
    if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(snapshot, 'node_modules'), 'dir');
    const previous = new Map(old.files.map(f => [f.path, f]));
    const files = tree.map(t => {
      const prior = previous.get(t.path);
      const buffer = t.objectType === 'blob' ? git(root, ['cat-file', 'blob', t.blobSha]) : Buffer.alloc(0);
      let mechanical;
      if (!fresh && old.meta?.extractorHash === extractorHash && prior?.blobSha === t.blobSha) { mechanical = prior.mechanical; reused++; }
      else mechanical = extract(t.path, buffer);
      return { record: 'file', schema: SCHEMA, ...t, sourceRevision: pinned, mechanical, manual: prior?.manual || null };
    });
    resolveModules(files, snapshot, compilerOptions(snapshot));
    const byPath = new Map(files.map(f => [f.path, f]));
    for (const f of files) f.manual = staleReview(f.manual, byPath);
    const workflows = old.workflows.map(w => ({ ...w, review: staleReview(w.review, byPath) }));
    const retired = [...(old.meta?.retiredAnnotations || []), ...old.files.filter(f => f.manual && !byPath.has(f.path)).map(f => ({ path: f.path, manual: f.manual, removedFromRevision: pinned }))];
    const meta = { record: 'meta', schema: SCHEMA, sourceRevision: pinned, sourceTree: txt(root, ['rev-parse', `${pinned}^{tree}`]), sourceCommitDate: txt(root, ['show', '-s', '--format=%cI', pinned]), extractorHash, typescriptVersion: ts.version, moduleResolution: 'TypeScript resolveModuleName using snapshot tsconfig and locally installed lockfile dependencies; assets/globs separately labeled', inventoryCount: files.length, exclusions: ['Untracked/ignored working files and Git internals are not in the committed tree. No tracked paths excluded.', 'Binary assets: metadata only, no visual/decompilation review.', 'Gitlinks: inventory only, submodule contents not traversed.'], generatedArtifacts: [...ARTIFACTS], artifactSemantics: 'These files have entries for their blobs IN THE PINNED INPUT COMMIT, not the later generated output. A Git blob cannot contain its own output hash. Compare source changes separately from expected generated-artifact drift.', retiredAnnotations: retired };
    writeIndex(output, meta, files, workflows);
    return { ...statistics(readIndex(output)), mechanicalEntriesReused: reused, relationshipsReResolved: files.length };
  } finally { fs.rmSync(snapshot, { recursive: true, force: true }); }
}
export function statistics(index) {
  const files = index.files;
  return { sourceRevision: index.meta?.sourceRevision, sourceTree: index.meta?.sourceTree, inventory: files.length, coverageDenominator: index.meta?.inventoryCount, codeFiles: files.filter(f => f.mechanical.isCode).length, binary: files.filter(f => f.mechanical.binary).length, automaticallyExtracted: files.length, reviewerAnnotated: files.filter(f => f.manual).length, manuallyInspected: files.filter(f => f.manual?.inspection === 'targeted-source-inspection').length, staleAnnotations: files.filter(f => f.manual?.status === 'stale').map(f => f.path), unknownRelationships: files.reduce((n, f) => n + f.unknownRelationships.length, 0), unknownModuleFiles: files.filter(f => f.unknownRelationships.length).map(f => f.path), computedApiCalls: files.reduce((n, f) => n + f.mechanical.api.filter(a => a.url === null).length, 0), parseErrors: files.flatMap(f => f.mechanical.parseErrors.map(e => ({ path: f.path, ...e }))), workflows: index.workflows.map(w => ({ id: w.id, title: w.title, status: w.review?.status || 'unreviewed', runtimeVerification: w.runtimeVerification })), categories: Object.fromEntries(unique(files.map(f => f.mechanical.category)).sort().map(c => [c, files.filter(f => f.mechanical.category === c).length])) };
}
export function changes(root, index, rev = 'worktree') {
  const base = index.meta.sourceRevision;
  const target = rev === 'worktree' ? null : revision(root, rev);
  const rows = git(root, ['diff', '--name-status', '-z', '-M', base, ...(target ? [target] : []), '--']).toString('utf8').split('\0').filter(Boolean);
  const delta = [];
  for (let i = 0; i < rows.length;) {
    const code = rows[i++];
    if (code.startsWith('R') || code.startsWith('C')) delta.push({ kind: code.startsWith('R') ? 'renamed' : 'copied', similarity: Number(code.slice(1)), from: rows[i++], path: rows[i++] });
    else delta.push({ kind: ({ A: 'added', D: 'deleted', M: 'modified', T: 'type-changed' })[code] || code, path: rows[i++] });
  }
  const source = delta.filter(d => !ARTIFACTS.has(d.path));
  const affected = new Set(source.flatMap(d => [d.path, d.from].filter(Boolean)));
  const stale = index.files.filter(f => f.manual?.basedOn.some(r => affected.has(r.path))).map(f => f.path);
  return { sourceRevision: base, comparedTo: target || 'tracked worktree (includes staged and unstaged; untracked excluded)', sourceChanges: source, generatedArtifactChanges: delta.filter(d => ARTIFACTS.has(d.path)), manuallyExplainedEntriesNeedingReview: unique([...stale, ...index.files.filter(f => f.manual?.status === 'stale').map(f => f.path)]), workflowsNeedingReview: index.workflows.filter(w => w.review?.basedOn.some(r => affected.has(r.path)) || w.review?.status === 'stale').map(w => w.id), note: 'Rename detection is Git similarity-based. Added/deleted paths are still reported if Git cannot establish a rename.' };
}
export function dependencyWalk(index, file, direction = 'in', depth = 2, limit = 100) {
  const byPath = new Map(index.files.map(f => [f.path, f]));
  if (!byPath.has(file)) throw new Error(`Unknown indexed path: ${file}`);
  const queue = [{ path: file, distance: 0 }], seen = new Set([file]), rows = [];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.distance >= depth) continue;
    const entry = byPath.get(current.path);
    const next = direction === 'in' ? entry.inbound.map(e => ({ path: e.path, kind: e.kind })) : entry.dependencies.flatMap(e => unique([e.target, e.assetTarget, ...(e.targets || [])].filter(Boolean)).map(p => ({ path: p, kind: e.kind })));
    for (const n of next) if (!seen.has(n.path)) {
      seen.add(n.path);
      const item = { ...n, via: current.path, distance: current.distance + 1, consequence: current.distance === 0 ? 'direct syntactic dependency' : 'possible indirect consequence; not runtime reachability proof' };
      queue.push(item); rows.push(item);
    }
  }
  return { file, direction, depth, total: rows.length, truncated: rows.length > limit, entries: rows.slice(0, limit) };
}
export function impact(index, file, depth = 3, limit = 100) {
  const entry = index.files.find(f => f.path === file);
  if (!entry) throw new Error(`Unknown indexed path: ${file}`);
  const graph = dependencyWalk(index, file, 'in', depth, limit);
  const candidates = graph.entries.map(x => ({ ...x, entry: index.files.find(f => f.path === x.path) }));
  return { sourceRevision: index.meta.sourceRevision, file, blobSha: entry.blobSha, purpose: entry.manual?.purpose || entry.purpose, manualStatus: entry.manual?.status || 'not-manually-explained', totalCandidates: graph.total, truncated: graph.truncated, direct: graph.entries.filter(x => x.distance === 1), possibleIndirect: graph.entries.filter(x => x.distance > 1).map(x => ({ path: x.path, via: x.via, distance: x.distance })), candidateScreens: candidates.filter(x => x.path.startsWith('src/components/')).map(x => x.path), candidateRoutes: candidates.filter(x => x.entry.mechanical.routes.length).map(x => ({ path: x.path, declarations: x.entry.mechanical.routes })), ownRoutes: entry.mechanical.routes, ownDatabaseOperations: entry.potentialData, ownershipContract: entry.manual?.ownership || null, possibleIndirectDatabaseOperations: candidates.filter(x => x.entry.potentialData.length).map(x => ({ path: x.path, distance: x.distance, operations: x.entry.potentialData.slice(0, 25), operationsTotal: x.entry.potentialData.length, operationsTruncated: x.entry.potentialData.length > 25, certainty: 'syntactic-module-impact-candidate-not-confirmed-data-flow' })), candidateTests: candidates.filter(x => TEST.test(x.path)).map(x => x.path), workflowReferences: index.workflows.filter(w => w.review?.basedOn.some(r => r.path === file)).map(w => w.id), verification: entry.verification, limitation: 'Module-level fan-in, not symbol-level taint/dispatch analysis. Indirect screens/routes/tests are candidates, not confirmed executions; no production behavior is inferred.' };
}
export function validate(root, index) {
  const errors = [], add = s => errors.push(s);
  if (index.meta?.schema !== SCHEMA) add('Unsupported/missing metadata schema');
  if (!index.meta?.sourceRevision) return { ok: false, errors: ['Missing pinned source revision'] };
  const tree = inventory(root, index.meta.sourceRevision), expected = new Map(tree.map(t => [t.path, t]));
  const byPath = new Map(index.files.map(f => [f.path, f]));
  if (byPath.size !== index.files.length) add('Duplicate file paths');
  if (tree.length !== index.files.length || index.meta.inventoryCount !== tree.length) add('Inventory count mismatch');
  for (const t of tree) if (!byPath.has(t.path)) add(`Missing ${t.path}`);
  for (const f of index.files) {
    if (expected.get(f.path)?.blobSha !== f.blobSha || f.sourceRevision !== index.meta.sourceRevision) add(`Wrong blob/revision: ${f.path}`);
    for (const d of f.dependencies) for (const target of [d.target, d.assetTarget, ...(d.targets || [])].filter(Boolean)) if (!byPath.has(target)) add(`Invented dependency ${f.path} -> ${target}`);
    for (const inbound of f.inbound) if (!byPath.get(inbound.path)?.dependencies.some(d => d.target === f.path || d.assetTarget === f.path || d.targets?.includes(f.path))) add(`Asymmetric inbound edge ${f.path} <- ${inbound.path}`);
    for (const source of f.manual?.basedOn || []) {
      const sha = txt(root, ['rev-parse', `${f.manual.reviewedRevision}:${source.path}`]);
      if (sha !== source.blobSha) add(`Invalid manual evidence blob: ${f.path}/${source.path}`);
    }
    if (f.manual && !f.manual.basedOn?.some(r => r.path === f.path)) add(`Missing own-file review evidence: ${f.path}`);
    if (f.manual && staleReview(f.manual, byPath).status !== f.manual.status) add(`Wrong staleness: ${f.path}`);
    for (const symbol of f.manual?.ownership?.symbols || []) if (!f.mechanical.symbols.some(s => s.name === symbol)) add(`Unknown ownership symbol ${f.path}:${symbol}`);
    for (const ref of f.manual?.ownership?.relatedImplementations || []) {
      if (!byPath.has(ref.path)) add(`Unknown related implementation ${f.path}:${ref.path}`);
      if (!f.manual.basedOn?.some(r => r.path === ref.path)) add(`Missing related implementation review evidence ${f.path}:${ref.path}`);
    }
  }
  if (new Set(index.workflows.map(w => w.id)).size !== index.workflows.length) add('Duplicate workflow IDs');
  for (const w of index.workflows) {
    for (const key of ['entry', 'inputs', 'calculation', 'action', 'persistence', 'verification']) if (!w.stages?.[key]?.length) add(`Workflow ${w.id} missing ${key}`);
    for (const refs of Object.values(w.stages || {})) for (const ref of refs) {
      const file = byPath.get(ref.path);
      if (!w.review?.basedOn?.some(r => r.path === ref.path)) add(`Workflow ${w.id} missing evidence ${ref.path}`);
      if (!file) add(`Workflow ${w.id} unknown path ${ref.path}`);
      else if (ref.symbol && !file.mechanical.symbols.some(s => s.name === ref.symbol)) add(`Workflow ${w.id} unknown symbol ${ref.path}:${ref.symbol}`);
    }
    if (w.review && staleReview(w.review, byPath).status !== w.review.status) add(`Wrong workflow staleness ${w.id}`);
    for (const ref of w.review?.basedOn || []) if (txt(root, ['rev-parse', `${w.review.reviewedRevision}:${ref.path}`]) !== ref.blobSha) add(`Invalid workflow evidence ${w.id}:${ref.path}`);
  }
  const stats = statistics(index);
  if (stats.parseErrors.length) add('Source parse diagnostics present (see stats)');
  return { ok: !errors.length, errors, ...stats };
}
function search(index, term, limit) {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return index.files.map(f => {
    const fields = [f.path, f.manual?.purpose || '', f.manual?.note || '', f.manual?.ownership?.reuseContract || '', f.purpose.text, ...f.mechanical.symbols.map(s => s.name), ...f.mechanical.routes.map(r => r.path || r.pathExpression), ...f.mechanical.data.map(d => d.table || d.name || d.expression || '')].join(' ').toLowerCase();
    const score = words.reduce((s, w) => s + (f.path.toLowerCase().includes(w) ? 10 : fields.includes(w) ? 1 : 0), 0);
    return { f, score, matches: words.every(w => fields.includes(w)) };
  }).filter(x => x.matches).sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path)).slice(0, limit).map(({ f, score }) => ({ path: f.path, score, sourceRevision: f.sourceRevision, blobSha: f.blobSha, purpose: f.manual?.purpose || f.purpose.text, manualStatus: f.manual?.status || 'automatic-only', exportedSymbols: f.mechanical.symbols.filter(s => s.exported).map(s => s.name), directTestImporters: f.verification.directTestImporters }));
}
function parseArgs(args) {
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { const name = args[i].slice(2); options[name] = ['json', 'check', 'markdown', 'fresh'].includes(name) ? true : args[++i]; }
    else positional.push(args[i]);
  }
  return { options, positional };
}
export function markdownStats(index) {
  const s = statistics(index);
  return `# Code atlas — generated coverage evidence\n\nInput commit: \`${s.sourceRevision}\`\nInput tree: \`${s.sourceTree}\`\nExtractor SHA-256: \`${index.meta.extractorHash}\`\nTypeScript: ${index.meta.typescriptVersion}\n\n| Measure | Count |\n|---|---:|\n| Tracked input paths / entries | ${s.coverageDenominator} / ${s.inventory} |\n| Automatically extracted entries | ${s.automaticallyExtracted} |\n| Code-related files | ${s.codeFiles} |\n| Binary assets (metadata only) | ${s.binary} |\n| Reviewer-annotated entries | ${s.reviewerAnnotated} |\n| Targeted source-inspected entries | ${s.manuallyInspected} |\n| Stale manual entries | ${s.staleAnnotations.length} |\n| Unknown module/glob relationships | ${s.unknownRelationships} |\n| Computed API callsites (unresolved URLs) | ${s.computedApiCalls} |\n| JS/TS parse diagnostics | ${s.parseErrors.length} |\n| Workflow traces (not feature completion) | ${s.workflows.length} |\n\n## Categories\n\n${Object.entries(s.categories).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Workflow evidence scope\n\n${s.workflows.map(w => `- ${w.id}: ${w.title} — ${w.status}; ${w.runtimeVerification}`).join('\n')}\n\n## Exclusions and limits\n\n${index.meta.exclusions.map(x => '- ' + x).join('\n')}\n- ${index.meta.artifactSemantics}\n- Unknowns are retained in each entry. Use \`unknowns\`, \`show\`, \`workflow\` and \`impact\`; no dynamic dispatch/provider/deployment proof is implied.\n- Mechanical metrics regenerate from the canonical JSONL; this page has no independent per-file summaries.\n- Commands/test results and tool limitations: [atlas guide](CODE_ATLAS.md). Prior source audit findings: [strategy audit](DEEP_CODE_AUDIT.md), pinned to its own stated revision.\n`;
}
export function main(args = process.argv.slice(2)) {
  const { options: o, positional: p } = parseArgs(args);
  const root = path.resolve(o.root || process.cwd()), indexPath = path.resolve(root, o.index || DEFAULT_INDEX), command = p[0];
  const index = command === 'generate' ? null : readIndex(indexPath);
  let result;
  switch (command) {
    case 'generate': if (!o.revision) throw new Error('generate requires --revision <explicit commit/ref>'); result = generate(root, o.revision, path.resolve(root, o.output || o.index || DEFAULT_INDEX), Boolean(o.fresh)); break;
    case 'stats': result = o.markdown ? markdownStats(index) : statistics(index); break;
    case 'validate': result = validate(root, index); if (!result.ok) process.exitCode = 1; break;
    case 'query': result = search(index, p.slice(1).join(' '), Number(o.limit || 8)); break;
    case 'show': result = index.files.find(f => f.path === p[1]); if (!result) throw new Error('Indexed path not found'); break;
    case 'deps': result = dependencyWalk(index, p[1], o.direction || 'in', Number(o.depth || 2), Number(o.limit || 100)); break;
    case 'impact': result = impact(index, p[1], Number(o.depth || 3), Number(o.limit || 100)); break;
    case 'workflow': result = p[1] ? index.workflows.find(w => w.id === p[1]) : statistics(index).workflows; if (!result) throw new Error('Unknown workflow ID'); break;
    case 'unknowns': result = index.files.filter(f => f.unknownRelationships.length || f.mechanical.api.some(a => a.url === null)).slice(0, Number(o.limit || 20)).map(f => ({ path: f.path, modules: f.unknownRelationships, computedApi: f.mechanical.api.filter(a => a.url === null) })); break;
    case 'changes': result = changes(root, index, o.revision || 'worktree'); if (o.check && (result.sourceChanges.length || result.manuallyExplainedEntriesNeedingReview.length || result.workflowsNeedingReview.length)) process.exitCode = 1; break;
    case 'annotate': {
      if (!o.purpose || !o.note || !o.revision) throw new Error('annotate requires PATH --revision REV --purpose TEXT --note TEXT [--depends-on comma-separated-paths]');
      const f = index.files.find(f => f.path === p[1]); if (!f) throw new Error('Unknown indexed path');
      const rev = revision(root, o.revision), refs = unique([f.path, ...(o['depends-on'] || '').split(',').filter(Boolean)]);
      f.manual = staleReview({ purpose: o.purpose, note: o.note, certainty: 'source-inspected-interpretation-not-runtime-certification', inspection: 'targeted-source-inspection', reviewedRevision: rev, basedOn: refs.map(file => ({ path: file, blobSha: txt(root, ['rev-parse', `${rev}:${file}`]) })) }, new Map(index.files.map(f => [f.path, f])));
      writeIndex(indexPath, index.meta, index.files, index.workflows); result = { path: f.path, manual: f.manual }; break;
    }
    default: result = 'Usage: node scripts/code-atlas.mjs generate --revision REV | validate | stats [--markdown] | query WORDS | show PATH | deps PATH [--direction in|out --depth N] | impact PATH | workflow [ID] | unknowns | changes [--revision REV|worktree --check] | annotate PATH --revision REV --purpose TEXT --note TEXT. All commands accept --root DIR --index PATH. JSON is the default output.';
  }
  console.log(typeof result === 'string' ? result.trimEnd() : JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
