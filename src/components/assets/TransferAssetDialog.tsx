import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { describeTransfer, transferLines } from '../../lib/assetTransfer';
import { formatCurrency } from '../../lib/utils';
import type { ChartAccount, FixedAsset } from '../../types';

/**
 * Move a fixed asset (X-05): the day, a new location, and if it changes class, the asset account
 * and the accumulated depreciation account it moves to. Says what will be posted before asking the
 * server (a move of place only is not posted).
 */
interface Props {
  asset: FixedAsset;
  accounts: ChartAccount[];
  workspaceId: string;
  today: string;
  currency: string;
  onClose: () => void;
}

const field = 'w-full p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';
const label = (a: ChartAccount) => `${a.code ? `${a.code} · ` : ''}${a.name}`;

export default function TransferAssetDialog({ asset, accounts, workspaceId, today, currency, onClose }: Props) {
  const { dialogProps, titleId } = useDialog(onClose, true);
  const assetSide = useMemo(() => accounts.filter(a => !a.isArchived && String(a.type).toLowerCase() === 'asset'), [accounts]);
  const byId = new Map(accounts.map(a => [a.id, a]));
  const accumulatedNow = asset.accumulatedAccountId || assetSide.find(a => /accumulated depreciation/i.test(a.name))?.id || '';
  const [date, setDate] = useState(today);
  const [location, setLocation] = useState(asset.location || '');
  const [assetAccountId, setAssetAccountId] = useState(asset.assetAccountId || '');
  const [accumulatedAccountId, setAccumulatedAccountId] = useState(accumulatedNow);
  const [saving, setSaving] = useState(false);

  const ref = (id: string) => { const a = byId.get(id); return a ? { id: a.id, name: a.name } : undefined; };
  const change = {
    fromLocation: asset.location || '', toLocation: location.trim(),
    fromAsset: ref(asset.assetAccountId || ''), toAsset: ref(assetAccountId),
    fromAccumulated: ref(accumulatedNow), toAccumulated: ref(accumulatedAccountId),
  };
  const summary = describeTransfer(asset.name, change);
  const lines = transferLines(asset.purchasePriceCents || 0, asset.accumulatedDepreciationCents || 0,
    { asset: change.fromAsset, accumulated: change.fromAccumulated }, { asset: change.toAsset, accumulated: change.toAccumulated });

  const submit = async () => {
    setSaving(true);
    try {
      const data = await runCommand<{ description?: string }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(asset.id)}/transfer`,
        method: 'POST',
        body: {
          date,
          ...(change.toLocation !== change.fromLocation ? { location: change.toLocation } : {}),
          ...(assetAccountId && assetAccountId !== asset.assetAccountId ? { assetAccountId } : {}),
          ...(accumulatedAccountId && accumulatedAccountId !== accumulatedNow ? { accumulatedAccountId } : {}),
        },
      });
      toast.success(data.description || summary);
      onClose();
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Move {asset.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="move-date" className="block font-semibold text-[var(--text)] mb-1">Day it moved</label>
              <input id="move-date" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="move-location" className="block font-semibold text-[var(--text)] mb-1">Location</label>
              <input id="move-location" value={location} maxLength={120} onChange={e => setLocation(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <label htmlFor="move-asset-account" className="block font-semibold text-[var(--text)] mb-1">Asset account</label>
            <select id="move-asset-account" value={assetAccountId} onChange={e => setAssetAccountId(e.target.value)} className={field}>
              <option value="">Not recorded</option>
              {assetSide.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="move-accumulated" className="block font-semibold text-[var(--text)] mb-1">Accumulated depreciation account</label>
            <select id="move-accumulated" value={accumulatedAccountId} onChange={e => setAccumulatedAccountId(e.target.value)} className={field}>
              <option value="">Not recorded</option>
              {assetSide.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </select>
          </div>
          <p role="status" className="text-[var(--text)] bg-[var(--ink)] border border-[var(--line)] rounded-lg p-3">
            {!summary ? 'Nothing changes yet.' : `${summary}. ${lines.length
              ? `Posted on that day: ${lines.filter(l => l.amountCents > 0).map(l => `${formatCurrency(l.amountCents, currency)} into ${l.accountName}`).join(' and ')}.`
              : 'Nothing is posted (only the place changes).'}`}
          </p>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-[var(--text)] hover:bg-[var(--ink)]">Cancel</button>
            <button type="button" disabled={saving || !summary || !/^\d{4}-\d{2}-\d{2}$/.test(date)} onClick={submit} className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--text)] text-[var(--ink)] disabled:opacity-50">
              {saving ? 'Moving…' : 'Move it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
