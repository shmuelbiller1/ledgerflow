import React from 'react';
import { useReconciliationModel } from './useReconciliationModel';
import { ReconciliationView } from './ReconciliationView';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';

export default function Reconciliation() {
  const model = useReconciliationModel();
  // A-235: matching reads entries, accounts, the bank feed and saved reconciliations. When one of
  // them did not arrive, say so above the screen instead of showing an empty match list.
  const dataHealth = useScreenDataHealth(['transactions', 'accounts', 'bankLines', 'reconciliations']);
  return (
    <div>
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="reconciliation" />
      </div>
      <ReconciliationView {...model} />
    </div>
  );
}
