import { useEffect, useState } from 'react';
import { decodeJwt } from 'jose';
import { getIdToken } from '../../firebase';
import { runCommand } from '../../lib/runCommand';

/**
 * Two-step login required by a workspace (Y-30). A session that has not passed two-step login asks
 * the server whether a workspace this person belongs to requires it; if so the app shows the setup
 * screen instead of the books (which the server and the database refuse anyway). Sessions that
 * passed it (aal2) need no request.
 */
export interface TwoStepRequirement { setupRequired: boolean; workspaces: Array<{ id: string; name: string }> }

export async function fetchTwoStepRequirement(): Promise<TwoStepRequirement> {
  const token = await getIdToken();
  if (!token) return { setupRequired: false, workspaces: [] };
  if (decodeJwt(token).aal === 'aal2') return { setupRequired: false, workspaces: [] };
  // `token` is passed as given: this runs before the session store is settled, and `null` means send none at all
  const data = await runCommand<{ setupRequired?: unknown; workspaces?: unknown }>({
    path: '/api/v1/account/two-step', token,
  }).catch(() => null);
  if (!data) return { setupRequired: false, workspaces: [] };
  return { setupRequired: data.setupRequired === true, workspaces: Array.isArray(data.workspaces) ? data.workspaces : [] };
}

/** `checked` is false until the answer for this person is in (the app waits, so no empty books flash by). */
export function useTwoStepSetup(uid: string | null, skip: boolean) {
  const [answer, setAnswer] = useState<(TwoStepRequirement & { uid: string; tick: number }) | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!uid || skip) return;
    let live = true;
    fetchTwoStepRequirement()
      .then(r => { if (live) setAnswer({ ...r, uid, tick }); })
      .catch(() => { if (live) setAnswer({ setupRequired: false, workspaces: [], uid, tick }); });
    return () => { live = false; };
  }, [uid, skip, tick]);
  const current = answer && answer.uid === uid && answer.tick === tick ? answer : null;
  return {
    checked: skip || !uid || current !== null,
    setupRequired: !skip && Boolean(current?.setupRequired),
    workspaces: current?.workspaces || [],
    recheck: () => setTick(t => t + 1),
  };
}
