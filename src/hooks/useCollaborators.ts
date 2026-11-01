import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc, serverTimestamp, query, where, deleteDoc } from '../lib/db/firestore';
import { useAuthStore } from '../stores/useAuthStore';
import { isClientActiveForPolling } from './useVisibilityPolling';

export interface Collaborator {
  id: string;
  name: string;
  email: string;
  lastActive: unknown;
  color: string;
  cursor?: { x: number; y: number };
  currentWorkspaceId?: string;
}

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

/** Marks a Node interval handle as unreferenced so idle test processes can exit cleanly. */
function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

/** Tracks active workspace collaborators via Realtime snapshots and visibility-gated presence heartbeats. */
export function useCollaborators() {
  const uid = useAuthStore(s => s.userProfile?.uid);
  const displayName = useAuthStore(s => s.userProfile?.displayName);
  const email = useAuthStore(s => s.userProfile?.email);
  const activeWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    if (!uid || !activeWorkspaceId) {
      return undefined;
    }

    const userDocRef = doc(db, 'presence', uid);
    const userColor = COLORS[uid.charCodeAt(0) % COLORS.length];
    const resolvedName = displayName || email?.split('@')[0] || 'Anonymous';

    let disposed = false;
    let inFlight = false;

    const updatePresence = async () => {
      if (disposed || inFlight || !isClientActiveForPolling()) return;
      inFlight = true;
      try {
        await setDoc(userDocRef, {
          uid,
          name: resolvedName,
          email,
          currentWorkspaceId: activeWorkspaceId,
          lastActive: serverTimestamp(),
          color: userColor,
        }, { merge: true });
      } catch (err) {
        console.warn('Presence update deferred:', err);
      } finally {
        inFlight = false;
      }
    };

    void updatePresence();
    const interval = setInterval(() => {
      void updatePresence();
    }, 30_000);
    unrefTimer(interval);

    const handleResume = () => {
      if (isClientActiveForPolling()) {
        void updatePresence();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleResume);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleResume);
    }

    // F1: Scoped query by currentWorkspaceId to prevent cross-tenant presence leaking
    const q = query(
      collection(db, 'presence'),
      where('currentWorkspaceId', '==', activeWorkspaceId),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const activeThreshold = 60_000; // 1 minute

      const active = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Collaborator))
        .filter(c => {
          if (!c.lastActive) return true;
          const lastActiveTime = (c.lastActive as { toDate?: () => Date }).toDate?.()?.getTime() || now;
          return now - lastActiveTime < activeThreshold;
        });

      setCollaborators(active);
    }, (err) => {
      console.warn('Presence subscription warning:', err);
    });

    // F29: Properly store handler reference and remove on unmount
    const handleUnload = () => {
      void deleteDoc(userDocRef).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      disposed = true;
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleResume);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleResume);
      }
      unsubscribe();
      window.removeEventListener('beforeunload', handleUnload);
      void deleteDoc(userDocRef).catch(() => {});
    };
  }, [uid, displayName, email, activeWorkspaceId]);

  return uid && activeWorkspaceId ? collaborators : [];
}
