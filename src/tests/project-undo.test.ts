import './helpers/dom';
import test, {afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {deleteProjectWithUndo} from '../lib/projectUndo';
import {useAuthStore} from '../stores/useAuthStore';
import {setComponentWorkspace} from './helpers/componentFixtures';
import {getSupabase} from '../lib/db/client';
import {toast} from 'sonner';

afterEach(async()=>{mock.restoreAll(); await getSupabase().auth.dispose();});

/**
 * The delete and the undo are commands now, so the mock answers the two command routes and records the envelope
 * each was sent. What the tests hold is unchanged: the exact row travels back, the undo writes it once, an expired
 * or cross-workspace undo writes nothing, a recreated id is refused, and a viewer cannot delete at all.
 */
function setup() {
  setComponentWorkspace();
  const original = { uid: 'test-user', workspaceId: 'component-workspace', name: 'פרויקט 12', status: 'active', budgetCents: 123456, createdAt: '2026-01-01', metadata: { nested: ['א', 7] } };
  let record: typeof original | null = structuredClone(original);
  /** one entry per command the client sent: the name, and the input it carried */
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as { input?: Record<string, unknown> } : {};
    const command = /\/api\/v1\/commands\/([^/?]+)/.exec(url)?.[1];
    if (command === 'project.delete') {
      calls.push({ command, input: body.input || {} });
      if (!record) return new Response(JSON.stringify({ status: 'error', code: 'NOT_FOUND', message: 'This project is not in the selected workspace.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      const deleted = structuredClone({ ...record, id: 'p' });
      record = null;
      return new Response(JSON.stringify({ status: 'success', command, data: { project: deleted }, replayed: false }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (command === 'project.restore') {
      calls.push({ command, input: body.input || {} });
      const project = (body.input?.project || {}) as typeof original;
      if (record) return new Response(JSON.stringify({ status: 'error', code: 'CONFLICT', message: 'A record already uses this ID. It was not overwritten.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      record = project;
      return new Response(JSON.stringify({ status: 'success', command, data: { project }, replayed: false }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ status: 'error', code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${command}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  mock.method(toast, 'success', () => 'undo-toast');
  mock.method(toast, 'dismiss', () => {});
  mock.method(toast, 'error', () => {});
  return { original, calls, setRecord: (value: typeof original | null) => { record = value; } };
}

test('project Undo restores the exact durable snapshot with same ID, one time, within 10 seconds', async () => {
  const { original, calls } = setup();
  const undo = await deleteProjectWithUndo('p');
  assert.ok(undo);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'project.delete');
  assert.deepEqual(calls[0].input, { id: 'p' });
  await undo();
  await undo();
  assert.equal(calls.length, 2, 'the second press of Undo must not restore twice');
  assert.equal(calls[1].command, 'project.restore');
  assert.deepEqual((calls[1].input.project as Record<string, unknown>).name, original.name);
  assert.equal((calls[1].input.project as Record<string, unknown>).id, 'p');
  assert.deepEqual((calls[1].input.project as Record<string, unknown>).metadata, original.metadata);
});

test('expired or cross-workspace Undo cannot write; viewer cannot delete', async () => {
  const { calls } = setup();
  const undo = await deleteProjectWithUndo('p');
  actTime(11000);
  await undo!();
  assert.equal(calls.length, 1);
  mock.restoreAll();
  const next = setup();
  const another = await deleteProjectWithUndo('p');
  useAuthStore.setState({ currentWorkspaceId: 'other' });
  await another!();
  assert.equal(next.calls.length, 1);
  setComponentWorkspace('viewer');
  await assert.rejects(deleteProjectWithUndo('p'), /read-only/);
});

function actTime(offset: number) {
  const now = Date.now();
  mock.method(Date, 'now', () => now + offset);
}

test('Undo refuses to overwrite a recreated record and keeps restore retryable after refusal', async () => {
  const { calls, setRecord, original } = setup();
  const undo = await deleteProjectWithUndo('p');
  setRecord({ ...original, name: 'Another record' });
  await undo!();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, 'project.restore', 'the refusal is the server’s answer, not a silent success');
  setRecord(null);
  await undo!();
  assert.equal(calls.length, 3, 'a refused restore stays retryable until the window closes');
});
