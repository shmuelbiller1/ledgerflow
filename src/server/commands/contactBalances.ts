import { z } from 'zod';
import { calculateAmountDue } from '../../lib/documentMath';
import { isOpenBill, isOpenInvoice } from '../../lib/txFilters';
import { toBaseCents } from '../reports/partyReports';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * The balance a contact's row carries: what is still owed to a customer, or by us to a vendor.
 *
 * The browser computed it. It read every invoice (or bill) for the party with `getDocs`, filtered the open
 * ones, converted each to the base currency and wrote `balanceCents` back — so the number depended on rows the
 * open tab could see, and two tabs that synced a moment apart wrote different balances for the same party
 * without either being wrong. The rows are the workspace's record; the sum belongs with them.
 *
 * What this is *not*: a posting. Nothing here touches the ledger, an account, a tax figure or a document — it
 * replaces a cached total on one contact row with the total of that contact's own open documents.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');

export const contactBalanceInput = z.object({ id: idSchema }).strict();

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type BalanceInput = z.output<typeof contactBalanceInput>;
type BalanceResult = { id: string; balanceCents: number; openDocuments: number; baseCurrency: string };

interface ContactBalanceSpec {
  /** the command's name — `customer.balance`, `vendor.balance` */
  name: `${string}.${string}`;
  /** the collection the contact lives in */
  contacts: string;
  /** the documents that make up the balance, and the field that names the contact on them */
  documents: string;
  partyField: string;
  isOpen: (document: { status?: string } | null | undefined) => boolean;
  /** what the balance means, for the sentence the command describes itself with */
  meaning: string;
  example: Record<string, unknown>;
}

/**
 * One handler for both directions. A customer's balance is what they still owe us and a vendor's is what we
 * still owe them, but the arithmetic — open documents, amount due, converted to the base currency, summed — is
 * the same, and keeping it in one place is the point: two copies is how the browser's sum and a report's sum
 * started to differ.
 */
function balanceCommand(spec: ContactBalanceSpec): CommandDefinition<typeof contactBalanceInput, BalanceResult> {
  return {
    name: spec.name,
    input: contactBalanceInput,
    roles: ROLES,
    async handler(ctx: CommandContext, tx, input: BalanceInput) {
      const contactRef = ctx.db.collection(spec.contacts).doc(input.id);
      const snapshot = await tx.get(contactRef);
      const contact = snapshot.data();
      if (!snapshot.exists || contact?.workspaceId !== ctx.workspaceId) {
        throw Object.assign(new HttpError('This contact is not in the selected workspace.', 404), { code: 'NOT_FOUND' });
      }
      const documents = await tx.get(
        ctx.db.collection(spec.documents)
          .where('workspaceId', '==', ctx.workspaceId)
          .where(spec.partyField, '==', input.id),
      );
      const open = documents.docs.map(row => row.data()).filter(spec.isOpen);
      const base = String(ctx.workspace?.currency || 'USD').trim().toUpperCase();
      const balanceCents = open.reduce((sum, document) => sum
        + toBaseCents(calculateAmountDue(document as { amountCents?: number; amountPaidCents?: number; depositCents?: number }),
          (document as { exchangeRate?: number }).exchangeRate,
          (document as { currency?: string }).currency,
          base), 0);

      const now = new Date().toISOString();
      tx.update(contactRef, { balanceCents, updatedAt: now });
      return { id: input.id, balanceCents, openDocuments: open.length, baseCurrency: base };
    },
    async preview(ctx: CommandContext, input: BalanceInput) {
      const snapshot = await ctx.db.collection(spec.contacts).doc(input.id).get();
      if (!snapshot.exists || snapshot.data()?.workspaceId !== ctx.workspaceId) {
        throw new HttpError('This contact is not in the selected workspace.', 404);
      }
      const documents = await ctx.db.collection(spec.documents)
        .where('workspaceId', '==', ctx.workspaceId)
        .where(spec.partyField, '==', input.id)
        .get();
      const open = documents.docs.map(row => row.data()).filter(spec.isOpen);
      return {
        title: `Recalculate the balance of ${String(snapshot.data()?.name || input.id)}`,
        lines: [`${open.length} open document${open.length === 1 ? '' : 's'}`, 'No document is changed; one cached total is refreshed.'],
      };
    },
    audit(_input: BalanceInput, result: BalanceResult) {
      return {
        action: 'CONTACT_BALANCE_REFRESHED',
        entityType: spec.contacts,
        entityId: result.id,
        description: `Balance of ${spec.meaning}: ${result.balanceCents} ${result.baseCurrency} from ${result.openDocuments} open document(s)`,
        details: { balanceCents: result.balanceCents, openDocuments: result.openDocuments },
      };
    },
    inverse() { return null; },
    risk: 'normal',
    describe: {
      sentence: `Recompute the stored balance of ${spec.meaning} from the open documents the workspace holds, so a cached total cannot disagree with the records; do not use it to post, pay or settle anything.`,
      example: spec.example,
      refusals: [
        { code: 'NOT_FOUND', when: 'The contact is not in the selected workspace.', next: 'Reload the contact list and choose a contact in this workspace.' },
        { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      ],
      // A vendor balance is followed by a bill, never a customer invoice.
      next: [spec.documents === 'bills'
        ? { command: 'bill.create', label: 'Record a bill' }
        : { command: 'invoice.create', label: 'New invoice' }],
    },
  };
}

export const customerBalanceCommand = balanceCommand({
  name: 'customer.balance',
  contacts: 'customers',
  documents: 'invoices',
  partyField: 'customerId',
  isOpen: isOpenInvoice,
  meaning: 'a customer (what they still owe)',
  example: { id: 'customer_123' },
});

export const vendorBalanceCommand = balanceCommand({
  name: 'vendor.balance',
  contacts: 'vendors',
  documents: 'bills',
  partyField: 'vendorId',
  isOpen: isOpenBill,
  meaning: 'a vendor (what we still owe)',
  example: { id: 'vendor_123' },
});
