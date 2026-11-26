import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { BookOpenCheck, Check, Copy, ExternalLink, Sparkles } from 'lucide-react';
import { ASSISTANT_NAME, sourceLabel, type AnswerSource } from '../../config/assistantIdentity';

export interface ChatMessage { id: number; role: 'user' | 'assistant'; text: string; source?: AnswerSource; page?: string }

/** The coloured badge under each answer: green for the books, violet for AI, grey for a shortcut. */
export function AnswerBadge({ source }: { source: AnswerSource }) {
  const { title, detail } = sourceLabel(source);
  const tone = source.kind === 'books'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100'
    : source.kind === 'ai'
      ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100'
      : 'border-[var(--line)] bg-[var(--elevated)] text-[var(--text)]';
  const Icon = source.kind === 'books' ? BookOpenCheck : source.kind === 'ai' ? Sparkles : ExternalLink;
  return <p className={`mt-3 inline-flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${tone}`}>
    <Icon aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
    <span><strong>{title}.</strong> {detail}</span>
  </p>;
}

/** One message: the person's on the right, the assistant's on the left with its source badge and a copy button. */
export function AssistantMessage({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  if (message.role === 'user') {
    return <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-ee-sm bg-indigo-600 px-4 py-2.5 text-white shadow-sm">
        <p className="sr-only">You:</p>
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    </div>;
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(message.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {
      // best-effort: the answer stays on screen to select by hand when the clipboard is unavailable
    }
  };
  return <div className="flex items-start gap-2.5">
    <span aria-hidden="true" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">{ASSISTANT_NAME[0]}</span>
    <div className="min-w-0 max-w-[90%] rounded-2xl rounded-es-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-sm">
      <p className="mb-1 text-xs font-semibold text-[var(--muted)]">{ASSISTANT_NAME}</p>
      <div className="prose prose-sm max-w-none text-[var(--text)]"><Markdown>{message.text}</Markdown>
        {message.page && <a href={`${window.location.pathname}#${message.page}`} target="_blank" rel="noopener noreferrer">Open {message.page} in a new tab</a>}</div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        {message.source && <AnswerBadge source={message.source} />}
        <button type="button" onClick={() => void copy()} aria-label="Copy this answer" title="Copy this answer"
          className="mt-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]">
          {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
        </button>
      </div>
    </div>
  </div>;
}

/** The empty chat: who the assistant is, how answers are marked, and questions to tap. */
export function AssistantWelcome({ onPick, canDraft }: { onPick: (question: string) => void; canDraft: boolean }) {
  const examples = [
    'Who owes me money?',
    'What is my cash balance?',
    'Why is my profit lower than last month?',
    ...(canDraft ? ['Create an invoice for Acme for 2 hours of consulting'] : ['Which bills are due this week?']),
  ];
  return <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm">
    <p className="font-semibold text-[var(--text)]">Hi, I'm {ASSISTANT_NAME}. Ask me about your books.</p>
    <p className="mt-1 text-[var(--muted)]">Every answer shows where it came from: <strong>From your books</strong> means calculated exactly with no AI; <strong>AI answer</strong> means an AI model wrote it, so check important figures.</p>
    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Try asking</p>
    <ul className="mt-2 flex flex-wrap gap-2">
      {examples.map(example => <li key={example}><button type="button" onClick={() => onPick(example)}
        className="min-h-11 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-start text-sm text-[var(--text)] hover:border-indigo-400 hover:bg-[var(--elevated)]">{example}</button></li>)}
    </ul>
  </div>;
}

/** While an answer is coming. */
export function AssistantThinking() {
  return <div role="status" className="flex items-center gap-2.5 text-sm text-[var(--muted)]">
    <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">{ASSISTANT_NAME[0]}</span>
    <span>{ASSISTANT_NAME} is thinking<span aria-hidden="true" className="inline-flex w-5 animate-pulse">…</span></span>
  </div>;
}
