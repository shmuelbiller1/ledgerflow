import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { COMMAND_ROUTE_PROTOCOLS } from '../../scripts/command-route-protocols';
import { isDirectBrowserWrite, matchingUnconvertedPosts, PROVIDER_ROUTE_EXCEPTIONS, READ_ONLY_ROUTE_EXCEPTIONS, scanCommandWrites, scanNonCommandRegistrations, type CommandWriteCounts } from '../../scripts/commands-baseline';

type CommandBaseline = Pick<CommandWriteCounts, 'writeRoutes' | 'directBrowserWrites' | 'routeSites' | 'browserSites' | 'localStoreWrites' | 'localStoreSites'>;
const baseline = JSON.parse(fs.readFileSync('commands-baseline.json', 'utf8')) as CommandBaseline;
const current = scanCommandWrites();

function assertSitesDoNotIncrease(kind: 'routeSites' | 'browserSites' | 'localStoreSites', label: string): void {
  const increases = Object.entries(current[kind])
    .filter(([file, count]) => count > (baseline[kind][file] ?? 0))
    .map(([file, count]) => `${file}: ${count} > ${baseline[kind][file] ?? 0}`);
  assert.deepEqual(increases, [], `${label} write sites may only decrease; route new writes through commands`);
}

test('command migration ratchet: write routes never increase by file', () => {
  assertSitesDoNotIncrease('routeSites', 'Non-command server route');
  assert.ok(current.writeRoutes <= baseline.writeRoutes, `${current.writeRoutes} write routes > baseline ${baseline.writeRoutes}`);
});

test('command migration ratchet: direct browser writes never increase by file', () => {
  assertSitesDoNotIncrease('browserSites', 'Direct browser');
  assert.ok(current.directBrowserWrites <= baseline.directBrowserWrites,
    `${current.directBrowserWrites} direct browser writes > baseline ${baseline.directBrowserWrites}`);
});

test('the sample company\'s own store is counted, and only shrinks', () => {
  // the demo has no workspace on the server, so its writes go to the in-memory guest database — through
  // `src/lib/db/localStore.ts`, which asserts a guest session before every call. They are counted here so
  // "the browser writes in exactly two places" stays a measurement: a file outside `src/lib/db` that gains
  // one still fails the test above, and the local store may not grow either.
  assertSitesDoNotIncrease('localStoreSites', 'Local store');
  assert.ok(current.localStoreWrites <= baseline.localStoreWrites,
    `${current.localStoreWrites} local-store writes > baseline ${baseline.localStoreWrites}`);
});

test('command baseline totals agree with their per-file counts', () => {
  assert.equal(baseline.writeRoutes, Object.values(baseline.routeSites).reduce((sum, count) => sum + count, 0));
  assert.equal(baseline.directBrowserWrites, Object.values(baseline.browserSites).reduce((sum, count) => sum + count, 0));
  assert.equal(baseline.localStoreWrites, Object.values(baseline.localStoreSites).reduce((sum, count) => sum + count, 0));
});

test('each scoped POST exception still names exactly one unconverted registration and has a reason', () => {
  const exceptions = [...READ_ONLY_ROUTE_EXCEPTIONS, ...PROVIDER_ROUTE_EXCEPTIONS];
  const keys = new Set<string>();
  for (const exception of exceptions) {
    const key = `${exception.file}:${exception.route}`;
    assert.equal(keys.has(key), false, `duplicate exception: ${key}`);
    keys.add(key);
    assert.equal(matchingUnconvertedPosts(exception), 1, `${key} must be a real, unconverted POST`);
    assert.ok(exception.why.length > 40, `${key} explains why this route does not run a command`);
  }
});

test('every counted protocol matches one exact registration, including path expressions and DELETE', () => {
  const keyFor = ({ method, file, route, expression }: ReturnType<typeof scanNonCommandRegistrations>[number]) =>
    `${file}:${method.toUpperCase()} ${expression ? 'expression:' : ''}${route}`;
  const actual = scanNonCommandRegistrations().map(keyFor);
  const reviewed = COMMAND_ROUTE_PROTOCOLS.map(keyFor);
  assert.equal(new Set(reviewed).size, reviewed.length, 'no duplicate reviewed registration');
  assert.deepEqual(actual.toSorted(), reviewed.toSorted(), 'new sites must call a command or be reviewed individually');
  for (const protocol of COMMAND_ROUTE_PROTOCOLS) {
    assert.ok(protocol.why.length > 40 && protocol.tests.length > 0, keyFor(protocol));
    for (const testFile of protocol.tests) assert.ok(fs.existsSync(`src/tests/${testFile}`), `${keyFor(protocol)}: ${testFile} not found`);
  }
});

test('browser write inventory sees PostgREST DML and RPCs without confusing reads or local state updates', () => {
  const fixture = ts.createSourceFile('write-fixture.ts', `
    db.client().from('dimensionNodes').insert(value);
    supabase.from('customers').upsert(value).select();
    supabase.from('projects')['update'](value).eq('id', id);
    supabase['from']('vendors').delete().eq('id', id);
    supabase['rpc'](\`lf_batch\`, args);
    supabase.rpc('lf_set', args);
    supabase.rpc('lf_update', args);
    supabase.rpc('lf_delete', args);
    setDoc(ref, value);
    supabase.from('dimensionNodes').select();
    supabase.rpc('lf_select', args);
    draft.delete(id);
    query.update(field);
  `, ts.ScriptTarget.Latest, true);
  const statements = fixture.statements.map(statement => {
    const sites: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isDirectBrowserWrite(node)) sites.push(node.getText());
      ts.forEachChild(node, visit);
    };
    visit(statement);
    return sites.length;
  });
  assert.deepEqual(statements, [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
});
