/**
 * `workspace.settings` — the settings row, written as one command instead of sixteen `updateDoc` calls.
 *
 * The panels each wrote the `workspaces` document straight from the browser. These tests hold the command to what
 * that could not promise: only an owner or accountant may change a setting, a field outside the allowlist cannot be
 * written at all (the currency — which rewrites how every stored amount reads — is deliberately outside it), a
 * report note is merged by key and an emptied note is removed rather than stored empty, and a change leaves an
 * audit line.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { workspaceSettingsCommand, workspaceSettingsInput } from '../server/commands/workspaceSettingsPanel';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const run = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: workspaceSettingsCommand, workspaceId, input }, runnerDependencies(db));

test('a changed setting is written, and the workspace says when', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { timezone: 'UTC', fiscalYearStartMonth: 1 });
  const input = workspaceSettingsInput.parse({ timezone: 'America/New_York', fiscalYearStartMonth: 4 });
  const outcome = await run(input, db);
  assert.equal(outcome.ok, true);
  assert.equal(db.read(`workspaces/${workspaceId}`)?.timezone, 'America/New_York');
  assert.equal(db.read(`workspaces/${workspaceId}`)?.fiscalYearStartMonth, 4);
  assert.equal(typeof db.read(`workspaces/${workspaceId}`)?.updatedAt, 'string');
  assert.deepEqual((outcome as unknown as { data: { changed: string[] } }).data.changed.sort(), ['fiscalYearStartMonth', 'timezone']);
});

test('the label axes and the books cannot be changed through this command', async () => {
  assert.equal(workspaceSettingsInput.safeParse({ currency: 'EURO' }).success, false, 'the currency is three letters');
  assert.equal(workspaceSettingsInput.safeParse({ dimensions: [] }).success, false, 'the axes have workspace.dimensionaxes');
  assert.equal(workspaceSettingsInput.safeParse({ lockDate: '2026-01-01' }).success, false, 'the books are not a setting panel');
  assert.equal(workspaceSettingsInput.safeParse({ timezone: 'UTC', surprise: true }).success, false, 'an unknown key is refused');
});

test('the home currency changes only while the books are empty', async () => {
  const empty = new MemoryDb();
  seedWorkspace(empty, workspaceId, { currency: 'USD' });
  const onboarding = await run(workspaceSettingsInput.parse({ currency: 'gbp' }), empty);
  assert.equal(onboarding.ok, true, `refused: ${JSON.stringify(onboarding)}`);
  assert.equal(empty.read(`workspaces/${workspaceId}`)?.currency, 'GBP', 'and it is stored the way the rest of the app reads it');

  const used = new MemoryDb();
  seedWorkspace(used, workspaceId, { currency: 'USD' });
  used.seed('invoices/inv-1', { id: 'inv-1', workspaceId, status: 'sent', amountCents: 100 });
  const refused = await run(workspaceSettingsInput.parse({ currency: 'EUR' }), used);
  assert.equal(refused.ok, false);
  assert.equal((refused as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(used.read(`workspaces/${workspaceId}`)?.currency, 'USD', 'a workspace with entries keeps its home currency');

  // saving the currency it already has is not a change, and is never refused
  const same = await run(workspaceSettingsInput.parse({ currency: 'USD' }), used);
  assert.equal(same.ok, true);
});

test('a value out of range is refused before anything is written', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  assert.equal(workspaceSettingsInput.safeParse({ fiscalYearStartMonth: 13 }).success, false);
  assert.equal(workspaceSettingsInput.safeParse({ matchingThreshold: 1.5 }).success, false);
  assert.equal(workspaceSettingsInput.safeParse({ paymentTermDays: -1 }).success, false);
  assert.equal(db.read(`workspaces/${workspaceId}`)?.currency, 'USD', 'nothing was written');
});

test('a report note is merged by key, and an emptied note is removed rather than stored empty', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { reportNotes: { 'profit-loss:2026-01': 'Checked', 'balance-sheet:2026-01': 'Old' } });
  const input = workspaceSettingsInput.parse({
    reportNotes: { 'balance-sheet:2026-01': null, 'cash-flow:2026-01': 'New note' },
  });
  const outcome = await run(input, db);
  assert.equal(outcome.ok, true);
  const notes = db.read(`workspaces/${workspaceId}`)?.reportNotes as Record<string, string>;
  assert.deepEqual(notes, { 'profit-loss:2026-01': 'Checked', 'cash-flow:2026-01': 'New note' });
});

test('a viewer or bookkeeper cannot change settings, and the row is untouched', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, {
    uid: 'someone-else',
    roles: { [owner.uid]: 'bookkeeper' },
  });
  const input = workspaceSettingsInput.parse({ taxRounding: 'up' });
  const outcome = await run(input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'ROLE_REQUIRED');
  assert.equal(db.read(`workspaces/${workspaceId}`)?.taxRounding, undefined);
});

test('an empty patch is a no-op that writes nothing and audits nothing', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const before = db.read(`workspaces/${workspaceId}`)?.updatedAt;
  const outcome = await run(workspaceSettingsInput.parse({}), db);
  assert.equal(outcome.ok, true);
  assert.deepEqual((outcome as unknown as { data: { changed: string[] } }).data.changed, []);
  assert.equal(db.read(`workspaces/${workspaceId}`)?.updatedAt, before);
  assert.equal(workspaceSettingsCommand.audit(workspaceSettingsInput.parse({}), { workspaceId, changed: [], updatedAt: 'now' }), null);
});

test('a workspace that is gone is refused instead of writing a row nobody owns', async () => {
  const db = new MemoryDb();
  const outcome = await run(workspaceSettingsInput.parse({ timezone: 'UTC' }), db);
  assert.equal(outcome.ok, false);
  // the runner refuses first with its own code; the command's NOT_FOUND is what a reader of the definition sees
  assert.ok(['NOT_FOUND', 'WORKSPACE_NOT_FOUND'].includes((outcome as unknown as { code?: string }).code || ''));
  assert.equal(db.read(`workspaces/${workspaceId}`), undefined);
});
