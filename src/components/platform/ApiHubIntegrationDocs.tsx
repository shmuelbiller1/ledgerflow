import { useApiHubModel } from './useApiHubModel';

export function ApiHubDocMathKpi({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Financial Health (KPIs & Ratios)
                       <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">Dynamic API for bulk calculating advanced enterprise ratios (ROI, NPV, Break-Even, Liquidity).</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/math/kpi" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "netProfitCents": 1500000,
    "investmentCostCents": 10000000,
    "currentAssetsCents": 5000000,
    "currentLiabilitiesCents": 2000000
  }'` :
`const response = await fetch("https://api.ledgerflow.io/api/v1/math/kpi", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    // Input any combinations of fundamentals to receive their KPIs
    netProfitCents: 1500000,
    investmentCostCents: 10000000,
    
    currentAssetsCents: 5000000,
    currentLiabilitiesCents: 2000000
  })
});

const kpiResults = await response.json();
// Returns: { roiPercentage: 15, currentRatio: 2.5, ... }`}
</pre>
                 </div>
               </div>);
}

export function ApiHubDocMathTemporal({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Temporal Validity Engine
                       <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">Resolves time-bound financial configurations (Tax changes, Currency fluctuations) efficiently.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed tabular-nums">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/math/temporal" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "tax",
    "amountCents": 1500000,
    "targetDate": "2024-03-01",
    "timeSeries": [
      { "validFrom": "0000-01-01", "validTo": "2023-12-31", "value": 0.08 },
      { "validFrom": "2024-01-01", "validTo": "9999-12-31", "value": 0.095 }
    ]
  }'` :
`const response = await fetch("https://api.ledgerflow.io/api/v1/math/temporal", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    type: "tax", // or "currency"
    amountCents: 1500000, // $15,000.00
    targetDate: "2024-03-01", // The transaction date you need integrity for
    timeSeries: [
      { validFrom: "0000-01-01", validTo: "2023-12-31", value: 0.08 }, // 8% tax rate
      { validFrom: "2024-01-01", validTo: "9999-12-31", value: 0.095 } // Tax increased to 9.5%
    ]
  })
});

const { effectiveValue, calculatedAmountCents } = await response.json();
// System safely resolves the 9.5% rate and calculates the burden without silent fallbacks`}
</pre>
                 </div>
               </div>);
}

export function ApiHubDocPostProject({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Create Business Project
                       <span className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">
                       Registers a new corporate project resource inside your workspace ledger to enable targeted activity tracking.
                    </p>
                    <p role="note" className="mt-2 text-sm text-amber-700">Send an Idempotency-Key header with each create: a retry with the same key (for example after a lost response) returns the first project instead of making another. Without the header every request creates a project.</p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/projects" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "name": "Integration Project",
    "code": "INT-001",
    "description": "API-triggered corporate development sub-ledger"
  }'` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/projects"
headers = {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json"
}
payload = {
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "name": "Integration Project",
    "code": "INT-001"
}

response = requests.post(url, headers=headers, json=payload)
print(response.json())` :
`const fetch = require('node-fetch');

const url = "https://api.ledgerflow.io/api/v1/projects";
const payload = {
  workspaceId: "${currentWorkspace?.id || 'ws_123'}",
  name: "Integration Project",
  code: "INT-001"
};

fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <YOUR_API_KEY>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>
               </div>);
}
