import { test, expect } from "@playwright/test";

// Each new case exercises multiple shapes and a full reload of the application.
test.setTimeout(60000);

for (const width of [1280, 390]) {
  test(`chart styles, legends and signed-value tables survive navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() => {
      localStorage.setItem("isGuest", "true");
      localStorage.setItem("has_seen_onboarding", "true");
      localStorage.setItem("ledgerflow-cookie-consent", "accepted");
    });
    await page.goto("/#charts");
    const consent = page.getByRole("button", {
      name: "Dismiss cookie banner",
      exact: true,
    });
    if (await consent.isVisible()) await consent.click();
    const mix = page.getByRole("region", {
      name: "Monthly Profitability & Mix",
      exact: true,
    });
    const burn = page.getByRole("region", {
      name: "Operating Expense Burn Rate",
      exact: true,
    });
    await expect(
      mix.getByRole("button", { name: "Bar", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      burn.getByRole("button", { name: "Area", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await mix
      .getByRole("button", { name: "Table", exact: true })
      .press("Enter");
    const originalValues = await mix.getByRole("table").innerText();
    await mix
      .getByRole("button", { name: "Chart", exact: true })
      .press("Enter");
    for (const [kind, shape] of [
      ["Line", ".recharts-line"],
      ["Area", ".recharts-area"],
      ["Bar", ".recharts-bar"],
    ] as const) {
      const button = mix.getByRole("button", { name: kind, exact: true });
      await button.press("Space");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(mix.locator(shape)).toHaveCount(2);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await mix
        .getByRole("button", { name: "Table", exact: true })
        .press("Enter");
      expect(await mix.getByRole("table").innerText()).toBe(originalValues);
      await mix
        .getByRole("button", { name: "Chart", exact: true })
        .press("Enter");
    }
    await mix.getByRole("button", { name: "Line", exact: true }).press("Enter");
    const plot = mix.locator(".recharts-surface");
    await plot.focus();
    await plot.press("ArrowRight");
    await expect(mix.locator(".recharts-tooltip-wrapper")).toContainText(
      "Revenue:",
    );
    await mix
      .getByRole("button", { name: "Revenue", exact: true })
      .press("Space");
    await expect(mix.locator(".recharts-line")).toHaveCount(1);
    await mix
      .getByRole("button", { name: "Table", exact: true })
      .press("Enter");
    await expect(
      mix.getByRole("columnheader", { name: "Revenue", exact: true }),
    ).toHaveCount(0);
    await mix
      .getByRole("button", { name: "Revenue", exact: true })
      .press("Space");
    expect(await mix.getByRole("table").innerText()).toBe(originalValues);
    await page
      .getByRole("button", { name: "Last 12 Months", exact: true })
      .click();
    await expect(
      mix.getByRole("button", { name: "Line", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      mix.getByRole("button", { name: "Line", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      burn.getByRole("button", { name: "Area", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .getByRole("region", { name: "Cash Balance Allocation", exact: true })
        .getByRole("group", { name: /chart style/ }),
    ).toHaveCount(0);
    const tree = page.getByRole('region', { name: 'Expenses by category treemap', exact: true });
    await tree.getByLabel('Expenses by category treemap legend').getByRole('button').first().focus();
    await expect(tree.getByRole('tooltip')).toContainText('Net expense:');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  test(`dashboard trend styles and month tooltips work by keyboard at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 200, json: {} }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("isGuest", "true");
      localStorage.setItem("has_seen_onboarding", "true");
      localStorage.setItem("ledgerflow-cookie-consent", "accepted");
    });
    await page.goto("/");
    const consent = page.getByRole("button", {
      name: "Dismiss cookie banner",
      exact: true,
    });
    if (await consent.isVisible()) await consent.click();
    const revenue = page.getByRole("article", { name: "Revenue", exact: true });
    const cash = page.getByRole("article", {
      name: "Cash balance",
      exact: true,
    });
    await revenue
      .getByRole("button", { name: "Area", exact: true })
      .press("Enter");
    await expect(revenue.locator("svg polygon")).toHaveCount(1);
    const month = revenue.getByLabel("Revenue chart month");
    await month.focus();
    await month.press("ArrowDown");
    await month.press("Enter");
    const selected = await month.inputValue();
    expect(selected).toMatch(/^\d{4}-\d{2}$/);
    await expect(revenue.locator(".shadow-lg")).toContainText(selected);
    await expect(revenue.locator(".shadow-lg")).toContainText("Revenue:");
    expect((await month.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await revenue.getByRole("button", { name: "Revenue trend" }).press("Space");
    await expect(revenue.getByRole("img")).toHaveCount(0);
    await revenue.getByRole("button", { name: "Revenue trend" }).press("Space");
    await expect(revenue.getByRole("img")).toHaveCount(1);
    await revenue.getByText("Monthly values", { exact: true }).click();
    await expect(revenue.getByRole("table").locator("tbody tr")).toHaveCount(
      12,
    );
    await expect(
      cash.getByRole("button", { name: "Line", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      revenue.getByRole("button", { name: "Area", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}


test('a one-month financial line and area keep visible value markers', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
  await page.goto('/#charts');
  const mix = page.getByRole('region', { name: 'Monthly Profitability & Mix', exact: true });
  await expect(mix.locator('.recharts-surface')).toBeVisible();
  const start = mix.getByLabel('Monthly Profitability & Mix brush start');
  // The basic guest ledger already has one month; larger guest fixtures need zooming.
  if (await start.count()) {
    const last = await start.getAttribute('max');
    await start.press('End');
    await expect(start).toHaveValue(last!);
  }
  await mix.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(mix.locator('.recharts-line-dot')).toHaveCount(2);
  await mix.getByRole('button', { name: 'Area', exact: true }).click();
  await expect(mix.locator('.recharts-area-dot')).toHaveCount(2);
  await mix.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(mix.getByRole('row')).toHaveCount(2);
});
