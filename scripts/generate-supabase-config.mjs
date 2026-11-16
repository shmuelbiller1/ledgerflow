#!/usr/bin/env node
/**
 * `supabase-config.json` → `src/config/supabaseProject.ts`.
 *
 * The JSON is the editable source (the project URL and publishable key are public, like the old Firebase web
 * config). It cannot be *imported* though: a JSON module needs an import attribute (`with { type: 'json' }`)
 * that Playwright's and Node's plain loaders do not supply for our source files, and enough of our source is
 * imported directly by e2e specs that one JSON import anywhere broke the whole browser suite's setup.
 *
 * So the JSON is read here, at build/prepare time, and written out as a plain TypeScript module. `npm run
 * supabase:config` refreshes it; CI and `prebuild` run it, and `src/tests/supabase-config-generated.test.ts`
 * fails if the two ever disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'supabase-config.json');
const target = path.join(root, 'src/config/supabaseProject.ts');

const config = JSON.parse(readFileSync(source, 'utf8'));
if (typeof config.url !== 'string' || typeof config.publishableKey !== 'string') {
  throw new Error('supabase-config.json must have `url` and `publishableKey` strings');
}

const generated = `/**
 * GENERATED from supabase-config.json by scripts/generate-supabase-config.mjs — do not edit.
 *
 * Kept as a TypeScript module rather than importing the JSON: a JSON import needs an attribute plain Node
 * and Playwright loaders do not supply, and e2e specs import source files directly.
 */
export const SUPABASE_PROJECT = {
  url: ${JSON.stringify(config.url)},
  publishableKey: ${JSON.stringify(config.publishableKey)},
} as const;
`;

const previous = (() => { try { return readFileSync(target, 'utf8'); } catch { return null; } })();
if (previous !== generated) {
  writeFileSync(target, generated);
  console.log(`supabase-project: wrote ${path.relative(root, target)}`);
} else {
  console.log('supabase-project: up to date');
}
