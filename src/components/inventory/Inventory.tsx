import { workspaceActor } from '../../lib/guestActor';
import { defaultsMetadata, cleanDocumentDefaults } from '../../lib/documentDefaults';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, safeConfirm } from '../../lib/utils';
import { ConfirmButton } from '../ui/ConfirmButton';
import { toast } from 'sonner';
import { StrategicEngine } from '../../services/strategicEngine';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Package, Plus, Trash2, Edit2, BarChart3, Database, Zap,
  ShieldAlert, ShoppingCart, SlidersHorizontal, ClipboardList, History } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTimeout } from '../../hooks/useTimeout';
import {
  collection, query, where, onSnapshot } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { InventoryItem } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { isPostable } from '../../lib/txFilters';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { defaultOffsetAccount, inventoryAccountsOf } from '../../lib/inventoryAccounts';
import { adjustStockRequest, countStockRequest } from '../../services/stockRequests';
import InlineEdit from '../ui/InlineEdit';
import InlineAdd from '../ui/InlineAdd';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import CogsDialog from './CogsDialog';
import StockPolicySwitch from './StockPolicySwitch';
import StockHistoryDialog from './StockHistoryDialog';
import InventoryItemDialog from './InventoryItemDialog';
import { ItemImageThumb } from './ItemImagePanel';
import StockAdjustDialog from './StockAdjustDialog';
import StockRevalueDialog from './StockRevalueDialog';
import StockCountDialog from './StockCountDialog';
import CategoryManagerDialog from './CategoryManagerDialog';
import { categoryCounts } from '../../lib/itemCategories';
import { TAX_CATEGORIES, taxCategoryLabel, effectiveTaxCategory } from '../../lib/tax/taxCategories';
import { isBundle, bundleSummary, type BundlePart } from '../../lib/itemBundles';
import { kitBuildableSummary } from '../../lib/kitAssembly';
import { parseLocationLevelsJson } from '../../lib/locationLevels';
import ConsignmentStockPanel from './ConsignmentStockPanel';
import { isConsignment } from '../../lib/consignmentStock';
import { deleteWithUndo, isDeletePending } from '../../lib/undoableDelete';
import { BRAND_NAME } from '../../config/brand';
import { buildInventoryColumns, type InventoryRowItem } from './inventoryColumns';
import { removeInventoryItem, saveInventoryItem, saveInventoryItemField } from '../../lib/recordWrites';

/** A-19: the bundle parts the item dialog wrote into the form (a bad value means no parts, never a crash). */
const parseBundleParts = (raw: FormDataEntryValue | null): BundlePart[] | undefined => {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const parts = parsed
      .filter((p): p is { itemId: string; quantity: number } => typeof p === 'object' && p !== null
        && typeof (p as { itemId?: unknown }).itemId === 'string' && Number.isInteger((p as { quantity?: unknown }).quantity))
      .map(p => ({ itemId: p.itemId, quantity: p.quantity }));
    return parts.length ? parts : undefined;
  } catch { return undefined; }
};

export default function Inventory() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest);
  const uid = useAuthStore(s => workspaceActor(s)?.uid);
  const storeTransactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRuleIntel, setShowRuleIntel] = useState(false);
  const [cogsItem, setCogsItem] = useState<InventoryItem | null>(null);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [taxCategoryFilter, setTaxCategoryFilter] = useState('');
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const baseCurrency = useLedgerStore(s => s.baseCurrency) || 'USD';
  const role = useCurrentRole();
  const canChangeStock = role !== 'viewer';
  const canPostStock = canChangeStock && !isGuest;
  const canRevalue = !isGuest && (role === 'owner' || role === 'accountant');
  const [revalueDraft, setRevalueDraft] = useState<{ item: InventoryItem; workspaceId: string | null } | null>(null);
  const revalueItem = revalueDraft && revalueDraft.workspaceId === workspaceId ? revalueDraft.item : null;
  const setRevalueItem = useCallback((item: InventoryItem | null) => setRevalueDraft(item ? { item, workspaceId } : null), [workspaceId]);
  const { setSafeTimeout } = useTimeout();

  useEffect(() => {
    if (!workspaceId || !uid) {
      setSafeTimeout(() => setLoading(false), 0);
      return;
    }

    const q = query(
      collection(db, 'inventory'),
      where('workspaceId', '==', workspaceId),
    );

    const unsubInventory = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));
      setItems(data.filter(i => !isDeletePending(`inventory/${i.id}`)));
      setLoading(false);
    }, () => setLoading(false));

    return () => {
      unsubInventory();
    };
  }, [workspaceId, uid, setSafeTimeout]);

  const activeTransactions = useMemo(() => storeTransactions.filter(isPostable), [storeTransactions]);
  const economicItems = useMemo(() => StrategicEngine.analyzeUnitEconomics(items, activeTransactions, accounts), [items, activeTransactions, accounts]);

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [imageRefresh, setImageRefresh] = useState<Record<string, number>>({});
  const taxRatesForItems = useLedgerStore(s => s.taxRates || []);
  const salesTaxCodes = useMemo(() => taxRatesForItems.filter(r => r.type === 'Sales' && r.appliesTo !== 'purchases').map(r => ({ id: r.id, name: r.name })), [taxRatesForItems]);

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingItem) return;

    const formData = new FormData(e.currentTarget);
    const updates: Partial<InventoryItem> = {
      name: formData.get('name') as string,
      sku: formData.get('sku') as string,
      description: formData.get('description') as string,
      unitPriceCents: TruthEngine.parseAmountToCents(formData.get('unitPrice') as string),
      ...((Number(editingItem.quantityAtHand) || 0) > 0 ? {} : { unitCostCents: TruthEngine.parseAmountToCents(formData.get('unitCost') as string) }),
      reorderPoint: Number.parseInt(formData.get('reorderPoint') as string, 10) || 0,
      measurementUnit: formData.get('measurementUnit') as string || undefined,
      unitsPerPackage: formData.get('unitsPerPackage') ? Number.parseInt(formData.get('unitsPerPackage') as string, 10) || 1 : undefined,
      category: formData.get('category') as string,
      itemType: formData.get('itemType') === 'service' && !editingItem.quantityAtHand ? 'service' : (editingItem.quantityAtHand ? editingItem.itemType || 'stock' : 'stock'),
      productTaxCategory: (formData.get('productTaxCategory') as string) || undefined,
      bundleParts: parseBundleParts(formData.get('bundleParts')),
      assembleOnDemand: formData.get('assembleOnDemand') === 'on',
      consignment: (formData.get('consignment') as string) || undefined,
      locationLevels: parseLocationLevelsJson(formData.get('locationLevels')) };

    try {
      const defaults = cleanDocumentDefaults(JSON.parse(String(formData.get('documentDefaults') || '{}')));
      await saveInventoryItem(workspaceId || '', {
        id: editingItem.id,
        ...updates,
        documentDefaults: Object.keys(defaults).length ? defaults : null,
        defaultTaxCodeId: String(formData.get('defaultTaxCodeId') || '') || null });
      setEditingItem(null);
      toast.success('Inventory item updated');
    } catch {
      toast.error('Failed to update item');
    }
  };

  const recordOpeningStock = async (itemId: string, name: string, quantity: number) => {
    if (isGuest) throw new Error('Opening stock needs a signed-in workspace.');
    const inventoryAcc = inventoryAccountsOf(accounts)[0];
    const equityAcc = defaultOffsetAccount(accounts, 'opening');
    if (!workspaceId || !inventoryAcc || !equityAcc) {
      toast.warning(`${name} added with no stock`, { description: 'To record opening stock, add an Inventory and an Opening Balance Equity account, then use Adjust stock.' });
      return;
    }
    try {
      await adjustStockRequest({ workspaceId, itemId, quantityChange: quantity, type: 'opening', inventoryAccountId: inventoryAcc.id, offsetAccountId: equityAcc.id });
      toast.success(`${name} added with ${quantity} in stock`);
    } catch (err) {
      toast.warning(`${name} added with no stock`, { description: `Opening stock not recorded: ${(err as Error).message}. Use Adjust stock.` });
    }
  };

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const newItem: Omit<InventoryItem, 'id'> = {
      metadata: defaultsMetadata(undefined, cleanDocumentDefaults(JSON.parse(String(formData.get('documentDefaults') || '{}')))),
      uid: uid || '',
      workspaceId: workspaceId || '',
      name: formData.get('name') as string,
      sku: formData.get('sku') as string,
      description: formData.get('description') as string,
      unitPriceCents: TruthEngine.parseAmountToCents(formData.get('unitPrice') as string),
      unitCostCents: TruthEngine.parseAmountToCents(formData.get('unitCost') as string),
      quantityAtHand: 0,
      reorderPoint: Number.parseInt(formData.get('reorderPoint') as string, 10) || 0,
      measurementUnit: formData.get('measurementUnit') as string || undefined,
      unitsPerPackage: formData.get('unitsPerPackage') ? Number.parseInt(formData.get('unitsPerPackage') as string, 10) || 1 : undefined,
      category: formData.get('category') as string,
      itemType: formData.get('itemType') === 'service' ? 'service' : 'stock',
      defaultTaxCodeId: (formData.get('defaultTaxCodeId') as string) || undefined,
      productTaxCategory: (formData.get('productTaxCategory') as string) || undefined,
      bundleParts: parseBundleParts(formData.get('bundleParts')),
      assembleOnDemand: formData.get('assembleOnDemand') === 'on',
      consignment: (formData.get('consignment') as string) || undefined,
      locationLevels: parseLocationLevelsJson(formData.get('locationLevels')),
      createdAt: new Date().toISOString() };

    const openingQty = newItem.itemType === 'service' ? 0 : Number(formData.get('quantity')) || 0;
    if (isGuest && openingQty !== 0) { toast.error('Opening stock needs a signed-in workspace. The item was not saved.'); return; }
    try {
      const saved = await saveInventoryItem(workspaceId || '', newItem as unknown as Record<string, unknown>) as { id?: string } | undefined;
      setIsAdding(false);
      if (openingQty > 0 && saved?.id) await recordOpeningStock(saved.id, newItem.name, openingQty);
      else toast.success('Inventory item added');
    } catch {
      toast.error('Failed to add item');
    }
  };

  const quickAddItem = async (name: string) => {
    await saveInventoryItem(workspaceId || '', {
      name, sku: '', description: '', unitPriceCents: 0, unitCostCents: 0, reorderPoint: 0,
      category: categoryFilter || '' });
    toast.success(`"${name}" added`);
  };

  const saveItemField = useCallback(async (item: InventoryItem, field: 'name' | 'sku' | 'category' | 'unitPriceCents' | 'unitCostCents' | 'standardCostCents', value: string | number) => {
    await saveInventoryItemField(workspaceId || '', item.id, field, value);
    toast.success('Saved');
  }, [workspaceId]);

  const countItem = useCallback(async (item: InventoryItem, counted: number) => {
    if (isGuest) throw new Error('Stock counts need a signed-in workspace.');
    const inventoryAcc = inventoryAccountsOf(accounts)[0];
    const varianceAcc = defaultOffsetAccount(accounts, 'count');
    if (!workspaceId || !inventoryAcc || !varianceAcc) throw new Error('Add an Inventory account and a variance (or Cost of Goods Sold) account first');
    const result = await countStockRequest({ workspaceId, inventoryAccountId: inventoryAcc.id, offsetAccountId: varianceAcc.id, reason: 'Corrected in the inventory list', counts: [{ itemId: item.id, counted }] });
    toast.success(`${item.name}: ${counted} in stock`, { description: `Difference ${formatCurrency(result.valueCents, baseCurrency)} recorded to ${varianceAcc.name}` });
  }, [isGuest, accounts, workspaceId, baseCurrency]);

  const handleDelete = useCallback(async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (item.quantityAtHand > 0 && !safeConfirm(`"${item.name}" has ${item.quantityAtHand} units on hand representing asset value. Delete this item anyway?`)) return;
    const at = items.findIndex(i => i.id === id);
    deleteWithUndo({
      key: `inventory/${id}`,
      label: `Item "${item.name}"`,
      hide: () => setItems(prev => prev.filter(i => i.id !== id)),
      restore: () => setItems(prev => {
        const rows = prev.filter(i => i.id !== id);
        rows.splice(at < 0 ? rows.length : Math.min(at, rows.length), 0, item);
        return rows;
      }),
      commit: () => removeInventoryItem(workspaceId || '', id) });
  }, [items, workspaceId]);

  const categories = useMemo(() => categoryCounts(items).map(c => c.name), [items]);
  const displayItems = useMemo<InventoryRowItem[]>(() => {
    const matches = (item: InventoryItem) =>
      (!categoryFilter || (item.category || '').trim() === categoryFilter) &&
      (!taxCategoryFilter || effectiveTaxCategory(item.productTaxCategory) === taxCategoryFilter) &&
      (item.name.toLowerCase().includes(searchTerm.toLowerCase()) || (item.sku || '').toLowerCase().includes(searchTerm.toLowerCase()));
    return (showRuleIntel ? economicItems : items).filter(matches);
  }, [showRuleIntel, economicItems, items, categoryFilter, taxCategoryFilter, searchTerm]);

  const atRiskCount = useMemo(() => economicItems.filter(i => i.anomaly || i.resilience === 'Critical').length, [economicItems]);
  const avgIntegrity = useMemo(
    () => (economicItems.length > 0 ? Math.round(economicItems.reduce((acc, i) => acc + i.integrityScore, 0) / economicItems.length) : 0),
    [economicItems],
  );

  const inventoryColumns = useMemo(() => buildInventoryColumns({
    workspaceId,
    items,
    categories,
    imageRefresh,
    showRuleIntel,
    canChangeStock,
    canPostStock,
    canRevalue,
    onSaveField: saveItemField,
    onCountItem: countItem,
    onRevalueItem: setRevalueItem,
    onCogsItem: setCogsItem,
    onAdjustItem: setAdjustItem,
    onHistoryItem: setHistoryItem,
    onEditItem: setEditingItem,
    onDeleteItem: handleDelete }), [workspaceId, items, categories, imageRefresh, showRuleIntel, canChangeStock, canPostStock, canRevalue, saveItemField, countItem, setRevalueItem, handleDelete]);

  const closeItemDialog = () => { setIsAdding(false); setEditingItem(null); };

  return (
    <div className="space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 py-6 px-2 border-b border-[var(--line)]/30">
        <div className="space-y-4">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-[28px] bg-slate-900 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.2)] border border-white/5 shrink-0">
              <Package aria-hidden="true" size={28} />
            </div>
            <div>
              <h1 className="text-3xl md:text-5xl font-display font-black text-[var(--text)] tracking-tight">
                Inventory
              </h1>
              <p className="text-[12px] font-black text-[var(--muted)] uppercase tracking-[0.35em] font-mono">
                Real-time stock management.
              </p>
            </div>
          </div>
          {!isGuest && <StockPolicySwitch />}
          {isGuest && <p className="text-sm text-[var(--muted)]">Items save locally. Opening stock, adjustments, counts and revaluations need a signed-in workspace.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowRuleIntel(!showRuleIntel)}
            className={cn(
              'min-h-11 px-5 py-2.5 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all border flex items-center gap-2',
              showRuleIntel
                ? 'bg-[var(--elevated)] text-[var(--text)] border-[var(--brass)] shadow-sm'
                : 'bg-[var(--surface)] text-[var(--muted)] border-[var(--line)] hover:text-[var(--text)]',
            )}
          >
            <BarChart3 aria-hidden="true" size={16} />
            {showRuleIntel ? `${BRAND_NAME} AI Active` : 'Rule Intel'}
          </button>

          {canChangeStock && items.length > 0 && (
            <button
              type="button"
              disabled={!canPostStock}
              onClick={() => { if (canPostStock) setIsCounting(true); }}
              className="min-h-11 px-5 py-2.5 rounded-2xl font-bold text-xs uppercase tracking-wider border bg-[var(--surface)] text-[var(--text)] border-[var(--line)] hover:bg-[var(--elevated)] disabled:opacity-50 flex items-center gap-2"
            >
              <ClipboardList aria-hidden="true" size={16} />
              Stock count
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="min-h-11 px-6 py-2.5 bg-slate-900 text-white rounded-2xl text-xs font-bold uppercase tracking-wider shadow-md hover:opacity-95 transition-all flex items-center gap-2 border border-white/10 active:scale-95"
          >
            <Plus aria-hidden="true" size={18} />
            Enlist Asset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 bg-zinc-950 p-6 sm:p-10 rounded-[32px] text-white flex flex-col md:flex-row items-center justify-between gap-8 border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
            <Database aria-hidden="true" size={200} />
          </div>
          <div className="relative z-10 w-full md:w-2/3">
            <div className="flex items-center gap-5 mb-4">
              <div className="w-12 h-12 bg-[var(--surface)]/10 rounded-2xl flex items-center justify-center text-white border border-white/5">
                <Zap aria-hidden="true" size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter">Rule Inventory Core</h2>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest truncate italic font-mono">Real-time Data Chain Synthesis Enabled</p>
              </div>
            </div>
            <p className="text-sm text-white/60 leading-relaxed font-medium">
              Synthesizing <span className="text-white font-black">{activeTransactions.length}</span> transaction nodes for <span className="text-white font-black">{items.length}</span> SKUs.
              The &ldquo;Core Integrity&rdquo; engine has cross-referenced historical sourcing, overhead vectors, and market arbitrage with weighted recency bias.
            </p>
          </div>
          <div className="relative z-10 flex flex-col items-center md:items-end w-full md:w-1/3">
            <div className="flex flex-col items-center">
              <div className="flex items-baseline gap-3">
                <span className="text-6xl font-black tracking-tighter text-white">{avgIntegrity}</span>
                <div className="flex flex-col">
                  <span className="text-xs font-black text-indigo-400 uppercase tracking-widest">Avg. Integrity</span>
                  <span className="text-[8px] font-bold text-white/40 uppercase tracking-tighter">Confidence Index</span>
                </div>
              </div>
              <div className="w-48 h-1.5 bg-[var(--surface)]/10 rounded-full mt-4 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${avgIntegrity}%` }}
                  className="h-full bg-indigo-500"
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[var(--surface)] p-6 sm:p-8 rounded-[32px] border border-[var(--line)] flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center border', atRiskCount > 0 ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-[var(--ink)] text-[var(--muted)] border-[var(--line)]')}>
                <ShieldAlert aria-hidden="true" size={22} />
              </div>
              <span className="text-xs font-black text-[var(--muted)] uppercase tracking-[0.2em]">Asset Risk</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl md:text-5xl font-black text-[var(--text)]">{atRiskCount}</span>
              <span className={cn('text-xs font-black uppercase tracking-widest', atRiskCount > 0 ? 'text-rose-500' : 'text-[var(--muted)]')}>At Risk</span>
            </div>
          </div>
          <div className="pt-4 border-t border-[var(--line)]/50">
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-2">Primary Risk Vector</p>
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-full', economicItems.some(i => i.anomaly) ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500')} />
              <span className="text-[10px] font-black text-[var(--text)] uppercase">
                {economicItems.some(i => i.anomaly) ? 'Anomalous Price Drift' : 'Optimal Sourcing'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tax category">
            {(['', ...TAX_CATEGORIES.map(c => c.id)] as const).map(id => (
              <button
                key={id || 'all-tax-categories'}
                type="button"
                aria-pressed={taxCategoryFilter === id}
                onClick={() => setTaxCategoryFilter(id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                  taxCategoryFilter === id ? 'bg-[var(--text)] text-[var(--surface)] border-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]',
                )}
              >
                {id ? taxCategoryLabel(id) : 'All tax categories'}
              </button>
            ))}
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              {['', ...categories].map(c => (
                <button
                  key={c || 'all'}
                  type="button"
                  aria-pressed={categoryFilter === c}
                  onClick={() => setCategoryFilter(c)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                    categoryFilter === c ? 'bg-[var(--text)] text-[var(--surface)] border-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]',
                  )}
                >
                  {c || 'All categories'}
                </button>
              ))}
              {canChangeStock && (
                <button type="button" onClick={() => setIsManagingCategories(true)} className="px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-700 hover:underline">
                  Manage categories
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {canChangeStock && (
        <InlineAdd
          label="New item name"
          placeholder="Add an item: type a name and press Enter, then fill in price and cost in the list"
          existing={items.map(i => i.name)}
          onAdd={quickAddItem}
        />
      )}

      <div className="bg-[var(--surface)] rounded-[32px] border border-[var(--line)] p-3 sm:p-4 overflow-hidden shadow-sm">
        <TanStackDataGrid
          caption="Inventory items"
          data={displayItems}
          columns={inventoryColumns}
          totalCount={items.length}
          loading={loading}
          loadingWhat="inventory items"
          loadingState={<LoadingState what="inventory items" />}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          manualFilter
          searchLabel="Search inventory by SKU or item"
          searchPlaceholder="Scan sku or entity DNA..."
          pageSize={50}
          hidePaginationOnSinglePage
          columnScope="inventory-items"
          columnLabel="Inventory"
          columnNames={['Item / SKU', 'Category', 'Stock Level', 'Unit Cost', 'Unit Price', 'Actions']}
          mobileLayout="cards"
          renderCard={item => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ItemImageThumb itemId={item.id} itemName={item.name} workspaceId={item.workspaceId || workspaceId || ''} refreshKey={imageRefresh[item.id] || 0} />
                  <div className="min-w-0">
                    <InlineEdit
                      value={item.name}
                      label={`Name of ${item.name}`}
                      canEdit={canChangeStock}
                      validate={v => (String(v) ? null : 'An item needs a name')}
                      onSave={v => saveItemField(item, 'name', v)}
                      className="text-sm font-black text-[var(--text)] block"
                    />
                    <span className="text-[11px] text-[var(--muted)]">{item.sku || item.category || 'General'}</span>
                    {isBundle(item) && (
                      <p className="text-[10px] text-[var(--muted)] font-semibold">
                        Bundle · {bundleSummary(item, items)}{item.assembleOnDemand ? ` · ${kitBuildableSummary(item, items)}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-emerald-600 font-mono tabular-nums">{formatCurrency(item.unitPriceCents)}</div>
                  <div className={cn('text-xs font-mono font-bold', item.quantityAtHand <= item.reorderPoint ? 'text-rose-600' : 'text-[var(--muted)]')}>
                    Qty: {item.quantityAtHand}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-[var(--line)]">
                {item.quantityAtHand > 0 && (
                  <button
                    type="button"
                    onClick={() => setCogsItem(item)}
                    className="min-h-11 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <ShoppingCart aria-hidden="true" size={14} />
                    COGS
                  </button>
                )}
                {canChangeStock && (
                  <button
                    type="button"
                    aria-label={`Adjust stock of ${item.name}`}
                    disabled={!canPostStock}
                    onClick={() => { if (canPostStock) setAdjustItem(item); }}
                    className="min-h-11 min-w-11 p-2 hover:bg-[var(--elevated)] rounded-xl border border-[var(--line)] inline-flex items-center justify-center"
                  >
                    <SlidersHorizontal aria-hidden="true" size={16} className="text-[var(--muted)]" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Stock history of ${item.name}`}
                  onClick={() => setHistoryItem(item)}
                  className="min-h-11 min-w-11 p-2 hover:bg-[var(--elevated)] rounded-xl border border-[var(--line)] inline-flex items-center justify-center"
                >
                  <History aria-hidden="true" size={16} className="text-[var(--muted)]" />
                </button>
                <button
                  type="button"
                  aria-label={`Edit item ${item.name}`}
                  onClick={() => setEditingItem(item)}
                  className="min-h-11 min-w-11 p-2 hover:bg-[var(--elevated)] rounded-xl border border-[var(--line)] inline-flex items-center justify-center"
                >
                  <Edit2 aria-hidden="true" size={16} className="text-[var(--muted)]" />
                </button>
                <ConfirmButton
                  aria-label={`Delete ${item.name}`}
                  onConfirm={async () => handleDelete(item.id)}
                  confirmMessage="Are you sure you want to delete this inventory item?"
                  className="min-h-11 min-w-11 p-2 hover:bg-rose-50 rounded-xl border border-[var(--line)] text-rose-500 inline-flex items-center justify-center"
                >
                  <Trash2 aria-hidden="true" size={16} />
                </ConfirmButton>
              </div>
            </div>
          )}
          getRowProps={() => ({ className: 'group' })}
          emptyState={(
            <EmptyState
              title="No items yet"
              description="Items are what you sell or buy — stock, services, parts. Each can carry price, cost and stock level."
              actionLabel={canChangeStock ? 'Add your first item' : undefined}
              onAction={canChangeStock ? () => setIsAdding(true) : undefined}
            />
          )}
          filteredEmptyState={(
            <EmptyState
              title="No items match these filters"
              description="Choose another search, category or tax category above to widen the list."
            />
          )}
        />
      </div>

      {items.some(isConsignment) && (
        <div className="mt-10">
          <ConsignmentStockPanel items={items} currency={baseCurrency} />
        </div>
      )}

      <InventoryItemDialog key={editingItem?.id || 'new-item'} open={isAdding || !!editingItem} editingItem={editingItem} categories={categories} canChangeStock={canChangeStock} taxCodes={salesTaxCodes} allItems={items} stockActionsAvailable={!isGuest}
        onClose={closeItemDialog} onSubmit={editingItem ? handleUpdate : handleAdd}
        onItemImageChange={itemId => setImageRefresh(current => ({ ...current, [itemId]: (current[itemId] || 0) + 1 }))}
        onAdjust={it => { if (canPostStock) { setEditingItem(null); setAdjustItem(it); } }}
        onRevalue={canRevalue ? it => setRevalueItem(it) : undefined} />

      {cogsItem && workspaceId && (
        <CogsDialog item={cogsItem} workspaceId={workspaceId} accounts={accounts} currency={baseCurrency} onClose={() => setCogsItem(null)} />
      )}
      {canPostStock && adjustItem && workspaceId && (
        <StockAdjustDialog item={adjustItem} workspaceId={workspaceId} accounts={accounts} currency={baseCurrency} onClose={() => setAdjustItem(null)} />
      )}
      {revalueItem && workspaceId && (
        <StockRevalueDialog item={revalueItem} workspaceId={workspaceId} accounts={accounts} currency={baseCurrency} onClose={() => setRevalueItem(null)} />
      )}
      {historyItem && workspaceId && (
        <StockHistoryDialog item={historyItem} workspaceId={workspaceId} currency={baseCurrency} onClose={() => setHistoryItem(null)} />
      )}
      {isManagingCategories && (
        <CategoryManagerDialog items={items} onClose={() => setIsManagingCategories(false)} />
      )}
      {canPostStock && isCounting && workspaceId && (
        <StockCountDialog items={items} workspaceId={workspaceId} accounts={accounts} currency={baseCurrency} onClose={() => setIsCounting(false)} />
      )}
    </div>
  );
}
