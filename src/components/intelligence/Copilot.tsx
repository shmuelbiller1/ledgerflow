import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Sparkles } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { runCommand } from '../../lib/runCommand';
import { maskCardNumbers } from '../../lib/cardNumberMask';

interface Sandbox { id: string; createdAt: string; expiresAt: string; pendingSteps: number }
interface Message { id: number; role: 'user' | 'assistant'; text: string; source?: string }

/** The review screen validates the requested id against this person's open sandboxes. */
const reviewSelectionKey = (workspaceId: string) => `lf_assistant_review_${workspaceId}`;
function rememberAssistantDraft(workspaceId: string, sandboxId: string) {
  try { sessionStorage.setItem(reviewSelectionKey(workspaceId), sandboxId); return true; } catch { return false; }
}

export default function Copilot() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const user = useAuthStore(s => s.user);
  const guest = useAuthStore(s => s.isGuest);
  // A new component instance drops messages and in-flight results on person/workspace changes.
  if (!workspaceId || !user || guest || user.isAnonymous) return <section className="p-6"><h1 className="text-2xl font-bold">AI assistant</h1><p className="mt-3">Sign in and select a workspace to use the assistant.</p></section>;
  return <AssistantChat key={`${user.uid}:${workspaceId}`} workspaceId={workspaceId} />;
}

function AssistantChat({ workspaceId }: { workspaceId: string }) {
  const [sandboxes, setSandboxes] = useState<Sandbox[] | null>(null);
  const [sandboxId, setSandboxId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const nextMessageId = useRef(0);
  const [listTick, setListTick] = useState(0);
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sandboxes`;
  const navigate = useUIStore(s => s.setActiveTab);

  useEffect(() => {
    let current = true;
    runCommand<{ sandboxes: Sandbox[] }>({ path: base }).then(data => {
      if (!current) return;
      if (!Array.isArray(data?.sandboxes)) throw new Error('Could not read the available drafts.');
      setSandboxes(data.sandboxes);
      setSandboxId(id => data.sandboxes.some(s => s.id === id) ? id : data.sandboxes[0]?.id || '');
    }).catch(err => { if (current) setError(err instanceof Error ? err.message : 'Could not load the assistant.'); });
    return () => { current = false; };
  }, [base, listTick]);

  const start = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await runCommand<{ sandbox: { id: string } }>({ path: base, method: 'POST', body: {} });
      if (!result.sandbox?.id) throw new Error('The draft was opened but its ID was not returned. Check Assistant drafts before trying again.');
      setSandboxId(result.sandbox.id);
      setMessages([]);
      setQuestion('');
      setListTick(t => t + 1);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Could not open a draft.'} Check Assistant drafts before trying again.`);
      setListTick(t => t + 1);
    } finally { sending.current = false; setBusy(false); }
  };

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = maskCardNumbers(question.trim());
    if (!text || !sandboxId || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    const userMessage: Message = { id: nextMessageId.current++, role: 'user', text };
    setMessages(previous => [...previous, userMessage]);
    try {
      const result = await runCommand<{ status: string; answer?: string; path?: string; model?: string }>({
        path: `${base}/${encodeURIComponent(sandboxId)}/assistant/turn`, method: 'POST', body: { question: text },
      });
      if (result.status !== 'success' || !result.answer?.trim()) throw new Error('The assistant could not finish this answer.');
      const reply: Message = { id: nextMessageId.current++, role: 'assistant', text: result.answer, source: result.model ? `Model: ${result.model}` : result.path === 'code' ? 'Answered from your books' : undefined };
      setMessages(previous => [...previous, reply]);
      setQuestion('');
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'The assistant could not answer.'} A draft may have been created; check Assistant drafts before retrying.`);
    } finally { sending.current = false; setBusy(false); }
  };

  const openReview = () => {
    if (sandboxId && !rememberAssistantDraft(workspaceId, sandboxId)) {
      setError('Could not select this draft automatically. Open Assistant drafts from All tools and select the draft there.');
      return;
    }
    navigate('sandbox-review');
  };
  return <section className="mx-auto w-full max-w-4xl space-y-5 p-4 md:p-8" aria-labelledby="assistant-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 id="assistant-title" className="flex items-center gap-2 text-2xl font-bold text-[var(--text)]"><Sparkles aria-hidden="true" /> AI assistant</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Ask about your books or request a draft. Review any draft before it changes your books.</p></div>
      <button type="button" onClick={openReview} className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold">Assistant drafts</button>
    </div>
    <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">Each question is handled independently; the assistant does not remember earlier messages. Include the details again in follow-up questions. AI answers can be wrong—check them before acting.</p>
    {error && <p role="alert" className="rounded-lg border border-rose-300 bg-[var(--surface)] p-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
    {sandboxes === null ? (error ? <button type="button" onClick={() => { setError(''); setListTick(t => t + 1); }} className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold">Retry loading assistant</button> : <p role="status">Loading assistant…</p>) : <div className="flex flex-wrap items-end gap-3">
      {sandboxes.length > 0 && <div className="flex-1 min-w-0"><label htmlFor="assistant-sandbox" className="block text-sm font-semibold">Draft workspace</label>
        <select id="assistant-sandbox" value={sandboxId} disabled={busy} onChange={e => { setSandboxId(e.target.value); setMessages([]); }} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm">
          {sandboxes.map(s => <option key={s.id} value={s.id}>{new Date(s.createdAt).toLocaleString()} · {s.pendingSteps} pending</option>)}
        </select></div>}
      <button type="button" onClick={() => void start()} disabled={busy || sandboxes.length >= 3} className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-50">{sandboxes.length ? 'Open another draft' : 'Start assistant'}</button>
      {sandboxes.length >= 3 && <p className="text-sm text-[var(--muted)]">You have three open drafts. Review or close one before opening another.</p>}
    </div>}
    <div aria-live="polite" aria-relevant="additions" className="space-y-3">
      {messages.map(message => <div key={message.id} className={`rounded-xl border border-[var(--line)] p-4 ${message.role === 'user' ? 'ms-auto bg-[var(--elevated)]' : 'bg-[var(--surface)]'} max-w-full`}>
        <p className="mb-2 text-xs font-semibold text-[var(--muted)]">{message.role === 'user' ? 'You' : 'Assistant'}{message.source ? ` · ${message.source}` : ''}</p>
        {message.role === 'assistant' ? <div className="prose prose-sm max-w-none text-[var(--text)]"><Markdown>{message.text}</Markdown></div> : <p className="whitespace-pre-wrap break-words">{message.text}</p>}
      </div>)}
      {busy && <p role="status" className="text-sm text-[var(--muted)]">Working…</p>}
    </div>
    <form onSubmit={event => void ask(event)} className="space-y-2">
      <label htmlFor="assistant-question" className="text-sm font-semibold">Your question</label>
      <textarea id="assistant-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} rows={3} disabled={!sandboxId || busy} placeholder="Ask about your books, or describe a draft…" className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-[var(--text)] disabled:opacity-50" />
      <button type="submit" disabled={!sandboxId || busy || !question.trim()} className="min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white disabled:opacity-50">Send question</button>
    </form>
  </section>;
}
