import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, type Rule } from '../lib/rules/rules';
import type { ComposedFacts, FactAttribute } from '../lib/rules/facts';

function createRng(seed = 123456789) {
  let s = seed;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Rule Engine Property Invariants (D-34)', () => {
  const rng = createRng(987654321);

  function randomString(len = 6): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < len; i++) {
      res += chars[Math.floor(rng() * chars.length)];
    }
    return res;
  }

  it('Property 1 (Exclusion Dominance): An active exclude rule strictly displaces its target and never allows it into applied', () => {
    for (let trial = 0; trial < 100; trial++) {
      const targetRuleId = `target_${randomString(4)}`;
      const excludeRuleId = `exclude_${randomString(4)}`;
      const testDate = '2026-06-15';

      const targetRule: Rule<string> = {
        id: targetRuleId,
        name: 'Target Tax Rule',
        scope: 'line',
        when: [{ attribute: 'taxTreatment', op: 'exists' }],
        combine: 'accumulate',
        effect: '17% Standard Tax',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        source: { authority: 'Tax Authority', url: 'https://example.com' },
        status: 'filing-ready',
      };

      const excludeRule: Rule<string> = {
        id: excludeRuleId,
        name: 'Osek Patur Exemption',
        scope: 'line',
        when: [{ attribute: 'taxTreatment', op: 'exists' }],
        combine: 'exclude',
        targets: [targetRuleId],
        effect: '0% Exempt',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        source: { authority: 'Tax Authority', url: 'https://example.com' },
        status: 'filing-ready',
      };

      const composed: ComposedFacts = {
        facts: {
          taxTreatment: { attribute: 'taxTreatment', values: ['il_osek_patur'], from: ['books'], verified: true },
        },
        conflicts: [],
      };

      const outcome = evaluateRules([targetRule, excludeRule], composed, {
        date: testDate,
        scope: 'line',
      });

      // Target must NOT be applied
      const appliedIds = outcome.applied.map(a => a.rule.id);
      assert.ok(!appliedIds.includes(targetRuleId), `Target rule ${targetRuleId} should not be in applied`);

      // Target must be in displaced by excludeRule
      const displacedTarget = outcome.displaced.find(d => d.rule.id === targetRuleId);
      assert.ok(displacedTarget, `Target rule ${targetRuleId} must be in displaced`);
      assert.equal(displacedTarget.by, excludeRuleId, `Displaced by must be ${excludeRuleId}`);

      // Exclude rule itself must be in applied
      assert.ok(appliedIds.includes(excludeRuleId), `Exclude rule ${excludeRuleId} must be applied`);
    }
  });

  it('Property 2 (Override Displacement): An active override rule displaces its target when not excluded itself', () => {
    for (let trial = 0; trial < 100; trial++) {
      const baseRuleId = `base_${randomString(4)}`;
      const overrideRuleId = `override_${randomString(4)}`;

      const baseRule: Rule<string> = {
        id: baseRuleId,
        name: 'Base Rate Rule',
        scope: 'line',
        when: [{ attribute: 'buyerCountry', op: 'in', values: ['US'] }],
        combine: 'accumulate',
        effect: '6.25% Standard State Tax',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        source: { authority: 'State Comptroller', url: 'https://example.com' },
        status: 'filing-ready',
      };

      const overrideRule: Rule<string> = {
        id: overrideRuleId,
        name: 'Reduced Rate Override',
        scope: 'line',
        when: [{ attribute: 'buyerCountry', op: 'in', values: ['US'] }],
        combine: 'override',
        targets: [baseRuleId],
        effect: '2.0% Reduced Grocery Tax',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        source: { authority: 'State Comptroller', url: 'https://example.com' },
        status: 'filing-ready',
      };

      const composed: ComposedFacts = {
        facts: {
          buyerCountry: { attribute: 'buyerCountry', values: ['US'], from: ['books'], verified: true },
        },
        conflicts: [],
      };

      const outcome = evaluateRules([baseRule, overrideRule], composed, {
        date: '2026-07-04',
        scope: 'line',
      });

      const appliedIds = outcome.applied.map(a => a.rule.id);
      assert.ok(appliedIds.includes(overrideRuleId), 'Override rule must be in applied');
      assert.ok(!appliedIds.includes(baseRuleId), 'Base rule must not be in applied');

      const displacedBase = outcome.displaced.find(d => d.rule.id === baseRuleId);
      assert.ok(displacedBase, 'Base rule must be in displaced');
      assert.equal(displacedBase.by, overrideRuleId);
    }
  });

  it('Property 3 (Date Boundary Strictness): Rules outside their [validFrom, validTo] window are never applied', () => {
    for (let trial = 0; trial < 100; trial++) {
      const from = '2026-04-01';
      const to = '2026-09-30';
      const ruleId = `dated_${randomString(4)}`;

      const rule: Rule<string> = {
        id: ruleId,
        name: 'Seasonal Rule',
        scope: 'line',
        when: [{ attribute: 'productCategory', op: 'exists' }],
        combine: 'accumulate',
        effect: 'Summer Holiday Rate',
        validFrom: from,
        validTo: to,
        source: { authority: 'Department of Revenue', url: 'https://example.com' },
        status: 'filing-ready',
      };

      const composed: ComposedFacts = {
        facts: {
          productCategory: { attribute: 'productCategory', values: ['clothing'], from: ['books'], verified: true },
        },
        conflicts: [],
      };

      // Before validFrom -> not applied
      const outBefore = evaluateRules([rule], composed, { date: '2026-03-31', scope: 'line' });
      assert.equal(outBefore.applied.length, 0, 'Must not apply before validFrom');

      // During window -> applied
      const outDuring = evaluateRules([rule], composed, { date: '2026-06-15', scope: 'line' });
      assert.equal(outDuring.applied.length, 1, 'Must apply inside valid window');

      // After validTo -> not applied
      const outAfter = evaluateRules([rule], composed, { date: '2026-10-01', scope: 'line' });
      assert.equal(outAfter.applied.length, 0, 'Must not apply after validTo');
    }
  });

  it('Property 4 (Verification Gating): Rules requiring verified facts are blocked when verification is missing', () => {
    for (let trial = 0; trial < 50; trial++) {
      const attr: FactAttribute = 'buyerVatStatus';
      const rule: Rule<string> = {
        id: `verified_req_${randomString(4)}`,
        name: 'Certificate Exemption Rule',
        scope: 'line',
        when: [{ attribute: attr, op: 'exists' }],
        requiresVerified: [attr],
        combine: 'accumulate',
        effect: 'Exempt',
        validFrom: '2026-01-01',
        source: { authority: 'IRS', url: 'https://example.com' },
        status: 'filing-ready',
      };

      // Unverified fact
      const unverifiedFacts: ComposedFacts = {
        facts: {
          [attr]: { attribute: attr, values: ['valid'], from: ['books'], verified: false },
        },
        conflicts: [],
      };

      const outBlocked = evaluateRules([rule], unverifiedFacts, { date: '2026-05-01', scope: 'line' });
      assert.equal(outBlocked.applied.length, 0, 'Rule must not apply when required fact is unverified');
      assert.equal(outBlocked.blocked.length, 1, 'Rule must be in blocked');
      assert.deepEqual(outBlocked.blocked[0].unverified, [attr]);

      // Verified fact
      const verifiedFacts: ComposedFacts = {
        facts: {
          [attr]: { attribute: attr, values: ['valid'], from: ['books'], verified: true },
        },
        conflicts: [],
      };

      const outVerified = evaluateRules([rule], verifiedFacts, { date: '2026-05-01', scope: 'line' });
      assert.equal(outVerified.applied.length, 1, 'Rule must apply when required fact is verified');
      assert.equal(outVerified.blocked.length, 0);
    }
  });

  it('Property 5 (Conflict Safety): Conflicting facts place dependent rules in undecided, never in applied', () => {
    const attr: FactAttribute = 'buyerCountry';
    const rule: Rule<string> = {
      id: 'conflict_test_rule',
      name: 'Country Specific Rule',
      scope: 'line',
      when: [{ attribute: attr, op: 'in', values: ['US', 'IL'] }],
      combine: 'accumulate',
      effect: 'Standard',
      validFrom: '2026-01-01',
      source: { authority: 'Tax Authority', url: 'https://example.com' },
      status: 'filing-ready',
    };

    const conflictingFacts: ComposedFacts = {
      facts: {
        [attr]: { attribute: attr, values: ['US', 'IL'], from: ['dim1', 'dim2'], verified: true },
      },
      conflicts: [
        {
          attribute: attr,
          candidates: [
            { from: 'dim1:billing', value: 'US' },
            { from: 'dim2:shipping', value: 'IL' },
          ],
        },
      ],
    };

    const outcome = evaluateRules([rule], conflictingFacts, { date: '2026-05-01', scope: 'line' });
    assert.equal(outcome.applied.length, 0, 'Rule must not apply when its condition attribute is in conflict');
    assert.equal(outcome.undecided.length, 1, 'Rule must be in undecided');
    assert.deepEqual(outcome.undecided[0].conflicting, [attr]);
  });

  it('Property 6 (Deterministic Idempotence): Repeated evaluation over identical inputs produces strictly identical outcome', () => {
    const rule1: Rule<string> = {
      id: 'r1',
      name: 'Rule 1',
      scope: 'line',
      when: [{ attribute: 'buyerCountry', op: 'exists' }],
      combine: 'accumulate',
      effect: 'E1',
      validFrom: '2026-01-01',
      source: { authority: 'A', url: 'https://example.com' },
      status: 'filing-ready',
    };

    const rule2: Rule<string> = {
      id: 'r2',
      name: 'Rule 2',
      scope: 'line',
      when: [{ attribute: 'legalForm', op: 'exists' }],
      combine: 'accumulate',
      effect: 'E2',
      validFrom: '2026-01-01',
      source: { authority: 'A', url: 'https://example.com' },
      status: 'filing-ready',
    };

    const composed: ComposedFacts = {
      facts: {
        buyerCountry: { attribute: 'buyerCountry', values: ['US'], from: ['books'], verified: true },
        legalForm: { attribute: 'legalForm', values: ['llc'], from: ['books'], verified: true },
      },
      conflicts: [],
    };

    const first = evaluateRules([rule1, rule2], composed, { date: '2026-06-01', scope: 'line' });
    for (let i = 0; i < 50; i++) {
      const repeated = evaluateRules([rule1, rule2], composed, { date: '2026-06-01', scope: 'line' });
      assert.deepEqual(repeated, first, 'Repeated evaluation must be bit-for-bit identical');
    }
  });
});
