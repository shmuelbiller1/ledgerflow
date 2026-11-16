import { runCommand } from './runCommand';

/** The server's Profit by Label report (src/server/reports/byLabel.ts) for a query string; throws its own message. */
export async function fetchProfitByLabel<R extends { columns: unknown[] }>(query: string): Promise<R> {
  const body = await runCommand<R>({ path: `/api/v1/reports/by-label?${query}` });
  // the server answers 200 with an empty body when the query names a kind it does not know; that is not a report
  if (!Array.isArray(body?.columns)) throw new Error('The report could not be made');
  return body;
}
