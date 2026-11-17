import { useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from '../lib/db/firestore';
import { runNamedCommand } from '../lib/commandByName';
import { localUpdate, localUpdateMany } from '../lib/db/localStore';
import { guestSession } from '../lib/db/guestDatabase';
import { useAuthStore } from '../stores/useAuthStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import type { AppNotification } from '../types';
import type { NotificationPrefs } from '../lib/notifications';

/**
 * Loads the signed-in person's latest notifications for the current workspace, live (the
 * database only returns their own rows). Mounted once, in the header.
 */
export function useNotificationFeed() {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const setNotifications = useNotificationStore(s => s.setNotifications);

  useEffect(() => {
    setNotifications([]);
    if (!uid || !workspaceId) return undefined;
    const q = query(collection(db, 'notifications'), where('workspaceId', '==', workspaceId), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(50));
    return onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ ...(d.data() as Omit<AppNotification, 'id'>), id: d.id })));
    }, () => setNotifications([]));
  }, [uid, workspaceId, setNotifications]);
}

/**
 * Mark notifications as read.
 *
 * `notification.read` marks the caller's own rows and stamps the time on the server; the tab used to batch the
 * writes itself, with the device's clock and no check that the row was its own. The store is only brought in line
 * with the answer once the server has taken it.
 */
export async function markNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  const readAt = new Date().toISOString();
  let marked = ids.length;
  if (guestSession()) {
    // the sample company's rows are the tab's own, so it marks them the same way it reads them
    await localUpdateMany('notifications', ids.map(id => ({ id, data: { read: true, readAt } })));
  } else {
    ({ marked } = await runNamedCommand<{ marked: number; readAt: string }>('notification.read', { ids }));
  }
  if (marked === 0) return;
  const { notifications, setNotifications } = useNotificationStore.getState();
  setNotifications(notifications.map(n => (ids.includes(n.id) ? { ...n, read: true, readAt } : n)));
}

export async function loadNotificationPrefs(uid: string): Promise<NotificationPrefs> {
  const snap = await getDoc(doc(db, 'users', uid));
  return ((snap.data() as { notificationPrefs?: NotificationPrefs } | undefined)?.notificationPrefs) || {};
}

/**
 * Which notices this person wants, saved on their own profile.
 *
 * `user.preferences` merges per key and types `updatedAt` on the server; the sample company has no profile row
 * there, so its tab keeps the choice in its own copy.
 */
export async function saveNotificationPrefs(uid: string, notificationPrefs: NotificationPrefs) {
  if (guestSession()) {
    await localUpdate('users', uid, { notificationPrefs, updatedAt: new Date().toISOString() });
    return;
  }
  await runNamedCommand('user.preferences', { notificationPrefs });
}
