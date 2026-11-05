/**
 * L-123: one GET to the server-side balances API (src/server/routes/balanceRoutes.ts), signed in as the current
 * user. Throws when the answer is not ok or `valid` rejects its body, so a caller keeps its loaded figures.
 */
import { getIdToken } from '../firebase';

export async function getBalances<T>(path: string, params: Record<string, string>, valid: (body: Partial<T>) => boolean): Promise<T> {
  const res = await fetch(`/api/v1/balances/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
  const body = await res.json().catch(() => ({})) as Partial<T>;
  if (!res.ok || !valid(body)) throw new Error(`balances ${path} ${res.status}`);
  return body as T;
}
