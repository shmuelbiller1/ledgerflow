/**
 * Shared helpers for the tests that scan the repository's own source.
 *
 * Several guards (the timezone scan, the toast-wording scan, the architecture-layer scan) walk
 * the same tree and test the same "is this a source file" rule. Keeping one copy means a new test
 * cannot accidentally scan a different set — or a stale copy of the rule.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every `.ts`/`.tsx` source file under `dir`, recursively, excluding test files.
 * Returns an empty list when the directory does not exist, so a moved folder fails the caller's
 * own "the scan saw something" assertion instead of throwing here.
 */
export function filesIn(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}
