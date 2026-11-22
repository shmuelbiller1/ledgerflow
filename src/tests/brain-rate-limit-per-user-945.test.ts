import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('#945: brain limiter is not mounted before auth in server.ts', () => {
  assert.doesNotMatch(read('server.ts'), /app\.use\(\s*["']\/api\/v1\/brain["']\s*,\s*brainRateLimiter/);
});

test('#945: every AI route runs auth before the brain limiter', () => {
  assert.match(read('src/server/routes/brainRoutes.ts'), /["'][^"']*\/analyze["'],\s*apiAuthenticate,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/brainRoutes.ts'), /["'][^"']*\/classify["'],\s*apiAuthenticate,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/developerApiRoutes.ts'), /["'][^"']*\/classify-batch["'],\s*apiAuthenticate,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/aiRoutes.ts'), /["']\/process["'],\s*requireAiUser,\s*brainRateLimiter/);
});
