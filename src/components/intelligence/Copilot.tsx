import { formatCurrency } from '../../lib/utils';
import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Send, User, ChevronRight, ShieldCheck, Database } from "lucide-react";
import { useAuthStore } from "../../stores/useAuthStore";
import { useLedgerStore } from "../../stores/useLedgerStore";
import { isPostable, isCashAccount } from "../../lib/txFilters";
import { cn } from "../../lib/utils";
import Markdown from "react-markdown";
import { maskCardNumbers } from '../../lib/cardNumberMask';
import { motion, AnimatePresence } from 'motion/react';

const SUGGESTIONS = [
  "What is my true Cash runway based on recent burn?",
  "Which clients have the worst Accounts Receivable aging?",
  "Identify unusual spending patterns in the last 30 days.",
  "Calculate my LTV to CAC ratio."
];

function renderMarkdown(text: string) {
  return (
    <div className="markdown-body prose prose-slate">
      <Markdown>{text}</Markdown>
    </div>
  );
}

export default function Copilot() {
  const currentWorkspaceId = useAuthStore((s) => s.currentWorkspaceId);
  const currentWorkspace = useAuthStore((s) => s.getCurrentWorkspace());
  const transactions = useLedgerStore((s) => s.transactions);
  const accounts = useLedgerStore((s) => s.accounts);

  const selectedModel = typeof window !== 'undefined' 
    ? (localStorage.getItem('lf_selected_ai_model') || currentWorkspace?.aiModel || 'Gemini 3.8 Flash')
    : 'Gemini 3.8 Flash';

  const [messages, setMessages] = useState([
    { 
      id: 0,
      role: "assistant", 
      content: "I am your advanced financial modeling intelligence. Connected with **verified read-only access** to your live general ledger. How may I assist your strategy today?" 
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const nextMessageId = useRef(1);

  const appendMessage = (role: 'assistant' | 'user', content: string) => {
    const id = nextMessageId.current++;
    setMessages(m => [...m, { id, role, content }]);
  };

  useEffect(() => { 
    endRef.current?.scrollIntoView({ behavior: "smooth" }); 
  }, [messages, loading]);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    const safeQuestion = maskCardNumbers(question);
    appendMessage('user', safeQuestion);
    setInput("");
    setLoading(true);
    try {
      const token = await useAuthStore.getState().user?.getIdToken();
      let answer = "";
      
      // Assemble verified, read-only ledger context
      let totalCashCents = 0;
      let totalRevenueCents = 0;
      let totalExpensesCents = 0;
      let totalArCents = 0;
      let totalApCents = 0;

      const accountsSummary = (accounts || []).map((a) => {
        const bal = a.balanceCents || 0;
        const type = (a.type || '').toLowerCase();
        const cat = (a.category || '').toLowerCase();

        if (isCashAccount(a)) {
          totalCashCents += bal;
        }
        if (type === 'revenue' || type === 'income') {
          totalRevenueCents += bal;
        }
        if (type === 'expense' || type === 'cost_of_goods' || type === 'cogs') {
          totalExpensesCents += bal;
        }
        if (cat.includes('receivable') || type === 'receivable') {
          totalArCents += bal;
        }
        if (cat.includes('payable') || type === 'payable') {
          totalApCents += bal;
        }

        return {
          name: maskCardNumbers(a.name),
          category: a.category,
          type: a.type,
          balanceFormatted: formatCurrency(bal)
        };
      });

      const postableTx = (transactions || [])
        .filter((t) => isPostable(t))
        .slice(0, 40)
        .map((t) => ({
          date: t.date,
          description: maskCardNumbers(t.description || ''),
          category: t.lines?.[0]?.category || (t as typeof t & { category?: string }).category || '',
          amountFormatted: formatCurrency(t.totalAmountCents || 0, t.currency)
        }));

      const monthlyBurnCents = totalExpensesCents > totalRevenueCents 
        ? Math.round((totalExpensesCents - totalRevenueCents) / 12) 
        : 0;
      const runwayMonths = monthlyBurnCents > 0 
        ? (totalCashCents / monthlyBurnCents).toFixed(1) 
        : "99+ (Profitable / Cash Positive)";

      const ledgerSummary = {
        workspaceId: currentWorkspaceId,
        totalCash: formatCurrency(totalCashCents),
        monthlyBurn: formatCurrency(monthlyBurnCents),
        runwayMonths,
        totalAccountsReceivable: formatCurrency(totalArCents),
        totalAccountsPayable: formatCurrency(totalApCents),
        keyAccounts: accountsSummary.slice(0, 15),
        recentTransactions: postableTx
      };

      try {
        const res = await fetch("/api/ai/process", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ 
              task: "chat", 
              payload: { 
                query: safeQuestion,
                workspaceId: currentWorkspaceId,
                selectedModel,
                ledgerSummary
              } 
            })
        });
        const data = await res.json();
        
        if (res.ok) {
            answer = data.answer;
        } else {
            throw new Error(data.detail || data.message || "Execution exception");
        }
      } catch (err) {
        console.warn("AI Backend unreachable:", err);
        answer = `*Ledger Intelligence Offline Fallback*\n\n**Financial Snapshot:**\n- **Verified Cash:** ${ledgerSummary.totalCash}\n- **Estimated Burn Rate:** ${ledgerSummary.monthlyBurn} / mo\n- **Runway:** ${ledgerSummary.runwayMonths} months\n- **Accounts Receivable:** ${ledgerSummary.totalAccountsReceivable}\n- **Accounts Payable:** ${ledgerSummary.totalAccountsPayable}\n\n*(Notice: Live Gemini backend unreachable: ${(err as Error).message}. Operating in deterministic heuristic mode).*`;
      }
      
      appendMessage('assistant', answer);
    } catch (err) {
      appendMessage('assistant', "**Error computing metric**: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--ink)]/50">
      <div className="px-6 md:px-10 py-6 md:py-8 border-b border-[var(--line)] bg-[var(--surface)] sticky top-0 z-20 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[var(--brass)] text-[var(--ink)] rounded-xl flex items-center justify-center shadow-md">
            <Sparkles aria-hidden="true" size={24} className="text-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-black text-2xl uppercase tracking-tight text-[var(--text)]">AI Co-pilot</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
                {selectedModel}
              </span>
            </div>
            <p className="text-[var(--muted)] font-bold uppercase tracking-widest text-[10px] mt-1">Live analytical reasoning over verified general ledger data</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
            <ShieldCheck aria-hidden="true" size={14} className="text-emerald-600 shrink-0" />
            <span>Read-Only Guardrail Active</span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[11px] font-medium">
            <Database aria-hidden="true" size={13} className="text-[var(--muted)] shrink-0" />
            <span>{accounts.length} Accounts • {transactions.length} Tx</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-10 space-y-6 custom-scrollbar relative bg-[var(--ink)]/50">
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
          <AnimatePresence initial={false}>
            {messages.map(m => (
              <motion.div 
                key={m.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex gap-4 ${m.role === "user" ? "justify-end" : ""}`}
              >
                {m.role === "assistant" && (
                  <div className="w-10 h-10 rounded-xl bg-[var(--brass)] text-[var(--ink)] flex items-center justify-center shrink-0 shadow-sm mt-1 font-bold">
                    <Sparkles aria-hidden="true" size={18} />
                  </div>
                )}
                <div className={cn(
                  "max-w-[80%] px-6 py-5 text-sm font-medium leading-relaxed border rounded-2xl shadow-sm", 
                  m.role === "user" ? "bg-[var(--elevated)] text-[var(--text)] border-[var(--line)]" : "bg-[var(--surface)] border-[var(--line)] text-[var(--text)]"
                )}>
                  {m.role === "assistant" ? <div className="space-y-1">{renderMarkdown(m.content)}</div> : m.content}
                </div>
                {m.role === "user" && (
                  <div className="w-10 h-10 rounded-xl bg-[var(--panel)] flex items-center justify-center shrink-0 shadow-md mt-1 border border-[var(--line)] text-[var(--text)]">
                    <User aria-hidden="true" size={18} />
                  </div>
                )}
              </motion.div>
            ))}
            {loading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-[var(--brass)] text-[var(--ink)] flex items-center justify-center shrink-0 shadow-sm mt-1">
                  <Sparkles aria-hidden="true" size={18} className="animate-pulse" />
                </div>
                <div className="px-6 py-5 bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm text-xs font-semibold text-[var(--muted)] flex items-center space-x-2">
                  <div className="w-2 h-2 bg-[var(--brass)] rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-[var(--brass)] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-[var(--brass)] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <span className="ml-2">Analyzing verified ledger data with {selectedModel}...</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={endRef} />
        </div>
      </div>

      <div className="bg-[var(--surface)]/90 backdrop-blur-xl border-t border-[var(--line)] p-6 shrink-0 relative z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.02)]">
        <div className="max-w-4xl mx-auto">
          {messages.length <= 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {SUGGESTIONS.map((s) => (
                <button 
                  key={s} 
                  onClick={() => ask(s)}
                  className="text-left flex items-center justify-between font-bold text-xs uppercase tracking-wider border border-[var(--line)] bg-[var(--surface)] px-5 py-4 rounded-xl text-slate-600 hover:border-slate-900 hover:text-[var(--text)] hover:shadow-sm transition-all group active:scale-95"
                >
                  <span className="text-xs">{s}</span>
                  <ChevronRight aria-hidden="true" size={16} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); void ask(input); }} className="relative flex items-center group">
            <input aria-label="Ask Copilot"
              className="flex-1 w-full bg-[var(--ink)] border-2 border-[var(--line)] rounded-2xl px-6 py-4 text-sm focus:bg-[var(--surface)] focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all placeholder:text-slate-400 font-medium tracking-tight shadow-sm" 
              placeholder="Ask Copilot about cash runway, AR aging, spending patterns, or financial ratios…" 
              value={input}
              onChange={(e) => setInput(e.target.value)} 
            />
            <button type="submit" 
              className="absolute right-2.5 p-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md active:scale-95" 
              disabled={loading || !input.trim()} 
              aria-label="Send action">
              <Send aria-hidden="true" size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
