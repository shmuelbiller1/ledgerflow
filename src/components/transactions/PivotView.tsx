import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { percentWidthStyle } from '../../lib/percentBar';

interface PivotViewProps {
  pivotData: Array<{ name: string, value: number, count: number }>;
  formatCurrency: (cents: number) => string;
}

export default function PivotView({ pivotData }: PivotViewProps) {
  return (
    <div className="p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {pivotData.map((item) => (
        <div key={item.name} className="bg-[var(--surface)] border border-[var(--line)] rounded-[32px] p-6 shadow-sm hover:shadow-md transition-all group">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--ink)] rounded-[32px] flex items-center justify-center text-zinc-400 group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors">
                <ChevronRight size={20} />
              </div>
              <h2 className="font-bold text-[var(--text)]">{item.name}</h2>
            </div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{item.count} txns</span>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Total Volume</span>
              <span className={cn(
                "font-mono font-bold tabular-nums",
                item.value >= 0 ? "text-emerald-600" : "text-rose-600"
              )}>
                {formatCurrency(item.value)}
              </span>
            </div>
            <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-orange-500 h-full rounded-full" 
                style={percentWidthStyle((Math.abs(item.value) / 1000) * 100)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
