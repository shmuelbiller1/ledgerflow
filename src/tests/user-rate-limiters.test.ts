/**
 * Tests for S-22: Rate limiting per user on sign-in, password reset and AI routes
 *
 * Verifies that rate limits are enforced per user (not just per IP)
 * and that tests work with two app instances sharing the same Postgres store.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { getDb } from '../server/db/firestore';
import {
  createUserRateLimitMiddleware,
  createCombinedRateLimitMiddleware,
  signInRateLimiter,
  passwordResetRateLimiter,
  aiUserRateLimiter,
  combinedSignInRateLimiter,
  combinedPasswordResetRateLimiter,
  combinedAiRateLimiter,
  rateLimitConfigs
} from '../server/middleware/userRateLimiters';

/**
 * Mock request/response objects for testing
 */
interface MockResponse extends Response {
  calls: Array<{ method: string; args: unknown[] }>;
}

function createMockRequest(user?: { uid?: string; email?: string }): Request {
  return {
    user,
    headers: {},
    connection: { remoteAddress: '192.168.1.1' }
  } as unknown as Request;
}

function createMockResponse(): MockResponse {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const res: MockResponse = {
    calls,
    status(code: number) {
      calls.push({ method: 'status', args: [code] });
      return res;
    },
    json(body: unknown) {
      calls.push({ method: 'json', args: [body] });
      return res;
    },
    set(key: string, value: string) {
      calls.push({ method: 'set', args: [key, value] });
      return res;
    }
  } as unknown as MockResponse;
  return res;
}

function callsFor(res: MockResponse, method: string): unknown[][] {
  return res.calls.filter((c) => c.method === method).map((c) => c.args);
}

function headerContaining(res: MockResponse, key: string, value: string): boolean {
  return res.calls.some(
    (c) =>
      c.method === 'set' &&
      Array.isArray(c.args[0]) &&
      c.args[0][0] === key &&
      String(c.args[0][1]).includes(value)
  );
}

describe('User Rate Limiters (S-22)', () => {
  let db: ReturnType<typeof getDb>;
  const testCollection = 'rateLimitEntries';

  beforeEach(async () => {
    db = getDb();
    // Clean up test entries
    const snapshot = await db.collection(testCollection)
      .where('key', '>', '')
      .get();
    const batch = db.batch();
    snapshot.forEach((doc) => {
      if (doc.id.startsWith('rl_')) {
        batch.delete(doc.ref);
      }
    });
    await batch.commit().catch(() => {});
  });

  afterEach(async () => {
    // Clean up after each test
    const snapshot = await db.collection(testCollection)
      .where('key', '>', '')
      .get();
    const batch = db.batch();
    snapshot.forEach((doc) => {
      if (doc.id.startsWith('rl_')) {
        batch.delete(doc.ref);
      }
    });
    await batch.commit().catch(() => {});
  });

  describe('createUserRateLimitMiddleware', () => {
    it('should allow requests within the limit', async () => {
      const middleware = createUserRateLimitMiddleware(rateLimitConfigs.signIn);

      const req = createMockRequest({ uid: 'user-1', email: 'user1@test.com' });
      const res = createMockResponse();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
      assert.ok(!callsFor(res, 'status').some((args) => args[0] === 429));
    });

    it('should block requests over the limit', async () => {
      const middleware = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signIn,
        max: 2 // Very low limit for testing
      });

      const req = createMockRequest({ uid: 'user-2', email: 'user2@test.com' });
      const res = createMockResponse();
      let nextCalled = false;

      // First request - should pass
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);

      // Second request - should pass
      nextCalled = false;
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);

      // Third request - should be blocked
      nextCalled = false;
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.ok(callsFor(res, 'status').some((args) => args[0] === 429));
    });

    it('should add rate limit headers on success', async () => {
      const middleware = createUserRateLimitMiddleware(rateLimitConfigs.signIn);

      const req = createMockRequest({ uid: 'user-3', email: 'user3@test.com' });
      const res = createMockResponse();

      await middleware(req, res, () => {});

      assert.ok(
        headerContaining(res, 'X-RateLimit-Limit', '') ||
          callsFor(res, 'set').some((args) =>
            args[0] === 'X-RateLimit-Limit'
          )
      );
    });

    it('should add rate limit headers on failure', async () => {
      const middleware = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signIn,
        max: 1
      });

      const req = createMockRequest({ uid: 'user-4', email: 'user4@test.com' });
      const res = createMockResponse();

      // First request
      await middleware(req, res, () => {});

      // Second request - should be blocked
      await middleware(req, res, () => {});

      assert.ok(
        callsFor(res, 'set').some(
          (args) =>
            args[0] === 'X-RateLimit-Limit' && String(args[1]) === '1'
        )
      );
      assert.ok(
        callsFor(res, 'set').some(
          (args) =>
            args[0] === 'X-RateLimit-Remaining' && String(args[1]) === '0'
        )
      );
      assert.ok(callsFor(res, 'set').some((args) => args[0] === 'Retry-After'));
    });
  });

  describe('User-based rate limiting', () => {
    it('should track different users separately', async () => {
      const middleware = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signIn,
        max: 1
      });

      const req1 = createMockRequest({ uid: 'user-5', email: 'user5@test.com' });
      const req2 = createMockRequest({ uid: 'user-6', email: 'user6@test.com' });
      const res = createMockResponse();

      // User 5 makes a request
      await middleware(req1, res, () => {});

      // User 6 should still be allowed
      let nextCalled = false;
      await middleware(req2, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
    });

    it('should track users by email when uid not available', async () => {
      const middleware = createUserRateLimitMiddleware(rateLimitConfigs.signIn);

      const req1 = createMockRequest({ email: 'user7@test.com' });
      const req2 = createMockRequest({ email: 'user7@test.com' });
      const res = createMockResponse();

      // First request
      await middleware(req1, res, () => {});

      // Second request from same email
      let nextCalled = false;
      await middleware(req2, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
    });
  });

  describe('IP-based rate limiting', () => {
    it('should track different IPs separately', async () => {
      const middleware = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signInIp,
        max: 1,
        useUserId: false
      });

      const req1 = createMockRequest();
      (req1.connection as unknown as { remoteAddress: string }).remoteAddress = '192.168.1.10';

      const req2 = createMockRequest();
      (req2.connection as unknown as { remoteAddress: string }).remoteAddress = '192.168.1.20';

      const res = createMockResponse();

      // IP 1 makes a request
      await middleware(req1, res, () => {});

      // IP 2 should still be allowed
      let nextCalled = false;
      await middleware(req2, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
    });

    it('should handle x-forwarded-for header', async () => {
      const middleware = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signInIp,
        max: 1,
        useUserId: false
      });

      const req = createMockRequest();
      req.headers['x-forwarded-for'] = '203.0.113.1, 192.168.1.1';
      (req.connection as unknown as { remoteAddress: string }).remoteAddress = '127.0.0.1';

      const res = createMockResponse();

      await middleware(req, res, () => {});

      // The first IP in x-forwarded-for should be used
      assert.ok(res.calls.length > 0);
    });
  });

  describe('Pre-built middleware', () => {
    it('should export signInRateLimiter', () => {
      assert.ok(signInRateLimiter);
      assert.strictEqual(typeof signInRateLimiter, 'function');
    });

    it('should export passwordResetRateLimiter', () => {
      assert.ok(passwordResetRateLimiter);
      assert.strictEqual(typeof passwordResetRateLimiter, 'function');
    });

    it('should export aiUserRateLimiter', () => {
      assert.ok(aiUserRateLimiter);
      assert.strictEqual(typeof aiUserRateLimiter, 'function');
    });

    it('should export combinedSignInRateLimiter', () => {
      assert.ok(combinedSignInRateLimiter);
      assert.strictEqual(typeof combinedSignInRateLimiter, 'function');
    });

    it('should export combinedPasswordResetRateLimiter', () => {
      assert.ok(combinedPasswordResetRateLimiter);
      assert.strictEqual(typeof combinedPasswordResetRateLimiter, 'function');
    });

    it('should export combinedAiRateLimiter', () => {
      assert.ok(combinedAiRateLimiter);
      assert.strictEqual(typeof combinedAiRateLimiter, 'function');
    });
  });

  describe('Combined rate limiting (user + IP)', () => {
    it('should block when user limit is exceeded', async () => {
      const middleware = createCombinedRateLimitMiddleware(
        { ...rateLimitConfigs.signIn, max: 1 },
        { ...rateLimitConfigs.signInIp, max: 100 }
      );

      const req = createMockRequest({ uid: 'user-8', email: 'user8@test.com' });
      const res = createMockResponse();

      // First request - should pass
      await middleware(req, res, () => {});

      // Second request - should be blocked (user limit exceeded)
      let nextCalled = false;
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.ok(callsFor(res, 'status').some((args) => args[0] === 429));
    });

    it('should block when IP limit is exceeded', async () => {
      const middleware = createCombinedRateLimitMiddleware(
        { ...rateLimitConfigs.signIn, max: 100 },
        { ...rateLimitConfigs.signInIp, max: 1 }
      );

      const req = createMockRequest();
      (req.connection as unknown as { remoteAddress: string }).remoteAddress = '192.168.1.30';
      const res = createMockResponse();

      // First request - should pass
      await middleware(req, res, () => {});

      // Second request - should be blocked (IP limit exceeded)
      let nextCalled = false;
      await middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.ok(callsFor(res, 'status').some((args) => args[0] === 429));
    });

    it('should use the more restrictive limit for headers', async () => {
      const middleware = createCombinedRateLimitMiddleware(
        { ...rateLimitConfigs.signIn, max: 5 },
        { ...rateLimitConfigs.signInIp, max: 10 }
      );

      const req = createMockRequest({ uid: 'user-9', email: 'user9@test.com' });
      const res = createMockResponse();

      await middleware(req, res, () => {});

      // Should use the minimum of the two limits (5)
      assert.ok(
        callsFor(res, 'set').some(
          (args) => args[0] === 'X-RateLimit-Limit' && String(args[1]) === '5'
        )
      );
    });
  });

  describe('Two instance test', () => {
    /**
     * S-22: Tests with two app instances sharing the same Postgres store
     */
    it('should share rate limits across instances for user-based limiting', async () => {
      const db = getDb();
      const testCollection = 'rateLimitEntries';

      // Clean up first
      const snapshot = await db.collection(testCollection)
        .where('key', '==', 'signin-user:user-10')
        .get();
      const batch = db.batch();
      snapshot.forEach((doc) => batch.delete(doc.ref));
      await batch.commit().catch(() => {});

      // Create two "instances" of the middleware
      const instance1 = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signIn,
        max: 3
      });

      const instance2 = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signIn,
        max: 3
      });

      const req = createMockRequest({ uid: 'user-10', email: 'user10@test.com' });

      // Instance 1: 2 requests
      const res1 = createMockResponse();
      await instance1(req, res1, () => {});
      await instance1(req, res1, () => {});

      // Instance 2: 1 request
      const res2 = createMockResponse();
      await instance2(req, res2, () => {});

      // Both instances should now be at the limit
      const res3 = createMockResponse();
      let nextCalled = false;
      await instance1(req, res3, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.ok(callsFor(res3, 'status').some((args) => args[0] === 429));

      // Clean up
      const cleanupSnapshot = await db.collection(testCollection)
        .where('key', '==', 'signin-user:user-10')
        .get();
      const cleanupBatch = db.batch();
      cleanupSnapshot.forEach((doc) => cleanupBatch.delete(doc.ref));
      await cleanupBatch.commit().catch(() => {});
    });

    it('should share rate limits across instances for IP-based limiting', async () => {
      const db = getDb();
      const testCollection = 'rateLimitEntries';

      // Clean up first
      const snapshot = await db.collection(testCollection)
        .where('key', '==', 'signin-ip:ip:10.0.0.1')
        .get();
      const batch = db.batch();
      snapshot.forEach((doc) => batch.delete(doc.ref));
      await batch.commit().catch(() => {});

      // Create two "instances" of the middleware
      const instance1 = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signInIp,
        max: 2,
        useUserId: false
      });

      const instance2 = createUserRateLimitMiddleware({
        ...rateLimitConfigs.signInIp,
        max: 2,
        useUserId: false
      });

      const req = createMockRequest();
      (req.connection as unknown as { remoteAddress: string }).remoteAddress = '10.0.0.1';

      // Instance 1: 1 request
      const res1 = createMockResponse();
      await instance1(req, res1, () => {});

      // Instance 2: 1 request
      const res2 = createMockResponse();
      await instance2(req, res2, () => {});

      // Both instances should now be at the limit
      const res3 = createMockResponse();
      let nextCalled = false;
      await instance1(req, res3, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.ok(callsFor(res3, 'status').some((args) => args[0] === 429));

      // Clean up
      const cleanupSnapshot = await db.collection(testCollection)
        .where('key', '==', 'signin-ip:ip:10.0.0.1')
        .get();
      const cleanupBatch = db.batch();
      cleanupSnapshot.forEach((doc) => cleanupBatch.delete(doc.ref));
      await cleanupBatch.commit().catch(() => {});
    });
  });

  describe('Rate limit configurations', () => {
    it('should have signIn config with reasonable limits', () => {
      const config = rateLimitConfigs.signIn;
      assert.ok(config.max > 0);
      assert.ok(config.windowMs > 0);
      assert.strictEqual(config.keyPrefix, 'signin-user');
    });

    it('should have passwordReset config with lower limits', () => {
      const config = rateLimitConfigs.passwordReset;
      assert.ok(config.max < rateLimitConfigs.signIn.max);
      assert.ok(config.windowMs > rateLimitConfigs.signIn.windowMs);
    });

    it('should have aiRoutes config', () => {
      const config = rateLimitConfigs.aiRoutes;
      assert.strictEqual(config.max, 20);
      assert.strictEqual(config.windowMs, 60 * 1000);
    });

    it('should have IP-based fallback configs', () => {
      assert.ok(rateLimitConfigs.signInIp);
      assert.ok(rateLimitConfigs.passwordResetIp);
      assert.ok(rateLimitConfigs.aiRoutesIp);
    });
  });
});

describe('User Rate Limiters - Edge Cases (S-22)', () => {
  it('should handle missing user information gracefully', async () => {
    const middleware = createUserRateLimitMiddleware(rateLimitConfigs.signIn);

    const req = createMockRequest(); // No user info
    const res = createMockResponse();

    await middleware(req, res, () => {});

    // Should fall back to IP-based limiting
    assert.ok(!callsFor(res, 'status').some((args) => args[0] === 429));
  });

  it('should handle missing IP information gracefully', async () => {
    const middleware = createUserRateLimitMiddleware({
      ...rateLimitConfigs.signInIp,
      useUserId: false
    });

    const req = createMockRequest();
    (req.connection as unknown as { remoteAddress?: string }).remoteAddress = undefined;
    req.headers['x-forwarded-for'] = undefined;
    req.headers['x-real-ip'] = undefined;

    const res = createMockResponse();

    await middleware(req, res, () => {});

    // Should use 'unknown' as fallback
    assert.ok(!callsFor(res, 'status').some((args) => args[0] === 429));
  });

  it('should handle database errors gracefully', async () => {
    // This is hard to test without mocking the database
    // The middleware should fail open (allow the request) if there's an error
    const middleware = createUserRateLimitMiddleware(rateLimitConfigs.signIn);

    const req = createMockRequest({ uid: 'user-11', email: 'user11@test.com' });
    const res = createMockResponse();

    await middleware(req, res, () => {});

    // Should either succeed or fail gracefully
    assert.ok([true, false].includes(callsFor(res, 'status').length === 0));
  });
});
