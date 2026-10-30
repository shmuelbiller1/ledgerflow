import { toast } from 'sonner';

/** The pre-Clipboard-API copy, through a hidden text field: it often still works where writeText is refused. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Copies text and says whether it worked. The browser can refuse the clipboard (no permission, an insecure page,
 * no focus), so a screen confirms a copy only when this answers true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused: fall through to the older way
  }
  return legacyCopy(text);
}

/**
 * Copies text and confirms with `success`, or says the copy failed. The text itself never goes into a toast: toasts
 * outlive the screen (and, in Sonner, a sign-out), so a key or link there could reach the next user (CodeRabbit on #453).
 */
export async function copyWithFeedback(text: string, success: string, failure = 'The browser blocked copying. Try again, or use another browser.'): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) toast.success(success);
  else toast.error(failure);
  return ok;
}
