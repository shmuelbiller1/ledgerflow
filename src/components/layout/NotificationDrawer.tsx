import { runCommand } from '../../lib/runCommand';
import { useDialog } from '../../hooks/useDialog';
import React, { useEffect, useState, useId } from 'react';
import { toast } from 'sonner';
import { Bell, CheckCheck, X, FileText, CreditCard, Landmark, Users, MailWarning, Settings2, ArrowRight, MessageCircleQuestion } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { unreadCount, useNotificationStore } from '../../stores/useNotificationStore';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { loadNotificationPrefs, markNotificationsRead, saveNotificationPrefs } from '../../hooks/useNotificationFeed';
import { NOTIFICATION_TYPES, typesForRole, wantsNotification } from '../../lib/notifications';
import { EMAIL_MODE_LABEL, EMAIL_MODES, emailMode, type NotificationEmailMode } from '../../lib/notificationEmail';
import type { NotificationPrefs } from '../../lib/notifications';
import { recordFromNotice } from '../../lib/watches';
import { groupNotificationsByType } from '../../lib/feedbackTriage';
import type { AppNotification } from '../../types';

/**
 * The bell's panel: the signed-in person's notifications (live, from the server), mark read,
 * and "Choose notifications" to turn types off (S-19).
 */

function KindIcon({ kind }: { kind: string }) {
  const props = { size: 16, 'aria-hidden': true as const };
  if (kind.startsWith('payment')) return <CreditCard {...props} className="text-[var(--pos)]" />;
  if (kind.startsWith('bank')) return <Landmark {...props} className="text-[var(--neg)]" />;
  if (kind.startsWith('member')) return <Users {...props} className="text-[var(--brass)]" />;
  if (kind.startsWith('email')) return <MailWarning {...props} className="text-[var(--neg)]" />;
  if (kind.startsWith('query')) return <MessageCircleQuestion {...props} className="text-[var(--brass)]" />;
  return <FileText {...props} className="text-[var(--brass)]" />;
}

function Preferences({ onDone }: { onDone: () => void }) {
  const preferencesId = useId();
  const uid = useAuthStore(s => s.user?.uid) || '';
  const role = useCurrentRole();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  // S-18: whether notices also come by email (kept by the server)
  const [mail, setMail] = useState<NotificationEmailMode | null>(null);
  const [mailLoaded, setMailLoaded] = useState<NotificationEmailMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadNotificationPrefs(uid)
      .then(p => { if (!cancelled) setPrefs(p); })
      .catch(() => { if (!cancelled) setPrefs({}); });
    void runCommand<{ mode?: string }>({ path: '/api/v1/account/notification-email' })
      .then(data => { if (!cancelled) { setMail(emailMode(data.mode)); setMailLoaded(emailMode(data.mode)); } })
      .catch(() => { if (!cancelled) { setMail('off'); setMailLoaded('off'); } });
    return () => { cancelled = true; };
  }, [uid]);

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await saveNotificationPrefs(uid, prefs);
      if (mail && mail !== mailLoaded) {
        await runCommand({ path: '/api/v1/account/notification-email', method: 'PUT', body: { mode: mail } });
        setMailLoaded(mail);
      }
      toast.success('Notification choices saved.');
      onDone();
    } catch {
      toast.error('Could not save your choices.');
    } finally {
      setSaving(false);
    }
  };

  const types = typesForRole(role);
  return (
    <div className="p-5 space-y-3">
      <p className="text-xs text-[var(--muted)]">Choose what you're told about in this app. This applies to all your workspaces.</p>
      {prefs === null ? <p className="text-xs text-[var(--muted)]">Loading…</p> : (
        <ul className="space-y-2">
          {types.map(type => (
            <li key={type}>
              <label htmlFor={`${preferencesId}-${type}`} className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input id={`${preferencesId}-${type}`} type="checkbox" checked={wantsNotification(prefs, type)}
                  onChange={e => setPrefs({ ...prefs, [type]: e.target.checked })} />
                {NOTIFICATION_TYPES[type].label}
              </label>
            </li>
          ))}
          {types.length === 0 && <li className="text-xs text-[var(--muted)]">Your role doesn't receive notifications.</li>}
        </ul>
      )}
      {mail !== null && (
        <label htmlFor={`${preferencesId}-mail`} className="block text-sm text-[var(--text)]">
          <span className="block text-xs font-semibold text-[var(--muted)] mb-1">By email too</span>
          <select id={`${preferencesId}-mail`} value={mail} onChange={e => setMail(e.target.value as NotificationEmailMode)}
            className="w-full p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]">
            {EMAIL_MODES.map(m => <option key={m} value={m}>{EMAIL_MODE_LABEL[m]}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={saving || prefs === null} onClick={save}
          className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">Save</button>
        <button type="button" onClick={onDone} className="px-3 py-2 rounded-lg border border-[var(--line)] text-sm text-[var(--text)]">Back</button>
      </div>
    </div>
  );
}

export default function NotificationDrawer() {
  const notifications = useNotificationStore(s => s.notifications);
  const isDrawerOpen = useNotificationStore(s => s.isDrawerOpen);
  const setDrawerOpen = useNotificationStore(s => s.setDrawerOpen);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [groupedView, setGroupedView] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const { dialogProps, titleId } = useDialog(() => setDrawerOpen(false), isDrawerOpen);

  if (!isDrawerOpen) return null;

  const unread = unreadCount(notifications);
  const shown = notifications.filter(n => filter === 'all' || !n.read);
  const groups = groupNotificationsByType(shown);

  const markRead = (ids: string[]) => {
    markNotificationsRead(ids).catch(() => toast.error('Could not mark as read.'));
  };

  const open = (n: AppNotification) => {
    if (!n.read) markRead([n.id]);
    // BG-04: a watched record's notice opens the record itself
    const record = recordFromNotice(n.kind, n.recordId);
    if (record) {
      useUIStore.getState().openRecord(record);
      setDrawerOpen(false);
    } else if (n.linkTab) {
      setActiveTab(n.linkTab);
      setDrawerOpen(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 overflow-hidden">
      <button type="button" aria-label="Close notifications" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-black/40 cursor-default" />
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          className="w-screen max-w-md bg-[var(--surface)] border-l border-[var(--line)] shadow-2xl flex flex-col text-[var(--text)]">
          <div className="p-5 border-b border-[var(--line)] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Bell size={18} className="text-[var(--brass)]" aria-hidden="true" />
              <div>
                <h2 id={titleId} className="text-base font-bold">{choosing ? 'Choose notifications' : 'Notifications'}</h2>
                {!choosing && <p className="text-xs text-[var(--muted)]">{unread} unread</p>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!choosing && unread > 0 && (
                <button type="button" onClick={() => markRead(notifications.filter(n => !n.read).map(n => n.id))}
                  className="p-1.5 text-xs font-semibold rounded-lg hover:bg-[var(--elevated)] flex items-center gap-1">
                  <CheckCheck size={15} aria-hidden="true" /> Mark all read
                </button>
              )}
              {!choosing && (
                <button type="button" onClick={() => setChoosing(true)} className="p-1.5 rounded-lg hover:bg-[var(--elevated)]" aria-label="Choose notifications">
                  <Settings2 size={16} aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--elevated)]" aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          {choosing ? <Preferences onDone={() => setChoosing(false)} /> : (
            <>
              <div className="px-5 py-2.5 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-2" role="group" aria-label="Show">
                <div className="flex items-center gap-2">
                  {(['all', 'unread'] as const).map(f => (
                    <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                      className={`px-3 py-1 min-h-11 text-xs font-bold rounded-lg ${filter === f ? 'bg-[var(--elevated)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                      {f === 'all' ? `All (${notifications.length})` : `Unread (${unread})`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-pressed={groupedView}
                  onClick={() => setGroupedView(prev => !prev)}
                  className={`px-3 py-1 min-h-11 text-xs font-bold rounded-lg ${groupedView ? 'bg-[var(--elevated)] text-[var(--text)]' : 'text-[var(--muted)]'}`}
                >
                  Group by type
                </button>
              </div>
              <ul className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {shown.length === 0 ? (
                  <li className="p-12 text-center text-[var(--muted)]">
                    <Bell size={32} className="mx-auto mb-2" aria-hidden="true" />
                    <p className="text-xs font-semibold">{filter === 'unread' ? 'Nothing unread.' : 'No notifications yet. Payments, overdue invoices and bank problems show up here.'}</p>
                  </li>
                ) : groupedView ? groups.map(group => (
                  <li key={group.key} className="space-y-2">
                    <div className="flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      <span>{group.label}</span>
                      <span className="tabular-nums">{group.items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {group.items.map(n => (
                        <button key={n.id} type="button" onClick={() => open(n)}
                          className={`w-full text-left p-4 rounded-xl border transition-colors ${n.read ? 'border-[var(--line)] opacity-80' : 'border-[var(--brass)] bg-[var(--brass-soft)]'}`}>
                          <div className="flex items-start gap-3">
                            <span className="p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] shrink-0"><KindIcon kind={n.kind} /></span>
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold truncate">{n.title}</span>
                                {!n.read && <span className="w-2 h-2 rounded-full bg-[var(--brass)] shrink-0" aria-label="unread" />}
                              </span>
                              <span className="block text-xs text-[var(--muted)] mt-1 leading-relaxed">{n.message}</span>
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </li>
                )) : shown.map(n => (
                  <li key={n.id}>
                    <button type="button" onClick={() => open(n)}
                      className={`w-full text-left p-4 rounded-xl border transition-colors ${n.read ? 'border-[var(--line)] opacity-80' : 'border-[var(--brass)] bg-[var(--brass-soft)]'}`}>
                      <div className="flex items-start gap-3">
                        <span className="p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] shrink-0"><KindIcon kind={n.kind} /></span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold truncate">{n.title}</span>
                            {!n.read && <span className="w-2 h-2 rounded-full bg-[var(--brass)] shrink-0" aria-label="unread" />}
                          </span>
                          <span className="block text-xs text-[var(--muted)] mt-1 leading-relaxed">{n.message}</span>
                          <span className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
                            <span>{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</span>
                            {n.linkTab && <span className="font-bold flex items-center gap-0.5">View <ArrowRight size={10} aria-hidden="true" /></span>}
                          </span>
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
