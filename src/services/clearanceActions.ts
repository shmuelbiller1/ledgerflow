import { runCommand } from '../lib/runCommand';

/**
 * Mark entries cleared by the bank, with the day it cleared (CA-04), or not cleared any more —
 * through the server (writers only; the period lock and the entry's own date are checked there).
 */
export async function setCleared(workspaceId: string, transactionIds: string[], change: { cleared: true; clearanceDate?: string } | { cleared: false }): Promise<void> {
  // runCommand takes the token and sets the content type; a refusal arrives as the server's own words
  await runCommand({
    path: '/api/v1/transactions/reconciliation/clear',
    method: 'POST',
    body: { workspaceId, transactionIds, ...change },
  });
}
