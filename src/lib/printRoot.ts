/**
 * H-7 / AI #10: the paper gets the document, not the window around it.
 *
 * `src/index.css` prints only what is inside the nearest `[data-print-root]`:
 *
 *   body:has([data-print-root]) * { visibility: hidden; }
 *   body:has([data-print-root]) [data-print-root] * { visibility: visible; }
 *
 * A screen that calls `window.print()` without a root therefore prints the *whole shell* — sidebar,
 * header, pinned-page bar, every banner — because the rule above only hides everything when a root
 * exists. That is what happened on nine surfaces (general ledger, statement, VAT report, delivery
 * notes, period closing, access review, invoice modal, warehouse packing slip, report pack): each
 * had its own print button and, on screen, the print button was hidden as intended, so the defect
 * only appeared on paper.
 *
 * `printElement` marks the element as the print root for the duration of the print, then removes the
 * mark again so the screen keeps its normal `window.print()` behaviour afterwards (and so two print
 * roots never both claim the page). It is deliberately small and synchronous: `beforeprint` fires
 * after the print snapshot starts, so the attribute has to be set before `window.print()` is called.
 */

/** The attribute `src/index.css` uses to pick what is printed. */
export const PRINT_ROOT_ATTRIBUTE = 'data-print-root';

/**
 * Print `element` alone: mark it as the print root, print, then unmark.
 *
 * Returns false (and prints nothing) when there is no element or no `window` — a server render or a
 * test environment without a print dialog. The caller keeps its own fallback.
 */
export function printElement(element: Element | null | undefined): boolean {
  if (!element || typeof window === 'undefined' || typeof window.print !== 'function') return false;
  const hadRoot = element.hasAttribute(PRINT_ROOT_ATTRIBUTE);
  if (!hadRoot) element.setAttribute(PRINT_ROOT_ATTRIBUTE, '');
  try {
    window.print();
  } finally {
    // the browser has copied the page by the time print() returns in every supported engine
    if (!hadRoot) element.removeAttribute(PRINT_ROOT_ATTRIBUTE);
  }
  return true;
}

/**
 * Print the element with the given id (drawn from the same document) alone. Used by the screens
 * whose printable canvas is not the React root the button sits in.
 */
export function printElementById(id: string, doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  return printElement(doc?.getElementById(id));
}

/**
 * Whether some element on the page already declares itself the print root. A screen that prints its
 * own sheet must not add a second root to a preview that already owns the paper (A-271's
 * `[data-print-preview]`), or the two would print on top of each other.
 */
export function hasPrintRoot(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  return Boolean(doc?.querySelector(`[${PRINT_ROOT_ATTRIBUTE}]`));
}
