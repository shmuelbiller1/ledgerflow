/** CON-4b: filed tax returns. */
import { returnChanges } from '../taxReturnDocs';
import type { TaxReturnBox } from '../taxCodes';

/** The return filed for the whole workspace for exactly this period (one filed for a single registration is not it). */
export function wholeWorkspaceReturn<R extends { startDate: string; endDate: string; registration?: string }>(filed: R[] | null | undefined, startDate: string, endDate: string): R | undefined {
  return filed?.find(r => !r.registration && r.startDate === startDate && r.endDate === endDate);
}

/** One box's difference between the copy kept at filing and the same box recomputed now (T-08). */
export interface FiledReturnChange {
  key: string;
  label: string;
  filedCents: number;
  nowCents: number;
}

/**
 * T-08: box-by-box changes since one registration's return was filed — the filed copy's boxes against
 * `nowBoxes` recomputed from today's documents. `null` when there is nothing to compare: no return was
 * filed for exactly this registration and period with its figures kept, or the caller cannot recompute
 * the same boxes now (partial data). Read-only: it changes no figure and files nothing.
 */
export function filedRegistrationChanges<
  R extends { startDate: string; endDate: string; registration?: string; boxes?: TaxReturnBox[] },
>(filed: R[] | null | undefined, startDate: string, endDate: string, registration: string, nowBoxes: TaxReturnBox[] | null | undefined): FiledReturnChange[] | null {
  const copy = filed?.find(r => r.registration === registration && r.startDate === startDate && r.endDate === endDate
    && Array.isArray(r.boxes) && r.boxes.length > 0);
  if (!copy || !nowBoxes || nowBoxes.length === 0) return null;
  return returnChanges({ boxes: copy.boxes as TaxReturnBox[] }, { boxes: nowBoxes });
}
