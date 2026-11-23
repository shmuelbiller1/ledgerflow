import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useUIStore } from '../../../stores/useUIStore';
import { saveWorkspaceSettings } from '../../../lib/workspaceSettingsSave';
import { runNamedCommand } from '../../../lib/commandByName';
import AsyncButton from '../../ui/AsyncButton';

/** Model and provider configuration belongs to the server; this screen must not imply otherwise. */
export default function AISettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  return <AISettingsContent key={workspace?.id || 'none'} workspaceId={workspace?.id} initialThreshold={workspace?.matchingThreshold ?? 0.85} />;
}

function AISettingsContent({ workspaceId, initialThreshold }: { workspaceId?: string; initialThreshold: number }) {
  const [threshold, setThreshold] = useState(initialThreshold);
  const navigate = useUIStore(s => s.setActiveTab);
  const save = async () => {
    if (!workspaceId) { toast.error('Select a workspace first.'); return; }
    try {
      await saveWorkspaceSettings(workspaceId, { matchingThreshold: threshold });
      useLedgerStore.getState().setMatchingThreshold(threshold);
      toast.success('Matching threshold saved.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save the matching threshold.'); }
  };
  const reset = async () => {
    if (!workspaceId) { toast.error('Select a workspace first.'); return; }
    try {
      await runNamedCommand('autorule.reset', {}, { workspaceId });
      useLedgerStore.getState().setAnalyticalPatternCache({});
      toast.success('Learned matching patterns cleared.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not clear matching patterns.'); }
  };
  return <div className="space-y-6">
    <section className="ledger-card space-y-4 p-6" aria-labelledby="ai-settings-title">
      <h2 id="ai-settings-title" className="text-xl font-bold">AI assistant</h2>
      <p className="text-sm text-[var(--muted)]">The assistant’s AI provider and models are configured by the service, not by a setting on this page. Some questions are answered directly from your books without an AI model. Other AI features may use different services.</p>
      <p className="text-sm text-[var(--muted)]">You do not need to enter an API key here. The assistant can suggest drafts, but changes only reach your books after you review and accept them.</p>
      <button type="button" onClick={() => navigate('copilot')} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white">Open AI assistant</button>
    </section>
    <section className="ledger-card space-y-4 p-6" aria-labelledby="matching-title">
      <h2 id="matching-title" className="text-xl font-bold">Matching preferences</h2>
      <label htmlFor="matching-threshold" className="block text-sm font-semibold">Matching confidence: {Math.round(threshold * 100)}%</label>
      <input id="matching-threshold" type="range" min="0.50" max="0.99" step="0.01" value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-full" />
      <p className="text-sm text-[var(--muted)]">A higher threshold requires a closer match before a pattern is applied.</p>
      <AsyncButton onClick={save} disabled={!workspaceId} loadingText="Saving…" className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-50">Save matching threshold</AsyncButton>
    </section>
    <section className="ledger-card space-y-3 p-6" aria-labelledby="patterns-title">
      <h2 id="patterns-title" className="text-xl font-bold">Learned matching patterns</h2>
      <p className="text-sm text-[var(--muted)]">Clear learned patterns for this workspace. Your structured rules are kept.</p>
      <AsyncButton onClick={reset} disabled={!workspaceId} loadingText="Clearing…" className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-50">Clear learned patterns</AsyncButton>
    </section>
  </div>;
}
