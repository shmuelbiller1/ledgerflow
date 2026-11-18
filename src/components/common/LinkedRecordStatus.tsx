import type { ReactNode } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { LoadingState } from '../ui/LoadingState';
import { ModalShell } from '../ui/ModalShell';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { RecordPage } from './RecordPage';

const RECORDS = {
  invoice: { collection: 'invoices', title: 'Invoice' },
  bill: { collection: 'bills', title: 'Bill' },
  transaction: { collection: 'transactions', title: 'Transaction' },
} as const;

type RecordStatusProps = { title: string; backLabel: string; onBack: () => void; children: ReactNode };

function LinkedRecordDialog({ title, backLabel, onBack, children }: RecordStatusProps) {
  const { dialogProps, titleId } = useDialog(onBack);
  return <ModalShell dialogProps={dialogProps} onClose={onBack}
    panelClassName="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 space-y-4 text-[var(--text)]">
    <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
    {children}
    <button type="button" onClick={onBack} className="min-h-11 rounded-lg px-3 underline">{backLabel}</button>
  </ModalShell>;
}

/** Lookup status before the linked record arrives. A supporting list must not determine this state. */
export function LinkedRecordStatus({ kind, onBack }: { kind: keyof typeof RECORDS; onBack: () => void }) {
  const { collection, title: recordTitle } = RECORDS[kind];
  useLedgerCollections(collection);
  const health = useScreenDataHealth([collection]);
  const failed = health.failedKeys.length > 0;
  const loading = health.loadingKeys.length > 0;
  const title = failed ? `${recordTitle} unavailable` : loading ? recordTitle : `${recordTitle} not found`;
  const backLabel = `Back to ${collection}`;
  let content: ReactNode;
  if (failed) {
    content = <ScreenDataNotice failedKeys={health.failedKeys} message={health.message} onRetry={health.retry} what={`this ${kind}`} />;
  } else if (loading) {
    content = <LoadingState what={kind} />;
  } else {
    content = <p className="text-sm text-[var(--muted)]">This {kind} is not in the records loaded for this workspace.</p>;
  }
  return kind === 'transaction'
    ? <LinkedRecordDialog title={title} backLabel={backLabel} onBack={onBack}>{content}</LinkedRecordDialog>
    : <RecordPage title={title} backLabel={backLabel} onBack={onBack}>{content}</RecordPage>;
}
