import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sharedRateLimitMiddleware, type SharedRateLimiter } from '../server/middleware/sharedRateLimiter';
import { brainRateLimitKey } from '../server/middleware/rateLimiters';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** In-memory stand-in for the shared limiter: `max` calls per key. */
function memoryLimiter(max: number): SharedRateLimiter {
  const hits = new Map<string, number>();
  return {
    async checkAndIncrement(key: string) {
      const n = (hits.get(key) ?? 0) + 1;
      hits.set(key, n);
      return { allowed: n <= max, limit: max, remaining: Math.max(0, max - n), resetTime: Date.now() + 60_000 };
    },
  } as unknown as SharedRateLimiter;
}

async function withApp(run: (call: (who: string) => Promise<number>) => Promise<void>) {
  const app = express();
  // Stand-in for auth: the header names the verified caller; every request comes from one IP.
  app.post('/brain', (req, _res, next) => {
    const who = String(req.header('x-test-user'));
    (req as typeof req & { user?: unknown }).user = who.startsWith('key:')
      ? { uid: 'creator', usedApiKeyId: who.slice(4) }
      : { uid: who };
    next();
  }, sharedRateLimitMiddleware(memoryLimiter(2), brainRateLimitKey), (_req, res) => { res.json({ ok: true }); });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(async who => (await fetch(`http://127.0.0.1:${port}/brain`, { method: 'POST', headers: { 'x-test-user': who } })).status);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('#945: two users behind one IP have separate brain buckets', async () => {
  await withApp(async call => {
    assert.equal(await call('alice'), 200);
    assert.equal(await call('alice'), 200);
    assert.equal(await call('alice'), 429);
    assert.equal(await call('bob'), 200, 'bob must not be blocked by alice on the same IP');
  });
});

test('#945: an API key has its own bucket, separate from its creator and other keys', async () => {
  await withApp(async call => {
    assert.equal(await call('key:k1'), 200);
    assert.equal(await call('key:k1'), 200);
    assert.equal(await call('key:k1'), 429);
    assert.equal(await call('key:k2'), 200);
    assert.equal(await call('creator'), 200);
  });
});

test('#945: AI routes mount the limiter after auth, never before it', () => {
  assert.doesNotMatch(read('server.ts'), /app\.use\(\s*["']\/api\/v1\/brain["']\s*,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/brainRoutes.ts'), /["'][^"']*\/analyze["'],\s*apiAuthenticate,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/brainRoutes.ts'), /["'][^"']*\/classify["'],\s*apiAuthenticate,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/developerApiRoutes.ts'), /["'][^"']*\/classify-batch["'],\s*apiAuthenticate,\s*brainRateLimiter/);
  assert.match(read('src/server/routes/aiRoutes.ts'), /["']\/process["'],\s*requireAiUser,\s*brainRateLimiter/);
});
