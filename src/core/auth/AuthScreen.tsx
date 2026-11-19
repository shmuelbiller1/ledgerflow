import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LogIn, ShieldCheck, Mail, UserPlus, KeyRound } from 'lucide-react';
import { microsoftSignInEnabled, passkeysSupported, signInWithMicrosoft } from '../../lib/db/auth';
import { useBillingStore } from '../../modules/billing/BillingService';
import AsyncButton from '../../components/ui/AsyncButton';
import { toast } from 'sonner';
import { MIN_PASSWORD_LENGTH, passwordProblemCode, passwordProblemSentence } from '../../lib/passwordPolicy';
import { fillOnboarding, onboardingText, EXAMPLE_EMAIL } from '../../lib/i18n/onboardingTranslations';
import { directionOf, type UiLanguageTag } from '../../lib/i18n/useUiLanguage';
import { createRetryableLazy } from '../../lib/lazyWithRetry';
import { LazyOverlayBoundary } from '../../components/ui/LazyOverlayBoundary';

import { BRAND_NAME } from '../../config/brand';
const LegalModal = createRetryableLazy(() => import('../../components/legal/LegalModal'));

interface AuthScreenProps {
  onLogin: () => void;
  onEmailLogin: (email: string, pass: string) => Promise<void>;
  onEmailSignup: (email: string, pass: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
  onGuest: () => void;
  /** CC-12: sign in with a passkey; the button shows only where the browser supports passkeys */
  onPasskeyLogin?: () => Promise<void>;
  /** whether to offer "Continue with Microsoft"; by default the build's VITE_MICROSOFT_SIGNIN setting */
  microsoftSignIn?: boolean;
  language: UiLanguageTag;
}

/**
 * Sign-in, registration, guest entry, and password-reset screen with lazy legal policy modal.
 *
 * AI12-N10-01 (#838): the copy, the accessible names and the password errors follow the selected UI
 * language, and the screen sets its own `lang`/`dir` so a Hebrew reader sees a Hebrew, right-to-left
 * form rather than English inside an RTL page. What the person types (their address) and the brand
 * name are not translated. English keeps every word and accessible name it had.
 */
export function AuthScreen({ onLogin, onEmailLogin, onEmailSignup, onPasswordReset, onGuest, onPasskeyLogin, microsoftSignIn = microsoftSignInEnabled(), language }: AuthScreenProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<'terms' | 'privacy'>('terms');

  const registrationAllowed = useBillingStore(state => state.registrationAllowed);
  const maxRegistrationLimit = useBillingStore(state => state.maxRegistrationLimit);
  const totalSystemUsers = useBillingStore(state => state.totalSystemUsers);

  const t = (key: Parameters<typeof onboardingText>[0], fallback: string) => onboardingText(key, language, fallback);

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    try {
      await onLogin();
    } finally {
      setIsSubmitting(false);
    }
  };

  /** true when the browser is on its way to Microsoft; false when it could not start (the person is told why) */
  const handleMicrosoftLogin = async (): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      await signInWithMicrosoft();
      return true;
    } catch (err) {
      const own = err instanceof Error && err.message ? err.message : '';
      toast.error(own || t('auth.error.microsoft', 'Microsoft sign-in could not start. Try again.'));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    // Y-31: the same password rules as a reset
    const weak = isRegistering ? passwordProblemCode(password, email) : null;
    if (weak) {
      // English keeps the exact sentence it always showed; Hebrew says the same thing in Hebrew.
      setPasswordError(language === 'he'
        ? fillOnboarding(onboardingText(`password.${weak}` as 'password.tooShort', language, passwordProblemSentence(weak)), { min: MIN_PASSWORD_LENGTH })
        : passwordProblemSentence(weak));
      return;
    }
    setPasswordError('');
    setIsSubmitting(true);
    try {
      if (isRegistering) {
        await onEmailSignup(email, password);
      } else {
        await onEmailLogin(email, password);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      toast.error(t('auth.error.needEmail', 'Please enter your email address first.'));
      return;
    }
    setIsSubmitting(true);
    try {
      await onPasswordReset(email);
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordRule = onboardingText('auth.passwordRule', language,
    'At least {min} characters; not a common password or your email name.');

  return (
    <main lang={language} dir={directionOf(language)} className="min-h-screen grid lg:grid-cols-2 bg-[#F9F9F7]" aria-label={t('auth.page', 'Authentication Page')}>
      {/* Left visual: 100% offline-first self-contained architectural ledger backdrop */}
      <section className="relative hidden w-full h-full lg:flex flex-col justify-between p-12 bg-[#090D16] text-white overflow-hidden" aria-hidden="true">
        {/* Subtle decorative geometric coordinate grid */}
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{
          backgroundImage: `linear-gradient(#4B6BFB 1px, transparent 1px), linear-gradient(90deg, #4B6BFB 1px, transparent 1px)`,
          backgroundSize: '48px 48px'
        }} />
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#0047AB]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-[#3B82F6]/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-10 h-10 bg-white flex items-center justify-center rounded-xl shadow-lg">
            <ShieldCheck size={20} className="text-[#090D16]" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight text-white">{BRAND_NAME}</span>
        </div>

        <div className="relative z-10 max-w-md my-auto py-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide mb-6">
            {t('auth.badge', 'Multi-Entity & Dimensional Ledger')}
          </div>
          <h1 className="font-display font-black text-4xl leading-[1.15] tracking-tight mb-6 text-white">
            {t('auth.hero.title', 'Continuous accounting with multi-dimensional slicing.')}
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed font-normal">
            {t('auth.hero.body', 'Slice transactions across entities, properties, projects, and departments. Real-time depreciation schedules, deterministic cash forecasting, and audit-ready tax tagging.')}
          </p>
        </div>

        <div className="relative z-10 font-mono text-[11px] font-bold text-white/50 tracking-[0.2em] uppercase">
          {t('auth.hero.footer', 'DIMENSIONAL LEDGER · REAL-TIME ANALYTICS · AUDIT-READY')}
        </div>
      </section>

      {/* Right Form */}
      <section className="flex items-center justify-center p-8 xs:p-12 relative overflow-hidden bg-white lg:bg-[#F9F9F7]" aria-label={isRegistering ? t('auth.section.register', 'Registration Form') : t('auth.section.signin', 'Login Form')}>
        <div className="absolute inset-0 technical-grid opacity-[0.03] lg:hidden" />
        
        <div className="w-full max-w-sm relative z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={isRegistering ? "register" : "signin"}
              initial={{ opacity: 0, x: isRegistering ? 10 : -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRegistering ? -10 : 10 }}
            >
              <header className="lg:hidden flex items-center gap-2.5 mb-8">
                <div className="w-10 h-10 bg-[#0A0A0A] flex items-center justify-center rounded-xl shadow-lg">
                  <ShieldCheck size={20} className="text-white" />
                </div>
                <span className="font-display font-extrabold text-xl text-[#0A0A0A] tracking-tight">{BRAND_NAME}</span>
              </header>
              
              <h2 className="font-display font-extrabold text-4xl tracking-tight text-[#0A0A0A] mb-2">
                {isRegistering ? t('auth.title.register', 'Create Account') : t('auth.title.signin', 'Sign in')}
              </h2>
              <p className="text-[#525252] text-sm font-medium mb-8">
                {isRegistering ? t('auth.subtitle.register', 'Start tracking your finances.') : t('auth.subtitle.signin', 'Access your financial control room.')}
              </p>

              <form onSubmit={handleEmailAction} className="flex flex-col gap-4" aria-label={isRegistering ? t('auth.form.register', 'Sign up with Email') : t('auth.form.signin', 'Sign in with Email')}>
                {isRegistering && !registrationAllowed && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold leading-relaxed mb-2 shadow-sm">
                    <p className="font-bold flex items-center gap-1.5 uppercase text-[10px] tracking-wider text-amber-950">{t('auth.limit.title', '⚠️ Platform limit reached')}</p>
                    <p className="mt-1">{fillOnboarding(
                      t('auth.limit.body', 'New sign-ups are temporarily capped at {limit} users. Currently, {total} users are registered. Please contact support@ledgerflow.app for a custom account creation.'),
                      { limit: maxRegistrationLimit, total: totalSystemUsers })}</p>
                  </div>
                )}

                <div>
                  <label htmlFor="auth-email-input" className="block text-xs font-bold text-[#525252] uppercase tracking-wider mb-2">{t('auth.label.email', 'Email')}</label>
                  <input
                    id="auth-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isRegistering && !registrationAllowed}
                    className="w-full h-12 px-4 rounded-xl border border-[#E5E5E5] focus:border-[#0A0A0A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2 transition-all disabled:opacity-40"
                    placeholder={EXAMPLE_EMAIL}
                    dir="ltr"
                    required
                    aria-label={t('auth.aria.emailAddress', 'Email address')}
                  />
                </div>
                <div>
                  <label htmlFor="auth-password-input" className="block text-xs font-bold text-[#525252] uppercase tracking-wider mb-2">{t('auth.label.password', 'Password')}</label>
                  <input
                    id="auth-password-input"
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                    disabled={isRegistering && !registrationAllowed}
                    className="w-full h-12 px-4 rounded-xl border border-[#E5E5E5] focus:border-[#0A0A0A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2 transition-all disabled:opacity-40"
                    placeholder="••••••••"
                    dir="ltr"
                    required
                    aria-label={t('auth.aria.password', 'Password')}
                    autoComplete={isRegistering ? 'new-password' : 'current-password'}
                    aria-invalid={passwordError ? true : undefined}
                    aria-describedby={passwordError ? 'auth-password-error' : isRegistering ? 'auth-password-rule' : undefined}
                  />
                  {isRegistering && !passwordError && <p id="auth-password-rule" className="mt-1 text-xs text-[#737373]">{fillOnboarding(passwordRule, { min: MIN_PASSWORD_LENGTH })}</p>}
                  {passwordError && <p id="auth-password-error" role="alert" className="mt-1 text-xs text-red-700">{passwordError}</p>}
                </div>
                
                <AsyncButton 
                  type="submit"
                  disabled={isSubmitting || (isRegistering && !registrationAllowed)}
                  loading={isSubmitting}
                  loadingText={isRegistering ? t('auth.loading.register', 'Signing up...') : t('auth.loading.signin', 'Signing in...')}
                  className="w-full h-12 mt-2 bg-[#0A0A0A] hover:bg-[#1A1A1A] text-white rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-3 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2"
                  aria-label={isRegistering ? t('auth.aria.submitRegister', 'Submit Registration') : t('auth.aria.submitLogin', 'Submit Login')}
                >
                  {isRegistering ? <UserPlus size={18} aria-hidden="true" /> : <Mail size={18} aria-hidden="true" />}
                  {isRegistering ? t('auth.submit.register', 'Sign up with Email') : t('auth.submit.signin', 'Sign in with Email')}
                </AsyncButton>

                {!isRegistering && (
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={isSubmitting}
                    className="mt-4 text-xs font-semibold text-[#737373] hover:text-[#0A0A0A] transition-colors focus:outline-none"
                  >
                    {t('auth.forgot', 'Forgot your password?')}
                  </button>
                )}
              </form>

              <div className="relative my-6 text-center" aria-hidden="true">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#E5E5E5]"></div></div>
                <div className="relative"><span className="bg-white lg:bg-[#F9F9F7] px-4 text-xs font-bold text-[#A3A3A3] uppercase tracking-widest">{t('auth.or', 'Or')}</span></div>
              </div>

              <div className="flex flex-col gap-3">
                <AsyncButton 
                  onClick={handleGoogleLogin}
                  type="button"
                  loadingText={t('auth.connecting', 'Connecting...')}
                  className="h-12 bg-white border border-[#E5E5E5] hover:border-[#0047AB] text-[#0A0A0A] rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-3 transition-all shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0047AB] focus-visible:ring-offset-2"
                  aria-label={t('auth.aria.google', 'Continue with Google Authentication')}
                >
                  <LogIn size={18} className="text-[#0047AB]" aria-hidden="true" />
                  {t('auth.google', 'Continue with Google')}
                </AsyncButton>

                {microsoftSignIn && (
                  <AsyncButton
                    onClick={handleMicrosoftLogin}
                    type="button"
                    loadingText={t('auth.connecting', 'Connecting...')}
                    className="h-12 bg-white border border-[#E5E5E5] hover:border-[#0047AB] text-[#0A0A0A] rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-3 transition-all shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0047AB] focus-visible:ring-offset-2"
                  >
                    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" /><rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" /></svg>
                    {t('auth.microsoft', 'Continue with Microsoft')}
                  </AsyncButton>
                )}

                {onPasskeyLogin && !isRegistering && passkeysSupported() && (
                  <AsyncButton
                    onClick={onPasskeyLogin}
                    type="button"
                    loadingText={t('auth.passkey.waiting', 'Waiting for your passkey...')}
                    className="h-12 bg-white border border-[#E5E5E5] hover:border-[#0047AB] text-[#0A0A0A] rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-3 transition-all shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0047AB] focus-visible:ring-offset-2"
                  >
                    <KeyRound size={18} className="text-[#0047AB]" aria-hidden="true" />
                    {t('auth.passkey', 'Sign in with a passkey')}
                  </AsyncButton>
                )}

                <button 
                  onClick={onGuest}
                  type="button"
                  disabled={isSubmitting}
                  className="h-12 bg-transparent text-[#525252] hover:text-[#0A0A0A] rounded-xl font-bold text-sm tracking-wide flex items-center justify-center transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2"
                  aria-label={t('auth.aria.guest', 'Continue as Guest')}
                >
                  {t('auth.guest', 'Continue as Guest')}
                </button>
                {/* EU-I3: write one invoice without an account */}
                <a href="/make-invoice" className="h-11 text-[#525252] hover:text-[#0A0A0A] rounded-xl font-semibold text-sm flex items-center justify-center underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2">
                  {t('auth.freeInvoice', 'Just need an invoice? Make one free')}
                </a>
              </div>

              <p className="mt-8 text-center text-sm font-medium text-[#525252]">
                {isRegistering ? t('auth.haveAccount', 'Already have an account?') : t('auth.noAccount', "Don't have an account?")}{' '}
                <button 
                  type="button"
                  onClick={() => setIsRegistering(!isRegistering)} 
                  className="text-[#0A0A0A] font-bold hover:text-[#0047AB] transition-colors underline decoration-2 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2 rounded-sm"
                  aria-label={isRegistering ? t('auth.aria.switchSignin', 'Switch to Sign in') : t('auth.aria.switchSignup', 'Switch to Sign up')}
                >
                  {isRegistering ? t('auth.switch.signin', 'Sign in') : t('auth.switch.signup', 'Sign up')}
                </button>
              </p>

              <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-center gap-4 text-xs text-[#737373]">
                <button
                  type="button"
                  onClick={() => { setLegalTab('terms'); setLegalModalOpen(true); }}
                  className="hover:text-[#0A0A0A] underline underline-offset-2 transition-colors"
                >
                  {t('auth.terms', 'Terms of Service')}
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => { setLegalTab('privacy'); setLegalModalOpen(true); }}
                  className="hover:text-[#0A0A0A] underline underline-offset-2 transition-colors"
                >
                  {t('auth.privacy', 'Privacy Policy')}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {legalModalOpen && (
        <LazyOverlayBoundary
          label={t('auth.legalLabel', 'Legal policy')}
          onDismiss={() => setLegalModalOpen(false)}
          onRetry={() => setLegalModalOpen(true)}
        >
          <LegalModal
            isOpen={legalModalOpen}
            onClose={() => setLegalModalOpen(false)}
            initialTab={legalTab}
          />
        </LazyOverlayBoundary>
      )}
    </main>
  );
}
