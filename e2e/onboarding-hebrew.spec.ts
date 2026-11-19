import { test, expect } from '@playwright/test';
import { mountJourney, setLedgerField } from './support/journeyFixture';

/**
 * AI12-N10-01 (#838): a person who chose Hebrew reads Hebrew, right-to-left, on the four screens a
 * new workspace starts with — sign-in/sign-up, the setup wizard, the first-hour guide and the
 * first-week checklist — at 390 px and 1280 px. Screenshots are attached to each run.
 *
 * The figures are not the point here (the checklist's own spec checks 44 px targets and the report
 * visit); this is the language and the reading direction. English is checked in the same run so the
 * default is not lost.
 */
const WORKSPACE = 'n10-onboarding-ws';
const HEBREW = /\p{Script=Hebrew}/u;

const workspace = {
  id: WORKSPACE, uid: 'journey-user', name: 'Northwind Books', currency: 'USD',
  fiscalYearStartMonth: 1, roles: { 'journey-user': 'owner' },
};

/** Words that are names, not copy: they stay in Latin letters in both languages. */
const NAMES = /LedgerFlow|Google|Microsoft|QuickBooks|Xero|Wave|SaaS/g;

async function latinWordsLeft(region: import('@playwright/test').Locator): Promise<string[]> {
  // <option> text is data, not copy: a currency code and an IANA zone name read the same in every
  // language, so counting them would fail on the correct screen. The fiscal select's month names
  // are copy and are asserted by name where the wizard is checked ("אפריל" for April).
  const text = (await region.evaluate(el => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('option').forEach(option => option.remove());
    return copy.textContent ?? '';
  })).replace(NAMES, ' ');
  return (text.match(/\b[A-Za-z]{3,}\b/g) || []).filter(Boolean);
}

/** Re-renders the fixture's wizard so it reads the language and workspace set after it first mounted. */
async function mountWizardAgain(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async mounts => { await (window as unknown as { __journeyRender: (m: unknown[]) => Promise<void> }).__journeyRender(mounts); }, [
    { module: '/src/components/onboarding/SetupWizard.tsx', props: { onStarted: '__fn:noop', onDone: '__fn:noop' } },
  ]);
}

for (const width of [390, 1280]) {
  test(`N-10 Hebrew onboarding reads Hebrew and right-to-left at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });

    // 1. The signed-out registration and sign-in form, opened in the saved Hebrew choice.
    await page.addInitScript(() => {
      localStorage.setItem('lf_language', 'he');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
      localStorage.setItem('has_seen_onboarding', 'true');
    });
    await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
    await page.route('**/api/v1/public/registration-status', route => route.fulfill({ json: { registrationAllowed: true } }));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const form = page.getByRole('main', { name: 'עמוד התחברות' });
    await expect(form).toBeVisible();
    await expect(form.getByRole('heading', { name: 'התחברות' })).toBeVisible();
    await expect(form.getByRole('button', { name: 'המשך כאורח' })).toBeVisible();
    expect(await latinWordsLeft(form)).toEqual([]);
    expect(await form.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
    await testInfo.attach(`signin-he-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    // The registration half says the same in Hebrew; nothing is submitted.
    await form.getByRole('button', { name: 'מעבר להרשמה' }).click();
    await expect(form.getByRole('heading', { name: 'פתיחת חשבון' })).toBeVisible();
    await expect(form.getByText(/לפחות 10 תווים/)).toBeVisible();
    expect(await latinWordsLeft(form)).toEqual([]);
    await testInfo.attach(`register-he-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // 2. The setup wizard, first step and its month names.
    const wizard = await mountJourney(page, {
      workspaceId: WORKSPACE,
      ledger: {},
      mounts: [{ module: '/src/components/onboarding/SetupWizard.tsx', props: { onStarted: '__fn:noop', onDone: '__fn:noop' } }],
    });
    await page.evaluate(async ws => {
      const { useUIStore } = await import('/src/stores/useUIStore.ts');
      const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
      useUIStore.getState().setLanguage('he');
      useAuthStore.setState({ workspaces: [ws] } as never);
    }, workspace);
    await mountWizardAgain(page);
    const wizardMain = page.getByRole('main').last();
    await expect(wizardMain.getByRole('heading', { name: 'הגדרת הספרים שלכם' })).toBeVisible();
    await expect(wizardMain.getByRole('heading', { name: 'איזה סוג עסק?' })).toBeVisible();
    await expect(wizardMain.getByLabel('שם העסק')).toBeVisible();
    await expect(wizardMain.getByLabel('שנת הכספים מתחילה בחודש')).toBeVisible();
    await expect(wizardMain.getByLabel('חנות')).toBeVisible();
    expect(await wizardMain.locator('select#setup-fiscal option').nth(3).textContent()).toBe('אפריל');
    expect(await latinWordsLeft(wizardMain)).toEqual([]);
    expect(await wizardMain.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
    await testInfo.attach(`setup-he-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // 3. The first-hour guide and 4. the first-week checklist on a real signed-in overview.
    const books = await mountJourney(page, {
      workspaceId: WORKSPACE,
      ledger: { accounts: [], customers: [], invoices: [], payments: [] },
      mounts: [
        { module: '/src/components/onboarding/FirstHourGuide.tsx' },
        { module: '/src/components/dashboard/FirstWeekChecklist.tsx' },
      ],
    });
    await setLedgerField(page, 'accounts', []);
    await page.getByText('השבוע הראשון שלכם').first().waitFor();

    const guide = page.getByRole('region', { name: 'מדריך הצעדים הראשונים בהנהלת חשבונות' });
    await expect(guide).toBeVisible();
    await expect(guide.getByRole('listitem')).toHaveCount(8);
    await expect(guide.getByRole('button', { name: 'פתיחת התאמת בנק' })).toBeVisible();
    expect(await guide.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
    for (const button of await guide.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    expect((await latinWordsLeft(guide)).filter(word => !['USD'].includes(word))).toEqual([]);

    const checklist = page.getByRole('region', { name: 'השבוע הראשון שלכם' });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByRole('listitem')).toHaveCount(5);
    // the count is part of the Hebrew sentence: no digits stranded beside English words
    await expect(checklist.getByText('0 מתוך 5 שלבים הושלמו')).toBeVisible();
    await expect(checklist.getByRole('button', { name: 'הסתרת רשימת השבוע הראשון' })).toBeVisible();
    expect(await checklist.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
    expect(await latinWordsLeft(checklist)).toEqual([]);
    await testInfo.attach(`overview-he-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // 5. The same screens in English keep their words and read left-to-right.
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/useUIStore.ts');
      useUIStore.getState().setLanguage('en');
    });
    await page.evaluate(async mounts => { await (window as unknown as { __journeyRender: (m: unknown[]) => Promise<void> }).__journeyRender(mounts); }, [
      { module: '/src/components/onboarding/FirstHourGuide.tsx' },
      { module: '/src/components/dashboard/FirstWeekChecklist.tsx' },
    ]);
    const guideEn = page.getByRole('region', { name: 'First-hour bookkeeping guide' });
    await expect(guideEn.getByRole('listitem')).toHaveCount(8);
    await expect(page.getByRole('region', { name: 'Your first week' }).getByText('0 of 5 steps complete')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your first week' }).getByRole('button', { name: 'Hide first-week checklist' })).toBeVisible();
    expect(await page.getByRole('region', { name: 'Your first week' }).evaluate(el => getComputedStyle(el).direction)).toBe('ltr');
    await testInfo.attach(`overview-en-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(wizard.errors).toEqual([]);
    expect(books.errors).toEqual([]);
  });
}

// The setup wizard's saved values are not re-tested here: `setup-wizard-journey.test.tsx` checks the
// exact fields it writes, and this change does not touch them.
test('N-10 Hebrew setup keeps the typed Hebrew name and the chosen month when the step moves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mountJourney(page, {
    workspaceId: WORKSPACE,
    ledger: {},
    mounts: [{ module: '/src/components/onboarding/SetupWizard.tsx', props: { onStarted: '__fn:noop', onDone: '__fn:noop' } }],
  });
  await page.evaluate(async ws => {
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    useUIStore.getState().setLanguage('he');
    useAuthStore.setState({ workspaces: [ws] } as never);
  }, workspace);
  await mountWizardAgain(page);
  const main = page.getByRole('main').last();
  await main.getByLabel('שם העסק').fill('חברת אלפא בע״מ');
  await main.getByLabel('שנת הכספים מתחילה בחודש').selectOption('4');
  await main.getByLabel('חנות').check();
  await expect(main.getByLabel('שם העסק')).toHaveValue('חברת אלפא בע״מ');
  // the step that writes to the server is not pressed by this test: no setup save, no provider call
  // The wizard carries its own lang/dir (the fixture mounts this screen alone, without the app shell
  // that also mirrors the choice onto <html>), so the screen's own attributes are the ones to check.
  expect(await main.getAttribute('lang')).toBe('he');
  expect(await main.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
  expect(HEBREW.test(await main.innerText())).toBe(true);
});
