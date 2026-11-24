import { useApiHubModel } from './useApiHubModel';

export function ApiHubDocShiftingMetrics({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                   <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">Shifting Telemetry & Metric Audits</h2>
                   <p className="text-[var(--muted)] font-medium text-xs leading-relaxed">This call returns business-type telemetry based on ledger data.</p>
                   <p role="note" className="mt-2 text-sm text-amber-700">Some shifting metrics use assumptions or fallback values rather than measured figures. The field named net operating cash flow is revenue minus expense, not a cash-flow statement. Use the appropriate reports for financial decisions.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/metrics?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/metrics?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.get(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/metrics?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>

                 <h3 className="font-bold text-sm border-b border-[var(--line)] pb-2 mt-8">Example Response (SaaS Archetype example)</h3>
                 <div className="bg-[var(--ink)]/50 text-xs p-4 rounded-xl border border-[var(--line)] font-mono font-medium">
{`{
  "status": "success",
  "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
  "businessType": "saas",
  "coreMetrics": {
    "grossRevenueCents": 12500000,
    "operatingExpenseCents": 6400000,
    "netOperatingCashFlowCents": 6100000,
    "totalLiquidAssetsCents": 32000000,
    "totalLiabilitiesCents": 8000000,
    "equityValueCents": 24000000
  },
  "shiftingMetrics": {
    "industryType": "SaaS & Subscription",
    "metrics": {
      "arrCents": 150000000,
      "mrrCents": 12500000,
      "ltvCents": 250000000,
      "churnPercentage": 5.0,
      "grossMarginPercentage": 48.8
    }
  },
  "timestamp": "2026-06-07T16:00:00.000Z"
}`}
                 </div>
               </div>);
}

export function ApiHubDocDeepAudit({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                   <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">Deep Strategic Strategy Auditing</h2>
                   <p className="text-[var(--muted)] font-medium text-xs leading-relaxed">This high-margin endpoint launches a deep strategic simulation job examining: Velocity AR Bleed (WACC Capital Drag on outstanding invoices), Customer Overconcentration Risks, and Physical/Procurement bulk margin arbitrage. It follows an asynchronous job pattern to avoid HTTP client timeouts.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/audit/deep" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}"
  }'` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/audit/deep"
headers = {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json"
}
payload = {
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}"
}
response = requests.post(url, headers=headers, json=payload)
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/audit/deep", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ workspaceId: "${currentWorkspace?.id || 'ws_123'}" })
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>

                 <h3 className="font-bold text-sm border-b border-[var(--line)] pb-2 mt-8">Example Response (Asynchronous job accepted)</h3>
                 <div className="bg-[var(--ink)]/50 text-xs p-4 rounded-xl border border-[var(--line)] font-mono font-medium">
{`{
  "status": "processing",
  "message": "Strategic simulation launched asynchronously. Please poll job endpoint for results.",
  "job_id": "job_1701234567_abcd",
  "check_status_url": "/api/v1/audit/jobs/job_1701234567_abcd"
}`}
                 </div>
               </div>);
}

export function ApiHubDocPollAudit({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                   <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">Retrieve Deep Strategic Results</h2>
                   <p className="text-[var(--muted)] font-medium text-xs leading-relaxed">Polls the status of an asynchronous deep audit job. Once the compute is completed, returns granular analytical matrices on EBITDA values, cost-of-capital receivables bleeds, multiple haircuts, and an automated Markdown Executive report.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X GET "https://api.ledgerflow.io/api/v1/audit/jobs/job_1701234567_abcd?workspaceId=${currentWorkspace?.id || 'ws_123'}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>"` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/audit/jobs/job_1701234567_abcd?workspaceId=${currentWorkspace?.id || 'ws_123'}"
response = requests.get(url, headers={"Authorization": "Bearer <YOUR_API_KEY>"})
print(response.json())` :
`const fetch = require('node-fetch');

fetch("https://api.ledgerflow.io/api/v1/audit/jobs/job_1701234567_abcd?workspaceId=${currentWorkspace?.id || 'ws_123'}", {
  headers: { 'Authorization': 'Bearer <YOUR_API_KEY>' }
}).then(res => res.json()).then(data => console.info(data));`}
</pre>
                 </div>

                 <h3 className="font-bold text-sm border-b border-[var(--line)] pb-2 mt-8">Example Response (Complete Audit Report)</h3>
                 <div className="bg-[var(--ink)]/50 text-xs p-4 rounded-xl border border-[var(--line)] font-mono font-medium font-medium">
{`{
  "status": "success",
  "job_id": "job_1701234567_abcd",
  "jobStatus": "completed",
  "progress": 100,
  "completedAt": "2026-06-07T16:02:15.000Z",
  "results": {
    "velocityArBleed": {
      "totalCapitalCostDragCents": 142000,
      "logsCount": 3,
      "logs": [
        { "invoiceId": "inv_99", "customerName": "Acme Corp", "daysOutstanding": 45, "impliedCostOfCapitalCents": 98000 }
      ]
    },
    "concentrationRisk": {
      "maxClientContributionRatio": 0.452,
      "isConcentratedThresholdTriggered": true,
      "haircutMultiplierHit": 0.85
    },
    "valuationMatrix": {
      "ebitdaCents": 43500000,
      "baseMultiple": 4.5,
      "impliedValuationBaseCents": 195750000,
      "actualAdjustedValuationCents": 166245500
    },
    "markdownNarrative": "### Executive Strategic Audit Narrative..."
  }
}`}
                 </div>
               </div>);
}

export function ApiHubDocPutTransaction({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { currentWorkspace, docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Update Transaction Record
                       <span className="text-[10px] bg-yellow-500 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">PUT</span>
                    </h2>
                    <p className="text-[var(--muted)]">
                       Allows modifying an existing transaction by ID. Enforces double-entry balances, updates audit logs, and validates target period locking locks.
                    </p>
                 </div>

                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X PUT "https://api.ledgerflow.io/api/v1/transactions/<TRANSACTION_ID>" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "description": "AWS Hosting Tier Upgrade",
    "amountCents": 185000
  }'` :
 docLang === 'python' ? `import requests

url = "https://api.ledgerflow.io/api/v1/transactions/<TRANSACTION_ID>"
headers = {
    "Authorization": "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json"
}
payload = {
    "workspaceId": "${currentWorkspace?.id || 'ws_123'}",
    "description": "AWS Hosting Tier Upgrade",
    "amountCents": 185000
}

response = requests.put(url, headers=headers, json=payload)
print(response.json())` :
`const fetch = require('node-fetch');

const url = "https://api.ledgerflow.io/api/v1/transactions/<TRANSACTION_ID>";
const payload = {
  workspaceId: "${currentWorkspace?.id || 'ws_123'}",
  description: "AWS Hosting Tier Upgrade",
  amountCents: 185000
};

fetch(url, {
  method: 'PUT',
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

export function ApiHubDocMathDepreciation({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Depreciation Math Engine
                       <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">Calculate straight-line or declining balance asset depreciation using the core engine.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/math/depreciation" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "double_declining_balance",
    "costCents": 5000000,
    "salvageValueCents": 1000000,
    "usefulLifePeriods": 60,
    "multiplier": 2
  }'` :
`const response = await fetch("https://api.ledgerflow.io/api/v1/math/depreciation", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    type: "double_declining_balance", // supports: straight_line, declining_balance, sum_of_years_digits
    costCents: 5000000, // $50,000.00
    salvageValueCents: 1000000, // $10,000.00
    usefulLifePeriods: 60, // 5 years in months
    multiplier: 2 // Or 1.5 for 150% declining balance
  })
});

const { depreciationPerPeriodCents } = await response.json();`}
</pre>
                 </div>
               </div>);
}

export function ApiHubDocMathInventory({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Inventory Costing Engine
                       <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">Determine Weighted Average Cost (WAC) dynamically for inventory valuations.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/math/inventory/wac" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "currentQty": 100,
    "currentValueCents": 500000,
    "incomingQty": 50,
    "incomingValueCents": 300000
  }'` :
`const response = await fetch("https://api.ledgerflow.io/api/v1/math/inventory/wac", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    currentQty: 100,
    currentValueCents: 500000,
    incomingQty: 50,
    incomingValueCents: 300000
  })
});

const { newAverageCostCents } = await response.json();`}
</pre>
                 </div>
               </div>);
}

export function ApiHubDocMathAmortization({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { docLang } = model;
 return (<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                 <div>
                    <h2 className="text-2xl font-bold font-display mb-2 flex items-center gap-2">
                       Amortization Math Engine
                       <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">POST</span>
                    </h2>
                    <p className="text-[var(--muted)]">Equivalent to the PMT function. Calculates constant periodic loan amortizations.</p>
                 </div>
                 <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-5 overflow-x-auto border border-[#292E42]">
<pre className="font-mono text-[13px] leading-relaxed">
{docLang === 'curl' ? `curl -X POST "https://api.ledgerflow.io/api/v1/math/amortization" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "principalCents": 10000000,
    "annualInterestRate": 0.05,
    "totalPeriods": 360,
    "paymentsPerYear": 12
  }'` :
`const response = await fetch("https://api.ledgerflow.io/api/v1/math/amortization", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    principalCents: 10000000, // $100,000.00
    annualInterestRate: 0.05, // 5%
    totalPeriods: 360, // 30 Years * 12 months
    paymentsPerYear: 12 // Optional, overrides hardcoded monthly assumptions
  })
});

const { periodicPaymentCents } = await response.json();`}
</pre>
                 </div>
               </div>);
}
