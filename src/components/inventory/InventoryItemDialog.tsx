import DocumentDefaultsEditor from '../common/DocumentDefaultsEditor';
import { itemDocumentDefaultsOf } from '../../lib/documentDefaults';
import { useNativeFormErrors } from '../../hooks/useNativeFormErrors';
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import AsyncButton from '../ui/AsyncButton';
import { useDialog } from '../../hooks/useDialog';
import { TAX_CATEGORIES } from '../../lib/tax/taxCategories';
import { useState, useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { bundlePartChoices, bundleProblem, type BundlePart } from '../../lib/itemBundles';
import { levelProblem } from '../../lib/locationLevels';
import { UNITS } from '../../lib/units';
import { CONSIGNMENT_OPTIONS } from '../../lib/consignmentStock';
import RecordNotesPanel from '../common/RecordNotesPanel';
import type { InventoryItem } from '../../types';

import ItemImagePanel from './ItemImagePanel';

interface InventoryItemDialogProps {
  open: boolean;
  editingItem: InventoryItem | null;
  categories: string[];
  /** A-7: the sales tax codes an item may default to (Settings → Taxes) */
  taxCodes?: Array<{ id: string; name: string }>;
  /** A-19: every item, so a bundle can pick its parts */
  allItems?: InventoryItem[];
  canChangeStock: boolean;
  stockActionsAvailable?: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onItemImageChange?: (itemId: string) => void;
  /** Opens Adjust stock for the item being edited (its quantity changes only through the books). */
  onAdjust: (item: InventoryItem) => void;
  /** ISS-130: the cost of stock on hand changes only by a revaluation (owners and accountants) */
  onRevalue?: (item: InventoryItem) => void;
}

/** The add / edit item form of the Inventory screen (F-16: moved out of Inventory.tsx). */
export default function InventoryItemDialog({ open, editingItem, categories, taxCodes = [], allItems = [], canChangeStock, stockActionsAvailable = true, onClose, onSubmit, onItemImageChange, onAdjust, onRevalue }: InventoryItemDialogProps) {
  const { formRef, clearFieldError } = useNativeFormErrors(open);
  // ISS-130: with stock on hand the cost is on the books; it changes by a revaluation, never by this form
  // ISS-130: stock above zero has a value on the books; its cost changes only through a revaluation
  const costLocked = (Number(editingItem?.quantityAtHand) || 0) > 0;
  const { dialogProps: itemDialogProps, titleId: itemTitleId } = useDialog(onClose, open);
  // A-19: the bundle's parts, held here and written into the form as JSON. The parent keys this
  // dialog by item id, so switching items gives fresh state without an effect.
  const itemDefaults = () => {
    const { taxCodeId: _tax, ...hints } = itemDocumentDefaultsOf(editingItem);
    return hints; // Tax has its own existing form field; never retain a hidden duplicate.
  };
  const [documentDefaults, setDocumentDefaults] = useState(itemDefaults);
  const [defaultsSource, setDefaultsSource] = useState({ open, item: editingItem });
  if (open !== defaultsSource.open || editingItem !== defaultsSource.item) {
    setDefaultsSource({ open, item: editingItem });
    setDocumentDefaults(itemDefaults());
  }
  const [parts, setParts] = useState<BundlePart[]>(editingItem?.bundleParts || []);
  const [partToAdd, setPartToAdd] = useState('');
  const [partQuantity, setPartQuantity] = useState('1');
  const choices = useMemo(() => bundlePartChoices(editingItem?.id || '', allItems), [allItems, editingItem?.id]);
  const partsProblem = parts.length ? bundleProblem({ id: editingItem?.id || '', name: '' }, parts, allItems) : undefined;
  const candidateParts = partToAdd
    ? parts.some(part => part.itemId === partToAdd)
      ? parts.map(part => part.itemId === partToAdd ? { ...part, quantity: Number(partQuantity) } : part)
      : [...parts, { itemId: partToAdd, quantity: Number(partQuantity) }]
    : parts;
  const candidateProblem = partToAdd ? bundleProblem({ id: editingItem?.id || '', name: '' }, candidateParts, allItems) : undefined;
  const addPart = () => {
    if (!partToAdd || candidateProblem) return;
    setParts(candidateParts);
    setPartToAdd(''); setPartQuantity('1');
  };
  // A-115: minimum/maximum per location, held here and written into the form as JSON. The parent
  // keys this dialog by item id, so switching items gives fresh state without an effect.
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes || []);
  const [levelDrafts, setLevelDrafts] = useState<Record<string, { min: string; max: string }>>(() =>
    Object.fromEntries(Object.entries(editingItem?.locationLevels || {}).map(([id, l]) => [id, { min: String(l.min), max: String(l.max) }])) as Record<string, { min: string; max: string }>);
  const locationNodes = useMemo(() => {
    const byId = new Map((dimensionNodes || []).filter(n => n.dimensionId === 'location').map(n => [n.id, n]));
    const rows = [...byId.values()].filter(n => n.status !== 'archived');
    for (const id of Object.keys(levelDrafts)) {
      if (!rows.some(n => n.id === id) && (levelDrafts[id].min.trim() || levelDrafts[id].max.trim())) {
        rows.push(byId.get(id) || { id, dimensionId: 'location', description: id });
      }
    }
    return rows.sort((a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: 'base' }));
  }, [dimensionNodes, levelDrafts]);
  const levelsJson = JSON.stringify(Object.fromEntries(locationNodes.flatMap(n => {
    const draft = levelDrafts[n.id] || { min: '', max: '' };
    if ((!draft.min.trim() && !draft.max.trim()) || levelProblem(draft.min, draft.max)) return [];
    return [[n.id, { min: Number(draft.min), max: Number(draft.max) }]];
  })));
  return (
    <AnimatePresence>
        {open && (
          <div {...itemDialogProps} className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[var(--surface)] rounded-[40px] shadow-2xl border border-[var(--line)] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
            >
              <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between">
                <h2 id={itemTitleId} className="text-xl font-black text-[var(--text)] tracking-tighter">
                  {editingItem ? 'Edit Inventory Item' : 'New Inventory Item'}
                </h2>
                <button aria-label="Close item dialog"
                  onClick={onClose} 
                  className="min-h-11 min-w-11 p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X aria-hidden="true" size={20} className="text-zinc-400" />
                </button>
              </div>
              <form ref={formRef} onSubmit={event => { if (partsProblem) { event.preventDefault(); formRef.current?.querySelector<HTMLSelectElement>('#inv-bundle-part')?.focus(); return; } onSubmit(event); }} className="p-4 md:p-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="sm:col-span-2 space-y-2">
                  <label htmlFor="inv-item-name" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Item Name</label>
                  <input 
                    id="inv-item-name" dir="auto"
                    name="name" 
                    defaultValue={editingItem?.name}
                    required 
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-sku" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">SKU</label>
                  <input 
                    id="inv-sku"
                    name="sku" 
                    defaultValue={editingItem?.sku}
                    required 
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-category" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Category</label>
                  <input 
                    id="inv-category"
                    name="category" 
                    list="inv-category-options"
                    defaultValue={editingItem?.category}
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-item-type" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Kind</label>
                  <select id="inv-item-type" name="itemType" defaultValue={editingItem?.itemType || 'stock'} disabled={Boolean(editingItem?.quantityAtHand)}
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold">
                    <option value="stock">Stock item (counted, costed when sold)</option>
                    <option value="service">Service (no stock: fills the price on invoices)</option>
                  </select>
                  {Boolean(editingItem?.quantityAtHand) && <p className="text-[10px] text-[var(--muted)]">It has stock on hand, so it stays a stock item.</p>}
                </div>
                <datalist id="inv-category-options">
                  {categories.map(c => <option key={c} value={c} />)}
                </datalist>
                <div className="space-y-2">
                  <label htmlFor="inv-unit-cost" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Unit Cost ($)</label>
                  <input 
                    id="inv-unit-cost"
                    name="unitCost" 
                    type="number" 
                    step="0.01" 
                    defaultValue={editingItem ? editingItem.unitCostCents / 100 : undefined}
                    required 
                    readOnly={costLocked}
                    aria-describedby={costLocked ? 'inv-unit-cost-locked' : undefined}
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold read-only:opacity-70" 
                  />
                  {costLocked && editingItem && <p id="inv-unit-cost-locked" className="text-[10px] text-[var(--muted)]">
                    It has stock on hand, so its cost is on the books: change it with a revaluation, which posts the difference.
                    {onRevalue && <> <button type="button" onClick={() => onRevalue(editingItem)} className="min-h-11 px-1 font-semibold text-emerald-700 hover:underline">Revalue cost</button></>}
                  </p>}
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-unit-price" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Unit Price ($)</label>
                  <input 
                    id="inv-unit-price"
                    name="unitPrice" 
                    type="number" 
                    step="0.01" 
                    defaultValue={editingItem ? editingItem.unitPriceCents / 100 : undefined}
                    required 
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                </div>
                {editingItem ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Quantity at Hand</p>
                    <div className="flex items-center justify-between px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] font-bold">
                      <span className="tabular-nums">{editingItem.quantityAtHand}</span>
                      {canChangeStock && (
                        <button type="button" disabled={!stockActionsAvailable} onClick={() => { if (stockActionsAvailable) onAdjust(editingItem); }} className="text-xs font-semibold text-emerald-700 hover:underline">
                          Adjust stock
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label htmlFor="inv-quantity" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Opening stock</label>
                    <input
                      id="inv-quantity"
                      name="quantity"
                      disabled={!stockActionsAvailable}
                      type="number"
                      min="0"
                      step="any"
                      defaultValue={0}
                      aria-describedby="inv-quantity-help"
                      className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold"
                    />
                    <p id="inv-quantity-help" className="text-[10px] text-[var(--muted)]">{stockActionsAvailable ? 'Recorded at the unit cost against Opening Balance Equity.' : 'Opening stock needs a signed-in workspace. This item will start with zero stock.'}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <label htmlFor="inv-default-tax" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Default tax code</label>
                  <select id="inv-default-tax" name="defaultTaxCodeId" defaultValue={editingItem?.defaultTaxCodeId || ''}
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold">
                    <option value="">No default (the invoice's tax choice)</option>
                    {taxCodes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="text-[10px] text-[var(--muted)]">Choosing this item on an invoice fills this tax code; it can still be changed there.</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-tax-category" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Tax category</label>
                  <select id="inv-tax-category" name="productTaxCategory" defaultValue={editingItem?.productTaxCategory || ''}
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold">
                    <option value="">General goods (the default)</option>
                    {TAX_CATEGORIES.filter(c => c.id !== 'general').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <p className="text-[10px] text-[var(--muted)]">Which kind of thing this is, so a state's taxability table (Reports → Tax) can treat it correctly. It never changes a price or a posting.</p>
                </div>
                <div className="md:col-span-2">
                  <DocumentDefaultsEditor side="item" value={documentDefaults} onChange={setDocumentDefaults} showTax={false} />
                  <input type="hidden" name="documentDefaults" value={JSON.stringify(documentDefaults)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <span id="inv-bundle-label" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Bundle parts</span>
                  <input type="hidden" name="bundleParts" value={JSON.stringify(parts)} />
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="inv-bundle-label">
                    <label htmlFor="inv-bundle-part" className="sr-only">Item to add as a bundle part</label>
                    <select aria-invalid={Boolean(candidateProblem || partsProblem)} aria-describedby={[candidateProblem && 'inv-bundle-candidate-error', partsProblem && 'inv-bundle-parts-error'].filter(Boolean).join(' ') || undefined} id="inv-bundle-part" value={partToAdd} onChange={e => { clearFieldError('inv-bundle-qty'); setPartToAdd(e.target.value); }}
                      className="max-w-full min-w-0 px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-2xl font-bold text-sm">
                      <option value="">Choose an item…</option>
                      {choices.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <label htmlFor="inv-bundle-qty" className="sr-only">How many of the part one bundle holds</label>
                    <input id="inv-bundle-qty" aria-invalid={Boolean(candidateProblem)} aria-describedby={candidateProblem ? 'inv-bundle-candidate-error' : undefined} type="number" min={1} step={1} value={partQuantity} onChange={e => setPartQuantity(e.target.value)}
                      className="w-24 px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-2xl font-bold text-sm" />
                    <button type="button" disabled={!partToAdd || Boolean(candidateProblem)} onClick={addPart} className="px-4 py-3 rounded-2xl bg-[var(--text)] text-[var(--surface)] text-xs font-black uppercase tracking-widest">Add part</button>
                  </div>
                  {candidateProblem && <p id="inv-bundle-candidate-error" role="alert" className="text-xs text-[var(--muted)]">{candidateProblem}</p>}
                  {parts.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label="Bundle parts chosen">
                      {parts.map(part => (
                        <li key={part.itemId} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--line)] text-xs font-semibold">
                          <span>{part.quantity} × {allItems.find(i => i.id === part.itemId)?.name || 'a removed item'}</span>
                          <button type="button" aria-label={`Remove ${allItems.find(i => i.id === part.itemId)?.name || 'the removed part'}`}
                            onClick={() => setParts(prev => prev.filter(p => p.itemId !== part.itemId))} className="min-h-11 min-w-11 text-[var(--muted)] hover:text-[var(--text)]">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {partsProblem && <p id="inv-bundle-parts-error" role="alert" className="text-[10px] text-amber-600">{partsProblem}</p>}
                  <p className="text-[10px] text-[var(--muted)]">Record the parts and quantities that define this bundle. Automatic expansion into invoice lines is not available here; saving this configuration does not move stock or post an entry.</p>
                  <label className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    <input type="checkbox" name="assembleOnDemand" defaultChecked={Boolean(editingItem?.assembleOnDemand)} />
                    Assemble on demand — the kit is built from its parts when it is needed (a note only; the Reports → Kit Assembly plan reads the parts’ stock)
                  </label>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor="inv-consignment" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Consignment</label>
                  <select id="inv-consignment" name="consignment" defaultValue={editingItem?.consignment || ''}
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold">
                    {CONSIGNMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <p className="text-[10px] text-[var(--muted)]">Consignment stock is reported on Inventory at the item&rsquo;s cost; it never posts to the books by itself.</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-reorder-point" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Reorder Point</label>
                  <input 
                    id="inv-reorder-point"
                    name="reorderPoint" 
                    type="number" 
                    defaultValue={editingItem?.reorderPoint}
                    required 
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                </div>
                <fieldset className="space-y-2 md:col-span-2">
                  <legend className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Stock levels per location</legend>
                  <input type="hidden" name="locationLevels" value={levelsJson} />
                  {locationNodes.length === 0 && (
                    <p className="text-[10px] text-[var(--muted)]">No locations yet — add Location values under Settings → Labels first.</p>
                  )}
                  {locationNodes.map(node => {
                    const problem = levelProblem(levelDrafts[node.id]?.min || '', levelDrafts[node.id]?.max || '');
                    const errorId = `inv-level-error-${node.id}`;
                    return <div key={node.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold min-w-28 flex-1">{node.description}</span>
                      <label htmlFor={`inv-level-min-${node.id}`} className="sr-only">Minimum at {node.description}</label>
                      <input id={`inv-level-min-${node.id}`} type="number" min="0" step="1" placeholder="Min"
                        aria-label={`Minimum at ${node.description}`} aria-invalid={Boolean(problem)} aria-describedby={problem ? errorId : undefined}
                        value={levelDrafts[node.id]?.min || ''}
                        onChange={e => setLevelDrafts(prev => ({ ...prev, [node.id]: { min: e.target.value, max: prev[node.id]?.max || '' } }))}
                        className="w-24 px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-2xl font-bold text-sm" />
                      <label htmlFor={`inv-level-max-${node.id}`} className="sr-only">Maximum at {node.description}</label>
                      <input id={`inv-level-max-${node.id}`} type="number" min="0" step="1" placeholder="Max"
                        aria-label={`Maximum at ${node.description}`} aria-invalid={Boolean(problem)} aria-describedby={problem ? errorId : undefined}
                        value={levelDrafts[node.id]?.max || ''}
                        onChange={e => setLevelDrafts(prev => ({ ...prev, [node.id]: { min: prev[node.id]?.min || '', max: e.target.value } }))}
                        className="w-24 px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-2xl font-bold text-sm" />
                      {problem && <p id={errorId} role="alert" className="text-[10px] text-amber-600">{problem}</p>}
                    </div>;
                  })}
                  <p className="text-[10px] text-[var(--muted)]">When a location falls below its minimum, the reorder suggestions offer to top it up to the maximum. Blank leaves the location out; this never moves stock by itself.</p>
                </fieldset>
                <div className="space-y-2">
                  <label htmlFor="inv-uom" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">UOM (e.g. pack, kg)</label>
                  <input 
                    id="inv-uom" dir="auto"
                    name="measurementUnit" 
                    type="text" 
                    list="inv-uom-options"
                    defaultValue={editingItem?.measurementUnit}
                    placeholder="Optional"
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                  <p className="text-xs text-[var(--muted)]">Choose a suggested unit or keep your own label, including Hebrew. The unit and package size are item settings; this form does not convert posted stock or invoice quantities.</p>
                  <datalist id="inv-uom-options">
                    {UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <label htmlFor="inv-units-per-pkg" className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Units per Package</label>
                  <input 
                    id="inv-units-per-pkg"
                    name="unitsPerPackage" 
                    type="number" 
                    defaultValue={editingItem?.unitsPerPackage}
                    placeholder="1"
                    min="1"
                    className="w-full px-6 py-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all font-bold" 
                  />
                </div>
                <div className="sm:col-span-2 pt-4">
                  <AsyncButton 
                    type="submit" disabled={Boolean(partsProblem)}
                    loadingText={editingItem ? 'Updating...' : 'Adding...'}
                    className="w-full py-5 bg-zinc-900 text-white rounded-[32px] font-black hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/20"
                  >
                    {editingItem ? 'Update Item' : 'Add to Inventory'}
                  </AsyncButton>
                </div>
              </form>
              {editingItem?.id && (
                <div className="space-y-6 p-4 md:p-8 border-t border-[var(--line)]">
                  <ItemImagePanel itemId={editingItem.id} itemName={editingItem.name || 'this item'} workspaceId={editingItem.workspaceId || ''}
                    onChange={() => onItemImageChange?.(editingItem.id)} />
                  <RecordNotesPanel entityType="item" entityId={editingItem.id} entityName={editingItem.name || 'this item'}
                    metadata={(editingItem as { metadata?: Record<string, unknown> }).metadata}
                    canEdit={canChangeStock} />
                </div>
              )}
            </motion.div>
          </div>
        )}

    </AnimatePresence>
  );
}
