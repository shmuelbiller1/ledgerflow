import { getIdToken } from '../firebase';

/** The server's Profit by Label report (src/server/reports/byLabel.ts) for a query string; throws its own message. */
export async function fetchProfitByLabel<R extends { columns: unknown[] }>(query: string): Promise<R> {
  const res = await fetch(`/api/v1/reports/by-label?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.columns)) throw new Error(body.message || body.error || 'The report could not be made');
  return body as R;
}
