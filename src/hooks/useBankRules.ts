import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs, query, where } from '../lib/db/firestore';
import type { AutoRule } from '../types';

/**
 * The workspace's bank rules (the same `autoRules` the import and the server run), read once while `enabled`.
 * A refused read gives none: the screens then fall back to history or ask. `setRules` adds one just saved.
 */
export function useBankRules(workspaceId: string | null | undefined, enabled = true) {
  const [rules, setRules] = useState<AutoRule[]>([]);
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let current = true;
    getDocs(query(collection(db, 'autoRules'), where('workspaceId', '==', workspaceId)))
      .then(snap => { if (current) setRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as AutoRule))); })
      .catch(() => { if (current) setRules([]); });
    return () => { current = false; };
  }, [workspaceId, enabled]);
  return [rules, setRules] as const;
}
