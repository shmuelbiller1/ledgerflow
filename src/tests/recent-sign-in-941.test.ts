import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signInTime } from '../server/auth/supabaseAuth';
import { signedInWithin } from '../server/utils/commandExecutor';
import { apiKeyProvisionCommand } from '../server/commands/apiKeys';

describe('#941 part 3: a real sign-in time gates minting API keys', () => {
  it('reads the latest amr sign-in time, not the token issue time', () => {
    assert.equal(signInTime({ iat: 5000, amr: [{ method: 'password', timestamp: 1000 }, { method: 'totp', timestamp: 1200 }] }), 1200);
    assert.equal(signInTime({ iat: 5000, auth_time: 900 }), 900);
    assert.equal(signInTime({ iat: 5000, amr: [{ method: 'password' }] }), 5000);
    assert.equal(signInTime({}), 0);
  });

  it('a sign-in counts as recent only inside the window', () => {
    const now = 10_000_000;
    assert.equal(signedInWithin(now / 1000 - 60, 1800, now), true);
    assert.equal(signedInWithin(now / 1000 - 7200, 1800, now), false);
    assert.equal(signedInWithin(undefined, 1800, now), false);
    assert.equal(signedInWithin(0, 1800, now), false);
  });

  it('key provisioning asks for a sign-in within 30 minutes', () => {
    assert.equal(apiKeyProvisionCommand.recentSignInSec, 1800);
  });
});
