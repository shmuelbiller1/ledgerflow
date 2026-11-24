import { ApiHubNavigation } from './ApiHubNavigation';
import { ApiHubArchitecture } from './ApiHubArchitecture';
import { ApiHubKeys } from './ApiHubKeys';
import { ApiHubSandbox } from './ApiHubSandbox';
import { ApiHubLogs } from './ApiHubLogs';
import { ApiHubBilling } from './ApiHubBilling';
import { ApiHubDocsNavigation, ApiHubDocGetStatus, ApiHubDocPostTransaction, ApiHubDocPostBrain, ApiHubDocPostClassify, ApiHubDocPostLedger, ApiHubDocGetMetrics } from './ApiHubCoreDocs';
import { ApiHubDocShiftingMetrics, ApiHubDocDeepAudit, ApiHubDocPollAudit, ApiHubDocPutTransaction, ApiHubDocMathDepreciation, ApiHubDocMathInventory, ApiHubDocMathAmortization } from './ApiHubAnalysisDocs';
import { ApiHubDocMathKpi, ApiHubDocMathTemporal, ApiHubDocPostProject } from './ApiHubIntegrationDocs';


import { Terminal } from 'lucide-react';

import { cn } from '../../lib/utils';


import type { useApiHubModel } from './useApiHubModel';
export function ApiHubView(model: ReturnType<typeof useApiHubModel>) {
 const { currentWorkspaceId, workspaces, setCurrentWorkspaceId, currentWorkspace, activeTab, activeDoc, docLang, setDocLang } = model;
 return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pt-4 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--line)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text)] flex items-center gap-2.5 font-display">
            <Terminal aria-hidden="true" className="text-slate-950" size={18} />
            API Platform
          </h1>
          <p className="text-[var(--muted)] mt-1 max-w-2xl text-xs font-medium">
            Direct interface to the TruthEngine core data engine. Integrate double-entry telemetry, query AI brain analysis, and orchestrate financial pipelines natively.
          </p>
        </div>

        {/* Workspace Quick-Picker */}
        <div className="flex items-center gap-2.5 self-start md:self-auto bg-[var(--ink)] border border-[var(--line)] px-3.5 py-1.5 rounded-lg shadow-3xs">
          <span className="text-[10px] font-black text-[var(--muted)] uppercase tracking-wider">Workspace:</span>
          <select
            aria-label="Workspace"
            value={currentWorkspaceId || ''}
            onChange={(e) => setCurrentWorkspaceId(e.target.value)}
            className="bg-transparent border-0 font-bold text-xs text-[var(--text)] focus:ring-0 focus:outline-none cursor-pointer pr-1"
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id} className="text-slate-950">
                {ws.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ApiHubNavigation model={model} />

      {activeTab === 'overview' && (
        <ApiHubArchitecture model={model} />
      )}

      {activeTab === 'keys' && (
        <ApiHubKeys model={model} />
      )}

      {activeTab === 'docs' && (
        <div className="ledger-card p-0 overflow-hidden text-sm flex flex-col md:flex-row min-h-[600px]">
          <ApiHubDocsNavigation model={model} />

          <div className="flex-1 p-4 md:p-6 md:p-10 overflow-y-auto">
             <div className="flex justify-end mb-6">
                 <div className="flex bg-[var(--ink)] p-1 rounded-lg border border-[var(--line)]">
                     <button onClick={() => setDocLang('curl')} className={cn("px-4 py-1.5 text-xs font-bold rounded-md transition-all", docLang === 'curl' ? "bg-[var(--surface)] shadow-sm" : "text-[var(--muted)] opacity-70")}>cURL</button>
                     <button onClick={() => setDocLang('python')} className={cn("px-4 py-1.5 text-xs font-bold rounded-md transition-all", docLang === 'python' ? "bg-[var(--surface)] shadow-sm text-[#3776AB]" : "text-[var(--muted)] opacity-70")}>Python</button>
                     <button onClick={() => setDocLang('node')} className={cn("px-4 py-1.5 text-xs font-bold rounded-md transition-all", docLang === 'node' ? "bg-[var(--surface)] shadow-sm text-[#339933]" : "text-[var(--muted)] opacity-70")}>Node.js</button>
                 </div>
             </div>

             {activeDoc === 'get-status' && (
               <ApiHubDocGetStatus model={model} />
             )}

             {activeDoc === 'post-transaction' && (
               <ApiHubDocPostTransaction model={model} />
             )}

             {activeDoc === 'post-brain' && (
               <ApiHubDocPostBrain model={model} />
             )}

             {activeDoc === 'post-classify' && (
                <ApiHubDocPostClassify model={model} />
              )}

             {activeDoc === 'get-ledger' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">List Ledger Accounts</h2>
                    <p className="text-[var(--muted)]">Retrieves the entire structural Chart of Accounts mapped to the workspace.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/ledger?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/ledger?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.get(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/ledger?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'post-ledger' && (
               <ApiHubDocPostLedger model={model} />
             )}

             {activeDoc === 'get-transaction' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">List Transactions</h2>
                    <p className="text-[var(--muted)]">Retrieves chronological immutable transaction records with their double-entry structures intact.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/transactions?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/transactions?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.get(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/transactions?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'delete-transaction' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Delete Transaction
                       <span className="text-[10px] bg-rose-500 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">DELETE</span>
                    </h2>
                    <p className="text-[var(--muted)]">Permanently removes a transaction record from the database. Note: Enforces lock period verification automatically.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X DELETE "https://api.ledgerflow.io/api/v1/transactions/api-1701234567-abcd?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/transactions/api-1701234567-abcd?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.delete(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/transactions/api-1701234567-abcd?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'get-logs' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">Fetch Audit Logs</h2>
                    <p className="text-[var(--muted)]">Obtain the deep API access telemetry, monitoring recent requests and latencies processed against your workspace.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/logs?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/logs?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.get(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/logs?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'get-metrics' && (
               <ApiHubDocGetMetrics model={model} />
             )}

             {activeDoc === 'shifting-metrics' && (
               <ApiHubDocShiftingMetrics model={model} />
             )}

             {activeDoc === 'deep-audit' && (
               <ApiHubDocDeepAudit model={model} />
             )}

             {activeDoc === 'poll-audit' && (
               <ApiHubDocPollAudit model={model} />
             )}

             {activeDoc === 'put-transaction' && (
               <ApiHubDocPutTransaction model={model} />
             )}

             {activeDoc === 'math-depreciation' && (
               <ApiHubDocMathDepreciation model={model} />
             )}

             {activeDoc === 'math-inventory' && (
               <ApiHubDocMathInventory model={model} />
             )}

             {activeDoc === 'math-amortization' && (
               <ApiHubDocMathAmortization model={model} />
             )}

             {activeDoc === 'math-eoq' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Economic Order Quantity (EOQ) Engine
                       <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">Determine the optimal order quantity to minimize inventory costs.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/math/inventory/eoq" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "annualDemand": 10000,
    "costPerOrderCents": 50000,
    "holdingCostPerUnitCents": 200
  }'` :
`const response = await fetch("https://api.ledgerflow.io/api/v1/math/inventory/eoq", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    annualDemand: 10000,
    costPerOrderCents: 50000, // $500.00 base fixed order cost
    holdingCostPerUnitCents: 200 // $2.00 carrying cost
  })
});

const { eoq } = await response.json();`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'math-kpi' && (
               <ApiHubDocMathKpi model={model} />
             )}

             {activeDoc === 'math-temporal' && (
               <ApiHubDocMathTemporal model={model} />
             )}

             {activeDoc === 'get-workspaces' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       List Managed Workspaces
                       <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">GET</span>
                    </h2>
                    <p className="text-[var(--muted)]">
                       Queries and returns all workspace accounts owned or co-managed by this profile context. You can use this to select which workspace to perform financial API calls upon.
                    </p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/workspaces" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/workspaces"
headers = {"Authorization": "Bearer <YOUR_API_KEY>"}

response = requests.get(url, headers=headers)
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/workspaces", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'get-projects' && (
               <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       List Workspace Projects
                       <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">GET</span>
                    </h2>
                    <p className="text-[var(--muted)]">
                       Retrieves the list of active business projects configured inside your workspace under ledger parameters.
                    </p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/projects?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/projects?workspaceId=${currentWorkspace?.id || 'ws_123'}"
headers = {"Authorization": "Bearer <YOUR_API_KEY>"}

response = requests.get(url, headers=headers)
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/projects?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>
             )}

             {activeDoc === 'post-project' && (
               <ApiHubDocPostProject model={model} />
             )}

          </div>
        </div>
      )}

      {activeTab === 'sandbox' && (
        <ApiHubSandbox model={model} />
      )}

      {activeTab === 'logs' && (
        <ApiHubLogs model={model} />
      )}

      {activeTab === 'billing' && (
        <ApiHubBilling model={model} />
      )}

    </div>
  );
}
