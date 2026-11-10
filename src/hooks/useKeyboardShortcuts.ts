import { useEffect, useRef } from 'react';

interface ShortcutMap {
  [key: string]: () => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  const shortcutsRef = useRef(shortcuts);
  
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    let pending: { key: string; time: number } | null = null;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs/textareas
      const target = event.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.tagName === 'SELECT' ||
         target.isContentEditable)
      ) {
        // Allow escape key to still work even in inputs
        if (event.key !== 'Escape') {
          pending = null;
          return;
        }
      }

      const isMod = event.metaKey || event.ctrlKey;
      const isAlt = event.altKey;
      const isShift = event.shiftKey;
      // With Alt, a Mac types a symbol (Alt+1 is "¡", Alt+P is "π"): use the key's place instead
      const physical = /^(?:Digit|Key)([0-9A-Z])$/.exec(event.code || '')?.[1];
      const key = (isAlt && physical ? physical : event.key).toLowerCase();

      // We normalize the key string format
      let shortcutKey = '';
      if (isMod) shortcutKey += 'mod+';
      if (isAlt) shortcutKey += 'alt+';
      if (isShift && key !== '?') shortcutKey += 'shift+'; // Special case for '?'
      shortcutKey += key;

      // Sequential creation keys avoid browser DevTools and AltGr combinations. A modal or
      // typing target always owns its letters; an incomplete sequence expires after 1.2 seconds.
      const previous = pending;
      pending = null;
      if (!isMod && !isAlt && !isShift && !event.repeat && !document.querySelector('[aria-modal="true"]')) {
        const sequence = previous && event.timeStamp - previous.time < 1200 ? `${previous.key} ${key}` : '';
        if (sequence && shortcutsRef.current[sequence]) {
          event.preventDefault();
          event.stopPropagation();
          shortcutsRef.current[sequence]();
          return;
        }
        if (Object.keys(shortcutsRef.current).some(shortcut => shortcut.startsWith(`${key} `))) {
          pending = { key, time: event.timeStamp };
          event.preventDefault();
          return;
        }
      }

      // Handle raw key mapping if defined directly (e.g., '?')
      if (shortcutsRef.current[key] && !isMod && !isAlt && !isShift) {
         event.preventDefault();
         event.stopPropagation();
         shortcutsRef.current[key]();
         return;
      }

      if (shortcutsRef.current[shortcutKey]) {
        event.preventDefault();
        event.stopPropagation();
        shortcutsRef.current[shortcutKey]();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);
}
