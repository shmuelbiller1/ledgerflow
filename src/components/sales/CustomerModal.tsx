import React from 'react';
import PartyModal from '../common/PartyModal';
import type { Customer } from '../../types';

/** Add or edit a customer (the shared contact form, src/components/common/PartyModal.tsx). */
export default function CustomerModal(props: { isOpen: boolean; onClose: () => void; onSave: (customer: Partial<Customer>) => unknown; initial?: Partial<Customer> | null }) {
  return <PartyModal side="customer" {...props} />;
}
