import React, { useMemo } from 'react';
import { usePerformanceTrace } from '../../hooks/usePerformanceTrace';
import { History, Search, Download, User, Activity, ChevronRight, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import { auditDescription, auditTime } from '../../lib/auditFormat';
import { format } from 'date-fns';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';

interface AuditTrailProps {
  auditLogs?: (Omit<import("../../types").AuditLog, 'uid'> & { uid?: string; targetId?: string })[];
}

const Row = ({ index, style, data }: { index: number, style: React.CSSProperties, data: { logs: (Omit<import("../../types").AuditLog, 'uid'> & { uid?: string; targetId?: string })[], expandedId: string | null, setExpandedId: (id: string | null) => void } }) => {
  const log = data.logs[index];
  if (!log) return null;

  const isExpanded = data.expandedId === log.id;

  return (
    <div style={style} className="px-8 py-2">
      <div 
        className={cn(
          "w-full flex flex-col p-5 bg-[var(--surface)] rounded-[32px] border transition-all group overflow-hidden",
          isExpanded ? "border-indigo-600 ring-1 ring-indigo-600/20" : "border-[var(--line)] hover:border-zinc-400"
        )}
      >
        <button
          className="w-full text-left flex items-center justify-between cursor-pointer"
          type="button" onClick={() => data.setExpandedId(isExpanded ? null : log.id)}
        >
          <div className="flex items-center gap-6 overflow-hidden">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-[var(--line)] transition-colors",
              log.action?.includes('ERROR') || log.action?.includes('DRIFT') ? "bg-rose-500/10 text-rose-500" : "bg-[var(--bg)] text-[var(--muted)]"
            )}>
              <Activity aria-hidden="true" size={18} />
            </div>
            <div className="overflow-hidden">
              <div className="flex items-center gap-3 mb-1">
                <span className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-medium uppercase tracking-wider",
                  log.action?.toLowerCase() === 'create' ? "bg-emerald-500/20 text-emerald-500" :
                  log.action?.toLowerCase() === 'update' ? "bg-indigo-600/20 text-indigo-600" :
                  log.action?.includes('DRIFT') ? "bg-rose-500/20 text-rose-500" :
                  "bg-zinc-500/20 text-zinc-500"
                )}>
                  {log.action}
                </span>
                <p className="text-xs font-black text-[var(--text)] uppercase tracking-tight truncate">
                  {log.entityType} <span className="opacity-20 mx-1">/</span> {auditDescription(log) || log.entityId || 'SYSTEM'}
                </p>
              </div>
              <div className="flex items-center gap-4 text-[9px] font-black text-[var(--muted)] uppercase tracking-widest italic opacity-60">
                <span className="flex items-center gap-1.5"><History aria-hidden="true" size={10} />{auditTime(log) ? format(auditTime(log)!, 'MMM dd, HH:mm:ss') : 'N/A'}</span>
                <span className="flex items-center gap-1.5"><User aria-hidden="true" size={10} />{log.userEmail || log.email || log.uid?.substring(0, 8) || 'SYSTEM'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end gap-1">
              <div className="px-2 py-0.5 bg-[var(--bg)] rounded border border-[var(--line)]">
                <p className="text-[9px] font-mono font-bold text-indigo-600">
                  0x{(log.id || 'xxxxxx').substring(0, 8).toUpperCase()}
                </p>
              </div>
            </div>
            <ChevronRight aria-hidden="true" size={18} className={cn("text-zinc-400 transition-transform", isExpanded && "rotate-90")} />
          </div>
        </button>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-[var(--line)] animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Payload Context</p>
                <div className="bg-[var(--bg)] rounded-2xl p-4 border border-[var(--line)] overflow-auto max-h-64">
                  <pre className="text-[11px] font-mono text-indigo-400 whitespace-pre-wrap">
                    {JSON.stringify(log.details || {}, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Session Fingerprint</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[var(--bg)] p-3 rounded-xl border border-[var(--line)]">
                      <p className="text-[9px] text-zinc-500 uppercase mb-1">Entity ID</p>
                      <p className="text-xs font-mono truncate">{log.entityId || 'SYSTEM'}</p>
                    </div>
                    <div className="bg-[var(--bg)] p-3 rounded-xl border border-[var(--line)]">
                      <p className="text-[9px] text-zinc-500 uppercase mb-1">Target ID</p>
                      <p className="text-xs font-mono truncate">{log.targetId || 'N/A'}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-indigo-500/5 p-4 rounded-2xl border border-indigo-500/10 flex items-start gap-3">
                  <Shield aria-hidden="true" size={16} className="text-indigo-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-indigo-400 leading-relaxed italic">
                    This event is locked and cryptographically anchored to the ledger history. Any tampering will be detected by the shadow reconciler.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AuditTrail = React.memo(({ auditLogs: passedLogs }: AuditTrailProps) => {
  usePerformanceTrace("AuditTrail");

  const storeLogs = useLedgerStore(state => state.auditLogs || []);
  const { loading } = useLedgerCollections('auditLogs');
  const dataHealth = useScreenDataHealth(['auditLogs']);
  const auditLogs = passedLogs || storeLogs;
  const [searchTerm, setSearchTerm] = React.useState('');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    let base = auditLogs.map(log => ({
      ...log,
      _timestampMs: auditTime(log)?.getTime() || 0
    }));

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      base = base.filter(log => 
        (log.action?.toLowerCase() || '').includes(term) ||
        (log.entityType?.toLowerCase() || '').includes(term) ||
        (log.userEmail?.toLowerCase() || '').includes(term) ||
        (log.email?.toLowerCase() || '').includes(term) ||
        (log.entityId?.toLowerCase() || '').includes(term)
      );
    }
    
    return base.sort((a, b) => b._timestampMs - a._timestampMs);
  }, [auditLogs, searchTerm]);

  const downloadAuditLog = () => {
    const blob = new Blob([JSON.stringify(auditLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const itemData = useMemo(() => ({
    logs: filteredLogs,
    expandedId,
    setExpandedId
  }), [filteredLogs, expandedId]);

  return (
    <div className="h-full flex flex-col space-y-8 animate-in fade-in duration-500">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="the audit trail" />
      <div className="flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest truncate mb-4">
            <Shield aria-hidden="true" size={14} />
            Verified Audit Stream
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[var(--text)] tracking-tighter">Audit Trail</h1>
          <p className="text-[var(--muted)] font-normal text-lg mt-2 max-w-xl leading-relaxed italic opacity-80">Continuous cryptographic observability of legal and fiscal vectors.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group/search">
            <Search aria-hidden="true" className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--muted)] group-hover/search:text-indigo-600 transition-colors" size={18} />
            <input aria-label="Search history"
              type="text"
              placeholder="Search history..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-80 h-14 pl-14 pr-6 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-xs font-bold text-[var(--text)] focus:outline-none focus:border-indigo-600 transition-all shadow-sm"
            />
          </div>
          <button 
            onClick={downloadAuditLog}
            className="h-14 px-8 bg-zinc-900 text-white hover:bg-zinc-800 rounded-[32px] flex items-center gap-3 text-[10px] font-medium uppercase tracking-wider transition-all shadow-xl"
           aria-label="Export Core">
            <Download aria-hidden="true" size={18} />
            Export
          </button>
        </div>
      </div>

      <div className="flex-1 bg-[var(--surface)] rounded-[32px] border border-[var(--line)] overflow-hidden shadow-2xl relative min-h-[500px]">
        <div className="absolute inset-0 z-10">
          {filteredLogs.length > 0 ? (
            <AutoSizer>
              {({ height, width }) => (
                <List
                  height={height}
                  itemCount={filteredLogs.length}
                  itemSize={expandedId ? 320 : 120} // Dynamic size would be better but react-window needs fixed for List
                  width={width}
                  className="py-8 scrollbar-hide"
                  itemData={itemData}
                >
                  {Row}
                </List>
              )}
            </AutoSizer>
          ) : loading && !passedLogs ? (
            <LoadingState what="the audit trail" />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <EmptyState
                title={searchTerm ? 'Nothing matches the search' : 'No activity yet'}
                description={searchTerm ? 'Try other words, or clear the search.' : 'Every change to the books (who, what, when) is listed here as soon as it happens.'}
                actionLabel={searchTerm ? 'Clear the search' : undefined}
                onAction={searchTerm ? () => setSearchTerm('') : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default AuditTrail;
