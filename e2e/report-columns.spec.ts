import { test, expect } from "@playwright/test";

for (const kind of ["pl", "bs"] as const) {
  test(`${kind}: period columns, percentages, comparison and mixed labels work with keyboard and CSV`, async ({
    page,
  }) => {
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: {} }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("isGuest", "true");
      localStorage.setItem("has_seen_onboarding", "true");
    });
    await page.goto("/");
    await page.evaluate(async (kind) => {
      const reactPath = "/node_modules/.vite/deps/react.js";
      const domPath = "/node_modules/.vite/deps/react-dom_client.js";
      const screenPath =
        kind === "pl"
          ? "/src/components/ledger/ProfitAndLossView.tsx"
          : "/src/components/ledger/BalanceSheetView.tsx";
      const authPath = "/src/stores/useAuthStore.ts";
      const ledgerPath = "/src/stores/useLedgerStore.ts";
      const [
        { default: React },
        {
          default: { createRoot },
        },
        { default: View },
        { useAuthStore },
        { useLedgerStore },
      ] = await Promise.all([
        import(reactPath),
        import(domPath),
        import(screenPath),
        import(authPath),
        import(ledgerPath),
      ]);
      const accounts = [
        {
          id: "cash",
          name: "Cash",
          type: "asset",
          category: "Current Assets",
          code: "1000",
        },
        {
          id: "income",
          name: "מכירות Sales",
          type: "income",
          category: "Revenue",
          code: "4000",
        },
        {
          id: "rent",
          name: "שכירות Rent",
          type: "expense",
          category: "Expenses",
          code: "6000",
        },
      ];
      useAuthStore.setState({
        user: null,
        isGuest: false,
        currentWorkspaceId: null,
        workspaces: [],
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      useLedgerStore.setState({
        accounts,
        transactions: [
          {
            id: "sale",
            date: "2024-02-29",
            description: "מכירה sale",
            status: "posted",
            lines: [
              { accountId: "cash", amountCents: 1500 },
              { accountId: "rent", amountCents: 500 },
              { accountId: "income", amountCents: -2000 },
            ],
          },
        ],
        isDataTruncated: false,
      });
      const host = document.createElement("div");
      host.id = "report-columns-probe";
      host.style.cssText =
        "position:fixed;inset:0;z-index:999999;background:white;overflow:auto";
      document.body.append(host);
      createRoot(host).render(
        React.createElement(View, {
          accounts,
          formatCurrency: (value: number) => (value / 100).toFixed(2),
          startDate: "2024-02-01",
          endDate: "2024-03-31",
          asOfDate: "2024-03-31",
          compareStartDate: "2023-02-01",
          compareEndDate: "2023-03-31",
        }),
      );
    }, kind);
    const screen = page.locator("#report-columns-probe");
    const columns = screen.getByLabel("Columns:");
    await expect(columns).toHaveValue("total");
    await columns.selectOption("months");
    await expect(screen.getByRole("button", { name: "Export to Excel", exact: true })).toHaveCount(0);
    await expect(
      screen.getByRole("columnheader", { name: /Feb 2024/ }),
    ).toBeVisible();
    await expect(
      screen.getByRole("columnheader", { name: /Mar 2024/ }),
    ).toBeVisible();
    const percent = screen.getByRole("checkbox", {
      name: "% of total",
      exact: true,
    });
    await percent.focus();
    await percent.press("Space");
    await expect(percent).toBeChecked();
    await expect(
      screen.getByRole("row", {
        name: kind === "pl" ? /שכירות Rent/ : /^Cash/,
      }),
    ).toContainText(kind === "pl" ? "25.0%" : "100.0%");
    const compare = screen.getByRole("checkbox", { name: /Comparative/ });
    // Page-provided comparison dates already turn comparison on.
    await expect(compare).toBeChecked();
    await expect(
      screen.getByRole("columnheader", { name: "Variance", exact: true }),
    ).toHaveCount(2);
    await compare.focus();
    await compare.press("Space");
    await expect(compare).not.toBeChecked();
    await expect(
      screen.getByRole("columnheader", { name: "Variance", exact: true }),
    ).toHaveCount(0);
    await screen.getByText("Choose and order periods", { exact: true }).click();
    const earlier = screen.getByRole("button", { name: "Move Mar 2024 earlier" });
    await earlier.focus();
    await earlier.press("Enter");
    await expect(screen.locator('th[scope="colgroup"]').first()).toContainText('Mar 2024');
    const feb = screen.getByRole('checkbox', { name: 'Feb 2024', exact: true });
    await feb.focus(); await feb.press('Space');
    await expect(screen.locator('th[scope="colgroup"]')).toHaveCount(1);
    await expect(screen.getByRole('checkbox', { name: 'Mar 2024', exact: true })).toBeDisabled();
    const geometry = await earlier.boundingBox();
    expect(geometry!.height).toBeGreaterThanOrEqual(44);
    await screen.getByRole('button', { name: 'Reset period columns' }).click();
    await expect(screen.locator('th[scope="colgroup"]').first()).toContainText('Feb 2024');
    const download = page.waitForEvent("download");
    await screen.getByRole("button", { name: "Export columns CSV" }).click();
    expect((await download).suggestedFilename()).toContain("_months.csv");
    await columns.selectOption("quarters");
    await expect(
      screen.getByRole("columnheader", { name: /FY2024 Q1/ }),
    ).toBeVisible();
    await columns.selectOption("total");
    await expect(
      screen.getByRole("columnheader", { name: kind === "pl" ? /Total.*2024-02-01/ : /Total.*2024-03-31/ }),
    ).toBeVisible();
  });
}
