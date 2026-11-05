/**
 * The person who created a workspace always counts as its owner (workspaceRole), so the role screen must not store
 * another role for them: a co-owner trying to make the creator a viewer is refused, and nothing is written, also when
 * the target is sent in an unexpected shape. Another co-owner can still be changed. (CodeRabbit on #463 and #465.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceRouterHarness } from './helpers/workspaceRouterHarness';

describe('the workspace creator keeps the owner role', { skip: !process.env.LF_TEST_DATABASE_URL && 'needs LF_TEST_DATABASE_URL' }, () => {
  const h = workspaceRouterHarness('creator');
  const roles = async () => ((await h.workspace()).roles || {}) as Record<string, string>;
  before(() => h.start({ uid: 'creator-1', name: 'Creator', currency: 'USD', timezone: 'UTC', members: ['creator-1', 'co-1', 'co-2'], roles: { 'co-1': 'owner', 'co-2': 'owner' } }));
  after(() => h.stop());

  it('a co-owner cannot make the creator a viewer, and no role is stored for them', async () => {
    assert.equal((await h.request('co-1', 'PATCH', '/roles/creator-1', { role: 'viewer' })).status, 400);
    assert.equal((await roles())['creator-1'], undefined);
  });

  it('a target sent as a list instead of one id is refused', async () => {
    assert.equal((await h.request('co-1', 'POST', '/roles', { targetUid: ['creator-1'], role: 'viewer' })).status, 400);
    assert.equal((await roles())['creator-1'], undefined);
  });

  it('another co-owner can still be changed', async () => {
    assert.equal((await h.request('co-1', 'PATCH', '/roles/co-2', { role: 'accountant' })).status, 200);
    assert.equal((await roles())['co-2'], 'accountant');
  });
});
