
import { Activity, Database, AlertOctagon, Loader2, RefreshCw, Sliders, Calculator } from 'lucide-react';

import { motion, AnimatePresence } from 'motion/react';

import { cn } from '../../lib/utils';

import { Labelled } from '../ui/Labelled';

import type { SystemCommandCenterModel } from './SystemCommandCenter';
export function SystemTelemetryPanel({ model }: { model: SystemCommandCenterModel & { telemetry: NonNullable<SystemCommandCenterModel['telemetry']> } }) {
 const { formatPlatformUsdQuota, formId, telemetry, simulatedQueries, setSimulatedQueries, customKeyRatio, setCustomKeyRatio, bulkSyncing, bulkSyncProgress, bulkSyncTotal, bulkSyncStatusText, startEditing, handleBulkApplyBaseline, globalConfig, setGlobalConfig, updatingGlobal, handleSaveGlobalConfig, totalErrors } = model;
 return (<div className="xl:col-span-2 space-y-8">
            {/* Stat Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-[var(--surface)] border border-[var(--line)] p-4 md:p-8 rounded-[32px] shadow-3xs hover:border-slate-300 transition-all duration-300 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 md:p-8 opacity-[0.02] pointer-events-none group-hover:opacity-[0.05] transition-all">
                  <Database aria-hidden="true" size={80} />
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-slate-900 text-white rounded-[32px] flex items-center justify-center">
                    <Database aria-hidden="true" size={18} />
                  </div>
                  <h2 className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">Active Tenants</h2>
                </div>
                <p className="text-2xl md:text-4xl font-black font-mono text-[var(--text)] tracking-tight">{telemetry.tenants.length}</p>
                <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mt-2">Isolated workspaces in sync</p>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--line)] p-4 md:p-8 rounded-[32px] shadow-3xs hover:border-slate-300 transition-all duration-300 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 md:p-8 opacity-[0.02] pointer-events-none group-hover:opacity-[0.05] transition-all">
                  <Activity aria-hidden="true" size={80} />
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-slate-900 text-white rounded-[32px] flex items-center justify-center">
                    <Activity aria-hidden="true" size={18} />
                  </div>
                  <h2 className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">Global Ledger Rows</h2>
                </div>
                <p className="text-2xl md:text-4xl font-black font-mono text-[var(--text)] tracking-tight">
                  {telemetry.tenants.reduce((acc, t) => acc + t.txCount, 0).toLocaleString()}
                </p>
                <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mt-2">Total transactional assertions</p>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--line)] p-4 md:p-8 rounded-[32px] shadow-3xs hover:border-slate-300 transition-all duration-300 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 md:p-8 opacity-[0.02] pointer-events-none group-hover:opacity-[0.05] transition-all">
                  <AlertOctagon aria-hidden="true" size={80} />
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-rose-500/10 text-rose-600 rounded-[32px] flex items-center justify-center">
                    <AlertOctagon aria-hidden="true" size={18} />
                  </div>
                  <h2 className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">API Incidents (400+)</h2>
                </div>
                <p className="text-2xl md:text-4xl font-black font-mono text-rose-600 tracking-tight">{totalErrors}</p>
                <p className="text-[9px] font-bold text-rose-500 uppercase tracking-wider mt-2">Aggregated active warning nodes</p>
              </div>
            </div>

            {/* Global Pricing Overrides Panel & Bulk Updater */}
            <div className="bg-slate-900 border border-slate-800 text-white rounded-[32px] p-4 md:p-10 shadow-lg relative overflow-hidden">
              <div className="absolute inset-0 technical-grid opacity-[0.03] pointer-events-none" />

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-500/10 text-indigo-400 rounded-[32px] flex items-center justify-center border border-indigo-500/30">
                    <Sliders aria-hidden="true" size={24} className="text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tight italic">Global Baseline Billing & Multiplier Registry</h2>
                    <p className="text-[10px] text-white/40 font-bold tracking-widest uppercase mt-1">Configure standard fallback coefficients applied automatically or synced globally</p>
                  </div>
                </div>

                {/* Bulk Synchronization Trigger (Sync all users at once) */}
                <button
                  type="button"
                  disabled={bulkSyncing || telemetry.tenants.length === 0}
                  onClick={handleBulkApplyBaseline}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] uppercase tracking-widest rounded-xl shadow-md transition-all flex items-center gap-2 border border-indigo-400/30 disabled:opacity-40"
                 aria-label="Sync to All Workspaces">
                  <RefreshCw aria-hidden="true" size={11} className={cn(bulkSyncing && "animate-spin")} />
                  Sync to All Workspaces
                </button>
              </div>

              {/* Bulk Alignment Progress Indicator */}
              <AnimatePresence>
                {bulkSyncing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-6 p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-[32px] space-y-3"
                  >
                    <div className="flex justify-between items-center text-xs font-mono">
                      <span className="text-indigo-300 uppercase font-black tracking-widest text-[9px] flex items-center gap-2">
                        <Loader2 aria-hidden="true" size={12} className="animate-spin" />
                        {bulkSyncStatusText}
                      </span>
                      <span className="text-indigo-400 font-bold text-[10px]">
                        {bulkSyncProgress} / {bulkSyncTotal} ({Math.round((bulkSyncProgress / bulkSyncTotal) * 100)}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${(bulkSyncProgress / bulkSyncTotal) * 100}%` }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSaveGlobalConfig} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-6 items-end">
                {/* Multiplier 1 */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label htmlFor={`${formId}-credit-multiplier`} className="block text-[10px] font-bold text-white/50 uppercase tracking-widest ml-0.5">
                      Credit Cost Multiplier
                    </label>
                    <span className="text-[10px] font-mono text-indigo-400 font-bold">{globalConfig.creditCostMultiplier}x</span>
                  </div>
                  <input
                    id={`${formId}-credit-multiplier`}
                    type="range"
                    min="0"
                    max="5"
                    step="0.05"
                    value={globalConfig.creditCostMultiplier}
                    onChange={(e) => setGlobalConfig(prev => ({ ...prev, creditCostMultiplier: Number(e.target.value) }))}
                    className="w-full h-1.5 bg-[var(--surface)]/10 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <div className="flex justify-between text-[8px] text-white/30 font-bold uppercase">
                    <span>Free</span>
                    <span>Standard (1.0)</span>
                    <span>High (5.0)</span>
                  </div>
                </div>

                {/* Multiplier 2 */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label htmlFor={`${formId}-spend-multiplier`} className="block text-[10px] font-bold text-white/50 uppercase tracking-widest ml-0.5">
                      Platform spend Multiplier
                    </label>
                    <span className="text-[10px] font-mono text-indigo-400 font-bold">{globalConfig.quotaCentsMultiplier}x</span>
                  </div>
                  <input
                    id={`${formId}-spend-multiplier`}
                    type="range"
                    min="0"
                    max="5"
                    step="0.05"
                    value={globalConfig.quotaCentsMultiplier}
                    onChange={(e) => setGlobalConfig(prev => ({ ...prev, quotaCentsMultiplier: Number(e.target.value) }))}
                    className="w-full h-1.5 bg-[var(--surface)]/10 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <div className="flex justify-between text-[8px] text-white/30 font-bold uppercase">
                    <span>Free Spend</span>
                    <span>1.0x</span>
                    <span>Premium (5.0)</span>
                  </div>
                </div>

                {/* Self API key credits */}
                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-bold text-white/50 uppercase tracking-widest ml-0.5" label="Key Overhead Credits">
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      value={globalConfig.customKeyCreditCharge}
                      onChange={(e) => setGlobalConfig(prev => ({ ...prev, customKeyCreditCharge: Number(e.target.value || 0) }))}
                      className="w-full h-11 bg-[var(--surface)]/5 border border-white/10 rounded-xl px-4 text-xs font-mono font-bold text-white focus:border-[#0047AB] outline-none transition-all"
                    />
                  </Labelled>
                  <p className="text-[9px] text-white/30 uppercase font-black">standard: 10 per call</p>
                </div>

                {/* Self API key cents */}
                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-bold text-white/50 uppercase tracking-widest ml-0.5" label="Key Overhead Cents">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={globalConfig.customKeyCentsCharge}
                      onChange={(e) => setGlobalConfig(prev => ({ ...prev, customKeyCentsCharge: Number(e.target.value || 0) }))}
                      className="w-full h-11 bg-[var(--surface)]/5 border border-white/10 rounded-xl px-4 text-xs font-mono font-bold text-white focus:border-[#0047AB] outline-none transition-all"
                    />
                  </Labelled>
                  <p className="text-[9px] text-white/30 uppercase font-black">standard: 0 cents</p>
                </div>

                {/* User Limit Cap */}
                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-bold text-white/50 uppercase tracking-widest ml-0.5" label="User Registration Limit">
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={globalConfig.maxRegistrationLimit ?? 100}
                      onChange={(e) => setGlobalConfig(prev => ({ ...prev, maxRegistrationLimit: Number(e.target.value || 0) }))}
                      className="w-full h-11 bg-[var(--surface)]/5 border border-white/10 rounded-xl px-4 text-xs font-mono font-bold text-white focus:border-[#0047AB] outline-none transition-all"
                    />
                  </Labelled>
                  <p className="text-[9px] text-white/30 uppercase font-black">limit total users</p>
                </div>

                {/* Free Tx Cap */}
                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-bold text-white/50 uppercase tracking-widest ml-0.5" label="Free Tier Tx Cap">
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      value={globalConfig.freeWorkspaceTxCap ?? 100}
                      onChange={(e) => setGlobalConfig(prev => ({ ...prev, freeWorkspaceTxCap: Number(e.target.value || 0) }))}
                      className="w-full h-11 bg-[var(--surface)]/5 border border-white/10 rounded-xl px-4 text-xs font-mono font-bold text-white focus:border-[#0047AB] outline-none transition-all"
                    />
                  </Labelled>
                  <p className="text-[9px] text-white/30 uppercase font-black">cap per free workspace</p>
                </div>

                {/* Submit button */}
                <div className="space-y-2">
                  <button
                    type="submit"
                    disabled={updatingGlobal}
                    className="w-full h-11 bg-[#0047AB] hover:bg-[#0047AB]/90 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
                   aria-label="Save baseline pricing">
                    {updatingGlobal ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      'Save Baseline Pricing'
                    )}
                  </button>
                  <div className="flex items-center gap-1.5 justify-center">
                    <input
                      type="checkbox"
                      id={`${formId}-global-bypass`}
                      checked={globalConfig.bypassBilling}
                      onChange={(e) => setGlobalConfig(prev => ({ ...prev, bypassBilling: e.target.checked }))}
                      className="cursor-pointer"
                    />
                    <label htmlFor={`${formId}-global-bypass`} className="text-[9px] font-black uppercase tracking-wider text-pink-400 cursor-pointer select-none">
                      MASTER BYPASS FREE
                    </label>
                  </div>
                </div>
              </form>
            </div>

            {/* Interactive Billing & Profit Simulator Modeler */}
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[32px] p-4 md:p-10 shadow-3xs relative overflow-hidden">
              <div className="absolute inset-0 technical-grid opacity-[0.01] pointer-events-none" />

              <div className="flex items-center gap-3 pb-6 border-b border-[var(--line)] mb-6">
                <div className="w-10 h-10 bg-[#0047AB]/5 text-[#0047AB] rounded-[32px] flex items-center justify-center">
                  <Calculator aria-hidden="true" size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight italic">Platform Revenue & Surcharge Modeler Simulation</h2>
                  <p className="text-[10px] text-[var(--muted)] font-bold tracking-wide uppercase mt-0.5">
                    Model monetization yield based on query volume, cost multipliers, and proportion of private key users
                  </p>
                </div>
              </div>

              {/* Sliders Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">Load-Test Queries per Month</span>
                    <span className="text-xs font-mono font-black text-[#0047AB]">{simulatedQueries.toLocaleString()} / mo</span>
                  </div>
                  <input
                    aria-label="Load-test queries per month"
                    type="range"
                    min="10000"
                    max="5000000"
                    step="10000"
                    value={simulatedQueries}
                    onChange={(e) => setSimulatedQueries(Number(e.target.value))}
                    className="w-full h-2 bg-slate-150 rounded-lg appearance-none cursor-pointer accent-[#0047AB]"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--muted)] font-bold uppercase">
                    <span>10k / low</span>
                    <span>1M / mid</span>
                    <span>5M / high-volume</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--muted)]">Proportion of Custom Key Users</span>
                    <span className="text-xs font-mono font-black text-indigo-650">{customKeyRatio}% of tenants</span>
                  </div>
                  <input
                    aria-label="Proportion of custom key users"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={customKeyRatio}
                    onChange={(e) => setCustomKeyRatio(Number(e.target.value))}
                    className="w-full h-2 bg-slate-150 rounded-lg appearance-none cursor-pointer accent-[#0047AB]"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--muted)] font-bold uppercase">
                    <span>0% (All System Paid)</span>
                    <span>50% (Surcharge Hybrid)</span>
                    <span>100% (Pure key Surcharge)</span>
                  </div>
                </div>
              </div>

              {/* Calculations Matrix results */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6 bg-[var(--ink)] rounded-[32px] border border-[var(--line)]">
                {/* 1 */}
                <div className="space-y-1">
                  <span className="text-[8px] font-black text-[var(--muted)] uppercase tracking-widest block">Est. Compute Credits Burn rate</span>
                  <div className="text-xl font-mono font-black text-[var(--text)]">
                    {Math.round(simulatedQueries * (customKeyRatio / 100 * (globalConfig.customKeyCreditCharge) + (1 - customKeyRatio / 100) * 100) * (globalConfig.creditCostMultiplier || 1)).toLocaleString()}
                  </div>
                  <span className="text-[9px] font-bold text-[var(--muted)] leading-none">Compute credits allocated monthly</span>
                </div>

                {/* 2 */}
                <div className="space-y-1 border-[var(--line)] sm:border-l sm:pl-6">
                  <span className="text-[8px] font-black text-[var(--muted)] uppercase tracking-widest block">Gross Platform Cent Revenue</span>
                  <div className="text-xl font-mono font-black text-emerald-650">
                    ${((simulatedQueries * (1 - customKeyRatio / 100) * 0.01 * (globalConfig.quotaCentsMultiplier || 1)) + (simulatedQueries * (customKeyRatio / 100) * (globalConfig.customKeyCentsCharge / 100))).toFixed(2)}
                  </div>
                  <span className="text-[9px] font-bold text-[var(--muted)] leading-none">Estimated revenue pool per month</span>
                </div>

                {/* 3 */}
                <div className="space-y-1 border-[var(--line)] sm:border-l sm:pl-6">
                  <span className="text-[8px] font-black text-[var(--muted)] uppercase tracking-widest block">System Key Royaltiy Yield</span>
                  <div className="text-xl font-mono font-black text-indigo-650">
                    {Math.round(simulatedQueries * (customKeyRatio / 100) * globalConfig.customKeyCreditCharge).toLocaleString()} cr
                  </div>
                  <span className="text-[9px] font-bold text-[var(--muted)] leading-none">Royalty fee extracted from bypass API</span>
                </div>
              </div>
            </div>

            {/* Tenant Registry */}
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[32px] p-4 md:p-8 shadow-3xs relative overflow-hidden">
              <div className="absolute inset-0 technical-grid opacity-[0.01] pointer-events-none" />
              <div className="flex items-center justify-between pb-6 border-b border-[var(--line)] mb-6 flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-6 bg-slate-900 rounded-full" />
                  <div>
                    <h2 className="text-lg font-black uppercase tracking-tight italic">Multi-Tenant Ledger Matrix</h2>
                    <p className="text-[10px] text-[var(--muted)] font-bold tracking-wide uppercase mt-0.5">Click any workspace parameters row to customize limits & plans as Admin</p>
                  </div>
                </div>
              </div>

              <div role="region" aria-label="Scrollable workspace ledger matrix" tabIndex={0} className="overflow-x-auto custom-scrollbar">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Workspaces</caption>
                  <thead>
                    <tr className="border-b border-[var(--line)] text-[var(--muted)] text-[10px] font-medium uppercase tracking-wider bg-[var(--ink)]/50">
                      <th scope="col" className="py-4 px-4">Workspace Identity / Name</th>
                      <th scope="col" className="py-4 px-4 text-center">Plan</th>
                      <th scope="col" className="py-4 px-4 text-right">Max Seats</th>
                      <th scope="col" className="py-4 px-4 text-right">Compute Bal</th>
                      <th scope="col" className="py-4 px-4 text-right">Quota ($)</th>
                      <th scope="col" className="py-4 px-4 text-right">Used ($)</th>
                      <th scope="col" className="py-4 px-4 text-right">Cost/User</th>
                      <th scope="col" className="py-4 px-4 text-right">Tx Rows</th>
                      <th scope="col" className="py-4 px-4 text-right">AI Requests</th>
                      <th scope="col" className="py-4 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ledger-line font-medium text-[var(--text)]">
                    {telemetry.tenants.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-[var(--muted)] font-bold uppercase tracking-widest text-[10px]">
                          No workspaces detected on server
                        </td>
                      </tr>
                    ) : (
                      [...telemetry.tenants].sort((a, b) => b.requestCount - a.requestCount).map((tenant) => {
                        const isSpiking = tenant.requestCount > 500;
                        const usedDollars = ((tenant.apiQuotaTotalCentsUsed || 0) / 100).toFixed(2);
                        const activeUsers = tenant.activeUserCount || 1;
                        const costPerUser = (((tenant.apiQuotaTotalCentsUsed || 0) / 100) / activeUsers).toFixed(2);
                        return (
                          <tr
                            key={tenant.id}
                            onClick={() => startEditing(tenant)}
                            className="hover:bg-[#0047AB]/5 cursor-pointer transition-colors group"
                            title="Click to view and edit limits as systems administrator"
                          >
                            <td className="py-4 px-4">
                              <div className="font-mono text-xs text-slate-600 font-bold tracking-tight group-hover:text-[#0047AB]">
                                {tenant.id}
                              </div>
                              <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5 truncate max-w-[200px]">
                                {tenant.name || "Default Workspace"}
                              </div>
                            </td>
                            <td className="py-4 px-4 text-center">
                              <span className={cn(
                                "text-[9px] px-2 py-0.5 rounded-md font-medium uppercase tracking-wider border",
                                tenant.plan === 'enterprise' ? "bg-purple-50 text-purple-700 border-purple-200" :
                                tenant.plan === 'growth' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                "bg-[var(--ink)] text-slate-600 border-[var(--line)]"
                              )}>
                                {tenant.plan || 'sandbox'}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs font-bold">
                              {tenant.maxSeats || 3}
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs text-indigo-650 font-bold">
                              {(tenant.computeCreditBalance || 0).toLocaleString()}
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs text-emerald-650 font-bold">
                              {formatPlatformUsdQuota(tenant.apiQuotaMonthlyLimitCents || 0)}
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs text-rose-650 font-bold">
                              ${usedDollars}
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs text-purple-650 font-bold">
                              ${costPerUser}
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs text-[var(--muted)]">
                              {(tenant.txCount || 0).toLocaleString()}
                            </td>
                            <td className="py-4 px-4 text-right font-mono text-xs text-indigo-600">
                              {(tenant.requestCount || 0).toLocaleString()}
                            </td>
                            <td className="py-4 px-4 text-center">
                              {isSpiking ? (
                                <span className="bg-rose-50 border border-rose-200 text-rose-700 px-2 py-0.5 rounded-lg text-[9px] font-medium uppercase tracking-wider inline-flex items-center gap-1 shadow-3xs">
                                  Spiking
                                </span>
                              ) : tenant.errorCount > 0 ? (
                                <span className="bg-amber-5 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-lg text-[9px] font-medium uppercase tracking-wider">
                                  WARNING
                                </span>
                              ) : (
                                <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-lg text-[9px] font-medium uppercase tracking-wider group-hover:bg-[#0047AB] group-hover:text-white group-hover:border-[#0047AB] transition-all">
                                  OPTIMAL
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>);
}
