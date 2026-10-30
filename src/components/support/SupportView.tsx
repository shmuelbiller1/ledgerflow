import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { 
  Headphones, 
  Send, 
  Plus, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  ArrowLeft,
  Bug,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSupportStore } from '../../stores/useSupportStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useSupportData } from '../../hooks/useSupportData';
import { SupportTicket, Priority, SupportMessage } from '../../types';
import { getLatestErrorDiagnostic } from '../../lib/errorTracker';
import { format } from 'date-fns';
import { cn } from '../../lib/utils';
import { useTimeout } from '../../hooks/useTimeout';
import { db } from '../../firebase';
import { doc, setDoc, updateDoc } from '../../lib/db/firestore';
import { Labelled } from '../ui/Labelled';
import AttachmentsPanel from '../common/AttachmentsPanel';
import { maskCardNumbers } from '../../lib/cardNumberMask';
import {
  FEEDBACK_TAGS,
  type FeedbackTag,
  loadFeedbackTags,
  toggleFeedbackTag,
} from '../../lib/feedbackTriage';
import { toast } from 'sonner';
import { copyText } from '../../lib/clipboard';

export default function SupportView() {
  const formId = useId();
  const { user, getCurrentWorkspace } = useAuthStore();
  const currentWorkspace = getCurrentWorkspace();
  const { 
    tickets, 
    messages, 
    selectedTicketId, 
    setSelectedTicketId,
  } = useSupportStore();
  
  // Real-time sync
  useSupportData();

  const [isCreating, setIsCreating] = useState(false);
  const [newTicketSubject, setNewTicketSubject] = useState('');
  const [newTicketPriority, setNewTicketPriority] = useState<Priority>('normal');
  const [initialMessage, setInitialMessage] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [adminFilter, setAdminFilter] = useState<'all' | 'open' | 'pending_support' | 'resolved'>('all');
  const [tagFilter, setTagFilter] = useState<FeedbackTag | 'all'>('all');
  const [tagRevision, setTagRevision] = useState(0);
  const ticketTags = useMemo(
    () => (tagRevision >= 0 ? loadFeedbackTags(currentWorkspace?.id) : {}),
    [currentWorkspace?.id, tagRevision],
  );
  const [attachDiagnostics, setAttachDiagnostics] = useState(true);
  const [showDiagnosticsDetail, setShowDiagnosticsDetail] = useState(false);
  const [copiedTrace, setCopiedTrace] = useState(false);
  const { setSafeTimeout } = useTimeout();

  const latestError = getLatestErrorDiagnostic();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedTicketId]);

  const isAdmin = useAuthStore(s => s.isAdmin);
  const role = useCurrentRole();
  const canTriage = Boolean(isAdmin || role === 'owner');

  // Filter tickets
  const filteredTickets = tickets.filter(t => {
    if (!isAdmin && t.workspaceId !== currentWorkspace?.id) {
      return false;
    }
    if (canTriage) {
      if (adminFilter === 'open' && t.status !== 'open') return false;
      if (adminFilter === 'pending_support' && t.status !== 'pending_support') return false;
      if (adminFilter === 'resolved' && t.status !== 'resolved') return false;
      if (tagFilter !== 'all' && !(ticketTags[t.id] || []).includes(tagFilter)) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  const activeMessages = messages.filter(m => m.ticketId === selectedTicketId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicketSubject.trim() || !initialMessage.trim() || !currentWorkspace) return;

    setIsSending(true);
    try {
      const ticketId = `ticket-${Math.random().toString(36).substring(2, 9)}`;
      const createdAt = new Date().toISOString();
      
      const safeSubject = maskCardNumbers(newTicketSubject);
      const safeInitialMessage = maskCardNumbers(initialMessage);
      const newTicket: SupportTicket = {
        id: ticketId,
        workspaceId: currentWorkspace.id,
        uid: user?.uid || '',
        subject: safeSubject,
        status: 'open',
        priority: newTicketPriority,
        createdAt,
        updatedAt: createdAt,
        lastMessageAt: createdAt,
        lastMessageBy: user?.uid || '',
        unreadForUser: false,
        unreadForAdmin: true,
        ...(attachDiagnostics && latestError ? {
          errorLogId: latestError.errorLogId,
          errorDiagnostics: latestError.diagnostics
        } : {})
      };

      await setDoc(doc(db, 'supportTickets', ticketId), newTicket);

      const idToken = await user?.getIdToken();
      let sentViaApi = false;
      try {
        const res = await fetch(`/api/v1/support/tickets/${ticketId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            body: safeInitialMessage,
            authorRole: 'user'
          })
        });
        if (res.ok) {
          sentViaApi = true;
        }
      } catch (apiErr) {
        console.warn('API message send failed, using client write:', apiErr);
      }

      if (!sentViaApi) {
        const messageId = `msg-${Math.random().toString(36).substring(2, 9)}`;
        const newMessage: SupportMessage = {
          id: messageId,
          ticketId,
          workspaceId: currentWorkspace.id,
          authorUid: user?.uid || '',
          authorRole: 'user',
          body: safeInitialMessage,
          createdAt
        };
        await setDoc(doc(db, 'supportMessages', messageId), newMessage);
      }

      setIsCreating(false);
      setNewTicketSubject('');
      setInitialMessage('');
      setSelectedTicketId(ticketId);
    } catch (err) {
      console.error(err);
      alert('Failed to create ticket');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedTicketId || !currentWorkspace) return;

    setIsSending(true);
    const textToSend = maskCardNumbers(messageInput.trim());
    try {
      const idToken = await user?.getIdToken();
      let sentViaApi = false;
      try {
        const res = await fetch(`/api/v1/support/tickets/${selectedTicketId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            body: textToSend,
            authorRole: isAdmin ? 'admin' : 'user'
          })
        });
        if (res.ok) {
          sentViaApi = true;
        }
      } catch (apiErr) {
        console.warn('API send message failed, using client write:', apiErr);
      }

      if (!sentViaApi) {
        const messageId = `msg-${Math.random().toString(36).substring(2, 9)}`;
        const createdAt = new Date().toISOString();
        const newMessage: SupportMessage = {
          id: messageId,
          ticketId: selectedTicketId,
          workspaceId: currentWorkspace.id,
          authorUid: user?.uid || '',
          authorRole: isAdmin ? 'admin' : 'user',
          body: textToSend,
          createdAt
        };
        await setDoc(doc(db, 'supportMessages', messageId), newMessage);
        await updateDoc(doc(db, 'supportTickets', selectedTicketId), {
          lastMessageAt: createdAt,
          lastMessageBy: user?.uid || '',
          updatedAt: createdAt,
          unreadForUser: isAdmin,
          unreadForAdmin: !isAdmin,
          status: isAdmin ? 'pending_user' : 'pending_support'
        });
      }

      setMessageInput('');
    } catch (err) {
      console.error(err);
      alert('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const updateStatus = async (status: SupportTicket['status']) => {
    if (!selectedTicketId || !canTriage) return;
    useSupportStore.setState(prev => ({
      tickets: prev.tickets.map(ticket =>
        ticket.id === selectedTicketId ? { ...ticket, status } : ticket,
      ),
    }));
    try {
      const idToken = await user?.getIdToken();
      let updatedViaApi = false;
      try {
        const res = await fetch(`/api/v1/support/tickets/${selectedTicketId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          updatedViaApi = true;
        }
      } catch (apiErr) {
        console.warn('API update status failed, using client write:', apiErr);
      }

      if (!updatedViaApi) {
        await updateDoc(doc(db, 'supportTickets', selectedTicketId), {
          status,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
    }
  };

  const copyDiagnostics = () => {
    if (!selectedTicket?.errorDiagnostics?.stack) return;
    void copyText(selectedTicket.errorDiagnostics.stack).then(ok => {
      if (!ok) { toast.error('The browser blocked copying. Select the trace below and copy it by hand.'); return; }
      setCopiedTrace(true);
      setSafeTimeout(() => setCopiedTrace(false), 2000);
    });
  };

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden">
      {/* Sidebar: Ticket List */}
      <div className={cn(
        "w-full md:w-80 border-r bg-white flex flex-col",
        selectedTicketId && "hidden md:flex"
      )}>
        <div className="p-4 border-b flex items-center justify-between bg-white sticky top-0 z-10">
          <h1 className="text-xl font-bold text-slate-900">Support</h1>
          {!isAdmin && (
            <button 
              aria-label="Create support ticket"
              onClick={() => setIsCreating(true)}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus aria-hidden="true" className="w-5 h-5" />
            </button>
          )}
        </div>

        {canTriage && (
          <div className="p-4 border-b bg-slate-50 space-y-2">
            <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter support tickets by status">
              {(['all', 'open', 'pending_support', 'resolved'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAdminFilter(f)}
                  className={cn(
                    "px-3 py-1 min-h-11 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                    adminFilter === f ? "bg-blue-100 text-blue-700" : "bg-white text-slate-600 border border-slate-200"
                  )}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter support tickets by tag">
              <button
                type="button"
                onClick={() => setTagFilter('all')}
                className={cn(
                  "px-2.5 py-1 min-h-11 rounded-full text-xs font-medium whitespace-nowrap",
                  tagFilter === 'all' ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200"
                )}
              >
                All tags
              </button>
              {FEEDBACK_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag)}
                  className={cn(
                    "px-2.5 py-1 min-h-11 rounded-full text-xs font-medium whitespace-nowrap",
                    tagFilter === tag ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200"
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filteredTickets.length === 0 ? (
            <div className="p-8 text-center text-[var(--muted)]">
              <Headphones aria-hidden="true" className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No support tickets found.</p>
            </div>
          ) : (
            filteredTickets.map(ticket => (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicketId(ticket.id)}
                className={cn(
                  "w-full p-4 border-b text-left hover:bg-slate-50 transition-colors relative",
                  selectedTicketId === ticket.id && "bg-blue-50 border-r-4 border-r-blue-600"
                )}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-semibold text-slate-900 line-clamp-1">
                    {ticket.subject}
                  </span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                    ticket.status === 'open' && "bg-emerald-100 text-emerald-700",
                    ticket.status === 'pending_support' && "bg-amber-100 text-amber-700",
                    ticket.status === 'pending_user' && "bg-blue-100 text-blue-700",
                    ticket.status === 'resolved' && "bg-slate-100 text-slate-700"
                  )}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center text-xs text-[var(--muted)] gap-2">
                  <Clock aria-hidden="true" className="w-3 h-3" />
                  {format(new Date(ticket.lastMessageAt), 'MMM d, HH:mm')}
                  {ticket.errorDiagnostics && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 font-medium bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                      <Bug aria-hidden="true" className="w-2.5 h-2.5" /> Stack
                    </span>
                  )}
                </div>
                {((!isAdmin && ticket.unreadForUser) || (isAdmin && ticket.unreadForAdmin)) && (
                  <div className="absolute top-4 right-4 w-2 h-2 bg-blue-600 rounded-full" />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main: Chat or Creation */}
      <div className={cn(
        "flex-1 flex flex-col bg-slate-50 relative",
        !selectedTicketId && !isCreating && "hidden md:flex items-center justify-center"
      )}>
        <AnimatePresence mode="wait">
          {isCreating ? (
            <motion.div 
              key="creating"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 max-w-2xl w-full mx-auto p-6"
            >
              <div className="bg-white rounded-2xl shadow-xl border p-8">
                <div className="flex items-center gap-4 mb-8">
                  <button onClick={() => setIsCreating(false)} aria-label="Back to support tickets" className="p-2 hover:bg-slate-100 rounded-full">
                    <ArrowLeft aria-hidden="true" className="w-6 h-6" />
                  </button>
                  <h2 className="text-2xl font-bold">New Support Ticket</h2>
                </div>

                <form onSubmit={handleCreateTicket} className="space-y-6">
                  <div>
                    <Labelled labelClassName="block text-sm font-medium text-slate-700 mb-2" label="Subject">
                      <input
                        type="text"
                        required
                        maxLength={200}
                        value={newTicketSubject}
                        onChange={e => setNewTicketSubject(e.target.value)}
                        className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. Encountered error during bank reconcile"
                      />
                    </Labelled>
                  </div>

                  <div>
                    <div id={`${formId}-priority`} className="block text-sm font-medium text-slate-700 mb-2">Priority</div>
                    <div role="group" aria-labelledby={`${formId}-priority`} className="flex gap-4">
                      {(['low', 'normal', 'high'] as const).map(p => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={newTicketPriority === p}
                          onClick={() => setNewTicketPriority(p)}
                          className={cn(
                            "flex-1 py-3 rounded-xl border text-sm font-medium transition-all",
                            newTicketPriority === p 
                              ? "bg-blue-600 text-white border-blue-600" 
                              : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                          )}
                        >
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {latestError && (
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-sm">
                      <div className="flex items-start gap-3">
                        <Bug aria-hidden="true" className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-amber-900">Recent application error detected</p>
                          <p className="text-xs text-amber-800 mt-1 font-mono truncate">{latestError.diagnostics.message}</p>
                          <label htmlFor={`${formId}-diagnostics`} className="flex items-center gap-2 mt-3 cursor-pointer text-xs font-medium text-amber-900">
                            <input 
                              id={`${formId}-diagnostics`}
                              type="checkbox"
                              checked={attachDiagnostics}
                              onChange={e => setAttachDiagnostics(e.target.checked)}
                              className="rounded border-amber-300 text-blue-600 focus:ring-blue-500"
                            />
                            Attach error stack trace and release diagnostics to this report
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <Labelled labelClassName="block text-sm font-medium text-slate-700 mb-2" label="Message">
                      <textarea
                        required
                        maxLength={5000}
                        value={initialMessage}
                        onChange={e => setInitialMessage(e.target.value)}
                        rows={5}
                        className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                        placeholder="Describe what happened, steps to reproduce, or what you were trying to accomplish..."
                      />
                    </Labelled>
                  </div>

                  <button
                    type="submit"
                    disabled={isSending}
                    className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all disabled:opacity-50"
                  >
                    {isSending ? 'Creating...' : 'Create Ticket'}
                  </button>
                </form>
              </div>
            </motion.div>
          ) : selectedTicket ? (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col"
            >
              {/* Chat Header */}
              <div className="bg-white border-b p-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
                <div className="flex items-center gap-4">
                  <button onClick={() => setSelectedTicketId(null)} aria-label="Back to support tickets" className="md:hidden p-2">
                    <ChevronLeft aria-hidden="true" className="w-6 h-6" />
                  </button>
                  <div>
                    <h3 className="font-bold text-slate-900 line-clamp-1">{selectedTicket.subject}</h3>
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span>ID: {selectedTicket.id}</span>
                      <span>•</span>
                      <span className="capitalize">{selectedTicket.priority} Priority</span>
                    </div>
                  </div>
                </div>
                
                {canTriage && (
                  <div className="flex flex-wrap gap-2">
                    <button 
                      type="button"
                      onClick={() => updateStatus('resolved')}
                      className="px-3 py-1.5 min-h-11 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-emerald-100"
                    >
                      <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5" />
                      Mark done
                    </button>
                    <button 
                      type="button"
                      onClick={() => updateStatus('closed')}
                      className="px-3 py-1.5 min-h-11 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-slate-200"
                    >
                      <AlertCircle aria-hidden="true" className="w-3.5 h-3.5" />
                      Close
                    </button>
                  </div>
                )}
              </div>

              {canTriage && (
                <div className="bg-white border-b px-4 py-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Ticket triage tags">
                  <span className="text-xs font-semibold text-slate-600 mr-1">Tags:</span>
                  {FEEDBACK_TAGS.map(tag => {
                    const active = (ticketTags[selectedTicket.id] || []).includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          toggleFeedbackTag(currentWorkspace?.id, selectedTicket.id, tag);
                          setTagRevision(v => v + 1);
                        }}
                        className={cn(
                          "px-2.5 py-1 min-h-11 rounded-lg text-xs font-medium border transition-colors",
                          active
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Diagnostic Error Panel if attached */}
              {selectedTicket.errorDiagnostics && (
                <div className="bg-slate-900 text-slate-100 border-b border-slate-800 text-xs px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-mono">
                      <Bug aria-hidden="true" className="w-4 h-4 text-rose-400" />
                      <span className="text-rose-300 font-semibold">Diagnostic Trace:</span>
                      <span className="truncate max-w-md text-slate-300">{selectedTicket.errorDiagnostics.message}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono text-[10px]">
                        {selectedTicket.errorDiagnostics.release || 'v1.0.0'}
                      </span>
                      <button 
                        onClick={() => setShowDiagnosticsDetail(!showDiagnosticsDetail)}
                        className="text-slate-400 hover:text-white flex items-center gap-1 py-0.5 px-1.5 rounded hover:bg-slate-800"
                      >
                        {showDiagnosticsDetail ? <ChevronUp aria-hidden="true" className="w-3.5 h-3.5" /> : <ChevronDown aria-hidden="true" className="w-3.5 h-3.5" />}
                        {showDiagnosticsDetail ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {showDiagnosticsDetail && (
                    <div className="mt-3 pt-3 border-t border-slate-800 font-mono space-y-2">
                      <div>
                        <span className="text-[var(--muted)]">URL: </span>
                        <span className="text-slate-300">{selectedTicket.errorDiagnostics.url || '/'}</span>
                      </div>
                      {selectedTicket.errorDiagnostics.stack && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[var(--muted)]">Stack trace:</span>
                            <button 
                              onClick={copyDiagnostics}
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                              {copiedTrace ? <Check aria-hidden="true" className="w-3 h-3 text-emerald-400" /> : <Copy aria-hidden="true" className="w-3 h-3" />}
                              {copiedTrace ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <pre className="p-2.5 bg-black/60 rounded text-[11px] text-rose-200 overflow-x-auto max-h-40 whitespace-pre-wrap">
                            {selectedTicket.errorDiagnostics.stack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* BO-05: screenshots and files kept with the ticket (feedback adds its screenshot here) */}
              <AttachmentsPanel target={{ collection: 'supportTickets', id: selectedTicket.id, label: `Ticket "${selectedTicket.subject}"` }} workspaceId={selectedTicket.workspaceId} className="mx-4 mt-3" />

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeMessages.map((msg) => {
                  const isOwn = msg.authorUid === user?.uid;
                  return (
                    <div key={msg.id} className={cn(
                      "flex",
                      isOwn ? "justify-end" : "justify-start"
                    )}>
                      <div className={cn(
                        "max-w-[85%] md:max-w-[70%] rounded-2xl p-4 shadow-sm",
                        isOwn ? "bg-blue-600 text-white rounded-tr-none" : "bg-white border text-slate-800 rounded-tl-none"
                      )}>
                        {!isOwn && (
                          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                            <User aria-hidden="true" className="w-3 h-3" />
                            {msg.authorRole === 'admin' ? 'Support Agent' : 'User'}
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                        <div className={cn(
                          "text-[10px] mt-2 opacity-60",
                          isOwn ? "text-right" : "text-left"
                        )}>
                          {format(new Date(msg.createdAt), 'HH:mm')}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              {selectedTicket.status !== 'closed' && selectedTicket.status !== 'resolved' ? (
                <div className="p-4 bg-white border-t">
                  <form onSubmit={handleSendMessage} className="flex gap-4">
                    <input
                      aria-label="Reply to support ticket"
                      type="text"
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      placeholder="Type your reply..."
                      className="flex-1 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button
                      aria-label="Send reply"
                      type="submit"
                      disabled={isSending || !messageInput.trim()}
                      className="p-3 bg-blue-600 text-white rounded-xl shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      <Send aria-hidden="true" className="w-6 h-6" />
                    </button>
                  </form>
                </div>
              ) : (
                <div className="p-6 bg-slate-100 text-center border-t border-slate-200">
                  <p className="text-sm text-[var(--muted)] font-medium">
                    This ticket is {selectedTicket.status}. Re-open it by sending a message?
                    {isAdmin && (
                      <button 
                        onClick={() => updateStatus('open')}
                        className="ml-2 text-blue-600 font-bold hover:underline"
                      >
                        Re-open Ticket
                      </button>
                    )}
                  </p>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center p-8 text-center"
            >
              <div className="w-20 h-20 bg-blue-100 rounded-3xl flex items-center justify-center mb-6">
                <MessageSquare aria-hidden="true" className="w-10 h-10 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Select a ticket to view</h2>
              <p className="text-[var(--muted)] max-w-sm">
                Choose a conversation from the list or create a new ticket to get help from our support team.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
