import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aiCreditBalance, creditsForCostCents, markupFor, settleCredits, DEFAULT_AI_MARKUP, PLAN_AI_CREDITS, RESERVED_TURN_CREDITS } from '../lib/aiCredits';
import { assistantLimitRefusal, type AssistantUsage } from '../server/middleware/planCapacity';

describe('AI credits', () => {
  test('price is cost plus 20% markup, 1 credit = $0.001, exact for tiny calls, nothing for free answers', () => {
    assert.equal(DEFAULT_AI_MARKUP, 0.2);
    assert.equal(creditsForCostCents(1), 12);
    assert.ok(Math.abs(creditsForCostCents(0.06) - 0.72) < 1e-9);
    assert.equal(creditsForCostCents(0), 0);
    assert.equal(creditsForCostCents(Number.NaN), 0);
    assert.equal(creditsForCostCents(1, 0), 10);
  });
  test('admin markup override is used only when sensible', () => {
    assert.equal(markupFor({ aiCreditMarkup: 0 }), 0);
    assert.equal(markupFor({ aiCreditMarkup: 0.5 }), 0.5);
    assert.equal(markupFor({ aiCreditMarkup: -1 }), DEFAULT_AI_MARKUP);
    assert.equal(markupFor({ aiCreditMarkup: 'x' }), DEFAULT_AI_MARKUP);
    assert.equal(markupFor({}), DEFAULT_AI_MARKUP);
  });
  test('balance: plan credits, "treat as plan" override, grants, reset date, unlimited', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const free = aiCreditBalance({ plan: 'free' }, 10, now);
    assert.deepEqual({ included: free.included, used: free.used, left: free.left, resetsOn: free.resetsOn }, { included: 250, used: 120, left: 130, resetsOn: '2026-12-01' });
    assert.equal(aiCreditBalance({ plan: 'free', aiCreditsPlanOverride: 'pro' }, 0, now).included, PLAN_AI_CREDITS.pro);
    assert.equal(aiCreditBalance({ plan: 'growth', aiCreditsGranted: 1000, aiCreditsGrantedMonth: '2026-11' }, 0, now).left, 6000);
    assert.equal(aiCreditBalance({ plan: 'growth', aiCreditsGranted: 1000, aiCreditsGrantedMonth: '2026-10' }, 0, now).left, 5000, 'a grant is not spent again next month');
    assert.equal(aiCreditBalance({ plan: 'growth', aiCreditsGranted: 1000 }, 0, now).granted, 0, 'a grant without its month never counts');
    assert.equal(aiCreditBalance({ plan: 'free' }, 1e6, now).left, 0, 'never negative');
    assert.equal(aiCreditBalance({ plan: 'unknown' }, 0, now).included, 250);
    assert.equal(aiCreditBalance({ aiUnlimited: true }, 0, now).unlimited, true);
    assert.equal(aiCreditBalance({ plan: 'free' }, 0, new Date('2026-12-31T23:00:00Z')).resetsOn, '2027-01-01');
  });
  test('the assistant is refused when credits run out, not when unlimited', () => {
    const base: AssistantUsage = { month: '2026-11', turns: 0, modelTurns: 0, inputTokens: 0, outputTokens: 0, costCents: 0, unpricedTurns: 0,
      limits: { modelTurns: 1000, costCents: 100000 } };
    const now = new Date('2026-11-26T12:00:00Z');
    assert.equal(assistantLimitRefusal({ ...base, credits: aiCreditBalance({ plan: 'free' }, 10, now) }), null);
    const out = assistantLimitRefusal({ ...base, credits: aiCreditBalance({ plan: 'free' }, 21, now) });
    assert.equal(out?.code, 'ASSISTANT_LIMIT_REACHED');
    assert.match(out!.message, /AI credits/);
    assert.equal(assistantLimitRefusal({ ...base, credits: aiCreditBalance({ plan: 'free', aiUnlimited: true }, 21, now) }), null);
    const pastCostCap = { ...base, modelTurns: 10, costCents: 2000, limits: { modelTurns: 50, costCents: 25 } };
    assert.equal(assistantLimitRefusal({ ...pastCostCap, credits: aiCreditBalance({ plan: 'free', aiCreditsPlanOverride: 'pro' }, 2000, now) }), null,
      'credits, not the old cost cap, decide: "treat as Pro" really permits more');
  });
  test('the balance after a turn includes what it just used', () => {
    const before = aiCreditBalance({ plan: 'free' }, 0, new Date('2026-11-26T12:00:00Z'));
    const after = settleCredits(before, 12);
    assert.deepEqual({ used: after.used, left: after.left }, { used: 12, left: 238 });
    assert.equal(settleCredits(before, 0).left, 250, 'a failed turn is free');
  });
  test('admin AI overrides cannot come back in a workspace backup', async () => {
    const { PROTECTED_WORKSPACE_FIELDS } = await import('../server/services/workspaceRestoreService');
    for (const f of ['aiUnlimited', 'aiCreditsGranted', 'aiCreditsGrantedMonth', 'aiCreditsPlanOverride', 'aiCreditMarkup', 'maxAssistantCents', 'maxAssistantModelTurns'])
      assert.ok(PROTECTED_WORKSPACE_FIELDS.has(f), f);
  });
});

const dbUrl = process.env.LF_TEST_DATABASE_URL;
describe('AI credits against the database', { skip: !dbUrl && 'LF_TEST_DATABASE_URL not set' }, () => {
  test('failed turns are free, and a markup change never reprices settled turns', async () => {
    const { Firestore } = await import('../server/db/firestore');
    const { assistantUsage } = await import('../server/middleware/planCapacity');
    const { recordAssistantTurn } = await import('../server/services/assistantTurn');
    const db = new Firestore({ connectionString: dbUrl, max: 2 });
    const workspaceId = `ws-credits-${Date.now()}`;
    try {
      await db.collection('workspaces').doc(workspaceId).set({ id: workspaceId, plan: 'free' });
      const metric = (ok: boolean, costCents: number) => ({ path: 'model', modelCalls: 1, inputTokens: 10, outputTokens: 10, costCents, ok, answerMs: 1, totalMs: 1 });
      await recordAssistantTurn(db, workspaceId, 'u1', metric(true, 10) as never, undefined, 0.2);
      await recordAssistantTurn(db, workspaceId, 'u1', metric(false, 50) as never, undefined, 0.2);
      // an older row from before credits: priced at today's markup, unless it failed
      await db.collection('billingLedgerTraces').doc(`legacy-${workspaceId}`).set({ id: `legacy-${workspaceId}`, workspaceId, algorithmName: 'ASSISTANT_TURN',
        timestamp: new Date().toISOString(), assistantTurn: metric(true, 5) });
      await db.collection('billingLedgerTraces').doc(`legacy-fail-${workspaceId}`).set({ id: `legacy-fail-${workspaceId}`, workspaceId, algorithmName: 'ASSISTANT_TURN',
        timestamp: new Date().toISOString(), assistantTurn: metric(false, 99) });
      // a reservation holds credits until it is settled, so a turn asked at the same moment sees them as spent
      const { reserveAssistantModelTurn } = await import('../server/middleware/planCapacity');
      const ws = (await db.collection('workspaces').doc(workspaceId).get()).data()!;
      const held = await reserveAssistantModelTurn(db, workspaceId, 'u1', ws);
      assert.ok('id' in held);
      const during = await assistantUsage(db, workspaceId);
      assert.ok(Math.abs(during!.credits!.used - (120 + 60 + RESERVED_TURN_CREDITS)) < 1e-6, `held ${during!.credits!.used}`);
      await recordAssistantTurn(db, workspaceId, 'u1', metric(false, 7) as never, (held as { id: string }).id, 0.2);
      // 20 credits left: two turns asked together hold 15 then 5, never more than the balance; a third is refused
      const near = await assistantUsage(db, workspaceId);
      const leftNow = near!.credits!.included - near!.credits!.used;
      // a settled turn that uses all but 20 credits
      await db.collection('billingLedgerTraces').doc(`spend-${workspaceId}`).set({ id: `spend-${workspaceId}`, workspaceId, algorithmName: 'ASSISTANT_TURN',
        timestamp: new Date().toISOString(), assistantTurn: metric(true, 0), aiCredits: leftNow - 20 });
      const wsNear = (await db.collection('workspaces').doc(workspaceId).get()).data()!;
      const [a, b] = await Promise.all([reserveAssistantModelTurn(db, workspaceId, 'u1', wsNear), reserveAssistantModelTurn(db, workspaceId, 'u1', wsNear)]);
      assert.ok('id' in a && 'id' in b);
      const both = await assistantUsage(db, workspaceId);
      assert.ok(both!.credits!.included + both!.credits!.granted - both!.credits!.used > -1e-6, 'holds never exceed the balance');
      const third = await reserveAssistantModelTurn(db, workspaceId, 'u1', wsNear);
      assert.ok('refusal' in third, 'nothing left to hold: refused');
      for (const r of [a, b]) await recordAssistantTurn(db, workspaceId, 'u1', metric(false, 0) as never, (r as { id: string }).id, 0.2);
      await db.collection('billingLedgerTraces').doc(`spend-${workspaceId}`).delete();
      // a hold whose turn never settled lapses after 10 minutes
      await db.collection('billingLedgerTraces').doc(`stale-${workspaceId}`).set({ id: `stale-${workspaceId}`, workspaceId, algorithmName: 'ASSISTANT_TURN',
        timestamp: new Date(Date.now() - 11 * 60 * 1000).toISOString(), aiCredits: RESERVED_TURN_CREDITS,
        assistantTurn: { reserved: true, path: 'model', modelCalls: 1, inputTokens: 0, outputTokens: 0, costCents: 0, ok: false } });
      const before = await assistantUsage(db, workspaceId);
      assert.ok(Math.abs(before!.credits!.used - (120 + 60)) < 1e-6, `used ${before!.credits!.used}`);
      await db.collection('workspaces').doc(workspaceId).update({ aiCreditMarkup: 1 });
      const after = await assistantUsage(db, workspaceId);
      assert.ok(Math.abs(after!.credits!.used - (120 + 100)) < 1e-6, 'the settled turn keeps its 120 credits; only the older row follows the new markup');
    } finally {
      await db.pool.query(`delete from ${db.tableSource('billingLedgerTraces')} where workspace_id = $1`, [workspaceId]).catch(() => undefined);
      await db.collection('workspaces').doc(workspaceId).delete().catch(() => undefined);
      await db.pool.end();
    }
  });
});
