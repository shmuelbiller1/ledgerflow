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
