import TestEnvironmentBanner from './components/support/TestEnvironmentBanner';
import { useState, useEffect, useMemo, useCallback, useRef, useTransition, lazy, Suspense } from 'react';
import { usePerformanceTrace } from './hooks/usePerformanceTrace';
import { auth } from './firebase';
import { onAuthStateChanged, onSecondFactorRequired, onPasswordRecovery, setNewPassword, verifySecondFactor, signOut, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from './lib/db/auth';
import { Toaster, toast } from 'sonner';
import { motion } from 'motion/react';

// Stores & Hooks
import { useAuthStore } from './stores/useAuthStore';
import { useLedgerStore } from './stores/useLedgerStore';
import { useUIStore } from './stores/useUIStore';
import type { AppTab } from './types';
import { errorMessage } from './lib/errorRemedies';
import { shortcutKeyMap } from './config/shortcuts';
import { currentPage, MAX_PINNED } from './lib/pinnedPages';
import { useLedgerData } from './hooks/useLedgerData';
import { useReportPreferencesSync } from './hooks/useReportPreferencesSync';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useBillingStore } from './modules/billing/BillingService';

// Core Architectural Imports
import { AuthScreen } from './core/auth/AuthScreen';
import { InitializationScreen } from './core/auth/InitializationScreen';
import { SecondFactorScreen } from './core/auth/SecondFactorScreen';
import { redeemRecoveryCode } from './core/auth/recoveryCode';
import { useTwoStepSetup } from './core/auth/twoStepSetup';
import { FallbackBoundary } from './components/FallbackBoundary';
import CookieConsent from './components/legal/CookieConsent';
import { canOpenShortcutHelp } from './lib/shortcutOverlay';
import { createRetryableLazy } from './lib/lazyWithRetry';
import { LazyOverlayBoundary } from './components/ui/LazyOverlayBoundary';

const loadRootLayout = () => import('./core/layout/RootLayout').then(m => ({ default: m.RootLayout }));
const RootLayout = lazy(loadRootLayout);
const loadFeedbackWidget = () =>
  import('./components/support/FeedbackWidget').then(m => ({ default: m.default as React.ComponentType }));
const loadLedgerAutoAuditor = () =>
  import('./components/forensics/LedgerAutoAuditor').then(m => ({ default: m.LedgerAutoAuditor as React.ComponentType }));

/**
 * Loads a background widget dynamically without Suspense error escalation, retrying
 * on reconnect or explicit Retry action and optionally replaying queued window events.
 */
function ResilientBackgroundMount({
  load,
  warnOnFailure = false,
  replayEventName,
}: {
  load: () => Promise<{ default: React.ComponentType }>;
  warnOnFailure?: boolean;
  replayEventName?: string;
}) {
  const [Loaded, setLoaded] = useState<React.ComponentType | null>(null);
  const replayPendingRef = useRef(false);

  useEffect(() => {
    let active = true;
    let isLoaded = false;
    let pendingClick = false;
    const retry = () => {
      if (isLoaded) return;
      load()
        .then((mod) => {
          if (!active) return;
          isLoaded = true;
          if (warnOnFailure) toast.dismiss('ledger-auditor-load-warning');
          if (pendingClick) {
            pendingClick = false;
            replayPendingRef.current = true;
          }
          setLoaded(() => mod.default);
        })
        .catch(() => {
          if (!active) return;
          if (pendingClick) {
            toast.error('The feedback form could not load.', {
              id: 'feedback-widget-load-warning',
              description: 'Check your connection or retry loading it.',
              action: {
                label: 'Retry',
                onClick: () => retry(),
              },
            });
          }
          if (!warnOnFailure) return;
          toast.warning('Automatic ledger checks could not load.', {
            id: 'ledger-auditor-load-warning',
            description: 'Check your connection or retry loading them.',
            action: {
              label: 'Retry',
              onClick: () => retry(),
            },
          });
        });
    };

    const onEarlyEvent = () => {
      if (isLoaded) return;
      pendingClick = true;
      retry();
    };

    if (replayEventName) {
      window.addEventListener(replayEventName, onEarlyEvent);
    }
    retry();
    window.addEventListener('online', retry);
    return () => {
      active = false;
      if (replayEventName) {
        window.removeEventListener(replayEventName, onEarlyEvent);
      }
      window.removeEventListener('online', retry);
    };
  }, [load, warnOnFailure, replayEventName]);

  useEffect(() => {
    if (!Loaded || !replayPendingRef.current || !replayEventName) return;
    replayPendingRef.current = false;
    toast.dismiss('feedback-widget-load-warning');
    window.dispatchEvent(new window.Event(replayEventName));
  }, [Loaded, replayEventName]);

  return Loaded ? <Loaded /> : null;
}
const PublicInvoicePage = lazy(() => import('./components/sales/PublicInvoicePage'));
const PublicEstimatePage = lazy(() => import('./components/sales/PublicEstimatePage'));
const CustomerPortalPage = lazy(() => import('./components/sales/CustomerPortalPage'));
const StatusPage = lazy(() => import('./components/system/StatusPage'));
const TwoStepSetupScreen = lazy(() => import('./core/auth/TwoStepSetupScreen'));
const NewPasswordScreen = lazy(() => import('./core/auth/NewPasswordScreen'));
const LegalModal = createRetryableLazy(() => import('./components/legal/LegalModal'));


/** Root application component coordinating authentication, public capability routes, and workspace shell. */
export default function App() {
  const [isPending, startTransition] = useTransition();
  usePerformanceTrace("App");

  const [isInitializing, setIsInitializing] = useState(true);
  const [pendingSecondFactor, setPendingSecondFactor] = useState<string | null>(null);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<'terms' | 'privacy'>('privacy');
  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(state => state.setUser);

  
  const language = useUIStore(state => state.language);
  const speedDials = useUIStore(state => state.speedDials);
  const theme = useUIStore(state => state.theme);
  const fontSizeScale = useUIStore(state => state.fontSizeScale);
  const fontFamily = useUIStore(state => state.fontFamily);
  const accentColor = useUIStore(state => state.accentColor);
  const highContrast = useUIStore(state => state.highContrast);
  const rowDensity = useUIStore(state => state.rowDensity);
  const reduceMotion = useUIStore(state => state.reduceMotion);

  // Dynamic Appearance & Accessibility Effect
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }

    // Apply Text Sizing Scale
    root.style.fontSize = `${fontSizeScale}%`;

    // Apply Font Family
    const fontMap: Record<string, string> = {
      system: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      inter: '"Inter", ui-sans-serif, system-ui, sans-serif',
      jakarta: '"Plus Jakarta Sans", "Inter", sans-serif',
      serif: '"Playfair Display", Georgia, serif',
      mono: '"JetBrains Mono", SFMono-Regular, monospace'
    };
    root.style.setProperty('--font-sans', fontMap[fontFamily] || fontMap.system);

    // Accent colour, darker in the light theme so text in it stays readable (E-27: 4.5:1 or more)
    const resolvedTheme = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    const accentMap: Record<string, { dark: string; light: string }> = {
      emerald: { dark: '#D6A852', light: '#7A550E' },
      indigo: { dark: '#818CF8', light: '#4F46E5' },
      amber: { dark: '#F59E0B', light: '#96490A' },
      teal: { dark: '#2DD4BF', light: '#0D6B64' },
      violet: { dark: '#C084FC', light: '#7E22CE' },
      rose: { dark: '#FB7185', light: '#BE123C' },
      slate: { dark: '#94A3B8', light: '#475569' }
    };
    const brass = (accentMap[accentColor] || accentMap.emerald)[resolvedTheme === 'light' ? 'light' : 'dark'];
    const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(brass.slice(i, i + 2), 16));
    root.style.setProperty('--brass', brass);
    root.style.setProperty('--brass-soft', `rgba(${r}, ${g}, ${b}, ${resolvedTheme === 'light' ? 0.1 : 0.14})`);
    root.style.setProperty('--brass-line', `rgba(${r}, ${g}, ${b}, ${resolvedTheme === 'light' ? 0.35 : 0.4})`);

    // High Contrast & Row Density
    if (highContrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }

    if (reduceMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }

    root.setAttribute('data-density', rowDensity);
  }, [theme, fontSizeScale, fontFamily, accentColor, highContrast, rowDensity, reduceMotion]);
  const isQuietMode = useUIStore(state => state.isQuietMode);

  useEffect(() => {
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
  }, []);
  const setActiveTabStore = useUIStore(state => state.setActiveTab);
  const navigateToolStore = useUIStore(state => state.navigateTool);
  const isCommandPaletteOpen = useUIStore(state => state.isCommandPaletteOpen);
  const setCommandPaletteOpen = useUIStore(state => state.setCommandPaletteOpen);
  const isQuickEntryOpen = useUIStore(state => state.isQuickEntryOpen);
  const setQuickEntryOpen = useUIStore(state => state.setQuickEntryOpen);
  const setImporterOpen = useUIStore(state => state.setImporterOpen);
  const isDiagnosticConsoleOpen = useUIStore(state => state.isDiagnosticConsoleOpen);
  const setDiagnosticConsoleOpen = useUIStore(state => state.setDiagnosticConsoleOpen);
  const isShortcutOverlayOpen = useUIStore(state => state.isShortcutOverlayOpen);
  const setShortcutOverlayOpen = useUIStore(state => state.setShortcutOverlayOpen);
  const isArchitectureOpen = useUIStore(state => state.isArchitectureOpen);
  const setArchitectureOpen = useUIStore(state => state.setArchitectureOpen);
  const toggleFocusMode = useUIStore(state => state.toggleFocusMode);

  // High-Performance Data Ingress
  useLedgerData();
  useReportPreferencesSync(); // D-47: personal recent reports and pins for this user/workspace

  const openExportDialog = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('exportDialog', '1');
    window.history.replaceState(null, '', url);
    useUIStore.getState().goToPage({ tab: 'settings', sub: 'export' });
    window.dispatchEvent(new Event('ledgerflow:open-export'));
  }, []);
  
  // Language & Direction Control & Sizing Core
  useEffect(() => {
    // Fetch dynamic limits & usage caps from public registration-status API
    useBillingStore.getState().fetchSystemCaps();
    const capsInterval = setInterval(() => {
      useBillingStore.getState().fetchSystemCaps();
    }, 30000);

    const handleResize = () => {
      if (window.innerWidth < 1024) {
        useUIStore.setState({ isSidebarOpen: false });
      } else {
        useUIStore.setState({ isSidebarOpen: true });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(capsInterval);
    };
  }, []);

  const navigateTool = useCallback((tab: string) => {
    startTransition(() => {
        navigateToolStore(tab);
    });
  }, [navigateToolStore]);

  const setActiveTab = useCallback((tab: AppTab) => {
    startTransition(() => {
        setActiveTabStore(tab);
    });
  }, [setActiveTabStore]);

  useEffect(() => {
    return onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      setIsInitializing(false);
    });
  }, [setUser]);

  useEffect(() => onSecondFactorRequired(auth, setPendingSecondFactor), []);
  // Y-31: arrived from a password-reset link; a new password is chosen first
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  useEffect(() => onPasswordRecovery(auth, setPasswordRecovery), []);

  // Operational Keyboard Shortcuts
const shortcutMap = useMemo(() => {
    // one list for the keys and the "Keyboard shortcuts" card (src/config/shortcuts.ts)
    const base = shortcutKeyMap({
      palette: () => setCommandPaletteOpen(!isCommandPaletteOpen),
      quickEntry: () => setQuickEntryOpen(!isQuickEntryOpen),
      overview: () => setActiveTab('dashboard'),
      transactions: () => setActiveTab('transactions'),
      ledger: () => setActiveTab('ledger'),
      reports: () => setActiveTab('reports'),
      export: () => openExportDialog(),
      import: () => setImporterOpen(true),
      theme: () => useUIStore.getState().setTheme(useUIStore.getState().theme === 'dark' ? 'light' : 'dark'),
      focus: () => toggleFocusMode(),
      diagnostics: () => setDiagnosticConsoleOpen(!isDiagnosticConsoleOpen),
      architecture: () => setArchitectureOpen(!isArchitectureOpen),
      // The help is a dialog too. Opening it over another dialog would put it behind that dialog's
      // overlay (the Saved Views manager sits at z-[200], the help at z-[100]) and trap the keyboard
      // in something the person cannot see, so a dialog that is open keeps the `?` key.
      shortcuts: () => {
        const modalOpen = Boolean(document.querySelector('[aria-modal="true"]'));
        if (!canOpenShortcutHelp({ isOpen: isShortcutOverlayOpen, modalOpen })) return;
        setShortcutOverlayOpen(!isShortcutOverlayOpen);
      },
      pinPage: () => { const ui = useUIStore.getState(); ui.togglePinnedPage(currentPage(ui)); },
    });
    for (let n = 1; n <= MAX_PINNED; n++) {
      base[`alt+${n}`] = () => { const ui = useUIStore.getState(); const page = ui.pinnedPages[n - 1]; if (page) ui.goToPage(page); };
    }
    Object.entries(speedDials || {}).forEach(([key, tabId]) => {
      base[`alt+${key.toLowerCase()}`] = () => navigateTool(tabId);
    });
    return base;
  }, [
    isCommandPaletteOpen, isQuickEntryOpen, isDiagnosticConsoleOpen,
    isShortcutOverlayOpen, isArchitectureOpen, speedDials, navigateTool,
    openExportDialog, setActiveTab, setArchitectureOpen, setCommandPaletteOpen,
    setDiagnosticConsoleOpen, setImporterOpen, setQuickEntryOpen,
    setShortcutOverlayOpen, toggleFocusMode
  ]);
  
  useKeyboardShortcuts(shortcutMap);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        useLedgerStore.getState().recomputeBalances();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const isGuest = useAuthStore(state => state.isGuest);
  const setIsGuest = useAuthStore(state => state.setIsGuest);

  useEffect(() => {
    const path = window.location.pathname;
    const isPublicOnlyPath = path === '/status' || /^\/(?:c|e|i)\/[^/]+\/?$/.test(path);
    if (!isPublicOnlyPath && (user || isGuest || path.startsWith('/invite/'))) {
      void loadRootLayout().catch(() => {});
    }
  }, [user, isGuest]);
  // Y-30: a workspace this person is in may require two-step login this session has not passed
  const twoStep = useTwoStepSetup(user?.uid ?? null, !user || user.isAnonymous || isGuest || Boolean(pendingSecondFactor));

  const handleGuest = () => {
    setIsGuest(true);
    toast.info('Entered Guest Mode');
  };



  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    localStorage.removeItem('ledgerflow_use_sandbox_mode');
    localStorage.removeItem('ledgerflow_identity_email');
    localStorage.removeItem('ledgerflow_identity_name');
    
    try {
      await signInWithPopup(auth, provider);
      setIsGuest(false);
      toast.success('SUCCESSFULLY LOGGED IN WITH GOOGLE');
    } catch (e) {
      console.error("Google Sign-In failed:", e);
      toast.error('Google Sign-In failed or was cancelled.');
    }
  };

  const handleEmailSignup = async (email: string, pass: string) => {
    localStorage.removeItem('ledgerflow_use_sandbox_mode');
    localStorage.removeItem('ledgerflow_identity_email');
    localStorage.removeItem('ledgerflow_identity_name');
    
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await sendEmailVerification(cred.user);
      setIsGuest(false);
      toast.success('Account created! Please check your email for a verification link.');
    } catch (e) {
      console.error("Signup failed:", e);
      toast.error(errorMessage(e) || 'Signup failed');
      throw e;
    }
  };

  const handlePasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success('Password reset email sent! Please check your inbox.');
    } catch (e) {
      toast.error(errorMessage(e) || 'Failed to send reset email');
    }
  };

  const handleEmailLogin = async (email: string, pass: string) => {
    localStorage.removeItem('ledgerflow_use_sandbox_mode');
    localStorage.removeItem('ledgerflow_identity_email');
    localStorage.removeItem('ledgerflow_identity_name');
    
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      setIsGuest(false);
      if (cred.secondFactorRequired) {
        toast.info('Password accepted. Enter the code from your authenticator app.');
      } else {
        toast.success('SUCCESSFULLY LOGGED IN');
      }
    } catch (e) {
      console.error("Login failed:", e);
      toast.error('Login failed: ' + errorMessage(e));
      throw e;
    }
  };

  

  

  

  

  



  
  // the public status page (L-17): no sign-in
  if (window.location.pathname === '/status') {
    return (
      <Suspense fallback={null}>
        <StatusPage />
      </Suspense>
    );
  }

  // the customer portal (K-27): a customer's invoices, no sign-in
  if (window.location.pathname.startsWith('/c/')) {
    return (
      <Suspense fallback={<InitializationScreen language={language} />}>
        <CustomerPortalPage />
      </Suspense>
    );
  }

  // signing an estimate (Y-20): no sign-in
  if (window.location.pathname.startsWith('/e/')) {
    return (
      <Suspense fallback={<InitializationScreen language={language} />}>
        <PublicEstimatePage />
      </Suspense>
    );
  }

  const isPublicInvoice = window.location.pathname.startsWith('/i/');
  if (isPublicInvoice) {
    return (
      <Suspense fallback={<InitializationScreen language={language} />}>
        <PublicInvoicePage />
      </Suspense>
    );
  }

  const isInviteRoute = window.location.pathname.startsWith('/invite/');
  if (isInviteRoute) {
    return (
      <>
        <Suspense fallback={<InitializationScreen language={language} />}>
          <RootLayout />
        </Suspense>
        <ResilientBackgroundMount load={loadFeedbackWidget} replayEventName="ledgerflow:feedback" />
      </>
    );
  }

  if (isInitializing) {
    return <InitializationScreen language={language} />;
  }

  if (pendingSecondFactor) {
    return (
      <SecondFactorScreen
        onVerify={(code) => verifySecondFactor(auth, code)}
        onCancel={() => { void signOut(auth); }}
        onRecover={redeemRecoveryCode}
      />
    );
  }

  if (passwordRecovery && user) {
    return (
      <Suspense fallback={<InitializationScreen language={language} />}>
        <NewPasswordScreen email={user.email || ''} onSave={async (password) => { await setNewPassword(auth, password); toast.success('New password saved'); }} onSignOut={() => { void signOut(auth); }} />
      </Suspense>
    );
  }

  if (!twoStep.checked) {
    return <InitializationScreen language={language} />;
  }

  if (twoStep.setupRequired) {
    return (
      <Suspense fallback={<InitializationScreen language={language} />}>
        <TwoStepSetupScreen workspaces={twoStep.workspaces} onContinue={twoStep.recheck} onSignOut={() => { void signOut(auth); }} />
      </Suspense>
    );
  }

  if (!user && !isGuest) {
    return <AuthScreen onLogin={handleLogin} onEmailLogin={handleEmailLogin} onEmailSignup={handleEmailSignup} onPasswordReset={handlePasswordReset} onGuest={handleGuest} language={language} />;
  }

  return (
    <FallbackBoundary>
      <div dir="ltr" className="h-[100dvh] w-full bg-[var(--ink)] overflow-hidden flex flex-col font-sans text-[var(--text)]">
        <Toaster theme="light" position="top-right" expand={false} richColors closeButton className={isQuietMode ? 'opacity-0 pointer-events-none' : ''} />
        {/* Google-grade Progress Line */}
        {isPending && (
          <div className="fixed top-0 left-0 right-0 h-1 z-[1000] overflow-hidden">
              <motion.div 
                className="h-full bg-emerald-500 shadow-[0_0_15px_#10b981]"
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
              />
          </div>
        )}
        <ResilientBackgroundMount load={loadLedgerAutoAuditor} warnOnFailure />
        <TestEnvironmentBanner />
        <Suspense fallback={<InitializationScreen language={language} />}>
          <RootLayout />
        </Suspense>
        <ResilientBackgroundMount load={loadFeedbackWidget} replayEventName="ledgerflow:feedback" />
        <CookieConsent onOpenPrivacyPolicy={() => { setLegalModalTab('privacy'); setIsLegalModalOpen(true); }} />
        {isLegalModalOpen && (
          <LazyOverlayBoundary
            label="Legal policy"
            onDismiss={() => setIsLegalModalOpen(false)}
            onRetry={() => setIsLegalModalOpen(true)}
          >
            <LegalModal isOpen={isLegalModalOpen} onClose={() => setIsLegalModalOpen(false)} initialTab={legalModalTab} />
          </LazyOverlayBoundary>
        )}
      </div>
    </FallbackBoundary>
  );
}