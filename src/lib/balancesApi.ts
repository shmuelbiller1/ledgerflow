/**
 * L-123: one GET to the server-side balances API (src/server/routes/balanceRoutes.ts), signed in as the current
 * user. Throws when the answer is not ok or `valid` rejects its body, so a caller keeps its loaded figures.
 */
import { runCommand } from './runCommand';

export async function getBalances<T>(path: string, params: Record<string, string>, valid: (body: Partial<T>) => boolean): Promise<T> {
  const body = await runCommand<Partial<T>>({ path: `/api/v1/balances/${path}?${new URLSearchParams(params)}` }) ?? {};
  if (!valid(body)) throw new Error(`balances ${path} answered with a body it does not recognise`);
  return body as T;
}
