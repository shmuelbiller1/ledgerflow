import ChartFrame, { ChartTooltip } from '../charts/ChartFrame';
import { D3LedgerVisualizer } from './D3LedgerVisualizer';
import { CHANNELS } from './intelligenceChannels';
import { ProjectProfitMatrix } from './ProjectProfitMatrix';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, Tooltip } from 'recharts';
import { ShieldCheck, Target, Download, Maximize2, Minimize2, BrainCircuit, Info, ChevronRight, Sparkles, Menu, X, Search, Calendar, Flame, Loader2 } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuditTelemetry } from '../../hooks/useAuditTelemetry';

import { useUIStore } from '../../stores/useUIStore';
import { useCommandDispatcher } from '../../hooks/useSystemContext';
import ForensicAuditor from '../reporting/ForensicAuditor';
import PivotSheet from '../ledger/PivotSheet';
import BudgetManager from '../planning/BudgetManager';
import TaxManager from '../finance/TaxManager';
import Consolidation from '../finance/Consolidation';
import ToolSandbox from '../platform/ToolSandbox';
import FinancialCalculatorView from './FinancialCalculatorView';
import { FINANCIAL_ALGORITHMS } from '../../lib/financial-algorithms';
import { ANALYTICAL_LENSES_REGISTRY, LENS_COMPONENTS } from '../../config/registry';
import { ViewErrorBoundary } from '../common/ViewErrorBoundary';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

// -------------------------------------------------------------
// Interactive D3 Ledger Volumetric Flow & Activity Visualizer
// -------------------------------------------------------------

// -------------------------------------------------------------
// Core Redesigned Analytical Channels
// -------------------------------------------------------------
export default function AnalyticalCenter() {
  const transactions = useLedgerStore(s => s.transactions);
  const rawAccounts = useLedgerStore(s => s.accounts);
  const computedAccounts = useLedgerStore(s => s.computedAccounts);
  const accounts = useMemo(() => {
    return computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;
  }, [computedAccounts, rawAccounts]);
  const projects = useLedgerStore(s => s.projects);
  useLedgerStore(s => s.bills);
  useLedgerStore(s => s.invoices);
  useLedgerCollections('bills', 'invoices');
  useUIStore(s => s.filterCriteria);
  const { handleAction: onAction } = useCommandDispatcher();
  const passedMetrics = useAuditTelemetry(transactions, accounts);
  
  const activeChannel = useUIStore(state => state.activeIntelChannel);
  const setActiveChannel = useUIStore(state => state.setActiveIntelChannel);
  const [timeRange, setTimeRange] = useState(30);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const language = useUIStore(state => state.language);
  const isFocusMode = useUIStore(state => state.isFocusMode);
  const runningBalances = useLedgerStore(state => state.runningBalances);
  const integrityStatus = useLedgerStore(state => state.integrityStatus);
  const budgets = useLedgerStore(state => state.budgets);
  useLedgerCollections('budgets');
  
  // High efficiency metrics calculations
  const metrics = useAuditTelemetry(transactions, accounts, timeRange, (timeRange === 30) ? passedMetrics : undefined);

  // Active channel attributes lookup
  const activeChannelDef = useMemo(() => {
    for (const group of CHANNELS) {
      const match = group.items.find((item) => item?.id === activeChannel);
      if (match) return match;
    }
    return CHANNELS[0].items[0];
  }, [activeChannel]);

  // Compute stats for Projects
  const projectStats = useMemo(() => {
    return projects.map(p => {
      const metric = runningBalances.projectMetrics[p.id] || { income: 0n, expense: 0n };
      const income = Number(metric.income);
      const expense = Number(metric.expense);
      const profit = (income - expense);
      const margin = income > 0 ? (profit / income) * 100 : 0;
      return { id: p.id, name: p.name, profit: profit / 100, margin, expense: expense / 100 };
    }).sort((a, b) => b.profit - a.profit);
  }, [runningBalances, projects]);

  // Recharts Radar metric calculation elements
  const radarData = useMemo(() => [
    { subject: 'Liquidity', A: Math.min(100, (metrics?.kpis?.currentRatio || 0) * 45), fullMark: 100 },
    { subject: 'Efficiency', A: metrics?.kpis?.yieldEfficiency || 0, fullMark: 100 },
    { subject: 'Margin', A: metrics?.kpis?.grossMargin || 0, fullMark: 100 },
    { subject: 'Velocity', A: Math.min(100, (metrics?.kpis?.cashVelocity || 0) * 55), fullMark: 100 },
    { subject: 'Integrity', A: metrics?.kpis?.complianceScore || 0, fullMark: 100 },
    { subject: 'Stability', A: metrics?.kpis?.healthScore || 0, fullMark: 100 },
  ], [metrics]);

  const filteredChannels = useMemo(() => {
    return CHANNELS.map(g => ({
      ...g,
      items: g.items.filter((i) =>
        i?.label?.en?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        i?.desc?.en?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (i?.label?.he && i.label.he.includes(searchTerm))
      )
    })).filter(g => g.items.length > 0);
  }, [searchTerm]);

  const activeChannelName = activeChannelDef ? ((activeChannelDef.label && (activeChannelDef.label[language] || activeChannelDef.label['en'])) || (activeChannelDef).name || activeChannelDef.id) : '';

  if (!activeChannelDef) {
    return null;
  }

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-[660px] overflow-hidden bg-[var(--surface)] border border-[var(--line)]/80 rounded-[32px] shadow-sm relative text-[var(--text)] font-sans">
      
      {/* -------------------------------------------------------------
          Smart localized CSS adjustment to style nested modules flawlessly
          ------------------------------------------------------------- */}
      <style>{`
        /* Local scrollbar styles & pristine lens containers */
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>

      {/* -------------------------------------------------------------
          1. Sidebar (Master Panel) - Pristine Layout
          ------------------------------------------------------------- */}
      {!isFocusMode && (
        <aside className="lg:w-72 border-r border-[var(--line)] bg-[var(--surface)] hidden lg:flex flex-col h-full overflow-hidden shrink-0">
          
          {/* Executive identity header */}
          <div className="p-4 border-b border-[var(--line)] bg-[var(--panel)] shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-[var(--brass)] text-[var(--ink)] rounded-lg flex items-center justify-center shrink-0 shadow-xs font-bold">
                  <Target aria-hidden="true" size={14} className="stroke-[2.5px]" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-[var(--text)] leading-snug">Advanced Overview</h2>
                  <p className="text-[9px] font-mono font-medium text-[var(--muted)]">Financial Metrics</p>
                </div>
              </div>
              
              {/* Stability Node Pulse */}
              <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full select-none">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                <span className="text-[8px] font-mono font-bold tracking-wide text-emerald-600 uppercase">Live</span>
              </div>
            </div>

            {/* Instant Filter Box */}
            <div className="relative">
              <input aria-label="Search analytics and auditing"
                type="text"
                placeholder="Search analytics & auditing..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full text-xs px-3 py-1.5 pl-8 bg-[var(--surface)] border border-[var(--line)] focus:border-[var(--brass-line)] focus:outline-none rounded-lg transition-all text-[var(--text)] placeholder:text-[var(--faint)]"
              />
              <Search aria-hidden="true" size={12} className="absolute left-2.5 top-2.5 text-[var(--muted)]" />
              {searchTerm && (
                <button type="button" aria-label="Clear search" onClick={() => setSearchTerm('')} className="absolute right-2 top-1.5 text-[var(--muted)] hover:text-[var(--text)] font-mono text-[11px] px-1">
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Categorized Options List as Cards */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar select-none">
            {filteredChannels.map(group => (
              <div key={group.group.en} className="space-y-1">
                <div className="px-2 pb-1 flex items-center justify-between">
                  <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-[var(--muted)] block">
                    {group.group[language] || group.group['en']}
                  </span>
                  <span className="text-[8px] font-mono text-[var(--faint)] font-semibold">{group.items.length} LENSES</span>
                </div>
                
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = activeChannel === item.id;
                    const IconComponent = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveChannel(item.id)}
                        className={cn(
                          "w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 border cursor-pointer group",
                          isActive
                            ? "bg-[var(--brass-soft)] border-[var(--brass-line)] text-[var(--text)] shadow-xs font-semibold"
                            : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                          isActive ? "bg-[var(--brass)] text-[var(--ink)] font-bold" : "bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)] group-hover:text-[var(--text)]"
                        )}>
                          <IconComponent size={12} className="stroke-[2.2px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-[11.5px] leading-none tracking-tight transition-colors", isActive ? "font-bold text-[var(--text)]" : "font-medium text-[var(--text)]")}>
                            {((item).label?.[language] || (item).label?.['en']) || (item).name || item.id}
                          </p>
                          <p className="text-[9px] text-[var(--muted)] mt-1 leading-normal font-medium truncate group-hover:text-[var(--text)] transition-colors">
                            {((item).desc?.[language] || (item).desc?.['en']) || item.description || ''}
                          </p>
                        </div>
                        {isActive && (
                          <div className="w-1 h-3 rounded-full bg-[var(--brass)] shrink-0 self-center" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            
            {filteredChannels.length === 0 && (
              <p className="text-center text-[10px] text-[var(--muted)] font-mono py-6">No specific intelligence lenses matched.</p>
            )}
          </div>
          
          {/* Sidebar Footer with Workspace Stats summary info */}
          <div className="p-3 border-t border-[var(--line)] bg-[var(--panel)] shrink-0 text-[10px] space-y-1 font-mono text-[var(--muted)]">
             <div className="flex items-center justify-between">
               <span>Total Transactions</span>
               <span className="font-bold text-[var(--text)] tabular-nums">{transactions.length} items</span>
             </div>
             <div className="flex items-center justify-between">
               <span>Active Accounts</span>
               <span className="font-bold text-[var(--text)] tabular-nums">{accounts.length} nodes</span>
             </div>
          </div>
        </aside>
      )}

      {/* -------------------------------------------------------------
          2. Main Workspace Detail View (Pristine Canvas)
          ------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0 min-h-full bg-[var(--surface)]">
        
        {/* Dynamic header toolbar */}
        <header className="px-5 py-3 border-b border-[var(--line)] flex items-center justify-between shrink-0 bg-[var(--ink)]/50">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button aria-label="Toggle Menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)} 
              className="lg:hidden p-1.5 border border-slate-250 hover:bg-slate-100 text-slate-600 rounded-lg shrink-0 cursor-pointer"
              title="Toggle Menu"
            >
              <Menu aria-hidden="true" size={14} />
            </button>

            {/* Display active state details */}
            <div className="space-y-0.5">
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold text-indigo-650 uppercase tracking-widest">{(activeChannelDef).badge || "PRO"}</span>
                <ChevronRight aria-hidden="true" size={10} className="text-slate-350" />
                <span className="text-[9px] font-semibold text-slate-450 uppercase tracking-wider">{activeChannelDef.id} lens</span>
              </div>
              <h1 className="text-sm font-bold tracking-tight text-[var(--text)] flex items-center gap-1.5 leading-none">
                <activeChannelDef.icon size={14} className="text-indigo-600 shrink-0" />
                <span>{activeChannelName}</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Time interval selection pills */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-[var(--line)]/80 shrink-0">
              {[30, 90, 365].map(days => (
                <button
                  key={days}
                  onClick={() => setTimeRange(days)}
                  className={cn(
                    "px-2.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider cursor-pointer whitespace-nowrap",
                    timeRange === days ? "bg-[var(--surface)] text-[var(--text)] border border-[var(--line)] shadow-3xs" : "text-[var(--muted)] hover:text-[var(--text)]"
                  )}
                >
                  {days}D
                </button>
              ))}
            </div>

            {/* Minimal focus controller */}
            <button aria-label={isFocusMode ? "Standard Workspace View" : "Maximize Intelligence Lens"}
              onClick={() => onAction?.('toggle-focus-mode')}
              title={isFocusMode ? "Standard Workspace View" : "Maximize Intelligence Lens"}
              className="p-1.5 border border-[var(--line)] hover:bg-[var(--ink)] rounded-lg text-[var(--muted)] hover:text-[var(--text)] shadow-3xs cursor-pointer transition-all shrink-0"
            >
              {isFocusMode ? <Minimize2 aria-hidden="true" size={12} /> : <Maximize2 aria-hidden="true" size={12} />}
            </button>

            {/* Export data trigger */}
            <button 
              onClick={() => onAction?.('export', { transactions })} 
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-indigo-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all shadow-3xs flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Download aria-hidden="true" size={10} />
              <span>Export</span>
            </button>
          </div>
        </header>

        {/* -------------------------------------------------------------
            3. Workspace Canvas View: Unified, single scrolling layer
            ------------------------------------------------------------- */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 custom-scrollbar bg-[var(--ink)]/30 lens-canvas-wrapper">
          
          {isFocusMode && (
            <div className="mb-4 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between gap-3 text-[10.5px] animate-in slide-in-from-top-1 shadow-3xs">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-600"></span>
                </span>
                <span className="font-semibold text-indigo-950">Focused Intelligence Channel Canvas (Sidebar collapsed)</span>
              </div>
              <button 
                onClick={() => onAction?.('toggle-focus-mode')}
                className="text-[9px] font-extrabold uppercase text-indigo-700 hover:text-indigo-950 underline leading-none cursor-pointer"
              >
                Restore Sidebar
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            
            {/* ----------------- HEALTH RADAR OVERVIEW ----------------- */}
            {activeChannel === 'radar' && (
              <motion.div
                key="radar"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-5"
              >
                {/* Re-engineered Bento Grid metrics readout (Highly visual, clean) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  {/* Card 1: Integrity */}
                  <div className="p-4 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs flex flex-col justify-between hover:border-slate-350 transition-colors">
                    <div className="flex items-center justify-between text-[var(--muted)] mb-2">
                      <span className="text-[8.5px] font-bold uppercase tracking-wider text-[var(--muted)]">Data Integrity</span>
                      <ShieldCheck aria-hidden="true" size={14} className="text-emerald-500" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-lg font-black text-[var(--text)] leading-none">
                        {integrityStatus.isConsistent ? 'VERIFIED' : 'VARIANCE'}
                      </p>
                      <p className="text-[9px] text-[var(--muted)] font-mono tracking-tight leading-normal">
                        {transactions.length} secure trace logs
                      </p>
                    </div>
                  </div>

                  {/* Card 2: Enterprise Viability Score */}
                  <div className="p-4 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs flex flex-col justify-between hover:border-slate-350 transition-colors">
                    <div className="flex items-center justify-between text-[var(--muted)] mb-2">
                      <span className="text-[8.5px] font-bold uppercase tracking-wider">Health Score</span>
                      <Sparkles aria-hidden="true" size={14} className="text-indigo-500" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-lg font-black text-[var(--text)] leading-none">
                        {metrics?.kpis?.healthScore || 0}%
                      </p>
                      {/* Metric visual micro-progress bar */}
                      <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                          style={{ width: `${metrics?.kpis?.healthScore || 0}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Cash Solvent Runway */}
                  <div className="p-4 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs flex flex-col justify-between hover:border-slate-350 transition-colors">
                    <div className="flex items-center justify-between text-[var(--muted)] mb-2">
                      <span className="text-[8.5px] font-bold uppercase tracking-wider">Estimated Runway</span>
                      <Calendar aria-hidden="true" size={14} className="text-amber-500" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-lg font-black text-[var(--text)] leading-none whitespace-nowrap">
                        {metrics.kpis.runwayMonths.toFixed(1)} Months
                      </p>
                      <p className="text-[9px] text-[var(--muted)] font-mono tracking-tight leading-normal whitespace-nowrap truncate">
                        At {formatCurrency(Math.round(metrics.kpis.burnRate * 30))}/Mo burn
                      </p>
                    </div>
                  </div>

                  {/* Card 4: Index Volatility */}
                  <div className="p-4 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs flex flex-col justify-between hover:border-slate-350 transition-colors">
                    <div className="flex items-center justify-between text-[var(--muted)] mb-2">
                      <span className="text-[8.5px] font-bold uppercase tracking-wider">Trend Volatility</span>
                      <Flame aria-hidden="true" size={14} className="text-rose-500" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-lg font-black text-[var(--text)] leading-none">
                        {metrics.kpis.volatility.toFixed(1)}%
                      </p>
                      <p className="text-[9px] text-[var(--muted)] font-mono tracking-tight leading-normal">
                        Cashflow trend deviation
                      </p>
                    </div>
                  </div>

                </div>

                {/* Primary Radar grid + Insights (Side-by-Side Bento) */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                  
                  {/* Radar Performance Web Grid */}
                  <div className="xl:col-span-7 bg-[var(--surface)] border border-[var(--line)]/80 rounded-[32px] p-5 flex flex-col justify-between shadow-3xs min-h-[420px]">
                     <div className="pb-3 border-b border-[var(--line)] flex items-center justify-between">
                        <div>
                           <h2 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">Metric Distribution Web</h2>
                           <p className="text-[9px] text-[var(--muted)]">Comparative metrics across baseline dimensions</p>
                        </div>
                     </div>
                     
                     <ChartFrame title="Metric distribution data" rows={radarData.map(row => ({id:row.subject,label:row.subject,A:row.A}))} series={[{key:'A',name:'Metrics View',unit:'number'}]}>
                       {({rows,hidden}) =>
                        <ResponsiveContainer width="100%" height={230}>
                          <RadarChart cx="50%" cy="50%" outerRadius="75%" data={rows}>
                            <Tooltip content={<ChartTooltip series={[{key:'A',name:'Metrics View',unit:'number'}]} />} />
                            <PolarGrid stroke="#f1f5f9" />
                            <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fontWeight: 700, fontFamily: 'Inter', fill: '#64748b' }} />
                            <Radar
                              hide={hidden.has('A')} name="Metrics View"
                              dataKey="A"
                              stroke="#6366f1"
                              fill="#6366f1"
                              fillOpacity={0.06}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                       }
                     </ChartFrame>

                     <div className="pt-3 border-t border-[var(--line)] grid grid-cols-3 gap-2 text-center bg-[var(--ink)]/50 -mx-5 -mb-5 rounded-b-2xl p-3">
                        <div>
                           <p className="text-[8.5px] font-bold text-[var(--muted)] uppercase tracking-wider">Quick Liquidity</p>
                           <p className="text-xs font-bold text-indigo-600 mt-0.5">{(metrics?.kpis?.currentRatio || 0).toFixed(2)}x</p>
                        </div>
                        <div>
                           <p className="text-[8.5px] font-bold text-[var(--muted)] uppercase tracking-wider">Compliance</p>
                           <p className="text-xs font-bold text-emerald-600 mt-0.5">{metrics?.kpis?.complianceScore || 0}%</p>
                        </div>
                        <div>
                           <p className="text-[8.5px] font-bold text-[var(--muted)] uppercase tracking-wider">Yield Factor</p>
                           <p className="text-xs font-bold text-[var(--text)] mt-0.5">{metrics?.kpis?.yieldEfficiency || 0}%</p>
                        </div>
                     </div>
                  </div>

                  {/* Refined clean actionable summary list (Clean typography) */}
                  <div className="xl:col-span-5 bg-[var(--surface)] border border-[var(--line)]/80 rounded-[32px] p-5 shadow-3xs h-[420px] flex flex-col justify-between">
                     <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2.5 border-b border-[var(--line)]">
                          <BrainCircuit aria-hidden="true" size={15} className="text-indigo-600 shrink-0" />
                          <h2 className="text-xs font-extrabold text-[var(--text)] uppercase tracking-wider">Key Metrics Summary</h2>
                        </div>
                        
                        <div className="space-y-3.5">
                           {[
                             { 
                               title: 'Runway Estimate', 
                               text: `Estimated reserves to support ${metrics.kpis.runwayMonths.toFixed(1)} months of activity without adjustments.`, 
                               status: metrics.kpis.runwayMonths < 6 ? 'WARNING' : 'STABLE',
                               color: metrics.kpis.runwayMonths < 6 ? 'border-amber-500' : 'border-emerald-500'
                             },
                             { 
                               title: 'Average Burn Rate', 
                               text: `Average operational burn sits at ${formatCurrency((metrics.kpis.burnRate * 30))}/Mo.`, 
                               status: 'AUDITED',
                               color: 'border-indigo-500'
                             },
                             { 
                               title: 'Anomaly Warnings', 
                               text: metrics.anomalies.length > 0 
                                 ? `Identified ${metrics.anomalies.length} potential balance deviations for forensic protocols.`
                                 : "Zero record integrity deviations found across selected indices.", 
                               status: metrics.anomalies.length > 0 ? 'ALERT' : 'PASS',
                               color: metrics.anomalies.length > 0 ? 'border-rose-500' : 'border-emerald-500'
                             }
                           ].map((item) => (
                             <div key={item.title} className={cn("p-2.5 border-l-2 bg-[var(--ink)]/50 rounded-r-lg space-y-1.5 transition-all hover:bg-[var(--ink)]", item.color)}>
                               <div className="flex items-center justify-between">
                                 <span className="text-[10px] font-bold text-slate-850">{item.title}</span>
                                 <span className="text-[8px] font-mono font-black tracking-wider uppercase bg-[var(--surface)] border px-1.5 py-0.5 rounded-sm text-[var(--muted)]">
                                   {item.status}
                                 </span>
                               </div>
                               <p className="text-[10.5px] font-medium leading-relaxed text-slate-600">
                                 {item.text}
                               </p>
                             </div>
                           ))}
                        </div>
                     </div>

                     <div className="p-3 bg-indigo-50/45 border border-indigo-100/65 rounded-xl flex items-start gap-2.5">
                        <Info aria-hidden="true" size={13} className="text-indigo-600 shrink-0 mt-0.5" />
                        <p className="text-[9.5px] text-indigo-950 font-medium leading-relaxed">
                          Analysis is computed locally based on the transactions and accounts present in the workspace database.
                        </p>
                     </div>
                  </div>

                </div>

                {/* Volumetric Interactive Live Graph */}
                <D3LedgerVisualizer data={transactions} />

              </motion.div>
            )}

            {/* ----------------- ROI PROFITABILITY MATRIX ----------------- */}
            {activeChannel === 'roi' && (
              <ProjectProfitMatrix key="roi" projectStats={projectStats} onAction={onAction} />
            )}

            {/* ----------------- FORENSIC AUDITOR ----------------- */}
            {activeChannel === 'forensics' && (
              <motion.div
                key="forensics"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
              >
                <ForensicAuditor isEmbedded={true} />
              </motion.div>
            )}

            {/* ----------------- ENTITY CONSOLIDATION ----------------- */}
            {activeChannel === 'entities' && (
              <motion.div
                key="entities"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <Consolidation />
              </motion.div>
            )}

            {/* ----------------- PIVOT SHEET ----------------- */}
            {activeChannel === 'pivot' && (
              <motion.div
                key="pivot"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <PivotSheet transactions={transactions} isEmbedded={true} />
              </motion.div>
            )}

            {/* ----------------- BUDGET ANALYSIS ----------------- */}
            {activeChannel === 'budgets' && (
              <motion.div
                key="budgets"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <BudgetManager />
              </motion.div>
            )}

            {/* ----------------- TAX NEXUS & MANAGEMENT ----------------- */}
            {activeChannel === 'nexus' && (
              <motion.div
                key="nexus"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <TaxManager />
              </motion.div>
            )}

            {/* ----------------- FINANCIAL CALCULATORS & LENSES ----------------- */}
            {['breakeven', 'compound', 'rule72', 'ltv', 'npv', 'cac', 'wacc', 'roas', 'caprate', 'ratios', 'ebitda'].includes(activeChannel) && (
              <motion.div
                key={activeChannel}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <FinancialCalculatorView type={activeChannel as React.ComponentProps<typeof FinancialCalculatorView>['type']} />
              </motion.div>
            )}

            {/* ----------------- ALGORITHM TOOL SANDBOX ----------------- */}
            {FINANCIAL_ALGORITHMS[activeChannel] && (
              <ViewErrorBoundary viewName={FINANCIAL_ALGORITHMS[activeChannel]?.name || 'Algorithm Sandbox'}>
                <ToolSandbox 
                  toolId={activeChannel} 
                  toolName={FINANCIAL_ALGORITHMS[activeChannel]?.name || 'Algorithm Sandbox'} 
                  onClose={() => setActiveChannel('radar')} 
                />
              </ViewErrorBoundary>
            )}

            {/* ----------------- DYNAMIC REGISTRY REFERRED LENSES ----------------- */}
            {activeChannel !== 'radar' && activeChannel !== 'roi' && activeChannel !== 'forensics' && activeChannel !== 'entities' && activeChannel !== 'pivot' && activeChannel !== 'budgets' && activeChannel !== 'nexus' && !['breakeven', 'compound', 'rule72', 'ltv', 'npv', 'cac', 'wacc', 'roas', 'caprate', 'ratios', 'ebitda'].includes(activeChannel) && !FINANCIAL_ALGORITHMS[activeChannel] && (() => {
              const lensDef = ANALYTICAL_LENSES_REGISTRY.find(l => l.id === activeChannel);
              if (lensDef && lensDef.componentName) {
                const Component = LENS_COMPONENTS[lensDef.componentName];
                if (Component) {
                  return (
                    <motion.div
                      key={activeChannel}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full"
                    >
                      <ViewErrorBoundary viewName={(lensDef)?.label?.en || lensDef.id || activeChannel}>
                        <React.Suspense fallback={
                          <div className="flex flex-col items-center justify-center p-16 space-y-3 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] min-h-[380px] text-center">
                            <Loader2 aria-hidden="true" className="w-7 h-7 text-indigo-650 animate-spin shrink-0" />
                            <p className="text-[10px] uppercase font-mono font-bold tracking-widest text-[var(--muted)]">Restructuring Lens Component...</p>
                          </div>
                        }>
                          <Component 
                            accounts={accounts} 
                            computedAccounts={accounts} 
                            budgets={budgets} 
                            projects={projects}
                            isEmbedded={true}
                          />
                        </React.Suspense>
                      </ViewErrorBoundary>
                    </motion.div>
                  );
                }
              }
              return (
                <div className="p-4 md:p-8 text-center bg-[var(--surface)] border border-[var(--line)] rounded-[32px]">
                  <p className="text-[var(--muted)] text-xs font-mono">Select a channel lens to align telemetry parameters.</p>
                </div>
              );
            })()}

          </AnimatePresence>
        </div>
      </div>

      {/* -------------------------------------------------------------
          4. Drawer/Sidebar for Mobile Layout Screen sizes
          ------------------------------------------------------------- */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden absolute inset-0 bg-slate-900 z-40"
            />

            {/* Sliding navigation drawer */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="lg:hidden absolute top-0 bottom-0 left-0 w-72 bg-[var(--surface)] z-50 shadow-xl border-r border-slate-250 flex flex-col h-full"
            >
              <div className="p-4 border-b border-[var(--line)] bg-[var(--ink)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1.5">
                  <Target aria-hidden="true" size={14} className="text-indigo-650 stroke-[2.5px]" />
                  <span className="text-xs font-bold text-[var(--text)] tracking-tight">Advanced Overview</span>
                </div>
                <button aria-label="Close intelligence menu"
                  onClick={() => setMobileMenuOpen(false)} 
                  className="p-1 border border-[var(--line)] hover:bg-slate-100 rounded-lg text-[var(--muted)] cursor-pointer"
                >
                  <X aria-hidden="true" size={13} />
                </button>
              </div>

              {/* Channels navigation selector */}
              <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar select-none">
                {CHANNELS.map(group => (
                  <div key={group.group.en} className="space-y-1">
                    <span className="text-[8.5px] font-bold text-[var(--muted)] uppercase tracking-widest px-2 block">
                      {group.group[language] || group.group['en']}
                    </span>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const isActive = activeChannel === item.id;
                        const IconComponent = item.icon;
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              setActiveChannel(item.id);
                              setMobileMenuOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border cursor-pointer text-[11.5px]",
                              isActive
                                ? "bg-[var(--brass)]/15 border-[var(--brass-line)] text-[var(--text)] font-bold"
                                : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--ink)]"
                            )}
                          >
                            <IconComponent size={13} className={cn(isActive ? "text-indigo-600" : "text-[var(--muted)]")} />
                            <span>{((item).label?.[language] || (item).label?.['en']) || (item).name || item.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
