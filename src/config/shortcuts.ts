/**
 * Keyboard shortcuts (I-10): one list for the keys App.tsx listens to and the "Keyboard shortcuts"
 * card (press ?, or "Keyboard shortcuts" in the command palette). Keys are written as
 * useKeyboardShortcuts reads them: `mod` is ⌘ on a Mac and Ctrl elsewhere.
 *
 * Keys the browser or the system keeps are not used: ⌘Q quits the browser on a Mac, and ⌘F / ⌘P
 * are the browser's find and print.
 */
export type ShortcutId =
  | 'newInvoice' | 'newBill' | 'newJournalEntry'
  | 'palette' | 'quickEntry' | 'overview' | 'transactions' | 'ledger' | 'reports' | 'export'
  | 'import' | 'theme' | 'focus' | 'diagnostics' | 'architecture' | 'shortcuts' | 'pinPage';

export interface Shortcut {
  id: ShortcutId;
  /** the first one is shown; the others work too */
  keys: string[];
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'newInvoice', keys: ['n i'], label: 'New invoice' },
  { id: 'newBill', keys: ['n b'], label: 'New bill' },
  { id: 'newJournalEntry', keys: ['n j'], label: 'New journal entry' },
  { id: 'palette', keys: ['mod+k'], label: 'Command palette (search and go anywhere)' },
  { id: 'quickEntry', keys: ['mod+shift+e'], label: 'Quick entry' },
  { id: 'overview', keys: ['mod+1'], label: 'Overview' },
  { id: 'transactions', keys: ['mod+2'], label: 'Transactions' },
  { id: 'ledger', keys: ['mod+3'], label: 'Ledger & Journal' },
  { id: 'reports', keys: ['mod+4'], label: 'Reports' },
  { id: 'export', keys: ['mod+e'], label: 'Export transactions' },
  { id: 'import', keys: ['mod+i'], label: 'Import a bank statement' },
  { id: 'theme', keys: ['mod+shift+d'], label: 'Light / dark theme' },
  { id: 'focus', keys: ['mod+shift+f'], label: 'Focus mode' },
  { id: 'diagnostics', keys: ['mod+shift+k'], label: 'Diagnostic console' },
  { id: 'architecture', keys: ['mod+shift+a'], label: 'System architecture' },
  { id: 'shortcuts', keys: ['?', 'mod+/'], label: 'Keyboard shortcuts' },
  { id: 'pinPage', keys: ['alt+p'], label: 'Pin or unpin this page (pinned pages: Alt+1 … Alt+9)' },
];

/** True on a Mac (⌘, ⇧ labels); Ctrl / Shift elsewhere. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
}

/** "mod+shift+e" → "⌘ ⇧ E" on a Mac, "Ctrl + Shift + E" elsewhere. */
export function shortcutLabel(keys: string, mac: boolean): string {
  if (keys.includes(' ')) return keys.split(' ').map(key => shortcutLabel(key, mac)).join(' then ');
  const parts = keys.split('+').map(part => {
    if (part === 'mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'shift') return mac ? '⇧' : 'Shift';
    if (part === 'alt') return mac ? '⌥' : 'Alt';
    return part.length === 1 ? part.toUpperCase() : part;
  });
  return parts.join(mac ? ' ' : ' + ');
}

/** The key map useKeyboardShortcuts takes: every key of every shortcut → its action. */
export function shortcutKeyMap(actions: Record<ShortcutId, () => void>): Record<string, () => void> {
  const map: Record<string, () => void> = {};
  for (const s of SHORTCUTS) for (const key of s.keys) map[key] = actions[s.id];
  return map;
}
