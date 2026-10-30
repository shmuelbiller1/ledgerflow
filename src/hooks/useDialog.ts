import { useEffect, useId, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), textarea:not([disabled])';

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

/**
 * The open dialogs, last one topmost. Escape is handled on the dialog node itself (below), which
 * needs the event to bubble through it — true while focus is inside the dialog. Focus can drift
 * out without the reader doing anything: the control that held focus unmounts or disables (a Save
 * button after its save lands), and the browser drops focus to the body. A modal must still answer
 * Escape then, so each open dialog also listens at the document in the capture phase and closes
 * only when it is the topmost one and the event did not start inside it (an Escape that starts
 * inside keeps the existing path, where a field that handles Escape itself still wins). This is
 * the mechanism behind the load-only Escape flake of issue #146.
 */
interface OpenDialog { node: HTMLElement; seq: number }
const openDialogs: OpenDialog[] = [];
let dialogSeq = 0;

/**
 * The topmost open dialog: the one with no other open dialog inside it, and among separate ones
 * (portals, siblings) the one that opened last. DOM depth decides first because a nested dialog's
 * effect runs before its parent's, so registration order alone would name the parent topmost.
 */
function topmostDialog(): OpenDialog | undefined {
  let top: OpenDialog | undefined;
  for (const entry of openDialogs) {
    if (openDialogs.some((other) => other !== entry && entry.node.contains(other.node))) continue;
    if (!top || entry.seq > top.seq) top = entry;
  }
  return top;
}

/**
 * What a dialog needs to be usable with a keyboard and a screen reader (E-08…E-20): it is announced
 * as a dialog with its title, focus moves into it (the first field, else the first control), Tab
 * stays inside, Escape closes it, and focus goes back where it was when it closes.
 *
 *   const { dialogProps, titleId } = useDialog(onClose, isOpen);
 *   <div {...dialogProps} className="…"> <h2 id={titleId}>New invoice</h2> …
 *
 * `onClose` may ask first (unsaved changes); it is called as it is at the time of the key press.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void, open = true) {
  const ref = useRef<T>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);

    if (!node.contains(document.activeElement)) {
      const field = Array.from(node.querySelectorAll<HTMLElement>(FIELD)).find(visible);
      (field || focusables()[0] || node).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // an inner dialog closes alone
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKeyDown);

    // Escape with focus outside the dialog (drifted focus, see the note above): the node's own
    // listener never sees that event, so the topmost open dialog answers it here instead.
    const entry: OpenDialog = { node, seq: ++dialogSeq };
    openDialogs.push(entry);
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (topmostDialog() !== entry) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onDocumentKeyDown, true);

    return () => {
      node.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      const at = openDialogs.indexOf(entry);
      if (at >= 0) openDialogs.splice(at, 1);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open]);

  return {
    titleId,
    dialogProps: { ref, role: 'dialog' as const, 'aria-modal': true as const, 'aria-labelledby': titleId, tabIndex: -1 },
  };
}
