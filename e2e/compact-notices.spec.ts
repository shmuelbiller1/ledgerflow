import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [390, 1280])
  for (const theme of ["light", "dark"]) {
    test(`ledger notices ${width} ${theme}: compact, reachable and dismissible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("isGuest", "true");
        localStorage.setItem("has_seen_onboarding", "true");
        localStorage.setItem("ledgerflow-cookie-consent", "accepted");
        localStorage.setItem("lf_theme", selectedTheme);
      }, theme);
      await page.goto("/#dashboard");
      await expect(
        page.getByRole("heading", {
          name: "Real-Time Financial Ledger",
          exact: true,
        }),
      ).toBeVisible();
      const compact = page.getByTestId("compact-ledger-notices");
      const desktopBackup = page.locator("#ledger-backup-reminder-banner");
      const demo = page.getByTestId("desktop-demo-notice");
      if (width === 390) {
        await expect(compact).toHaveText("Demo data · Backup due");
        await expect(compact).toBeVisible();
        await expect(desktopBackup).toBeHidden();
        await expect(demo).toBeHidden();
        const box = await compact.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(48);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        for (const button of await compact.getByRole("button").all()) {
          const target = await button.boundingBox();
          expect(target!.height).toBeGreaterThanOrEqual(44);
          expect(target!.width).toBeGreaterThanOrEqual(44);
        }
        const axe = await new AxeBuilder({ page })
          .include('[data-testid="compact-ledger-notices"]')
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(axe.violations).toEqual([]);
        await compact
          .getByRole("button", { name: "Export backup", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("heading", { name: "Settings", exact: true }),
        ).toBeVisible();
        await compact
          .getByRole("button", { name: "Dismiss notices", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await expect(compact).toBeHidden();
        await expect(desktopBackup).toBeHidden();
        await expect(demo).toBeHidden();
      } else {
        await expect(compact).toBeHidden();
        await expect(desktopBackup).toBeVisible();
        await expect(demo).toBeVisible();
        await desktopBackup
          .getByRole("button", { name: "Dismiss backup reminder" })
          .focus();
        await page.keyboard.press("Enter");
        await expect(desktopBackup).toBeHidden();
        await expect(demo).toBeVisible();
      }
      await page.reload();
      await expect(width === 390 ? compact : desktopBackup).toBeVisible();
    });
  }
