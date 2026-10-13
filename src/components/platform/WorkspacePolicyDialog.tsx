
import { AlertOctagon, ShieldCheck, Building, Cpu, Users, DollarSign, Gift, Sparkles, Zap } from 'lucide-react';
import { planFor } from '../../lib/plans';

import { motion, AnimatePresence } from 'motion/react';

import { cn } from '../../lib/utils';

import { Labelled } from '../ui/Labelled';

import type { SystemCommandCenterModel } from './SystemCommandCenter';
export function WorkspacePolicyDialog({ model }: { model: SystemCommandCenterModel }) {
 const { overlay1DialogProps, overlay1TitleId, formId, editingWorkspace, setEditingWorkspace, savingWorkspace, activeFormTab, setActiveFormTab, formState, setFormState, handleSaveWorkspaceLimits } = model;
 return (<AnimatePresence>
            {editingWorkspace && (
              <div {...overlay1DialogProps} className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[200] p-4 animate-fade-in">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 15 }}
                  className="bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-2xl p-4 md:p-8 max-w-xl w-full relative z-[210] overflow-hidden flex flex-col max-h-[90dvh] md:max-h-none"
                >
                  <div className="absolute top-0 inset-x-0 h-1 bg-[#0047AB]" />

                  <div className="mb-4 flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-md">
                        Institutional Supervisor Control
                      </span>
                      <h2 id={overlay1TitleId} className="text-2xl font-black text-[var(--text)] tracking-tight mt-1 truncate">Workspace Policy Editor</h2>
                      <p className="text-[var(--muted)] font-mono text-[9px] font-bold uppercase mt-0.5 truncate">Workspace Hash: {editingWorkspace.id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingWorkspace(null)}
                      className="text-[var(--muted)] hover:text-slate-700 font-bold text-xs px-3 py-1.5 bg-[var(--ink)] hover:bg-slate-100 rounded-xl transition-all"
                    >
                      CLOSE (ESC)
                    </button>
                  </div>

                  {/* Horizontal Tab Navigation bar inside Modal */}
                  <div className="flex border-b border-[var(--line)] mb-5 overflow-x-auto gap-2 py-1 scrollbar-hidden">
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('tier')}
                      className={cn(
                        "px-3 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                        activeFormTab === 'tier'
                          ? "bg-[#0047AB]/10 text-[#0047AB] border border-[#0047AB]/20"
                          : "text-[var(--muted)] hover:text-slate-700 hover:bg-[var(--ink)]"
                      )}
                    >
                      <Sparkles aria-hidden="true" size={12} /> Pricing & Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('access')}
                      className={cn(
                        "px-3 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                        activeFormTab === 'access'
                          ? "bg-[#0047AB]/10 text-[#0047AB] border border-[#0047AB]/20"
                          : "text-[var(--muted)] hover:text-slate-700 hover:bg-[var(--ink)]"
                      )}
                    >
                      <Users aria-hidden="true" size={12} /> Access & Seats
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('credits')}
                      className={cn(
                        "px-3 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                        activeFormTab === 'credits'
                          ? "bg-[#0047AB]/10 text-[#0047AB] border border-[#0047AB]/20"
                          : "text-[var(--muted)] hover:text-slate-700 hover:bg-[var(--ink)]"
                      )}
                    >
                      <Gift aria-hidden="true" size={12} /> Grant Free Credits
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('roadmap')}
                      className={cn(
                        "px-3 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                        activeFormTab === 'roadmap'
                          ? "bg-[#0047AB]/10 text-[#0047AB] border border-[#0047AB]/20"
                          : "text-[var(--muted)] hover:text-slate-700 hover:bg-[var(--ink)]"
                      )}
                    >
                      <DollarSign aria-hidden="true" size={12} /> Monetization
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFormTab('rates')}
                      className={cn(
                        "px-3 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap",
                        activeFormTab === 'rates'
                          ? "bg-[#0047AB]/10 text-[#0047AB] border border-[#0047AB]/20"
                          : "text-[var(--muted)] hover:text-slate-700 hover:bg-[var(--ink)]"
                      )}
                    >
                      <Cpu aria-hidden="true" size={12} /> Rates & Keys
                    </button>

                  </div>

                  <form onSubmit={handleSaveWorkspaceLimits} className="space-y-5 flex-1 overflow-y-auto max-h-[60dvh] pr-1 scrollbar-thin">

                    {/* TAB 1: Pricing & Plan selector */}
                    {activeFormTab === 'tier' && (
                      <div className="space-y-4">
                        <div>
                          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Assigned Plan Model">
                            <select
                              value={formState.plan}
                              onChange={(e) => setFormState(prev => ({ ...prev, plan: e.target.value }))}
                              className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-3 text-xs font-bold text-[var(--text)] focus:border-[#0047AB] focus:ring-1 focus:ring-[#0047AB] outline-none cursor-pointer transition-all"
                            >
                              <option value="sandbox">Sandbox Tier (Capped default offline development)</option>
                              <option value="growth">Growth Platform Tier (Professional Core Business - Paid)</option>
                              <option value="enterprise">Enterprise VIP Tier (High-volume Dedicated Capacity - Paid Custom)</option>
                            </select>
                          </Labelled>
                        </div>

                        {/* Interactive plan features visual guide */}
                        <div className="grid grid-cols-1 gap-3 pt-2">
                          <div className={cn(
                            "p-3 rounded-[32px] border text-left transition-all",
                            formState.plan === 'sandbox' ? "bg-[var(--ink)] border-slate-300" : "bg-[var(--surface)] border-[var(--line)] opacity-60"
                          )}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-black text-[var(--text)] uppercase tracking-tight">Sandbox / Free Tier</span>
                              <span className="text-[9px] font-black uppercase text-[var(--muted)] bg-slate-100 px-2 py-0.5 rounded-lg">$0.00 / mo</span>
                            </div>
                            <p className="text-[10px] text-[var(--muted)] font-medium lowercase first-letter:uppercase">Includes 100k standard compute units, 3 seat limit, normal query rates. Ideal for trial accounts.</p>
                          </div>

                          <div className={cn(
                            "p-3 rounded-[32px] border text-left transition-all",
                            formState.plan === 'growth' ? "bg-emerald-50/40 border-emerald-300 shadow-3xs" : "bg-[var(--surface)] border-[var(--line)] opacity-60"
                          )}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-black text-[#2e7d32] uppercase tracking-tight flex items-center gap-1">
                                <Zap aria-hidden="true" size={10} /> Growth Business Plan
                              </span>
                              <span className="text-[9px] font-black uppercase text-[#2e7d32] bg-emerald-50 px-2 py-0.5 rounded-lg">${planFor('growth').monthlyUsd}.00 / mo</span>
                            </div>
                            <p className="text-[10px] text-[var(--muted)] font-medium lowercase first-letter:uppercase">Allocates 500k standard compute credits, up to 15 seat limits, and standard API capabilities.</p>
                          </div>

                          <div className={cn(
                            "p-3 rounded-[32px] border text-left transition-all",
                            formState.plan === 'enterprise' ? "bg-purple-50/40 border-purple-300 shadow-3xs" : "bg-[var(--surface)] border-[var(--line)] opacity-60"
                          )}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-black text-purple-700 uppercase tracking-tight flex items-center gap-1">
                                <Building aria-hidden="true" size={10} /> Institutional Enterprise
                              </span>
                              <span className="text-[9px] font-black uppercase text-purple-700 bg-purple-100 px-2 py-0.5 rounded-lg">Custom Quote</span>
                            </div>
                            <p className="text-[10px] text-[var(--muted)] font-medium lowercase first-letter:uppercase">Allocates custom credits (e.g. 5M+ credits), unlimited concurrent rate boundaries, VIP status.</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 2: Access & Seats limit controls */}
                    {activeFormTab === 'access' && (
                      <div className="space-y-4">
                        <div className="p-4 bg-[var(--ink)] rounded-[32px] border border-slate-150 flex items-center gap-3">
                          <Users aria-hidden="true" size={16} className="text-[#0047AB]" />
                          <div>
                            <p className="text-xs font-black text-[var(--text)]">Seat Limits & Operations</p>
                            <p className="text-[10px] text-[var(--muted)]">Determine user access size per tenant. If seats count surpasses maximum limit, further user registration is blocked automatically.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Seat authorization (Max Seats)">
                              <input
                                type="number"
                                value={formState.maxSeats}
                                min={1}
                                max={500}
                                onChange={(e) => setFormState(prev => ({ ...prev, maxSeats: Number(e.target.value) }))}
                                className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              />
                            </Labelled>
                            <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">Capped at 500 seats/tenant</p>
                          </div>

                          <div>
                            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Rate limit (Queries rate/min)">
                              <input
                                type="number"
                                value={formState.concurrentUserLimit}
                                min={5}
                                max={10000}
                                onChange={(e) => setFormState(prev => ({ ...prev, concurrentUserLimit: Number(e.target.value) }))}
                                className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              />
                            </Labelled>
                            <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">Prevents endpoint throttling</p>
                          </div>
                        </div>

                        {/* Lock / Suspense simulations */}
                        <div role="group" aria-labelledby={`${formId}-access-status`} className="pt-2">
                          <div id={`${formId}-access-status`} className="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">
                            Workspace Access Status
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              className="h-10 border border-emerald-250 bg-emerald-50 text-emerald-800 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                              onClick={() => {
                                setFormState(prev => ({ ...prev, concurrentUserLimit: 60 }));
                              }}
                            >
                              <ShieldCheck aria-hidden="true" size={12} /> Normal Access
                            </button>
                            <button
                              type="button"
                              className="h-10 border border-rose-250 bg-rose-50 text-rose-800 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                              onClick={() => {
                                // Freeze by bringing rate limits down as simulator
                                setFormState(prev => ({ ...prev, concurrentUserLimit: 0 }));
                              }}
                            >
                              <AlertOctagon aria-hidden="true" size={12} /> Freeze Account
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 3: Grant Promotional Credits (Giving Free) */}
                    {activeFormTab === 'credits' && (
                      <div className="space-y-4">
                        <div className="p-4 bg-indigo-50/50 rounded-[32px] border border-indigo-150 flex items-center gap-3">
                          <Gift aria-hidden="true" size={16} className="text-indigo-650" />
                          <div>
                            <p className="text-xs font-black text-[var(--text)]">Assign Free Promotional Allocations</p>
                            <p className="text-[10px] text-[var(--muted)]">Inject computational balance credits for testing, marketing, or to reward long-term institutional customers with free credit balances.</p>
                          </div>
                        </div>

                        <div>
                          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Compute balance credits">
                            <input
                              type="number"
                              value={formState.computeCreditBalance}
                              min={0}
                              max={10000000}
                              onChange={(e) => setFormState(prev => ({ ...prev, computeCreditBalance: Number(e.target.value) }))}
                              className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                            />
                          </Labelled>
                          <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">Required dynamically by rule classifying pipeline & algorithms on API routes</p>
                        </div>

                        {/* Quick Inject Grant Credit triggers */}
                        <div className="pt-2">
                          <span className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest mb-2 ml-0.5">Quick Grant Presets (Click to Load)</span>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => setFormState(prev => ({ ...prev, computeCreditBalance: prev.computeCreditBalance + 50000 }))}
                              className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-[10px] font-black uppercase text-slate-700 transition"
                            >
                              +50k Credits
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormState(prev => ({ ...prev, computeCreditBalance: prev.computeCreditBalance + 150000 }))}
                              className="px-3 py-2.5 bg-[#0047AB]/5 hover:bg-[#0047AB]/10 text-[#0047AB] border border-[#0047AB]/20 rounded-xl text-[10px] font-black uppercase transition"
                            >
                              +150k Promo
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormState(prev => ({ ...prev, computeCreditBalance: prev.computeCreditBalance + 1000000 }))}
                              className="px-3 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-250 rounded-xl text-[10px] font-black uppercase transition"
                            >
                              +1M Credits
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 4: Monetization Strategy & Cash Controls */}
                    {activeFormTab === 'roadmap' && (
                      <div className="space-y-4 text-left">
                        <div className="p-4 bg-[#0047AB]/5 rounded-[32px] border border-[#0047AB]/10 flex items-center gap-3">
                          <DollarSign aria-hidden="true" size={16} className="text-[#0047AB]" />
                          <div>
                            <p className="text-xs font-black text-[var(--text)]">Monetization & API Limits ($)</p>
                            <p className="text-[10px] text-[var(--muted)]">Establish maximum billing limits per workspace to charge for premium services. Limit over-spending and manage enterprise custom invoicing.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="API Monthly Limit ($)">
                              <input
                                type="number"
                                step="0.01"
                                value={(formState.apiQuotaMonthlyLimitCents / 100).toFixed(2)}
                                onChange={(e) => setFormState(prev => ({ ...prev, apiQuotaMonthlyLimitCents: Math.round(Number(e.target.value || 0) * 100) }))}
                                className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              />
                            </Labelled>
                            <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">Auto-caps programmatic use</p>
                          </div>

                          <div>
                            <div className="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">
                              Estimated Monthly Bill
                            </div>
                            <div className="w-full h-11 bg-slate-100 border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-slate-600 flex items-center">
                              ${planFor(formState.plan).monthlyUsd > 0 ? `${planFor(formState.plan).monthlyUsd}.00 / mo` : '0.00 (Free)'}
                            </div>
                            <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">Based on designated plan model</p>
                          </div>
                        </div>

                        <div className="p-4 bg-[var(--ink)] rounded-[32px] border border-[var(--line)]">
                          <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">Monetization Deployment Strategy</h3>
                          <p className="text-[10px] text-[var(--muted)] leading-relaxed uppercase tracking-wide">
                            LedgerFlow is fully structured to receive custom payment processors (e.g. Stripe Customer Portal). This admin system already manages and updates plans, quotas, and limits. By connecting a Stripe webhook, you will be able to process subscriptions and charge client cards directly, with this UI serving as your operational control tower.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* TAB 5: Pricing Multipliers & Cust Key Charges */}
                    {activeFormTab === 'rates' && (
                      <div className="space-y-4 text-left">
                        <div className="p-4 bg-emerald-50/50 rounded-[32px] border border-emerald-250/30 flex items-center gap-3">
                          <Cpu aria-hidden="true" size={16} className="text-emerald-505 animate-pulse" />
                          <div>
                            <p className="text-xs font-black text-[var(--text)]">Dynamic Pricing Multipliers & Private Key Surcharges</p>
                            <p className="text-[10px] text-[var(--muted)] leading-relaxed">Provide granular overrides for this specific workspace. You can scale charging metrics from zero to premium amounts dynamically.</p>
                          </div>
                        </div>

                        {/* Bypass Switch */}
                        <div className="p-4 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] flex items-center justify-between">
                          <div>
                            <p className="text-xs font-black text-[var(--text)] uppercase tracking-tight">Bypass All Billing & Caps</p>
                            <p className="text-[9px] text-[var(--muted)] uppercase font-black tracking-wider mt-0.5">Gives unmetered free operations, bypassing freeze limits completely</p>
                          </div>
                          <label htmlFor={`${formId}-workspace-bypass`} className="relative inline-flex items-center cursor-pointer">
                            <input
                              id={`${formId}-workspace-bypass`}
                              aria-label="Bypass all billing and caps"
                              type="checkbox"
                              checked={formState.bypassBilling}
                              onChange={(e) => setFormState(prev => ({ ...prev, bypassBilling: e.target.checked }))}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-250 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--surface)] after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0047AB] bg-slate-300"></div>
                          </label>
                        </div>

                        {/* Cost Multipliers */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Compute Credit Cost Multiplier">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="10"
                                value={formState.creditCostMultiplier}
                                onChange={(e) => setFormState(prev => ({ ...prev, creditCostMultiplier: Number(e.target.value || 0) }))}
                                className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              />
                            </Labelled>
                            <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">
                              0.00 = Free, 1.0 = Base, 2.0 = Double cost
                            </p>
                          </div>

                          <div>
                            <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Platform Spend Multiplier (Cents)">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="10"
                                value={formState.quotaCentsMultiplier}
                                onChange={(e) => setFormState(prev => ({ ...prev, quotaCentsMultiplier: Number(e.target.value || 0) }))}
                                className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              />
                            </Labelled>
                            <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider leading-relaxed">
                              0.00 = Free spend, 1.0 = Base multiplier
                            </p>
                          </div>
                        </div>

                        {/* Custom Key Parameters */}
                        <div className="p-4 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] space-y-4">
                          <h3 className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Self-Funded API Key Rates</h3>
                          <p className="text-[9px] text-[var(--muted)] leading-normal uppercase tracking-wider font-extrabold">
                            Specify billing charges if this account provides their private Gemini key:
                          </p>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Overhead Credits Per Query">
                                <input
                                  type="number"
                                  min="0"
                                  value={formState.customKeyCreditCharge}
                                  onChange={(e) => setFormState(prev => ({ ...prev, customKeyCreditCharge: Number(e.target.value || 0) }))}
                                  className="w-full h-10 bg-[var(--surface)] border border-slate-205 rounded-xl px-3 text-xs font-mono font-bold text-slate-850 focus:border-[#0047AB] outline-none transition-all"
                                />
                              </Labelled>
                              <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider">
                                Credits (default is 10)
                              </p>
                            </div>

                            <div>
                              <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Overhead Cents Per Query">
                                <input
                                  type="number"
                                  min="0"
                                  value={formState.customKeyCentsCharge}
                                  onChange={(e) => setFormState(prev => ({ ...prev, customKeyCentsCharge: Number(e.target.value || 0) }))}
                                  className="w-full h-10 bg-[var(--surface)] border border-slate-205 rounded-xl px-3 text-xs font-mono font-bold text-slate-855 focus:border-[#0047AB] outline-none transition-all"
                                />
                              </Labelled>
                              <p className="text-[9px] text-[var(--muted)] mt-1 uppercase font-bold tracking-wider">
                                Platform cents (default is 0)
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 pt-4 border-t border-[var(--line)]">
                      <button
                        type="button"
                        onClick={() => setEditingWorkspace(null)}
                        className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 text-[var(--text)] rounded-xl font-bold text-xs uppercase tracking-wider transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingWorkspace}
                        className="flex-1 h-12 bg-slate-900 text-white hover:bg-[#0047AB] rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-md flex items-center justify-center gap-2"
                       aria-label="Save administrative override">
                        {savingWorkspace ? (
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          'Save administrative override'
                        )}
                      </button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>);
}
