import test from 'node:test';
import assert from 'node:assert/strict';
import { importEdges } from './import-edges.mjs';

test('extracts literal imports, exports, dynamic imports and glob calls, not comments or text', () => {
  const text = `
    // import "./comment";
    const str = 'export * from "./string"';
    import value, { thing } from './static';
    import './side-effect';
    export { thing } from './export';
    const one = import('./dynamic');
    const two = import.meta.glob('./plugins/*.tsx');
    const unknown = import(variable);
  `;
  assert.deepEqual(importEdges('test.ts', text), ['./static', './side-effect', './export', './dynamic', './plugins/*.tsx']);
});

test('long non-import text is not repeatedly backtracked', () => {
  const input = `import { ${'x '.repeat(100_000)}`;
  assert.deepEqual(importEdges('broken.ts', input), []);
});
