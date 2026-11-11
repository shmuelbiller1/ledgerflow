import React, { useState, useRef } from 'react';
import { Search, X, Filter, DollarSign, Tag, Shield, Building, FolderKanban, HelpCircle, Sparkles, Clock } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { useTimeout } from '../../hooks/useTimeout';

interface DeepSearchBarProps {
  value: string;
  onChange: (val: string) => void;
  metrics?: { count: number; totalExposure: number };
  placeholder?: string;
  className?: string;
  onSaveAsView?: () => void;
}

const SEARCH_OPERATORS = [
  { prefix: '> 500', description: 'Amount greater than 500', icon: DollarSign },
  { prefix: 'between 100 and 500', description: 'Amount range filter', icon: DollarSign },
  { prefix: 'this month', description: 'Current calendar month', icon: Clock },
  { prefix: 'last 30 days', description: 'Rolling 30-day window', icon: Clock },
  { prefix: 'q1', description: 'First quarter transactions', icon: Clock },
  { prefix: 'category: Meals', description: 'Filter by line category', icon: Tag },
  { prefix: 'account: Checking', description: 'Filter by account name/code', icon: Tag },
  { prefix: 'project: Alpha', description: 'Filter by project', icon: FolderKanban },
  { prefix: 'is:pending', description: 'Pending status entries', icon: Filter },
  { prefix: 'is:unbalanced', description: 'Audit unbalanced entries', icon: Shield },
  { prefix: 'starts with Apple', description: 'Prefix match', icon: Building },
  { prefix: 'top 10%', description: 'Top 10% highest transactions', icon: Sparkles },
  { prefix: '-tax', description: 'Exclude negative keyword', icon: X },
];

export default function DeepSearchBar({ value, onChange, metrics, placeholder = "Search entries… (e.g. > 500, this month, category: Meals)", className }: DeepSearchBarProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showHelper, setShowHelper] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setSafeTimeout } = useTimeout();

  const handleAppendOperator = (prefix: string) => {
    const nextVal = value ? `${value.trim()} ${prefix}` : prefix;
    onChange(nextVal);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <div 
        className={cn(
          "flex items-center gap-2.5 px-3.5 py-2 bg-[var(--surface-card)] border rounded-xl shadow-xs transition-all",
          isFocused 
            ? "border-[var(--brass)] ring-2 ring-[var(--brass)]/20 shadow-md bg-[var(--surface-elevated)]" 
            : "border-[var(--line)] hover:border-[var(--line-strong)]"
        )}
      >
        <Search aria-hidden="true" size={16} className={cn("shrink-0 transition-colors", isFocused ? "text-[var(--brass)]" : "text-[var(--muted)]")} />

        <input aria-label={placeholder || "Search transactions"}
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setSafeTimeout(() => setIsFocused(false), 200)}
          placeholder={placeholder}
          className="w-full text-xs font-medium bg-transparent text-[var(--text)] placeholder-[var(--muted)] outline-none"
        />

        {value && (
          <button aria-label="Clear search"
            onClick={() => onChange('')}
            className="p-1 text-[var(--muted)] hover:text-[var(--text)] rounded-md hover:bg-[var(--line)]/50 transition-colors cursor-pointer"
          >
            <X aria-hidden="true" size={14} />
          </button>
        )}

        {value.trim() && metrics && (
          <div className="flex items-center gap-2 pl-2 border-l border-[var(--line)] shrink-0">
            <span className="text-[11px] font-bold text-[var(--brass)] bg-[var(--brass)]/15 px-2 py-0.5 rounded-md tabular-nums">
              {formatCurrency(metrics.totalExposure)}
            </span>
            <span className="text-[10px] text-[var(--muted)] font-mono">
              ({metrics.count} found)
            </span>
          </div>
        )}

        <button aria-label="Search Operator Guide"
          type="button"
          onClick={() => setShowHelper(!showHelper)}
          title="Search Operator Guide"
          className={cn(
            "p-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 border",
            showHelper 
              ? "bg-[var(--brass)]/20 border-[var(--brass)] text-[var(--brass)]" 
              : "bg-[var(--bg)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          <HelpCircle aria-hidden="true" size={14} />
        </button>
      </div>

      {showHelper && (
        <div className="absolute left-0 right-0 top-full mt-2 z-40 p-4 bg-[var(--surface-card)] border border-[var(--brass)]/50 rounded-2xl shadow-xl space-y-3 animate-in fade-in duration-150 text-[var(--text)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
            <span className="text-xs font-bold text-[var(--brass)] flex items-center gap-1.5">
              <Sparkles aria-hidden="true" size={14} />
              <span>Deep Search Operators</span>
            </span>
            <button 
              onClick={() => setShowHelper(false)}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
            >
              Close
            </button>
          </div>

          <p className="text-[11px] text-[var(--muted)]">
            Click any operator chip below to append it to your query string:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {SEARCH_OPERATORS.map((op) => {
              const OpIcon = op.icon;
              return (
                <button
                  key={op.prefix}
                  onClick={() => handleAppendOperator(op.prefix)}
                  className="flex items-center gap-2 p-2 text-left bg-[var(--surface-elevated)] border border-[var(--line)] hover:border-[var(--brass)] rounded-xl transition-all cursor-pointer group"
                >
                  <div className="p-1.5 bg-[var(--brass)]/10 text-[var(--brass)] rounded-lg group-hover:bg-[var(--brass)] group-hover:text-black transition-colors">
                    <OpIcon size={13} />
                  </div>
                  <div>
                    <div className="text-xs font-mono font-bold text-[var(--text)]">{op.prefix}</div>
                    <div className="text-[10px] text-[var(--muted)] truncate max-w-[160px]">{op.description}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-[var(--line)] flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Presets:</span>
            
            <button
              onClick={() => onChange('> 5000 this month')}
              className="text-[10px] px-2.5 py-1 bg-[var(--bg)] border border-[var(--line)] hover:border-[var(--brass)] rounded-lg font-mono text-[var(--text-secondary)] cursor-pointer"
            >
              &gt; 5000 this month
            </button>

            <button
              onClick={() => onChange('top 10%')}
              className="text-[10px] px-2.5 py-1 bg-[var(--bg)] border border-[var(--line)] hover:border-[var(--brass)] rounded-lg font-mono text-[var(--text-secondary)] cursor-pointer"
            >
              top 10%
            </button>

            <button
              onClick={() => onChange('error')}
              className="text-[10px] px-2.5 py-1 bg-[var(--bg)] border border-[var(--line)] hover:border-[var(--brass)] rounded-lg font-mono text-[var(--text-secondary)] cursor-pointer text-rose-500 hover:text-rose-400"
            >
              error
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
