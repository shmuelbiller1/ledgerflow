import React from 'react';
import {
  approvalChip, approvalDetail, approvalStatus,
  type InvoiceApprovalRecord, type InvoiceApprovalSettings,
} from '../../lib/invoiceApproval';
import { mayApprove } from '../../lib/twoPersonRule';
import { approvesInPlace } from '../../lib/approvalDelegation';
import { getLocalDateISO } from '../../lib/utils';
import { useAuthStore } from '../../stores/useAuthStore';

/**
 * The approval line under an invoice's state chip (BE-04).
 *
 * It appears only when an invoice cannot go out yet — over the limit and not signed off — and the
 * two buttons only for someone allowed to sign (an owner or an accountant). The bookkeeper who
 * wrote the invoice sees what is holding it and who is expected to release it; that is the whole
 * point of the flag, so the amount, the limit and the reason stay in the tooltip rather than in
 * five more columns. With the two-person rule (P-05) whoever sent it for approval can send it back
 * but not approve it; the server refuses that too.
 */
export interface InvoiceApprovalFlagProps {
  invoice: { number?: string; uid?: string; amountCents?: number; exchangeRate?: number; status?: string; approval?: InvoiceApprovalRecord | null };
  settings?: InvoiceApprovalSettings;
  currency?: string;
  canDecide: boolean;
  onDecide: (decision: 'approved' | 'rejected') => void;
}

export function InvoiceApprovalFlag({ invoice, settings, currency, canDecide, onDecide }: InvoiceApprovalFlagProps) {
  const uid = useAuthStore(s => s.user?.uid);
  const twoPerson = useAuthStore(s => s.getCurrentWorkspace()?.twoPersonRule === true);
  // BG-07: approving in someone's place counts as an approver
  const inPlace = useAuthStore(s => Boolean(approvesInPlace(s.getCurrentWorkspace(), s.user?.uid, getLocalDateISO())));
  const state = approvalStatus(invoice, settings, currency || 'USD');
  if (state !== 'awaiting' && state !== 'rejected') return null;
  const mayApproveIt = mayApprove(twoPerson, uid, invoice.approval?.requestedBy || invoice.uid);
  const detail = approvalDetail(state, settings, invoice.approval, currency);
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] font-bold text-[var(--neg)]">
      <span title={detail}>{approvalChip(state)}</span>
      {(canDecide || inPlace) && (
        <span className="flex gap-2">
          {mayApproveIt ? (
            <button type="button" onClick={() => onDecide('approved')}
              title={`Sign off invoice ${invoice.number || ''} for ${detail}`}
              className="underline decoration-dotted underline-offset-2 hover:text-[var(--text)]">Approve</button>
          ) : <span className="font-normal text-[var(--muted)]">Someone else approves it (two-person rule)</span>}
          <button type="button" onClick={() => onDecide('rejected')}
            title={`Send invoice ${invoice.number || ''} back for changes`}
            className="underline decoration-dotted underline-offset-2 hover:text-[var(--text)]">Send back</button>
        </span>
      )}
    </div>
  );
}

export default InvoiceApprovalFlag;
