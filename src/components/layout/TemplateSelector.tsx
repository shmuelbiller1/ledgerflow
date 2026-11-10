import { useDialog } from '../../hooks/useDialog';
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { BUSINESS_TEMPLATES } from '../../lib/businessTemplates';
import { 
  Briefcase, 
  ShoppingCart, 
  Palette, 
  Factory,
  Utensils,
  Check,
  ArrowRight,
  Cloud,
  Home,
  Heart,
  Sparkles,
  Plus,
  Wand2,
  Layers,
  ShieldCheck,
  Cpu,
  Network,
  Sprout,
  Activity,
  Truck,
  Boxes,
  Hammer,
  Wrench,
  Zap,
  Globe,
  Percent,
  Terminal
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { CustomTemplate } from '../../types';

import { BRAND_NAME } from '../../config/brand';
function withOccurrenceKeys<T>(items: T[], keyForItem: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const contentKey = keyForItem(item);
    const occurrence = occurrences.get(contentKey) ?? 0;
    occurrences.set(contentKey, occurrence + 1);
    return { item, key: JSON.stringify([contentKey, occurrence]) };
  });
}

interface TemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onOpenAI: () => void;
  currentType: string;
  customTemplates?: CustomTemplate[];
  onSaveCurrent?: () => void;
}

const TEMPLATE_FORMULAS: Record<string, string> = {
  saas: "Net Operating Margin = MRR (Subscription Sales) - Platform Fees - Cloud Infrastructure - CAC Offsets",
  retail: "Gross Merchant Margin = Gross Receipts - COGS (Inventory Asset Valuation) - Logistics & Shipping",
  creative: "Project Ledger Yield = Gross Contract Billings - Subcontractor Outlays - Production/Software Licenses",
  realestate: "Net Operating Income (NOI) = Rent Received - Maintenance costs - Aggregated Property Taxes",
  nonprofit: "Fund Allocation Status = (Grants + Donations Received) - Core Program Services - Admin/Operations",
  service: "Service Gross Income = Fixed Fee/Timesheet Revenue - Professional Contractor Labor - Software/Overhead",
  manufacturing: "Cost of Manufactured Goods (COGM) = Raw Materials Overhead + Labor Overhead - Sinking Funds",
  hospitality: "RevPAR Operating Income = Food & Room Bookings - Facility Upkeep - Shift Staff Payroll",
  personal: "Net Cash Flow Position = Combined Income Sources - Living Expenses Savings - Debt Servicing",
  agriculture: "Net Farm Yield = Crop & Livestock Sales + Subsidies - Sourcing (Feed/Seed) - Labor/Fleet OpEx",
  healthcare: "Clinic Gross Operating Profit = Patient Revenue + Insurances - Sourced Supplies - Clinic Salaries",
  logistics: "Fleet Gross Margin = Freight/Logistics Revenue - Diesel & Fuel Costs - Fleet Drivers Payroll",
  subscription_box: "Net Subscriber Contribution = Subscription & Addon Revenue - Sourcing Costs - Shipping & Postage - CAC",
  construction: "Job Gross Profit = Job Contract Billings - Sourced Materials - Subcontractor Outlay - Heavy Equipment Rent",
  automotive: "Shop Operating Margin = Repair Labor + Sourced Parts Markup - Sourced Parts Cost - Mechanic Wages",
  renewable_energy: "Green EBITDA Yield = Energy grid output + Installs + Carbon Credit Trades - Electrician Wages - Interconnection",
  import_export: "Net Trade Yield = Wholesales Order Bookings - Customs duties - Ocean/Air Freight - Warehousing Costs",
  franchise: "Store EBITDA Contribution = POS Sales receipts - Franchisor Royalty - Brand Ad Levy - Rent - Shift Wages",
  software_agency: "Dev Shop Net Operating Margin = Billings & Retainers - Contractor Developers - Cloud Infrastructure",
  holding_company: "Net Distributable Cash = Subsidiary Distributions + Management Fees - Corporate G&A - Debt Service",
  manufacturing_multi: "Consolidated Gross Margin = Global Product Sales - Materials & Sourcing - Global Direct Labor - Global Logistics",
  private_equity: "Net Fund Value Creation = Exits + Realized Gains - GP Management Fees - Capital Deployed",
  enterprise_saas: "EBITDA (Adjusted) = Recognized ARR & Services - Cloud Infrastructure COGS - R&D - S&M - G&A"
};

export default function TemplateSelector({ 
  isOpen, 
  onClose, 
  onSelect, 
  onOpenAI, 
  currentType, 
  customTemplates = [], 
  onSaveCurrent 
}: TemplateSelectorProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  
  const [inspectedTemplateId, setInspectedTemplateId] = useState<string>(
    currentType && BUSINESS_TEMPLATES[currentType] ? currentType : Object.keys(BUSINESS_TEMPLATES)[0]
  );

  if (!isOpen) return null;

  const icons: Record<string, React.ElementType> = {
    creative: Palette,
    retail: ShoppingCart,
    saas: Cloud,
    realestate: Home,
    nonprofit: Heart,
    service: Briefcase,
    manufacturing: Factory,
    hospitality: Utensils,
    personal: Home,
    agriculture: Sprout,
    healthcare: Activity,
    logistics: Truck,
    subscription_box: Boxes,
    construction: Hammer,
    automotive: Wrench,
    renewable_energy: Zap,
    import_export: Globe,
    franchise: Percent,
    software_agency: Terminal,
    holding_company: Layers,
    manufacturing_multi: Factory,
    private_equity: Activity,
    enterprise_saas: Network
  };

  const activeInspected = BUSINESS_TEMPLATES[inspectedTemplateId] || Object.values(BUSINESS_TEMPLATES)[0];

  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--ink)]/85 backdrop-blur-2xl">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 15 }}
        transition={{ duration: 0.35, ease: [0.19, 1, 0.22, 1] }}
        className="bg-[var(--surface)] rounded-[40px] max-w-[1450px] w-full h-[90dvh] shadow-2xl border border-[var(--line)] overflow-hidden relative flex flex-col"
      >
        {/* Glow Header Accent Bar */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 via-ledger-ink to-emerald-500" />
        
        {/* Header Section */}
        <div className="flex items-center justify-between px-10 pt-10 pb-6 shrink-0 border-b border-[var(--line)] relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 bg-slate-900 text-emerald-400 font-mono text-[9px] font-medium uppercase tracking-wider rounded-lg">
                Chart of accounts
              </span>
              <span className="text-[10px] text-[var(--muted)] font-black uppercase tracking-[0.2em]">
                Ready-to-use templates
              </span>
            </div>
            <h2 id={overlayTitleId} className="text-3xl font-black text-[var(--text)] mt-2 tracking-tight flex items-center gap-3 uppercase italic leading-none">
              <Plus className="text-[var(--text)]" size={24} />
              Choose a chart of accounts
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center bg-[var(--ink)] hover:bg-slate-900 hover:text-white text-slate-500 rounded-[32px] transition-all cursor-pointer active:scale-95"
            aria-label="Close modal"
          >
            <Plus className="rotate-45" size={20} />
          </button>
        </div>

        {/* Multi-Pane Body Layout */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          
          {/* Left Pane: Interactive Catalog & Templates (Scrollable, occuper half screen) */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-10 space-y-12">
            
            {/* AI Custom Builder Card */}
            <div className="space-y-6">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500/40 flex items-center gap-3">
                Custom build
                <div className="h-px bg-slate-200 flex-grow" />
              </h3>
              <div className="grid grid-cols-1 gap-6">
                <motion.div
                  whileHover={{ scale: 1.005, y: -2 }}
                  whileTap={{ scale: 0.995 }}
                  onClick={onOpenAI}
                  className="p-4 md:p-8 rounded-[36px] border-2 border-emerald-500/20 bg-emerald-500/[0.02] hover:border-emerald-500/50 hover:bg-emerald-500/[0.04] transition-all duration-300 cursor-pointer group relative overflow-hidden shadow-sm"
                >
                  <div className="absolute top-0 right-0 p-4 md:p-8 opacity-5 group-hover:scale-110 transition-transform">
                    <Sparkles size={120} className="text-emerald-500" />
                  </div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 relative z-10">
                    <div className="w-16 h-16 bg-slate-900 text-emerald-400 rounded-[32px] flex items-center justify-center shadow-lg group-hover:bg-emerald-500 group-hover:text-white transition-all">
                      <Wand2 size={32} />
                    </div>
                    <div className="flex-grow">
                      <h3 className="text-xl font-black text-[var(--text)] uppercase italic tracking-tight">AI-built chart of accounts</h3>
                      <p className="text-xs text-[var(--muted)] font-medium max-w-2xl mt-1.5 leading-relaxed">
                        Describe your business and get a chart of accounts built for it. Review every account before applying it to your books.
                      </p>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center text-slate-500 group-hover:bg-slate-900 group-hover:text-white transition-all shadow-md mt-4 sm:mt-0">
                      <ArrowRight size={20} />
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Standard Protocols List */}
            <div className="space-y-6">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500/40 flex items-center gap-3">
                Ready-made templates
                <div className="h-px bg-slate-200 flex-grow" />
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.values(BUSINESS_TEMPLATES).map((template) => {
                  const Icon = icons[template.id] || Briefcase;
                  const isActive = currentType === template.id;
                  const isInspected = inspectedTemplateId === template.id;

                  return (
                    <motion.div
                      key={template.id}
                      whileHover={{ y: -4 }}
                      onClick={() => {
                        setInspectedTemplateId(template.id);
                      }}
                      className={cn(
                        "p-6 rounded-[30px] border-2 transition-all cursor-pointer relative overflow-hidden group flex flex-col justify-between shadow-sm",
                        isActive 
                          ? "border-emerald-500 bg-emerald-50/[0.15] shadow-lg shadow-emerald-500/5" 
                          : isInspected
                            ? "border-slate-800 bg-[var(--ink)]/30"
                            : "border-[var(--line)] bg-[var(--surface)] hover:border-slate-800/50"
                      )}
                    >
                      {isActive && (
                        <div className="absolute top-5 right-5 px-2.5 py-1 bg-emerald-500 text-white rounded-lg text-[8px] font-medium uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                          <Check size={10} /> Active
                        </div>
                      )}
                      
                      <div>
                        <div className={cn(
                          "w-12 h-12 rounded-[32px] flex items-center justify-center mb-6 transition-all shadow-sm border",
                          isActive 
                            ? "bg-emerald-500 text-white border-emerald-600" 
                            : "bg-[var(--ink)] text-[var(--text)] border-[var(--line)] group-hover:bg-slate-900 group-hover:text-white"
                        )}>
                          <Icon size={22} />
                        </div>

                        <h3 className="text-lg font-black text-[var(--text)] mb-2 uppercase tracking-tight italic">{template.name}</h3>
                        <p className="text-xs text-[var(--muted)] leading-relaxed font-semibold opacity-70 mb-6">
                          {template.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-wider mt-auto border-t border-[var(--line)]/50 pt-4">
                        <span className={cn(
                          isActive ? "text-emerald-600" : isInspected ? "text-[var(--text)]" : "text-[var(--muted)]"
                        )}>
                          {isActive ? 'In use' : isInspected ? 'Selected' : 'Select template'}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(template.id);
                            }}
                            className="px-3.5 py-1.5 bg-slate-900 text-white hover:bg-emerald-500 transition-all text-[8px] font-medium uppercase tracking-wider rounded-lg flex items-center gap-1.5"
                          >
                            Use template
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Custom Blueprints */}
            {(customTemplates.length > 0 || onSaveCurrent) && (
              <div className="space-y-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500/40 flex items-center gap-3">
                  Saved templates
                  <div className="h-px bg-slate-200 flex-grow" />
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {onSaveCurrent && (
                    <motion.div
                      whileHover={{ y: -4 }}
                      onClick={onSaveCurrent}
                      className="p-6 rounded-[30px] border-2 border-dashed border-[var(--line)] bg-[var(--ink)]/20 hover:border-slate-800 hover:bg-slate-900 hover:text-white transition-all cursor-pointer group flex flex-col items-center justify-center text-center min-h-[180px] shadow-sm"
                    >
                      <div className="w-10 h-10 rounded-xl bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center mb-4 group-hover:bg-[var(--surface)] group-hover:text-[var(--text)] transition-all shadow-sm">
                        <Plus size={18} />
                      </div>
                      <h3 className="text-sm font-black text-[var(--text)] group-hover:text-white mb-1 uppercase tracking-wider">Save current chart</h3>
                      <p className="text-[9px] font-bold text-slate-500 group-hover:text-white/60 uppercase tracking-widest">Save as a template</p>
                    </motion.div>
                  )}

                  {customTemplates.map((template) => (
                    <motion.div
                      key={template.id}
                      whileHover={{ y: -4 }}
                      onClick={() => onSelect(template.id)}
                      className="p-6 rounded-[30px] border-2 border-[var(--line)] bg-[var(--surface)] hover:border-slate-800/50 transition-all cursor-pointer group flex flex-col justify-between shadow-sm"
                    >
                      <div>
                        <div className="w-10 h-10 rounded-xl bg-[var(--ink)] text-[var(--text)] flex items-center justify-center mb-6 group-hover:bg-slate-900 group-hover:text-white transition-all border border-[var(--line)]">
                          <Sparkles size={18} />
                        </div>
                        <h3 className="text-lg font-black text-[var(--text)] mb-2 uppercase tracking-tight italic">{template.name}</h3>
                        <p className="text-xs text-[var(--muted)] leading-relaxed font-semibold opacity-70 mb-6">-</p>
                      </div>
                      <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-wider text-[var(--muted)] mt-auto pt-4 border-t border-[var(--line)]/50">
                        Use template
                        <ArrowRight size={12} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Right Pane: GORGEOUS Mathematical Alignment & Integrity Invariant Inspector (Fixed) */}
          <div className="w-[450px] border-l border-[var(--line)] bg-[var(--ink)]/30 hidden lg:flex flex-col overflow-y-auto custom-scrollbar p-4 md:p-10 justify-between">
            
            <div className="space-y-8">
              {/* Inspected Icon & Headline */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-lg">
                    {React.createElement(icons[activeInspected.id] || Briefcase, { size: 20 })}
                  </div>
                  <div>
                    <span className="text-[8px] font-black tracking-widest text-emerald-600 bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 rounded uppercase">
                      GAAP-based
                    </span>
                    <h3 className="text-xl font-black text-[var(--text)] uppercase tracking-tight italic mt-1 leading-none">
                      {activeInspected.name}
                    </h3>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] font-medium mt-1 leading-relaxed italic opacity-85">
                  "{activeInspected.description}"
                </p>
              </div>

              {/* SECTION 1: THE MATHEMATICAL INVARIANT INTEGRITY EQUATION */}
              <div className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] shadow-sm space-y-3">
                <span className="text-[8px] font-black text-[var(--muted)] uppercase tracking-[0.2em] flex items-center gap-2">
                  <Cpu size={12} className="text-indigo-500" /> Key equation
                </span>
                
                <div className="p-3 bg-slate-900 text-slate-100 rounded-xl font-mono text-[10px] leading-relaxed break-words border border-slate-800">
                  {TEMPLATE_FORMULAS[activeInspected.id] || "Ledger Balance EQ : Assets (Σ Debit) = Liabilities (Σ Credit) + Owner's Equity"}
                </div>
                
                <p className="text-[9px] text-[var(--muted)] font-medium leading-normal">
                  Every entry stays in balance: debits equal credits. An entry that would unbalance the books is refused.
                </p>
              </div>

              {/* SECTION 2: CHARTS OF ACCOUNTS TARGET LIST */}
              <div className="space-y-4">
                <span className="text-[8px] font-black text-[var(--muted)] uppercase tracking-[0.2em] flex items-center gap-2">
                  <Layers size={12} className="text-emerald-500" /> Accounts in this template
                </span>

                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-2 bg-[var(--surface)]/40 p-3 rounded-[32px] border border-[var(--line)]/60">
                  {withOccurrenceKeys(activeInspected.accounts, acc => JSON.stringify([acc.code, acc.name, acc.type, acc.category])).map(({ item: acc, key }) => (
                    <div 
                      key={key}
                      className="px-3.5 py-2 bg-[var(--surface)] border border-[var(--line)] hover:border-slate-800/20 rounded-xl flex items-center justify-between transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[10px] font-black text-[var(--text)] bg-[var(--ink)] px-2 py-0.5 rounded border border-[var(--line)]/50">
                          {acc.code}
                        </span>
                        <span className="text-xs font-bold text-[var(--text)]">
                          {acc.name}
                        </span>
                      </div>
                      <span className="text-[8.5px] font-black uppercase text-[var(--muted)] tracking-wide">
                        {acc.category || acc.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 3: CORE WORKSPACE FLOW GRAPH SCHEMATIC */}
              <div className="space-y-4">
                <span className="text-[8px] font-black text-[var(--muted)] uppercase tracking-[0.2em] flex items-center gap-2">
                  <Network size={12} className="text-amber-500" /> How the accounts connect
                </span>

                {activeInspected.topology?.nodes ? (
                  <div className="p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] flex flex-wrap items-center justify-center gap-x-3 gap-y-2 shrink-0">
                    {activeInspected.topology.nodes.map((node, index) => (
                      <div key={node.id} className="flex items-center gap-2">
                        <div 
                          className="px-2.5 py-1 text-[9px] font-mono font-black border uppercase rounded-lg shadow-sm"
                          style={{ borderColor: `${node.config?.color}30`, backgroundColor: `${node.config?.color}08`, color: node.config?.color }}
                        >
                          {node.label}
                        </div>
                        {index < (activeInspected.topology.nodes?.length ?? 0) - 1 && (
                          <span className="text-slate-500/30 text-xs">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-[var(--surface)]/50 border border-[var(--line)] border-dashed rounded-[32px] text-[10px] text-[var(--muted)] text-center italic">
                    No connection map for this template
                  </div>
                )}
              </div>

            </div>

            {/* Verification Absolute Guarantee Block */}
            <div className="pt-6 border-t border-[var(--line)]/50 space-y-3 shrink-0">
              <div className="p-4 bg-emerald-500/5 text-emerald-800 border border-emerald-500/10 rounded-[32px] space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-500 inline shrink-0" />
                  <span className="text-[9px] font-black uppercase tracking-wider leading-none">Balanced books, enforced</span>
                </div>
                <p className="text-[9.5px] font-medium leading-relaxed text-emerald-700">
                  Unlike spreadsheets, {BRAND_NAME} only posts balanced double entries, so the books cannot drift out of balance.
                </p>
              </div>

              <button
                onClick={() => onSelect(activeInspected.id)}
                className="w-full h-12 bg-slate-900 hover:bg-emerald-500 text-white rounded-[32px] text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg hover:-translate-y-0.5"
              >
                Use this template <ArrowRight size={14} />
              </button>
            </div>

          </div>

        </div>
      </motion.div>
    </div>
  );
}
