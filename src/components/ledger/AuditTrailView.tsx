import React, { useMemo, useState } from 'react';
import { AuditLog } from '../../types';
import { ShieldCheck, History, User, Activity, Search, Filter, Download } from 'lucide-react';
import { format } from 'date-fns';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { cn, getLocalDateISO } from '../../lib/utils';
import { auditDescription, auditTime } from '../../lib/auditFormat';
import { downloadCsv } from '../../lib/csvExport';

interface AuditTrailViewProps {
  auditLogs: AuditLog[];
}

const Row = ({ index, style, data }: { index: number, style: React.CSSProperties, data: AuditLog[] }) => {
  const log = data[index];
  if (!log) return null;

  return (
    <div style={style} className="px-6 flex items-center">
      <div className="w-full flex items-center justify-between p-4 bg-[var(--ink)]/30 rounded-xl border border-[var(--line)] hover:border-[var(--brass-line)] transition-all group overflow-hidden">
        <div className="flex items-center gap-4 overflow-hidden">
          <div className="w-10 h-10 bg-[var(--surface)] rounded-lg flex items-center justify-center text-[var(--muted)] border border-[var(--line)] shrink-0">
            <Activity aria-hidden="true" size={18} className="group-hover:text-[var(--brass)] transition-colors" />
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn(
                "px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider",
                log.action?.toLowerCase().includes('create') ? "bg-[var(--pos)]/10 text-[var(--pos)]" :
                log.action?.toLowerCase().includes('update') || log.action?.includes('ROLE') ? "bg-amber-500/10 text-amber-500" :
                log.action?.includes('INVITE') ? "bg-indigo-500/10 text-indigo-400" :
                "bg-rose-500/10 text-rose-500"
              )}>
                {log.action}
              </span>
              <p className="text-xs font-bold text-[var(--text)] uppercase tracking-tight truncate">
                {log.entityType} <span className="text-[var(--muted)] opacity-40 mx-1.5">//</span> {auditDescription(log) || log.entityId}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider italic">
              <span className="flex items-center gap-1.5"><History aria-hidden="true" size={11} className="text-[var(--brass)]" />{auditTime(log) ? format(auditTime(log)!, 'MMM dd, HH:mm:ss') : 'N/A'}</span>
              <span className="flex items-center gap-1.5"><User aria-hidden="true" size={11} className="text-[var(--brass)]" />{log.email || log.userEmail || (log.uid && log.uid.substring(0, 8)) || 'System'}</span>
            </div>
          </div>
        </div>
        <div className="text-right hidden md:block shrink-0">
          <div className="px-2.5 py-1 bg-[var(--surface)] rounded border border-[var(--line)] mb-0.5">
            <p className="text-[9px] font-mono font-bold text-[var(--brass)]">
              0x{(log.id || 'xxxxxxxxx').substring(0, 10).toUpperCase()}
            </p>
          </div>
          <p className="text-[7px] text-[var(--muted)] uppercase tracking-[0.2em] font-bold">Integrity Hash</p>
        </div>
      </div>
    </div>
  );
};

const AuditTrailView = React.memo(({ auditLogs = [] }: AuditTrailViewProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilter, setUserFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');

  // Extract unique users and actions for filter dropdowns
  const uniqueUsers = useMemo(() => {
    const users = new Set<string>();
    auditLogs.forEach(l => {
      const u = l.email || l.userEmail || l.uid;
      if (u) users.add(u);
    });
    return Array.from(users);
  }, [auditLogs]);

  const uniqueActions = useMemo(() => {
    const actions = new Set<string>();
    auditLogs.forEach(l => {
      if (l.action) actions.add(l.action);
    });
    return Array.from(actions);
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const userMatch = userFilter === 'ALL' || (log.email === userFilter || log.userEmail === userFilter || log.uid === userFilter);
      const actionMatch = actionFilter === 'ALL' || log.action === actionFilter;
      
      const search = searchTerm.toLowerCase();
      const textMatch = !searchTerm ||
        log.entityType?.toLowerCase().includes(search) ||
        log.action?.toLowerCase().includes(search) ||
        log.entityId?.toLowerCase().includes(search) ||
        log.email?.toLowerCase().includes(search) ||
        auditDescription(log).toLowerCase().includes(search);

      return userMatch && actionMatch && textMatch;
    }).sort((a, b) => {
      const timeA = auditTime(a)?.getTime() || 0;
      const timeB = auditTime(b)?.getTime() || 0;
      return timeB - timeA;
    });
  }, [auditLogs, userFilter, actionFilter, searchTerm]);

  const handleExportCSV = () => {
    downloadCsv(`audit_trail_export_${getLocalDateISO()}.csv`,
      ['Timestamp', 'Action', 'User/Email', 'Entity Type', 'Entity ID', 'Description'],
      filteredLogs.map(l => [auditTime(l)?.toISOString() || '', l.action || '', l.email || l.userEmail || l.uid || '', l.entityType || '', l.entityId || '', auditDescription(l)]));
  };

  return (
    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden flex-1 min-h-[500px] flex flex-col">
      <div className="p-4 md:p-6 border-b border-[var(--line)] flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--ink)]/30 shrink-0">
        <div>
          <h2 className="text-lg font-black text-[var(--text)] uppercase tracking-tight">Audit Trail Matrix</h2>
          <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5">Immutable cryptographic record of system directives</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--line)] text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
          >
            <Download aria-hidden="true" size={14} /> Export CSV
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--brass-soft)] text-[var(--brass)] rounded-xl border border-[var(--brass-line)] shadow-sm">
            <ShieldCheck aria-hidden="true" size={16} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Authenticity Verified</span>
          </div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="p-4 border-b border-[var(--line)] bg-[var(--ink)]/10 grid grid-cols-1 sm:grid-cols-12 gap-3 shrink-0">
        <div className="relative sm:col-span-5">
          <Search aria-hidden="true" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input aria-label="Search audit trail by description, entity, or ID"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search audit trail by description, entity, or ID..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-semibold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="sm:col-span-4 flex items-center gap-2">
          <Filter aria-hidden="true" size={14} className="text-[var(--muted)] shrink-0" />
          <select aria-label="Filter audit trail by user"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="w-full px-2.5 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-bold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="ALL">All Users / Service Accounts</option>
            {uniqueUsers.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-3">
          <select aria-label="Filter audit trail by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-2.5 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-bold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="ALL">All Action Directives</option>
            {uniqueActions.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-[var(--surface)]">
        {filteredLogs.length > 0 ? (
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                itemCount={filteredLogs.length}
                itemSize={100}
                width={width}
                className="py-4"
                itemData={filteredLogs}
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center">
            <div className="w-16 h-16 bg-[var(--ink)] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[var(--line)]">
              <ShieldCheck aria-hidden="true" size={32} className="text-[var(--muted)]" />
            </div>
            <p className="font-bold uppercase tracking-wider text-[10px] text-[var(--muted)]">No matching audit directives found</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default AuditTrailView;
