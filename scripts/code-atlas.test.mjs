import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generate, readIndex, validate, changes, dependencyWalk, impact, extract, main } from './code-atlas.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Atlas Test');
  git(root, 'config', 'user.email', 'atlas-test@example.invalid');
  const write = (name, body) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); };
  const commit = () => { git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture'); return git(root, 'rev-parse', 'HEAD'); };
  write('tsconfig.json', JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext', baseUrl: '.', paths: { '@/*': ['src/*'] }, allowImportingTsExtensions: true }, include: ['src'] }));
  write('src/money.ts', 'export interface Money { cents: number }\nexport function amount(x: number) { if (!Number.isSafeInteger(x)) throw new Error("integer only"); return x; }\n');
  write('src/barrel.ts', 'export { amount as sum } from "./money";\nexport * from "./money";\n');
  write('src/main.ts', 'import { sum } from "@/barrel";\nimport type { Money } from "./money";\nimport fs from "fs";\nconst lazy = import("./money");\nconst missing = import("./missing");\nconst unknown = import(variable);\nconst plugins = import.meta.glob("./plugins/**/*.tsx");\nfetch(`/api/pay/${workspace}`);\nconst router = makeRouter(); router.post("/pay", auth, handler);\nconst ref = db.collection("transactions"); ref.get();\nclient.rpc("lf_set", {});\nArray.from([1, 2]); Buffer.from("not-a-table");\nsum(12);\n');
  write('src/plugins/Panel.tsx', 'export default function Panel() { return null; }\n');
  write('src/plugins/nested/Other.tsx', 'export default function Other() { return null; }\n');
  write('src/tests/money.test.ts', 'import { amount } from "../money"; test("whole cents", () => amount(10));\n');
  write('supabase/migrations/001.sql', 'create table public.transactions (id text);\ncreate function public.lf_set() returns void language sql as $$ select; $$;\n');
  write('archive/old.cjs', 'const fs = require("fs");');
  write('asset.bin', Buffer.from([0, 1, 2]));
  write('docs/readme.md', '# Fixture guide\n');
  const rev = commit();
  try { return run({ root, write, commit, rev, output: path.join(root, 'atlas.jsonl') }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function quiet(fn) {
  const old = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = old; }
}

test('inventories exact committed paths, full Git blobs and binary metadata; ignores untracked files', () => fixture(({ root, rev, output, write }) => {
  write('untracked.ts', 'secret working file');
  const stats = generate(root, rev, output), index = readIndex(output);
  assert.equal(stats.inventory, 11);
  assert.equal(index.files.length, git(root, 'ls-tree', '-r', '--name-only', rev).split('\n').length);
  assert.ok(index.files.every(f => /^[a-f0-9]{40}$/.test(f.blobSha)));
  assert.equal(index.files.find(f => f.path === 'asset.bin').mechanical.binary, true);
  assert.equal(index.files.some(f => f.path === 'untracked.ts'), false);
  assert.equal(validate(root, index).ok, true);
}));

test('TypeScript resolution handles aliases, re-exports, type imports and literal dynamic imports', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const index = readIndex(output), main = index.files.find(f => f.path === 'src/main.ts');
  assert.equal(main.dependencies.find(e => e.specifier === '@/barrel').target, 'src/barrel.ts');
  assert.equal(main.dependencies.find(e => e.kind === 'type-import').target, 'src/money.ts');
  assert.equal(main.dependencies.find(e => e.kind === 'dynamic-import' && e.specifier === './money').target, 'src/money.ts');
  assert.equal(main.dependencies.find(e => e.specifier === 'fs').resolution, 'node-builtin');
  assert.ok(index.files.find(f => f.path === 'src/barrel.ts').dependencies.every(e => e.kind === 're-export' && e.target === 'src/money.ts'));
}));

test('computed/missing modules stay unknown and supported globs expand only actual tracked targets', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const main = readIndex(output).files.find(f => f.path === 'src/main.ts');
  assert.ok(main.unknownRelationships.some(e => e.reason === 'non-literal-module'));
  assert.ok(main.unknownRelationships.some(e => e.specifier === './missing'));
  assert.deepEqual(main.dependencies.find(e => e.kind === 'glob').targets, ['src/plugins/Panel.tsx', 'src/plugins/nested/Other.tsx']);
  assert.equal(main.mechanical.api[0].url, null);
  assert.match(main.mechanical.api[0].urlExpression, /workspace/);
}));

test('separates routes, table/RPC references and SQL candidates; does not mistake Array/Buffer.from for tables', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const main = readIndex(output).files.find(f => f.path === 'src/main.ts');
  assert.equal(main.mechanical.routes[0].path, '/pay');
  assert.ok(main.potentialData.some(e => e.table === 'transactions' && e.migrations.includes('supabase/migrations/001.sql')));
  assert.ok(main.potentialData.some(e => e.kind === 'rpc-call' && e.name === 'lf_set' && e.migrations.includes('supabase/migrations/001.sql')));
  assert.equal(main.mechanical.data.some(e => e.excerpt.startsWith('Array.from') || e.excerpt.startsWith('Buffer.from')), false);
}));

test('direct and indirect dependency/impact queries are bounded and tests are labeled import evidence only', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const index = readIndex(output), graph = dependencyWalk(index, 'src/money.ts', 'in', 3, 1);
  assert.equal(graph.truncated, true);
  assert.equal(graph.entries.length, 1);
  const info = impact(index, 'src/money.ts');
  assert.ok(info.candidateTests.includes('src/tests/money.test.ts'));
  assert.ok(info.direct.some(e => e.path === 'src/barrel.ts'));
  assert.match(info.limitation, /not symbol-level/);
}));

test('generation is deterministic, reuses mechanical fields and re-resolves relationships', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const before = fs.readFileSync(output, 'utf8');
  const result = generate(root, rev, output);
  assert.equal(result.mechanicalEntriesReused, 11);
  assert.equal(result.relationshipsReResolved, 11);
  assert.equal(fs.readFileSync(output, 'utf8'), before);
  let rendered;
  const oldLog = console.log;
  try { console.log = value => { rendered = value; }; main(['stats', '--root', root, '--index', output, '--markdown']); }
  finally { console.log = oldLog; }
  assert.equal(rendered.endsWith('\n'), false, 'console.log must add exactly one final newline');
  assert.equal(generate(root, rev, output, true).mechanicalEntriesReused, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), before);
}));

test('new target files resolve previously missing imports without stale AST cache edges', () => fixture(({ root, rev, output, write, commit }) => {
  generate(root, rev, output);
  write('src/missing.ts', 'export const nowPresent = true;');
  const next = commit();
  generate(root, next, output);
  const main = readIndex(output).files.find(f => f.path === 'src/main.ts');
  assert.equal(main.dependencies.find(e => e.specifier === './missing').target, 'src/missing.ts');
}));

test('pins commit content rather than silently mixing working edits', () => fixture(({ root, rev, output, write }) => {
  generate(root, rev, output);
  write('src/money.ts', 'export function changedWorktree() {}');
  generate(root, rev, output);
  assert.ok(readIndex(output).files.find(f => f.path === 'src/money.ts').mechanical.symbols.some(s => s.name === 'amount'));
  assert.equal(changes(root, readIndex(output)).sourceChanges.find(e => e.path === 'src/money.ts').kind, 'modified');
}));

test('annotations retain evidence revision and become stale after source modification', () => fixture(({ root, rev, output, write, commit }) => {
  generate(root, rev, output);
  quiet(() => main(['annotate', 'src/money.ts', '--root', root, '--index', output, '--revision', rev, '--purpose', 'Minor-unit guard', '--note', 'Targeted inspection; no runtime assertion']));
  assert.equal(readIndex(output).files.find(f => f.path === 'src/money.ts').manual.status, 'current');
  write('src/money.ts', 'export const changed = 1;');
  const next = commit();
  generate(root, next, output);
  const index = readIndex(output), note = index.files.find(f => f.path === 'src/money.ts').manual;
  assert.equal(note.status, 'stale');
  assert.equal(note.reviewedRevision, rev);
  assert.deepEqual(note.changedSources, ['src/money.ts']);
  assert.equal(validate(root, index).ok, true);
}));

test('dependent manual notes also become stale, and additions/deletions/renames are reported', () => fixture(({ root, rev, output, write, commit }) => {
  generate(root, rev, output);
  quiet(() => main(['annotate', 'src/barrel.ts', '--root', root, '--index', output, '--revision', rev, '--purpose', 'Barrel', '--note', 'Depends on money', '--depends-on', 'src/money.ts']));
  git(root, 'mv', 'asset.bin', 'renamed.bin');
  fs.unlinkSync(path.join(root, 'archive/old.cjs'));
  write('added.md', 'new documentation');
  write('src/money.ts', 'export const changed = 3;');
  const next = commit();
  const delta = changes(root, readIndex(output), next);
  assert.ok(delta.sourceChanges.some(e => e.kind === 'renamed' && e.from === 'asset.bin' && e.path === 'renamed.bin'));
  assert.ok(delta.sourceChanges.some(e => e.kind === 'deleted' && e.path === 'archive/old.cjs'));
  assert.ok(delta.sourceChanges.some(e => e.kind === 'added' && e.path === 'added.md'));
  generate(root, next, output);
  assert.equal(readIndex(output).files.find(f => f.path === 'src/barrel.ts').manual.status, 'stale');
}));

test('deleted reviewed entries are retained as retired annotations, not current file coverage', () => fixture(({ root, rev, output, commit }) => {
  generate(root, rev, output);
  quiet(() => main(['annotate', 'src/money.ts', '--root', root, '--index', output, '--revision', rev, '--purpose', 'Reviewed', '--note', 'Keep evidence']));
  fs.unlinkSync(path.join(root, 'src/money.ts'));
  generate(root, commit(), output);
  const index = readIndex(output);
  assert.ok(index.meta.retiredAnnotations.some(x => x.path === 'src/money.ts'));
  assert.equal(index.files.some(x => x.path === 'src/money.ts'), false);
}));

test('validator refuses missing/duplicate files, forged blobs and invented dependency targets', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const missing = readIndex(output); missing.files.pop(); assert.equal(validate(root, missing).ok, false);
  const duplicate = readIndex(output); duplicate.files.push(duplicate.files[0]); assert.equal(validate(root, duplicate).ok, false);
  const wrong = readIndex(output); wrong.files[0].blobSha = '0'.repeat(40); assert.equal(validate(root, wrong).ok, false);
  const edge = readIndex(output); edge.files[0].dependencies.push({ target: 'invented.ts' }); assert.equal(validate(root, edge).ok, false);
}));

test('extracts actual error/guard/function/interface evidence and tolerates binary input', () => {
  const facts = extract('src/money.ts', Buffer.from('export interface Amount { cents: number }; export function check(x: number) { if (!Number.isSafeInteger(x)) throw new Error("bad"); }'));
  assert.ok(facts.symbols.some(s => s.name === 'Amount' && s.members[0].name === 'cents'));
  assert.ok(facts.symbols.some(s => s.name === 'check' && s.signature.includes('number')));
  assert.equal(facts.errors[0].kind, 'throw');
  assert.match(facts.safeguards[0].condition, /isSafeInteger/);
  assert.equal(extract('font.ttf', Buffer.from([0, 1])).binary, true);
});

test('malformed JSONL fails loudly rather than silently dropping entries', () => {
  const file = path.join(os.tmpdir(), `invalid-atlas-${process.pid}.jsonl`);
  try { fs.writeFileSync(file, '{}\nnot json\n'); assert.throws(() => readIndex(file), /line 2/); }
  finally { fs.rmSync(file, { force: true }); }
});

test('generated artifacts retain exact inventory metadata without recursively indexing their content', () => {
  const content = Buffer.from('# Generated validation\n## Do not recursively index\n');
  const facts = extract('docs/CODE_ATLAS_VALIDATION.md', content);
  assert.equal(facts.category, 'generated-atlas-artifact');
  assert.equal(facts.bytes, content.length);
  assert.deepEqual(facts.headings, []);
  assert.match(facts.contentInspection, /not recursively indexed/);
});

test('every workflow stage has real path/symbol/blob evidence and duplicate IDs are rejected', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  const index = readIndex(output), file = index.files.find(f => f.path === 'src/money.ts');
  const basedOn = [{ path: file.path, blobSha: file.blobSha }];
  const stage = [{ path: file.path, symbol: 'amount', line: 1 }];
  index.workflows.push({ record: 'workflow', id: 'FLOW', stages: Object.fromEntries(['entry', 'inputs', 'calculation', 'action', 'persistence', 'verification'].map(k => [k, structuredClone(stage)])), review: { reviewedRevision: rev, basedOn, status: 'current' } });
  assert.equal(validate(root, index).ok, true);
  const invented = structuredClone(index); invented.workflows[0].stages.action[0].symbol = 'invented';
  assert.equal(validate(root, invented).ok, false);
  const uncovered = structuredClone(index); uncovered.workflows[0].review.basedOn = [];
  assert.equal(validate(root, uncovered).ok, false);
  index.workflows.push(structuredClone(index.workflows[0]));
  assert.equal(validate(root, index).ok, false);
}));

test('manual ownership references require real declarations and blob-backed related implementations', () => fixture(({ root, rev, output }) => {
  generate(root, rev, output);
  quiet(() => main(['annotate', 'src/money.ts', '--root', root, '--index', output, '--revision', rev, '--purpose', 'Amount owner', '--note', 'Inspected minor units']));
  const index = readIndex(output), file = index.files.find(f => f.path === 'src/money.ts');
  file.manual.ownership = { symbols: ['amount'], relatedImplementations: [] };
  assert.equal(validate(root, index).ok, true);
  file.manual.ownership.symbols = ['invented'];
  assert.equal(validate(root, index).ok, false);
  file.manual.ownership.symbols = ['amount'];
  file.manual.ownership.relatedImplementations = [{ path: 'src/main.ts' }];
  assert.equal(validate(root, index).ok, false);
}));

test('artifact-only drift is visible but is not treated as production source drift', () => fixture(({ root, rev, output, write, commit }) => {
  const canonical = path.join(root, 'docs/CODE_ATLAS.jsonl');
  generate(root, rev, canonical);
  write('docs/CODE_ATLAS_VALIDATION.md', 'Derived evidence\n');
  const next = commit(), delta = changes(root, readIndex(canonical), next);
  assert.deepEqual(delta.sourceChanges, []);
  assert.ok(delta.generatedArtifactChanges.some(d => d.path === 'docs/CODE_ATLAS_VALIDATION.md'));
}));
