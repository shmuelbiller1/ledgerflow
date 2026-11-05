import { savedInOtherWorkspace, workspaceChangedSince } from '../lib/saveWorkspace';
import { collection, updateDoc, deleteDoc, doc, setDoc, query, where, getDocs, getDoc } from '../lib/db/firestore';
import { learnedPatternId } from '../lib/learnedPatterns';
import { db, getIdToken } from '../firebase';
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
import type { InvoiceApprovalRecord } from '../lib/invoiceApproval';
import type { Bill, CreditNote, Customer, Invoice, VendorCredit } from '../types';

interface EntityInput {
  customerId?: string; vendorId?: string; description?: string; vendorName?: string; customerName?: string; categoryId?: string; categoryName?: string; status?: string; forceSend?: boolean;
  lines?: { accountId?: string; accountName?: string }[];
}

type StoredDocumentPath = 'invoices' | 'bills' | 'creditNotes' | 'vendorCredits' | 'customers';

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

export function useEntityOperations() {
  const user = useAuthStore(s => s.user);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const role = useCurrentRole();
  const analyticalPatternCache = useLedgerStore(s => s.analyticalPatternCache);

  /**
   * Recalculate and update durable balanceCents for a customer or vendor entity
   * Queries authoritative Firestore data scoped to this entity rather than relying on truncated UI cache.
   */
  const syncEntityBalance = async (entityType: 'customers' | 'vendors', entityId: string) => {
    if (!entityId || !currentWorkspaceId) return;
    try {
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
        balanceCents = customerInvoices.reduce((sum, inv) => sum + toBaseCents(calculateAmountDue(inv), inv.exchangeRate), 0);
      } else {
        const q = query(
          collection(db, 'bills'),
          where('workspaceId', '==', currentWorkspaceId),
          where('vendorId', '==', entityId)
        );
        const snap = await getDocs(q);
        const vendorBills = snap.docs.map(d => d.data()).filter(isOpenBill);
        balanceCents = vendorBills.reduce((sum, b) => sum + toBaseCents(calculateAmountDue(b), b.exchangeRate), 0);
      }

      await updateDoc(doc(db, entityType, entityId), {
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
      const patternRef = doc(db, 'rulePatterns', `${currentWorkspaceId}_${patternId}`);
      const existing = analyticalPatternCache[cleanDesc];
      
      await setDoc(patternRef, {
        uid: user.uid,
        workspaceId: currentWorkspaceId,
        description: cleanDesc,
        accountId,
        accountName,
        count: (existing?.count || 0) + 1,
        lastUpdated: new Date().toISOString()
      }, { merge: true });

      // Feed delta learning to learnedDeltas for AI and categorization models
      const deltaId = `${currentWorkspaceId}_${patternId}`;
      const deltaRef = doc(db, 'learnedDeltas', deltaId);
      await setDoc(deltaRef, {
        id: deltaId,
        uid: user.uid,
        workspaceId: currentWorkspaceId,
        apiKeyId: "human_web_console",
        description: cleanDesc.slice(0, 500),
        category: (accountName || "General").slice(0, 100),
        timestamp: new Date().toISOString()
      }, { merge: true });
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
    const stamp = approvalForSave(merged, settings, { role, uid: user?.uid, now: new Date().toISOString(), twoPerson: ws?.twoPersonRule === true });
    return stamp ? { approval: stamp } : {};
  };

  const announceSaved = (message: string, workspaceId: string | null | undefined) => {
    if (workspaceId && workspaceChangedSince(workspaceId)) toast.info(savedInOtherWorkspace('It', workspaceId));
    else toast.success(message);
  };

  const addEntity = async <T extends object>(path: string, data: T & EntityInput, successMsg?: string) => {
    if (!user || !currentWorkspaceId) return;
    try {
      const docId = doc(collection(db, path)).id;
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
        const posted = await LedgerPostService.postInvoiceLedger(docId, finalData as unknown as Partial<Invoice>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData });
        if (posted.cogsPendingReason) toast.warning(posted.cogsPendingReason);
        if (finalData.customerId) {
          void syncEntityBalance('customers', finalData.customerId);
        }
      } else if (path === 'bills') {
        await LedgerPostService.postBillLedger(docId, finalData as unknown as Partial<Bill>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData });
        if (finalData.vendorId) {
          void syncEntityBalance('vendors', finalData.vendorId);
        }
      } else if (path === 'creditNotes') {
        await LedgerPostService.postCreditNoteLedger(docId, finalData as unknown as Partial<CreditNote>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData });
      } else if (path === 'vendorCredits') {
        await LedgerPostService.postVendorCreditLedger(docId, finalData as unknown as Partial<VendorCredit>, currentWorkspaceId, user.uid, { collection: path, docId, action: 'create', data: finalData });
      } else {
        await setDoc(doc(db, path, docId), finalData);
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
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  // Emails the invoice to the customer (server: documentEmailService.ts). Called after the invoice
  // is posted, so the server sees an issued invoice; the send is logged there.
  const sendInvoiceEmail = async (id: string, invoiceData: InvoiceForEmail) => {
    if (!currentWorkspaceId) return false;
    // BE-04: an invoice nobody has signed off yet stays inside, whoever saved it
    if (holdsSending(invoiceData, useAuthStore.getState().getCurrentWorkspace()?.invoiceApproval)) {
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
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}/emails/invoices/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({
          template: 'invoice',
          to,
          ...(typeof invoiceData.metadata?.emailSubject === 'string' ? { subject: invoiceData.metadata.emailSubject } : {}),
          ...(typeof invoiceData.metadata?.emailBody === 'string' ? { body: invoiceData.metadata.emailBody } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`The invoice was saved but not emailed: ${data.message || 'the email could not be sent'}`);
        return false;
      }
      toast.success(`Invoice emailed to ${data.to}.`);
      return true;
    } catch (err) {
      toast.error(`The invoice was saved but not emailed: ${err instanceof Error ? err.message : 'network error'}`);
      return false;
    }
  };

  const updateEntity = async <T extends object>(path: string, id: string, updates: T & EntityInput, successMsg?: string) => {
    try {
      const { forceSend, ...changes } = updates || {};
      const finalData = {
        ...changes,
        updatedAt: new Date().toISOString()
      };

      // Email the invoice when it becomes "sent" (after it is posted below)
      const previousInvoice = path === 'invoices' ? await savedRecord<Invoice>('invoices', id) : undefined;
      if (path === 'invoices' && previousInvoice) {
        const stamped = approvalStamp({ ...previousInvoice, ...finalData } as Invoice, isIssuedForApproval(previousInvoice.status));
        if (stamped.approval) Object.assign(finalData, stamped);
      }
      const emailAfterSave = path === 'invoices' && finalData.status === 'sent' && (previousInvoice?.status !== 'sent' || Boolean(forceSend));

      if (path === 'invoices' && user && currentWorkspaceId) {
        const existingInvoice = previousInvoice || {};
        const mergedData = { ...existingInvoice, ...finalData };
        const posted = await LedgerPostService.postInvoiceLedger(id, mergedData as unknown as Partial<Invoice>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData });
        if (posted.cogsPendingReason) toast.warning(posted.cogsPendingReason);
        const targetCustId = mergedData.customerId || finalData.customerId;
        if (targetCustId) {
          void syncEntityBalance('customers', targetCustId);
        }
      } else if (path === 'bills' && user && currentWorkspaceId) {
        const existingBill = (await savedRecord<Bill>('bills', id)) || {};
        const mergedData = { ...existingBill, ...finalData };
        await LedgerPostService.postBillLedger(id, mergedData as unknown as Partial<Bill>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData });
        const targetVendId = mergedData.vendorId || finalData.vendorId;
        if (targetVendId) {
          void syncEntityBalance('vendors', targetVendId);
        }
      } else if (path === 'creditNotes' && user && currentWorkspaceId) {
        const existing = (await savedRecord<CreditNote>('creditNotes', id)) || {};
        const mergedData = { ...existing, ...finalData };
        await LedgerPostService.postCreditNoteLedger(id, mergedData as unknown as Partial<CreditNote>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData });
      } else if (path === 'vendorCredits' && user && currentWorkspaceId) {
        const existing = (await savedRecord<VendorCredit>('vendorCredits', id)) || {};
        const mergedData = { ...existing, ...finalData };
        await LedgerPostService.postVendorCreditLedger(id, mergedData as unknown as Partial<VendorCredit>, currentWorkspaceId, user.uid, { collection: path, docId: id, action: 'update', data: finalData });
      } else {
        await updateDoc(doc(db, path, id), finalData);
      }

      // PREV-5: a reply after another workspace was opened says where it was saved, never "saved" here
      if (successMsg) announceSaved(successMsg, currentWorkspaceId);
      if (emailAfterSave) await sendInvoiceEmail(id, { ...(previousInvoice || {}), ...finalData });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${path}/${id}`);
    }
  };

  const deleteEntity = async (path: string, id: string, successMsg?: string) => {
    try {
      if (path === 'invoices' && currentWorkspaceId) {
        const existingInvoice = await savedRecord<Invoice>('invoices', id);
        await LedgerPostService.deletePostings(id, 'invoiceId', currentWorkspaceId, { collection: path, docId: id, action: 'delete' });
        if (existingInvoice?.customerId) {
          void syncEntityBalance('customers', existingInvoice.customerId);
        }
      } else if (path === 'bills' && currentWorkspaceId) {
        const existingBill = await savedRecord<Bill>('bills', id);
        await LedgerPostService.deletePostings(id, 'billId', currentWorkspaceId, { collection: path, docId: id, action: 'delete' });
        if (existingBill?.vendorId) {
          void syncEntityBalance('vendors', existingBill.vendorId);
        }
      } else if (path === 'creditNotes' && currentWorkspaceId) {
        await LedgerPostService.deletePostings(id, 'creditNoteId' as unknown as "invoiceId" | "billId" | "creditNoteId" | "vendorCreditId", currentWorkspaceId, { collection: path, docId: id, action: 'delete' });
      } else if (path === 'vendorCredits' && currentWorkspaceId) {
        await LedgerPostService.deletePostings(id, 'vendorCreditId' as unknown as "invoiceId" | "billId" | "creditNoteId" | "vendorCreditId", currentWorkspaceId, { collection: path, docId: id, action: 'delete' });
      } else {
        await deleteDoc(doc(db, path, id));
      }

      // PREV-5: a reply after another workspace was opened says where it was saved, never "saved" here
      if (successMsg) announceSaved(successMsg, currentWorkspaceId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${path}/${id}`);
    }
  };

  return { addEntity, updateEntity, deleteEntity, sendInvoiceEmail };
}
