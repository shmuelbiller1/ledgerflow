
import { Users, Wrench } from 'lucide-react';

import { cn } from '../../lib/utils';

import { Labelled } from '../ui/Labelled';

import type { SystemCommandCenterModel } from './SystemCommandCenter';
export function SystemUsersPanel({ model }: { model: SystemCommandCenterModel }) {
 const { formatPlatformUsdQuota, formId, usersList, editingUser, setEditingUser, savingUser, userFormState, setUserFormState, startEditingUser, handleSaveUser } = model;
 return (<div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              <div className="xl:col-span-2 space-y-8">
                <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[32px] shadow-3xs overflow-hidden">
                  <div className="p-4 md:p-6 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]">
                    <div className="flex items-center gap-3">
                      <Users aria-hidden="true" size={16} className="text-[var(--muted)]" />
                      <h2 className="text-[12px] font-black uppercase tracking-widest text-[var(--text)]">Platform User Ledger</h2>
                    </div>
                  </div>
                  <div role="region" aria-label="Scrollable system users" tabIndex={0} className="overflow-x-auto">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
                    <table className="w-full text-left">
                      <caption className="sr-only">Platform users</caption>
                      <thead>
                        <tr className="border-b border-[var(--line)] bg-[var(--surface)] text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                          <th scope="col" className="py-4 px-6 font-medium">User Details</th>
                          <th scope="col" className="py-4 px-6 font-medium">Role</th>
                          <th scope="col" className="py-4 px-6 font-medium text-right">Custom Limit ($)</th>
                          <th scope="col" className="py-4 px-6 font-medium text-right">Compute Limit (Cr)</th>
                          <th scope="col" className="py-4 px-6 text-center font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ledger-line/50">
                        {usersList.map((u) => (
                          <tr key={u.uid} className="hover:bg-[var(--ink)]/50 transition-colors group">
                            <td className="py-4 px-6">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-[var(--text)]">{u.email || 'Unknown Email'}</span>
                                <span className="text-[10px] font-mono text-[var(--muted)]">{u.uid}</span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span className={cn(
                                "text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full border",
                                u.role === 'admin' ? "bg-[#0047AB]/10 text-[#0047AB] border-[#0047AB]/20" : "bg-slate-100 text-slate-600 border-[var(--line)]"
                              )}>
                                {u.role || 'client'}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className="text-xs font-mono font-bold text-slate-700">
                                {u.customLimit ? formatPlatformUsdQuota(u.customLimit) : 'System Default'}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className="text-xs font-mono font-bold text-slate-700">
                                {u.computeCreditLimit ? u.computeCreditLimit.toLocaleString() : 'System Default'}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <button
                                onClick={() => startEditingUser(u)}
                                className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border border-[var(--line)] bg-[var(--surface)] text-slate-600 hover:bg-[var(--ink)] transition-all opacity-50 group-hover:opacity-100"
                              >
                                Modify
                              </button>
                            </td>
                          </tr>
                        ))}
                        {usersList.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-12 text-center text-[10px] uppercase font-bold tracking-widest text-[var(--muted)]">
                              No user records located.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Edit User Panel */}
              <div className="xl:col-span-1 space-y-6">
                <div className={cn(
                  "bg-[var(--surface)] border rounded-[32px] p-6 transition-all duration-300 shadow-xl",
                  editingUser ? "border-[#0047AB] ring-4 ring-[#0047AB]/5" : "border-[var(--line)] opacity-50 pointer-events-none grayscale"
                )}>
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--line)]">
                    <div className="w-8 h-8 rounded-lg bg-[#0047AB]/10 flex items-center justify-center">
                      <Wrench aria-hidden="true" size={14} className="text-[#0047AB]" />
                    </div>
                    <div>
                      <h2 className="text-[12px] font-black uppercase tracking-widest text-[var(--text)]">Deep Profile Tuning</h2>
                      {editingUser && (
                        <div className="flex flex-col mt-1">
                          <span className="text-[11px] font-bold text-slate-700">{editingUser.email || 'Unknown Email'}</span>
                          <span className="text-[9px] font-mono text-[var(--muted)]">{editingUser.uid}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {editingUser ? (
                    <form onSubmit={handleSaveUser} className="space-y-6">
                      <div className="space-y-4">
                        <div>
                          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Authority Role">
                            <select
                              value={userFormState.role}
                              onChange={e => setUserFormState(prev => ({ ...prev, role: e.target.value }))}
                              className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                            >
                              <option value="client">Client (Standard Access)</option>
                              <option value="admin">Admin (System Access)</option>
                            </select>
                          </Labelled>
                        </div>
                        <div>
                          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Custom Monetary Limit (Cents)">
                            <input
                              type="number"
                              value={userFormState.customLimit}
                              onChange={e => setUserFormState(prev => ({ ...prev, customLimit: Number(e.target.value) }))}
                              className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              placeholder="0 = Use System Default"
                            />
                          </Labelled>
                        </div>
                        <div>
                          <Labelled labelClassName="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5" label="Compute Credit Ceiling">
                            <input
                              type="number"
                              value={userFormState.computeCreditLimit}
                              onChange={e => setUserFormState(prev => ({ ...prev, computeCreditLimit: Number(e.target.value) }))}
                              className="w-full h-11 bg-[var(--ink)] border border-[var(--line)] rounded-xl px-4 text-xs font-mono font-bold text-[var(--text)] focus:border-[#0047AB] outline-none transition-all"
                              placeholder="0 = Use System Default"
                            />
                          </Labelled>
                        </div>
                        <div role="group" aria-labelledby={`${formId}-quick-actions`}>
                          <div id={`${formId}-quick-actions`} className="block text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">
                            Quick Actions
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setUserFormState(prev => ({ ...prev, customLimit: 1000000000, computeCreditLimit: 1000000000 }))}
                              className="flex-1 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-green-100 transition-all"
                            >
                              Unlimit (God Mode)
                            </button>
                            <button
                              type="button"
                              onClick={() => setUserFormState(prev => ({ ...prev, customLimit: 1, computeCreditLimit: 1 }))}
                              className="flex-1 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all"
                            >
                              Restrict
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-[var(--line)] flex gap-3">
                        <button
                          type="button"
                          onClick={() => setEditingUser(null)}
                          className="flex-1 px-4 py-3 border border-[var(--line)] rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--muted)] hover:bg-[var(--ink)] transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingUser}
                          className="flex-[2] px-4 py-3 bg-[#0047AB] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#003380] transition-all disabled:opacity-50"
                         aria-label={savingUser ? 'Syncing user directives' : 'Deploy Directives'}>
                          {savingUser ? 'Syncing...' : 'Deploy Directives'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Select a user profile to override limits & roles</p>
                    </div>
                  )}
                </div>
              </div>
            </div>);
}
