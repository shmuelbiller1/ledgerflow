import { useUIStore } from '../../stores/useUIStore';
import React, { useEffect, useState } from 'react';
import Ledger from './Ledger';
import OwnerLens from './OwnerLens';
import { Briefcase, Calculator } from 'lucide-react';

export default function TwoLensesLedger() {
  const [lens, setLens] = useState<'owner' | 'accountant'>(() =>
    useUIStore.getState().newRecord === 'journalEntry' ? 'accountant' : 'owner',
  );
  // Manual entries live in the accountant view, including requests while this page is open.
  useEffect(() => useUIStore.subscribe((state) => {
    if (state.newRecord === 'journalEntry') setLens('accountant');
  }), []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end mb-4">
        <div className="bg-[var(--panel)] p-1 rounded-xl inline-flex shadow-sm border border-[var(--line)]">
          <button
            onClick={() => setLens('owner')}
            className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center transition-all cursor-pointer ${
              lens === 'owner' ? 'bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Briefcase className="w-4 h-4 mr-1.5" /> Owner Lens
          </button>
          <button
            onClick={() => setLens('accountant')}
            className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center transition-all cursor-pointer ${
              lens === 'accountant' ? 'bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Calculator className="w-4 h-4 mr-1.5" /> Accountant Lens
          </button>
        </div>
      </div>

      {lens === 'owner' ? <OwnerLens /> : <Ledger />}
    </div>
  );
}
