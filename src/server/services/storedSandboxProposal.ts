import type { SandboxBinding, StepPreview, StepState } from '../db/pg/sandboxReviewStore';
import type { Runner } from '../db/pg/sql';
import { CommandRefusal } from '../utils/commandExecutor';
import { redact } from './sandboxTools';

/** A single bound, read-only snapshot. Unlike reviewSandbox, it never replays a step or updates
 * the sandbox's timestamps, revision, or stored previews. Acceptance still rechecks the real books. */
export async function storedSandboxProposal(runner: Runner, binding: SandboxBinding, includePreview: boolean) {
  const { rows } = await runner.query<{
    expiresAt: string; stepId: string | null; command: string; position: number; state: StepState;
    failureReason: string | null; preview: StepPreview | null;
  }>(`select s.expires_at::text as "expiresAt", st.id as "stepId", st.command_name as command,
      st.position, st.state, st.failure_reason as "failureReason", case when $4 then st.preview end as preview
    from sandbox.sandboxes s left join sandbox."sandboxSteps" st on st.sandbox_id = s.id
    where s.id = $1 and s.workspace_id = $2 and s.person_id = $3 and s.status = 'open'
      and s.expires_at > statement_timestamp()
    order by st.position`, [binding.id, binding.workspaceId, binding.personId, includePreview]);
  if (rows.length === 0) throw new CommandRefusal('No open proposal belongs to you in this sandbox', 404, 'SANDBOX_NOT_FOUND');
  return {
    id: binding.id, workspaceId: binding.workspaceId, expiresAt: new Date(rows[0].expiresAt).toISOString(),
    steps: rows.flatMap(row => {
      if (!row.stepId) return [];
      const base = { id: row.stepId, command: row.command, position: row.position, state: row.state };
      if (!row.preview) return [base];
      // No inverse, raw input, internal IDs map, or dependency versions are needed to explain the preview.
      const { title, lines, accounts, effectiveDate, entityId, provisionalNumber, effects } = row.preview;
      return [{ ...base, failureReason: row.failureReason,
        preview: redact({ title, lines, accounts, effectiveDate, entityId, provisionalNumber, effects }) }];
    }),
  };
}
