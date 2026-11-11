import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('M-4: Shared workspace membership helper guard', () => {
  // Legitimate array mutations on `members` when accepting an invite or removing a deleted account:
  // never authorization checks.
  const ALLOWED_ARRAY_MUTATION_FILES = new Set([
    'src/server/db/firestore.ts',
    'src/server/routes/invitePublicRoutes.ts',
    'src/server/services/accountDeletionService.ts',
  ]);

  it('forbids inline ws.members.includes(...) authorization checks outside src/server/db/firestore.ts', () => {
    const root = process.cwd();
    const serverDir = path.join(root, 'src/server');
    const offenders: string[] = [];

    for (const fullPath of collectTsFiles(serverDir)) {
      const rel = path.relative(root, fullPath).replace(/\\/g, '/');
      if (ALLOWED_ARRAY_MUTATION_FILES.has(rel)) continue;
      const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (/members\??\.includes\s*\(/.test(line)) {
          offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `Inline workspace membership checks found outside isWorkspaceMemberData/validateWorkspaceMember:\n${offenders.join('\n')}`,
    );
  });
});
