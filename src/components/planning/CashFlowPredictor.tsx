import { resolveAccountRole } from '../../lib/accountUtils';
import React, { useState, useMemo } from 'react';
import { TrendingUp, Activity, BarChart, Zap, Calendar, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { StrategicEngine } from '../../services/strategicEngine';
import { isPostable, lineAmount } from '../../lib/txFilters';

import { useLedgerStore } from '../../stores/useLedgerStore';
import { useServerActivity } from '../../hooks/useServerActivity';
import { openingCutoff } from '../../lib/serverBalances';
import { monthEnd, sumActivity } from '../../lib/periodActivity';

/** The first and last day of the month `date` falls in. */
const monthRange = (date: string): [string, string] => {
  if (!/^\d{4}-\d{2}/.test(date)) return ['', ''];
  return [`${date.slice(0, 7)}-01`, monthEnd(date.slice(0, 7))];
};

export default function CashFlowPredictor() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);

  const [activeTab, setActiveTab] = useState<'forecast' | 'trends'>('forecast');
  
  const forecastData = useMemo(() => {
    return StrategicEngine.getForecast(transactions.filter(isPostable), accounts);
  }, [transactions, accounts]);

  // L-123 step 3e: when the loaded entries are capped, the oldest loaded month may be cut part-way: its bar is the server's
  const [cutFrom, cutTo] = monthRange(useMemo(() => openingCutoff(transactions), [transactions]));
  const { activity, serverMonths } = useServerActivity(cutFrom, cutTo);

  const historicalData = useMemo(() => {
    const monthlyMap: Record<string, number> = {};
    transactions.filter(isPostable).forEach(t => {
      if (!t.date) return;
      const m = t.date.substring(0, 7);
      if (!monthlyMap[m]) monthlyMap[m] = 0;
      t.lines?.forEach(l => {
        const acc = accounts.find(a => a.id === l.accountId);
        if (acc && resolveAccountRole(acc) === 'cash') {
          monthlyMap[m] += lineAmount(l, t) / 100;
        }
      });
    });
    if (serverMonths && cutFrom) {
      const cash = new Set(accounts.filter(a => resolveAccountRole(a) === 'cash').map(a => a.id));
      const m = cutFrom.slice(0, 7);
      monthlyMap[m] = sumActivity(activity, m, m, id => cash.has(id), a => a.net) / 100;
    }
    return Object.entries(monthlyMap).sort((a, b) => a[0].localeCompare(b[0])).map(([m, val]) => ({ month: m, value: val }));
  }, [transactions, accounts, serverMonths, activity, cutFrom]);
  

  return (
    <div className="h-full flex flex-col bg-[var(--ink)] text-[var(--text)]">
      <div className="px-8 py-6 bg-[var(--surface)] border-b border-[var(--line)] text-[var(--text)] flex justify-between items-start shadow-sm">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3 text-[var(--text)]">
            <TrendingUp className="w-6 h-6 text-emerald-500" />
            Cash Forecasting
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Predictive liquidity analysis using Holt-Winters Triple Exponential Smoothing.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="flex p-1 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 mb-6 w-max">
          {[
            { id: 'forecast', label: 'Predictive Forecast (6-Mo)', icon: Activity },
            { id: 'trends', label: 'Historical Trend', icon: BarChart }
          ].map(tab => (
             <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as unknown as React.SetStateAction<"forecast" | "trends">)}
                className={cn(
                   "px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all",
                   activeTab === tab.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-[var(--ink)]"
                )}
             >
                <tab.icon className="w-4 h-4" /> {tab.label}
             </button>
          ))}
        </div>

        {activeTab === 'forecast' && forecastData && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cn(
                "p-4 rounded-2xl border flex items-start gap-4",
                forecastData.riskLevel === 'low' ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
              )}>
                {forecastData.riskLevel === 'low' ? <CheckCircle2 className="text-emerald-500" /> : <ShieldAlert className="text-amber-500" />}
                <div>
                  <h2 className="font-bold text-slate-900 capitalize">{forecastData.riskLevel} Risk Forecast</h2>
                  <p className="text-xs text-slate-600 mt-1">{forecastData.insights[0]}</p>
                </div>
              </div>
              <div className="p-4 rounded-2xl border bg-indigo-50 border-indigo-200 flex items-start gap-4">
                <Zap className="text-indigo-500" />
                <div>
                  <h2 className="font-bold text-slate-900">Strategic Recommendation</h2>
                  <p className="text-xs text-slate-600 mt-1">{forecastData.recommendations[0]}</p>
                </div>
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-[var(--line)] bg-[var(--ink)] flex items-center justify-between">
                 <h2 className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-500" />
                    Liquidity Projections (Deterministic & Statistical)
                 </h2>
              </div>
              <div className="grid grid-cols-12 p-4 bg-[var(--ink)] border-b border-[var(--line)] text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                <div className="col-span-3">Future Period</div>
                <div className="col-span-3 text-right">Inflow</div>
                <div className="col-span-3 text-right">Outflow</div>
                <div className="col-span-3 text-right">Proj. Balance</div>
              </div>
              <div className="divide-y divide-slate-200">
                {forecastData.projections.map((p) => (
                  <div key={p.month} className="grid grid-cols-12 p-4 items-center hover:bg-[var(--ink)] transition-colors">
                    <div className="col-span-3 flex items-center gap-2">
                       <Calendar className="w-4 h-4 text-[var(--muted)]" />
                       <span className="font-bold text-[var(--text)]">{p.month}</span>
                    </div>
                    <div className="col-span-3 text-right font-mono font-bold text-emerald-600 tabular-nums">
                       +{formatCurrency(p.inflow * 100)}
                    </div>
                    <div className="col-span-3 text-right font-mono font-bold text-rose-600 tabular-nums">
                       -{formatCurrency(p.outflow * 100)}
                    </div>
                    <div className="col-span-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                       {formatCurrency(p.balance * 100)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'trends' && (
           <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 shadow-sm">
             <div className="flex h-64 items-end gap-2 mt-4">
                {historicalData.map(d => {
                   const max = Math.max(...historicalData.map(h => Math.abs(h.value)), 1);
                   const height = (Math.abs(d.value) / max) * 100;
                   return (
                      <div key={d.month} className="flex-1 flex flex-col justify-end items-center gap-2 group relative">
                         <div className={cn(
                           "w-full rounded-t-sm transition-colors relative",
                           d.value >= 0 ? "bg-emerald-200 hover:bg-emerald-300" : "bg-rose-200 hover:bg-rose-300"
                         )} style={{ height: `${height}%` }}>
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] py-1 px-2 rounded whitespace-nowrap pointer-events-none z-10 tabular-nums">
                               {formatCurrency(d.value * 100)}
                            </div>
                         </div>
                         <div className="text-[10px] font-bold text-[var(--muted)] uppercase">{d.month.split('-')[1]}</div>
                      </div>
                   )
                })}
             </div>
           </div>
        )}
      </div>
    </div>
  );
}
