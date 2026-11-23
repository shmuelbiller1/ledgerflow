import { maskCardNumbers } from '../../lib/cardNumberMask';

export const PAGE_TEXT_LIMIT = 600;
const EXCLUDED = 'input, textarea, select, option, [contenteditable]:not([contenteditable="false"]), [hidden], [inert], [aria-hidden="true"], [data-assistant-private], [data-assistant-exclude], [role="dialog"], script, style';

/** Best-effort rendered page text only. Never read form values; the person must review it before sending. */
export function capturePageText(root: HTMLElement, selection?: Range): string {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let size = 0;
  let visited = 0;
  // Start at the selection, not the top of a potentially huge ledger table.
  let node: Node | null;
  if (selection) {
    const start = selection.startContainer;
    if (start.nodeType === Node.TEXT_NODE) node = start;
    else {
      node = start.childNodes[selection.startOffset] || null;
      if (!node) {
        let cursor: Node | null = start;
        while (cursor && cursor !== root && !cursor.nextSibling) cursor = cursor.parentNode;
        node = cursor && cursor !== root ? cursor.nextSibling : null;
      }
    }
    if (!node || !root.contains(node)) return '';
    walk.currentNode = node;
    if (node.nodeType !== Node.TEXT_NODE) node = walk.nextNode();
  } else node = walk.nextNode();
  while (node && visited++ < 5000 && size < PAGE_TEXT_LIMIT) {
    const current = node;
    node = walk.nextNode();
    if (selection && !selection.intersectsNode(current)) continue;
    const parent = current.parentElement;
    if (!parent || parent.closest(EXCLUDED) || !parent.getClientRects().length) continue;
    let visible = true;
    for (let element: HTMLElement | null = parent; element && root.contains(element); element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') { visible = false; break; }
    }
    if (!visible) continue;
    const raw = current.textContent || '';
    const start = selection?.startContainer === current ? selection.startOffset : 0;
    const end = selection?.endContainer === current ? selection.endOffset : raw.length;
    const text = raw.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    parts.push(text);
    size += text.length + 1;
  }
  return maskCardNumbers(parts.join(' ')).slice(0, PAGE_TEXT_LIMIT);
}

/** A selection is usable only when both ends belong to the page, never the assistant or other chrome. */
export function captureSelectedPageText(root: HTMLElement): string {
  const selected = window.getSelection();
  if (!selected || selected.rangeCount === 0 || selected.isCollapsed) return '';
  const range = selected.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return '';
  return capturePageText(root, range);
}
