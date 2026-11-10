

import { Activity, Cpu as CpuIcon } from 'lucide-react';


import type { useApiHubModel } from './useApiHubModel';
import { BRAND_NAME } from '../../config/brand';
export function ApiHubArchitecture(_props: { model: ReturnType<typeof useApiHubModel> }) {
 return (<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="ledger-card p-6 md:col-span-2 space-y-6">
            <h2 className="font-bold flex items-center gap-2 text-lg">
              <Activity aria-hidden="true" className="text-indigo-600" size={20} />
              Platform Architecture
            </h2>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              {BRAND_NAME}'s Integrity API is built on a high-throughput Express Node architecture,
              connecting natively to the unified workspace data layer.
              The API guarantees double-entry accounting integrity at the database level for all incoming mutations.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="p-4 border border-[var(--line)] rounded-xl bg-[var(--ink)]/50">
                 <div className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Architecture Standard</div>
                 <div className="font-mono text-sm">RESTful JSON over HTTPS</div>
              </div>
              <div className="p-4 border border-[var(--line)] rounded-xl bg-[var(--ink)]/50">
                 <div className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Base URL</div>
                 <div className="font-mono text-sm">&lt;INSTANCE_URL&gt;/api/v1</div>
              </div>
              <div className="p-4 border border-[var(--line)] rounded-xl bg-[var(--ink)]/50">
                 <div className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Authorization</div>
                 <div className="font-mono text-sm">Bearer Token</div>
              </div>
              <div className="p-4 border border-[var(--line)] rounded-xl bg-[var(--ink)]/50">
                 <div className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Rate Limit</div>
                 <div className="font-mono text-sm">100 req / minute</div>
              </div>
            </div>
          </div>
          <div className="ledger-card p-6">
             <h2 className="font-bold flex items-center gap-2 mb-4">
               <CpuIcon aria-hidden="true" className="text-emerald-500" size={18} />
               Brain Integration
             </h2>
             <p className="text-xs text-[var(--muted)] mb-4">
               The API exposes a direct line to the {BRAND_NAME} AI (`/brain/analyze`), allowing your external services to query the intelligent agent based on live ledger data.
             </p>
             <div className="p-3 bg-slate-900 text-white rounded-lg font-mono text-[10px] break-all">
                POST /api/v1/brain/analyze<br/>
                &#123;<br/>
                &nbsp;&nbsp;"prompt": "Analyze our runway based on recent MRR..."<br/>
                &#125;
             </div>
          </div>
        </div>);
}
