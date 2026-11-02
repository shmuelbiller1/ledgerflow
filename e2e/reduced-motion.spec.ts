import { test, expect } from '@playwright/test';

for (const preference of ['system', 'app'] as const) {
  test(`A-265 ${preference} reduced motion: invoice opens at its final appearance, delayed CSS finishes immediately`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: preference === 'system' ? 'reduce' : 'no-preference' });
    await page.addInitScript((appPreference) => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
      localStorage.setItem('lf_reduce_motion', String(appPreference));
    }, preference === 'app');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.goto('/#sales');
    const open = page.locator('#main-content').getByRole('button', { name: 'Add Invoice', exact: true });
    await expect(open).toBeVisible();
    if (preference === 'app') await expect(page.locator('html')).toHaveClass(/reduce-motion/);

    // Sample the actual modal on its first painted frames, not after a visibility assertion has
    // waited out an animation. Opacity is important: Motion's reducedMotion alone only skips transforms.
    await page.evaluate(() => {
      const samples: Array<{ opacity: number; transform: string }> = [];
      Object.assign(window, { __motionSamples: samples });
      const sample = () => {
        const dialog = document.querySelector('[role="dialog"] > .relative');
        if (dialog) {
          const style = getComputedStyle(dialog);
          samples.push({ opacity: Number(style.opacity), transform: style.transform });
        }
        if (samples.length < 4) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __motionSamples: unknown[] }).__motionSamples.length)).toBe(4);
    const samples = await page.evaluate(() => (window as unknown as { __motionSamples: Array<{ opacity: number; transform: string }> }).__motionSamples);
    // One frame may contain the initial style before Motion's first render step; subsequent frames
    // must be final, rather than fading for the default 300 ms or a component's explicit spring.
    for (const sample of samples.slice(1)) {
      expect(sample.opacity).toBe(1);
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(sample.transform);
    }
    const css = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'transition: opacity 10s 30s; animation: spin 10s 30s infinite;';
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const result = { animation: style.animationDuration, animationDelay: style.animationDelay, transition: style.transitionDuration, transitionDelay: style.transitionDelay };
      probe.remove();
      return result;
    });
    expect(parseFloat(css.animation)).toBeLessThanOrEqual(0.00001);
    expect(parseFloat(css.transition)).toBeLessThanOrEqual(0.00001);
    expect(parseFloat(css.animationDelay)).toBe(0);
    expect(parseFloat(css.transitionDelay)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(errors).toEqual([]);
  });
}
