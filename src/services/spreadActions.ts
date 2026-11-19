import { toast } from 'sonner';
import { uiLanguageNow } from '../lib/i18n/uiLanguageNow';
import { useLedgerStore } from '../stores/useLedgerStore';
import { commandErrorMessage, runCommand } from '../lib/runCommand';

/**
 * Undo a bill's (K-17) or invoice's (K-16) spread over months: the server voids its entries (refused
 * once one of its months is closed). The schedule is cleared on screen at once too, because
 * re-posting the document (Void right after) reads it from the store before the live update arrives.
 */
export async function undoSpreadRequest(kind: 'bill' | 'invoice', workspaceId: string, documentId: string): Promise<boolean> {
  try {
    await runCommand({
      path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/${kind === 'bill' ? 'bills' : 'invoices'}/${encodeURIComponent(documentId)}/spread/undo`,
      method: 'POST',
      body: {},
    });
  } catch (error) {
    // a refusal here is expected and explainable (a closed month); the caller gets false and the
    // screen is left as it was
    toast.error(commandErrorMessage(error, uiLanguageNow()));
    return false;
  }
  if (kind === 'bill') {
    useLedgerStore.setState(st => ({ bills: (st.bills || []).map(x => (x.id === documentId ? { ...x, prepaidSchedule: undefined } : x)) }));
  } else {
    useLedgerStore.setState(st => ({ invoices: (st.invoices || []).map(x => (x.id === documentId ? { ...x, revenueSchedule: undefined } : x)) }));
  }
  return true;
}
