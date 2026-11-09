

import { Key, Copy, RefreshCw, CheckCircle2, AlertCircle, Shield, Trash2, Clock, Lock, X } from 'lucide-react';

import { cn } from '../../lib/utils';


import { Labelled } from '../ui/Labelled';
import { AVAILABLE_SCOPES } from './ApiHubShared';
import type { useApiHubModel } from './useApiHubModel';
import { inBackground } from '../../lib/inBackground';
export function ApiHubKeys({ model }: { model: ReturnType<typeof useApiHubModel> }) {
 const { overlayDialogProps, overlayTitleId, formId, currentWorkspace, nowMs, apiKey, isRegenerating, isCopied, publicKeys, newKeyName, setNewKeyName, selectedScopes, setSelectedScopes, expiration, setExpiration, perMinute, setPerMinute, showCreateModal, setShowCreateModal, generateNewKey, revokeKey, copyKey } = model;
 return (<div className="space-y-6">
          <div className="ledger-card p-4 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--line)] pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-[32px] bg-slate-950 text-white flex items-center justify-center">
                  <Key aria-hidden="true" size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display text-slate-950">Workspace API Keys</h2>
                  <p className="text-sm text-[var(--muted)]">Manage Bearer tokens with full or granular access scopes to integrate with external systems.</p>
                </div>
              </div>
              <button
                 onClick={() => {
                   setNewKeyName(`Integration Key (${new Date().toLocaleDateString()})`);
                   setSelectedScopes(AVAILABLE_SCOPES.map(s => s.id));
                   setExpiration('never');
                   setShowCreateModal(true);
                 }}
                 className="px-5 py-2.5 bg-slate-950 text-white font-bold rounded-xl text-sm hover:bg-slate-800 transition-all flex items-center gap-2 self-start sm:self-auto shrink-0 shadow-sm hover:scale-[1.01]"
               >
                 <RefreshCw aria-hidden="true" size={14} />
                 Generate New Key
               </button>
            </div>

            {apiKey && (
              <div className="p-6 bg-emerald-50 rounded-[32px] border border-emerald-500/20 shadow-3xs">
                <div className="flex gap-3 items-center mb-3">
                   <AlertCircle aria-hidden="true" className="text-emerald-600 shrink-0" size={20} />
                   <h4 className="text-sm font-black uppercase text-emerald-800 tracking-wider">Secret Key Generated Successfully</h4>
                </div>
                <p className="text-xs text-emerald-700/80 mb-4 font-medium">
                  <strong>Private Hashing Notice:</strong> Please copy this secret key now. For your security, LedgerFlow does NOT store this raw token string in the database. You will not be able to retrieve or see these characters again after you close this warning.
                </p>

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                  <div className="flex-1 font-mono text-xs bg-[var(--surface)] border border-emerald-500/30 p-4 rounded-xl text-[var(--text)] font-bold break-all shadow-3xs">
                      {apiKey}
                  </div>
                  <button
                    onClick={copyKey}
                    className="px-6 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shrink-0 shadow-sm"
                   aria-label={isCopied ? 'Token copied' : 'Copy token'}>
                    {isCopied ? <CheckCircle2 aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
                    {isCopied ? 'Copied' : 'Copy Token'}
                  </button>
                </div>

                <div className="mt-5 bg-[var(--surface)]/40 p-4 rounded-xl border border-emerald-500/10 text-xs">
                  <div className="font-bold text-emerald-800 mb-2">Configure Client Integrations:</div>
                  <p className="text-slate-600 mb-2">Provide this credential in the HTTP <code className="bg-[var(--surface)] px-1 py-0.5 rounded font-mono font-bold text-[var(--text)] border">Authorization</code> header as a Bearer credentials token:</p>
                  <pre className="bg-[var(--surface)]/80 p-3 rounded-lg border border-[var(--line)] font-mono text-[11px] text-[var(--text)] overflow-x-auto">
                    {`curl -H "Authorization: Bearer ${apiKey}" \\\n  "https://${window.location.host}/api/v1/status?workspaceId=${currentWorkspace?.id || 'ws_123'}"`}
                  </pre>
                </div>
              </div>
            )}

            <div className="mt-6">
               <h3 className="font-bold text-sm text-[var(--text)] mb-4 flex items-center gap-2">
                 <Shield aria-hidden="true" size={16} className="text-slate-450" />
                 Active Credentials ({publicKeys.length})
               </h3>
               {publicKeys.length === 0 ? (
                  <div className="text-sm text-[var(--muted)] italic p-6 border border-[var(--line)] bg-[var(--ink)]/50 rounded-[32px] text-center">
                    No active integration keys registered. Generate an API Key above to begin orchestrating external transactions and AI analyses.
                  </div>
               ) : (
                  <div className="border border-slate-150 rounded-[32px] shadow-3xs overflow-hidden">
                     <table className="w-full text-left text-sm">
                       <caption className="sr-only">API keys</caption>
                        <thead className="bg-[var(--ink)]/80 border-b border-slate-150 text-[10px] uppercase tracking-wider text-[var(--muted)] font-black">
                           <tr>
                              <th scope="col" className="p-4 py-3.5">Details</th>
                              <th scope="col" className="p-4 py-3.5">Granted Scopes</th>
                              <th scope="col" className="p-4 py-3.5">Usage Telemetry</th>
                              <th scope="col" className="p-4 py-3.5">Expiration</th>
                              <th scope="col" className="p-4 py-3.5 text-right">Actions</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-[var(--surface)]">
                           {publicKeys.map((k) => {
                             const isExpired = k.expiresAt !== 'never' && new Date(k.expiresAt).getTime() < nowMs;
                             return (
                               <tr key={k.id} className="hover:bg-[var(--ink)]/40 transition-colors">
                                  <td className="p-4">
                                     <div className="font-bold text-slate-950 text-xs">{k.name}</div>
                                     <div className="font-mono text-[10px] text-[var(--muted)] mt-0.5">{k.id}</div>
                                     <div className="text-[10px] text-slate-400/90 mt-1">Created: {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}</div>
                                  </td>
                                  <td className="p-4 max-w-xs">
                                     <div className="flex flex-wrap gap-1">
                                        {k.scopes.length === 0 ? (
                                           <span className="text-[9px] bg-[var(--ink)] text-[var(--muted)] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-[var(--line)]">No Scopes</span>
                                        ) : (
                                           k.scopes.map((scope: string) => (
                                              <span
                                                key={scope}
                                                className={cn(
                                                  "text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border",
                                                  scope.startsWith('write:') ? "bg-amber-500/5 text-amber-700 border-amber-500/10" :
                                                  scope.startsWith('brain:') ? "bg-purple-500/5 text-purple-700 border-purple-500/10" :
                                                  "bg-slate-100 text-slate-650 border-[var(--line)]"
                                                )}
                                              >
                                                {scope}
                                              </span>
                                           ))
                                        )}
                                     </div>
                                  </td>
                                  <td className="p-4 text-xs font-mono text-slate-600">
                                     <div className="font-bold">{k.totalRequests} API calls</div>
                                     <div className="text-[10px] text-[var(--muted)] mt-1 flex items-center gap-1">
                                        <Clock aria-hidden="true" size={10} />
                                        Last Used: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                                     </div>
                                  </td>
                                  <td className="p-4">
                                     {isExpired ? (
                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase bg-red-500/10 border border-red-500/20 text-red-650 px-2.5 py-1 rounded-full">
                                          <Shield aria-hidden="true" size={10} className="stroke-[3]" /> Expired
                                        </span>
                                     ) : k.expiresAt === 'never' ? (
                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase bg-slate-100 text-[var(--muted)] px-2.5 py-1 rounded-full border border-[var(--line)]">
                                          <Lock aria-hidden="true" size={10} /> Indefinite
                                        </span>
                                     ) : (
                                        <div className="text-xs">
                                          <div className="font-bold text-[var(--text)]">{new Date(k.expiresAt).toLocaleDateString()}</div>
                                          <div className="text-[10px] text-[var(--muted)] mt-0.5">{new Date(k.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                        </div>
                                     )}
                                  </td>
                                  <td className="p-4 text-right">
                                     <button
                                       onClick={() => {
                                         if(confirm('Are you absolutely certain you wish to revoke this credential? Any servers using this token will instantly lose secure database access coordinates.')) {
                                           inBackground(revokeKey(k.id));
                                         }
                                       }}
                                       className="inline-flex items-center justify-center w-8 h-8 text-[var(--muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                       title="Revoke Credential"
                                       aria-label={`Revoke credential ${k.name}`}
                                     >
                                       <Trash2 aria-hidden="true" size={15} />
                                     </button>
                                  </td>
                               </tr>
                             );
                           })}
                        </tbody>
                     </table>
                  </div>
               )}
            </div>
          </div>

          {/* CREATE DETAILED KEY MODAL */}
          {showCreateModal && (
            <div {...overlayDialogProps} className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center p-6 border-b border-[var(--line)]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-950 text-white flex items-center justify-center">
                      <Key aria-hidden="true" size={20} />
                    </div>
                    <div>
                      <h3 id={overlayTitleId} className="font-bold text-[var(--text)] font-display text-base">Provision New Developer Credential</h3>
                      <p className="text-xs text-[var(--muted)] font-mono mt-0.5">Workspace: {currentWorkspace?.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    aria-label="Close credential form"
                    className="p-1 px-1.5 text-[var(--muted)] hover:text-slate-950 rounded-lg hover:bg-[var(--ink)]"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Name Input */}
                  <div className="space-y-2">
                    <Labelled labelClassName="text-xs font-black uppercase tracking-wider text-[var(--muted)] block" label="Credential Name">
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="e.g. Acme Production Integration"
                        className="w-full bg-[var(--ink)] border border-[var(--line)] p-3.5 rounded-xl text-sm font-bold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-slate-950 focus:bg-[var(--surface)] transition-all shadow-3xs"
                      />
                    </Labelled>
                  </div>

                  {/* Expiration dropdown */}
                  <div className="space-y-2">
                    <Labelled labelClassName="text-xs font-black uppercase tracking-wider text-[var(--muted)] block" label="TTL / Expiration Age">
                      <select
                        value={expiration}
                        onChange={(e) => setExpiration(e.target.value as typeof expiration)}
                        className="w-full bg-[var(--ink)] border border-[var(--line)] p-3.5 rounded-xl text-sm font-bold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-slate-950 focus:bg-[var(--surface)] transition-all shadow-3xs"
                      >
                        <option value="never">Indefinite (Never Expire)</option>
                        <option value="1h">1 Hour (Ephemeral Transient Testing)</option>
                        <option value="24h">24 Hours (Daily Rotation)</option>
                        <option value="30d">30 Days</option>
                        <option value="90d">90 Days</option>
                      </select>
                    </Labelled>
                  </div>

                  {/* Z-02: this key's own limit */}
                  <div className="space-y-2">
                    <Labelled labelClassName="text-xs font-black uppercase tracking-wider text-[var(--muted)] block" label="Requests a minute (this key)">
                      <select
                        value={perMinute}
                        onChange={(e) => setPerMinute(Number(e.target.value))}
                        className="w-full bg-[var(--ink)] border border-[var(--line)] p-3.5 rounded-xl text-sm font-bold text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-slate-950 focus:bg-[var(--surface)] transition-all shadow-3xs"
                      >
                        {[30, 60, 120, 300, 600, 1200].map(n => <option key={n} value={n}>{n} a minute{n === 120 ? ' (usual)' : ''}</option>)}
                      </select>
                    </Labelled>
                  </div>

                  {/* Scopes selection */}
                  <div role="group" aria-labelledby={`${formId}-scopes`} className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div id={`${formId}-scopes`} className="text-xs font-black uppercase tracking-wider text-[var(--muted)]">Access Scopes & Permissions</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedScopes(AVAILABLE_SCOPES.map(s => s.id))}
                          className="text-[10px] font-black text-[var(--muted)] hover:text-slate-950 uppercase"
                        >
                          Select All
                        </button>
                        <span className="text-[10px] text-slate-200 font-bold">|</span>
                        <button
                          onClick={() => setSelectedScopes([])}
                          className="text-[10px] font-black text-[var(--muted)] hover:text-slate-950 uppercase"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[180px] overflow-y-auto pr-1 space-y-2 border border-[var(--line)] p-3.5 rounded-[32px] bg-[var(--ink)]/50">
                      {AVAILABLE_SCOPES.map((scope) => {
                        const checked = selectedScopes.includes(scope.id);
                        return (
                          <label
                            key={scope.id}
                            htmlFor={`${formId}-scope-${scope.id}`}
                            aria-label={scope.label}
                            className={cn(
                              "flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-all border",
                              checked ? "bg-[var(--surface)] border-[var(--line)] shadow-3xs" : "border-transparent opacity-75 hover:opacity-100"
                            )}
                          >
                            <input
                              id={`${formId}-scope-${scope.id}`}
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                if (checked) {
                                  setSelectedScopes(selectedScopes.filter(s => s !== scope.id));
                                } else {
                                  setSelectedScopes([...selectedScopes, scope.id]);
                                }
                              }}
                              className="mt-0.5 rounded border-slate-300 text-slate-950 focus:ring-slate-950 cursor-pointer h-4 w-4"
                            />
                            <div>
                              <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                                {scope.label}
                                <span className="font-mono text-[9px] bg-slate-100 text-slate-450 border border-[var(--line)] px-1 rounded uppercase tracking-wider">{scope.id}</span>
                              </div>
                              <div className="text-[10px] text-[var(--muted)] mt-0.5">{scope.desc}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Private hashing notice */}
                  <div className="p-4 rounded-[32px] bg-[var(--ink)] border border-slate-150 text-[11px] text-[var(--muted)] leading-relaxed font-medium">
                     🔓 <strong>Hashed Storage Guarantee:</strong> LedgerFlow stores credentials using a one-way salt-hashed SHA-256 match protocol. Nobody can ever decrypt or view the original secret sequence. Copy the key safely when displayed.
                  </div>
                </div>

                <div className="flex justify-end gap-3 p-6 bg-[var(--ink)] border-t border-[var(--line)]">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 bg-[var(--surface)] border border-[var(--line)] text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-all shrink-0"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={generateNewKey}
                    disabled={isRegenerating || selectedScopes.length === 0}
                    className="px-5 py-2 bg-slate-950 text-white font-bold rounded-xl text-xs hover:bg-slate-800 transition-all disabled:opacity-50 shrink-0 shadow-sm"
                   aria-label={isRegenerating ? 'Generating credential' : 'Confirm and Provision'}>
                    {isRegenerating ? 'Generating...' : 'Confirm and Provision'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>);
}
