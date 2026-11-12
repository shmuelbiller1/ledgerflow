import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const tools = [
  ["units-production-preview", "Units-of-production Depreciation"],
  ["depreciation-conventions-preview", "Depreciation Conventions"],
  ["tiered-pricing-preview", "Tiered and Volume Pricing"],
  ["cost-allocation-preview", "Cost Allocation by Percentage or Driver"],
  ["standard-cost-variance-preview", "Standard Cost Variance"],
  ["seasonal-budget-preview", "Seasonal Budget Distribution"],
  ["customer-cohorts-preview", "Customer Invoice Cohorts"],
] as const;
test("all seven registered previews open in the real sandbox on a phone with typed inputs, help and local table scrolling", async ({
  page,
}) => {
  // seven dialogs, each opened, typed into and scanned by axe: about 20-25 s locally and more on CI runners,
  // so the default 30 s left no margin once the app it loads behind them grew (main went red after #675)
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 850 });
  await page.addInitScript(() => {
    localStorage.setItem("isGuest", "true");
    localStorage.setItem("has_seen_onboarding", "true");
  });
  await page.goto("/");
  const cookie = page.getByRole("button", { name: "Dismiss cookie banner" });
  if (await cookie.isVisible()) await cookie.click();
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js",
      domPath = "/node_modules/.vite/deps/react-dom_client.js",
      catalogPath = "/src/components/platform/ToolsCatalog.tsx",
      ledgerPath = "/src/stores/useLedgerStore.ts";
    const [
      { default: React },
      {
        default: { createRoot },
      },
      { default: ToolsCatalog },
      { useLedgerStore },
    ] = await Promise.all([
      import(reactPath),
      import(domPath),
      import(catalogPath),
      import(ledgerPath),
    ]);
    const uid = "u",
      workspaceId = "w";
    const account = {
      id: "expense",
      uid,
      workspaceId,
      code: "5000",
      name: "חשמל Shop",
      type: "expense",
      balanceCents: 0,
    };
    const previousYear = Number(new Date().getFullYear()) - 1;
    useLedgerStore.setState({
      accounts: [account],
      computedAccounts: [account],
      transactions: [
        {
          id: "expense-pattern",
          uid,
          workspaceId,
          date: "2025-01-01",
          description: "הוצאה Shop",
          currency: "USD",
          status: "completed",
          type: "actual",
          totalAmountCents: 100,
          lines: [
            { accountId: "expense", amountCents: 100 },
            { accountId: "cash", amountCents: -100 },
          ],
        },
      ],
      invoices: [
        {
          id: "hebrew-invoice",
          workspaceId,
          customerId: "לקוח A",
          customerName: "לקוח Shop",
          date: `${previousYear}-01-01`,
          status: "sent",
          amountCents: 100,
        },
      ],
      truncatedCollections: {},
    });
    const host = document.createElement("section");
    host.setAttribute("aria-label", "Calculation catalogue");
    host.setAttribute("role", "region");
    document.body.appendChild(host);
    createRoot(host).render(React.createElement(ToolsCatalog));
  });
  const catalogue = page.getByRole("region", { name: "Calculation catalogue" });
  for (const [id, name] of tools) {
    await catalogue.getByRole("heading", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(
      dialog.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await dialog.getByText("How this tool works", { exact: true }).click();
    await expect(dialog.getByText("Method:", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Example:", { exact: true })).toBeVisible();
    if (id === "units-production-preview") {
      const cost = dialog.getByRole("spinbutton", {
        name: "Asset cost (minor units)",
        exact: true,
      });
      await cost.fill("1001");
      await cost.press("Enter");
      const capacity = dialog.getByRole("spinbutton", {
        name: "Expected lifetime units",
        exact: true,
      });
      await capacity.fill("3");
      await capacity.press("Enter");
      const units = dialog.getByRole("spinbutton", {
        name: "Units produced this period",
        exact: true,
      });
      await units.fill("1");
      await units.press("Enter");
      await expect(
        dialog.getByRole("table", { name: "Tool results" }),
      ).toContainText("333");
      await units.fill("4");
      await units.press("Enter");
      await expect(dialog).toContainText("exceed expected lifetime capacity");
      await expect(
        dialog.getByRole("table", { name: "Tool results" }),
      ).toHaveCount(0);
      await dialog.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(units).toHaveValue("1000");
    }
    if (id === "cost-allocation-preview") {
      await dialog
        .getByRole("combobox", {
          name: "A: optional account label",
          exact: true,
        })
        .selectOption("expense");
      await expect(
        dialog.getByRole("table", { name: "Tool results" }),
      ).toContainText("חשמל Shop");
    }
    if (id === "customer-cohorts-preview") {
      const region = dialog.getByRole("region", {
        name: "Scrollable tool results",
      });
      const moveRight = region.getByRole("button", { name: "Move results right" });
      await moveRight.focus();
      await expect(moveRight).toBeFocused();
      await moveRight.press("Enter");
      await expect
        .poll(() => region.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .disableRules(["color-contrast"])
      .analyze();
    expect(
      axe.violations.map((value) => ({
        id: value.id,
        targets: value.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});
