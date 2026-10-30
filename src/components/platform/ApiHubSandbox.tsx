

import { Copy, RefreshCw, Database, Shield, Play } from 'lucide-react';
import { cn } from '../../lib/utils';


import { Labelled } from '../ui/Labelled';

import type { useApiHubModel } from './useApiHubModel';
import { copyWithFeedback } from '../../lib/clipboard';
export function ApiHubSandbox({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { formId, currentWorkspace, publicKeys, sandboxEndpoint, setSandboxEndpoint, sandboxCredType, setSandboxCredType, sandboxSelectedKey, setSandboxSelectedKey, sandboxResult, setSandboxResult, sandboxStatus, setSandboxStatus, sandboxLatency, setSandboxLatency, sandboxLoading, sandboxLang, setSandboxLang, fieldDesc, setFieldDesc, fieldAmountCents, setFieldAmountCents, fieldDate, setFieldDate, fieldDryRun, setFieldDryRun, fieldIdempotencyKey, setFieldIdempotencyKey, fieldCOAName, setFieldCOAName, fieldCOAType, setFieldCOAType, fieldCOACode, setFieldCOACode, fieldProjectName, setFieldProjectName, fieldProjectCode, setFieldProjectCode, fieldMatchDesc, setFieldMatchDesc, fieldAIPrompt, setFieldAIPrompt, getEndpointPath, getSandboxPayload, runSandboxRequest } = model;
 return (<div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-300">
          <div className="lg:col-span-5 space-y-6">
            <div className="ledger-card p-6 space-y-6">
              <div className="flex items-center gap-3 border-b border-[var(--line)] pb-4">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Play aria-hidden="true" size={18} />
                </div>
                <div>
                  <h3 className="font-header font-bold text-[var(--text)]">Configure Live Request</h3>
                  <p className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-black">Interactive Sandbox Engine</p>
                </div>
              </div>

              {/* Endpoint select dropdown */}
              <div className="space-y-2">
                <Labelled labelClassName="text-[11px] font-black uppercase tracking-wider text-[var(--muted)]" label="Select API Route">
                  <select
                    value={sandboxEndpoint}
                    onChange={(e) => {
                      setSandboxEndpoint(e.target.value);
                      setSandboxResult(null);
                      setSandboxStatus(null);
                      setSandboxLatency(null);
                    }}
                    className="w-full bg-[var(--ink)] border border-[var(--line)] rounded-xl p-3 text-xs font-bold font-mono focus:ring-1 focus:ring-slate-950 focus:outline-none"
                  >
                    <option value="GET_v1_status">GET /api/v1/status (Verify Core Gateway Status)</option>
                    <option value="GET_v1_workspaces">GET /api/v1/workspaces (Query Tenant Profiles)</option>
                    <option value="GET_v1_ledger">GET /api/v1/ledger (Check Chart of Accounts)</option>
                    <option value="POST_v1_ledger">POST /api/v1/ledger (Provison COA Ledger Node)</option>
                    <option value="GET_v1_transactions">GET /api/v1/transactions (Sync Decisive Postings)</option>
                    <option value="POST_v1_transactions">POST /api/v1/transactions (Ingest Posting + Bayesian Learn)</option>
                    <option value="POST_v1_transactions_bulk">POST /api/v1/transactions/bulk (10x Bulk Ingest Engine)</option>
                    <option value="GET_v1_ledger_diagnostics">GET /api/v1/ledger/diagnostics (10x Ledger Sanity Diagnostics)</option>
                    <option value="GET_v1_projects">GET /api/v1/projects (Query Active Ventures)</option>
                    <option value="POST_v1_projects">POST /api/v1/projects (Map Corporate Scenario Submodule)</option>
                    <option value="GET_v1_metrics">GET /api/v1/metrics (Retrieve Sifting KPIs)</option>
                    <option value="POST_ledger_match">POST /api/v1/ledger/match (Parallel Rule Matching)</option>
                    <option value="POST_brain_analyze">POST /api/v1/brain/analyze (Query LedgerFlow AI Cognitive AI)</option>
                    <option value="POST_v1_brain_classify_batch">POST /api/v1/brain/classify-batch (10x Cognitive NLP Batch Categorizer)</option>
                  </select>
                </Labelled>
              </div>

              {/* Credentials auth select */}
              <div role="group" aria-labelledby={`${formId}-auth`} className="space-y-3 p-4 bg-[var(--ink)] border border-slate-150 rounded-xl">
                <div id={`${formId}-auth`} className="text-[11px] font-black uppercase tracking-wider text-slate-600 block">Security Authentication Identity</div>
                <div className="flex gap-2.5">
                  <button
                    onClick={() => setSandboxCredType('session')}
                    aria-pressed={sandboxCredType === 'session'}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border cursor-pointer text-center",
                      sandboxCredType === 'session' ? "bg-slate-950 text-white border-slate-950" : "bg-[var(--surface)] text-[var(--text)] border-[var(--line)] hover:bg-[var(--ink)]"
                    )}
                  >
                    Active Admin JWT Session
                  </button>
                  <button
                    aria-pressed={sandboxCredType === 'key'}
                    onClick={() => {
                      setSandboxCredType('key');
                      if (publicKeys.length > 0 && !sandboxSelectedKey) {
                        setSandboxSelectedKey(publicKeys[0].id);
                      }
                    }}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border cursor-pointer text-center",
                      sandboxCredType === 'key' ? "bg-slate-950 text-white border-slate-950" : "bg-[var(--surface)] text-[var(--text)] border-[var(--line)] hover:bg-[var(--ink)]"
                    )}
                  >
                    API Bearer Key
                  </button>
                </div>

                {sandboxCredType === 'key' && (
                  <div className="space-y-2 pt-2">
                    {publicKeys.length === 0 ? (
                      <div className="text-[10px] text-amber-600 font-bold bg-amber-50 p-2.5 border border-amber-200 rounded-lg">
                        ⚠️ No active developer API keys exist. Use the <strong>Auth Keys</strong> tab first or stick to Active Admin JWT credentials.
                      </div>
                    ) : (
                      <select
                        aria-label="API bearer key"
                        value={sandboxSelectedKey}
                        onChange={(e) => setSandboxSelectedKey(e.target.value)}
                        className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-lg px-2.5 py-1.5 text-[11px] font-mono focus:outline-none"
                      >
                        {publicKeys.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name} ({k.id.substring(0, 12)}...)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Dynamic input blocks based on active endpoint path selection */}
              <div className="space-y-4 pt-2 border-t border-[var(--line)]">
                <h4 className="text-[11px] font-extrabold uppercase text-slate-450 tracking-widest">Aperiodic Scope Parameters</h4>

                {/* POST TRANSACTION inputs */}
                {sandboxEndpoint === 'POST_v1_transactions' && (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Transaction Date">
                          <input
                            type="date"
                            value={fieldDate}
                            onChange={(e) => setFieldDate(e.target.value)}
                            className="w-full text-xs font-semibold p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-950"
                          />
                        </Labelled>
                      </div>
                      <div className="space-y-1">
                        <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Amount (Cents)">
                          <input
                            type="number"
                            value={fieldAmountCents}
                            onChange={(e) => setFieldAmountCents(parseFloat(e.target.value) || 0)}
                            className="w-full text-xs font-semibold p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-950 font-mono"
                          />
                        </Labelled>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Transaction Narration / Description">
                        <input
                          type="text"
                          value={fieldDesc}
                          onChange={(e) => setFieldDesc(e.target.value)}
                          placeholder="e.g. AWS S3 Storage Billing Tier"
                          className="w-full text-xs font-semibold p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-950"
                        />
                      </Labelled>
                    </div>

                    <div className="space-y-1.5 p-3 rounded-lg border border-[var(--line)] bg-[var(--ink)]/50">
                      <div className="flex items-center justify-between">
                        <label htmlFor={`${formId}-idempotency`} className="text-[9px] font-black uppercase text-[var(--muted)]">Idempotency Cryptic Key</label>
                        <button
                          onClick={() => setFieldIdempotencyKey("lf_idem_" + crypto.randomUUID())}
                          className="text-[9px] font-bold text-indigo-600 hover:underline bg-transparent border-0 cursor-pointer"
                        >
                          Regenerate
                        </button>
                      </div>
                      <input
                        id={`${formId}-idempotency`}
                        type="text"
                        value={fieldIdempotencyKey}
                        onChange={(e) => setFieldIdempotencyKey(e.target.value)}
                        className="w-full text-xs font-mono p-1.5 bg-[var(--surface)] border border-[var(--line)] rounded-md focus:outline-none focus:ring-1 focus:ring-slate-950"
                      />
                    </div>

                    <div className="flex items-center justify-between p-1">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-700">Dry-Run Mode</span>
                        <span className="text-[9px] text-[var(--muted)]">Validate values without storage commit.</span>
                      </div>
                      <input
                        aria-label="Dry-run mode"
                        type="checkbox"
                        checked={fieldDryRun}
                        onChange={(e) => setFieldDryRun(e.target.checked)}
                        className="w-4 h-4 rounded text-slate-950 focus:ring-slate-950"
                      />
                    </div>
                  </div>
                )}

                {/* POST LEDGER ACCOUNT inputs */}
                {sandboxEndpoint === 'POST_v1_ledger' && (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="space-y-1">
                      <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Account Node Name">
                        <input
                          type="text"
                          value={fieldCOAName}
                          onChange={(e) => setFieldCOAName(e.target.value)}
                          className="w-full text-xs font-semibold p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:ring-1 focus:ring-slate-950 focus:outline-none"
                        />
                      </Labelled>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Account Type Class">
                          <select
                            value={fieldCOAType}
                            onChange={(e) => setFieldCOAType(e.target.value)}
                            className="w-full text-xs font-semibold p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:outline-none font-sans"
                          >
                            <option value="asset">Asset (Liquid/Tangible)</option>
                            <option value="liability">Liability (Leases/Payable)</option>
                            <option value="equity">Equity (Shares/Retained)</option>
                            <option value="revenue">Revenue (Sales/Interest)</option>
                            <option value="expense">Expense (Procurement/Wages)</option>
                          </select>
                        </Labelled>
                      </div>
                      <div className="space-y-1">
                        <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Subledger Account Code">
                          <input
                            type="text"
                            value={fieldCOACode}
                            onChange={(e) => setFieldCOACode(e.target.value)}
                            placeholder="e.g. 5230"
                            className="w-full text-xs font-mono p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:outline-none focus:ring-1"
                          />
                        </Labelled>
                      </div>
                    </div>
                  </div>
                )}

                {/* POST PROJECT inputs */}
                {sandboxEndpoint === 'POST_v1_projects' && (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="space-y-1">
                      <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Venture/Project Name">
                        <input
                          type="text"
                          value={fieldProjectName}
                          onChange={(e) => setFieldProjectName(e.target.value)}
                          className="w-full text-xs font-semibold p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:ring-1 focus:ring-slate-950 focus:outline-none"
                        />
                      </Labelled>
                    </div>
                    <div className="space-y-1">
                      <Labelled labelClassName="text-[9px] font-black uppercase text-[var(--muted)]" label="Designation Code ID">
                        <input
                          type="text"
                          value={fieldProjectCode}
                          onChange={(e) => setFieldProjectCode(e.target.value)}
                          placeholder="INT-PHX-11"
                          className="w-full text-xs font-mono p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:outline-none"
                        />
                      </Labelled>
                    </div>
                  </div>
                )}

                {/* LEDGER MATCH & BATCH CLASSIFY inputs */}
                {(sandboxEndpoint === 'POST_ledger_match' || sandboxEndpoint === 'POST_v1_brain_classify_batch') && (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label htmlFor={`${formId}-descriptions`} className="text-[9px] font-black uppercase text-[var(--muted)]">Descriptions feedstock array (one-per-line)</label>
                        <span className={cn(
                          "text-[9px] font-semibold px-1.5 rounded",
                          sandboxEndpoint === 'POST_v1_brain_classify_batch' ? "bg-purple-50 text-purple-650" : "bg-emerald-50 text-[#228B22]"
                        )}>
                          {sandboxEndpoint === 'POST_v1_brain_classify_batch' ? "LedgerFlow AI engine" : "Bayesian matching pipeline"}
                        </span>
                      </div>
                      <textarea
                        id={`${formId}-descriptions`}
                        rows={4}
                        value={fieldMatchDesc}
                        onChange={(e) => setFieldMatchDesc(e.target.value)}
                        className="w-full font-mono text-[11px] p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:ring-1 focus:ring-slate-950 focus:outline-none"
                        placeholder={sandboxEndpoint === 'POST_v1_brain_classify_batch' ? "Google Workspace Subscription\nUber Trip Ride NY\nRent Office Suite 12\nHardware Store Staples" : "Uber trip ride...\nAWS Web Services"}
                      />
                    </div>
                  </div>
                )}

                {/* BRAIN ANALYZE inputs */}
                {sandboxEndpoint === 'POST_brain_analyze' && (
                  <div className="space-y-3 animate-in fade-in duration-150">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label htmlFor={`${formId}-prompt`} className="text-[9px] font-black uppercase text-[var(--muted)]">Cognitive Prompt Directive</label>
                        <span className="text-[9px] text-[#800080] font-semibold bg-purple-50 px-1.5 rounded">LedgerFlow AI Model</span>
                      </div>
                      <textarea
                        id={`${formId}-prompt`}
                        rows={4}
                        value={fieldAIPrompt}
                        onChange={(e) => setFieldAIPrompt(e.target.value)}
                        className="w-full text-xs p-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg focus:ring-1 focus:ring-slate-950 focus:outline-none"
                        placeholder="Provide details..."
                      />
                    </div>
                  </div>
                )}

                {/* Static / Empty params notice */}
                {(sandboxEndpoint.startsWith('GET_') || sandboxEndpoint === 'DELETE_') && (
                  <div className="py-4 text-center border border-[var(--line)] bg-[var(--ink)]/50 rounded-lg">
                    <p className="text-[11px] font-medium text-[var(--muted)] italic">No request body required for this rest protocol query.</p>
                    <p className="text-[9px] text-[var(--muted)] mt-1 font-mono">{`Method: ${sandboxEndpoint.split('_')[0]} | Workspace: ${currentWorkspace?.id || ''}`}</p>
                  </div>
                )}
              </div>

              {/* Fire button */}
              <button
                onClick={runSandboxRequest}
                disabled={sandboxLoading}
                className="w-full py-3.5 bg-slate-950 text-white font-black uppercase tracking-wider text-xs rounded-xl hover:bg-slate-800 disabled:bg-slate-300 transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer hover:scale-[1.01]"
               aria-label={sandboxLoading ? 'Calculating Double-Entry Matrix' : 'Execute aperiodic API query'}>
                {sandboxLoading ? (
                  <>
                    <RefreshCw aria-hidden="true" className="animate-spin" size={14} />
                    Calculating Double-Entry Matrix...
                  </>
                ) : (
                  <>
                    <Play aria-hidden="true" size={12} fill="currentColor" />
                    EXECUTE APERIODIC API QUERY
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="lg:col-span-12 xl:col-span-7 space-y-6">
            {/* Realtime generated code blocks side-by-side! */}
            <div className="ledger-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-900"></div>
                  <h4 className="font-header font-bold text-sm text-[var(--text)]">Dynamic Client SDK Generator</h4>
                </div>
                <div className="flex bg-[var(--ink)] rounded-lg p-0.5 border border-[var(--line)] gap-1">
                  <button
                    onClick={() => setSandboxLang('curl')}
                    className={cn("px-2.5 py-1 text-[10px] font-bold rounded-md cursor-pointer", sandboxLang === 'curl' ? "bg-[var(--surface)] text-slate-950 shadow-3xs" : "text-[var(--muted)]")}
                  >
                    cURL
                  </button>
                  <button
                    onClick={() => setSandboxLang('python')}
                    className={cn("px-2.5 py-1 text-[10px] font-bold rounded-md cursor-pointer", sandboxLang === 'python' ? "bg-[var(--surface)] text-slate-950 shadow-3xs" : "text-[var(--muted)]")}
                  >
                    Python
                  </button>
                  <button
                    onClick={() => setSandboxLang('node')}
                    className={cn("px-2.5 py-1 text-[10px] font-bold rounded-md cursor-pointer", sandboxLang === 'node' ? "bg-[var(--surface)] text-slate-950 shadow-3xs" : "text-[var(--muted)]")}
                  >
                    Node.js
                  </button>
                </div>
              </div>

              <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-4 overflow-x-auto border border-[#292E42] relative select-all">
                <button
                  onClick={() => {
                    const el = document.getElementById('playground_snippet_text');
                    if (el) {
                      void copyWithFeedback(el.innerText, 'Generated SDK segment copied to clipboard!');
                    }
                  }}
                  className="absolute top-2.5 right-2.5 py-1 px-2.5 bg-[#24283B] text-[#9ECE6A] text-[9px] rounded hover:bg-[#2F3549] cursor-pointer flex items-center gap-1 border-0"
                >
                  <Copy aria-hidden="true" size={10} /> Copier
                </button>
                <pre id="playground_snippet_text" className="font-mono text-xs leading-relaxed max-h-[220px]">
{/* Display generated source code dynamically */}
{sandboxLang === 'curl' ? (
`curl -X ${sandboxEndpoint.split('_')[0]} "https://${window.location.host}/api/v1/${getEndpointPath(sandboxEndpoint)}${sandboxEndpoint.startsWith('GET_') && !sandboxEndpoint.includes('workspaces') ? '?workspaceId='+(currentWorkspace?.id || '') : ''}" \\
  -H "Authorization: Bearer ${sandboxCredType === 'session' ? '<YOUR_ADMIN_SESSION_TOKEN>' : (sandboxSelectedKey || '<YOUR_API_KEY>')}" \\
${sandboxEndpoint.startsWith('POST_') ? `  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(getSandboxPayload(sandboxEndpoint), null, 2)}'` : ''}`
) : sandboxLang === 'python' ? (
`import requests

url = "https://${window.location.host}/api/v1/${getEndpointPath(sandboxEndpoint)}"
headers = {
    "Authorization": "Bearer ${sandboxCredType === 'session' ? 'SESSION_TOKEN' : (sandboxSelectedKey || 'API_KEY')}",
    "Content-Type": "application/json"
}
${sandboxEndpoint.startsWith('GET_') ? `params = { "workspaceId": "${currentWorkspace?.id || ''}" }
response = requests.get(url, headers=headers, params=params)` : `payload = ${JSON.stringify(getSandboxPayload(sandboxEndpoint), null, 4)}
response = requests.post(url, headers=headers, json=payload)`}
print(response.json())`
) : (
`import fetch from 'node-fetch';

const url = "https://${window.location.host}/api/v1/${getEndpointPath(sandboxEndpoint)}${sandboxEndpoint.startsWith('GET_') && !sandboxEndpoint.includes('workspaces') ? '?workspaceId='+(currentWorkspace?.id || '') : ''}";

fetch(url, {
  method: '${sandboxEndpoint.split('_')[0]}',
  headers: {
    'Authorization': 'Bearer ${sandboxCredType === 'session' ? 'SESSION_TOKEN' : (sandboxSelectedKey || 'API_KEY')}',
    'Content-Type': 'application/json'
  }${sandboxEndpoint.startsWith('POST_') ? `,\n  body: JSON.stringify(${JSON.stringify(getSandboxPayload(sandboxEndpoint), null, 2).replace(/\n/g, '\n  ')})` : ''}
})
.then(res => res.json())
.then(data => console.info(data))
.catch(console.error);`
)}
                </pre>
              </div>
            </div>

            {/* Sandbox response view box */}
            <div className="ledger-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                <div className="flex items-center gap-2">
                  <Database aria-hidden="true" size={16} className="text-slate-450" />
                  <span className="font-header font-bold text-sm text-[var(--text)]">Integrity Engine Response Buffer</span>
                </div>

                {sandboxStatus !== null && (
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--muted)] font-mono font-bold uppercase">Latency: <strong className="text-[var(--text)]">{sandboxLatency} ms</strong></span>
                    <span className={cn(
                      "px-2 px-1 py-0.5 rounded-md text-[10px] font-black tracking-wider uppercase font-mono text-white",
                      sandboxStatus >= 200 && sandboxStatus < 300 ? "bg-emerald-500" : "bg-rose-500"
                    )}>
                      Status {sandboxStatus}
                    </span>
                  </div>
                )}
              </div>

              {!sandboxLoading && sandboxResult == null && (
                <div className="p-4 md:p-8 text-center text-[var(--muted)] italic text-xs space-y-2 border border-dashed border-[var(--line)] bg-[var(--ink)]/50 rounded-xl">
                  <p>Execute an API query inside the left configuration deck to view operational responses in real-time.</p>
                  <p className="text-[10px] text-slate-350 font-mono">Payload parameters are completely sanitised & verified against your active database ledger nodes.</p>
                </div>
              )}

              {sandboxLoading && (
                <div className="p-12 text-center border border-[var(--line)] bg-[var(--ink)]/20 rounded-xl flex flex-col items-center justify-center space-y-4 animate-in fade-in">
                  <RefreshCw aria-hidden="true" size={24} className="animate-spin text-slate-550" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-700">Inquiring Integrity Ledger Gateways...</p>
                    <p className="text-[10px] text-slate-450">Verifying signature key matching and double-entry transaction locks</p>
                  </div>
                </div>
              )}

              {sandboxResult != null && (
                <div className="space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-[#1A1B26] text-[#A9B1D6] rounded-xl p-4 border border-[#292E42] max-h-[350px] overflow-y-auto select-all relative">
                    <button
                      onClick={() => {
                        void copyWithFeedback(JSON.stringify(sandboxResult, null, 2), 'Response JSON copied to clipboard!');
                      }}
                      className="absolute top-2.5 right-2.5 py-1 px-2.5 bg-[#24283B] text-[#7AA2F7] text-[9px] rounded hover:bg-[#2F3549] cursor-pointer border-0"
                    >
                      Copy JSON
                    </button>
                    <pre className="font-mono text-xs leading-relaxed">
                      {JSON.stringify(sandboxResult, null, 2)}
                    </pre>
                  </div>
                  <div className="flex justify-between items-center bg-[var(--ink)] border border-slate-220/80 rounded-xl px-4 py-3 text-[10px] text-[var(--muted)] font-medium">
                    <span className="flex items-center gap-1.5"><Shield aria-hidden="true" size={12} className="text-emerald-600" /> Double-entry verified successfully</span>
                    <span className="font-mono text-slate-600">Computation: {sandboxStatus === 201 || sandboxEndpoint.includes('POST_brain') ? '15 units computed' : '1 unit computed'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>);
}
