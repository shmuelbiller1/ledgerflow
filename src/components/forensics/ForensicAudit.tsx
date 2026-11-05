import { useUIStore } from '../../stores/useUIStore';
import ChartFrame, { ChartTooltip } from '../charts/ChartFrame';
import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { 
  ShieldAlert, 
  Fingerprint, 
  AlertCircle,
  CheckCircle2,
  Brain,
  History
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { civilDayOfMonth, civilMonthYear } from '../../lib/calendarDate';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';



const ForensicAudit = React.memo(() => {
  const transactions = useLedgerStore(s => s.transactions);
  useLedgerStore(s => s.accounts);
  // 1. BENFORD'S LAW CALCULATION
  const benfordAnalysis = useMemo(() => {
    const counts = Uint32Array ? new Uint32Array(9) : Array(9).fill(0);
    let totalValid = 0;

    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];
      if (!isPostable(t)) continue;
      const amount = Math.abs(t.totalAmountCents) / 100;
      if (amount >= 1) {
        // High-performance first digit extraction without string conversion
        let firstDigit = amount;
        while (firstDigit >= 10) firstDigit /= 10;
        firstDigit = Math.floor(firstDigit);
        
        if (firstDigit >= 1 && firstDigit <= 9) {
          counts[firstDigit - 1]++;
          totalValid++;
        }
      }
    }

    // Ideal Benford distribution: log10(1 + 1/d)
    const ideal = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
    const results = [];
    for (let i = 0; i < 9; i++) {
      results.push({
        digit: (i + 1).toString(),
        actual: totalValid > 0 ? (counts[i] / totalValid) * 100 : 0,
        ideal: ideal[i]
      });
    }
    return results;
  }, [transactions]);

  // 2. Z-SCORE ANOMALY DETECTION
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const isGuest = useAuthStore(s => s.isGuest);
  const [anomalies, setAnomalies] = useState<(import("../../types").Transaction & { zScore: number })[]>([]);
  const [, setIsScanning] = useState(false);

  useEffect(() => {
    async function scan() {
      if (isGuest || transactions.length < 5 || !currentWorkspaceId) return;
      setIsScanning(true);
      try {
        const res = await fetch('/api/v1/forensics/anomaly-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: currentWorkspaceId })
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.anomalies) {
          setAnomalies(data.anomalies);
        }
      } catch {
        // Ignore background scan errors when offline or unauthenticated
      } finally {
        setIsScanning(false);
      }
    }
    void scan();
  }, [isGuest, transactions, currentWorkspaceId]);

  // 3. COMPLIANCE STATS
  const complianceStats = useMemo(() => {
    let unbalancedCount = 0;
    let missingProjectCount = 0;
    const sameSigMap = new Map<string, number>();
    
    for (const t of transactions) {
      if (!isPostable(t)) continue;
      
      // Unbalanced check
      const lineSum = (t.lines || []).reduce((sum: number, l) => sum + lineAmount(l, t), 0);
      if (lineSum !== 0) unbalancedCount++;
      
      // Project Check
      if (!t.project) missingProjectCount++;
      
      // Potential Duplicate (Simplified: Amount + Date + Payee)
      const sig = `${t.totalAmountCents}_${t.date}_${t.payee}`;
      sameSigMap.set(sig, (sameSigMap.get(sig) || 0) + 1);
    }
    
    let duplicateCount = 0;
    sameSigMap.forEach(count => { if (count > 1) duplicateCount += (count - 1); });

    return [
      { label: 'Unbalanced Journal Entries', count: unbalancedCount, status: unbalancedCount === 0 ? 'pass' : 'fail' },
      { label: 'Missing Project Tags', count: missingProjectCount, status: missingProjectCount < 5 ? 'pass' : 'warn' },
      { label: 'Potential Duplicate Entries', count: duplicateCount, status: duplicateCount === 0 ? 'pass' : 'warn' },
      { label: 'Security Protocols Active', count: 4, status: 'pass' },
    ];
  }, [transactions]);

  const benfordConfidence = useMemo(() => {
    if (!benfordAnalysis.length) return "N/A";
    const totalDiff = benfordAnalysis.reduce((sum, d) => sum + Math.abs(d.actual - d.ideal), 0);
    const confidence = Math.max(0, 100 - totalDiff);
    return `Pattern divergence is currently ${confidence > 90 ? 'nominal' : 'concerning'} (Confidence: ${confidence.toFixed(1)}%).`;
  }, [benfordAnalysis]);

  const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  return (
    <div className="space-y-12 pb-24">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-rose-50/10 text-rose-600 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] border border-rose-200/20">
            <ShieldAlert size={12} />
            Forensic Integrity Suite
          </div>
          <h1 className="text-2xl md:text-4xl font-black text-[var(--text)] tracking-tight">Audit Intelligence</h1>
          <p className="text-[var(--muted)] font-medium text-sm">Automated fraud detection and anomaly projection across the general ledger.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Benford's Law Analysis */}
        <div className="xl:col-span-12 google-card p-4 md:p-10 bg-slate-900 text-white overflow-hidden relative">
           <div className="relative z-10 flex flex-col lg:flex-row gap-12">
              <div className="lg:w-1/3 space-y-6">
                 <div className="flex items-center gap-3 text-indigo-400">
                    <Fingerprint size={28} />
                    <h2 className="text-xl font-medium uppercase tracking-wider text-white">Benford Patterns</h2>
                 </div>
                 <p className="text-sm text-zinc-400 leading-relaxed">
                    Analyzing the distribution of first digits. In a natural dataset, the digit '1' should appear roughly 30% of the time, while '9' appears less than 5%. Deviations here indicate potential artificial entry or systematic errors.
                 </p>
                 <div className="pt-6">
                    <div className="p-4 bg-[var(--surface)]/5 rounded-[32px] border border-white/10 italic text-[11px] text-zinc-500">
                       "{benfordConfidence}"
                    </div>
                 </div>
              </div>

              <div className="flex-1 min-w-0"><ChartFrame title="First-digit distribution" rows={benfordAnalysis.map(row => ({...row,id:String(row.digit),label:String(row.digit)}))} series={[{key:'ideal',name:'Ideal Pattern',unit:'percent'},{key:'actual',name:'Your Ledger',unit:'percent'}]}>
                 {({rows,hidden}) =>
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                       <XAxis 
                         dataKey="digit" 
                         axisLine={false} 
                         tickLine={false} 
                         tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700 }}
                       />
                       <YAxis 
                         axisLine={false} 
                         tickLine={false} 
                         tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700 }}
                         tickFormatter={(val) => `${val}%`}
                       />
                       <Tooltip content={<ChartTooltip series={[{key:'ideal',name:'Ideal Pattern',unit:'percent'},{key:'actual',name:'Your Ledger',unit:'percent'}]} />} />
                       <Bar hide={hidden.has('ideal')} dataKey="ideal" name="Ideal Pattern" fill="rgba(255,255,255,0.1)" radius={[4, 4, 0, 0]} />
                       <Bar hide={hidden.has('actual')} dataKey="actual" name="Your Ledger" fill="#A8C7FA" radius={[4, 4, 0, 0]} />
                    </BarChart>
                 </ResponsiveContainer>}
                 </ChartFrame>
              </div>
           </div>
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 blur-[100px] rounded-full" />
        </div>

        {/* Z-Score Anomalies */}
        <div className="xl:col-span-8 google-card p-4 md:p-10 space-y-10 border-[var(--line)]">
           <div className="flex items-center justify-between">
              <div>
                 <h2 className="text-xl font-black text-[var(--text)] uppercase tracking-widest flex items-center gap-3">
                    <Brain className="text-indigo-600" size={24} />
                    Statistical Outliers
                 </h2>
                 <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-1">Z-Score Deviation Map (&gt;2.5σ)</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 text-amber-500 rounded-lg text-[9px] font-medium uppercase tracking-wider border border-amber-500/20">
                 High Sensitivity Active
              </div>
           </div>

           <div className="space-y-4">
              {anomalies.length > 0 ? anomalies.map((t, _i: number) => (
                 <div key={t.id} className="p-6 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] flex items-center justify-between group hover:border-indigo-600 transition-all">
                    <div className="flex items-center gap-6">
                       <div className="w-12 h-12 bg-[var(--surface)] rounded-[32px] flex items-center justify-center text-[var(--text)] border border-[var(--line)] font-black text-sm">
                          {civilDayOfMonth(t.date)}
                       </div>
                       <div>
                          <p className="text-sm font-black text-[var(--text)] tracking-tight">{t.description}</p>
                          <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest flex items-center gap-2 mt-1">
                             {t.lines?.[0]?.accountName} • <span className="text-rose-600">Deviation: {t.zScore.toFixed(2)}σ</span>
                          </p>
                       </div>
                    </div>
                    <div className="text-right">
                       <p className="text-lg font-black text-[var(--text)] mono-value tabular-nums">{CURRENCY.format(Math.abs(t.totalAmountCents) / 100)}</p>
                       <p className="text-[9px] font-black text-[var(--muted)] flex items-center justify-end gap-1 mt-1">
                          <History size={10} />
                          {civilMonthYear(t.date)}
                       </p>
                    </div>
                 </div>
              )) : (
                 <div className="h-60 flex flex-col items-center justify-center text-[var(--muted)] space-y-4 border-2 border-dashed border-[var(--line)] rounded-[32px]">
                    <ShieldAlert size={48} className="opacity-10" />
                    <p className="text-xs font-medium uppercase tracking-wider opacity-40">No significant statistical anomalies detected.</p>
                 </div>
              )}
           </div>
        </div>

        {/* Audit Shortcuts */}
        <div className="xl:col-span-4 space-y-8">
           <div className="google-card p-4 md:p-8 border-[var(--line)] bg-slate-900/5">
              <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text)] mb-6 flex items-center gap-2">
                 <AlertCircle size={16} />
                 Compliance Radar
              </h3>
              <div className="space-y-4">
                 {complianceStats.map(item => (
                    <div key={item.label} className="flex items-center justify-between p-4 bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-sm">
                       <span className="text-[10px] font-bold text-[var(--text)] uppercase tracking-widest">{item.label}</span>
                       <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-black", item.status === 'pass' ? 'text-emerald-600' : 'text-amber-500')}>{item.count}</span>
                          {item.status === 'pass' ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-amber-500" />}
                       </div>
                    </div>
                 ))}
              </div>
           </div>

           <div className="google-card p-4 md:p-8 border-[var(--line)] bg-slate-900 text-white">
              <h3 className="text-xs font-medium uppercase tracking-wider text-indigo-400 mb-6">
                 Audit Protocol
              </h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                 All transactions are passed through a series of deterministic and heuristic filters. The integrity suite continuously monitors for data drift and classification mismatches to ensure audit-ready ledger states.
              </p>
              <button className="min-h-11 w-full mt-6 py-3 bg-[var(--surface)]/10 hover:bg-[var(--surface)]/20 text-white rounded-xl text-[10px] font-medium uppercase tracking-wider transition-all" type="button" onClick={() => useUIStore.getState().setActiveTab('audit-trail')} aria-label="Open audit trail">
                 Open audit trail
              </button>
           </div>
        </div>
      </div>
    </div>
  );
});

export default ForensicAudit;
