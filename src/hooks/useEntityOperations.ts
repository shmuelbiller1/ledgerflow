import { getIdToken } from '../firebase';
import { runCommand as runServerCommand } from '../lib/runCommand';
import { guestSession, assertGuestSession, SAMPLE_WORKSPACE_ID } from '../lib/db/guestDatabase';
import { localSet, localUpdate } from '../lib/db/localStore';
import { deletePlainRecord, savePlainRecord } from '../lib/recordWrites';
import { withSamplePosting } from '../lib/guestPosting';
import { workspaceActor } from '../lib/guestActor';
import { savedInOtherWorkspace, workspaceChangedSince } from '../lib/saveWorkspace';
import { collection, doc, query, where, getDocs, getDoc } from '../lib/db/firestore';
import { learnedPatternId } from '../lib/learnedPatterns';
import { db } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { toast } from 'sonner';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';
import { LedgerPostService } from '../services/LedgerPostService';

import { isOpenInvoice, isOpenBill } from '../lib/txFilters';
import { calculateAmountDue } from '../lib/documentMath';
import { deliveryPhrase, preferredDelivery, sendsByEmail } from '../lib/delivery';
import { toBaseCents } from '../server/reports/partyReports';
import { approvalForSave, holdsSending, isIssuedForApproval, normalizeInvoiceApproval } from '../lib/invoiceApproval';
import { useCurrentRole } from '../hooks/useCurrentRole';
import { postingToday } from '../services/ledgerPost/postingCore';
import { showBudgetWarnings } from '../lib/budgetWarnings';
import { reportCreditLimitRefusal } from '../lib/creditLimitPrompt';
import { mergeMetadataPatch } from '../lib/metadataPatch';
import { RMAS_METADATA_FIELD, WARRANTIES_METADATA_FIELD } from '../lib/warehouseRecords';
import type { InvoiceApprovalRecord } from '../lib/invoiceApproval';
import type { Bill, CreditNote, Customer, Invoice, Transaction, VendorCredit } from '../types';

interface EntityInput {
  customerId?: string; vendorId?: string; description?: string; vendorName?: string; customerName?: string; categoryId?: string; categoryName?: string; status?: string; forceSend?: boolean;
  lines?: { accountId?: string; accountName?: string }[];
}

type StoredDocumentPath = 'invoices' | 'bills' | 'creditNotes' | 'vendorCredits' | 'customers' | 'vendors';

/** What the auto-email after a save looks at: the customer, the text, and the two gates (Y-27, BE-04). */
interface InvoiceForEmail {
  customerId?: string;
  metadata?: Record<string, unknown>;
  amountCents?: number;
  exchangeRate?: number;
  status?: string;
  approval?: InvoiceApprovalRecord;
}

/**
 * The saved copy of a record: the loaded one, else read from the database. Collections load only
 * when a screen needs them (src/lib/ledgerCollections.ts), so an edit must never be merged with
 * "nothing" and posted as a partial document.
 */
async function savedRecord<T>(path: StoredDocumentPath, id: string): Promise<T | undefined> {
  const loaded = (useLedgerStore.getState()[path] as Array<{ id: string }> | undefined)?.find(r => r.id === id);
  if (loaded) return loaded as T;
  const snap = await getDoc(doc(db, path, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertCustomerHistoryServerManaged(path: string, data: Record<string, unknown>): void {
  if (path !== 'customers') return;
  const protectedKeys = [WARRANTIES_METADATA_FIELD, RMAS_METADATA_FIELD];
  const metadata = data.metadata;
  const patchesProtectedSubtree = isRecord(metadata) && protectedKeys.some(key => Object.hasOwn(metadata, key));
  const patchesProtectedPath = Object.keys(data).some(field => protectedKeys.some(key => {
    const protectedPath = `metadata.${key}`;
    return field === protectedPath || field.startsWith(`${protectedPath}.`);
  }));
  if (patchesProtectedSubtree || patchesProtectedPath) {
    throw new Error('Warranty and return-authorization history can only be changed through their dedicated server workflows.');
  }
}

async function mergeLocalPartyMetadata(
  path: 'customers' | 'vendors',
  id: string,
  workspaceId: string,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Read the current row rather than the possibly stale list cache: sequential sample-company
  // edits must merge over the latest persisted metadata, just like the server command transaction.
  const snapshot = await getDoc(doc(db, path, id));
  const saved = snapshot.data();
  if (!isRecord(saved) || saved.workspaceId !== workspaceId) throw new Error('Contact not found in this workspace.');
  return mergeMetadataPatch(saved.metadata, updates, path === 'customers' ? [WARRANTIES_METADATA_FIELD, RMAS_METADATA_FIELD] : []);
}

function isActiveDocumentContext(actorUid: string, workspaceId: string): boolean {
  const auth = useAuthStore.getState();
  return auth.user?.uid === actorUid && auth.currentWorkspaceId === workspaceId;
}

class StaleDocumentCommandContextError extends Error {
  constructor() {
    super('The signed-in user or workspace changed before the command was sent.');
    this.name = 'StaleDocumentCommandContextError';
  }
}

function isStaleDocumentCommandContext(error: unknown): boolean {
  return error instanceof StaleDocumentCommandContextError;
}

function putCommandTransactions(actorUid: string, workspaceId: string, transactions: unknown): void {
  if (!Array.isArray(transactions) || transactions.length === 0 || !isActiveDocumentContext(actorUid, workspaceId)) return;
  const written = transactions as Transaction[];
  const posted = new Set(written.map(transaction => transaction.id));
  const store = useLedgerStore.getState();
  store.setTransactions([...written, ...(store.transactions || []).filter(transaction => !posted.has(transaction.id))]);
}

async function sendDocumentCommandRequest(name: string, workspaceId: string, input: Record<string, unknown>, operationId: string, token: string | null): Promise<Response> {
  return fetch(`/api/v1/commands/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': operationId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ workspaceId, input }),
  });
}

/** Execute one registered document command with a stable operation key across safe network/429 retries. */
async function executeDocumentCommand(name: string, workspaceId: string, input: Record<string, unknown>, actorUid: string): Promise<Record<string, unknown>> {
  const token = await getIdToken().catch(() => null);
  if (!isActiveDocumentContext(actorUid, workspaceId)) throw new StaleDocumentCommandContextError();
  // The command runner accepts IDs matching [A-Za-z0-9_.:-]; remove UUID separators so
  // the same key survives automatic retries instead of being rejected before execution.
  const operationId = crypto.randomUUID().replaceAll('-', '');
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    if (!isActiveDocumentContext(actorUid, workspaceId)) throw new StaleDocumentCommandContextError();
    try {
      response = await sendDocumentCommandRequest(name, workspaceId, input, operationId, token);
    } catch (error) {
      if (!isActiveDocumentContext(actorUid, workspaceId)) throw new StaleDocumentCommandContextError();
      if (attempt >= 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('Retry-After') || 1);
      await new Promise(resolve => setTimeout(resolve, Math.min(5, Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 1)) * 1000));
      continue;
    }
    break;
  }
  const payload = await response.json().catch(() => null);
  const answer = isRecord(payload) ? payload : {};
  if (!response.ok) {
    if (!isActiveDocumentContext(actorUid, workspaceId)) throw new StaleDocumentCommandContextError();
    const details = isRecord(answer.details) ? answer.details : {};
    if (details.code === 'CREDIT_LIMIT' && isActiveDocumentContext(actorUid, workspaceId)
      && (name === 'invoice.create' || name === 'invoice.update')) {
      reportCreditLimitRefusal({
        docId: String(input.id || (isRecord(input.invoice) ? input.invoice.id : '')),
        message: String(details.error || answer.message || 'The customer credit limit was exceeded.'),
        canOverride: details.canOverride === true,
      });
    }
    throw new Error(String(answer.message || answer.error || 'Server rejected the document command'));
  }

  const result = isRecord(answer.data) ? answer.data : {};
  if (!isActiveDocumentContext(actorUid, workspaceId)) return result;
  const body = isRecord(result.body) ? result.body : {};
  if (Array.isArray(body.warnings)) body.warnings.forEach(warning => toast.warning(String(warning)));
  if (typeof body.creditLimitNote === 'string') toast.info(body.creditLimitNote);
  showBudgetWarnings(body);
  putCommandTransactions(actorUid, workspaceId, result.transactions);
  return result;
}

function documentDataAndOverride(data: Record<string, unknown>): { document: Record<string, unknown>; override?: { reason: string } } {
  const { creditLimitOverride, ...document } = data;
  return {
    document,
    ...(isRecord(creditLimitOverride) && typeof creditLimitOverride.reason === 'string'
      ? { override: { reason: creditLimitOverride.reason } }
      : {}),
  };
}

export function useEntityOperations() {
  const user = useAuthStore(workspaceActor);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const runDocumentCommand = (name: string, workspaceId: string, input: Record<string, unknown>) => {
    if (!user?.uid) return Promise.reject(new Error('Sign in before running a document command.'));
    return executeDocumentCommand(name, workspaceId, input, user.uid);
  };
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const role = useCurrentRole();
  const analyticalPatternCache = useLedgerStore(s => s.analyticalPatternCache);

  /**
   * Recalculate and update durable balanceCents for a customer or vendor entity
   * Queries authoritative Firestore data scoped to this entity rather than relying on truncated UI cache.
   */
  const syncEntityBalance = async (entityType: 'customers' | 'vendors', entityId: string, sampleSession: object | null) => {
    if (!entityId || !currentWorkspaceId) return;
    try {
      // a live workspace asks the server, which reads every open document for this contact — the tab's own copy
      // is only what it has seen, so two tabs synced a moment apart used to write different balances for the
      // same contact, and neither was wrong about the rows it could see
      if (!sampleSession) {
        await runDocumentCommand(entityType === 'customers' ? 'customer.balance' : 'vendor.balance', currentWorkspaceId, { id: entityId });
        return;
      }
      assertGuestSession(sampleSession);
      let balanceCents = 0;

      if (entityType === 'customers') {
        const q = query(
          collection(db, 'invoices'),
          where('workspaceId', '==', currentWorkspaceId),
          where('customerId', '==', entityId)
        );
        const snap = await getDocs(q);
        const customerInvoices = snap.docs.map(d => d.data()).filter(isOpenInvoice);
        // what is still owed (after deposits, payments, credits), in the base currency
        balanceCents = customerInvoices.reduce((sum, inv) => sum + toBaseCents(calculateAmountDue(inv), inv.exchangeRate, inv.currency, homeCurrency), 0);
      } else {
        const q = query(
          collection(db, 'bills'),
          where('workspaceId', '==', currentWorkspaceId),
          where('vendorId', '==', entityId)
        );
        const snap = await getDocs(q);
        const vendorBills = snap.docs.map(d => d.data()).filter(isOpenBill);
        balanceCents = vendorBills.reduce((sum, b) => sum + toBaseCents(calculateAmountDue(b), b.exchangeRate, b.currency, homeCurrency), 0);
      }

      await localUpdate(entityType, entityId, {
        balanceCents,
        updatedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn(`[useEntityOperations] balanceCents sync deferred for ${entityType}/${entityId}`, e);
    }
  };

  const recordLearnedPattern = async (description: string, accountId: string, accountName: string) => {
    if (!user || !currentWorkspaceId || !description) return;
    const cleanDesc = description.toLowerCase().trim();
    if (cleanDesc.length < 3) return;
    
    // N-14: collision-free (Hebrew included), same id as before for plain Latin text
    const patternId = learnedPatternId(cleanDesc);
    try {
      const existing = analyticalPatternCache[cleanDesc];
      // the count and the delta are the workspace's record, so a live workspace asks the server for both in one
      // command: two tabs filing the same description used to write the same "1" from their own caches
      if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
        await localSet('rulePatterns', `${currentWorkspaceId}_${patternId}`, {
          uid: user.uid,
          workspaceId: currentWorkspaceId,
          description: cleanDesc,
          accountId,
          accountName,
          count: (existing?.count || 0) + 1,
          lastUpdated: new Date().toISOString()
        }, { merge: true });

        // Feed delta learning to learnedDeltas for AI and categorization models
        await localSet('learnedDeltas', `${currentWorkspaceId}_${patternId}`, {
          id: `${currentWorkspaceId}_${patternId}`,
          uid: user.uid,
          workspaceId: currentWorkspaceId,
          apiKeyId: "human_web_console",
          description: cleanDesc.slice(0, 500),
          category: (accountName || "General").slice(0, 100),
          timestamp: new Date().toISOString()
        }, { merge: true });
      } else {
        await runDocumentCommand('autorule.learn', currentWorkspaceId, { description: cleanDesc, accountId, accountName });
      }
    } catch (e) {
      console.warn("Soft learning deferred", e);
    }
  };

  /**
   * Invoice approval (BE-04): the workspace's rule, stamped onto an invoice at the one moment it
   * starts going out — it is created issued, or a draft is moved to issued. A later edit never
   * touches it, so an invoice already with the customer keeps its reminders and its place in the
   * accounts, and a save that carries an approval of its own (Approve / Send back in the invoice
   * list) is left exactly as it is. Returns the field to write, or nothing at all.
   */
  const approvalStamp = (merged: Invoice, wasIssued: boolean): { approval?: InvoiceApprovalRecord } => {
    const ws = useAuthStore.getState().getCurrentWorkspace();
    const settings = normalizeInvoiceApproval(ws?.invoiceApproval);
    if (!settings.enabled) return {};
    if (wasIssued || 'approval' in merged) return {};
    const stamp = approvalForSave(merged, settings, { role, uid: user?.uid, now: new Date().toISOString(), twoPerson: ws?.twoPersonRule === true }, homeCurrency);
    return stamp ? { approval: stamp } : {};
  };

  const announceSaved = (message: string, workspaceId: string | null | undefined) => {
    if (workspaceId && workspaceChangedSince(workspaceId)) toast.info(savedInOtherWorkspace('It', workspaceId));
    else toast.success(message);
  };

  const addEntity = async <T extends object>(path: string, data: T & EntityInput, successMsg?: string) => {
    if (!user || !currentWorkspaceId) return;
    const sampleSession = guestSession();
    try {
      assertCustomerHistoryServerManaged(path, data as Record<string, unknown>);
      let docId = doc(collection(db, path)).id;
      const finalData = {
        ...data,
        id: docId,
        uid: user.uid,
        workspaceId: currentWorkspaceId,
        createdAt: new Date().toISOString(),
        // BE-04: an invoice that goes straight out over the limit waits for a signature first
        ...(path === 'invoices' ? approvalStamp(data as unknown as Invoice, false) : {})
      };

      if (path === 'invoices') {
        let posted: Record<string, unknown>;
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          posted = await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postInvoiceLedger(docId, finalData as unknown as Partial<Invoice>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData }, context)) as Record<string, unknown>;
        } else {
          const { document, override } = documentDataAndOverride(finalData);
          posted = await runDocumentCommand('invoice.create', currentWorkspaceId, {
            invoice: document,
            postingDay: postingToday(),
            ...(override ? { creditLimitOverride: override } : {}),
          });
        }
        if (typeof posted.cogsPendingReason === 'string') toast.warning(posted.cogsPendingReason);
        if (finalData.customerId) void syncEntityBalance('customers', finalData.customerId, sampleSession);
      } else if (path === 'bills') {
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postBillLedger(docId, finalData as unknown as Partial<Bill>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData }, context));
        } else {
          await runDocumentCommand('bill.create', currentWorkspaceId, { bill: finalData, postingDay: postingToday() });
        }
        if (finalData.vendorId) void syncEntityBalance('vendors', finalData.vendorId, sampleSession);
      } else if (path === 'creditNotes') {
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postCreditNoteLedger(docId, finalData as unknown as Partial<CreditNote>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData }, context));
        } else {
          await runDocumentCommand('creditnote.create', currentWorkspaceId, { creditNote: finalData, postingDay: postingToday() });
        }
      } else if (path === 'vendorCredits') {
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postVendorCreditLedger(docId, finalData as unknown as Partial<VendorCredit>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData }, context));
        } else {
          await runDocumentCommand('vendorcredit.create', currentWorkspaceId, { vendorCredit: finalData, postingDay: postingToday() });
        }
      } else if (path === 'customers' && !sampleSession && currentWorkspaceId !== SAMPLE_WORKSPACE_ID) {
        const customer = { ...data, id: docId, workspaceId: currentWorkspaceId } as Record<string, unknown>;
        delete customer.uid;
        delete customer.createdAt;
        delete customer.balanceCents;
        await runDocumentCommand('customer.create', currentWorkspaceId, { customer });
      } else if (path === 'vendors' && !sampleSession && currentWorkspaceId !== SAMPLE_WORKSPACE_ID) {
        const vendor = { ...data, id: docId, workspaceId: currentWorkspaceId } as Record<string, unknown>;
        delete vendor.uid;
        delete vendor.createdAt;
        delete vendor.updatedAt;
        delete vendor.balanceCents;
        await runDocumentCommand('vendor.create', currentWorkspaceId, { vendor });
      } else if (path === 'transactions') {
        await runServerCommand({
          path: '/api/v1/transactions',
          method: 'POST',
          body: { workspaceId: currentWorkspaceId, transaction: finalData },
        });
      } else if (path === 'reconciliations' || path === 'payments' || path === 'journalEntries') {
        throw new Error(`Direct browser creation on ${path} is disabled; use the server ledger API.`);
      } else if (path === 'chartAccounts' && !sampleSession && currentWorkspaceId !== SAMPLE_WORKSPACE_ID) {
        // an account is not an ordinary record: the chart's command keeps its code unique and its balance at zero
        const account = finalData as Record<string, unknown>;
        const created = await runDocumentCommand('chartaccount.create', currentWorkspaceId, {
          code: String(account.code || ''), name: String(account.name || ''), type: String(account.type || ''),
          ...(account.category ? { category: String(account.category) } : {}),
          ...(account.description ? { description: String(account.description) } : {}),
        });
        // the chart chooses the id; a caller that needs to name the new account uses the one the server answered with
        const createdId = (created as { id?: unknown } | undefined)?.id;
        if (typeof createdId === 'string' && createdId) docId = createdId;
      } else {
        await savePlainRecord(currentWorkspaceId, path, docId, finalData, { create: true });
      }

      // LEARNING: If we added something with a description and a category, learn it.
      if (data.description || data.vendorName || data.customerName) {
        const desc = data.description || data.vendorName || data.customerName;
        // Check for lines or direct category fields
        if (data.lines && data.lines.length > 0) {
          const mainLine = data.lines[0];
          if (mainLine.accountId && mainLine.accountName && mainLine.accountName !== 'Uncategorized') {
            void recordLearnedPattern(desc as string, mainLine.accountId, mainLine.accountName);
          }
        } else if (data.categoryId && data.categoryName) {
           void recordLearnedPattern(desc as string, data.categoryId, data.categoryName);
        }
      }

      // PREV-5: a reply after another workspace was opened says where it was saved, never "saved" here
      if (successMsg) announceSaved(successMsg, currentWorkspaceId);
      // A new invoice saved as "sent" is emailed once it is posted
      if (path === 'invoices' && finalData.status === 'sent') await sendInvoiceEmail(docId, finalData);

      return doc(db, path, docId);
    } catch (error) {
      if (!isStaleDocumentCommandContext(error)) handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  // Emails the invoice to the customer (server: documentEmailService.ts). Called after the invoice
  // is posted, so the server sees an issued invoice; the send is logged there.
  const sendInvoiceEmail = async (id: string, invoiceData: InvoiceForEmail) => {
    if (!currentWorkspaceId) return false;
    if (currentWorkspaceId === SAMPLE_WORKSPACE_ID || useAuthStore.getState().isGuest) {
      toast.info('Saved in the sample company. Demo invoices are not emailed.');
      return false;
    }
    // BE-04: an invoice nobody has signed off yet stays inside, whoever saved it
    if (holdsSending(invoiceData, useAuthStore.getState().getCurrentWorkspace()?.invoiceApproval, homeCurrency)) {
      toast.info('The invoice was saved. It is not emailed yet: it is over the approval limit (Settings → Emails & Reminders), so it waits for an owner or an accountant to approve it in the invoice list.');
      return false;
    }
    const customer = invoiceData.customerId ? await savedRecord<Customer>('customers', invoiceData.customerId) : undefined;
    // Y-27: sending this because the invoice was saved as "sent" is the app acting on its own, so it
    // respects how the customer wants documents; pressing Email on the invoice is a person deciding.
    if (!sendsByEmail(customer)) {
      toast.info(`The invoice was saved. It was not emailed: ${customer?.name || 'this customer'} gets ${deliveryPhrase(preferredDelivery(customer))}.`);
      return false;
    }
    const to = String(invoiceData.metadata?.sentTo || customer?.email || '').trim();
    if (!to) {
      toast.error('The invoice was not emailed: the customer has no email address.');
      return false;
    }
    try {
      const data = await runServerCommand<{ to?: string }>({
        path: `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}/emails/invoices/${encodeURIComponent(id)}`,
        method: 'POST',
        body: {
          template: 'invoice',
          to,
          ...(typeof invoiceData.metadata?.emailSubject === 'string' ? { subject: invoiceData.metadata.emailSubject } : {}),
          ...(typeof invoiceData.metadata?.emailBody === 'string' ? { body: invoiceData.metadata.emailBody } : {}),
        },
      });
      toast.success(`Invoice emailed to ${data.to}.`);
      return true;
    } catch (err) {
      toast.error(`The invoice was saved but not emailed: ${err instanceof Error ? err.message : 'network error'}`);
      return false;
    }
  };

  const updateEntity = async <T extends object>(path: string, id: string, updates: T & EntityInput, successMsg?: string) => {
    const sampleSession = guestSession();
    try {
      const { forceSend, ...changes } = updates || {};
      const finalData = {
        ...changes,
        updatedAt: new Date().toISOString()
      };
      assertCustomerHistoryServerManaged(path, finalData as Record<string, unknown>);
      const usePartyCommand = (path === 'customers' || path === 'vendors')
        && !sampleSession && currentWorkspaceId !== SAMPLE_WORKSPACE_ID;

      // Email the invoice when it becomes "sent" (after it is posted below)
      const previousInvoice = path === 'invoices' ? await savedRecord<Invoice>('invoices', id) : undefined;
      if (path === 'invoices' && previousInvoice) {
        const stamped = approvalStamp({ ...previousInvoice, ...finalData } as Invoice, isIssuedForApproval(previousInvoice.status));
        if (stamped.approval) Object.assign(finalData, stamped);
      }
      const emailAfterSave = path === 'invoices' && finalData.status === 'sent' && (previousInvoice?.status !== 'sent' || Boolean(forceSend));

      if (path === 'invoices') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before updating an invoice.');
        const existingInvoice = previousInvoice || {};
        const mergedData = { ...existingInvoice, ...finalData };
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          const posted = await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postInvoiceLedger(id, mergedData as unknown as Partial<Invoice>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData }, context));
          if (posted.cogsPendingReason) toast.warning(posted.cogsPendingReason);
        } else {
          const { document, override } = documentDataAndOverride(finalData);
          const posted = await runDocumentCommand('invoice.update', currentWorkspaceId, {
            id,
            data: document,
            postingDay: postingToday(),
            ...(override ? { creditLimitOverride: override } : {}),
          });
          if (typeof posted.cogsPendingReason === 'string') toast.warning(posted.cogsPendingReason);
        }
        const targetCustId = mergedData.customerId || finalData.customerId;
        if (targetCustId) void syncEntityBalance('customers', targetCustId, sampleSession);
      } else if (path === 'bills') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before updating a bill.');
        const existingBill = (await savedRecord<Bill>('bills', id)) || {};
        const mergedData = { ...existingBill, ...finalData };
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postBillLedger(id, mergedData as unknown as Partial<Bill>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData }, context));
        } else {
          await runDocumentCommand('bill.update', currentWorkspaceId, { id, data: finalData, postingDay: postingToday() });
        }
        const targetVendId = mergedData.vendorId || finalData.vendorId;
        if (targetVendId) void syncEntityBalance('vendors', targetVendId, sampleSession);
      } else if (path === 'creditNotes') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before updating a credit note.');
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          const existing = (await savedRecord<CreditNote>('creditNotes', id)) || {};
          const mergedData = { ...existing, ...finalData };
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postCreditNoteLedger(id, mergedData as unknown as Partial<CreditNote>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData }, context));
        } else {
          await runDocumentCommand('creditnote.update', currentWorkspaceId, { id, data: finalData, postingDay: postingToday() });
        }
      } else if (path === 'vendorCredits') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before updating a vendor credit.');
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          const existing = (await savedRecord<VendorCredit>('vendorCredits', id)) || {};
          const mergedData = { ...existing, ...finalData };
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.postVendorCreditLedger(id, mergedData as unknown as Partial<VendorCredit>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData }, context));
        } else {
          await runDocumentCommand('vendorcredit.update', currentWorkspaceId, { id, data: finalData, postingDay: postingToday() });
        }
      } else if ((path === 'customers' || path === 'vendors') && (!user || !currentWorkspaceId)) {
        throw new Error('Sign in and choose a workspace before updating this contact.');
      } else if (usePartyCommand) {
        const { updatedAt: _updatedAt, ...data } = finalData;
        await runDocumentCommand(path === 'customers' ? 'customer.update' : 'vendor.update', currentWorkspaceId!, { id, data });
      } else if (path === 'transactions' && currentWorkspaceId) {
        await runServerCommand({
          path: `/api/v1/transactions/${encodeURIComponent(id)}`,
          method: 'PUT',
          body: { workspaceId: currentWorkspaceId, partialUpdate: finalData },
        });
      } else if (path === 'reconciliations' || path === 'payments' || path === 'journalEntries') {
        throw new Error(`Direct browser updates on ${path} are disabled; use the server ledger API.`);
      } else {
        const localData: Record<string, unknown> = { ...finalData };
        const metadataPatch = (finalData as Record<string, unknown>).metadata;
        if ((path === 'customers' || path === 'vendors') && isRecord(metadataPatch) && currentWorkspaceId) {
          localData.metadata = await mergeLocalPartyMetadata(path, id, currentWorkspaceId, metadataPatch);
        }
        if (!currentWorkspaceId) throw new Error('Sign in and choose a workspace before updating this record.');
        await savePlainRecord(currentWorkspaceId, path, id, localData);
      }

      // PREV-5: a reply after another workspace was opened says where it was saved, never "saved" here
      if (successMsg) announceSaved(successMsg, currentWorkspaceId);
      if (emailAfterSave) await sendInvoiceEmail(id, { ...(previousInvoice || {}), ...finalData });
      return true;
    } catch (error) {
      if (!isStaleDocumentCommandContext(error)) handleFirestoreError(error, OperationType.UPDATE, `${path}/${id}`);
      return false; // no error is shown for a response made stale by switching actor or workspace
    }
  };

  const deleteEntity = async (path: string, id: string, successMsg?: string) => {
    const sampleSession = guestSession();
    try {
      if (path === 'invoices') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before deleting an invoice.');
        const existingInvoice = await savedRecord<Invoice>('invoices', id);
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.deletePostings(id, 'invoiceId', currentWorkspaceId, { collection: path, docId: id, action: 'delete' }, context));
        } else {
          await runDocumentCommand('invoice.delete', currentWorkspaceId, { id, postingDay: postingToday() });
        }
        if (existingInvoice?.customerId) void syncEntityBalance('customers', existingInvoice.customerId, sampleSession);
      } else if (path === 'bills') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before deleting a bill.');
        const existingBill = await savedRecord<Bill>('bills', id);
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.deletePostings(id, 'billId', currentWorkspaceId, { collection: path, docId: id, action: 'delete' }, context));
        } else {
          await runDocumentCommand('bill.delete', currentWorkspaceId, { id, postingDay: postingToday() });
        }
        if (existingBill?.vendorId) void syncEntityBalance('vendors', existingBill.vendorId, sampleSession);
      } else if (path === 'creditNotes') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before deleting a credit note.');
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.deletePostings(id, 'creditNoteId', currentWorkspaceId, { collection: path, docId: id, action: 'delete' }, context));
        } else {
          await runDocumentCommand('creditnote.delete', currentWorkspaceId, { id, postingDay: postingToday() });
        }
      } else if (path === 'vendorCredits') {
        if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before deleting a vendor credit.');
        if (sampleSession || currentWorkspaceId === SAMPLE_WORKSPACE_ID) {
          await withSamplePosting(currentWorkspaceId, sampleSession, context => LedgerPostService.deletePostings(id, 'vendorCreditId', currentWorkspaceId, { collection: path, docId: id, action: 'delete' }, context));
        } else {
          await runDocumentCommand('vendorcredit.delete', currentWorkspaceId, { id, postingDay: postingToday() });
        }
      } else if (path === 'transactions' && currentWorkspaceId) {
        await runServerCommand({
          path: `/api/v1/transactions/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
          method: 'DELETE',
        });
      } else if (path === 'reconciliations' || path === 'payments' || path === 'journalEntries') {
        throw new Error(
          path === 'reconciliations'
            ? 'Completed reconciliations cannot be deleted directly from the browser.'
            : `Direct browser deletion on ${path} is disabled; use the server ledger API.`,
        );
      } else {
        if (!currentWorkspaceId) throw new Error('Sign in and choose a workspace before deleting this record.');
        await deletePlainRecord(currentWorkspaceId, path, id);
      }

      // PREV-5: a reply after another workspace was opened says where it was saved, never "saved" here
      if (successMsg) announceSaved(successMsg, currentWorkspaceId);
    } catch (error) {
      if (!isStaleDocumentCommandContext(error)) handleFirestoreError(error, OperationType.DELETE, `${path}/${id}`);
    }
  };

  const runCommand = async (name: string, input: Record<string, unknown>, successMsg?: string) => {
    if (!user || !currentWorkspaceId) throw new Error('Sign in and choose a workspace before running this command.');
    if (guestSession() || currentWorkspaceId === SAMPLE_WORKSPACE_ID) throw new Error('This command is available only in a live workspace.');
    const result = await runDocumentCommand(name, currentWorkspaceId, input);
    if (successMsg) announceSaved(successMsg, currentWorkspaceId);
    return result;
  };

  return { addEntity, updateEntity, deleteEntity, sendInvoiceEmail, runCommand };
}
