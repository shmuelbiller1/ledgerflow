import { useDialog } from '../../hooks/useDialog';
import { useLedgerStore } from '../../stores/useLedgerStore';
import React, { useState, useMemo } from 'react';
import { User } from '../../lib/db/auth';
import { ChartAccount, TaxRate } from '../../types';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { 
  Receipt, 
  Calculator, 
  Download, 
  Plus,
  Trash2,
  Edit2,
  Activity,
  Layers,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, workspaceYearMonth } from '../../lib/utils';
import { civilYear } from '../../lib/calendarDate';
import { isPostable, lineAmount } from '../../lib/txFilters';
import AsyncButton from '../ui/AsyncButton';
import InlineEdit from '../ui/InlineEdit';
import { EmptyState } from '../ui/EmptyState';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { safeConfirm } from '../../lib/utils';
import { effectiveRate, TAX_TREATMENTS } from '../../lib/taxCodes';
import type { TaxComponent, TaxTreatment } from '../../lib/taxCodes';
import { isIncomeAccount } from '../../lib/accountUtils';
import { useServerActivity } from '../../hooks/useServerActivity';
import { sumActivity, type ActivityByMonth } from '../../lib/periodActivity';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';

/**
 * L-123 step 3e: the year's gross income, expenses and sales tax from activity per account per month: a line's
 * absolute amount summed over lines is the account's gross debits plus gross credits, and sales tax is the net.
 */
function yearFigures(activity: ActivityByMonth, year: number, accounts: ChartAccount[]) {
  const [from, to] = [`${year}-01`, `${year}-12`];
  const ids = (keep: (a: ChartAccount) => boolean) => new Set(accounts.filter(keep).map(a => a.id));
  const income = ids(a => isIncomeAccount(a));
  const expense = ids(a => a.type === 'expense');
  const salesTax = ids(a => a.name.toLowerCase().includes('sales tax'));
  return {
    grossIncome: sumActivity(activity, from, to, id => income.has(id), a => a.debits + a.credits),
    expenses: sumActivity(activity, from, to, id => expense.has(id), a => a.debits + a.credits),
    salesTaxCollected: sumActivity(activity, from, to, id => salesTax.has(id), a => a.net),
  };
}

const fieldClass = 'w-full px-4 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-[var(--text)]';

/**
 * Add or edit a tax. A sales tax (VAT / GST / sales tax) is a tax code: one or more parts
 * (e.g. GST 5% + PST 7%), a part can be charged on top of the others (compound), and a treatment
 * (taxed, zero-rated, exempt, reverse charge, out of scope). `rate` keeps the total as a fraction
 * for older screens.
 */
function TaxRateForm({ initial, onSave, onCancel }: { initial: TaxRate | null; onSave: (data: Partial<TaxRate>) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState<TaxRate['type']>(initial?.type || 'Sales');
  const [treatment, setTreatment] = useState<TaxTreatment>(initial?.treatment || 'standard');
  const [appliesTo, setAppliesTo] = useState<NonNullable<TaxRate['appliesTo']>>(initial?.appliesTo || 'both');
  const [parts, setParts] = useState<Array<TaxComponent & { key: string }>>(() =>
    (initial?.components?.length ? initial.components : [{ name: initial?.name || 'Tax', rate: Math.round((initial?.rate ?? 0) * 100 * 1000) / 1000 }])
      .map(c => ({ ...c, key: crypto.randomUUID() })));
  const setPart = (key: string, patch: Partial<TaxComponent>) => setParts(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p)));
  const clean = parts.filter(p => p.name.trim() && p.rate >= 0).map(({ key: _key, ...p }) => ({ ...p, name: p.name.trim() }));
  const total = effectiveRate(clean);

  return (
    <form
      aria-labelledby="tax-rate-form-title"
      className="space-y-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || clean.length === 0) return;
        await onSave(type === 'Sales'
          ? { name: name.trim(), type, treatment, appliesTo, components: clean, rate: Math.round(total * 100000) / 100000 }
          : { name: name.trim(), type, rate: (clean[0]?.rate || 0) / 100 });
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="tax-name" className="block text-xs font-semibold mb-1">Name</label>
          <input id="tax-name" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. VAT 20% or GST + PST" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="tax-type" className="block text-xs font-semibold mb-1">Kind</label>
          <select id="tax-type" value={type} onChange={e => setType(e.target.value as TaxRate['type'])} className={fieldClass}>
            <option value="Sales">Sales tax / VAT / GST (on invoices and bills)</option>
            <option value="Income">Income tax (estimate only)</option>
            <option value="Payroll">Payroll tax</option>
          </select>
        </div>
      </div>
      {type === 'Sales' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="tax-treatment" className="block text-xs font-semibold mb-1">How it is reported</label>
            <select id="tax-treatment" value={treatment} onChange={e => setTreatment(e.target.value as TaxTreatment)} className={fieldClass}>
              {(Object.keys(TAX_TREATMENTS) as TaxTreatment[]).map(t => <option key={t} value={t}>{TAX_TREATMENTS[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tax-applies" className="block text-xs font-semibold mb-1">Used on</label>
            <select id="tax-applies" value={appliesTo} onChange={e => setAppliesTo(e.target.value as NonNullable<TaxRate['appliesTo']>)} className={fieldClass}>
              <option value="both">Sales and purchases</option>
              <option value="sales">Sales only</option>
              <option value="purchases">Purchases only</option>
            </select>
          </div>
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold">{type === 'Sales' ? 'Parts (a single tax has one part)' : 'Rate'}</legend>
        {parts.slice(0, type === 'Sales' ? parts.length : 1).map((p, n) => (
          <div key={p.key} className="flex items-center gap-2">
            {type === 'Sales' && <input aria-label={`Part ${n + 1} name`} value={p.name} onChange={e => setPart(p.key, { name: e.target.value })} className={`${fieldClass} flex-1`} />}
            <input aria-label={`Part ${n + 1} rate (%)`} type="number" step="0.001" min="0" max="100" value={p.rate} onChange={e => setPart(p.key, { rate: parseFloat(e.target.value || '0') })} className={`${fieldClass} w-28 text-right font-mono`} />
            <span aria-hidden="true">%</span>
            {type === 'Sales' && n > 0 && (
              <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                <input type="checkbox" checked={Boolean(p.compound)} onChange={e => setPart(p.key, { compound: e.target.checked })} /> on top of the others
              </label>
            )}
            {type === 'Sales' && parts.length > 1 && (
              <button type="button" aria-label={`Remove part ${n + 1}`} onClick={() => setParts(ps => ps.filter(x => x.key !== p.key))} className="p-2 text-[var(--muted)]"><Trash2 size={14} aria-hidden="true" /></button>
            )}
          </div>
        ))}
        {type === 'Sales' && (
          <button type="button" onClick={() => setParts(ps => [...ps, { key: crypto.randomUUID(), name: '', rate: 0 }])} className="text-xs font-semibold inline-flex items-center gap-1">
            <Plus size={12} aria-hidden="true" /> Add a part
          </button>
        )}
        {type === 'Sales' && <p className="text-xs text-[var(--muted)]">Total: {(total * 100).toFixed(3).replace(/\.?(?<!0)0+$/, '')}% of the amount before tax{treatment !== 'standard' ? ` · ${TAX_TREATMENTS[treatment]}` : ''}</p>}
      </fieldset>
      <div className="pt-4 flex gap-3 border-t border-[var(--line)]">
        <button type="button" onClick={onCancel} className="flex-1 py-3 border border-[var(--line)] rounded-xl font-semibold">Cancel</button>
        <AsyncButton type="submit" loadingText="Saving…" className="flex-[2] py-3 bg-[var(--brass)] text-[var(--ink)] rounded-xl font-bold">Save</AsyncButton>
      </div>
    </form>
  );
}

interface TaxManagerProps {
  user?: User | null;
  workspaceId?: string;
  accounts?: ChartAccount[];
  taxRates?: TaxRate[];
  onAddTaxRate?: (data: Partial<TaxRate>) => Promise<void>;
  onUpdateTaxRate?: (id: string, data: Partial<TaxRate>) => Promise<void>;
  onDeleteTaxRate?: (id: string) => Promise<void>;
}

export default function TaxManager({ 
  user: _user,
  workspaceId: _workspaceId = 'default',
  accounts: accountsProp,
  taxRates: taxRatesProp,
  onAddTaxRate: onAddProp,
  onUpdateTaxRate: onUpdateProp,
  onDeleteTaxRate: onDeleteProp
}: TaxManagerProps = {}) {
  const transactions = useLedgerStore(state => state.transactions || []);
  // A-235: the tax figures read the entries and the tax codes
  const dataHealth = useScreenDataHealth(['transactions', 'taxRates', 'accounts']);
  // The screen is opened from the menu with no props: it reads the workspace's own tax codes and
  // accounts and saves through the normal path (it showed no codes and Add/Edit/Delete did
  // nothing before; L-184)
  const storeAccounts = useLedgerStore(state => state.accounts);
  const storeTaxRates = useLedgerStore(state => state.taxRates);
  const accounts = accountsProp ?? storeAccounts;
  const taxRates = taxRatesProp ?? storeTaxRates;
  const { addEntity, updateEntity, deleteEntity } = useEntityOperations();
  const canEdit = useCurrentRole() !== 'viewer';
  const onAddTaxRate = onAddProp ?? (async (data: Partial<TaxRate>) => { await addEntity('taxRates', data, `Tax "${data.name}" added`); });
  const onUpdateTaxRate = onUpdateProp ?? (async (id: string, data: Partial<TaxRate>) => { await updateEntity('taxRates', id, data, 'Tax saved'); });
  const onDeleteTaxRate = onDeleteProp ?? (async (id: string) => {
    const rate = taxRates.find(r => r.id === id);
    if (!safeConfirm(`Delete the tax "${rate?.name || ''}"? Invoices and bills that used it keep their amounts.`)) return;
    await deleteEntity('taxRates', id, 'Tax deleted');
  });
  /** A one-part tax's percentage, edited in place (documents already saved keep their tax). */
  const saveRatePercent = (rate: TaxRate, percent: number) => {
    const components = rate.components?.length === 1 ? [{ ...rate.components[0], rate: percent }] : rate.components;
    return onUpdateTaxRate(rate.id, { rate: Math.round(percent * 1000) / 100000, ...(components ? { components } : {}) });
  };
  
  const [selectedYear, setSelectedYear] = useState(workspaceYearMonth().year);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { dialogProps: taxDialogProps } = useDialog(() => setIsModalOpen(false), isModalOpen);
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [activeTab, setActiveTab] = useState<'rates' | 'contractors' | 'reporting'>('rates');
  const [includeSE, setIncludeSE] = useState(false);
  
  // L-123 step 3e: when the loaded entries are capped and the year reaches before them, the server's sums
  const { activity, serverMonths } = useServerActivity(`${selectedYear}-01-01`, `${selectedYear}-12-31`);
  const taxMetrics = useMemo(() => {
    const fromServer = serverMonths ? yearFigures(activity, selectedYear, accounts) : null;
    const yearTransactions = (transactions || []).filter(tx => isPostable(tx) && civilYear(tx.date) === selectedYear);
    const accountById = new Map(accounts.map(a => [a.id, a]));
    
    const grossIncome = fromServer ? fromServer.grossIncome : yearTransactions
      .reduce((acc, tx) => {
        const incomeLines = tx.lines?.filter(l => isIncomeAccount(accountById.get(l.accountId))) || [];
        // Typically income lines are negative in a ledger (Credit)
        return acc + incomeLines.reduce((sum, l) => sum + Math.abs(lineAmount(l, tx)), 0);
      }, 0);

    const expenses = fromServer ? fromServer.expenses : yearTransactions
      .reduce((acc, tx) => {
        const expenseLines = tx.lines?.filter(l => accountById.get(l.accountId)?.type === 'expense') || [];
        return acc + expenseLines.reduce((sum, l) => sum + Math.abs(lineAmount(l, tx)), 0);
      }, 0);

    const netProfit = grossIncome - expenses;
    
    const incomeTaxConfig = taxRates.find(r => r.type === 'Income');
    
    let effectiveTaxRate = incomeTaxConfig?.rate ?? 0.21;
    if (incomeTaxConfig?.timeSeries && incomeTaxConfig.timeSeries.length > 0) {
      try {
        // Evaluate the tax rate specifically for the end of the selected fiscal year
        effectiveTaxRate = TruthEngine.resolveEffectiveValue(incomeTaxConfig.timeSeries, `${selectedYear}-12-31`);
      } catch (err) {
        console.warn('Temporal Integrity resolution failed for tax rate, falling back to static rate', err);
      }
    }

    let seTax = 0;
    if (includeSE && netProfit > 0) {
      const seEarnings = netProfit * 0.9235;
      seTax = seEarnings * 0.153;
    }
    const taxableIncome = Math.max(0, netProfit - (seTax * 0.5));
    const incomeTax = taxableIncome * effectiveTaxRate;
    const estimatedTax = netProfit > 0 ? incomeTax + seTax : 0; 

    const salesTaxCollected = fromServer ? fromServer.salesTaxCollected : yearTransactions
      .flatMap(tx => (tx.lines || []).map(l => ({ line: l, tx })))
      .filter(({ line }) => accountById.get(line.accountId)?.name.toLowerCase().includes('sales tax'))
      .reduce((acc, { line, tx }) => acc + lineAmount(line, tx), 0);

    return {
      grossIncome,
      expenses,
      netProfit,
      estimatedTax,
      salesTaxCollected
    };
  }, [transactions, selectedYear, accounts, taxRates, includeSE, serverMonths, activity]);

  return (
    <div className="space-y-12 p-4 md:p-6 lg:p-10 w-full max-w-[1550px] mx-auto pb-20 animate-in fade-in duration-500">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this screen" />
      {/* Rule Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-[var(--line)] pb-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-[var(--muted)] uppercase tracking-widest truncate mb-2">
            <Receipt size={24} className="text-slate-600" />
            Fiscal Compliance Protocol
          </div>
          <h1 className="text-3xl font-black text-[var(--text)] tracking-tight uppercase font-display">Tax Reserve Estimator</h1>
          <p className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider mt-1">Rough tax reserve estimate — not tax advice. Confirm with your accountant.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
             <select 
               aria-label="Tax reserve fiscal year"
               value={selectedYear}
               onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
               className="px-6 py-3.5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] text-[10px] font-black uppercase tracking-widest text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all appearance-none cursor-pointer pr-10 shadow-sm"
             >
               {[2023, 2024, 2025, 2026].map(year => (
                 <option key={year} value={year}>{year} Fiscal Domain</option>
               ))}
             </select>
          </div>
          <div className="min-w-0 space-y-1"><button className="disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2 px-6 py-3.5 bg-[var(--brass)] text-[var(--ink)] rounded-[32px] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all active:scale-95 shadow-md cursor-pointer" type="button" disabled aria-describedby="fiscal-export-help" title="Fiscal export is not available. Review the tax reports before preparing a filing." aria-label="Fiscal Export">
            <Download size={16} />
            Fiscal Export
          </button>
            <p id="fiscal-export-help" className="text-xs text-[var(--muted)] max-w-sm">Fiscal export is not available. Review the tax reports before preparing a filing.</p></div>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex flex-wrap items-center gap-2 p-2 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] w-fit shadow-sm">
        <button
          onClick={() => setActiveTab('rates')}
          className={cn(
            "px-6 py-3 rounded-[32px] text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer active:scale-95",
            activeTab === 'rates' ? "bg-[var(--brass)] text-[var(--ink)] font-bold shadow-md" : "text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          Federal Rates & Provisions
        </button>
        
        
      </div>

      {(
        <>
          {/* Deterministic Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="p-6 md:p-8 bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-sm relative overflow-hidden group">
          <div className="absolute technical-grid inset-0 opacity-[0.02] pointer-events-none" />
          <div className="flex justify-between items-start relative z-10 mb-4">
            <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">Estimated Liability</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeSE} onChange={e => setIncludeSE(e.target.checked)} className="accent-[var(--brass)] w-3 h-3 cursor-pointer" />
              <span className="text-[9px] font-black text-[var(--text)] uppercase tracking-widest">Incl. SE Tax</span>
            </label>
          </div>
          <p className="text-3xl md:text-4xl font-black text-[var(--text)] font-mono tracking-tighter relative z-10 tabular-nums">
            {formatCurrency(taxMetrics.estimatedTax)}
          </p>
          <div className="mt-4 flex items-center gap-2 text-[9px] font-black text-[var(--brass)] uppercase tracking-widest bg-[var(--brass-soft)] p-2 rounded-lg border border-[var(--brass-line)] w-fit">
             <Calculator size={12} />
             Basis: {((taxMetrics.estimatedTax / Math.max(1, taxMetrics.netProfit)) * 100).toFixed(1)}% Eff. Factor
          </div>
        </div>

        <div className="p-6 md:p-8 bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-sm relative overflow-hidden group">
          <div className="absolute technical-grid inset-0 opacity-[0.02] pointer-events-none" />
          <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-4 relative z-10">Indirect Provisioning</p>
          <p className="text-3xl md:text-4xl font-black text-[var(--text)] font-mono tracking-tighter relative z-10 tabular-nums">
            {formatCurrency(taxMetrics.salesTaxCollected)}
          </p>
          <div className="mt-4 flex items-center gap-2 text-[9px] font-black text-[var(--pos)] uppercase tracking-widest bg-[var(--pos)]/10 p-2 rounded-lg border border-[var(--pos)]/20 w-fit">
             <ShieldCheck size={12} />
             100% Locked for Filing
          </div>
        </div>

        <div className="p-6 md:p-8 bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-sm relative overflow-hidden group">
          <div className="absolute technical-grid inset-0 opacity-[0.02] pointer-events-none" />
          <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-4 relative z-10">Fiscal Period Yield</p>
          <p className="text-3xl md:text-4xl font-black text-[var(--text)] font-mono tracking-tighter relative z-10 tabular-nums">
            {formatCurrency(taxMetrics.netProfit)}
          </p>
          <div className="mt-4 flex items-center gap-2 text-[9px] font-black text-[var(--muted)] uppercase tracking-widest bg-[var(--ink)] p-2 rounded-lg border border-[var(--line)] w-fit">
             <Activity size={12} />
             Net Taxable Momentum
          </div>
        </div>

        <div className="p-6 md:p-8 bg-slate-900 text-white rounded-[32px] shadow-xl relative overflow-hidden group border border-slate-800">
          <div className="absolute technical-grid inset-0 opacity-[0.03] pointer-events-none" />
          <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-4 relative z-10">Audit Deadline</p>
          <p className="text-3xl md:text-4xl font-black text-amber-400 tracking-tighter font-display relative z-10">April 15</p>
          <div className="mt-4 flex items-center gap-2 text-[9px] font-black text-amber-400 uppercase tracking-widest bg-amber-500/10 p-2 rounded-lg border border-amber-500/20 w-fit">
             <Zap size={12} />
             T-Minus 84d Critical
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Rate Matrix */}
        <div className="lg:col-span-4 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[var(--text)] tracking-tight uppercase font-display">Rate Protocols</h2>
            {canEdit && <button type="button" aria-label="New tax"
              onClick={() => {
                setEditingRate(null);
                setIsModalOpen(true);
              }}
              className="w-10 h-10 bg-slate-900 text-white rounded-[32px] flex items-center justify-center hover:bg-slate-800 transition-all shadow-md active:scale-95"
            >
              <Plus aria-hidden="true" size={18} />
            </button>}
          </div>

          <div className="space-y-4">
            {taxRates.length === 0 && (
              <EmptyState
                title="No tax codes yet"
                description={canEdit ? 'Add the sales, purchase, income, or payroll tax codes used in this workspace.' : 'No tax codes are configured. Ask an owner or accountant to add one.'}
                actionLabel={canEdit ? 'Add first tax code' : undefined}
                onAction={canEdit ? () => { setEditingRate(null); setIsModalOpen(true); } : undefined}
              />
            )}
            {taxRates.map(rate => (
              <motion.div 
                key={rate.id}
                whileHover={{ x: 4 }}
                className="p-6 bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-sm relative overflow-hidden group hover:border-slate-300 transition-all"
              >
                <div className="absolute technical-grid inset-0 opacity-[0.02] pointer-events-none" />
                <div className="flex items-center justify-between relative z-10">
                  <div className="space-y-1">
                    <InlineEdit value={rate.name} label={`Name of tax ${rate.name}`} canEdit={canEdit}
                      validate={v => (String(v).trim() ? null : 'A tax needs a name')} onSave={v => onUpdateTaxRate(rate.id, { name: String(v) })}
                      className="text-sm font-black text-[var(--text)] leading-none uppercase tracking-tight" />
                    <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">{rate.type} Classification</p>
                  </div>
                  <div className="text-right">
                    {/* one-part taxes: type a new percentage; taxes with several parts change in the dialog */}
                    <InlineEdit kind="number" value={Math.round(rate.rate * 100000) / 1000} label={`Rate of tax ${rate.name} (%)`}
                      canEdit={canEdit && (rate.components?.length ?? 0) <= 1}
                      display={`${(rate.rate * 100).toFixed(rate.components?.some(c => !Number.isInteger(c.rate)) ? 3 : 1)}%`}
                      validate={v => (Number(v) >= 0 && Number(v) <= 100 ? null : 'Between 0 and 100')}
                      onSave={v => saveRatePercent(rate, Number(v))}
                      className="text-2xl font-black font-mono text-[var(--text)] tracking-tighter" />
                    {rate.components && rate.components.length > 1 && <p className="text-[10px] text-[var(--muted)]">{rate.components.map(c => `${c.name} ${c.rate}%${c.compound ? ' (on top)' : ''}`).join(' + ')}</p>}
                    {rate.treatment && rate.treatment !== 'standard' && <p className="text-[10px] text-[var(--muted)]">{TAX_TREATMENTS[rate.treatment]}</p>}
                    <div className="flex items-center justify-end gap-3 mt-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                      {canEdit && <button type="button" aria-label={`Edit tax ${rate.name}`} onClick={() => { setEditingRate(rate); setIsModalOpen(true); }} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"><Edit2 aria-hidden="true" size={14} /></button>}
                      {canEdit && <button type="button" aria-label={`Delete tax ${rate.name}`} onClick={() => { void onDeleteTaxRate(rate.id); }} className="text-[var(--muted)] hover:text-rose-500 transition-colors"><Trash2 aria-hidden="true" size={14} /></button>}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Forensic Breakdown */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[var(--text)] tracking-tight uppercase font-display">Liability Mapping</h2>
            <div className="flex items-center gap-2 text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">
               <Layers size={14} />
               Cross-Analysis active
            </div>
          </div>

          <div className="bg-[var(--surface)] rounded-[32px] border border-[var(--line)] overflow-hidden shadow-sm relative group">
            <div className="absolute technical-grid inset-0 opacity-[0.01] pointer-events-none" />
            <div className="overflow-x-auto" role="region" aria-label="Tax liability accounts" tabIndex={0}>
              <table className="w-full text-left relative z-10 min-w-[700px]">
                <caption className="sr-only">Tax liability accounts</caption>
              <thead>
                <tr className="bg-[var(--ink)] border-b border-[var(--line)]">
                  <th scope="col" className="px-6 py-5 text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">Protocol Domain</th>
                  <th scope="col" className="px-6 py-5 text-[10px] font-black text-[var(--muted)] uppercase tracking-widest text-right">Basis</th>
                  <th scope="col" className="px-6 py-5 text-[10px] font-black text-[var(--muted)] uppercase tracking-widest text-center">Metric</th>
                  <th scope="col" className="px-6 py-5 text-[10px] font-black text-[var(--text)] uppercase tracking-widest text-right bg-[var(--ink)]">Apportionment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-[var(--ink)]/50 transition-all group/row">
                  <td className="px-6 py-6">
                    <p className="text-sm font-black text-[var(--text)] tracking-tight uppercase">Federal Corporate Levy</p>
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-1 font-mono">IRC SEC 11 COMPLIANT</p>
                  </td>
                  <td className="px-6 py-6 text-right font-mono text-sm font-black text-[var(--text)] tabular-nums">
                    {formatCurrency(taxMetrics.netProfit)}
                  </td>
                  <td className="px-6 py-6 text-center">
                    <div className="inline-flex h-7 items-center px-3 bg-[var(--ink)] rounded-lg text-[9px] font-black text-[var(--muted)] uppercase tracking-widest border border-[var(--line)]">NET_YIELD</div>
                  </td>
                  <td className="px-6 py-6 text-right font-mono text-base font-black text-[var(--text)] bg-[var(--ink)]/50 group-hover/row:bg-[var(--ink)] tabular-nums">
                    {formatCurrency(taxMetrics.netProfit > 0 ? taxMetrics.netProfit * (taxRates.find(r => r.type === 'Income')?.rate ?? 0.21) : 0)}
                  </td>
                </tr>
                {includeSE && (
                <tr className="hover:bg-[var(--ink)]/50 transition-all group/row">
                  <td className="px-6 py-6">
                    <p className="text-sm font-black text-[var(--text)] tracking-tight uppercase">Self-Employment Tax</p>
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-1 font-mono">SECA PROVISION (15.3%)</p>
                  </td>
                  <td className="px-6 py-6 text-right font-mono text-sm font-black text-[var(--text)] tabular-nums">
                    {formatCurrency(taxMetrics.netProfit)}
                  </td>
                  <td className="px-6 py-6 text-center">
                    <div className="inline-flex h-7 items-center px-3 bg-[var(--ink)] rounded-lg text-[9px] font-black text-[var(--muted)] uppercase tracking-widest border border-[var(--line)]">NET_YIELD</div>
                  </td>
                  <td className="px-6 py-6 text-right font-mono text-base font-black text-[var(--text)] bg-[var(--ink)]/50 group-hover/row:bg-[var(--ink)] tabular-nums">
                    {formatCurrency(taxMetrics.netProfit > 0 ? taxMetrics.netProfit * 0.153 : 0)}
                  </td>
                </tr>
                )}
                <tr className="hover:bg-[var(--ink)]/50 transition-all group/row">
                  <td className="px-6 py-6">
                    <p className="text-sm font-black text-[var(--text)] tracking-tight uppercase">Indirect Consumption Flow</p>
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-1 font-mono">SALES & USE PASS-THROUGH</p>
                  </td>
                  <td className="px-6 py-6 text-right font-mono text-sm font-black text-[var(--text)] tabular-nums">
                    {formatCurrency(taxMetrics.salesTaxCollected)}
                  </td>
                  <td className="px-6 py-6 text-center">
                    <div className="inline-flex h-7 items-center px-3 bg-[var(--ink)] rounded-lg text-[9px] font-black text-[var(--muted)] uppercase tracking-widest border border-[var(--line)]">GROSS_FLOW</div>
                  </td>
                  <td className="px-6 py-6 text-right font-mono text-base font-black text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30 group-hover/row:bg-emerald-50 dark:group-hover/row:bg-emerald-950/50 tabular-nums">
                    {formatCurrency(taxMetrics.salesTaxCollected)}
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Persistence Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div {...taxDialogProps} aria-labelledby="tax-rate-form-title" className="fixed inset-0 z-[600] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-[var(--surface)] rounded-[32px] shadow-2xl border border-[var(--line)] overflow-hidden p-8 md:p-12"
            >
              <div className="flex items-center justify-between mb-6">
                 <h2 id="tax-rate-form-title" className="text-xl font-bold text-[var(--text)]">{editingRate ? 'Edit tax' : 'New tax'}</h2>
                 <button type="button" aria-label="Close" onClick={() => setIsModalOpen(false)} className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--muted)] border border-[var(--line)]">
                    <Plus size={20} className="rotate-45" aria-hidden="true" />
                 </button>
              </div>
              <TaxRateForm
                initial={editingRate}
                onCancel={() => setIsModalOpen(false)}
                onSave={async (data) => {
                  if (editingRate) await onUpdateTaxRate(editingRate.id, data);
                  else await onAddTaxRate(data);
                  setIsModalOpen(false);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
