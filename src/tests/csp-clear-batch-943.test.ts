/** #943 (Codex on #984): clearing CSP reports removes exactly the batch it records, never a report received meanwhile. */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cspViolationSummary, recordCspViolation, resetCspViolations, restoreCspViolations, takeCspViolations, type CspViolation } from '../server/http/cspViolations';

const v = (blockedSource: string): CspViolation => ({ directive: 'script-src', blockedSource, documentPath: '/app' } as CspViolation);

describe('#943 CSP clear batch', () => {
  beforeEach(() => resetCspViolations());

  it('a report arriving after the batch is taken survives the clear', () => {
    recordCspViolation(v('inline'));
    recordCspViolation(v('inline'));
    const taken = takeCspViolations();
    assert.equal(taken.total, 2);
    recordCspViolation(v('eval')); // arrives while the audit row is being written
    assert.deepEqual(cspViolationSummary().groups.map(g => g.blockedSource), ['eval']);
    assert.equal(cspViolationSummary().total, 1);
  });

  it('a batch whose record failed is put back, merged with what arrived since', () => {
    recordCspViolation(v('inline'));
    const taken = takeCspViolations();
    recordCspViolation(v('inline'));
    recordCspViolation(v('eval'));
    restoreCspViolations(taken);
    const now = cspViolationSummary();
    assert.equal(now.total, 3);
    assert.equal(now.groups.find(g => g.blockedSource === 'inline')?.count, 2);
    assert.equal(now.groups.find(g => g.blockedSource === 'eval')?.count, 1);
  });
});
