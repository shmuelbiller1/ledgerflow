import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { isGridNavKey, moveGridFocus, startGridFocus, type GridFocus } from '../../lib/ledgerGridNav';

/**
 * The keyboard home of the transaction list (#104). It is one focusable region around the rows:
 *  - click a row, and focus lands on this region (not on `<body>`, which used to leave the arrow
 *    keys captured by a window listener wherever the user was);
 *  - the arrow keys move the highlighted cell, Home/End to the first/last row, Enter (or typing)
 *    opens the cell's editor, Escape clears the highlight; with no cell highlighted yet the first
 *    arrow key starts on the first row (End starts on the last), so a keyboard-only user can enter
 *    the list at all;
 *  - when an inline editor closes, focus comes back here instead of falling to the page body, so
 *    the arrow keys keep working;
 *  - Tab and Shift+Tab are never intercepted, so the list can always be left with the keyboard;
 *  - a polite live region announces the highlighted row and column, because the highlight is
 *    logical and the row may be scrolled into place in a virtualized list.
 *
 * The listeners are attached natively (the same pattern as useDialog) so this region is a labelled
 * `region` landmark with a tab stop, not a div pretending to be a button.
 */
const NATIVE_CONTROL = 'button, input, select, textarea, a, [contenteditable="true"], [role="menu"], [role="listbox"]';

export interface TransactionGridKeyboardRegionProps {
  rows: ReadonlyArray<{ id: string }>;
  /** Fields the arrow keys visit, in drawn column order. */
  fields: string[];
  focus: GridFocus | null;
  /** an inline editor is open, or the list is not shown (pivot view): keys behave natively */
  inactive?: boolean;
  /** What the live region says; empty when nothing is highlighted. */
  announcement: string;
  onFocusChange: (focus: GridFocus | null) => void;
  onEdit: (focus: GridFocus) => void;
  label?: string;
  className?: string;
  children: React.ReactNode;
}

export function TransactionGridKeyboardRegion({
  rows,
  fields,
  focus,
  inactive = false,
  announcement,
  onFocusChange,
  onEdit,
  label = 'Transaction list',
  className,
  children,
}: TransactionGridKeyboardRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  // the listeners are attached once; they read the current props through a ref kept up to date
  // after each render (the same pattern as useDialog's onClose)
  const latest = useRef({ rows, fields, focus, inactive, onFocusChange, onEdit });
  useEffect(() => {
    latest.current = { rows, fields, focus, inactive, onFocusChange, onEdit };
  });

  // An inline editor is a control inside this region; closing it (Enter saves, Escape cancels)
  // unmounts the input and would leave focus on the page body, where the arrow keys no longer reach
  // the grid. Take focus back — unless the person moved it somewhere else in the meantime.
  const wasInactive = useRef(inactive);
  useEffect(() => {
    const wasEditing = wasInactive.current;
    wasInactive.current = inactive;
    if (!wasEditing || inactive) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    regionRef.current?.focus({ preventScroll: true });
  }, [inactive]);

  useEffect(() => {
    const node = regionRef.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const state = latest.current;
      const target = event.target as HTMLElement | null;
      // A control inside the list keeps its own keys.
      if (target && target !== node && target.closest(NATIVE_CONTROL)) return;
      if (state.inactive) return;
      if (event.key === 'Escape') {
        if (!state.focus) return;
        event.preventDefault();
        state.onFocusChange(null);
        return;
      }
      if (!state.rows.length || !state.focus) {
        // No highlight yet: an arrow key (or Home/End) starts one, so the list is reachable with
        // the keyboard alone. Enter and typing need a cell to act on.
        if (!isGridNavKey(event.key)) return;
        const started = startGridFocus(state.rows, state.fields, event.key === 'End' ? 'end' : 'start');
        if (!started) return;
        event.preventDefault();
        state.onFocusChange(started);
        return;
      }
      if (isGridNavKey(event.key)) {
        event.preventDefault();
        state.onFocusChange(moveGridFocus(state.focus, event.key, state.fields, state.rows));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        state.onEdit(state.focus);
        return;
      }
      // Start typing over a cell to edit it, as before; shortcuts and Tab stay with the browser.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) state.onEdit(state.focus);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest(NATIVE_CONTROL)) return;
      node.focus({ preventScroll: true });
    };

    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('click', onClick);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <div
      ref={regionRef}
      tabIndex={0}
      role="region"
      aria-label={label}
      data-testid="transaction-grid-region"
      className={cn('h-full flex flex-col outline-none', className)}
    >
      {children}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
