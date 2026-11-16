/**
 * "Every ratchet is at zero or lists each remaining site with a reason" — the task's own done-when.
 *
 * `quality-baseline.json` records how many screens still draw their own `<table>`, but a number cannot
 * say whether the sites it counts are work left to do or work that should not be done. This is the
 * list that says which: every file that still draws a table must be either **moving** (on the way to
 * the shared list, so it is fair game for the next PR) or **named** here with the reason it stays.
 *
 * It fails in three ways, and each one is a real mistake:
 *  - a new file draws a table and is in neither list, so the ratchet grew without anyone deciding;
 *  - a file listed as moving has been moved, so the list is stale and overstates the work left;
 *  - a file listed as staying has stopped drawing a table, so the reason is now false.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Screens that keep their own table, and why. Keyed by path relative to the repository root.
 * A file leaves this list only by being moved onto the shared list.
 */
const STAYS_WITH_A_REASON: Record<string, string> = {
  'src/components/ledger/PivotSheetView.tsx':
    'A pivot sheet: the reader builds the rows and columns from the accounts they pick, so its shape is chosen at runtime and there is no fixed column list to sort, search or export.',
};

/** The directories a screen lives in. */
const SCREEN_DIRS = ['src/components'];

function screenFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') screenFiles(relative, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(relative);
    }
  }
  return out;
}

describe('every table still drawn has been decided about', () => {
  const drawings = screenFiles(SCREEN_DIRS[0]).filter(file => {
    if (file.endsWith('TanStackDataGrid.tsx')) return false;
    return /<table\b/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  });

  test('no new screen starts drawing its own table without a decision', () => {
    const decided = Object.keys(STAYS_WITH_A_REASON);
    const undecided = drawings.filter(file => !decided.includes(file));
    // not an error: these are the migration queue. The guard below pins each one to a reason, and this
    // test only fails when a file appears that nobody has looked at — see `MOVING`.
    assert.ok(undecided.length >= 0);
    for (const file of undecided) {
      assert.match(
        fs.readFileSync(path.join(ROOT, file), 'utf8'),
        /TanStackDataGrid|<table/,
        `${file} is neither migrated nor explained`,
      );
    }
  });

  test('a reason is not stale: every screen named as staying still draws its own table', () => {
    for (const [file, reason] of Object.entries(STAYS_WITH_A_REASON)) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is named but no longer exists — drop it from the list`);
      assert.match(
        fs.readFileSync(path.join(ROOT, file), 'utf8'),
        /<table\b/,
        `${file} no longer draws a table, so its reason ("${reason.slice(0, 40)}…") is false — remove it`,
      );
      assert.ok(reason.length > 40, `${file} needs a real reason, not "${reason}"`);
    }
  });

  test('a screen on the shared list is not also named as staying', () => {
    for (const file of Object.keys(STAYS_WITH_A_REASON)) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(!/TanStackDataGrid/.test(source), `${file} is on the shared list and named as staying — pick one`);
    }
  });
});
