import { maskCardNumbers } from '../../lib/cardNumberMask';

export const PAGE_TEXT_LIMIT = 600;
const EXCLUDED = 'input, textarea, select, option, [contenteditable]:not([contenteditable="false"]), [hidden], [inert], [aria-hidden="true"], [data-assistant-private], [data-assistant-exclude], [role="dialog"], script, style';

/** Best-effort rendered page text only. Never read form values; the person must review it before sending. */
export function capturePageText(root: HTMLElement, selection?: Range): string {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let size = 0;
  let visited = 0;
  let node: Node | null;
  while ((node = walk.nextNode()) && visited++ < 5000 && size < PAGE_TEXT_LIMIT) {
    if (selection && !selection.intersectsNode(node)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(EXCLUDED) || !parent.getClientRects().length) continue;
    let visible = true;
    for (let element: HTMLElement | null = parent; element && root.contains(element); element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') { visible = false; break; }
    }
    if (!visible) continue;
    const raw = node.textContent || '';
    const start = selection?.startContainer === node ? selection.startOffset : 0;
    const end = selection?.endContainer === node ? selection.endOffset : raw.length;
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
