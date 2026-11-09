import { useEffect, useId, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDialog } from '../../hooks/useDialog';
import { sendFeedback, FEEDBACK_APP_VERSION, FEEDBACK_KINDS, feedbackReference, feedbackScreenshotProblem, feedbackSubject, type FeedbackKind } from '../../lib/feedbackTicket';
import { attachFiles, readAsDataUrl } from '../../services/attachmentActions';
import { MAX_ATTACHMENT_BYTES, formatBytes } from '../../lib/attachments';
import { toast } from 'sonner';
import { pageLabel } from '../../config/pageLabels';

export default function FeedbackWidget() {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  return <FeedbackForm key={`${workspaceId}:${uid}`} workspaceId={workspaceId} uid={uid} />;
}
function FeedbackForm({ workspaceId, uid }: { workspaceId: string | null; uid?: string }) {
  const screen = useUIStore(s => s.activeTab);
  const reportTab = useUIStore(s => s.activeReportTab);
  const settingsTab = useUIStore(s => s.activeSettingsTab);
  const [origin, setOrigin] = useState('');
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<FeedbackKind>('problem');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [savedTicket, setSavedTicket] = useState<string | null>(null);
  const ticketRef = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!screenshot || feedbackScreenshotProblem(screenshot)) return;
    let cancelled = false;
    void readAsDataUrl(screenshot).then(url => { if (!cancelled) setPreview({ file: screenshot, url }); })
      .catch(() => { if (!cancelled) setError('Could not preview the screenshot. Choose another image or remove it.'); });
    return () => { cancelled = true; };
  }, [screenshot]);
  const inputId = useId();
  const close = () => { if (!pending.current) setOpen(false); };
  const { dialogProps, titleId } = useDialog(close, open);
  const sub = screen === 'reports' ? reportTab : screen === 'settings' ? settingsTab : undefined;
  const path = sub ? `${screen}/${sub}` : screen;
  const currentScreen = `${pageLabel({ tab: screen, sub })} (${path})`;
  useEffect(() => {
    function show() { if (!ticketRef.current && !body && !screenshot) setOrigin(currentScreen); setError(''); setOpen(true); }
    window.addEventListener('ledgerflow:feedback', show);
    return () => window.removeEventListener('ledgerflow:feedback', show);
  }, [currentScreen, body, screenshot]);
  const current = () => mounted.current && useAuthStore.getState().currentWorkspaceId === workspaceId && useAuthStore.getState().user?.uid === uid;
  const finish = (message: string) => {
    ticketRef.current = null; setSavedTicket(null); setBody(''); setKind('problem'); setScreenshot(null); setPreview(null); setOpen(false); toast.success(message);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId || !uid || pending.current) return;
    if (screenshot) {
      const problem = feedbackScreenshotProblem(screenshot);
      if (problem) { setError(problem); return; }
    }
    pending.current = true; setBusy(true); setError('');
    try {
      const ticketId = ticketRef.current || await sendFeedback(workspaceId, uid, origin, body, kind);
      if (!current()) return;
      ticketRef.current = ticketId; setSavedTicket(ticketId);
      if (screenshot) {
        const result = await attachFiles(workspaceId, uid, { collection: 'supportTickets', id: ticketId, label: feedbackSubject(origin, kind) }, [screenshot]);
        if (!current()) return;
        if (result.saved.length !== 1 || result.refused.length) throw new Error(result.refused[0]?.reason || 'The screenshot was not attached. Retry or finish without it.');
      }
      // G-06: a reference the tester can quote later (the ticket's short id)
      finish(`${screenshot ? 'Feedback saved with screenshot' : 'Feedback saved as a support ticket'}. Reference: ${feedbackReference(ticketId)}`);
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : 'Could not send feedback. Your text is kept; try again.'); }
    finally { pending.current = false; if (current()) setBusy(false); }
  }
  return <>
    {screen !== 'help' && <button type="button" className="fixed bottom-4 right-4 z-[40] min-h-11 px-4 rounded-lg border bg-[var(--surface)] shadow text-sm" onClick={() => { if (!ticketRef.current && !body && !screenshot) setOrigin(currentScreen); setError(''); setOpen(true); }}>Send feedback</button>}
    {open && <div {...dialogProps} className="fixed inset-0 z-[700] bg-black/60 flex items-center justify-center p-4">
      <form aria-busy={busy} onSubmit={event => void submit(event)} className="bg-[var(--surface)] p-6 rounded-xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-4">
        <h2 id={titleId} className="text-xl font-bold">Send feedback</h2>
        <p className="text-sm">Screen: {origin} · App version: {FEEDBACK_APP_VERSION}</p>
        <fieldset className="space-y-1" disabled={busy || Boolean(savedTicket)}>
          <legend>What is this about?</legend>
          {FEEDBACK_KINDS.map(k => <label key={k.value} className="flex items-center gap-2 min-h-11"><input type="radio" name={`${inputId}-kind`} value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />{k.label}</label>)}
        </fieldset>
        <label htmlFor={inputId} className="block">{kind === 'missing' ? 'What tool or feature do you need, and what would you use it for?' : kind === 'question' ? 'Your question' : 'What happened?'}</label>
        <textarea id={inputId} required maxLength={5000} rows={6} className="w-full border rounded p-3" value={body} onChange={event => setBody(event.target.value)} readOnly={busy || Boolean(savedTicket)} />
        <div className="space-y-2">
          <label htmlFor={`${inputId}-screenshot`} className="block">Add a screenshot (optional)</label>
          <input ref={fileInput} id={`${inputId}-screenshot`} type="file" accept="image/png,image/jpeg,image/webp" aria-describedby={`${inputId}-file-help`}
            className="w-full min-h-11 file:min-h-11 max-w-full" disabled={busy || !uid || !workspaceId}
            onChange={event => { setScreenshot(event.target.files?.[0] || null); setPreview(null); setError(''); }} />
          <p id={`${inputId}-file-help`} className="text-sm">PNG, JPEG or WebP, up to {formatBytes(MAX_ATTACHMENT_BYTES)}. Attached when you send.</p>
          {screenshot && <>
            <p className="break-all text-sm"><bdi dir="auto">{screenshot.name}</bdi></p>
            <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => { setScreenshot(null); setPreview(null); setError(''); if (fileInput.current) fileInput.current.value = ''; }}>Remove screenshot</button>
            {feedbackScreenshotProblem(screenshot) ? <p role="alert">{feedbackScreenshotProblem(screenshot)}</p> : preview?.file === screenshot && <img src={preview.url} alt="Selected screenshot preview" className="max-h-32 max-w-full object-contain" />}
          </>}
        </div>
        {savedTicket && <p role="status">Feedback saved. The screenshot is not attached yet; retry or finish without it.</p>}
        {!uid && <p role="status">Sign in to a workspace to send feedback. Guest feedback cannot be saved.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary min-h-11" onClick={close} disabled={busy}>{savedTicket ? 'Close' : 'Cancel'}</button>
          {savedTicket && <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => finish(`Feedback saved without a screenshot. Reference: ${feedbackReference(savedTicket)}`)}>Finish without screenshot</button>}
          <button type="submit" className="btn-primary min-h-11" disabled={busy || !uid || !workspaceId || !body.trim() || Boolean(screenshot && feedbackScreenshotProblem(screenshot)) || Boolean(savedTicket && !screenshot)}>{busy ? (savedTicket ? 'Attaching…' : 'Sending…') : savedTicket ? 'Retry screenshot' : 'Send'}</button></div>
      </form>
    </div>}
  </>;
}
