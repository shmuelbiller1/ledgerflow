/**
 * S-45: rate limit on the assistant turn route. Many turns from one user in a minute are refused
 * politely before any model call; another user in the same workspace is not affected. The route is
 * the production one: `createSandboxPersonRouter` with its default `brainRateLimiter` (the shared
 * Postgres limiter, 20 per minute keyed per signed-in person), against real PostgreSQL.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupHost, scriptedModel, startAssistantFixture, type AssistantFixture, type ScriptedModel } from './helpers/assistantTurnHarness';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
const QUESTION = 'Summarize how the business is doing lately';

describe('S-45: the assistant turn route is rate limited per person, politely and before the model', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL', timeout: 120_000 }, () => {
  const host = cleanupHost();
  let model: ScriptedModel;
  let f: AssistantFixture;

  before(async () => {
    model = scriptedModel(() => ({ text: 'Trading steadily.' }));
    // no turnRateLimit override: the production brainRateLimiter is what runs
    f = await startAssistantFixture(host, { modelClient: () => model.client });
  });

  after(async () => { await host.run(); });

  it('one user\'s burst is refused politely without a model call; another user in the workspace is unaffected', async () => {
    let ok = 0;
    let refused = 0;
    let callsAtFirstRefusal = -1;
    // 45 turns span at most two one-minute windows, so a refusal is guaranteed whatever the clock
    for (let i = 0; i < 45; i++) {
      const result = await f.turn(QUESTION);
      if (result.status === 200) {
        ok++;
        assert.equal(result.headers['ratelimit-limit'], '20', 'the real limit is 20 turns a minute per person');
        continue;
      }
      refused++;
      if (callsAtFirstRefusal < 0) callsAtFirstRefusal = model.requests.length;
      assert.equal(result.status, 429, JSON.stringify(result.json));
      assert.equal(result.json.code, 'RATE_LIMIT_EXCEEDED');
      assert.match(String(result.json.message), /Try again later/i, 'the refusal is a polite sentence, not a crash');
      assert.ok(Number(result.headers['retry-after']) >= 1, 'the refusal says when to retry');
    }
    assert.ok(refused >= 1, `the burst must meet a refusal: ${ok} allowed`);
    assert.equal(callsAtFirstRefusal, ok, 'the model is never called for a refused turn');
    assert.equal(model.requests.length, ok, 'every model call belongs to an allowed turn');

    const other = await f.liveTurn(QUESTION, f.teammate);
    assert.equal(other.status, 200, `another member of the same books must not share the bucket: ${JSON.stringify(other.json)}`);
    assert.equal(other.json.path, 'model');
    assert.equal(model.requests.length, ok + 1);
  });
});
