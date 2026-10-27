/**
 * The keyboard-shortcut help is a dialog (`ShortcutOverlay`, z-[100]) of its own. Opened while
 * another dialog is up — the Saved Views manager is z-[200] — it would sit *behind* that dialog
 * while taking the keyboard, leaving the person typing into something they cannot see. So `?`
 * opens it only when no other dialog is showing; Escape still closes it.
 */
export function canOpenShortcutHelp({ isOpen, modalOpen }: { isOpen: boolean; modalOpen: boolean }): boolean {
  // while the help itself is open, `?` keeps toggling it shut, as before
  return isOpen || !modalOpen;
}
