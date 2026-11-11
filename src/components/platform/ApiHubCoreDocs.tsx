import { cn } from '../../lib/utils';
import { useApiHubModel } from './useApiHubModel';

import { BRAND_NAME } from '../../config/brand';
export function ApiHubDocsNavigation({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { activeDoc, setActiveDoc } = model;
 return (<div className="w-full md:w-64 border-r border-[var(--line)] overflow-y-auto bg-[var(--ink)]/20 p-4 shrink-0 space-y-6">
             <div>
                <div className="font-bold text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3 px-2">Core Telemetry</div>
                <div className="space-y-1">
                  <button onClick={() => setActiveDoc('get-status')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-status' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-indigo-600" : "hover:bg-[var(--ink)]/50")}>GET /status</button>
                  <button onClick={() => setActiveDoc('get-logs')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-logs' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-indigo-600" : "hover:bg-[var(--ink)]/50")}>GET /logs</button>
                  <button onClick={() => setActiveDoc('get-metrics')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-metrics' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-[#8A2BE2]" : "hover:bg-[var(--ink)]/50")}>GET /metrics/summary</button>
                  <button onClick={() => setActiveDoc('shifting-metrics')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'shifting-metrics' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-[#8A2BE2]" : "hover:bg-[var(--ink)]/50")}>GET /metrics (Shifting Telemetry)</button>
                </div>
             </div>

             <div>
                <div className="font-bold text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3 px-2">Ledger Config</div>
                <div className="space-y-1">
                  <button onClick={() => setActiveDoc('get-ledger')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-ledger' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-indigo-600" : "hover:bg-[var(--ink)]/50")}>GET /ledger</button>
                  <button onClick={() => setActiveDoc('post-ledger')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'post-ledger' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-emerald-500" : "hover:bg-[var(--ink)]/50")}>POST /ledger</button>
                </div>
             </div>

             <div>
                <div className="font-bold text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3 px-2">Transactions</div>
                <div className="space-y-1">
                  <button onClick={() => setActiveDoc('get-transaction')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-transaction' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-indigo-600" : "hover:bg-[var(--ink)]/50")}>GET /transactions</button>
                  <button onClick={() => setActiveDoc('post-transaction')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'post-transaction' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-emerald-500" : "hover:bg-[var(--ink)]/50")}>POST /transactions</button>
                  <button onClick={() => setActiveDoc('put-transaction')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'put-transaction' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-amber-500" : "hover:bg-[var(--ink)]/50")}>PUT /transactions/:id</button>
                  <button onClick={() => setActiveDoc('delete-transaction')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'delete-transaction' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-rose-500" : "hover:bg-[var(--ink)]/50")}>DELETE /transactions/:id</button>
                </div>
             </div>

             <div>
                <div className="font-bold text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3 mt-6 px-2">TruthEngine Math</div>
                <div className="space-y-1">
                  <button onClick={() => setActiveDoc('math-depreciation')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'math-depreciation' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-purple-600" : "hover:bg-[var(--ink)]/50")}>POST /math/depreciation</button>
                  <button onClick={() => setActiveDoc('math-inventory')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'math-inventory' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-purple-600" : "hover:bg-[var(--ink)]/50")}>POST /math/inventory/wac</button>
                  <button onClick={() => setActiveDoc('math-eoq')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'math-eoq' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-purple-600" : "hover:bg-[var(--ink)]/50")}>POST /math/inventory/eoq</button>
                  <button onClick={() => setActiveDoc('math-amortization')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'math-amortization' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-purple-600" : "hover:bg-[var(--ink)]/50")}>POST /math/amortization</button>
                  <button onClick={() => setActiveDoc('math-kpi')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'math-kpi' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-purple-600" : "hover:bg-[var(--ink)]/50")}>POST /math/kpi</button>
                  <button onClick={() => setActiveDoc('math-temporal')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'math-temporal' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-purple-600" : "hover:bg-[var(--ink)]/50")}>POST /math/temporal</button>
                </div>
             </div>

             <div>
                <div className="font-bold text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3 px-2">Workspaces & Projects</div>
                <div className="space-y-1">
                  <button onClick={() => setActiveDoc('get-workspaces')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-workspaces' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-indigo-600" : "hover:bg-[var(--ink)]/50")}>GET /workspaces</button>
                  <button onClick={() => setActiveDoc('get-projects')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'get-projects' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-indigo-600" : "hover:bg-[var(--ink)]/50")}>GET /projects</button>
                  <button onClick={() => setActiveDoc('post-project')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'post-project' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-emerald-500" : "hover:bg-[var(--ink)]/50")}>POST /projects</button>
                </div>
             </div>

             <div>
                <div className="font-bold text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3 px-2">AI {BRAND_NAME} AI & ML</div>
                <div className="space-y-1">
                  <button onClick={() => setActiveDoc('post-brain')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'post-brain' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-[#8A2BE2]" : "hover:bg-[var(--ink)]/50")}>POST /brain/analyze</button>
                  <button onClick={() => setActiveDoc('post-classify')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'post-classify' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-[#d1502c]" : "hover:bg-[var(--ink)]/50")}>POST /brain/classify</button>
                  <button onClick={() => setActiveDoc('deep-audit')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'deep-audit' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-[#d1502c]" : "hover:bg-[var(--ink)]/50")}>POST /audit/deep</button>
                  <button onClick={() => setActiveDoc('poll-audit')} className={cn("w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all", activeDoc === 'poll-audit' ? "bg-[var(--surface)] shadow-sm font-bold border border-[var(--line)] text-[#d1502c]" : "hover:bg-[var(--ink)]/50")}>GET /audit/jobs/:job_id</button>
                </div>
             </div>
          </div>);
}

export function ApiHubDocGetStatus({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2">Check Engine Status</h2>
                    <p className="text-[var(--muted)]">Pings the {BRAND_NAME} core API and returns active workspace metadata, currency settings, and uptime telemetry.</p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/status?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/status?workspaceId=${currentWorkspace?.id || 'ws_123'}"
headers = {"Authorization": "Bearer <YOUR_API_KEY>"}

response = requests.get(url, headers=headers)
print(response.json())` :
`const fetch = require('node-fetch');

const url = "https://api.ledgerflow.io/api/v1/status?workspaceId=${currentWorkspace?.id || 'ws_123'}";
const options = {
  method: 'GET',
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
};

fetch(url, options)
  .then(res => res.json())
  .then(json => console.debug(json));`}
</pre>
                 </div>

                 <h3 className="font-bold text-sm border-b border-[var(--line)] pb-2 mt-8">Example Response</h3>
                 <div className="bg-[var(--ink)]/50 text-xs p-4 rounded-xl border border-[var(--line)] font-mono">
{`{
  "status": "active",
  "service": "TruthEngine API",
  "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
  "metadata": {
    "name": "Acme Corp",
    "currency": "USD",
    "lockDate": null,
    "businessType": "general"
  },
  "uptime": 12450.45,
  "timestamp": "2026-05-28T14:22:15Z"
}`}
                 </div>
               </div>);
}

export function ApiHubDocPostTransaction({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                      Create Transaction
                      <span className="text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">
                       Injects a new structural double-entry transaction. This endpoint guarantees atomic integrity—if the ledger lines do not sum exactly to zero, the transaction is rejected instantly.
                    </p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/transactions" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Idempotency-Key: req_123456789" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "date": "2026-05-28",
    "description": "AWS Hosting",
    "payee": "Amazon Web Services",
    "amountCents": 145000
  }'` :
 docLang === 'python' ? `import requests
import uuid

url = "https://api.ledgerflow.io/api/v1/transactions"
headers = {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Idempotency-Key": str(uuid.uuid4()),
    "Content-Type": "application/json"
}
payload = {
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "date": "2026-05-28",
    "description": "AWS Hosting",
    "amountCents": 145000
}

response = requests.post(url, headers=headers, json=payload)
print(response.json())` :
`const fetch = require('node-fetch');
const crypto = require('crypto');

const url = "https://api.ledgerflow.io/api/v1/transactions";
const payload = {
  workspaceId: "${currentWorkspace?.id || 'ws_123'}",
  date: "2026-05-28",
  description: "AWS Hosting",
  amountCents: 145000
};

fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <YOUR_API_KEY>',
    'Idempotency-Key': crypto.randomUUID(),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>

                 <p className="text-xs text-[var(--muted)] bg-slate-900/10 p-4 rounded-xl border border-indigo-600/20">
                   <strong>💡 Auto-Balancing:</strong> The example above uses <code className="bg-[var(--surface)]/50 px-1 py-0.5 rounded ml-1">amountCents</code> instead of strict <code className="bg-[var(--surface)]/50 px-1 py-0.5 rounded ml-1">lines</code>.
                   The {BRAND_NAME} engine will intuitively pair your default operational expense and liquid asset accounts to balance the entry automatically. To specify multi-line distribution, pass an array of <code className="bg-[var(--surface)]/50 px-1 py-0.5 rounded ml-1">lines</code>.
                 </p>
               </div>);
}

export function ApiHubDocPostBrain({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Analyze with AI {BRAND_NAME} AI
                       <span className="text-[10px] bg-[#8A2BE2] text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">
                      Ask the {BRAND_NAME} AI engine a question about your financial data. The deep engine securely compiles your ledger context and queries the rule models directly.
                    </p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/brain/analyze" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "prompt": "Based on my transaction velocity over the last 30 days, am I trending towards a cash flow deficit?"
  }'` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/brain/analyze"
headers = {"Authorization": "Bearer <YOUR_API_KEY>"}
payload = {
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "prompt": "Analyze my biggest expense categories and suggest optimization strategies."
}

res = requests.post(url, headers=headers, json=payload)
print(res.json().get('analysis'))` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/brain/analyze", {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <YOUR_API_KEY>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    workspaceId: "${currentWorkspace?.id || 'ws_123'}",
    prompt: "Scan recent transactions for duplicated software subscriptions."
  })
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>);
}

export function ApiHubDocPostClassify({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div>
                     <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                        Classify with Self-Learning ML
                        <span className="text-[10px] bg-[#d1502c] text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                     </h2>
                     <p className="text-[var(--muted)]">
                       Instantly trains a Laplace-smoothed Naive Bayes bigram classifier on your workspace's past journal entries and categorizes incoming payment descriptions with machine confidence metrics.
                     </p>
                  </div>

                  <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/brain/classify" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || "ws_123"}",
    "description": "Amazon Web Services EC2 cloud node billing invoice",
    "targetFeatures": [
      { "text": "Google Cloud", "category": "Software & Subscriptions" },
      { "text": "Coffee and donuts", "category": "Meals & Entertainment" }
    ]
  }'` :
 docLang === 'python' ? `import requests
 
url = "https://api.ledgerflow.io/api/v1/brain/classify"
headers = {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json"
}
payload = {
    "workspaceId": "${currentWorkspace?.id || "ws_123"}",
    "description": "Starbucks downtown office breakfast",
    "targetFeatures": []
}
 
res = requests.post(url, headers=headers, json=payload)
print(res.json())` :
`const fetch = require("node-fetch");
 
fetch("https://api.ledgerflow.io/api/v1/brain/classify", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    workspaceId: "${currentWorkspace?.id || "ws_123"}",
    description: "AWS cloud server hosting billing",
    targetFeatures: []
  })
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                  </div>

                  <h3 className="font-bold text-sm border-b border-[var(--line)] pb-2 mt-8">Example Response</h3>
                  <div className="bg-[var(--ink)]/50 text-xs p-4 rounded-xl border border-[var(--line)] font-mono">
{`{
  "status": "success",
  "trainedModelCount": 124,
  "queryDescription": "Amazon Web Services EC2 cloud node billing invoice",
  "prediction": {
    "category": "Software & Subscriptions",
    "confidence": 0.9854,
    "label": "SOFTWARE_SUBSCRIPTIONS"
  }
}`}
                  </div>
                </div>);
}

export function ApiHubDocPostLedger({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">Create Ledger Account</h2>
                    <p className="text-[var(--muted)]">Append a new structural node to the Chart of Accounts.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/ledger" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "name": "Fleet Vehicles",
    "type": "asset",
    "code": "1520"
  }'` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/ledger"
payload = {
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "name": "Fleet Vehicles",
    "type": "asset",
    "code": "1520"
}
response = requests.post(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"}, json=payload)
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/ledger", {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <YOUR_API_KEY>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    workspaceId: "${currentWorkspace?.id || 'ws_123'}",
    name: "Fleet Vehicles",
    type: "asset",
    code: "1520"
  })
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>);
}

export function ApiHubDocGetMetrics({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">Fetch Core Analytics</h2>
                    <p className="text-[var(--muted)]">Aggregates all double-entry ledger lines to compute your core financial footprint in real-time. Calculate your Net Income, OPEX, Assets, and Equity.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/metrics/summary?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/metrics/summary?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.get(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/metrics/summary?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>

                 <h3 className="font-bold text-sm border-b border-[var(--line)] pb-2 mt-8">Example Response</h3>
                 <div className="bg-[var(--ink)]/50 text-xs p-4 rounded-xl border border-[var(--line)] font-mono">
{`{
  "status": "success",
  "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
  "metrics": {
    "netIncomeCents": 3450000,
    "grossRevenueCents": 4200000,
    "totalOpExCents": 750000,
    "currentAssetsCents": 12450000,
    "totalLiabilitiesCents": 2100000,
    "equityCents": 10350000
  },
  "transactionVolume": 432
}`}
                 </div>
               </div>);
}
