import { toast } from 'sonner';

/**
 * Copies text and says whether it worked. The browser can refuse the clipboard (no permission, an insecure page,
 * no focus), so a screen confirms a copy only when this answers true, and otherwise tells the reader to copy by
 * hand, as CertificateReminderDrafts does.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies text and confirms with `success`; when the browser refuses, the error toast carries the text itself, so a
 * reader can select it even where the screen does not show it (an invite link, a multi-line selection).
 */
export async function copyWithFeedback(text: string, success: string): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) toast.success(success);
  else toast.error('The browser refused the clipboard. Select the text below and copy it by hand.', { description: text, duration: 30000 });
  return ok;
}
