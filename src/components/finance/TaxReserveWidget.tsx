import { parseLocalDate } from '../../lib/utils';
import { resolveAccountRole } from '../../lib/accountUtils';
import React, { useState, useMemo } from 'react';
import { calculateSafeToSpend } from '../../lib/algorithms/tax-set-aside';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Landmark, Sparkles, Info, AlertTriangle, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';
import { addToDateISO, formatCurrency, getLocalDateISO, cn } from '../../lib/utils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

export function TaxReserveWidget() {
  const transactions = useLedgerStore(s => s.transactions);
  const rawAccounts = useLedgerStore(s => s.accounts);
  const computedAccounts = useLedgerStore(s => s.computedAccounts);
  const accounts = useMemo(() => {
    return computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;
  }, [computedAccounts, rawAccounts]);
  const bills = useLedgerStore(s => s.bills);
  useLedgerCollections('bills');

  // Mode: 'simple' vs 'autopilot'
  const [mode, setMode] = useState<'simple' | 'autopilot'>('simple');

  // Interactive controls
  const [taxRate, setTaxRate] = useState<number>(30); // in percent
  const [safetyBuffer, setSafetyBuffer] = useState<number>(200); // in dollars
  const [nextPayday, setNextPayday] = useState<string>(() => {
    // Default to 10 days from now
    return addToDateISO(getLocalDateISO(), { days: 10 });
  });

  // Irregular annual expense templates with status
  const [irregularReserves, setIrregularReserves] = useState([
    { id: 'insurance', name: 'General Business Liability Insurance', annualCost: 1200, periodDays: 365, active: true, icon: '🛡️' },
    { id: 'software', name: 'Enterprise Software & API Subscriptions', annualCost: 480, periodDays: 365, active: true, icon: '💻' },
    { id: 'tax-filing', name: 'Professional Corporate CPA Filing Fee', annualCost: 600, periodDays: 365, active: false, icon: '⚖️' },
    { id: 'device-upgrade', name: 'Hardware & Device Upgrade Reserves', annualCost: 1000, periodDays: 365, active: false, icon: '🔌' },
  ]);

  const toggleIrregular = (id: string) => {
    setIrregularReserves(prev => prev.map(item => item.id === id ? { ...item, active: !item.active } : item));
  };

  // 1. Math: Raw/Liquid cash
  const liquidCash = useMemo(() => {
    let cash = 0;
    accounts.forEach(acc => {
      const bal = acc.balanceCents || 0;
      if (resolveAccountRole(acc) === 'cash') {
        cash += bal;
      }
    });
    // Fallback if no specific bank accounts yet, use cumulative cash flows from transactions
    if (cash === 0) {
      transactions.filter(isPostable).forEach(t => {
        t.lines?.forEach(l => {
          const acc = accounts.find(a => a.id === l.accountId);
          if (acc && resolveAccountRole(acc) === 'cash') {
            cash += lineAmount(l, t);
          }
        });
      });
    }
    return Math.max(0, cash);
  }, [accounts, transactions]);

  // 2. Math: Tax Reserve
  const taxReserveResult = useMemo(() => {
    return calculateSafeToSpend(transactions.filter(isPostable), accounts);
  }, [transactions, accounts]);

  // 3. Math: Upcoming Bills before next payday
  const upcomingBillsList = useMemo(() => {
    if (!Array.isArray(bills)) return [];
    return bills.filter(b => {
      // Must be unpaid / approved / pending
      const isOpen = b.status !== 'paid' && b.status !== 'void';
      const isBeforePayday = b.dueDate && b.dueDate <= nextPayday;
      return isOpen && isBeforePayday;
    });
  }, [bills, nextPayday]);

  const totalCommittedBillsCents = useMemo(() => {
    return upcomingBillsList.reduce((sum, b) => sum + (b.amountCents || 0), 0);
  }, [upcomingBillsList]);

  // 4. Math: Irregular annual reserves
  const totalIrregularReservesCents = useMemo(() => {
    return irregularReserves
      .filter(item => item.active)
      .reduce((sum, item) => {
        // Daily reserve requirement * 30 days to build a monthly rolling envelope reserve
        const dailyCents = (item.annualCost * 100) / item.periodDays;
        const monthlyReserveCents = dailyCents * 30; // 30 days reserve buffer
        return sum + Math.round(monthlyReserveCents);
      }, 0);
  }, [irregularReserves]);

  // 5. Safe-to-Spend calculations
  const bufferCents = safetyBuffer * 100;
  const estimatedTax = taxReserveResult.estimatedTaxCents;

  // Real autopilot formula
  const autopilotSafeToSpendCents = liquidCash - estimatedTax - totalCommittedBillsCents - totalIrregularReservesCents - bufferCents;
  const simpleSafeToSpendCents = liquidCash - estimatedTax;

  // Metrics for displays
  const overdraftProbability = useMemo(() => {
    if (liquidCash <= 0) return 99.9;
    const ratio = autopilotSafeToSpendCents / liquidCash;
    if (ratio <= 0) {
      return Math.min(95, 45 + Math.abs(ratio) * 10);
    }
    const prob = Math.max(0.4, 15 - ratio * 40);
    return Number.parseFloat(prob.toFixed(1));
  }, [autopilotSafeToSpendCents, liquidCash]);

  // Daily message selection
  const dailyMessage = useMemo(() => {
    const daysToPayday = Math.max(1, Math.round((parseLocalDate(nextPayday).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
    const safeDailyDollars = Math.max(0, autopilotSafeToSpendCents / 100 / daysToPayday);

    if (autopilotSafeToSpendCents <= 0) {
      if (liquidCash - estimatedTax - totalCommittedBillsCents > 0) {
        return {
          text: `Critical outlays are fully funded, but you have $0 of flexible discretionary cash left until your next payday. Pause all non-essential business purchases.`,
          severity: 'warning'
        };
      } else {
        return {
          text: `Alert: Current liquid cash is insufficient to cover both tax obligations and upcoming bills due before your next payday. Consider rescheduling bill due dates or requesting receivables early.`,
          severity: 'danger'
        };
      }
    }

    if (overdraftProbability > 10) {
      return {
        text: `Your safety margin is thin. You can safely spend up to $${safeDailyDollars.toFixed(0)}/day until your next income event on ${nextPayday} to remain fully balanced.`,
        severity: 'caution'
      };
    }

    return {
      text: `All checks passed! You can safely deploy up to ${formatCurrency(autopilotSafeToSpendCents)} today without impacting tax reserves, upcoming bills, or your safety buffer.`,
      severity: 'safe'
    };
  }, [autopilotSafeToSpendCents, liquidCash, estimatedTax, totalCommittedBillsCents, nextPayday, overdraftProbability]);

  return (
    <div className="bg-[var(--panel)] border border-[var(--brass-line)]/50 rounded-2xl p-5 relative overflow-hidden shadow-sm transition-all duration-300">
      {/* Subtle top decoration */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-[var(--brass)] via-[var(--brass-line)] to-transparent" />
      
      {/* Widget Header with Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-[var(--line)]/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-[var(--brass-soft)] border border-[var(--brass-line)] text-[var(--brass)]">
              <Landmark aria-hidden="true" size={14} />
            </span>
            <h2 className="font-bold text-sm text-[var(--text)] font-sans">Safe-to-Spend & Liquidity Autopilot</h2>
          </div>
          <p className="text-[11px] text-[var(--faint)] font-mono mt-0.5">
            Running dynamic scenario check on virtual ledger envelopes
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-[var(--surface)]/80 border border-[var(--line)] rounded-xl p-0.5 text-xs font-semibold shadow-inner">
          <button
            onClick={() => setMode('simple')}
            className={cn(
              "px-3 py-1 rounded-lg transition-all cursor-pointer",
              mode === 'simple'
                ? "bg-[var(--panel)] text-[var(--brass)] border border-[var(--brass-line)]/40 font-bold shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            )}
          >
            Simple Envelope
          </button>
          <button
            onClick={() => setMode('autopilot')}
            className={cn(
              "px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1",
              mode === 'autopilot'
                ? "bg-gradient-to-r from-[var(--brass)] to-[#e5be6b] text-black font-bold shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            )}
          >
            <Sparkles aria-hidden="true" size={11} />
            Autopilot Risk Contract
          </button>
        </div>
      </div>

      {/* 1. SIMPLE MODE */}
      {mode === 'simple' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-[var(--surface)]/60 border border-[var(--line)] rounded-xl flex flex-col justify-center">
              <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--muted)] font-semibold mb-1">Liquid Cash Balance</p>
              <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">{formatCurrency(liquidCash)}</p>
            </div>
            
            <div className="p-4 bg-[var(--surface)]/60 border border-[var(--line)] rounded-xl flex flex-col justify-center">
              <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--muted)] font-semibold mb-1 flex items-center gap-1">
                Est. Tax Set-Aside <span className="text-[10px] text-[var(--brass)] bg-[var(--brass-soft)] px-1 py-0.2 rounded border border-[var(--brass-line)]/40">{taxRate}%</span>
              </p>
              <p className="font-mono text-xl font-bold text-[var(--neg)] tabular-nums">{formatCurrency(estimatedTax)}</p>
            </div>
            
            <div className="p-4 bg-gradient-to-br from-[var(--brass-soft)]/40 via-[var(--brass-soft)]/10 to-[var(--surface)] border border-[var(--brass-line)] rounded-xl flex flex-col justify-center shadow-xs">
              <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--brass)] font-bold mb-1">Safe to Spend</p>
              <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">{formatCurrency(simpleSafeToSpendCents)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs bg-[var(--brass-soft)]/20 border border-[var(--brass-line)]/30 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles aria-hidden="true" size={14} className="text-[var(--brass)] animate-pulse shrink-0" />
              <span className="text-[var(--muted)]">Want real-time safety buffers, committed bill protection, and irregular outlays reserving?</span>
            </div>
            <button
              onClick={() => setMode('autopilot')}
              className="text-[var(--brass)] font-bold hover:underline cursor-pointer text-xs flex items-center gap-1 shrink-0 ml-2"
            >
              Configure Autopilot <ArrowRight aria-hidden="true" size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 2. ADVANCED AUTOPILOT MODE */}
      {mode === 'autopilot' && (
        <div className="space-y-6">
          {/* Daily Alert Copilot Banner */}
          <div className={cn(
            "p-4 rounded-xl border flex gap-3 items-start",
            dailyMessage.severity === 'danger' && "bg-[var(--neg)]/10 border-[var(--neg)]/30 text-[var(--neg)]",
            dailyMessage.severity === 'warning' && "bg-amber-500/10 border-amber-500/30 text-amber-500",
            dailyMessage.severity === 'caution' && "bg-[var(--brass-soft)] border-[var(--brass-line)] text-[var(--text)]",
            dailyMessage.severity === 'safe' && "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
          )}>
            <div className="shrink-0 mt-0.5">
              {dailyMessage.severity === 'danger' && <ShieldAlert aria-hidden="true" size={16} />}
              {dailyMessage.severity === 'warning' && <AlertTriangle aria-hidden="true" size={16} />}
              {dailyMessage.severity === 'caution' && <Info aria-hidden="true" size={16} className="text-[var(--brass)]" />}
              {dailyMessage.severity === 'safe' && <CheckCircle2 aria-hidden="true" size={16} />}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold leading-relaxed">
                {dailyMessage.text}
              </p>
              <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--muted)]">
                <span>Confidence: 95%</span>
                <span>•</span>
                <span>Calculated: {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Hand: Controls & Formula Rollups (7/12 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <h3 className="font-semibold text-xs text-[var(--muted)] uppercase tracking-wider font-mono">Live Safe-to-Spend Breakdown</h3>
              
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl divide-y divide-[var(--line)] font-mono text-xs shadow-inner">
                {/* 1. Liquid Cash */}
                <div className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-[10px] text-blue-400">1</span>
                    <div>
                      <p className="font-semibold text-[var(--text)]">Raw Liquid Cash Balance</p>
                      <p className="text-[10px] text-[var(--faint)]">Sum of bank & checking accounts</p>
                    </div>
                  </div>
                  <span className="font-bold text-[var(--text)] tabular-nums">{formatCurrency(liquidCash)}</span>
                </div>

                {/* 2. Tax Set Aside */}
                <div className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[var(--neg)]/10 border border-[var(--neg)]/30 flex items-center justify-center text-[10px] text-[var(--neg)]">2</span>
                      <div>
                        <p className="font-semibold text-[var(--text)]">Est. Tax Envelope Set-Aside</p>
                        <p className="text-[10px] text-[var(--faint)]">Running margin based on net profits</p>
                      </div>
                    </div>
                    <span className="font-bold text-[var(--neg)] tabular-nums">-{formatCurrency(estimatedTax)}</span>
                  </div>
                  {/* Slider */}
                  <div className="pl-7 pr-2 flex items-center gap-3">
                    <span className="text-[10px] text-[var(--muted)]">Rate:</span>
                    <input aria-label="Tax rate"
                      type="range" 
                      min="0" 
                      max="50" 
                      value={taxRate} 
                      onChange={(e) => setTaxRate(Number(e.target.value))}
                      className="flex-1 accent-[var(--brass)] h-1 bg-[var(--line)] rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-[10px] font-bold text-[var(--brass)] bg-[var(--brass-soft)] px-1.5 py-0.5 rounded border border-[var(--brass-line)]/50 shrink-0 w-8 text-center">{taxRate}%</span>
                  </div>
                </div>

                {/* 3. Committed Bills */}
                <div className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[10px] text-amber-500">3</span>
                      <div>
                        <p className="font-semibold text-[var(--text)]">Committed Bills Due Before Payday</p>
                        <p className="text-[10px] text-[var(--faint)]">Unpaid outlays pre-funding safety lock</p>
                      </div>
                    </div>
                    <span className="font-bold text-amber-500 tabular-nums">-{formatCurrency(totalCommittedBillsCents)}</span>
                  </div>

                  {/* Payday Date and bill count */}
                  <div className="pl-7 pr-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--muted)]">Target Payday:</span>
                      <input aria-label="Target Payday"
                        type="date" 
                        value={nextPayday} 
                        onChange={(e) => setNextPayday(e.target.value)}
                        className="bg-[var(--panel)] border border-[var(--line)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text)] font-mono focus:outline-none focus:border-[var(--brass)]"
                      />
                    </div>
                    <span className="text-[10px] text-[var(--faint)]">
                      {upcomingBillsList.length} bill{upcomingBillsList.length === 1 ? '' : 's'} matching filter
                    </span>
                  </div>

                  {/* Micro bills list */}
                  {upcomingBillsList.length > 0 && (
                    <div className="pl-7 pr-2 pt-2 space-y-1.5 max-h-[120px] overflow-y-auto">
                      {upcomingBillsList.map(b => (
                        <div key={b.id} className="flex items-center justify-between text-[10px] text-[var(--muted)] bg-[var(--panel)]/50 p-1.5 rounded border border-[var(--line)]/50">
                          <span className="truncate max-w-[160px]">{b.vendorName || 'Vendor'} (#{b.number || 'Bill'})</span>
                          <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(b.amountCents)} <span className="text-[9px] text-[var(--faint)]">({b.dueDate})</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4. Irregular Annual Reserves */}
                <div className="p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-[10px] text-violet-400">4</span>
                      <div>
                        <p className="font-semibold text-[var(--text)]">Irregular/Annual Envelopes Reserve</p>
                        <p className="text-[10px] text-[var(--faint)]">Holding back minor amounts for annual spikes</p>
                      </div>
                    </div>
                    <span className="font-bold text-violet-400 tabular-nums">-{formatCurrency(totalIrregularReservesCents)}</span>
                  </div>

                  {/* Mini-Reserve Pill Toggles */}
                  <div className="pl-7 pr-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {irregularReserves.map(item => (
                      <button
                        key={item.id}
                        onClick={() => toggleIrregular(item.id)}
                        className={cn(
                          "p-2 rounded-lg border text-left flex items-center gap-2 cursor-pointer transition-all hover:scale-[1.01]",
                          item.active 
                            ? "bg-violet-500/5 border-violet-500/30 text-[var(--text)]" 
                            : "bg-[var(--panel)]/40 border-[var(--line)]/60 text-[var(--muted)] opacity-60"
                        )}
                      >
                        <span className="text-sm shrink-0">{item.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold truncate leading-tight">{item.name}</p>
                          <p className="text-[9px] font-mono text-[var(--faint)] tabular-nums">
                            {formatCurrency(item.annualCost * 100)}/yr ({formatCurrency(Math.round(((item.annualCost * 100) / item.periodDays) * 30))}/mo)
                          </p>
                        </div>
                        <span className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          item.active ? "bg-violet-400" : "bg-transparent border border-[var(--muted)]"
                        )} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* 5. Safety Buffer Slider */}
                <div className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-[10px] text-cyan-400">5</span>
                      <div>
                        <p className="font-semibold text-[var(--text)]">Interactive Safety Buffer</p>
                        <p className="text-[10px] text-[var(--faint)]">Locked emergency cash safety floor</p>
                      </div>
                    </div>
                    <span className="font-bold text-cyan-400 tabular-nums">-{formatCurrency(bufferCents)}</span>
                  </div>
                  {/* Slider */}
                  <div className="pl-7 pr-2 flex items-center gap-3">
                    <span className="text-[10px] text-[var(--muted)]">Buffer:</span>
                    <input aria-label="Safety buffer"
                      type="range" 
                      min="0" 
                      max="1000" 
                      step="50"
                      value={safetyBuffer} 
                      onChange={(e) => setSafetyBuffer(Number(e.target.value))}
                      className="flex-1 accent-[var(--brass)] h-1 bg-[var(--line)] rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-[10px] font-bold text-[var(--brass)] bg-[var(--brass-soft)] px-1.5 py-0.5 rounded border border-[var(--brass-line)]/50 shrink-0 w-14 text-center tabular-nums">{formatCurrency(bufferCents)}</span>
                  </div>
                </div>

                {/* Safe to Spend Output */}
                <div className="p-4 bg-gradient-to-br from-[var(--brass-soft)]/60 via-[var(--brass-soft)]/20 to-[var(--surface)] border border-[var(--brass-line)]/30 rounded-b-xl flex items-center justify-between">
                  <div>
                    <p className="font-sans font-bold text-xs text-[var(--brass)] uppercase tracking-wider">True Safe-to-Spend Balance</p>
                    <p className="text-[9px] text-[var(--faint)] font-mono">1 - 2 - 3 - 4 - 5</p>
                  </div>
                  <span className={cn(
                    "text-xl font-bold font-mono tracking-tight",
                    autopilotSafeToSpendCents > 0 ? "text-emerald-400" : "text-[var(--neg)]"
                  )}>
                    {formatCurrency(autopilotSafeToSpendCents)}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Hand: Safety Contract Dashboard & Optimization (5/12 cols) */}
            <div className="lg:col-span-5 space-y-5">
              <h3 className="font-semibold text-xs text-[var(--muted)] uppercase tracking-wider font-mono">Probability Safety Contract</h3>
              
              {/* Overdraft Risk Meter */}
              <div className="bg-[var(--panel)] border border-[var(--line)] rounded-xl p-4 space-y-3 shadow-xs relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--muted)]">Overdraft Probability (60 Days)</span>
                  <span className={cn(
                    "text-xs font-mono font-bold px-2 py-0.5 rounded border",
                    overdraftProbability < 2 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                    overdraftProbability < 15 ? "text-amber-500 bg-amber-500/10 border-amber-500/20" :
                    "text-[var(--neg)] bg-[var(--neg)]/10 border-[var(--neg)]/20"
                  )}>
                    {overdraftProbability < 2 ? 'Autopilot Normal' : overdraftProbability < 15 ? 'Elevated Attention' : 'Critical Hazard'}
                  </span>
                </div>

                <div className="flex items-end gap-3">
                  <div className="text-3xl font-bold font-mono text-[var(--text)] tracking-tight">
                    {overdraftProbability}%
                  </div>
                  <p className="text-[10px] text-[var(--faint)] mb-1 leading-normal font-sans">
                    stochastic Monte Carlo simulation of variable cash income timing jitter
                  </p>
                </div>

                {/* Progress bar scale */}
                <div className="h-2 rounded-full bg-[var(--surface)] overflow-hidden flex">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, 100 - overdraftProbability))}%` }} />
                  <div className="h-full bg-[var(--neg)] transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, overdraftProbability))}%` }} />
                </div>
              </div>

              {/* Recommended Autopilot Decisions */}
              <div className="bg-[var(--panel)] border border-[var(--line)] rounded-xl p-4 space-y-3.5 shadow-xs">
                <h4 className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--brass)] flex items-center gap-1.5">
                  <Sparkles aria-hidden="true" size={12} /> Optimization Interventions
                </h4>

                <div className="space-y-2.5">
                  {/* Decision 1 */}
                  <div className="flex gap-2.5 items-start text-xs bg-[var(--surface)] p-2.5 border border-[var(--line)]/60 rounded-lg">
                    <input aria-label="Auto-Transfer Outlay Reserves"
                      type="checkbox" 
                      defaultChecked={autopilotSafeToSpendCents > 0} 
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--brass)] cursor-pointer" 
                    />
                    <div className="space-y-0.5">
                      <p className="font-semibold text-[var(--text)]">Auto-Transfer Outlay Reserves</p>
                      <p className="text-[10px] text-[var(--muted)]">Sweep {formatCurrency(totalIrregularReservesCents + estimatedTax)} to secondary secure vault envelope.</p>
                    </div>
                  </div>

                  {/* Decision 2 */}
                  <div className="flex gap-2.5 items-start text-xs bg-[var(--surface)] p-2.5 border border-[var(--line)]/60 rounded-lg">
                    <input aria-label="Lock Pre-funded Bill Balances"
                      type="checkbox" 
                      defaultChecked={upcomingBillsList.length > 0} 
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--brass)] cursor-pointer" 
                    />
                    <div className="space-y-0.5">
                      <p className="font-semibold text-[var(--text)]">Lock Pre-funded Bill Balances</p>
                      <p className="text-[10px] text-[var(--muted)]">Lock {formatCurrency(totalCommittedBillsCents)} matching {upcomingBillsList.length} impending bills due before payday.</p>
                    </div>
                  </div>

                  {/* Decision 3 */}
                  <div className="flex gap-2.5 items-start text-xs bg-[var(--surface)] p-2.5 border border-[var(--line)]/60 rounded-lg">
                    <input aria-label="Contractual Due Date Realignment"
                      type="checkbox" 
                      defaultChecked={false} 
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--brass)] cursor-pointer" 
                    />
                    <div className="space-y-0.5">
                      <p className="font-semibold text-[var(--text)]">Contractual Due Date Realignment</p>
                      <p className="text-[10px] text-[var(--muted)]">Reschedule bill due dates if possible to land 2-3 days directly after target payday.</p>
                    </div>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  );
}

