import { z } from 'zod';
import { registerPlaidItemWebhook } from '../services/plaidClient';
import { deferEffects } from '../services/sandboxEffects';
import { CommandRefusal } from '../utils/commandExecutor';
import type { CommandDefinition } from './types';

const bankReconnectInput = z.object({
  workspaceId: z.string().min(1).optional(),
  bankId: z.string().min(1).describe('The local bank connection ID, not a provider token'),
});

type BankRow = { workspaceId?: unknown; institutionName?: string; access_token?: string };
function checkBank(workspaceId: string, bank: BankRow | undefined) {
  if (!bank || bank.workspaceId !== workspaceId) throw new CommandRefusal('Bank connection not found', 404, 'NOT_FOUND');
  return bank;
}

export const bankReconnectCommand: CommandDefinition<typeof bankReconnectInput, { bankId: string; institutionName: string }> = {
  name: 'bank.reconnect',
  input: bankReconnectInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  peopleOnly: true,
  async handler(ctx, tx, { bankId }) {
    const ref = ctx.db.collection('banks').doc(bankId);
    const bank = checkBank(ctx.workspaceId, (await tx.get(ref)).data());
    tx.update(ref, { status: 'active', updatedAt: new Date().toISOString() });
    // Plaid update mode ignores the webhook argument on the Link token. Re-register it *after*
    // the bank state and audit commit. A failed registration does not undo the reconnection.
    const webhook = process.env.PLAID_WEBHOOK_URL;
    const encryptedToken = bank.access_token;
    if (webhook && encryptedToken) {
      deferEffects(ctx.db, [{ kind: 'bank', action: 'register-webhook', target: bankId }], ctx.afterCommit,
        () => registerPlaidItemWebhook(ctx.db, bankId, encryptedToken, webhook));
    }
    return { bankId, institutionName: bank.institutionName || bankId };
  },
  async preview(ctx, { bankId }) {
    const bank = checkBank(ctx.workspaceId, (await ctx.db.collection('banks').doc(bankId).get()).data());
    return { title: `Mark ${bank.institutionName || bankId} as reconnected`, lines: ['Use only after completing Plaid’s sign-in.', 'No statement lines or ledger entries change.'] };
  },
  audit(_input, { bankId, institutionName }) {
    return { action: 'BANK_RECONNECTED', entityType: 'bank', entityId: bankId, description: `Reconnected bank feed (${institutionName})` };
  },
  risk: 'normal',
  describe: {
    sentence: 'Mark an existing connection active after signing in again through Plaid; this does not connect a new bank, store another token or sync any transactions.',
    example: { bankId: 'bank_1' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The connection is missing or not in this workspace.', next: 'Reload the workspace’s bank connections.' },
      { code: 'PERSON_ONLY', when: 'An API key tries to reconnect a feed.', next: 'Sign in and finish the connection update through Plaid.' },
    ],
  },
};
