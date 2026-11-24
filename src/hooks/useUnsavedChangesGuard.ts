import { useEffect } from 'react';

/**
 * F-9 / P2-63: while a form has unsaved changes, leaving the page asks first.
 *
 * A form can intercept its own Close button and its backdrop, but not the browser's ways out —
 * refresh, the back gesture, closing the tab. Those go through `beforeunload`, which is the only
 * place they can be turned into a question. The in-dialog confirm stays with the form
 * (`safeConfirm`), because there it can offer "Keep editing" instead of a generic prompt.
 *
 * `message` is stored on `returnValue` for the browsers that still read it; the visible prompt is
 * the browser's own, so the words are never custom-painted here.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string = 'You have unsaved changes. Leave anyway?'): void {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    const handler = (event: BeforeUnloadEvent) => {
      // preventDefault is what makes the browser show its leave-site prompt; returnValue is the
      // older contract some browsers still require. Both are set, neither paints a custom dialog.
      event.preventDefault();
      event.returnValue = message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, message]);
}
