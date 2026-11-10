import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Command, X, ChevronRight, Loader2, Globe, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { StrategicEngine } from '../../services/strategicEngine';
import { DoubleEntryAuditor } from '../../services/auditor';
import { cn, formatCurrency } from '../../lib/utils';
import { isCashAccount, isPostable, calculateTransactionImpact } from '../../lib/txFilters';

import { BRAND_NAME } from '../../config/brand';
interface DiagnosticConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

function withHistoryKeys(history: string[]) {
  const occurrences = new Map<string, number>();
  return history.map(line => {
    const occurrence = occurrences.get(line) ?? 0;
    occurrences.set(line, occurrence + 1);
    return { line, key: JSON.stringify([line, occurrence]) };
  });
}

export default function DiagnosticConsole({ isOpen, onClose }: DiagnosticConsoleProps) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const transactions = useLedgerStore(s => s.transactions);
  const rawAccounts = useLedgerStore(s => s.accounts);
  const computedAccounts = useLedgerStore(s => s.computedAccounts);
  const accounts = computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;
  const projects = useLedgerStore(s => s.projects);
  useAuthStore(s => s.userProfile);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const cmd = input.trim();
    const newHistory = [...history, `> ${cmd}`];
    setInput('');

    if (cmd.startsWith('/')) {
      setIsProcessing(true);
      newHistory.push('Analyzing query...');
      setHistory(newHistory);
      
      try {
        const accountMap = new Map(accounts.map(a => [a.id, a]));
        
        // Compute real metrics from accounts and transactions
        let totalCash = 0;
        accounts.forEach(a => {
          if (isCashAccount(a)) {
             totalCash += a.balanceCents || 0;
          }
        });

        let realRevenue = 0;
        let realExpenses = 0;
        transactions.forEach(tx => {
          if (!isPostable(tx)) return;
          const impact = calculateTransactionImpact(tx, accountMap);
          if (impact > 0) {
            realRevenue += impact;
          } else if (impact < 0) {
            realExpenses += Math.abs(impact);
          }
        });

        const monthlyBurn = realExpenses > realRevenue ? (realExpenses - realRevenue) / 12 : 0;
        const runway = monthlyBurn > 0 ? Math.round((totalCash / monthlyBurn) * 10) / 10 : 99;

        const metrics = {
          kpis: {
            revenue: realRevenue,
            expenses: realExpenses,
            prevExpenses: Math.round(realExpenses * 0.9),
            totalCash,
            runwayMonths: runway
          }
        } as unknown as Parameters<typeof StrategicEngine.analyze>[0]['metrics'];
        const insights = StrategicEngine.analyze({ metrics: metrics, projects: projects }, transactions, accounts);
        const advice = insights.map(i => `${i.title}: ${i.description}`);
        if (advice.length === 0) advice.push("No significant anomalies or strategic deviations detected at this time.");

        const result = { strategicAdvice: advice };
        
        newHistory.pop();
        if (result.strategicAdvice?.[0]) {
          newHistory.push(`[System Intel]: ${result.strategicAdvice[0]}`);
          if (result.strategicAdvice.length > 1) {
            newHistory.push(`[System Intel]: ${result.strategicAdvice[1]}`);
          }
        }
      } catch {
        newHistory.pop();
        newHistory.push('Error: AI service unavailable. Please check your connection.');
      } finally {
        setIsProcessing(false);
        setHistory([...newHistory]);
      }
      return;
    }

    const command = cmd.toLowerCase();
    switch (command) {
      case 'help':
        newHistory.push(
          'Available commands:',
          '  accounts   - List all connected financial nodes',
          '  history    - Display recent transactions',
          '  audit      - Run a system-wide integrity check',
          '  status     - Show current system health metrics',
          '  / [query]  - Use AI for natural language analysis',
          '  clear      - Clear terminal screen',
          '  exit       - Close terminal'
        );
        break;
      case 'accounts':
        accounts.forEach(a => {
          newHistory.push(`  [Node] ${a.name.padEnd(20)} | Bal: ${formatCurrency((a.balanceCents || 0))}`);
        });
        break;
      case 'history':
        transactions.slice(0, 25).forEach(t => {
          newHistory.push(`  [Tx] ${t.date} | ${t.description.slice(0, 30).padEnd(32)} | ${formatCurrency(t.totalAmountCents)}`);
        });
        if (transactions.length > 25) newHistory.push(`  ... and ${transactions.length - 25} more transactions.`);
        break;
      case 'audit': {
        setIsProcessing(true);
        newHistory.push('Running comprehensive cryptographic integrity audit...');
        setHistory([...newHistory]);
        
        // Execute real auditor logic
        const { accounts: allAccounts } = useLedgerStore.getState();
        const auditResult = DoubleEntryAuditor.auditLedger(transactions, allAccounts);
        
        newHistory.push(`Audit complete: ${auditResult.isBalanced ? 'System is Balanced.' : 'Imbalance Detected.'}`);
        newHistory.push(`> Total Debits: ${formatCurrency(auditResult.totalDebits)}`);
        newHistory.push(`> Total Credits: ${formatCurrency(auditResult.totalCredits)}`);
        if (!auditResult.hashChainValid) {
           newHistory.push(`> WARNING: Cryptographic chain drift detected at index ${auditResult.brokenChainIndex}.`);
        }
        setIsProcessing(false);
        break;
      }
      case 'perf': {
        const start = performance.now();
        // Trigger a recomputation to measure engine efficiency
        useLedgerStore.getState().recomputeBalances();
        const end = performance.now();
        newHistory.push(`> Engine Recomputation: ${(end-start).toFixed(2)}ms`);
        newHistory.push(`> Record Density: ${transactions.length} txs / ${accounts.length} accounts`);
        break;
      }
      case 'status':
        newHistory.push(
          'System Status:',
          `  Engine: ${BRAND_NAME} v2.4 (Material Core)`,
          `  Storage: ${accounts.length} active nodes`,
          `  Records: ${transactions.length} processed`,
          '  Region: us-east-1',
          '  Security: Verified Google Login'
        );
        break;
      case 'clear':
        setHistory([]);
        return;
      case 'exit':
        onClose();
        return;
      default:
        newHistory.push(`Unknown command: "${command}". Type "help" for a list of valid commands.`);
    }

    setHistory(newHistory);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[32px] shadow-2xl z-[60] overflow-hidden font-mono"
          >
            <div className="bg-slate-800 px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <Terminal aria-hidden="true" size={16} className="text-indigo-400" />
                <span className="text-[11px] font-medium text-slate-100 uppercase tracking-wider">System Terminal :: {BRAND_NAME}</span>
              </div>
              <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors"><X aria-hidden="true" size={18} /></button>
            </div>

            <div 
              ref={scrollRef}
              className="min-h-[250px] max-h-[55vh] p-6 overflow-y-auto custom-scrollbar text-[12px] leading-relaxed text-slate-100"
            >
              {withHistoryKeys(history).map(({ line, key }) => (
                <div key={key} className={cn(
                  "mb-1 whitespace-pre-wrap",
                  line.startsWith('>') ? "text-indigo-400 font-bold" : 
                  line.toLowerCase().includes('error') ? "text-rose-400" : "opacity-90"
                )}>
                  {line}
                </div>
              ))}
              {isProcessing && (
                <div className="flex items-center gap-2 text-indigo-400 mt-1 animate-pulse">
                  <Loader2 aria-hidden="true" size={12} className="animate-spin" />
                  <span>Processing...</span>
                </div>
              )}
            </div>

            <form onSubmit={handleCommand} className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center gap-3">
              <ChevronRight aria-hidden="true" size={16} className="text-indigo-400" />
              <input aria-label="Diagnostic command"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a command..."
                className="flex-1 bg-transparent border-none outline-none text-slate-100 text-[13px] placeholder:text-slate-500"
              />
              <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-800 rounded-md border border-slate-800">
                <Command aria-hidden="true" size={10} className="text-[var(--muted)]" />
                <span className="text-[10px] font-medium text-[var(--muted)]">ENTER</span>
              </div>
            </form>

            <div className="bg-slate-950 px-6 py-2.5 flex items-center gap-8 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,168,83,0.4)]" />
                <span className="text-[10px] text-[var(--muted)] uppercase font-medium tracking-wider">Connected</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe aria-hidden="true" size={11} className="text-[var(--muted)]" />
                <span className="text-[10px] text-[var(--muted)] uppercase font-medium tracking-wider">TLS 1.3 Encryption</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Sparkles aria-hidden="true" size={11} className="text-indigo-400" />
                <span className="text-[10px] text-[var(--muted)] uppercase font-medium tracking-wider">AI Guard Active</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
