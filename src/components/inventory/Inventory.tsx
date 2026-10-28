import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, safeConfirm } from '../../lib/utils';
import { ConfirmButton } from '../ui/ConfirmButton';
import { toast } from 'sonner';
import { StrategicEngine } from '../../services/strategicEngine';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Package, 
  Plus, 
  Trash2, 
  Search, 
  AlertTriangle,
  Edit2,
  BarChart3,
  ShieldCheck,
  Info,
  Crown,
  Database,
  Zap,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  SlidersHorizontal,
  ClipboardList,
  History
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTimeout } from '../../hooks/useTimeout';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc,
  updateDoc
} from '../../lib/db/firestore';
import { db } from '../../firebase';
import { InventoryItem } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { isPostable } from '../../lib/txFilters';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { defaultOffsetAccount, inventoryAccountsOf } from '../../lib/inventoryAccounts';
import { adjustStockRequest, countStockRequest } from '../../services/stockRequests';
import InlineEdit from '../ui/InlineEdit';
import InlineAdd from '../ui/InlineAdd';
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
import { deleteWithUndo, isDeletePending } from '../../lib/undoableDelete';

export default function Inventory() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
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
  /** A-30: filter the list by the item tax category ('' = every category) */
  const [taxCategoryFilter, setTaxCategoryFilter] = useState('');
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const baseCurrency = useLedgerStore(s => s.baseCurrency) || 'USD';
  const role = useCurrentRole();
  const canChangeStock = role !== 'viewer';
  // ISS-130: revaluing changes book value, so owners and accountants (the server checks the same)
  const canRevalue = role === 'owner' || role === 'accountant';
  // #259 review: a revaluation draft belongs to the workspace it was opened in; after a switch it is not shown
  const [revalueDraft, setRevalueDraft] = useState<{ item: InventoryItem; workspaceId: string | null } | null>(null);
  const revalueItem = revalueDraft && revalueDraft.workspaceId === workspaceId ? revalueDraft.item : null;
  const setRevalueItem = (item: InventoryItem | null) => setRevalueDraft(item ? { item, workspaceId } : null);
  const { setSafeTimeout } = useTimeout();

  useEffect(() => {
    if (!workspaceId || !uid) {
      setSafeTimeout(() => setLoading(false), 0);
      return;
    }

    // every member sees the workspace's items, not only the ones they created (L-174)
    const q = query(
      collection(db, 'inventory'),
      where('workspaceId', '==', workspaceId)
    );

    const unsubInventory = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      // an item waiting out its Undo stays hidden when the live list refreshes (BO-08)
      setItems(data.filter(i => !isDeletePending(`inventory/${i.id}`)));
      setLoading(false);
    }, () => setLoading(false));

    return () => {
      unsubInventory();
    };
  }, [workspaceId, uid, setSafeTimeout]);

  const activeTransactions = useMemo(() => {
    return storeTransactions.filter(isPostable);
  }, [storeTransactions]);

  const economicItems = useMemo(() => {
    return StrategicEngine.analyzeUnitEconomics(items, activeTransactions, accounts);
  }, [items, activeTransactions, accounts]);

  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [imageRefresh, setImageRefresh] = useState<Record<string, number>>({});
  // A-7: the sales tax codes an item can default to (the same list the invoice offers)
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
      // ISS-130: the cost of stock on hand changes only by a revaluation, so the form leaves it alone
      ...((Number(editingItem.quantityAtHand) || 0) > 0 ? {} : { unitCostCents: TruthEngine.parseAmountToCents(formData.get('unitCost') as string) }),
      // the quantity changes only through Adjust stock, a count or a sale, which post to the books
      reorderPoint: parseInt(formData.get('reorderPoint') as string, 10) || 0,
      measurementUnit: formData.get('measurementUnit') as string || undefined,
      unitsPerPackage: formData.get('unitsPerPackage') ? parseInt(formData.get('unitsPerPackage') as string, 10) || 1 : undefined,
      category: formData.get('category') as string,
      // BF-01: an item with stock on hand stays a stock item
      itemType: formData.get('itemType') === 'service' && !editingItem.quantityAtHand ? 'service' : (editingItem.quantityAtHand ? editingItem.itemType || 'stock' : 'stock'),
      // A-7 (CA-16): the default tax code an invoice line for this item fills in
      defaultTaxCodeId: (formData.get('defaultTaxCodeId') as string) || undefined,
      // A-30: the item tax category the state taxability table reads
      productTaxCategory: (formData.get('productTaxCategory') as string) || undefined,
      // A-19: the bundle's parts (empty = an ordinary item)
      bundleParts: parseBundleParts(formData.get('bundleParts')),
      // A-116: built out of its parts when needed (a note only)
      assembleOnDemand: formData.get('assembleOnDemand') === 'on',
      // A-34: the consignment mark (empty = ordinary stock)
      consignment: (formData.get('consignment') as string) || undefined,
      // A-115: minimum/maximum per location (empty = no levels)
      locationLevels: parseLocationLevelsJson(formData.get('locationLevels')),
    };

    try {
      await updateDoc(doc(db, 'inventory', editingItem.id), updates);
      setEditingItem(null);
      toast.success('Inventory item updated');
    } catch {
      toast.error('Failed to update item');
    }
  };

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const newItem: Omit<InventoryItem, 'id'> = {
      uid: uid || "",
      workspaceId: workspaceId || "",
      name: formData.get('name') as string,
      sku: formData.get('sku') as string,
      description: formData.get('description') as string,
      unitPriceCents: TruthEngine.parseAmountToCents(formData.get('unitPrice') as string),
      unitCostCents: TruthEngine.parseAmountToCents(formData.get('unitCost') as string),
      quantityAtHand: 0,
      reorderPoint: parseInt(formData.get('reorderPoint') as string, 10) || 0,
      measurementUnit: formData.get('measurementUnit') as string || undefined,
      unitsPerPackage: formData.get('unitsPerPackage') ? parseInt(formData.get('unitsPerPackage') as string, 10) || 1 : undefined,
      category: formData.get('category') as string,
      itemType: formData.get('itemType') === 'service' ? 'service' : 'stock',
      defaultTaxCodeId: (formData.get('defaultTaxCodeId') as string) || undefined,
      productTaxCategory: (formData.get('productTaxCategory') as string) || undefined,
      bundleParts: parseBundleParts(formData.get('bundleParts')),
      assembleOnDemand: formData.get('assembleOnDemand') === 'on',
      consignment: (formData.get('consignment') as string) || undefined,
      locationLevels: parseLocationLevelsJson(formData.get('locationLevels')),
      createdAt: new Date().toISOString()
    };

    const openingQty = newItem.itemType === 'service' ? 0 : Number(formData.get('quantity')) || 0;
    try {
      const ref = await addDoc(collection(db, 'inventory'), newItem);
      setIsAdding(false);
      if (openingQty > 0) await recordOpeningStock(ref.id, newItem.name, openingQty);
      else toast.success('Inventory item added');
    } catch {
      toast.error('Failed to add item');
    }
  };

  /** Opening stock of a new item: DR Inventory, CR Opening Balance Equity, at the item's cost. */
  const recordOpeningStock = async (itemId: string, name: string, quantity: number) => {
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

  /** Add in place (I-22): a new item by name; price, cost and the rest are filled in the list. */
  const quickAddItem = async (name: string) => {
    await addDoc(collection(db, 'inventory'), {
      uid: uid || '', workspaceId: workspaceId || '', name, sku: '', unitPriceCents: 0, unitCostCents: 0,
      quantityAtHand: 0, reorderPoint: 0, ...(categoryFilter ? { category: categoryFilter } : {}), createdAt: new Date().toISOString(),
    });
    toast.success(`"${name}" added`);
  };

  /** Edit in place (I-22): one field of an item. */
  const saveItemField = async (item: InventoryItem, field: 'name' | 'sku' | 'category' | 'unitPriceCents' | 'unitCostCents', value: string | number) => {
    await updateDoc(doc(db, 'inventory', item.id), { [field]: value, updatedAt: new Date().toISOString() });
    toast.success('Saved');
  };

  /** Typing a new quantity in the list records a stock count, so the books follow (difference to the variance account). */
  const countItem = async (item: InventoryItem, counted: number) => {
    const inventoryAcc = inventoryAccountsOf(accounts)[0];
    const varianceAcc = defaultOffsetAccount(accounts, 'count');
    if (!workspaceId || !inventoryAcc || !varianceAcc) throw new Error('Add an Inventory account and a variance (or Cost of Goods Sold) account first');
    const result = await countStockRequest({ workspaceId, inventoryAccountId: inventoryAcc.id, offsetAccountId: varianceAcc.id, reason: 'Corrected in the inventory list', counts: [{ itemId: item.id, counted }] });
    toast.success(`${item.name}: ${counted} in stock`, { description: `Difference ${formatCurrency(result.valueCents, baseCurrency)} recorded to ${varianceAcc.name}` });
  };

  const handleDelete = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    // stock on hand is asset value: that still needs a clear yes; otherwise Undo is enough (BO-08)
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
      commit: () => deleteDoc(doc(db, 'inventory', id)),
    });
  };

  const categories = useMemo(() => categoryCounts(items).map(c => c.name), [items]);
  const matches = (item: InventoryItem) =>
    (!categoryFilter || (item.category || '').trim() === categoryFilter) &&
    (!taxCategoryFilter || effectiveTaxCategory(item.productTaxCategory) === taxCategoryFilter) &&
    (item.name.toLowerCase().includes(searchTerm.toLowerCase()) || (item.sku || '').toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredItems = items.filter(matches);

  const displayItems = showRuleIntel ? economicItems.filter(matches) : filteredItems as ReturnType<typeof StrategicEngine.analyzeUnitEconomics>;


  const closeItemDialog = () => { setIsAdding(false); setEditingItem(null); };

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 py-6 px-4 border-b border-[var(--line)]/30 mb-10">
        <div className="space-y-4">
          <div className="flex items-center gap-6">
             <div className="w-16 h-16 rounded-[32px] bg-slate-900 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.2)] border border-white/5 group hover:scale-110 transition-transform">
               <Package aria-hidden="true" size={32} className="animate-pulse" />
             </div>
             <div>
                <h1 className="text-4xl md:text-6xl font-display font-black text-[var(--text)] tracking-tight flex items-baseline gap-3">
                  Inventory 
                </h1>
                <div className="flex items-center gap-3">
                   <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
                   <p className="text-[12px] font-black text-[var(--muted)] uppercase tracking-[0.5em] font-mono">Real-time stock management.</p>
                </div>
             </div>
          </div>
          <StockPolicySwitch />
        </div>

        <div className="flex flex-wrap items-center gap-8">
           <div className="relative group">
              <Search aria-hidden="true" className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--muted)] opacity-40 group-focus-within:text-emerald-500 group-focus-within:opacity-100 transition-all" size={20} />
              <input aria-label="Search inventory by SKU or item"
                type="text"
                placeholder="Scan sku or entity DNA..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-14 pr-8 py-4 bg-[var(--surface)] border-2 border-[var(--line)] rounded-[32px] focus:outline-none focus:border-slate-800 focus:shadow-2xl transition-all font-black text-sm uppercase tracking-tight w-full sm:w-[320px] placeholder:text-slate-500/20"
              />
           </div>
           
           <button 
             onClick={() => setShowRuleIntel(!showRuleIntel)}
             className={cn(
               "px-8 py-4 rounded-[32px] font-black text-xs uppercase tracking-widest transition-all border-2 flex items-center gap-3",
               showRuleIntel 
                 ? "bg-slate-900 text-emerald-400 border-slate-800 shadow-2xl scale-105" 
                 : "bg-[var(--surface)] text-[var(--muted)] border-[var(--line)] hover:border-slate-800"
             )}
           >
             <BarChart3 aria-hidden="true" size={18} />
             {showRuleIntel ? "LedgerFlow AI Active" : "Rule Intel"}
           </button>

           <div className="h-12 w-px bg-slate-200 opacity-20 hidden xl:block" />

           {canChangeStock && items.length > 0 && (
             <button
               type="button"
               onClick={() => setIsCounting(true)}
               className="px-8 py-4 rounded-[32px] font-black text-xs uppercase tracking-widest border-2 bg-[var(--surface)] text-[var(--text)] border-[var(--line)] hover:border-slate-800 flex items-center gap-3"
             >
               <ClipboardList aria-hidden="true" size={18} />
               Stock count
             </button>
           )}

           <button 
             onClick={() => setIsAdding(true)}
             className="px-10 py-4 bg-slate-900 text-white rounded-[32px] text-[12px] font-medium uppercase tracking-wider shadow-3xl hover:scale-105 transition-all flex items-center gap-3 border border-white/5 active:scale-95"
           >
              <Plus aria-hidden="true" size={20} />
              Enlist Asset
           </button>
        </div>
      </div>

      {/* Data Chain Integrity Monitor */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 mb-12">
        <div className="xl:col-span-3 bg-zinc-950 p-12 rounded-[32px] text-white flex flex-col md:flex-row items-center justify-between gap-10 border border-white/5 relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:scale-110 transition-transform pointer-events-none">
              <Database aria-hidden="true" size={240} />
           </div>
           <div className="relative z-10 w-full md:w-2/3">
              <div className="flex items-center gap-6 mb-6">
                 <div className="w-16 h-16 bg-[var(--surface)]/10 rounded-[32px] flex items-center justify-center text-white border border-white/5 shadow-2xl">
                    <Zap aria-hidden="true" size={32} />
                 </div>
                 <div>
                    <h2 className="text-3xl font-black uppercase tracking-tighter">Rule Inventory Core</h2>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest truncate italic font-mono">Real-time Data Chain Synthesis Enabled</p>
                 </div>
              </div>
              <p className="text-sm text-white/50 leading-relaxed font-medium">
                 Synthesizing <span className="text-white font-black">{activeTransactions.length}</span> transaction nodes for <span className="text-white font-black">{items.length}</span> SKUs. 
                 The "Core Integrity" engine has cross-referenced historical sourcing, overhead vectors, and market arbitrage with weighted recency bias.
              </p>
           </div>
           <div className="relative z-10 flex flex-col items-center md:items-end w-full md:w-1/3">
              <div className="flex flex-col items-center">
                 <div className="flex items-baseline gap-3">
                    <span className="text-7xl font-black tracking-tighter text-white">
                       {economicItems.length > 0 
                          ? Math.round(economicItems.reduce((acc: number, i: ReturnType<typeof StrategicEngine.analyzeUnitEconomics>[number]) => acc + i.integrityScore, 0) / (economicItems.length || 1))
                          : 0}
                    </span>
                    <div className="flex flex-col">
                       <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Avg. Integrity</span>
                       <span className="text-[8px] font-bold text-white/40 uppercase tracking-tighter">Confidence Index</span>
                    </div>
                 </div>
                 <div className="w-48 h-1.5 bg-[var(--surface)]/10 rounded-full mt-6 overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${economicItems.length > 0 ? Math.round(economicItems.reduce((acc: number, i: ReturnType<typeof StrategicEngine.analyzeUnitEconomics>[number]) => acc + i.integrityScore, 0) / (economicItems.length || 1)) : 0}%` }}
                      className="h-full bg-indigo-600 shadow-[0_0_15px_rgba(251,191,36,0.3)]"
                      transition={{ duration: 2, ease: "easeOut" }}
                    />
                 </div>
              </div>
           </div>
        </div>

        <div className="bg-[var(--surface)] p-12 rounded-[32px] border border-[var(--line)] flex flex-col justify-between shadow-sm group hover:border-rose-400 transition-all">
           <div>
              <div className="flex items-center gap-4 mb-6">
                 <div className="w-12 h-12 bg-rose-50 rounded-[32px] flex items-center justify-center text-rose-500 border border-rose-100">
                    <ShieldAlert aria-hidden="true" size={24} />
                 </div>
                 <span className="text-xs font-black text-[var(--muted)] uppercase tracking-[0.2em]">Asset Risk</span>
              </div>
              <div className="flex items-baseline gap-3">
                 <span className="text-3xl md:text-5xl font-black text-[var(--text)]">
                    {economicItems.filter((i) => i.anomaly || i.resilience === 'Critical').length}
                 </span>
                 <span className="text-xs font-black text-rose-500 uppercase tracking-widest">At Risk</span>
              </div>
           </div>
           <div className="pt-6 border-t border-ledge-line/50">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Primary Risk Vector</p>
              <div className="flex items-center gap-2">
                 <div className={cn(
                    "w-2 h-2 rounded-full animate-pulse",
                    economicItems.some((i) => i.anomaly) ? "bg-rose-500" : "bg-emerald-500"
                 )} />
                 <span className="text-[10px] font-black text-[var(--text)] uppercase">
                    {economicItems.some((i) => i.anomaly) ? "Anomalous Price Drift" : "Optimal Sourcing"}
                 </span>
              </div>
           </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tax category">
        {(['', ...TAX_CATEGORIES.map(c => c.id)] as const).map(id => (
          <button key={id || 'all-tax-categories'} type="button" aria-pressed={taxCategoryFilter === id} onClick={() => setTaxCategoryFilter(id)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
              taxCategoryFilter === id ? 'bg-[var(--text)] text-[var(--surface)] border-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]')}>
            {id ? taxCategoryLabel(id) : 'All tax categories'}
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {['', ...categories].map(c => (
            <button key={c || 'all'} type="button" aria-pressed={categoryFilter === c} onClick={() => setCategoryFilter(c)}
              className={cn('px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                categoryFilter === c ? 'bg-[var(--text)] text-[var(--surface)] border-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]')}>
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

      {canChangeStock && (
        <InlineAdd label="New item name" placeholder="Add an item: type a name and press Enter, then fill in price and cost in the list"
          existing={items.map(i => i.name)} onAdd={quickAddItem} />
      )}
      <div className="bg-[var(--surface)] rounded-[40px] border border-[var(--line)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <caption className="sr-only">Inventory items</caption>
          <thead>
            <tr className="bg-[var(--ink)] border-b border-[var(--line)]">
              <th scope="col" className="px-8 py-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item / SKU</th>
              <th scope="col" className="px-8 py-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Category</th>
              <th scope="col" className="px-8 py-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Stock Level</th>
              <th scope="col" className="px-8 py-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest">{showRuleIntel ? "Rule True Cost" : "Unit Cost"}</th>
              <th scope="col" className="px-8 py-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest">{showRuleIntel ? "Net Margin %" : "Unit Price"}</th>
              <th scope="col" className="px-8 py-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {displayItems.map((item) => (
              <tr key={item.id} className="hover:bg-[var(--ink)]/50 transition-colors group">
                <td className="px-8 py-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <ItemImageThumb itemId={item.id} itemName={item.name} workspaceId={item.workspaceId || workspaceId || ''} refreshKey={imageRefresh[item.id] || 0} />
                    <div className="min-w-0">
                    <InlineEdit value={item.name} label={`Name of ${item.name}`} canEdit={canChangeStock}
                      validate={v => String(v) ? null : 'An item needs a name'} onSave={v => saveItemField(item, 'name', v)}
                      className="text-sm font-black text-[var(--text)] block" />
                    {isBundle(item) && (
                      <p className="text-[10px] text-[var(--muted)] font-semibold" title={bundleSummary(item, items)}>
                        Bundle · {bundleSummary(item, items)}{item.assembleOnDemand ? ` · ${kitBuildableSummary(item, items)}` : ''}
                      </p>
                    )}
                    <InlineEdit value={item.sku} label={`SKU of ${item.name}`} placeholder="Add SKU" canEdit={canChangeStock}
                      onSave={v => saveItemField(item, 'sku', v)} className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block" />
                    </div>
                  </div>
                </td>
                <td className="px-8 py-5">
                  <InlineEdit value={item.category} label={`Category of ${item.name}`} placeholder="General" canEdit={canChangeStock}
                    suggestions={categories} onSave={v => saveItemField(item, 'category', v)}
                    className="px-2 py-1 bg-zinc-100 rounded text-[10px] font-medium uppercase tracking-wider text-zinc-500" />
                </td>
                <td className="px-8 py-5">
                  <div className="flex items-center gap-2">
                    <InlineEdit kind="number" value={item.quantityAtHand} label={`Quantity of ${item.name} (recorded as a stock count)`} canEdit={canChangeStock}
                      validate={v => Number(v) >= 0 ? null : 'Stock cannot be below zero'} onSave={v => countItem(item, Number(v))}
                      className={cn("text-sm font-black font-mono", item.quantityAtHand <= item.reorderPoint ? "text-rose-600" : "text-[var(--text)]")} />
                    {item.quantityAtHand <= item.reorderPoint && (
                      <AlertTriangle aria-hidden="true" size={14} className="text-rose-500 animate-pulse" />
                    )}
                  </div>
                </td>
                <td className="px-8 py-5">
                  {showRuleIntel ? (
                    <div className={cn(!item.isAnalysisAccurate && "opacity-30 grayscale")}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={cn(
                          "text-sm font-black font-mono",
                          item.anomaly ? "text-rose-600" : "text-[var(--text)]"
                        )}>{formatCurrency(item.trueCostCents)}</span>
                        {item.integrityScore > 75 && <ShieldCheck aria-hidden="true" size={12} className="text-emerald-500" />}
                        {item.anomaly && <AlertTriangle aria-hidden="true" size={10} className="text-rose-500" />}
                        {!item.isAnalysisAccurate && <Info aria-hidden="true" size={10} className="text-zinc-400" />}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[8px] text-zinc-400 font-bold uppercase tracking-tighter tabular-nums">
                          Base (Pack): {formatCurrency(item.landedCostStructure.base)}
                        </p>
                        {item.unitsPerPackage && item.unitsPerPackage > 1 && (
                          <p className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter tabular-nums">
                            {formatCurrency(Math.round(item.trueCostCents / item.unitsPerPackage))} / {item.measurementUnit || 'unit'}
                          </p>
                        )}
                        <p className={cn(
                          "text-[8px] font-bold uppercase tracking-tighter",
                          item.landedCostStructure.direct > 0 ? "text-indigo-600" : "text-zinc-300"
                        , "tabular-nums")}>
                          Direct: +{formatCurrency(item.landedCostStructure.direct)}
                        </p>
                        <p className="text-[8px] text-zinc-400 font-bold uppercase tracking-tighter tabular-nums">
                          Indirect: +{formatCurrency(item.landedCostStructure.indirect)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <InlineEdit kind="money" value={item.unitCostCents} display={formatCurrency(item.unitCostCents)} label={`Unit cost of ${item.name}`} canEdit={canChangeStock && !(item.quantityAtHand > 0)}
                        onSave={v => saveItemField(item, 'unitCostCents', v)} className="text-sm font-bold text-zinc-500 font-mono tabular-nums" />
                      {item.quantityAtHand > 0 && canRevalue && <button type="button" onClick={() => setRevalueItem(item)} className="min-h-11 self-start text-[10px] font-semibold text-emerald-700 hover:underline">Revalue {item.name}</button>}
                      {item.unitsPerPackage && item.unitsPerPackage > 1 && (
                        <span className="text-[10px] font-black text-emerald-600 tracking-widest mt-0.5 uppercase tabular-nums">
                          {formatCurrency(Math.round(item.unitCostCents / item.unitsPerPackage))} / {item.measurementUnit || 'unit'}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-8 py-5">
                  {showRuleIntel ? (
                    <div className={cn("flex flex-col gap-1.5", !item.isAnalysisAccurate && "opacity-30")}>
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-1">
                            <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Efficiency</span>
                            {item.isCoreDriver && <Crown aria-hidden="true" size={8} className="text-amber-500" />}
                            {item.anomaly && <AlertTriangle aria-hidden="true" size={8} className="text-rose-500 animate-pulse" />}
                            {item.trajectory > 0 && <TrendingUp aria-hidden="true" size={8} className="text-rose-500" />}
                            {item.trajectory < 0 && <TrendingDown aria-hidden="true" size={8} className="text-emerald-500" />}
                         </div>
                         {item.arbitrage.saving > 0 && item.isAnalysisAccurate && (
                            <span className="text-[8px] font-black text-emerald-600 animate-pulse bg-emerald-50 px-1 rounded tabular-nums">-{formatCurrency(item.arbitrage.saving)} Saving</span>
                         )}
                      </div>
                      <div className={cn(
                        "p-2 rounded-lg border transition-all",
                        item.arbitrage.saving > 0 ? "bg-emerald-50/50 border-emerald-100" : 
                        item.anomaly ? "bg-rose-50/50 border-rose-100" : "bg-zinc-100/50 border-[var(--line)]/50"
                      )}>
                         <div className="flex items-center justify-between gap-4">
                            <span className="text-[9px] font-bold text-zinc-500 truncate max-w-[80px]">{item.arbitrage.bestVendor}</span>
                            <span className="text-xs font-black text-[var(--text)] font-mono italic tabular-nums">
                               {item.arbitrage.bestPrice > 0 ? formatCurrency(item.arbitrage.bestPrice) : "---"}
                            </span>
                         </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-1 flex-1 bg-zinc-100 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-1000",
                              item.integrityScore > 75 ? "bg-emerald-500" : item.integrityScore > 40 ? "bg-amber-500" : "bg-zinc-300"
                            )}
                            style={{ width: `${item.integrityScore}%` }}
                          />
                        </div>
                        <span className="text-[8px] font-black text-zinc-400 uppercase">{item.confidence}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 pt-1 border-t border-[var(--line)]">
                         <div className="flex flex-col">
                            <span className="text-[7px] font-bold text-zinc-400 uppercase">Strategic Value</span>
                            <span className="text-[9px] font-black text-[var(--text)] font-mono">{item.strategicValue.toFixed(1)}</span>
                         </div>
                         <div className="flex flex-col items-center">
                            <span className="text-[7px] font-bold text-zinc-400 uppercase">EOQ</span>
                            <span className="text-[9px] font-black text-indigo-600 font-mono">{item.eoq > 0 ? item.eoq : '---'} units</span>
                         </div>
                         <div className="text-right">
                            <span className="text-[7px] font-bold text-zinc-400 uppercase">Maturity</span>
                            <div className="flex items-center gap-1">
                               <div className="w-12 h-1 bg-zinc-100 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-indigo-600 transition-all duration-1000" 
                                    style={{ width: `${item.maturityIndex}%` }} 
                                  />
                               </div>
                               <span className="text-[8px] font-black font-mono">{item.maturityIndex}</span>
                            </div>
                         </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      <InlineEdit kind="money" value={item.unitPriceCents} display={formatCurrency(item.unitPriceCents)} label={`Price of ${item.name}`} canEdit={canChangeStock}
                        onSave={v => saveItemField(item, 'unitPriceCents', v)} className="text-sm font-black text-emerald-600 font-mono tabular-nums" />
                      {item.unitsPerPackage && item.unitsPerPackage > 1 && (
                        <span className="text-[10px] font-bold text-amber-600 tracking-widest mt-0.5 uppercase tabular-nums">
                          {formatCurrency(Math.round(item.unitPriceCents / item.unitsPerPackage))} / {item.measurementUnit || 'unit'}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-8 py-5 text-right">
                  <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    {item.quantityAtHand > 0 && (
                      <button 
                        onClick={() => setCogsItem(item)}
                        title="Recognize COGS / Record Sale"
                        className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                      >
                        <ShoppingCart aria-hidden="true" size={12} />
                        <span className="hidden lg:inline">COGS</span>
                      </button>
                    )}
                    {canChangeStock && (
                      <button type="button" aria-label={`Adjust stock of ${item.name}`} title="Adjust stock"
                        onClick={() => setAdjustItem(item)}
                        className="p-2 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
                      >
                        <SlidersHorizontal aria-hidden="true" size={14} className="text-[var(--muted)]" />
                      </button>
                    )}
                    <button type="button" aria-label={`Stock history of ${item.name}`} title="Stock history"
                      onClick={() => setHistoryItem(item)}
                      className="p-2 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
                    >
                      <History aria-hidden="true" size={14} className="text-[var(--muted)]" />
                    </button>
                    <button aria-label={`Edit item ${item.name}`}
                      onClick={() => setEditingItem(item)}
                      className="p-2 hover:bg-[var(--surface)] rounded-xl border border-transparent hover:border-[var(--line)] transition-all"
                    >
                      <Edit2 aria-hidden="true" size={14} className="text-zinc-400" />
                    </button>
                    <ConfirmButton 
                      onConfirm={async () => handleDelete(item.id)}
                      confirmMessage="Are you sure you want to delete this inventory item?"
                      className="p-2 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-100 transition-all text-rose-400"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {filteredItems.length === 0 && !loading && (
          <div className="py-20 text-center">
            <Package aria-hidden="true" size={40} className="text-zinc-200 mx-auto mb-4" />
            <p className="text-sm text-zinc-400 font-bold uppercase tracking-widest">No inventory items found</p>
          </div>
        )}
      </div>

      {items.some(isConsignment) && (
        <div className="mt-10">
          <ConsignmentStockPanel items={items} currency={baseCurrency} />
        </div>
      )}

      <InventoryItemDialog key={editingItem?.id || 'new-item'} open={isAdding || !!editingItem} editingItem={editingItem} categories={categories} canChangeStock={canChangeStock} taxCodes={salesTaxCodes} allItems={items}
        onClose={closeItemDialog} onSubmit={editingItem ? handleUpdate : handleAdd}
        onItemImageChange={itemId => setImageRefresh(current => ({ ...current, [itemId]: (current[itemId] || 0) + 1 }))}
        onAdjust={it => { setEditingItem(null); setAdjustItem(it); }}
        onRevalue={canRevalue ? it => setRevalueItem(it) : undefined} />

      {cogsItem && workspaceId && (
        <CogsDialog item={cogsItem} workspaceId={workspaceId} accounts={accounts} currency={baseCurrency} onClose={() => setCogsItem(null)} />
      )}
      {adjustItem && workspaceId && (
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
      {isCounting && workspaceId && (
        <StockCountDialog items={items} workspaceId={workspaceId} accounts={accounts} currency={baseCurrency} onClose={() => setIsCounting(false)} />
      )}
    </div>
  );
}
