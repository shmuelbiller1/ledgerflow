import { AssetInlineDetails } from './AssetInlineDetails';
import React, { useMemo, useState } from 'react';
import { Building, Check, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ChartAccount, FixedAsset } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { getIdToken } from '../../firebase';
import { depreciationThrough } from '../../lib/depreciationEngine';
import { formatCurrency, formatDate, formatTzDate, isAmountText, parseAmountToCents } from '../../lib/utils';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import DisposeAssetDialog from './DisposeAssetDialog';
import TransferAssetDialog from './TransferAssetDialog';
import AssetLabels from './AssetLabels';
import { assetMatches, missingTags } from '../../lib/assetTags';
import { ASSET_REGISTER_HEADERS, assetRegisterRows } from '../../lib/assetRegisterExport';
import { downloadCsv } from '../../lib/csvExport';
import { ConstructionActions } from './ConstructionActions';
import DepreciationScheduleTable from './DepreciationScheduleTable';
import { assetCandidates } from '../../lib/assetFromBill';

/**
 * Fixed asset register (R-06). Assets are saved in the database ('assets'); depreciation is posted
 * by the month-end run on the server (POST /api/v1/workspaces/:id/periods/:month/depreciation),
 * one entry for all assets, which also records how far each asset is depreciated. Buying the
 * asset itself is recorded as usual (a bill or a transaction to the asset account).
 */

const inputClass = 'w-full p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';

function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const byName = (pattern: RegExp, type: string) => (a: ChartAccount) => pattern.test(a.name) && String(a.type).toLowerCase() === type;

export const FixedAssetsView: React.FC = () => {
  const assets = useLedgerStore(s => s.assets) as FixedAsset[] | undefined;
  const accounts = useLedgerStore(s => s.accounts) as ChartAccount[] | undefined;
  const bills = useLedgerStore(s => s.bills);
  useLedgerCollections('assets', 'bills');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const { addEntity, updateEntity } = useEntityOperations();
  const role = useCurrentRole();
  const canWrite = role !== 'viewer';

  const today = formatTzDate(new Date(), workspace?.timezone);
  const [runMonth, setRunMonth] = useState(() => previousMonth(today));
  const [running, setRunning] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  // X-03: the asset being sold or scrapped, and the one whose disposal is being undone
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [moving, setMoving] = useState<FixedAsset | null>(null);
  const [undoing, setUndoing] = useState('');
  // X-02: the asset whose depreciation schedule is open
  const [scheduleOf, setScheduleOf] = useState('');
  const [form, setForm] = useState(() => ({
    name: '', cost: '', salvage: '0', years: '5', purchaseDate: today, method: 'straight-line' as FixedAsset['depreciationMethod'],
    assetAccountId: '', expenseAccountId: '', accumulatedAccountId: '',
    /** X-01: the bill line it comes from ("billId#line"), if picked */
    source: '',
    /** X-09: still being built (construction in progress) */
    building: false,
  }));

  const list = useMemo(() => assets || [], [assets]);
  // X-07: asset tags, labels and finding an asset by what a label says
  const [find, setFind] = useState('');
  const [labels, setLabels] = useState(false);
  const [tagging, setTagging] = useState(false);
  const shown = list.filter(a => assetMatches(a, find));
  const untagged = missingTags(list);
  const giveTags = async () => {
    setTagging(true);
    try {
      for (const t of untagged) await updateEntity('assets', t.id, { assetTag: t.assetTag });
      toast.success(`${untagged.length} asset${untagged.length === 1 ? '' : 's'} tagged`);
    } finally {
      setTagging(false);
    }
  };
  const chart = useMemo(() => (accounts || []).filter(a => !a.isArchived), [accounts]);
  const assetAccounts = chart.filter(a => String(a.type).toLowerCase() === 'asset');
  const expenseAccounts = chart.filter(a => ['expense', 'cost_of_goods'].includes(String(a.type).toLowerCase()));
  const fromBills = useMemo(() => assetCandidates(bills || [], chart, list), [bills, chart, list]);
  const pickBillLine = (key: string) => {
    const c = fromBills.find(x => `${x.billId}#${x.line}` === key);
    if (!c) { setForm(f => ({ ...f, source: '' })); return; }
    setForm(f => ({ ...f, source: key, name: c.name, cost: (c.costCents / 100).toFixed(2), purchaseDate: c.date || f.purchaseDate, assetAccountId: c.accountId }));
  };

  const totals = useMemo(() => {
    // what is still owned: sold or scrapped assets are off the books
    const owned = list.filter(a => a.status !== 'disposed');
    const cost = owned.reduce((s, a) => s + (a.purchasePriceCents || 0), 0);
    const accumulated = owned.reduce((s, a) => s + (a.accumulatedDepreciationCents || 0), 0);
    return { cost, accumulated, book: cost - accumulated };
  }, [list]);
  const dueForRun = list.filter(a => a.status !== 'disposed' && depreciationThrough(a, runMonth) > (a.accumulatedDepreciationCents || 0));

  const undoDisposal = async (asset: FixedAsset) => {
    if (!workspace?.id) return;
    setUndoing(asset.id);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/assets/${encodeURIComponent(asset.id)}/disposal`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${await getIdToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The disposal could not be undone');
      toast.success(`${asset.name} is back on the books; its disposal entry is void`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUndoing('');
    }
  };

  // X-05: undo the latest move
  const undoMove = async (asset: FixedAsset) => {
    if (!workspace?.id) return;
    setUndoing(asset.id);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/assets/${encodeURIComponent(asset.id)}/transfer`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${await getIdToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The move could not be undone');
      toast.success(`${asset.name} is back where it was`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUndoing('');
    }
  };

  const openForm = () => {
    setForm(f => ({
      ...f,
      expenseAccountId: f.expenseAccountId || expenseAccounts.find(byName(/depreciation/i, 'expense'))?.id || '',
      accumulatedAccountId: f.accumulatedAccountId || assetAccounts.find(byName(/accumulated depreciation/i, 'asset'))?.id || '',
    }));
    setIsAdding(true);
  };

  const saveAsset = async () => {
    if (!isAmountText(form.cost)) return toast.error('Enter the asset name and its cost');
    if (form.salvage.trim() && !isAmountText(form.salvage)) return toast.error('The salvage value must be between 0 and the cost');
    const cost = parseAmountToCents(form.cost);
    const salvage = parseAmountToCents(form.salvage);
    const years = Number(form.years);
    if (!form.name.trim() || cost <= 0) return toast.error('Enter the asset name and its cost');
    if (salvage < 0 || salvage > cost) return toast.error('The salvage value must be between 0 and the cost');
    if (!(years > 0 && years <= 100)) return toast.error('Useful life must be between 0 and 100 years');
    if (!form.expenseAccountId || !form.accumulatedAccountId) return toast.error('Choose the depreciation expense and accumulated depreciation accounts');
    if (form.building && !form.assetAccountId) return toast.error('Choose the construction-in-progress account its costs are posted to');
    const asset: Omit<FixedAsset, 'id' | 'uid' | 'workspaceId' | 'createdAt'> = {
      name: form.name.trim(),
      purchaseDate: form.purchaseDate,
      purchasePriceCents: cost,
      salvageValueCents: salvage,
      usefulLifeYears: years,
      depreciationMethod: form.method,
      accumulatedDepreciationCents: 0,
      status: form.building ? 'in_progress' : 'active',
      ...(form.assetAccountId ? { assetAccountId: form.assetAccountId } : {}),
      expenseAccountId: form.expenseAccountId,
      accumulatedAccountId: form.accumulatedAccountId,
      ...(form.source ? { sourceBillId: form.source.split('#')[0], sourceBillLine: Number(form.source.split('#')[1]) } : {}),
    };
    await addEntity('assets', asset, `"${asset.name}" added to the register`);
    setIsAdding(false);
    setForm(f => ({ ...f, name: '', cost: '', salvage: '0', source: '', building: false }));
  };

  const runDepreciation = async () => {
    if (!workspace?.id) return;
    setRunning(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/periods/${runMonth}/depreciation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The depreciation could not be posted');
      toast.success(data.assets ? `Posted ${formatCurrency(data.totalCents)} depreciation for ${runMonth} (${data.assets} asset${data.assets === 1 ? '' : 's'}).` : `Nothing to post for ${runMonth}: everything is up to date.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The depreciation could not be posted');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6" id="fixed-assets-view">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
            <Building className="w-5 h-5" aria-hidden="true" /> Fixed Asset Register
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">Equipment, vehicles and other long-lived assets, depreciated once a month.</p>
        </div>
        {canWrite && (
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label htmlFor="dep-month" className="block text-xs font-semibold text-[var(--muted)] mb-1">Depreciation month</label>
              <input id="dep-month" type="month" value={runMonth} onChange={e => e.target.value && setRunMonth(e.target.value)} className={inputClass} />
            </div>
            <button type="button" onClick={runDepreciation} disabled={running || dueForRun.length === 0}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--brass)] text-[var(--ink)] disabled:opacity-50"
              title={dueForRun.length === 0 ? 'Nothing to depreciate for this month' : undefined}>
              Post depreciation{dueForRun.length ? ` (${dueForRun.length})` : ''}
            </button>
            <button type="button" onClick={openForm} className="px-4 py-2 text-sm font-semibold rounded-lg border border-[var(--line)] text-[var(--text)] inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> Add asset
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Cost', value: totals.cost, note: `${list.length} asset${list.length === 1 ? '' : 's'}` },
          { label: 'Accumulated depreciation', value: totals.accumulated, note: 'Posted so far' },
          { label: 'Book value', value: totals.book, note: 'Cost less depreciation' },
        ].map(card => (
          <div key={card.label} className="p-4 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <div className="text-xs font-semibold text-[var(--muted)] uppercase">{card.label}</div>
            <div className="text-xl font-mono font-bold text-[var(--text)] mt-1.5">{formatCurrency(card.value)}</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">{card.note}</div>
          </div>
        ))}
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">Find (name, tag or place; a scanned label types its tag here)
            <input type="search" value={find} onChange={e => setFind(e.target.value)} className={`${inputClass} block`} />
          </label>
          {canWrite && untagged.length > 0 && (
            <button type="button" disabled={tagging} onClick={() => void giveTags()} className="px-3 py-2 text-xs font-semibold rounded-lg border border-[var(--line)] text-[var(--text)] disabled:opacity-50">Give tags ({untagged.length})</button>
          )}
          <button type="button" onClick={() => setLabels(true)} className="px-3 py-2 text-xs font-semibold rounded-lg border border-[var(--line)] text-[var(--text)]">Print labels</button>
          {/* BD-08: the whole register as a spreadsheet */}
          <button type="button" onClick={() => downloadCsv(`fixed-asset-register-${today}.csv`, ASSET_REGISTER_HEADERS, assetRegisterRows(list, chart))} className="px-3 py-2 text-xs font-semibold rounded-lg border border-[var(--line)] text-[var(--text)]">Export register</button>
        </div>
      )}
      {labels && <AssetLabels assets={shown} company={workspace?.name || ''} onClose={() => setLabels(false)} />}

      {list.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <Building className="w-8 h-8 text-[var(--muted)] mx-auto mb-3" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--text)]">No fixed assets yet</h2>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-md mx-auto">Add equipment, vehicles or computers; the month-end run posts their depreciation.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Fixed assets</caption>
            <thead className="bg-[var(--panel)] text-[var(--muted)] font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Asset</th>
                <th scope="col" className="py-3 px-4">Bought</th>
                <th scope="col" className="py-3 px-4 text-right">Cost</th>
                <th scope="col" className="py-3 px-4 text-right">Life</th>
                <th scope="col" className="py-3 px-4 text-right">Depreciated</th>
                <th scope="col" className="py-3 px-4 text-right">Book value</th>
                <th scope="col" className="py-3 px-4">Posted through</th>
                {canWrite && <th scope="col" className="py-3 px-4"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] text-[var(--text)]">
              {shown.map(asset => (
                <React.Fragment key={asset.id}>
                <tr>
                  <td className="py-3 px-4 font-semibold">
                    <AssetInlineDetails asset={asset} currency={workspace?.currency || 'USD'} />
                    <div className="text-[11px] text-[var(--muted)] font-normal">{asset.status === 'in_progress' ? 'Being built (construction in progress)' : asset.depreciationMethod === 'declining-balance' ? 'Declining balance' : 'Straight line'}{asset.status === 'disposed' ? ' · disposed' : ''}</div>
                    {asset.placedInService && <div className="text-[11px] text-[var(--muted)] font-normal">In service since {formatDate(asset.placedInService.date)} (building started {formatDate(asset.placedInService.startedOn)})</div>}
                    {(asset.transfers || []).slice(-1).map(m => (
                      <div key={`${m.date}-${m.description}`} className="text-[11px] text-[var(--muted)] font-normal">{m.description} on {formatDate(m.date)}</div>
                    ))}
                    {(asset.partialDisposals || []).map(p => (
                      <div key={p.transactionId} className="text-[11px] text-[var(--muted)] font-normal">
                        {p.percent}% {p.proceedsCents > 0 ? 'sold' : 'scrapped'} {formatDate(p.date)}{p.gainLossCents ? ` · ${p.gainLossCents > 0 ? 'gain' : 'loss'} ${formatCurrency(Math.abs(p.gainLossCents))}` : ''}
                      </div>
                    ))}
                    <button type="button" aria-expanded={scheduleOf === asset.id} onClick={() => setScheduleOf(scheduleOf === asset.id ? '' : asset.id)}
                      className="mt-1 text-[11px] font-semibold text-[var(--brass)] hover:underline">
                      {scheduleOf === asset.id ? 'Hide schedule' : 'Schedule'}<span className="sr-only"> of {asset.name}</span>
                    </button>
                  </td>
                  <td className="py-3 px-4 font-mono">{formatDate(asset.purchaseDate)}</td>
                  <td className="py-3 px-4 text-right font-mono">{formatCurrency(asset.purchasePriceCents)}</td>
                  <td className="py-3 px-4 text-right">{asset.usefulLifeYears} yr</td>
                  <td className="py-3 px-4 text-right font-mono">{formatCurrency(asset.accumulatedDepreciationCents || 0)}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold">{asset.status === 'disposed' ? '—' : formatCurrency((asset.purchasePriceCents || 0) - (asset.accumulatedDepreciationCents || 0))}</td>
                  <td className="py-3 px-4 text-[var(--muted)]">
                    {asset.status === 'disposed' && asset.disposedOn
                      ? <>{(asset.disposalProceedsCents || 0) > 0 ? 'Sold' : 'Scrapped'} {formatDate(asset.disposedOn)}{asset.disposalGainLossCents ? ` · ${asset.disposalGainLossCents > 0 ? 'gain' : 'loss'} ${formatCurrency(Math.abs(asset.disposalGainLossCents))}` : ''}</>
                      : asset.status === 'in_progress' ? `Being built since ${formatDate(asset.purchaseDate)}` : asset.depreciatedThrough || 'not yet'}
                  </td>
                  {canWrite && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {asset.status !== 'disposed' ? (
                        <button type="button" onClick={() => setDisposing(asset)} className="text-xs font-semibold text-[var(--brass)] hover:underline">
                          Sell or scrap<span className="sr-only"> {asset.name}</span>
                        </button>
                      ) : asset.disposalTransactionId ? (
                        <button type="button" disabled={undoing === asset.id} onClick={() => void undoDisposal(asset)} className="text-xs font-semibold text-[var(--muted)] hover:underline disabled:opacity-50">
                          Undo disposal<span className="sr-only"> of {asset.name}</span>
                        </button>
                      ) : null}
                      {workspace && <ConstructionActions asset={asset} accounts={chart} workspaceId={workspace.id} today={today} currency={workspace.currency || 'USD'} />}
                      {asset.status !== 'disposed' && (
                        <button type="button" onClick={() => setMoving(asset)} className="block ml-auto mt-1 text-xs font-semibold text-[var(--brass)] hover:underline">
                          Move<span className="sr-only"> {asset.name}</span>
                        </button>
                      )}
                      {asset.status !== 'disposed' && (asset.transfers || []).length > 0 && (
                        <button type="button" disabled={undoing === asset.id} onClick={() => void undoMove(asset)} className="block ml-auto mt-1 text-xs font-semibold text-[var(--muted)] hover:underline disabled:opacity-50">
                          Undo last move<span className="sr-only"> of {asset.name}</span>
                        </button>
                      )}
                      {asset.status !== 'disposed' && (asset.partialDisposals || []).length > 0 && (
                        <button type="button" disabled={undoing === asset.id} onClick={() => void undoDisposal(asset)} className="block ml-auto mt-1 text-xs font-semibold text-[var(--muted)] hover:underline disabled:opacity-50">
                          Undo last part sold<span className="sr-only"> of {asset.name}</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {scheduleOf === asset.id && (
                  <tr>
                    <td colSpan={canWrite ? 8 : 7} className="px-4 pb-4 bg-[var(--panel)]">
                      <DepreciationScheduleTable asset={asset} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {disposing && workspace && (
        <DisposeAssetDialog asset={disposing} accounts={chart} workspaceId={workspace.id} today={today} currency={workspace.currency || 'USD'} onClose={() => setDisposing(null)} />
      )}
      {moving && workspace && (
        <TransferAssetDialog asset={moving} accounts={chart} workspaceId={workspace.id} today={today} currency={workspace.currency || 'USD'} onClose={() => setMoving(null)} />
      )}

      {isAdding && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="add-asset-title">
          <div className="rounded-xl shadow-xl max-w-lg w-full overflow-hidden border border-[var(--line)] bg-[var(--surface)]">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between">
              <h2 id="add-asset-title" className="text-sm font-bold text-[var(--text)]">Add a fixed asset</h2>
              <button type="button" onClick={() => setIsAdding(false)} className="p-1.5 text-[var(--muted)] rounded-md" aria-label="Close">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              {fromBills.length > 0 && (
                <div>
                  <label htmlFor="asset-from-bill" className="block font-semibold text-[var(--text)] mb-1">From a bill (optional)</label>
                  <select id="asset-from-bill" value={form.source} onChange={e => pickBillLine(e.target.value)} className={inputClass}>
                    <option value="">Not from a bill</option>
                    {fromBills.map(c => <option key={`${c.billId}#${c.line}`} value={`${c.billId}#${c.line}`}>{c.label}</option>)}
                  </select>
                </div>
              )}
              <label className="flex items-start gap-2 text-[var(--text)]">
                <input type="checkbox" className="mt-0.5" checked={form.building} onChange={e => setForm({ ...form, building: e.target.checked })} />
                <span>Still being built (construction in progress): costs are added as they come in, and it starts depreciating once it is placed in service</span>
              </label>
              <div>
                <label htmlFor="asset-name" className="block font-semibold text-[var(--text)] mb-1">Name</label>
                <input id="asset-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Delivery van" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="asset-cost" className="block font-semibold text-[var(--text)] mb-1">Cost</label>
                  <input id="asset-cost" inputMode="decimal" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="4500.00" className={`${inputClass} font-mono`} />
                </div>
                <div>
                  <label htmlFor="asset-salvage" className="block font-semibold text-[var(--text)] mb-1">Value at the end (salvage)</label>
                  <input id="asset-salvage" inputMode="decimal" value={form.salvage} onChange={e => setForm({ ...form, salvage: e.target.value })} className={`${inputClass} font-mono`} />
                </div>
                <div>
                  <label htmlFor="asset-years" className="block font-semibold text-[var(--text)] mb-1">Useful life (years)</label>
                  <input id="asset-years" type="number" min="0.5" step="0.5" value={form.years} onChange={e => setForm({ ...form, years: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="asset-date" className="block font-semibold text-[var(--text)] mb-1">{form.building ? 'Building started on' : 'Bought on'}</label>
                  <input id="asset-date" type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label htmlFor="asset-method" className="block font-semibold text-[var(--text)] mb-1">Method</label>
                <select id="asset-method" value={form.method} onChange={e => setForm({ ...form, method: e.target.value as FixedAsset['depreciationMethod'] })} className={inputClass}>
                  <option value="straight-line">Straight line (the same every month)</option>
                  <option value="declining-balance">Declining balance (more at the start)</option>
                </select>
              </div>
              {[
                { id: 'assetAccountId' as const, label: form.building ? 'Construction-in-progress account' : 'Asset account (optional)', options: assetAccounts },
                { id: 'expenseAccountId' as const, label: 'Depreciation expense account', options: expenseAccounts },
                { id: 'accumulatedAccountId' as const, label: 'Accumulated depreciation account', options: assetAccounts },
              ].map(field => (
                <div key={field.id}>
                  <label htmlFor={`asset-${field.id}`} className="block font-semibold text-[var(--text)] mb-1">{field.label}</label>
                  <select id={`asset-${field.id}`} value={form[field.id]} onChange={e => setForm({ ...form, [field.id]: e.target.value })} className={inputClass}>
                    <option value="">Choose…</option>
                    {field.options.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
                  </select>
                </div>
              ))}
              <p className="text-[11px] text-[var(--muted)]">Record the purchase itself as a bill or a transaction to the asset account. Depreciation starts the month after it was bought.</p>
              <div className="pt-2 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2 font-semibold text-[var(--text)] rounded-lg">Cancel</button>
                <button type="button" onClick={saveAsset} className="px-4 py-2 font-semibold rounded-lg bg-[var(--brass)] text-[var(--ink)] inline-flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FixedAssetsView;
