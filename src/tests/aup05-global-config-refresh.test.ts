/**
 * AUP-05: the admin's billing and registration settings were loaded once when the app was built, so an instance
 * that stayed warm kept charging the old multipliers (or the old bypass flag) after an admin changed them on
 * another instance. Each instance now re-reads them when its copy is older than GLOBAL_CONFIG_TTL_MS.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { callApi, startOwnerApp } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-05: admin config reaches warm instances', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const ws = `ws_aup05_${randomUUID()}`;
  let app!: Awaited<ReturnType<typeof startOwnerApp>>;
  let kit!: typeof import('../server/http/serverKit');
  let original: Record<string, unknown> = {};
  const setConfig = (fields: Record<string, unknown>) => app.db.collection('admins').doc('globalConfig').set({ updatedAt: new Date().toISOString(), ...fields });
  const charge = () => kit.calculateWorkspaceCharges(null, 10, 0, false).credits;

  before(async () => {
    app = await startOwnerApp('aup05-config', ws);
    kit = await import('../server/http/serverKit');
    original = { ...kit.globalAdminConfig };
  });
  after(async () => {
    Object.assign(kit.globalAdminConfig, original);
    await app.db.pool.query("delete from public.admins where id = 'globalConfig'").catch(() => {});
    await app?.stop();
  });

  it('a changed multiplier is picked up once this instance\'s copy is stale, and not before', async () => {
    await setConfig({ creditCostMultiplier: 3, bypassBilling: false });
    await kit.refreshGlobalAdminConfigIfStale(Date.now() + 10 * kit.GLOBAL_CONFIG_TTL_MS);
    assert.equal(charge(), 30, '10 credits x 3');
    await setConfig({ creditCostMultiplier: 5, bypassBilling: false });
    await kit.refreshGlobalAdminConfigIfStale(Date.now());
    assert.equal(charge(), 30, 'fresh copy: no new read yet');
    await kit.refreshGlobalAdminConfigIfStale(Date.now() + 2 * kit.GLOBAL_CONFIG_TTL_MS);
    assert.equal(charge(), 50, 'stale copy: re-read, 10 x 5');
  });

  it('turning bypass billing off reaches a warm instance (it kept waiving charges before)', async () => {
    await setConfig({ creditCostMultiplier: 1, bypassBilling: true });
    kit.invalidateGlobalAdminConfig();
    await kit.refreshGlobalAdminConfigIfStale();
    assert.equal(charge(), 0, 'bypass on: no charge');
    await setConfig({ creditCostMultiplier: 1, bypassBilling: false });
    kit.invalidateGlobalAdminConfig();
    await kit.refreshGlobalAdminConfigIfStale();
    assert.equal(charge(), 10, 'bypass off: charged again');
  });

  it('concurrent requests on a stale copy all see the new value', async () => {
    await setConfig({ creditCostMultiplier: 4, bypassBilling: false });
    kit.invalidateGlobalAdminConfig();
    await Promise.all(Array.from({ length: 8 }, () => kit.refreshGlobalAdminConfigIfStale()));
    assert.equal(charge(), 40);
  });

  it('an API request re-reads a stale copy: the public registration limit follows the admin\'s setting', async () => {
    const limit = async () => ((await callApi(app.base, 'GET', '/api/v1/public/registration-status', {})).json as { maxRegistrationLimit: number }).maxRegistrationLimit;
    await setConfig({ maxRegistrationLimit: 7 });
    kit.invalidateGlobalAdminConfig();
    assert.equal(await limit(), 7);
    await setConfig({ maxRegistrationLimit: 9 });
    kit.invalidateGlobalAdminConfig();
    assert.equal(await limit(), 9);
  });
});
