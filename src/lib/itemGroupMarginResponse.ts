import type { GroupMonth, GroupMarginRow, grossMarginByItemGroup } from './grossMarginByGroup';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const amounts = (r: Record<string, unknown>) => Number.isSafeInteger(r.salesCents) && Number.isSafeInteger(r.costCents)
  && Number.isSafeInteger(r.marginCents) && (r.marginPct === null || Number.isFinite(r.marginPct)) && typeof r.costIsEstimate === 'boolean';

/** The CSV flattens cells in array order. Do not export a short, reordered or different year's
 * matrix under the selected month's heading, even if the response contained three arrays. */
export function itemGroupMarginResponse(body: Record<string, unknown>, workspace: string, months: string[]): ReturnType<typeof grossMarginByItemGroup> | null {
  const provenance = body.provenance;
  if (provenance !== undefined && !(record(provenance) && provenance.source === 'server' && provenance.completeness === 'complete')) return null;
  if (body.workspaceId !== undefined && body.workspaceId !== workspace) return null;
  const returned = body.months;
  if (!Array.isArray(returned) || returned.length !== months.length || !months.every((m, i) => m === returned[i])) return null;
  const cells = (v: unknown): v is GroupMonth[] => Array.isArray(v) && v.length === months.length
    && v.every((cell, i) => record(cell) && cell.month === months[i] && amounts(cell));
  const groups = (v: unknown): v is GroupMarginRow[] => Array.isArray(v) && v.every(r => record(r) && typeof r.group === 'string' && amounts(r) && cells(r.months));
  if (!cells(body.totals) || !groups(body.rows) || new Set(body.rows.map(r => r.group)).size !== body.rows.length) return null;
  return { months, totals: body.totals, rows: body.rows };
}
