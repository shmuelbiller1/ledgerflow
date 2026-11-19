import React from 'react';

/** The buttons under a list paged by `usePagedRows` (R-5). */
const button = 'min-h-11 px-4 text-xs font-bold border border-[var(--line)] rounded-xl bg-[var(--surface)]';

/** "Show more (200 of 4,812)" and "Show all 4,812", only while rows are left to draw. */
export function ShowMoreRows({ shown, total, noun, onMore, onAll, labels }: { shown: number; total: number; noun: string; onMore: () => void; onAll: () => void; labels?: { more: string; all: string } }) {
  if (total <= shown) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <button type="button" onClick={onMore} className={button}>{labels?.more ?? `Show more ${noun} (${shown} of ${total})`}</button>
      <button type="button" onClick={onAll} className={button}>{labels?.all ?? `Show all ${total}`}</button>
    </div>
  );
}
