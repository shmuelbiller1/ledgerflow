import { guestSession } from '../../lib/db/guestDatabase';
import { replaceGuestCompany } from '../../lib/guestCompany';
import React, { useState } from 'react';
import { Globe2, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore, summarizeLedger } from '../../stores/useLedgerStore';
import {
  buildResetDemoWorkspace,
  canUseDemoSandbox,
  type DemoCountry,
  seedCountryDemoWorkspace,
} from '../../lib/countryDemoWorkspace';

const COUNTRY_META: Record<
  DemoCountry,
  { nameEn: string; nameHe: string; taglineEn: string; taglineHe: string; currency: 'ILS' | 'USD' }
> = {
  IL: {
    nameEn: 'Galil Design Studio (demo)',
    nameHe: 'סטודיו גליל לעיצוב (דמו)',
    taglineEn: '12 months of balanced 2025 ILS invoices, supplier bills, and bilingual accounts.',
    taglineHe: '12 חודשי פעילות מאוזנים בש״ח עם חשבוניות לקוחות, ספקים וחשבונות בעברית ובאנגלית.',
    currency: 'ILS',
  },
  US: {
    nameEn: 'Hudson River Craft Co (demo)',
    nameHe: 'Hudson River Craft Co (דמו ארה״ב)',
    taglineEn: '12 months of balanced 2025 USD client retainers, vendor bills, and bank settlements.',
    taglineHe: '12 חודשי פעילות מאוזנים בדולר עם הכנסות לקוחות, הוצאות ספקים ותנועות בנק.',
    currency: 'USD',
  },
};

export default function GuestCountrySamplePicker() {
  useLedgerCollections('invoices', 'bills', 'customers', 'vendors');
  const user = useAuthStore(s => s.user);
  const isGuest = useAuthStore(s => s.isGuest);
  const currentWorkspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);

  const accountsCount = useLedgerStore(s => s.accounts.length);
  const entriesCount = useLedgerStore(s => s.transactions.length);
  const invoicesCount = useLedgerStore(s => s.invoices.length);
  const billsCount = useLedgerStore(s => s.bills.length);
  const baseCurrency = useLedgerStore(s => s.baseCurrency);

  const [language, setLanguage] = useState<'en' | 'he'>('en');
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const sandboxAllowed = canUseDemoSandbox({ isGuest: Boolean(isGuest || !user), user });
  const workspaceId = currentWorkspace?.id || 'ws-guest';

  const applyPayload = (
    payload: {
      currency: 'ILS' | 'USD';
      accounts: ReturnType<typeof useLedgerStore.getState>['accounts'];
      transactions: ReturnType<typeof useLedgerStore.getState>['transactions'];
      invoices: ReturnType<typeof useLedgerStore.getState>['invoices'];
      bills: ReturnType<typeof useLedgerStore.getState>['bills'];
      customers: ReturnType<typeof useLedgerStore.getState>['customers'];
      vendors: ReturnType<typeof useLedgerStore.getState>['vendors'];
    },
    displayName: string,
  ) => {
    if (guestSession() && isGuest && !user) {
      replaceGuestCompany(payload, displayName);
      return;
    }
    useLedgerStore.setState({
      accounts: payload.accounts,
      computedAccounts: payload.accounts,
      transactions: payload.transactions,
      invoices: payload.invoices,
      bills: payload.bills,
      customers: payload.customers,
      vendors: payload.vendors,
      baseCurrency: payload.currency,
      runningBalances: summarizeLedger(payload.transactions, payload.accounts),
    });
    const existing = useAuthStore.getState().workspaces;
    if (currentWorkspace && existing.length > 0) {
      setWorkspaces(
        existing.map(ws =>
          ws.id === currentWorkspace.id
            ? { ...ws, name: displayName, defaultCurrency: payload.currency }
            : ws,
        ),
      );
    }
  };

  const handleLoadCountry = (country: DemoCountry) => {
    if (!sandboxAllowed) return;
    const seeded = seedCountryDemoWorkspace(workspaceId, country);
    const meta = COUNTRY_META[country];
    applyPayload(seeded, language === 'he' ? meta.nameHe : meta.nameEn);
    setStatusNote(
      language === 'he'
        ? `נטענה חברת הדמו: ${meta.nameHe} (${seeded.accounts.length} חשבונות, ${seeded.transactions.length} פקודות יומן).`
        : `Loaded ${meta.nameEn} (${seeded.accounts.length} accounts, ${seeded.transactions.length} journal entries across 12 months).`,
    );
  };

  const handleReset = (mode: 'starter' | 'empty') => {
    if (!sandboxAllowed) return;
    const reset = buildResetDemoWorkspace(workspaceId, mode);
    applyPayload(
      reset,
      mode === 'starter' ? 'Starter Demo Workspace' : 'Guest Sandbox (Empty)',
    );
    setStatusNote(
      mode === 'starter'
        ? language === 'he'
          ? 'סביבת הדמו אופסה לנתוני הפתיחה.'
          : 'Reset guest sandbox to clean starter demo data.'
        : language === 'he'
          ? 'סביבת הדמו נוקתה לספרים ריקים.'
          : 'Cleared guest sandbox to empty books.',
    );
  };

  return (
    <section
      aria-labelledby="demo-company-heading"
      dir={language === 'he' ? 'rtl' : 'ltr'}
      className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="demo-company-heading" className="text-base font-bold text-[var(--text)] flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-[var(--brass)]" aria-hidden="true" />
            {language === 'he'
              ? 'חברות דמו לשנה מלאה (ישראל / ארה״ב) ואיפוס בדיקות'
              : '1-Year Country Sample Books (Israel & US) & Tester Reset'}
          </h3>
          <p className="text-sm text-[var(--muted)] mt-1">
            {language === 'he'
              ? 'נתונים סינתטיים בזיכרון בלבד להתנסות מלאה בדוחות, התאמות ומסים ללא התחברות וללא פגיעה בספרים אמיתיים.'
              : 'Browser-only synthetic 12-month books for exploring reports, statements, and tax previews safely without signing in.'}
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden" role="group" aria-label="Sample picker language">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            aria-pressed={language === 'en'}
            className={`min-h-11 px-3 text-xs font-medium ${language === 'en' ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage('he')}
            aria-pressed={language === 'he'}
            className={`min-h-11 px-3 text-xs font-medium ${language === 'he' ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}
          >
            עברית
          </button>
        </div>
      </div>

      {!sandboxAllowed ? (
        <div
          role="status"
          className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 flex items-start gap-3 text-sm text-[var(--text)]"
        >
          <ShieldCheck className="w-5 h-5 text-[var(--pos)] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              {language === 'he'
                ? 'מוגן לחשבון אמיתי: טעינת דמו ואיפוס מושבתים בעת חיבור'
                : 'Real workspace protected: sample book replacement & reset are disabled while signed in'}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {language === 'he'
                ? 'כדי להתנסות בחברות הדמו של ישראל (₪) או ארה״ב ($), פתחו חלון אורח מנותק.'
                : 'Sign out to browse as a guest if you want to load or reset synthetic Israel (ILS) or United States (USD) sample books.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(['IL', 'US'] as const).map(country => {
              const info = COUNTRY_META[country];
              const active = (currentWorkspace?.currency || baseCurrency) === info.currency;
              return (
                <div
                  key={country}
                  className={`rounded-lg border p-4 space-y-3 ${active ? 'border-[var(--brass)] bg-[var(--surface)]' : 'border-[var(--line)] bg-[var(--bg)]'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--panel)] border border-[var(--line)] text-[var(--text)]">
                      {country} · {info.currency}
                    </span>
                    <span className="text-xs text-[var(--muted)]">2025 · 12 months</span>
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">
                      <bdi>{language === 'he' ? info.nameHe : info.nameEn}</bdi>
                    </div>
                    <p className="text-xs text-[var(--muted)] mt-1">
                      {language === 'he' ? info.taglineHe : info.taglineEn}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLoadCountry(country)}
                    className="btn-secondary min-h-11 w-full px-3 rounded-lg text-xs font-semibold"
                  >
                    {language === 'he'
                      ? `טעינת חברת דמו (${info.currency})`
                      : `Load ${country === 'IL' ? 'Israel' : 'United States'} 1-year sample (${info.currency})`}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--line)]">
            <div className="text-xs text-[var(--muted)] tabular-nums">
              <bdi>{currentWorkspace?.name || 'Guest Workspace'}</bdi> ({currentWorkspace?.currency || baseCurrency}) · {accountsCount} accounts · {entriesCount} entries · {invoicesCount} invoices · {billsCount} bills
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleReset('starter')}
                className="btn-secondary min-h-11 px-3 rounded-lg text-xs inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {language === 'he' ? 'איפוס לדמו התחלתי' : 'Reset to starter demo'}
              </button>
              <button
                type="button"
                onClick={() => handleReset('empty')}
                className="btn-secondary min-h-11 px-3 rounded-lg text-xs inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                {language === 'he' ? 'ניקוי לספרים ריקים' : 'Clear to empty books'}
              </button>
            </div>
          </div>
        </>
      )}

      {statusNote && (
        <p role="status" aria-live="polite" className="text-xs font-medium text-[var(--pos)]">
          {statusNote}
        </p>
      )}
    </section>
  );
}
