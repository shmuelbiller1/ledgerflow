import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orphanFiles } from '../../scripts/module-graph.mjs';

test('Reachability Guard: True import graph walk from entry points (static + dynamic + globs)', () => {
  const orphanedFiles = orphanFiles(process.cwd(), ['src/tests/reachability-guard.test.ts']);
  assert.deepStrictEqual(
    orphanedFiles,
    [],
    `Found ${orphanedFiles.length} orphaned source files not reachable via import graph from entry points:\n` + orphanedFiles.join('\n')
  );
});
