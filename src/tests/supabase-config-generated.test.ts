/**
 * The generated Supabase module must match the JSON it comes from.
 *
 * `supabase-config.json` cannot be imported by source code: a JSON module needs an import attribute that plain
 * Node and Playwright loaders do not supply, and e2e specs import source files directly — one JSON import
 * anywhere made the whole browser suite fail in *setup* (683 tests, zero run). So a generator writes
 * `src/config/supabaseProject.ts` and this test is what keeps someone from editing one and not the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { SUPABASE_PROJECT } from '../config/supabaseProject';

test('the generated project module matches supabase-config.json', () => {
  const json = JSON.parse(readFileSync(path.resolve('supabase-config.json'), 'utf8')) as {
    url?: unknown; publishableKey?: unknown;
  };
  assert.equal(SUPABASE_PROJECT.url, json.url);
  assert.equal(SUPABASE_PROJECT.publishableKey, json.publishableKey);
});

test('no source file imports the JSON directly', () => {
  // a regression here does not fail a unit test — it silently breaks the browser suite's setup
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'tests' && entry.name !== 'node_modules') walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/from\s+['"][^'"]*supabase-config\.json/.test(readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(path.resolve('src'));
  assert.deepEqual(offenders, [], 'import supabaseProject.ts instead — see the generator');
});
