import { expect, test } from '@playwright/test';

// Exercise the real browser reporter without contacting an auth provider or sending diagnostics to a backend.
test('first visit, opt-in and withdrawal control automatic crash reports on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('https://ledgerflow-unconfigured.invalid/**', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: { ok: true, data: [] } }));
  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    // Guest sessions intentionally block all API requests. Seed a local, inert
    // signed-in fixture so this test can observe the actual browser request.
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('sb-ledgerflow-unconfigured-auth-token', JSON.stringify({
      access_token: 'telemetry-test-access-token', token_type: 'bearer', refresh_token: 'telemetry-test-refresh-token',
      expires_in: 3600, expires_at: now + 3600,
      user: { id: '5ca3c79c-8a3d-4c3f-9358-af6c49906d36', aud: 'authenticated', email: 'diagnostics@example.test', role: 'authenticated' },
    }));
  });
  const submitted: Array<{ message: string; url: string; referer?: string }> = [];
  await page.route('**/api/v1/telemetry/errors', async route => {
    const request = route.request();
    const record = request.postDataJSON() as { message: string; url: string };
    if (record.message.startsWith('S-35 browser check:')) {
      submitted.push({ message: record.message, url: record.url, referer: await request.headerValue('referer') ?? undefined });
    }
    await route.fulfill({ json: {} });
  });

  const report = (stage: string) => page.evaluate(async step => {
    const modulePath = '/src/lib/errorTracker.ts';
    const { reportClientError } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/lib/errorTracker');
    return reportClientError(`S-35 browser check: ${step}`);
  }, stage);

  await page.goto('/?source=demo-query-reference#settings');
  const banner = page.getByRole('region', { name: 'Cookie & Privacy Notice' });
  await expect(banner).toContainText('automatic crash reports');
  expect(await report('before choice')).toMatch(/^err_/);
  expect(submitted).toEqual([]);

  const accept = banner.getByRole('button', { name: 'Accept All' });
  expect((await accept.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await accept.click();
  await expect(banner).toBeHidden();
  await report('after opt-in');
  expect(submitted).toEqual([{
    message: 'S-35 browser check: after opt-in',
    url: '/',
    referer: `${new URL(page.url()).origin}/`,
  }]);

  const openSecurity = () => page.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Security', exact: true }).click();
  await openSecurity();
  const preference = page.getByRole('checkbox', { name: 'Send automatic crash reports' });
  await expect(preference).toBeChecked();
  await preference.press('Space');
  await expect(preference).not.toBeChecked();
  await report('after withdrawal');
  expect(submitted).toHaveLength(1);

  await page.reload();
  await openSecurity();
  await expect(preference).not.toBeChecked();
  await report('after reload');
  expect(submitted).toHaveLength(1);
});
