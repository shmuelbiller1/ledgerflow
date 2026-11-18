import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { countRawRelations, scanSandboxSql } from '../../scripts/sandbox-sql-baseline';

const collections = new Set(['documents', 'transactions', 'stockmoves']);

test('the SQL inventory catches plain, qualified and dynamic relations, counting both sides of a join', () => {
  const source = [
    'const stock = `select to_regclass(\'public."stockMoves"\') is not null`;',
    'const docs = `select * from documents d join "public".transactions t on t.id = d.id`;',
    'const dynamic = `select * from public."${table}"`;',
    'const unqualified = `select * from ${table}`;',
    'const split = `delete from ` + `public.transactions where id = $1`;',
    'const bypass = `select * from sandbox_read.documents`;',
    'const mixed = `select * from ${db.tableSource("documents")} d join public.transactions t on t.id = d.id`;',
    'const fragment = `public."documents"`;',
    'const conditional = `select * from ${db.tableSource("documents")} d ${flag ? "join public.transactions t on t.id = d.id" : ""}`;',
  ].join('\n');
  assert.equal(countRawRelations('sample.ts', source, collections), 10);
});

test('the SQL inventory does not count the scoped source helper, auth tables or a prose explanation', () => {
  const source = [
    'const merged = `select * from ${db.tableSource("documents")} where workspace_id = $1`;',
    'const auth = `select * from auth.users`;',
    'const caption = `From ${sender}`;',
    '// select * from public.documents',
  ].join('\n');
  assert.equal(countRawRelations('sample.ts', source, collections), 0);
});

test('no direct document relations are added; shrink the per-file SQL baseline when converting a group', () => {
  const baseline = JSON.parse(fs.readFileSync('sandbox-sql-baseline.json', 'utf8')) as Record<string, number>;
  const actual = scanSandboxSql();
  for (const [file, count] of Object.entries(actual)) {
    assert.ok(count <= (baseline[file] ?? 0), `${file}: ${count} unscoped relations (was ${baseline[file] ?? 0}); use the data layer or db.tableSource()`);
    assert.doesNotMatch(file, /(?:\/reports\/|\/(?:reportRoutes|operationalReportRoutes|balanceRoutes|balanceService|stockMoveService)\.ts$)/,
      'the report/balance read group has a zero budget for direct document relations');
  }
  assert.deepEqual(actual, baseline, 'remove the converted references from the baseline (never add to it)');
});
