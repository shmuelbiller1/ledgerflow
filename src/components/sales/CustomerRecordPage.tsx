import type { Customer } from '../../types';
import { PartyDetailView } from '../common/PartyDetailView';

export interface CustomerRecordPageProps {
  customerId: string;
  onBack: () => void;
  onNewInvoice?: (customer: Customer) => void;
}

/** The customer record uses the same shell as invoices, bills and vendors; party wording lives in PARTY_SIDES. */
export default function CustomerRecordPage({ customerId, onBack, onNewInvoice }: CustomerRecordPageProps) {
  return <PartyDetailView partyId={customerId} side="customer" onBack={onBack}
    onNewDocument={onNewInvoice ? party => onNewInvoice(party as Customer) : undefined} />;
}
