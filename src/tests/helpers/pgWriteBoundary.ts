import assert from 'node:assert/strict';
import type { Request } from 'express';
import type { Client } from 'pg';
import { commandRegistry } from '../../server/commands/defaultRegistry';
import { Firestore } from '../../server/db/pgFirestore';
import { runRegisteredCommand } from '../../server/utils/commandExecutor';

/** The real registry and transaction runner; the signed-in actor is supplied by the test. */
export function pgWorkspaceCommands() {
  const connectionString = process.env.LF_TEST_DATABASE_URL;
  assert.ok(connectionString, 'Only run against the test database');
  const db = new Firestore({ connectionString });
  return {
    run(uid: string, workspaceId: string, name: string, input: Record<string, unknown>) {
      const definition = commandRegistry.get(name);
      assert.ok(definition, `${name} must be registered`);
      const url = `/api/v1/commands/${name}`;
      const req = {
        method: 'POST', url, originalUrl: url, headers: {}, params: {}, query: {},
        body: { workspaceId, input }, user: { uid, email: `${uid}@example.test`, aal: 'aal1' },
      } as unknown as Request;
      return runRegisteredCommand(req, { definition, workspaceId, input }, { getDb: () => db });
    },
    close: () => db.terminate(),
  };
}

/** Run a direct database attempt with the ordinary browser role, never keep it. */
export async function asPgBrowser<T>(client: Client, uid: string, operation: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal1' })]);
    return await operation();
  } finally {
    await client.query('rollback');
  }
}

export async function expectBrowserPatchDenied(client: Client, uid: string, table: string, id: string, patch: Record<string, unknown>) {
  await assert.rejects(
    asPgBrowser(client, uid, () => client.query('select public.lf_update($1, $2, $3)', [table, id, patch])),
    { code: '42501' },
  );
}
