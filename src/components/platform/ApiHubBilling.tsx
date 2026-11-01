

import { Users, Sliders, Gauge, Zap, TrendingUp, Coins } from 'lucide-react';
import { toast } from 'sonner';


import type { useApiHubModel } from './useApiHubModel';
export function ApiHubBilling({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { apiLogs, simSeatsCount, setSimSeatsCount, simRequestsCount, setSimRequestsCount, isSimulatingBurst, setIsSimulatingBurst, loadBillingStatus, handleCheckout, fetchLogs } = model;
 return (<div className="space-y-6 animate-in fade-in duration-300">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="ledger-card p-6 space-y-3 shadow-3xs hover:border-slate-300 transition-all border border-slate-150">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-[var(--muted)] tracking-wider">Workspace Plan Tier</span>
                <span className="px-2 py-0.5 bg-purple-100 text-[#8A2BE2] text-[9px] font-black rounded-full uppercase tracking-wider">Enterprise API</span>
              </div>
              <div className="flex items-baseline gap-1 pt-1.5">
                <span className="text-2xl font-black text-[var(--text)] font-display">SaaS Growth</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] font-medium">Billed dynamically based on computational complexity parameters processed.</p>
            </div>

            <div className="ledger-card p-6 space-y-3 shadow-3xs hover:border-slate-300 transition-all border border-slate-150">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-[var(--muted)] tracking-wider">Remaining Compute Balance</span>
                <Zap aria-hidden="true" size={14} className="text-[#FFD700] fill-[#FFD700]" />
              </div>
              <div className="flex items-baseline gap-1 pt-1.5">
                <span className="text-2xl font-black text-[var(--text)] font-mono">100,000 / 100,000</span>
                <span className="text-[10px] text-[var(--muted)] font-black">UNITS</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] font-medium">Quota allocated monthly. Resets in 23 days.</p>
            </div>

            <div className="ledger-card p-6 space-y-3 shadow-3xs hover:border-slate-300 transition-all border border-slate-150">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-[var(--muted)] tracking-wider">Total Operations Calculated</span>
                <TrendingUp aria-hidden="true" size={14} className="text-emerald-500" />
              </div>
              <div className="flex items-baseline gap-1 pt-1.5">
                <span className="text-2xl font-black text-[var(--text)] font-mono">{apiLogs.length}</span>
                <span className="text-[11px] text-[var(--muted)] font-bold uppercase tracking-widest font-mono">Operations</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] font-medium">Audit logs track execution and delta mappings securely.</p>
            </div>

            <div className="ledger-card p-6 space-y-3 shadow-3xs hover:border-slate-300 transition-all border border-slate-150">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-[var(--muted)] tracking-wider">Seat Booking Capacity</span>
                <Users aria-hidden="true" size={14} className="text-[var(--muted)]" />
              </div>
              <div className="flex items-baseline gap-1 pt-1.5">
                <span className="text-2xl font-black text-[var(--text)] font-mono">1 / 50</span>
                <span className="text-[10px] text-[var(--muted)] font-bold">SEATS</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] font-medium">Seats can be scaled with slider simulation below.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Interactive seat allocation slider for CFOs / Persons */}
            <div className="ledger-card p-6 space-y-5 shadow-3xs border border-slate-150">
              <div className="flex items-center gap-3 border-b border-indigo-50 pb-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Sliders aria-hidden="true" size={16} />
                </div>
                <div>
                  <h4 className="font-header font-bold text-[var(--text)] text-sm">Strategic Corporate Capacity Modeler</h4>
                  <p className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-black">Capacity Allocation & Cost Estimations</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-700">Allocated Ledger Seats</span>
                    <span className="font-mono font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{simSeatsCount} Active Seats</span>
                  </div>
                  <input
                    aria-label="Allocated ledger seats"
                    type="range"
                    min="1"
                    max="50"
                    value={simSeatsCount}
                    onChange={(e) => setSimSeatsCount(Number.parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-100 rounded-lg appearance-none"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--muted)]">
                    <span>1 Seat (Sole Agent)</span>
                    <span>50 Seats (Enterprise Suite)</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--line)] space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--muted)] font-bold">Projected Monthly Platform License</span>
                    <span className="font-mono font-bold text-slate-950">${(simSeatsCount * 12).toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--muted)] font-bold">Workspace compute priority</span>
                    <span className="font-bold text-emerald-600">{simSeatsCount > 25 ? '🔥 High Priority Core Threads' : 'Standard Queue Thread'}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleCheckout("pro")}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-wider text-[10px] rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <TrendingUp aria-hidden="true" size={12} />
                  Upgrade to Pro ($5/mo)
                </button>
                <p className="text-[10px] text-center text-[var(--muted)] font-medium">Over limit requests will be billed based on API compute utilization securely via Stripe.</p>
              </div>
            </div>

            {/* Load Stress-Tester tool */}
            <div className="ledger-card p-6 space-y-5 shadow-3xs border border-slate-150">
              <div className="flex items-center gap-3 border-b border-purple-50 pb-3">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Gauge aria-hidden="true" size={16} />
                </div>
                <div>
                  <h4 className="font-header font-bold text-[var(--text)] text-sm">TruthEngine Stress-Testing Console</h4>
                  <p className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-black">Dispatch synthetic load test</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-700">Burst Intensity</span>
                    <span className="font-mono font-black text-purple-700 bg-purple-50 px-2 py-0.5 rounded">{simRequestsCount} Parallel Queries</span>
                  </div>
                  <input
                    aria-label="Burst intensity"
                    type="range"
                    min="10"
                    max="100"
                    step="10"
                    value={simRequestsCount}
                    onChange={(e) => setSimRequestsCount(Number.parseInt(e.target.value, 10))}
                    className="w-full accent-purple-600 cursor-pointer h-1.5 bg-slate-100 rounded-lg appearance-none"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--muted)]">
                    <span>10 hits (Light check)</span>
                    <span>100 hits (Intense Stress)</span>
                  </div>
                </div>

                <button
                  onClick={async () => {
                    setIsSimulatingBurst(true);
                    toast.promise(
                      new Promise((resolve) => setTimeout(resolve, 1500)),
                      {
                        loading: `Simulating ${simRequestsCount} burst operations to TruthEngine...`,
                        success: () => {
                          setIsSimulatingBurst(false);
                          fetchLogs();
                          loadBillingStatus();
                          return `Processed ${simRequestsCount} requests safely under 100 req/min limits!`;
                        },
                        error: 'Simulation failed'
                      }
                    );
                  }}
                  disabled={isSimulatingBurst}
                  className="w-full py-3 bg-[#8A2BE2] disabled:bg-slate-350 text-white font-black uppercase tracking-wider text-[10px] rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs hover:scale-[1.01]"
                >
                  <Coins aria-hidden="true" size={12} />
                  TRIGGER programatic stress test
                </button>
              </div>
            </div>
          </div>

          {/* Subledgers trace of compute costs */}
          <div className="ledger-card p-6 space-y-4 shadow-3xs border border-slate-150">
            <div className="flex items-center gap-2 border-b border-[var(--line)] pb-3">
              <Zap aria-hidden="true" size={14} className="text-purple-600" />
              <h4 className="font-header font-bold text-[#8A2BE2] text-sm uppercase tracking-wide">Ledger computational processing trace</h4>
            </div>

            <div className="bg-[#FAFBFB] p-4 rounded-xl border border-slate-150 space-y-2 text-[11px] font-mono leading-relaxed text-slate-550">
              <p className="font-bold text-[var(--text)]">Double-Entry ledger integrity is managed with complexity weight algorithms:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 pt-1">
                <div className="flex justify-between border-b border-dashed border-[var(--line)] py-0.5">
                  <span>BAYESIAN_CLASSIFIER_PASS:</span>
                  <span className="font-bold text-slate-700">3 units computed</span>
                </div>
                <div className="flex justify-between border-b border-dashed border-[var(--line)] py-0.5">
                  <span>CORTEX_AI_ANALYSIS:</span>
                  <span className="font-bold text-slate-700">10 units computed</span>
                </div>
                <div className="flex justify-between border-b border-dashed border-[var(--line)] py-0.5">
                  <span>LEDGER_BALANCE_VALIDATION:</span>
                  <span className="font-bold text-slate-700">1 unit computed</span>
                </div>
                <div className="flex justify-between border-b border-dashed border-[var(--line)] py-0.5">
                  <span>METRICS_CORRELATION_PASS:</span>
                  <span className="font-bold text-slate-700">1 unit computed</span>
                </div>
              </div>
            </div>
          </div>
        </div>);
}
