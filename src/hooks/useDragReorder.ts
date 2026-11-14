import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
import { moveButton, nearestDropTarget, type ButtonBox, type DropPosition, type ReorderAxis } from '../lib/buttonOrder';

/**
 * Rearranging a list of buttons by dragging them, or from the keyboard.
 *
 * - **Mouse / pen:** press a button, move it more than a few pixels and it follows the pointer; a
 *   line shows where it will land; release to drop. A press that does not move stays an ordinary
 *   click, so every button keeps doing exactly what it did.
 * - **Touch:** press and hold, then drag (a plain swipe still scrolls the list).
 * - **Keyboard:** focus a button, then Alt+↑ / Alt+↓ (Alt+Shift+← / → as well in lists that run
 *   across the page). Esc calls off a drag in progress.
 *
 * While a button is being dragged nothing is rendered by React: the moving button and the drop
 * line are plain DOM attributes and styles, removed when the drag ends. Only the drop itself
 * calls `onMove`, so a busy screen (charts, long tables) is not redrawn on every pointer move.
 *
 * The hook only moves things on screen and reports what the person asked for; what the order
 * means and where it is saved belongs to the caller (`useButtonOrder`).
 */

export interface DragReorderOptions {
  /** The buttons on screen now, in the order they are shown. */
  ids: readonly string[];
  /** `vertical` for a list that runs down the page; `horizontal` for rows, wrapping rows and grids. */
  axis?: ReorderAxis;
  /** The name read out when a button moves ("Bank moved before Sales"). */
  labelFor: (id: string) => string;
  /** A button was dropped just before/after another one. Return false when nothing changed. */
  onMove: (id: string, targetId: string, position: DropPosition) => boolean | void;
  /** A button was nudged one place earlier (-1) or later (+1). Return false when nothing changed. */
  onStep: (id: string, delta: -1 | 1) => boolean | void;
  /** Turn rearranging off (a read-only list); the buttons behave as if the hook were not there. */
  disabled?: boolean;
}

export interface ReorderItemProps {
  'data-reorder-item': string;
  'data-reorder-group': string;
  'data-reorder-axis': ReorderAxis;
  'aria-keyshortcuts': string;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
}

export interface DragReorder {
  /** Spread on each button: `<button {...reorder.itemProps(id)} …>`. Empty when disabled. */
  itemProps: (id: string) => ReorderItemProps | Record<string, never>;
  /** What just happened, for a polite live region (`ButtonOrderNote` renders it). */
  status: string;
}

/** A mouse must travel this far before a press becomes a drag (a shaky click stays a click). */
const DRAG_START_PX = 6;
/** A finger that moves this far before the hold completes is scrolling, not dragging. */
const TOUCH_SLOP_PX = 10;
const TOUCH_HOLD_MS = 350;
/** Near this close to the edge of a scrolling list, the list scrolls under the dragged button. */
const EDGE_SCROLL_PX = 44;
const EDGE_SCROLL_STEP = 14;

interface Session {
  id: string;
  element: HTMLElement;
  pointerId: number;
  touch: boolean;
  /** touch only: the hold completed, so the next move is a drag */
  armed: boolean;
  dragging: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  scroller: HTMLElement | null;
  scrollLeft: number;
  scrollTop: number;
  target: { element: HTMLElement; id: string; position: DropPosition } | null;
  holdTimer: number | null;
  frame: number | null;
  restore: { translate: string; transition: string } | null;
  teardown: () => void;
}

/** The nearest ancestor that scrolls along the list's direction, if any. */
function scrollParent(element: HTMLElement, axis: ReorderAxis): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflow = axis === 'vertical' ? style.overflowY : style.overflowX;
    const room = axis === 'vertical' ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
    if ((overflow === 'auto' || overflow === 'scroll') && room > 1) return node;
  }
  return null;
}

/** A press on a control nested inside the button (a star on a card) belongs to that control. */
function pressedNestedControl(target: EventTarget | null, item: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('button, a[href], input, select, textarea, summary, [role="button"], [data-reorder-ignore]');
  return Boolean(control && control !== item && item.contains(control));
}

export function useDragReorder(options: DragReorderOptions): DragReorder {
  const group = useId();
  const axis: ReorderAxis = options.axis ?? 'vertical';
  const disabled = Boolean(options.disabled);
  const [status, setStatus] = useState('');
  // handlers attached to the window during a drag read the latest props from here
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const session = useRef<Session | null>(null);
  const focusFrame = useRef<number | null>(null);
  const clickGuard = useRef<(() => void) | null>(null);

  const items = useCallback((): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-reorder-item]')).filter(el => el.dataset.reorderGroup === group),
  [group]);

  const clearTarget = useCallback((current: Session) => {
    current.target?.element.removeAttribute('data-reorder-drop');
    current.target = null;
  }, []);

  /** End the press: put every style back, and (when it was a drag) keep the release from clicking. */
  const finish = useCallback((commit: boolean, pointerStillDown = false) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    current.teardown();
    if (current.holdTimer !== null) window.clearTimeout(current.holdTimer);
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    const target = current.target;
    clearTarget(current);
    if (!current.dragging) return;
    const { element } = current;
    element.removeAttribute('data-reorder-dragging');
    document.body.removeAttribute('data-reordering');
    if (current.restore) {
      element.style.translate = current.restore.translate;
      element.style.transition = current.restore.transition;
    }
    try { element.releasePointerCapture?.(current.pointerId); } catch { /* optional: the capture already ended with the pointer */ }
    // the release of a drag must not also press the button (or whatever is under the pointer)
    clickGuard.current?.();
    const swallow = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); };
    window.addEventListener('click', swallow, true);
    // a drag called off while the button is still held (Esc) keeps swallowing until that press ends,
    // so letting go over the original button does not press it
    let timer = pointerStillDown ? null as number | null : window.setTimeout(() => clickGuard.current?.(), 0);
    const pointerId = current.pointerId;
    const released = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => clickGuard.current?.(), 0);
    };
    if (pointerStillDown) {
      window.addEventListener('pointerup', released, true);
      window.addEventListener('pointercancel', released, true);
    }
    clickGuard.current = () => {
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('pointerup', released, true);
      window.removeEventListener('pointercancel', released, true);
      if (timer !== null) window.clearTimeout(timer);
      clickGuard.current = null;
    };
    if (!commit || !target) return;
    const { labelFor, onMove } = latest.current;
    if (onMove(current.id, target.id, target.position) === false) return;
    setStatus(`${labelFor(current.id)} moved ${target.position} ${labelFor(target.id)}.`);
  }, [clearTarget]);

  /** Move the dragged button to the pointer and mark where it would land. */
  const track = useCallback((current: Session) => {
    const { element, scroller } = current;
    const scrolledX = scroller ? scroller.scrollLeft - current.scrollLeft : 0;
    const scrolledY = scroller ? scroller.scrollTop - current.scrollTop : 0;
    element.style.translate = `${current.x - current.startX + scrolledX}px ${current.y - current.startY + scrolledY}px`;
    const boxes: ButtonBox[] = [];
    const byId = new Map<string, HTMLElement>();
    for (const item of items()) {
      const id = item.dataset.reorderItem;
      if (!id || item === element) continue;
      const rect = item.getBoundingClientRect();
      boxes.push({ id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      byId.set(id, item);
    }
    const found = nearestDropTarget(current.x, current.y, boxes, axis);
    const ids = latest.current.ids;
    // a drop that would leave the button where it already is shows no line
    const lands = found && moveButton(ids, current.id, found.id, found.position) !== ids ? found : null;
    const targetElement = lands ? byId.get(lands.id) : undefined;
    if (!lands || !targetElement) { clearTarget(current); return; }
    if (current.target?.element !== targetElement || current.target.position !== lands.position) {
      clearTarget(current);
      targetElement.setAttribute('data-reorder-drop', lands.position);
      current.target = { element: targetElement, id: lands.id, position: lands.position };
    }
  }, [axis, clearTarget, items]);

  /** While the pointer rests near the edge of a scrolling list, scroll the list under it. */
  const edgeScroll = useCallback(() => {
    const tick = () => {
      const current = session.current;
      if (!current || !current.dragging) return;
      const { scroller } = current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const before = axis === 'vertical' ? scroller.scrollTop : scroller.scrollLeft;
        const near = axis === 'vertical' ? current.y - rect.top : current.x - rect.left;
        const far = axis === 'vertical' ? rect.bottom - current.y : rect.right - current.x;
        const step = near < EDGE_SCROLL_PX ? -EDGE_SCROLL_STEP : far < EDGE_SCROLL_PX ? EDGE_SCROLL_STEP : 0;
        if (step !== 0) {
          if (axis === 'vertical') scroller.scrollTop += step; else scroller.scrollLeft += step;
          const after = axis === 'vertical' ? scroller.scrollTop : scroller.scrollLeft;
          if (after !== before) track(current);
        }
      }
      current.frame = requestAnimationFrame(tick);
    };
    tick();
  }, [axis, track]);

  const beginDrag = useCallback((current: Session) => {
    const { element } = current;
    current.dragging = true;
    current.restore = { translate: element.style.translate, transition: element.style.transition };
    current.scroller = scrollParent(element, axis);
    current.scrollLeft = current.scroller?.scrollLeft ?? 0;
    current.scrollTop = current.scroller?.scrollTop ?? 0;
    // a button with `transition-all` would trail behind the pointer
    element.style.transition = 'none';
    element.setAttribute('data-reorder-dragging', 'true');
    document.body.setAttribute('data-reordering', axis);
    try { element.setPointerCapture?.(current.pointerId); } catch { /* optional: the drag still follows the window's pointer events */ }
    current.frame = requestAnimationFrame(edgeScroll);
  }, [axis, edgeScroll]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>, id: string) => {
    if (session.current || event.button !== 0 || !event.isPrimary) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const ids = latest.current.ids;
    if (ids.length < 2 || !ids.includes(id)) return;
    const element = event.currentTarget;
    if (pressedNestedControl(event.target, element)) return;
    const touch = event.pointerType === 'touch';

    const onMove = (move: PointerEvent) => {
      const current = session.current;
      if (!current || move.pointerId !== current.pointerId) return;
      current.x = move.clientX;
      current.y = move.clientY;
      if (!current.dragging) {
        const distance = Math.hypot(current.x - current.startX, current.y - current.startY);
        if (current.touch && !current.armed) {
          if (distance > TOUCH_SLOP_PX) finish(false); // a swipe: let the list scroll
          return;
        }
        if (!current.touch && distance < DRAG_START_PX) return;
        beginDrag(current);
      }
      move.preventDefault();
      track(current);
    };
    const onUp = (up: PointerEvent) => { if (up.pointerId === session.current?.pointerId) finish(true); };
    const onCancel = (cancel: PointerEvent) => { if (cancel.pointerId === session.current?.pointerId) finish(false); };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !session.current?.dragging) return;
      // Esc calls off the drag only; it must not also close the dialog the list sits in
      key.preventDefault();
      key.stopPropagation();
      finish(false, true);
    };
    const onBlur = () => finish(false);
    // once the hold has armed a touch drag, the finger moves the button, not the page
    const onTouchMove = (move: TouchEvent) => { if (session.current?.armed && move.cancelable) move.preventDefault(); };
    const onContextMenu = (menu: Event) => { if (session.current?.touch) menu.preventDefault(); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('contextmenu', onContextMenu);

    const current: Session = {
      id, element, pointerId: event.pointerId, touch, armed: false, dragging: false,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      scroller: null, scrollLeft: 0, scrollTop: 0, target: null, holdTimer: null, frame: null, restore: null,
      teardown: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('contextmenu', onContextMenu);
      },
    };
    if (touch) {
      current.holdTimer = window.setTimeout(() => {
        current.holdTimer = null;
        if (session.current !== current) return;
        current.armed = true;
        beginDrag(current);
        track(current);
      }, TOUCH_HOLD_MS);
    }
    session.current = current;
  }, [beginDrag, finish, track]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>, id: string) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    // only the button itself, never a field or control nested inside it
    if (event.target !== event.currentTarget) return;
    let delta: -1 | 1 | 0 = 0;
    if (!event.shiftKey && event.key === 'ArrowUp') delta = -1;
    else if (!event.shiftKey && event.key === 'ArrowDown') delta = 1;
    else if (axis === 'horizontal' && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
      delta = (event.key === 'ArrowLeft') !== rtl ? -1 : 1;
    }
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const { ids, labelFor, onStep } = latest.current;
    const index = ids.indexOf(id);
    if (index < 0) return;
    const label = labelFor(id);
    if (index + delta < 0 || index + delta >= ids.length || onStep(id, delta) === false) {
      setStatus(`${label} is already ${delta === -1 ? 'first' : 'last'}.`);
      return;
    }
    setStatus(`${label} moved ${delta === -1 ? 'earlier' : 'later'}: now ${index + delta + 1} of ${ids.length}.`);
    // the button keeps the keyboard focus in its new place, so the next press moves it again
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const moved = items().find(item => item.dataset.reorderItem === id);
      if (moved && document.activeElement !== moved) moved.focus();
    });
  }, [axis, items]);

  // leaving the screen in the middle of a drag puts everything back
  useEffect(() => () => {
    finish(false);
    clickGuard.current?.();
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, [finish]);

  const itemProps = useCallback((id: string): ReorderItemProps | Record<string, never> => {
    if (disabled) return {};
    return {
      'data-reorder-item': id,
      'data-reorder-group': group,
      'data-reorder-axis': axis,
      'aria-keyshortcuts': axis === 'horizontal' ? 'Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowLeft Alt+Shift+ArrowRight' : 'Alt+ArrowUp Alt+ArrowDown',
      onPointerDown: event => onPointerDown(event, id),
      onKeyDown: event => onKeyDown(event, id),
      // the browser's own drag (of a link or an image inside the button) would fight this one
      onDragStart: event => event.preventDefault(),
    };
  }, [axis, disabled, group, onKeyDown, onPointerDown]);

  return { itemProps, status };
}
