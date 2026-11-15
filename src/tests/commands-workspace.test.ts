import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestUser } from '../server/auth/requestUser';
import type { CommandDefinition } from '../server/commands/types';
import { alertSettingsUpdateCommand, alertSettingsUpdateInput } from '../server/commands/alerts';
import { importMapRestoreCommand, importMapSaveCommand, importMapSaveInput } from '../server/commands/importMaps';
import { entryLinkCreateCommand, entryLinkRemoveCommand } from '../server/commands/entryLinks';
import { stageDefineCommand, stageMoveCommand } from '../server/commands/stages';
import { taskCreateCommand, taskRemoveCommand, taskStatusCommand } from '../server/commands/tasks';
import { timeInvoiceCommand, timeLogCommand, timeMoveCommand, timeRatesCommand, timeRemoveCommand, timeUpdateCommand } from '../server/commands/time';
import { watchCreateCommand, watchRemoveCommand } from '../server/commands/watches';
import type { AlertSettingsWriteResult } from '../server/services/bookAlertService';
import { executeCommand, previewCommand, withLegacyInputIdempotencyHash } from '../server/utils/commandExecutor';
import { TASK_KIND } from '../lib/tasks';
import {
  captureResponse,
  fakeRequest,
  invocationInput,
  MemoryDb,
  owner,
  runnerDependencies,
  seedWorkspace,
  testInput,
  type TestCounters,
  type TestResult,
  workspaceId,
  recordingCommand,
} from './helpers/commandTestUtils';

test('task, watch, entry-link, time, and stage commands publish validated examples and refusal guides', () => {
  const teamCommands = [
    taskCreateCommand, taskStatusCommand, taskRemoveCommand,
    watchCreateCommand, watchRemoveCommand,
    entryLinkCreateCommand, entryLinkRemoveCommand,
    timeLogCommand, timeUpdateCommand, timeRemoveCommand, timeMoveCommand, timeInvoiceCommand, timeRatesCommand,
    stageDefineCommand, stageMoveCommand,
  ];
  assert.equal(teamCommands.length, 15);
  for (const command of teamCommands) {
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example matches its schema`);
    assert.ok(command.describe.sentence.trim(), `${command.name} has a description`);
    assert.ok(command.describe.refusals.length > 0, `${command.name} lists refusals`);
    assert.ok(command.roles.length > 0, `${command.name} lists roles`);
  }
  assert.deepEqual(taskCreateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(taskRemoveCommand.roles, ['owner', 'accountant', 'bookkeeper', 'viewer']);
  assert.deepEqual(watchCreateCommand.roles, ['owner', 'accountant', 'bookkeeper', 'viewer']);
  assert.deepEqual(entryLinkCreateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(timeLogCommand.roles, ['owner', 'accountant', 'bookkeeper', 'viewer']);
  assert.deepEqual(stageDefineCommand.roles, ['owner', 'accountant']);
});

test('workspace import-map commands preview saves and can restore their full prior snapshot', async () => {
  const db = new MemoryDb();
  const previousMaps = {
    csv_3_1234abcd: { columns: { date: 'Date' }, skipRows: 0, savedAt: '2026-11-01T00:00:00.000Z' },
  };
  seedWorkspace(db, workspaceId, { importColumnMaps: previousMaps });
  const input = {
    signature: 'csv_5_1234abcd',
    columns: { date: 'Posted Date', description: 'Description', debit: 'Debit', credit: 'Credit' },
    skipRows: 1,
  };
  assert.equal(importMapSaveInput.safeParse(input).success, true);
  assert.equal(importMapSaveCommand.input.safeParse(importMapSaveCommand.describe.example).success, true);
  assert.equal(importMapRestoreCommand.input.safeParse(importMapRestoreCommand.describe.example).success, true);
  assert.ok(importMapSaveCommand.describe.refusals.length > 0);
  assert.ok(importMapRestoreCommand.describe.refusals.length > 0);

  const auditCounters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, auditCounters);
  const preview = await previewCommand(fakeRequest(owner, input),
    { definition: importMapSaveCommand, workspaceId, input }, dependencies);
  assert.equal(preview.ok, true);
  if (preview.ok) assert.deepEqual(preview.preview.lines, ['Skip 1 header row', 'credit: Credit', 'date: Posted Date', 'debit: Debit', 'description: Description']);

  const saved = await executeCommand(fakeRequest(owner, input, 'import-map-command-save'), captureResponse().response,
    { definition: importMapSaveCommand, workspaceId, input }, dependencies);
  assert.equal(saved.ok, true);
  assert.equal(auditCounters.audits, 1, 'the save command writes its audit summary through the shared runner');
  if (!saved.ok) return;
  const inverse = importMapSaveCommand.inverse?.(input, saved.data as Parameters<NonNullable<typeof importMapSaveCommand.inverse>>[1]);
  assert.deepEqual(inverse, { command: 'workspace.restoremaps', input: { maps: previousMaps } });
  const savedMaps = db.read(`workspaces/${workspaceId}`)?.importColumnMaps as Record<string, unknown> | undefined;
  assert.ok(savedMaps && Object.hasOwn(savedMaps, 'csv_5_1234abcd'));

  const restored = await executeCommand(fakeRequest(owner, inverse?.input, 'import-map-command-undo'), captureResponse().response,
    { definition: importMapRestoreCommand, workspaceId, input: inverse?.input }, dependencies);
  assert.equal(restored.ok, true);
  assert.equal(auditCounters.audits, 2, 'the restore command writes its audit summary through the shared runner');
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.importColumnMaps, previousMaps);
});

test('legacy route idempotency hashes include path targets for task deletes and status updates', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const seedTask = (id: string) => db.seed(`documents/${id}`, {
    id, kind: TASK_KIND, workspaceId, title: `Task ${id}`, assignee: owner.uid, createdBy: owner.uid,
    createdAt: '2026-11-15T00:00:00.000Z', status: 'open',
  });
  seedTask('remove-target-a');
  seedTask('remove-target-b');
  seedTask('status-target-a');
  seedTask('status-target-b');
  const dependencies = runnerDependencies(db);

  const remove = withLegacyInputIdempotencyHash(taskRemoveCommand);
  const firstDelete = await executeCommand(fakeRequest(owner, {}, 'legacy-remove-operation'), captureResponse().response,
    { definition: remove, workspaceId, input: { taskId: 'remove-target-a' } }, dependencies);
  assert.equal(firstDelete.ok, true);
  assert.equal(db.read('documents/remove-target-a'), undefined);
  const exactDeleteRetry = await executeCommand(fakeRequest(owner, {}, 'legacy-remove-operation'), captureResponse().response,
    { definition: remove, workspaceId, input: { taskId: 'remove-target-a' } }, dependencies);
  assert.equal(exactDeleteRetry.ok, true);
  if (exactDeleteRetry.ok) assert.equal(exactDeleteRetry.replayed, true);
  const reusedDelete = await executeCommand(fakeRequest(owner, {}, 'legacy-remove-operation'), captureResponse().response,
    { definition: remove, workspaceId, input: { taskId: 'remove-target-b' } }, dependencies);
  assert.equal(reusedDelete.ok, false);
  if (!reusedDelete.ok) assert.equal(reusedDelete.status, 409);
  assert.ok(db.read('documents/remove-target-b'), 'a replay for another path target must not delete it');

  const status = withLegacyInputIdempotencyHash(taskStatusCommand);
  const firstUpdate = await executeCommand(fakeRequest(owner, { status: 'done' }, 'legacy-status-operation'), captureResponse().response,
    { definition: status, workspaceId, input: { taskId: 'status-target-a', status: 'done' } }, dependencies);
  assert.equal(firstUpdate.ok, true);
  assert.equal(db.read('documents/status-target-a')?.status, 'done');
  const exactUpdateRetry = await executeCommand(fakeRequest(owner, { status: 'done' }, 'legacy-status-operation'), captureResponse().response,
    { definition: status, workspaceId, input: { taskId: 'status-target-a', status: 'done' } }, dependencies);
  assert.equal(exactUpdateRetry.ok, true);
  if (exactUpdateRetry.ok) assert.equal(exactUpdateRetry.replayed, true);
  const reusedUpdate = await executeCommand(fakeRequest(owner, { status: 'done' }, 'legacy-status-operation'), captureResponse().response,
    { definition: status, workspaceId, input: { taskId: 'status-target-b', status: 'done' } }, dependencies);
  assert.equal(reusedUpdate.ok, false);
  if (!reusedUpdate.ok) assert.equal(reusedUpdate.status, 409);
  assert.equal(db.read('documents/status-target-b')?.status, 'open', 'a replay must not return one task under another task URL');
});

test('the command runner omits audit records for idempotent no-op results', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const base = recordingCommand(counters);
  const noOp: CommandDefinition<typeof testInput, TestResult> = {
    ...base,
    async handler(_ctx, _tx, input) { counters.runs++; return { saved: true, value: input.value }; },
    audit() { return null; },
  };
  const db = new MemoryDb();
  seedWorkspace(db);
  const result = await executeCommand(fakeRequest(owner, invocationInput()), captureResponse().response,
    { definition: noOp, workspaceId, input: invocationInput() }, runnerDependencies(db, counters));
  assert.equal(result.ok, true);
  assert.equal(counters.runs, 1);
  assert.equal(counters.audits, 0);
});

test('alerts.update has a valid example, a read-only preview, a transactional inverse and idempotent audit', async () => {
  const example = alertSettingsUpdateCommand.describe.example as { cashLowCents: number; closeReminderDay: number; budgetAlerts: boolean };
  assert.deepEqual(alertSettingsUpdateCommand.roles, ['owner', 'accountant']);
  assert.equal(alertSettingsUpdateInput.safeParse(example).success, true);
  assert.equal(alertSettingsUpdateInput.safeParse({ ...example, unexpected: true }).success, false);
  assert.deepEqual(new Set(alertSettingsUpdateCommand.describe.refusals.map(refusal => refusal.code)),
    new Set(['INVALID_INPUT', 'INVALID_ALERT_SETTINGS', 'WORKSPACE_NOT_FOUND', 'ROLE_REQUIRED']));

  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, {
    currency: 'USD',
    alerts: { cashLowCents: null, closeReminderDay: 3, budgetAlerts: false },
    alertsSent: { closeReminder: '2026-09', cashLow: true, fingerprint: 'stale' },
  });
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, counters);
  const preview = await previewCommand(fakeRequest(owner, example),
    { definition: alertSettingsUpdateCommand, workspaceId, input: example }, dependencies);
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.deepEqual(preview.preview, {
      title: 'Update book alert settings',
      lines: ['Alerts: close reminder from day 5, cash below $500.00, budget alerts on'],
    });
  }
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.alerts, { cashLowCents: null, closeReminderDay: 3, budgetAlerts: false }, 'preview never writes');
  assert.equal(counters.audits, 0, 'preview never audits');

  const operationId = 'alerts-update-test-1';
  const request = fakeRequest(owner, example, operationId);
  const first = await executeCommand(request, captureResponse().response,
    { definition: alertSettingsUpdateCommand, workspaceId, input: example }, dependencies);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const result = first.data as AlertSettingsWriteResult;
  assert.deepEqual(result, {
    workspaceId,
    alerts: example,
    previousAlerts: { cashLowCents: null, closeReminderDay: 3, budgetAlerts: false },
    currency: 'USD',
  });
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.alerts, example);
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.alertsSent, { closeReminder: '2026-09', cashLow: true });
  assert.deepEqual(counters, { runs: 0, previews: 0, afterCommit: 0, audits: 1 });
  const summary = alertSettingsUpdateCommand.audit(example, result);
  assert.ok(summary);
  assert.equal(summary.action, 'ALERTS_SAVED');
  assert.equal(summary.entityType, 'workspaces');
  assert.equal(summary.entityId, workspaceId);
  assert.match(summary.description, /close reminder from day 5, cash below \$500\.00, budget alerts on/);
  assert.deepEqual(alertSettingsUpdateCommand.inverse?.(example, result),
    { command: 'alerts.update', input: { cashLowCents: null, closeReminderDay: 3, budgetAlerts: false } });

  const replay = await executeCommand(request, captureResponse().response,
    { definition: alertSettingsUpdateCommand, workspaceId, input: example }, dependencies);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.replayed, true);
  assert.deepEqual(counters, { runs: 0, previews: 0, afterCommit: 0, audits: 1 });

  const conflict = await executeCommand(fakeRequest(owner, { ...example, budgetAlerts: false }, operationId), captureResponse().response,
    { definition: alertSettingsUpdateCommand, workspaceId, input: { ...example, budgetAlerts: false } }, dependencies);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.status, 409);
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.alerts, example, 'a reused operation id cannot change the settings');
});

test('alerts.update refuses out-of-range settings and bookkeepers before any writes or audit', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { members: [owner.uid, 'bookkeeper-1'], roles: { 'bookkeeper-1': 'bookkeeper' } });
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, counters);
  const invalidInput = { cashLowCents: -1 };
  const invalid = await executeCommand(fakeRequest(owner, invalidInput), captureResponse().response,
    { definition: alertSettingsUpdateCommand, workspaceId, input: invalidInput }, dependencies);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.status, 400);
    assert.equal(invalid.code, 'INVALID_ALERT_SETTINGS');
  }
  assert.equal(db.directWriteCount, 0);
  assert.equal(counters.audits, 0);

  const bookkeeper: RequestUser = { uid: 'bookkeeper-1', aal: 'aal2' };
  const example = alertSettingsUpdateCommand.describe.example;
  const denied = await executeCommand(fakeRequest(bookkeeper, example), captureResponse().response,
    { definition: alertSettingsUpdateCommand, workspaceId, input: example }, dependencies);
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.status, 403);
    assert.equal(denied.code, 'ROLE_REQUIRED');
  }
  assert.equal(db.directWriteCount, 0);
  assert.equal(counters.audits, 0);
});
