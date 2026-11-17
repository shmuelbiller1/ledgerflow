import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestUser } from '../server/auth/requestUser';
import { executeCommand } from '../server/utils/commandExecutor';
import { recordFieldsCommand, recordFieldsInput } from '../server/commands/records';
import { createDefaultCommandRegistry } from '../server/commands/defaultRegistry';
import { EDITABLE_RECORD_COLLECTIONS, EDITABLE_RECORD_FIELDS, editableRecordFields } from '../lib/editableRecords';
import { INLINE_RECORD_FIELDS } from '../lib/inlineRecordFields';
import { RECORD_DETAIL_FIELDS } from '../lib/recordDetails';
import {
  captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, type TestCounters, workspaceId,
} from './helpers/commandTestUtils';

const counters = (): TestCounters => ({ runs: 0, previews: 0, afterCommit: 0, audits: 0 });

function seeded(): MemoryDb {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('customers/customer-1', {
    id: 'customer-1', workspaceId, name: 'Acme', email: '', address: 'Old address',
    balanceCents: 12_500, metadata: { keep: 'yes' },
  });
  db.seed('projects/project-1', {
    id: 'project-1', workspaceId, name: 'Website', status: 'active', budgetCents: 100_000,
    metadata: { client: 'Old client', keep: 'me' },
  });
  db.seed('dimensionNodes/project-P1', {
    id: 'project-P1', workspaceId, dimensionId: 'project', description: 'ישן', aliases: ['Original'], status: 'active',
  });
  return db;
}

async function run(db: MemoryDb, input: unknown, user: RequestUser = owner) {
  const parsed = recordFieldsInput.parse(input);
  const result = await executeCommand(fakeRequest(user, { workspaceId, input: parsed }), captureResponse().response,
    { definition: recordFieldsCommand, workspaceId, input: parsed }, runnerDependencies(db));
  return { result, parsed };
}

test('record.fields is registered like every other command, so a screen can name it', () => {
  assert.equal(createDefaultCommandRegistry().get('record.fields'), recordFieldsCommand);
  assert.deepEqual(recordFieldsCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.equal(recordFieldsCommand.risk, 'normal', 'a name or an address is not a posting');
  assert.equal(recordFieldsCommand.inverse!(recordFieldsInput.parse({ collection: 'customers', id: 'customer-1', fields: { name: 'x' } }), { collection: 'customers', id: 'customer-1', fields: ['name'], updatedAt: '' }), null, 'a field change is not undone by one inverse write');
  assert.match(recordFieldsCommand.describe.sentence, /do not use it for an amount/);
  assert.deepEqual(recordFieldsCommand.describe.refusals.map(refusal => refusal.code),
    ['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'ROLE_REQUIRED']);
});

test('the server allowlist is the screens’ two lists merged, and names nothing extra but a derived alias list', () => {
  // every field a screen can offer has to be accepted by the command, or the screen fails where a person can see it
  for (const [collection, fields] of Object.entries({ ...RECORD_DETAIL_FIELDS, ...INLINE_RECORD_FIELDS })) {
    for (const field of fields) {
      assert.ok(editableRecordFields(collection).includes(field), `${collection}.${field} is offered by a screen but not editable`);
    }
  }
  assert.deepEqual(Object.keys(EDITABLE_RECORD_FIELDS), [...EDITABLE_RECORD_COLLECTIONS]);
  assert.deepEqual([...EDITABLE_RECORD_COLLECTIONS], [...EDITABLE_RECORD_COLLECTIONS].sort());
  // the merge is a union, so no collection may appear that neither screen names, and the only field beyond the two
  // lists is the derived alias history — anything else would be a door neither screen asked for
  const fromScreens = new Set([...Object.keys(RECORD_DETAIL_FIELDS), ...Object.keys(INLINE_RECORD_FIELDS)]);
  assert.deepEqual(EDITABLE_RECORD_COLLECTIONS.filter(collection => !fromScreens.has(collection)), []);
  const beyondScreens: Record<string, string[]> = {};
  const detail = RECORD_DETAIL_FIELDS as Record<string, readonly string[]>;
  const inline = INLINE_RECORD_FIELDS as Record<string, readonly string[]>;
  for (const collection of EDITABLE_RECORD_COLLECTIONS) {
    const offered = new Set([...(detail[collection] || []), ...(inline[collection] || [])]);
    const extra = editableRecordFields(collection).filter(field => !offered.has(field));
    if (extra.length) beyondScreens[collection] = extra;
  }
  assert.deepEqual(beyondScreens, { dimensionNodes: ['aliases'] });
  // a field with a ledger meaning is not here, even though the collection is
  for (const field of ['balanceCents', 'quantity', 'postedAt', 'status']) {
    assert.equal(editableRecordFields('customers').includes(field), false, `customers.${field} must stay with its own command`);
  }
});

test('an entry outside the allowlist is refused by the schema, before anything is read', () => {
  assert.equal(recordFieldsInput.safeParse({ collection: 'journalEntries', id: 'j', fields: { memo: 'x' } }).success, false);
  const refusedField = recordFieldsInput.safeParse({ collection: 'customers', id: 'customer-1', fields: { balanceCents: 0 } });
  assert.equal(refusedField.success, false);
  if (!refusedField.success) assert.match(refusedField.error.issues.map(issue => issue.message).join(' '), /not editable/);
  // the id and the caller's own bookkeeping are not part of the input: a record cannot be moved between workspaces
  assert.equal(recordFieldsInput.safeParse({ collection: 'customers', id: 'customer-1', fields: { name: 'x' }, workspaceId }).success, false);
  assert.equal(recordFieldsInput.safeParse({ collection: 'customers', id: 'a/b', fields: { name: 'x' } }).success, false);
  assert.equal(recordFieldsInput.safeParse({ collection: 'customers', id: 'customer-1', fields: {} }).success, false);
  // aliases are derivable on one collection only, not a field a person may type anywhere
  assert.equal(recordFieldsInput.safeParse({ collection: 'customers', id: 'customer-1', fields: { aliases: ['x'] } }).success, false);
  assert.equal(recordFieldsInput.safeParse({ collection: 'dimensionNodes', id: 'project-P1', fields: { aliases: ['x'] } }).success, true);
});

test('a field write stamps the server’s time and leaves an audit line, and writes only the named field', async () => {
  const db = seeded();
  const audit = counters();
  const parsed = recordFieldsInput.parse({ collection: 'customers', id: 'customer-1', fields: { address: '14 Herzl St' } });
  const outcome = await executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: recordFieldsCommand, workspaceId, input: parsed }, runnerDependencies(db, audit));
  assert.equal(outcome.ok, true);
  const saved = db.read('customers/customer-1')!;
  assert.equal(saved.address, '14 Herzl St');
  assert.equal(saved.name, 'Acme', 'a field write is a patch, not a replacement');
  assert.equal(saved.balanceCents, 12_500);
  assert.deepEqual(saved.metadata, { keep: 'yes' });
  assert.equal(typeof saved.updatedAt, 'string');
  assert.ok(Math.abs(Date.parse(String(saved.updatedAt)) - Date.now()) < 60_000, 'the clock is the server’s');
  assert.equal(audit.audits, 1);
});

test('a stale expectation is CONFLICT, decided in the same transaction, and nothing is written', async () => {
  const db = seeded();
  const { result } = await run(db, {
    collection: 'customers', id: 'customer-1', fields: { address: 'New address' }, expected: { address: 'what the tab read' },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'CONFLICT');
  assert.equal(db.read('customers/customer-1')?.address, 'Old address');
  assert.equal(db.read('customers/customer-1')?.updatedAt, undefined);

  // the same expectation that matches is accepted, and an empty field compares as empty rather than as missing
  const matched = await run(db, { collection: 'customers', id: 'customer-1', fields: { address: 'New address' }, expected: { address: 'Old address' } });
  assert.equal(matched.result.ok, true);
  const blank = await run(db, { collection: 'customers', id: 'customer-1', fields: { email: 'a@b.test' }, expected: { email: '' } });
  assert.equal(blank.result.ok, true);
});

test('a record outside the workspace is NOT_FOUND, and a viewer is ROLE_REQUIRED', async () => {
  const db = seeded();
  db.seed('customers/other-1', { id: 'other-1', workspaceId: 'ws-someone-else', name: 'Not mine' });
  const outside = await run(db, { collection: 'customers', id: 'other-1', fields: { name: 'Mine now' } });
  assert.equal(outside.result.ok, false);
  if (!outside.result.ok) assert.equal(outside.result.code, 'NOT_FOUND');
  const missing = await run(db, { collection: 'customers', id: 'no-such-1', fields: { name: 'x' } });
  assert.equal(missing.result.ok, false);
  if (!missing.result.ok) assert.equal(missing.result.code, 'NOT_FOUND');
  assert.equal(db.read('customers/other-1')?.name, 'Not mine');

  const viewer: RequestUser = { uid: 'viewer-1', aal: 'aal2' };
  seedWorkspace(db, workspaceId, { uid: owner.uid, members: [owner.uid, viewer.uid], roles: { 'viewer-1': 'viewer' } });
  const refused = await run(db, { collection: 'customers', id: 'customer-1', fields: { name: 'Viewer edit' } }, viewer);
  assert.equal(refused.result.ok, false);
  if (!refused.result.ok) assert.equal(refused.result.code, 'ROLE_REQUIRED');
  assert.equal(db.read('customers/customer-1')?.name, 'Acme');
});

test('a nested field is a nested patch: metadata.client keeps its siblings, and no dotted key is written', async () => {
  const db = seeded();
  const { result } = await run(db, {
    collection: 'projects', id: 'project-1', fields: { 'metadata.client': 'New client' }, expected: { 'metadata.client': 'Old client' },
  });
  assert.equal(result.ok, true);
  const project = db.read('projects/project-1')!;
  assert.deepEqual(project.metadata, { client: 'New client', keep: 'me' }, 'the sibling key survives the nested write');
  assert.equal('metadata.client' in project, false, 'the path is not written as a literal key');
  assert.equal(project.budgetCents, 100_000, 'a planning amount the caller did not name is untouched');

  // a stale nested value is the same conflict as a flat one
  const stale = await run(db, { collection: 'projects', id: 'project-1', fields: { 'metadata.client': 'Third' }, expected: { 'metadata.client': 'Old client' } });
  assert.equal(stale.result.ok, false);
  if (!stale.result.ok) assert.equal(stale.result.code, 'CONFLICT');
  assert.equal((db.read('projects/project-1')?.metadata as Record<string, unknown>).client, 'New client');
});

test('a dimension label and its alias history travel in one write', async () => {
  const db = seeded();
  const { result } = await run(db, {
    collection: 'dimensionNodes', id: 'project-P1', fields: { description: 'New label', aliases: ['Original', 'ישן'] },
    expected: { description: 'ישן', aliases: ['Original'] },
  });
  assert.equal(result.ok, true);
  const node = db.read('dimensionNodes/project-P1')!;
  assert.equal(node.description, 'New label');
  assert.deepEqual(node.aliases, ['Original', 'ישן'], 'the previous name is kept beside the older ones');
  assert.equal(node.status, 'active', 'the node’s status is not this command’s to change');
});

test('the preview names what will change, and a record outside the workspace has no preview', async () => {
  const db = seeded();
  db.seed('customers/other-1', { id: 'other-1', workspaceId: 'ws-someone-else', name: 'Not mine' });
  const ctx = { db, workspaceId, user: owner } as never;
  const parsed = recordFieldsInput.parse({ collection: 'customers', id: 'customer-1', fields: { name: 'Acme Ltd' } });
  assert.deepEqual(await recordFieldsCommand.preview!(ctx, parsed), { title: 'Change name', lines: ['name → Acme Ltd'] });
  const outside = recordFieldsInput.parse({ collection: 'customers', id: 'other-1', fields: { name: 'Mine now' } });
  await assert.rejects(() => recordFieldsCommand.preview!(ctx, outside), /not in the selected workspace/);
});
