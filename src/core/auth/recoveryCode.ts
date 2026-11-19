import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';

/**
 * Uses a recovery code at the code step of sign-in (L-85): the password-only session may call this
 * one route. When it works the authenticator is gone, so the page reloads and signs in normally.
 * Resolves with what went wrong, or '' when it worked.
 */
export async function redeemRecoveryCode(code: string): Promise<string> {
  try {
    await runCommand({ path: '/api/v1/account/recovery-codes/use', method: 'POST', body: { code } });
    window.location.reload();
    return '';
  } catch (err) {
    // a refused code is an ordinary answer to this screen, so it returns the server's sentence instead of throwing
    return commandErrorMessage(err, uiLanguageNow()) || 'That recovery code could not be checked';
  }
}
