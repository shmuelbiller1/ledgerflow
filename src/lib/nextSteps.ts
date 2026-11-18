/**
 * What a person can do next once a document is saved — as buttons for the toast, and in the manifest's words.
 *
 * The save used to end in a line of text ("Invoice saved"), which tells the person nothing about the thing they
 * were in the middle of. The record page already reads its next step from the manifest (`offeredSteps`), so the
 * toast reads the same place: the payment step's label is `payment.receive`'s own label, not a sentence typed into a
 * screen, and a step the manifest stops offering disappears from the toast with it.
 *
 * What is *not* from the manifest: sending. It is an email, not a ledger command, so the screen owns that word the
 * same way the record page does. `record-next-step.test.ts` holds every label here to the manifest.
 */
import { offeredSteps } from '../hooks/useCommand';

/** What pressing a step does. The screen maps these to its own handlers; nothing here runs a command blindly. */
export type SavedStepAction = 'send' | 'payment' | 'new';

export interface SavedStep {
  /** The words on the button. */
  label: string;
  /** What the screen should open, not an input: a payment needs an amount nobody typed yet. */
  action: SavedStepAction;
}

/** An invoice that is not settled has a payment waiting; one that is not issued yet can be sent. */
export function invoiceSavedSteps(invoice: { status?: string; amountCents?: number; amountPaidCents?: number }): SavedStep[] {
  const payment = offeredSteps('invoice.update').find(step => step.command === 'payment.receive');
  const settled = (invoice.amountPaidCents || 0) >= (invoice.amountCents || 0);
  const issued = Boolean(invoice.status && invoice.status !== 'draft');
  return [
    // a draft is the one you send; a document already with the customer is not re-sent by a toast
    ...(invoice.status === 'draft' ? [{ label: 'Send it', action: 'send' as const }] : []),
    // the manifest's own step, and only while something is still owed
    ...(!settled && payment ? [{ label: payment.label, action: 'payment' as const }] : []),
    ...(issued ? [] : [{ label: 'New invoice', action: 'new' as const }]),
  ];
}
