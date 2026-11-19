import React, { useMemo, useRef, useState } from 'react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { toast } from 'sonner';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import {
  RMAS_METADATA_FIELD,
  returnAuthorizationRequestProblem,
  returnAuthorizationCapacityProblem,
  returnAuthorizationsFromMetadata,
  transitionReturnAuthorization,
  type ReturnAuthorizationAction,
  type ReturnAuthorizationRecord,
  type ReturnAuthorizationRequestLine,
} from '../../lib/warehouseRecords';
import { encodedPathPart, randomWarehouseToken, type WorkflowActor } from '../../lib/warehouseRecordUtils';
import type { CreditNote, Customer, Invoice, InventoryItem } from '../../types';
import ReportTableScroll from './ReportTableScroll';
import { runCommand } from '../../lib/runCommand';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
// storedItemFallback is saved on the request record, so it stays one fixed value in every language (shown translated on screen)
const CODE_NAMES = { c0: 'SKU', storedItemFallback: 'Inventory item' } as const;

const field = 'min-h-11 min-w-0 max-w-full border rounded px-3 py-2 bg-[var(--panel)] text-[var(--text)]';
const UNISSUED = new Set(['draft', 'rejected', 'void', 'cancelled']);
const STATUS_LABEL: Record<ReturnAuthorizationRecord['status'], string> = {
  requested: 'Requested — waiting for an owner or accountant',
  approved: 'Approved — waiting for goods',
  declined: 'Declined',
  received: 'Received — link the existing sales credit note',
  closed: 'Closed — credit note linked',
};

function actorFor(user: { uid: string; displayName?: string | null; email?: string | null } | null, role: string): WorkflowActor {
  return { uid: user?.uid || '', name: user?.displayName || user?.email || 'Workspace user', role };
}

export default function ReturnAuthorizationsPanel() {
  const reportText = useReportText();
  const customers = useLedgerStore(state => state.customers) as Customer[];
  const invoices = useLedgerStore(state => state.invoices) as Invoice[];
  const inventory = useLedgerStore(state => state.inventory) as InventoryItem[];
  const creditNotes = useLedgerStore(state => state.creditNotes) as CreditNote[];
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const user = useAuthStore(state => state.user);
  const isGuest = useAuthStore(state => state.isGuest);
  const role = useCurrentRole();
  const { loading } = useLedgerCollections('customers', 'invoices', 'inventory', 'creditNotes');
  /**
   * ISS-143: RMAs are written by the server (returnAuthorizationService.ts), which checks the role, the quantities
   * left and the status it expects in one transaction; a browser write to them is refused by the database. The
   * returned record is put into the customer in the store so the list shows it at once.
   */
  const postRma = async (path: string, body: Record<string, unknown>): Promise<ReturnAuthorizationRecord> => {
    const data = await runCommand<{ record?: ReturnAuthorizationRecord }>({
      path: `/api/v1/workspaces/${encodeURIComponent(workspaceId || '')}/return-authorizations${path}`,
      method: 'POST',
      body: { ...body, requestKey: `rma-${randomWarehouseToken()}${randomWarehouseToken()}` },
    }) ?? {};
    if (!data.record) throw new Error('The return authorization could not be saved.');
    const record = data.record;
    // saved in the workspace it was asked in; when another workspace is open by now, its list is not touched
    if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return record;
    const store = useLedgerStore.getState();
    store.setCustomers((store.customers as Customer[]).map(c => (c.id !== record.customerId ? c : {
      ...c, metadata: { ...(c.metadata || {}), [RMAS_METADATA_FIELD]: { ...((c.metadata?.[RMAS_METADATA_FIELD] as Record<string, unknown>) || {}), [encodedPathPart(record.id)]: record } },
    })));
    return record;
  };

  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [quantityDrafts, setQuantityDrafts] = useState<{ invoiceId: string; values: Record<string, string> }>({ invoiceId: '', values: {} });
  const [formProblem, setFormProblem] = useState('');
  const [actionProblems, setActionProblems] = useState<Record<string, string>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [selectedCreditNotes, setSelectedCreditNotes] = useState<Record<string, string>>({});
  const [savingRequest, setSavingRequest] = useState(false);
  const [savingRmas, setSavingRmas] = useState<Set<string>>(() => new Set());
  const requestPending = useRef(false);
  const pendingRmaActions = useRef(new Set<string>());
  // Track successful writes until the asynchronous customer cache includes them.
  // Prevents back-to-back requests from reusing a stale snapshot of RMA history.
  const locallySavedRequests = useRef<ReturnAuthorizationRecord[]>([]);

  const canEdit = Boolean(user && !isGuest && ['owner', 'accountant', 'bookkeeper'].includes(role) && workspaceId);
  const partial = Boolean(
    truncated.customers || failed.customers || truncated.invoices || failed.invoices ||
    truncated.inventory || failed.inventory,
  );
  const creditNotesPartial = Boolean(truncated.creditNotes || failed.creditNotes);
  const scopedCustomers = useMemo(() => customers.filter(customer => Boolean(workspaceId) && customer.workspaceId === workspaceId), [customers, workspaceId]);
  const scopedInvoices = useMemo(() => invoices.filter(invoice =>
    Boolean(workspaceId) && invoice.workspaceId === workspaceId && !UNISSUED.has(String(invoice.status).toLowerCase()) &&
    (invoice.items || []).some(line => Boolean(line.itemId) && Number(line.quantity) > 0),
  ), [invoices, workspaceId]);
  const itemById = useMemo(() => new Map(inventory.map(item => [item.id, item])), [inventory]);
  const allRmas = useMemo(() => scopedCustomers.flatMap(customer =>
    returnAuthorizationsFromMetadata(customer.metadata, customer.id, workspaceId || undefined),
  ).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)), [scopedCustomers, workspaceId]);
  const selectedInvoice = scopedInvoices.find(invoice => invoice.id === invoiceId) || scopedInvoices[0];
  const activeQuantityDrafts = quantityDrafts.invoiceId === selectedInvoice?.id ? quantityDrafts.values : {};
  const selectedCustomer = scopedCustomers.find(customer => customer.id === selectedInvoice?.customerId);
  const requestLines = useMemo(() => (selectedInvoice?.items || []).filter(line => {
    if (!line.itemId || !line.id || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) return false;
    return itemById.get(line.itemId)?.itemType !== 'service';
  }), [selectedInvoice, itemById]);

  const updateAction = async (
    rma: ReturnAuthorizationRecord,
    action: ReturnAuthorizationAction,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (pendingRmaActions.current.has(rma.id)) return { ok: false, reason: 'This RMA action is already being saved.' };
    const customer = scopedCustomers.find(candidate => candidate.id === rma.customerId);
    if (!customer || !canEdit || loading || partial) {
      const reason = 'The customer record is not loaded, complete, or editable right now.';
      setActionProblems(current => ({ ...current, [rma.id]: reason }));
      return { ok: false, reason };
    }
    const result = transitionReturnAuthorization(rma, action, actorFor(user, role), new Date().toISOString());
    if (!result.ok) {
      setActionProblems(current => ({ ...current, [rma.id]: result.reason }));
      return { ok: false, reason: result.reason };
    }
    pendingRmaActions.current.add(rma.id);
    setSavingRmas(current => new Set(current).add(rma.id));
    try {
      const saved = await postRma(`/${encodeURIComponent(rma.id)}`, {
        customerId: customer.id, action: action.type, expectedStatus: rma.status,
        ...('note' in action && action.note ? { note: action.note } : {}),
        ...(action.type === 'link-credit-note' ? { creditNoteId: action.creditNote.id } : {}),
      });
      toast.success(`${rma.number} updated: ${STATUS_LABEL[saved.status]}.`);
      setActionProblems(current => ({ ...current, [rma.id]: '' }));
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The RMA update could not be saved.';
      setActionProblems(current => ({ ...current, [rma.id]: reason }));
      return { ok: false, reason };
    } finally {
      pendingRmaActions.current.delete(rma.id);
      setSavingRmas(current => {
        const next = new Set(current);
        next.delete(rma.id);
        return next;
      });
    }
  };

  const submitRequest = async () => {
    if (requestPending.current) return;
    setFormProblem('');
    if (!selectedInvoice || !selectedCustomer || !workspaceId || !user || !canEdit || loading || partial) {
      setFormProblem('Choose an issued invoice with a loaded customer record.');
      return;
    }
    const lines: ReturnAuthorizationRequestLine[] = requestLines.flatMap(line => {
      const raw = activeQuantityDrafts[line.id] || '';
      if (!raw.trim()) return [];
      const quantity = Number(raw);
      if (!(quantity > 0)) return [{
        invoiceLineId: line.id, itemId: line.itemId || '', description: line.description || CODE_NAMES.storedItemFallback,
        quantity, soldQuantity: Number(line.quantity),
      }];
      return [{
        invoiceLineId: line.id,
        itemId: line.itemId || '',
        description: line.description || itemById.get(line.itemId || '')?.name || CODE_NAMES.storedItemFallback,
        quantity,
        soldQuantity: Number(line.quantity),
      }];
    });
    const at = new Date().toISOString();
    const actor = actorFor(user, role);
    const preflight = returnAuthorizationRequestProblem({
      id: 'rma_validation', number: 'RMA-VALIDATION', workspaceId, customerId: selectedCustomer.id,
      invoiceId: selectedInvoice.id, reason, lines, actor, at,
    });
    if (preflight) {
      setFormProblem(lines.length ? preflight : 'Enter a quantity for at least one invoiced stock item.');
      return;
    }
    const latestById = new Map(locallySavedRequests.current.map(rma => [rma.id, rma]));
    // Store-loaded versions supersede our recent local writes (e.g. a later decline).
    for (const rma of allRmas) latestById.set(rma.id, rma);
    const capacityProblem = returnAuthorizationCapacityProblem({
      workspaceId, customerId: selectedCustomer.id, invoiceId: selectedInvoice.id, lines,
    }, [...latestById.values()]);
    if (capacityProblem) {
      setFormProblem(capacityProblem);
      return;
    }

    requestPending.current = true;
    setSavingRequest(true);
    try {
      // the server numbers it and checks the invoice's quantities again, against every RMA in the database
      const record = await postRma('', {
        customerId: selectedCustomer.id, invoiceId: selectedInvoice.id, reason,
        lines: lines.map(l => ({ invoiceLineId: l.invoiceLineId, quantity: l.quantity })),
      });
      toast.success(`${record.number} requested. An owner or accountant must approve it.`);
      locallySavedRequests.current.push(record);
      setReason('');
      setQuantityDrafts({ invoiceId: selectedInvoice.id, values: {} });
      setFormProblem('');
    } catch (error) {
      setFormProblem(error instanceof Error ? error.message : 'The return authorization could not be saved.');
    } finally {
      requestPending.current = false;
      setSavingRequest(false);
    }
  };

  const invoicesByCustomer = scopedInvoices.filter(invoice => scopedCustomers.some(customer => customer.id === invoice.customerId));
  const customerById = new Map(scopedCustomers.map(customer => [customer.id, customer]));

  return <section aria-label={reportText('r.return-authorizations', 'Return authorizations')} className="space-y-4 min-w-0">
    <div>
      <h3 className="text-lg font-semibold">{reportText('r.return-authorizations', 'Return authorizations')}</h3>
      <p className="text-sm text-[var(--muted)]">{reportText('r.request-a-return-against-an-issued-invoice-requi', 'Request a return against an issued invoice, require an owner or accountant other than the requester to decide it, record receipt, then link an existing customer credit note for that same invoice. Previous non-declined requests reduce the remaining quantity available on each invoice line. Receiving here is an operational confirmation only: use the normal Sales return/credit-note workflow to move stock or issue a credit. This screen never changes inventory quantities or customer balances.')}</p>
    </div>
    <p className="text-sm text-[var(--muted)]">{reportText('r.rma-decisions-and-history-are-editable-workflow', 'RMA decisions and history are editable workflow notes, not a server-enforced two-person approval or an immutable audit trail. Financial returns still require the normal Sales return/credit-note workflow.')}</p>
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-invoices-customers-stock-items-and-credi', 'Loading invoices, customers, stock items and credit notes…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--warning,#b45309)]">{reportText('r.at-least-one-required-list-is-capped-or-failed-t', 'At least one required list is capped or failed. The requestable invoice and RMA lists may be incomplete; new requests are disabled until they are complete.')}</p>}
    {creditNotesPartial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-credit-note-list-is-capped-or-failed-linking', 'The credit-note list is capped or failed. Linking a credit note is disabled until the list is complete.')}</p>}

    <div className="rounded border border-[var(--line)] p-3 space-y-3">
      <h4 className="font-semibold">{reportText('r.request-a-return', 'Request a return')}</h4>
      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">{reportText('r.issued-invoice-2', 'Issued invoice')}
          <select aria-label={reportText('r.rma-invoice', 'RMA invoice')} className={`${field} max-w-lg`} value={selectedInvoice?.id || ''}
            onChange={event => {
              const nextInvoiceId = event.target.value;
              setInvoiceId(nextInvoiceId);
              setQuantityDrafts({ invoiceId: nextInvoiceId, values: {} });
              setFormProblem('');
            }}>
            {invoicesByCustomer.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number || invoice.id} — {customerById.get(invoice.customerId)?.name || invoice.customerName || reportText('r.customer', 'Customer')}</option>)}
          </select>
        </label>
        <span className="min-w-0 max-w-full break-words text-sm text-[var(--muted)]">{reportText('r.customer-3', 'Customer:')} <bdi>{selectedCustomer?.name || selectedInvoice?.customerName || '—'}</bdi></span>
      </div>
      {!invoicesByCustomer.length && !loading && <p className="text-sm text-[var(--muted)]">{reportText('r.no-issued-invoice-with-stock-lines-and-a-loaded', 'No issued invoice with stock lines and a loaded customer is available.')}</p>}

      {selectedInvoice && <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>{reportText('r.requested-quantities-must-not-exceed-the-quantit', 'Requested quantities must not exceed the quantities on invoice')} {selectedInvoice.number || selectedInvoice.id}</caption>
          <thead><tr>
            <th scope="col" className="text-left py-2 px-2">{reportText('r.invoice-line', 'Invoice line')}</th>
            <th scope="col" className="text-left py-2 px-2">{CODE_NAMES.c0}</th>
            <th scope="col" className="text-right py-2 px-2">{reportText('r.sold', 'Sold')}</th>
            <th scope="col" className="text-right py-2 px-2">{reportText('r.return-quantity', 'Return quantity')}</th>
          </tr></thead>
          <tbody>{requestLines.map(line => {
            const item = itemById.get(line.itemId || '');
            return <tr key={line.id} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-2 px-2">{line.description || item?.name || reportText('r.inventory-item', 'Inventory item')}</th>
              <td className="py-2 px-2"><bdi>{item?.sku || '—'}</bdi></td>
              <td className="text-right py-2 px-2">{Number(line.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="text-right py-2 px-2">
                <input aria-label={fill(reportText('r.return-quantity-for-0', 'Return quantity for {0}'), { 0: line.description || item?.name || line.id })} type="number" min="0" max={line.quantity} step="0.01" inputMode="decimal" className={`${field} w-36 text-right`}
                  value={activeQuantityDrafts[line.id] || ''} onChange={event => setQuantityDrafts(current => ({
                    invoiceId: selectedInvoice.id,
                    values: { ...(current.invoiceId === selectedInvoice.id ? current.values : {}), [line.id]: event.target.value },
                  }))} />
              </td>
            </tr>;
          })}</tbody>
        </table>
        {!requestLines.length && <p className="p-3 text-sm text-[var(--muted)]">{reportText('r.this-invoice-has-no-stock-item-lines-available-f', 'This invoice has no stock item lines available for an RMA.')}</p>}
      </ReportTableScroll>}

      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm max-w-2xl">{reportText('r.reason-for-return', 'Reason for return')}
        <textarea aria-label={reportText('r.rma-reason', 'RMA reason')} className={`${field} min-h-20`} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder={reportText('r.describe-why-the-customer-is-requesting-a-return', 'Describe why the customer is requesting a return')} />
      </label>
      <button type="button" onClick={() => { void submitRequest(); }} disabled={!canEdit || loading || partial || savingRequest || !selectedInvoice || !selectedCustomer || !requestLines.length}
        className="min-h-11 px-4 rounded bg-[var(--text)] text-[var(--surface)] disabled:opacity-50">{savingRequest ? reportText('r.saving-rma-request', 'Saving RMA request…') : reportText('r.submit-rma-request', 'Submit RMA request')}</button>
      {formProblem && <p role="alert" className="text-sm text-[var(--neg)]">{formProblem}</p>}
    </div>

    <div className="space-y-3">
      <h4 className="font-semibold">{reportText('r.return-authorization-register', 'Return authorization register (')}{allRmas.length})</h4>
      {!allRmas.length && !loading && <p className="text-sm text-[var(--muted)]">{reportText('r.no-return-authorizations-are-recorded-on-the-loa', 'No return authorizations are recorded on the loaded customer records.')}</p>}
      {allRmas.map(rma => {
        const customer = customerById.get(rma.customerId);
        const linkedCredits = creditNotes.filter(note =>
          note.workspaceId === workspaceId && note.customerId === rma.customerId && note.invoiceId === rma.invoiceId &&
          note.status !== 'draft' && note.status !== 'void',
        );
        const chosenCreditId = selectedCreditNotes[rma.id] || linkedCredits[0]?.id || '';
        const actionNote = decisionNotes[rma.id] || '';
        const mayDecide = canEdit && (role === 'owner' || role === 'accountant') && rma.status === 'requested' && rma.requestedByUid !== user?.uid;
        return <article key={rma.id} aria-label={fill(reportText('r.return-authorization-0', 'Return authorization {0}'), { 0: rma.number })} className="rounded border border-[var(--line)] p-3 space-y-3">
          <div className="flex flex-wrap justify-between gap-3 items-start">
            <div className="min-w-0 max-w-full break-words">
              <h5 className="font-semibold"><bdi>{rma.number}</bdi> · <bdi>{customer?.name || rma.customerName}</bdi></h5>
              <p className="text-sm">{reportText('r.invoice-2', 'Invoice')} <bdi>{rma.invoiceNumber}</bdi> · {rma.status}</p>
              <p className="text-sm">{reportText('r.reason-2', 'Reason:')} <bdi>{rma.reason}</bdi></p>
              <ul className="text-sm list-disc pl-5">{rma.lines.map(line => <li key={line.invoiceLineId}>{line.description} · {line.quantity} {reportText('r.requested', 'requested')}</li>)}</ul>
              {rma.linkedCreditNoteId && <p className="text-sm">{reportText('r.linked-sales-credit-note', 'Linked sales credit note:')} {rma.linkedCreditNoteNumber || rma.linkedCreditNoteId}</p>}
              <p className="text-xs text-[var(--muted)]">{STATUS_LABEL[rma.status]}</p>
            </div>
            <span className="text-xs px-2 py-1 rounded bg-[var(--panel)]">{rma.status}</span>
          </div>

          {rma.status === 'requested' && <div className="flex flex-wrap items-end gap-2" data-print-hide>
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">{reportText('r.decision-note', 'Decision note')}{rma.status === 'requested' ? ` ${reportText('r.required-to-decline', '(required to decline)')}` : ''}
              <input aria-label={fill(reportText('r.decision-note-for-0', 'Decision note for {0}'), { 0: rma.number })} className={`${field} w-64`} maxLength={1000} value={actionNote}
                onChange={event => setDecisionNotes(current => ({ ...current, [rma.id]: event.target.value }))} />
            </label>
            {mayDecide && <>
              <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50" disabled={loading || partial || savingRmas.has(rma.id)} onClick={() => { void updateAction(rma, { type: 'approve', note: actionNote }); }}>{savingRmas.has(rma.id) ? reportText('r.saving', 'Saving…') : reportText('r.approve-rma', 'Approve RMA')}</button>
              <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50" disabled={loading || partial || savingRmas.has(rma.id)} onClick={() => { void updateAction(rma, { type: 'decline', note: actionNote }); }}>{savingRmas.has(rma.id) ? reportText('r.saving', 'Saving…') : reportText('r.decline-rma', 'Decline RMA')}</button>
            </>}
            {canEdit && rma.requestedByUid === user?.uid && <p className="text-sm text-[var(--muted)]">{reportText('r.you-requested-this-rma-and-cannot-decide-it', 'You requested this RMA and cannot decide it.')}</p>}
            {canEdit && !mayDecide && rma.requestedByUid !== user?.uid && <p className="text-sm text-[var(--muted)]">{reportText('r.only-a-different-owner-or-accountant-can-approve', 'Only a different owner or accountant can approve or decline.')}</p>}
          </div>}

          {rma.status === 'approved' && canEdit && <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50" disabled={loading || partial || savingRmas.has(rma.id)} onClick={() => { void updateAction(rma, { type: 'receive' }); }} data-print-hide>{savingRmas.has(rma.id) ? reportText('r.saving', 'Saving…') : reportText('r.mark-goods-received-metadata-only', 'Mark goods received (metadata only)')}</button>}

          {rma.status === 'received' && <div className="flex flex-wrap items-end gap-3" data-print-hide>
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">{reportText('r.existing-sales-credit-note', 'Existing sales credit note')}
              <select aria-label={fill(reportText('r.credit-note-for-0', 'Credit note for {0}'), { 0: rma.number })} className={`${field} max-w-lg`} value={chosenCreditId}
                onChange={event => setSelectedCreditNotes(current => ({ ...current, [rma.id]: event.target.value }))} disabled={creditNotesPartial || !linkedCredits.length}>
                {!linkedCredits.length && <option value="">{reportText('r.no-matching-customer-invoice-credit-note-loaded', 'No matching customer/invoice credit note loaded')}</option>}
                {linkedCredits.map(note => <option key={note.id} value={note.id}>{note.number || note.id} · {note.status}</option>)}
              </select>
            </label>
            <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50" disabled={!canEdit || loading || partial || creditNotesPartial || savingRmas.has(rma.id) || !chosenCreditId}
              onClick={() => {
                const credit = linkedCredits.find(note => note.id === chosenCreditId);
                if (!credit) {
                  setActionProblems(current => ({ ...current, [rma.id]: 'Choose a loaded credit note for the same customer and invoice.' }));
                  return;
                }
                void updateAction(rma, { type: 'link-credit-note', creditNote: credit });
              }}>{reportText('r.link-sales-credit-note', 'Link sales credit note')}</button>
            {!linkedCredits.length && !creditNotesPartial && <p className="text-sm text-[var(--muted)]">{reportText('r.create-the-sales-return-credit-note-in-the-norma', 'Create the sales return/credit note in the normal Sales workflow, then link it here. Linking only records the reference.')}</p>}
          </div>}

          {actionProblems[rma.id] && <p role="alert" className="text-sm text-[var(--neg)]">{actionProblems[rma.id]}</p>}

          <details>
            <summary className="min-h-11 py-3 cursor-pointer text-sm">{reportText('r.status-history', 'Status history (')}{rma.events.length})</summary>
            <ol className="mt-2 space-y-1 text-xs text-[var(--muted)]">
              {rma.events.map(event => <li key={`${event.status}:${event.at}:${event.byUid}`}>{event.status} · {event.byName || event.byUid} · {new Date(event.at).toLocaleString()}{event.note ? ` · ${event.note}` : ''}</li>)}
            </ol>
          </details>
        </article>;
      })}
    </div>
  </section>;
}
