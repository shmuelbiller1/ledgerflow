import type { Vendor } from '../../types';
import { PartyDetailView } from '../common/PartyDetailView';

export interface VendorRecordPageProps {
  vendorId: string;
  onBack: () => void;
  onNewBill?: (vendor: Vendor) => void;
}

/** Vendors share the contact record shell; the next bill opens the existing bill form, prefilled. */
export default function VendorRecordPage({ vendorId, onBack, onNewBill }: VendorRecordPageProps) {
  return <PartyDetailView partyId={vendorId} side="vendor" onBack={onBack}
    onNewDocument={onNewBill ? party => onNewBill(party as Vendor) : undefined} />;
}
