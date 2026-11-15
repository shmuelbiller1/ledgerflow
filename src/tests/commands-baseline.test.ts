import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { scanCommandWrites, type CommandWriteCounts } from '../../scripts/commands-baseline';

type CommandBaseline = Pick<CommandWriteCounts, 'writeRoutes' | 'directBrowserWrites' | 'routeSites' | 'browserSites'>;
const baseline = JSON.parse(fs.readFileSync('commands-baseline.json', 'utf8')) as CommandBaseline;
const current = scanCommandWrites();

function assertSitesDoNotIncrease(kind: 'routeSites' | 'browserSites', label: string): void {
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

test('command baseline totals agree with their per-file counts', () => {
  assert.equal(baseline.writeRoutes, Object.values(baseline.routeSites).reduce((sum, count) => sum + count, 0));
  assert.equal(baseline.directBrowserWrites, Object.values(baseline.browserSites).reduce((sum, count) => sum + count, 0));
});
