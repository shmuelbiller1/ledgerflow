import { quoteIdent, type Runner } from './sql';
import { FirestoreError, invalid } from './values';

export function validateSandboxId(id: string): string {
  if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    throw invalid('Expected a sandbox id (UUID)');
  }
  return id.toLowerCase();
}

/** Table source for the shared query compiler and for code migrating off raw public table names. */
export function tableSource(collectionId: string, sandboxId?: string): string {
  return `${sandboxId ? 'sandbox_read' : 'public'}.${quoteIdent(collectionId)}`;
}

/** Only use inside a transaction: neither the role nor tenant scope may survive pool release. */
export async function enterSandbox(runner: Runner, sandboxId: string): Promise<void> {
  await runner.query('set local role lf_sandbox');
  // #976: overlay tables are tiny, so PostgreSQL scans them whole; under SERIALIZABLE a full scan
  // takes a relation-wide predicate lock and unrelated drafts falsely conflict (40001). Index scans
  // lock only the rows/pages they read.
  await runner.query('set local enable_seqscan = off');
  await runner.query("select set_config('lf.sandbox_id', $1, true), set_config('request.jwt.claims', '', true)", [sandboxId]);
  const { rows } = await runner.query<{ active: boolean }>('select sandbox.active_workspace() is not null as active');
  if (!rows[0]?.active) throw new FirestoreError(5, 'Sandbox is missing, closed or expired');
}
