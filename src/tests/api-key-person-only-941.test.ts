/** #941 (S-11): a workspace API key never reaches a person's own account routes or the account.* commands. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPersonOnlyPath } from '../server/auth/apiAuthenticate';

test('account and sign-in routes are person-only; ledger routes are not', () => {
  for (const p of ['/api/v1/auth/login-audits', '/api/v1/auth/revoke-sessions?x=1', '/API/V1/AUTH/delete-account/', '/api/v1/account/my-data',
    '/api/v1/account/recovery-codes/use', '/api/v1/commands/account.userecoverycode', '/api/v1/commands/account%2Emerge']) {
    assert.equal(isPersonOnlyPath(p), true, p);
  }
  for (const p of ['/api/v1/transactions', '/api/v1/commands/invoice.create', '/api/v1/authority-report', '/api/v1/accounts', '/api/v1/commands/accounting.x']) {
    assert.equal(isPersonOnlyPath(p), false, p);
  }
});
