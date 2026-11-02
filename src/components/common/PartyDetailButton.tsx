import React from 'react';

/** A native row opener, separate from the party's inline-editable name. */
export function PartyDetailButton({ id, side, name, onOpen }: {
  id: string;
  side: 'customer' | 'vendor';
  name: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" id={id} aria-label={`View ${side} ${name}`}
      onClick={event => { event.stopPropagation(); onOpen(); }}
      className="min-h-11 min-w-11 text-sm text-[var(--text)] underline rounded text-left">
      View details
    </button>
  );
}
