import React, { useId, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, passwordProblemCode } from '../../lib/passwordPolicy';
import { fillOnboarding, onboardingText } from '../../lib/i18n/onboardingTranslations';
import { directionOf, useUiLanguage } from '../../lib/i18n/useUiLanguage';
import { FilledText } from '../../components/onboarding/FilledText';

/**
 * After a password-reset link (Y-31): the person is signed in by the link and chooses a new
 * password here, typed twice, under the same rules as sign-up, before the app opens.
 *
 * AI12-N10-01 (#838): this is one of the first screens a new person can reach, so its words and its
 * password refusals follow the selected UI language too. The address it shows is isolated, not
 * translated.
 */
export default function NewPasswordScreen({ email, onSave, onSignOut }: { email: string; onSave: (password: string) => Promise<void>; onSignOut: () => void }) {
  const language = useUiLanguage();
  const t = (key: Parameters<typeof onboardingText>[0]) => onboardingText(key, language);
  const id = useId();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = passwordProblemCode(password, email);
    // English keeps the exact sentences it always showed.
    const problem = code
      ? (language === 'he'
        ? fillOnboarding(onboardingText(`password.${code}` as 'password.tooShort', language), { min: MIN_PASSWORD_LENGTH })
        : onboardingText(`password.${code}` as 'password.tooShort', language))
      : password !== again
        ? t('password.mismatch')
        : null;
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      await onSave(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('password.notSaved'));
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full min-h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm text-neutral-900';
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F9F9F7] p-6">
      <form onSubmit={submit} lang={language} dir={directionOf(language)} className="w-full max-w-sm space-y-4 bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm" aria-labelledby={`${id}-title`}>
        <h1 id={`${id}-title`} className="text-lg font-semibold text-neutral-900 flex items-center gap-2"><KeyRound aria-hidden="true" className="w-5 h-5" /> {t('password.new.heading')}</h1>
        <p className="text-sm text-neutral-600"><FilledText
          template={t('password.new.for')}
          values={{ email: email || t('password.new.yourAccount'), min: MIN_PASSWORD_LENGTH }} /></p>
        <div className="space-y-1">
          <label htmlFor={`${id}-new`} className="block text-xs font-medium text-neutral-700">{t('password.new.field')}</label>
          <input id={`${id}-new`} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={field} dir="ltr" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-again`} className="block text-xs font-medium text-neutral-700">{t('password.new.again')}</label>
          <input id={`${id}-again`} type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} className={field} dir="ltr" />
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="w-full min-h-11 rounded-lg bg-neutral-900 text-white font-semibold disabled:opacity-50">{busy ? t('password.new.saving') : t('password.new.save')}</button>
        <button type="button" onClick={onSignOut} className="w-full min-h-11 rounded-lg text-sm text-neutral-600 hover:underline">{t('password.new.signOut')}</button>
      </form>
    </main>
  );
}
