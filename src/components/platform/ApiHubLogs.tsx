

import { RefreshCw, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';


import type { useApiHubModel } from './useApiHubModel';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import type { ColumnDef } from '@tanstack/react-table';

/** One row of the API request log, as the model keeps it. */
type ApiLog = ReturnType<typeof useApiHubModel>['apiLogs'][number];
export function ApiHubLogs({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { apiLogs, fetchLogs } = model;

  /**
   * One row per request. The path names the row; the credit cost and the credential label are worked
   * out from the method and key, exactly as the old table showed them. The timestamp sorts on the
   * stored value, not on the printed clock time.
   */
  const columns: ColumnDef<ApiLog, unknown>[] = [
    { id: 'timestamp', accessorFn: row => row.timestamp ?? '', header: 'Timestamp', cell: info => (
      <span className="whitespace-nowrap font-mono text-[11px]">{info.getValue() ? new Date(String(info.getValue())).toLocaleTimeString() : new Date().toLocaleTimeString()}</span>
    ) },
    { id: 'specs', accessorFn: row => `${row.method || 'GET'} ${row.path || '/api/v1/status'}`, header: 'Request Specs', cell: info => {
      const row = info.row.original as ApiLog;
      return (
        <span className="flex items-center gap-2.5">
          <span className={cn(
            'px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider font-mono text-white',
            row.method === 'POST' ? 'bg-emerald-500'
              : row.method === 'PUT' ? 'bg-amber-500'
                : row.method === 'DELETE' ? 'bg-rose-500' : 'bg-blue-500',
          )}>{row.method || 'GET'}</span>
          <span className="font-mono text-xs font-bold max-w-[200px] truncate">{row.path || '/api/v1/status'}</span>
        </span>
      );
    } },
    { id: 'cost', accessorFn: row => (row.method === 'POST' && (row.path || '').includes('brain') ? 10 : row.method === 'POST' ? 3 : 1), header: 'Key Credit Cost', cell: info => (
      <span className="whitespace-nowrap text-xs font-mono font-bold bg-purple-50 px-2 py-0.5 rounded border border-purple-100">{String(info.getValue())} cr</span>
    ) },
    { id: 'credentials', accessorFn: row => row.apiKeyUsed || '', header: 'API Origin Credentials', cell: info => {
      const used = String(info.getValue());
      return <span className="text-[11px] font-mono bg-[var(--ink)] px-2 py-0.5 rounded border border-[var(--line)]">{used === 'Active Admin Session' ? 'Admin session' : `Key: lf_id_${used.slice(-6)}`}</span>;
    } },
    { id: 'status', accessorFn: row => row.statusCode, header: 'Status', cell: info => {
      const code = Number(info.getValue());
      const ok = code >= 200 && code < 300;
      return <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-black tracking-wide font-mono uppercase text-white', ok ? 'bg-emerald-500' : 'bg-rose-500')}>{code} {ok ? 'Success' : 'Error'}</span>;
    } },
    { id: 'details', header: 'Details', cell: info => (
      <button
        type="button"
        onClick={() => toast.info('API Frame Inspected', {
          description: <div className="font-mono text-[9px] text-left overflow-x-auto max-h-[140px] bg-slate-900 text-slate-200 p-2 rounded mt-2">{JSON.stringify(info.row.original, null, 2)}</div>,
          duration: 6000,
        })}
        className="text-xs font-bold text-indigo-600 hover:underline bg-transparent border-0 cursor-pointer"
      >
        Inspect Raw
      </button>
    ) },
  ];
 return (<div className="ledger-card p-6 space-y-6 animate-in fade-in duration-300 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-indigo-600 flex items-center justify-center">
                <FileText aria-hidden="true" size={20} />
              </div>
              <div>
                <h3 className="font-header font-bold text-[var(--text)]">API Pipeline Chronological Logs</h3>
                <p className="text-xs text-[var(--muted)] font-medium">Diagnostic ledger feed & key consumption audits.</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={fetchLogs}
                className="p-2 bg-[var(--ink)] border border-[var(--line)] text-slate-700 rounded-lg hover:bg-slate-100 transition-all flex items-center gap-1.5 text-xs font-bold shrink-0 cursor-pointer"
               aria-label="Sync Feed">
                <RefreshCw aria-hidden="true" size={12} /> Sync Feed
              </button>
            </div>
          </div>

          {/* Table display */}
          <TanStackDataGrid
            caption="API request log"
            data={apiLogs}
            columns={columns}
            pageSize={25}
            pageSizeOptions={[10, 25, 50, 100]}
            searchPlaceholder="Search paths, methods and statuses..."
            searchLabel="Search the API request log"
            columnScope="api-hub-logs"
            columnLabel="API request log columns"
            columnNames={['Timestamp', 'Request Specs', 'Key Credit Cost', 'API Origin Credentials', 'Status', 'Details']}
            emptyState={<EmptyState title="No integration API requests yet" description="Call the API from the Playground Sandbox to fill this log." />}
            filteredEmptyState={<EmptyState title="No request matches your search" description="Try a path, a method or a status code." />}
          />
        </div>);
}
