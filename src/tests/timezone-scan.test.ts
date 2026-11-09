/**
 * F-14 — every date a screen shows or saves comes from the workspace's date helpers.
 *
 * The classic failure is not an import: it is a screen that works out "today" from the
 * machine's UTC clock (`new Date().toISOString().slice(0, 10)`), so a workspace in
 * Jerusalem or Auckland gets yesterday's date late in the evening, or a date saved as one
 * day and shown as another. This scan fails when a screen or hook derives a calendar day
 * that way. It reports the file and line so the fix is a two-line change.
 *
 * What is allowed: `getLocalDateISO` / `workspaceYearMonth` (the helpers), parsing an
 * explicit ISO date with a `Z` suffix, and Intl formatting chosen by the caller.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filesIn } from './helpers/repoScan';

/** Patterns that derive a calendar day from the machine clock in UTC. */
const UNSAFE: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/, why: 'UTC today: use getLocalDateISO()' },
  { pattern: /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/, why: 'UTC today: use getLocalDateISO()' },
  { pattern: /\btoISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/, why: 'UTC day from a local instant: build the day with the date helpers' },
];

const screens = [...filesIn('src/components'), ...filesIn('src/hooks')];

describe('F-14 time zone scan', () => {
  test('no screen or hook derives today from the UTC clock', () => {
    const found: string[] = [];
    for (const file of screens) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        for (const { pattern, why } of UNSAFE) {
          if (pattern.test(line)) found.push(`${file}:${index + 1} — ${why}\n    ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(found, [], `Screens deriving dates from UTC:\n${found.join('\n')}`);
  });

  test('the helpers used instead are the workspace ones', () => {
    // The helpers are defined in calendarDate.ts and re-exported from utils.ts, so the definition is
    // asserted where it lives and the re-export is asserted separately: a caller importing either
    // module gets the same timezone-aware function.
    const calendarDate = fs.readFileSync('src/lib/calendarDate.ts', 'utf8');
    assert.match(calendarDate, /export function getLocalDateISO/, 'getLocalDateISO is defined');
    assert.match(calendarDate, /export function workspaceYearMonth/, 'workspaceYearMonth is defined');
    // and the helper itself respects an explicit time zone
    assert.match(calendarDate, /Intl\.DateTimeFormat\([^)]*timeZone/s, 'getDateInTimezoneISO formats in a time zone');

    const utils = fs.readFileSync('src/lib/utils.ts', 'utf8');
    assert.match(utils, /\bgetLocalDateISO\b/, 'utils.ts still re-exports getLocalDateISO');
    assert.match(utils, /\bworkspaceYearMonth\b/, 'utils.ts still re-exports workspaceYearMonth');
  });

  test('the scan actually sees the screens (guards against an empty run)', () => {
    assert.ok(screens.length > 100, `only ${screens.length} files scanned`);
    assert.ok(screens.some(f => f.includes('StatementView')), 'a known screen is in scope');
  });
});
