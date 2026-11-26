import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { aiCreditBalance, creditsForCostCents, markupFor, DEFAULT_AI_MARKUP, PLAN_AI_CREDITS } from '../lib/aiCredits';
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
  test('admin AI overrides cannot come back in a workspace backup', async () => {
    const { PROTECTED_WORKSPACE_FIELDS } = await import('../server/services/workspaceRestoreService');
    for (const f of ['aiUnlimited', 'aiCreditsGranted', 'aiCreditsGrantedMonth', 'aiCreditsPlanOverride', 'aiCreditMarkup', 'maxAssistantCents', 'maxAssistantModelTurns'])
      assert.ok(PROTECTED_WORKSPACE_FIELDS.has(f), f);
  });
});
