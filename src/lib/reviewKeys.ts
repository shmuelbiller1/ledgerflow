/**
 * EU-C2: review from the keyboard. On a focused review row, J or ↓ moves to the next row, K or ↑ to the one before,
 * A or Enter accepts it. Keys typed into a field or with a modifier are left alone.
 */
import type { KeyboardEvent } from 'react';

export function reviewKeys(e: KeyboardEvent<HTMLElement>, accept: () => void): void {
  if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  const rows = [...document.querySelectorAll<HTMLElement>('[data-review-row]')];
  const at = rows.indexOf(e.currentTarget);
  if (key === 'j' || key === 'arrowdown') { e.preventDefault(); rows[Math.min(at + 1, rows.length - 1)]?.focus(); }
  else if (key === 'k' || key === 'arrowup') { e.preventDefault(); rows[Math.max(at - 1, 0)]?.focus(); }
  else if (key === 'a' || key === 'enter') {
    e.preventDefault();
    // focus moves on, so the next one is ready to accept
    (rows[at + 1] || rows[at - 1])?.focus();
    accept();
  }
}
