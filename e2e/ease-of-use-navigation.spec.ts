import { test, expect } from "@playwright/test";

for (const width of [390, 1280])
  for (const theme of ["light", "dark"]) {
    test(`EU-D1 fixed phone actions ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript((theme) => {
        localStorage.setItem("isGuest", "true");
        localStorage.setItem("has_seen_onboarding", "true");
        localStorage.setItem("ledgerflow-cookie-consent", "accepted");
        localStorage.setItem("lf_theme", theme);
      }, theme);
      await page.goto("/#dashboard");
      await expect(
        page.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Phone navigation" });
      if (width === 1280) {
        await expect(nav).toBeHidden();
        return;
      }
      await expect(nav.getByRole("button")).toHaveCount(5);
      for (const name of ["Home", "To review", "New", "Reports", "More"]) {
        const button = nav.getByRole("button", { name, exact: true });
        await expect(button).toBeInViewport();
        const box = (await button.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await expect(
        nav.getByRole("button", { name: "Home", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      for (const [name, hash] of [
        ["To review", "inbox"],
        ["Reports", "reports"],
        ["Home", "dashboard"],
      ]) {
        await nav.getByRole("button", { name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#${hash}$`));
        await expect(
          nav.getByRole("button", { name, exact: true }),
        ).toHaveAttribute("aria-current", "page");
      }
      await nav.getByRole("button", { name: "More", exact: true }).click();
      await expect(
        page.getByRole("navigation", { name: "Main navigation", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }

for (const width of [390, 1280])
  for (const theme of ["light", "dark"]) {
    test(`EU-B1 New opens each form and can repeat on the same page ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
      await page.route("**/rest/v1/**", (route) =>
        route.fulfill({
          json: route.request().url().includes("/workspaces")
            ? [
                {
                  id: "eu-books",
                  data: { uid: "eu-owner", name: "EU books", currency: "USD" },
                },
              ]
            : [],
        }),
      );
      await page.addInitScript((theme) => {
        localStorage.setItem("lf_theme", theme);
        localStorage.setItem("isGuest", "true");
        localStorage.setItem("has_seen_onboarding", "true");
        localStorage.setItem("ledgerflow-cookie-consent", "accepted");
      }, theme);
      await page.goto("/#dashboard");
      await expect(
        page.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      // Inject a signed-in owner at the auth boundary; no form is saved and no real backend is used.
      await page.evaluate(async () => {
        const path = performance
          .getEntriesByType("resource")
          .find((r) => r.name.includes("/src/stores/useAuthStore.ts"))!.name;
        const { useAuthStore } = (await import(
          /* @vite-ignore */ path
        )) as typeof import("../src/stores/useAuthStore");
        useAuthStore.setState({
          user: {
            uid: "eu-owner",
            email: "owner@example.test",
            getIdToken: async () => "fixture",
          } as never,
          workspaces: [
            {
              id: "eu-books",
              uid: "eu-owner",
              name: "EU books",
              currency: "USD",
            } as never,
          ],
          currentWorkspaceId: "eu-books",
        });
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const newButton =
        width === 390
          ? page
              .getByRole("navigation", { name: "Phone navigation" })
              .getByRole("button", { name: "New", exact: true })
          : page
              .locator("header")
              .getByRole("button", { name: "New", exact: true });
      for (const [action, title] of [
        ["Invoice", "New invoice"],
        ["Invoice", "New invoice"],
        ["Customer", "Add Customer"],
        ["Bill", "Record New Bill"],
        ["Vendor", "Add Vendor"],
        ["Journal entry", "New Journal Entry"],
      ]) {
        await newButton.click();
        const menu = page.getByRole("dialog", {
          name: "Create new",
          exact: true,
        });
        await expect(menu).toBeVisible();
        await menu.getByRole("button", { name: action, exact: true }).click();
        await expect(menu).toHaveCount(0);
        const form = page.getByRole("dialog", { name: title, exact: true });
        await expect(form).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        if (width === 390 && ["Customer", "Vendor"].includes(action)) {
          const home = page
            .getByRole("navigation", { name: "Phone navigation" })
            .getByRole("button", { name: "Home", exact: true });
          expect(
            await home.evaluate((button) => {
              const box = button.getBoundingClientRect();
              return !button.contains(
                document.elementFromPoint(
                  box.x + box.width / 2,
                  box.y + box.height / 2,
                ),
              );
            }),
          ).toBe(true);
          const nameField = form.getByRole("textbox", {
            name: `${action} Name`,
            exact: true,
          });
          await nameField.fill("Unsaved contact");
          const url = page.url();
          const box = (await home.boundingBox())!;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await expect(form).toBeVisible();
          await expect(nameField).toHaveValue("Unsaved contact");
          expect(page.url()).toBe(url);
        }
        // Global creation shortcuts must not replace an open form.
        await form.focus();
        await page.keyboard.press("n");
        await page.keyboard.press("b");
        await expect(form).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(form).toHaveCount(0);
      }
      for (const [key, title] of [
        ["i", "New invoice"],
        ["b", "Record New Bill"],
        ["j", "New Journal Entry"],
      ]) {
        await page.locator("#main-content").focus();
        await page.keyboard.press("n");
        await page.keyboard.press(key);
        const form = page.getByRole("dialog", { name: title, exact: true });
        await expect(form).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(form).toHaveCount(0);
      }
      // Typing targets keep their keys even when a creation shortcut is pressed.
      await page.evaluate(() => {
        const field = document.createElement("input");
        field.id = "typing-probe";
        document.body.append(field);
        field.focus();
      });
      await page.keyboard.press("n");
      await page.keyboard.press("i");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.locator("#typing-probe").evaluate((el) => el.remove());
      await newButton.click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(newButton).toBeFocused();
      // An external creation link uses the same destination handling, without a loaded record list.
      await page.evaluate(() => {
        window.location.hash = "sales/invoice/new";
      });
      await expect(
        page.getByRole("dialog", { name: "New invoice", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Viewer controls refuse pointer, keyboard and direct-link creation.
      await page.evaluate(async () => {
        const path = performance
          .getEntriesByType("resource")
          .find((r) => r.name.includes("/src/stores/useAuthStore.ts"))!.name;
        const { useAuthStore } = (await import(
          /* @vite-ignore */ path
        )) as typeof import("../src/stores/useAuthStore");
        useAuthStore.setState({
          workspaces: [
            {
              id: "eu-books",
              uid: "someone-else",
              name: "EU books",
              roles: { "eu-owner": "viewer" },
            } as never,
          ],
        });
      });
      await expect(newButton).toBeDisabled();
      await newButton.evaluate((el) => (el as HTMLButtonElement).click());
      await page.locator("#main-content").focus();
      await page.keyboard.press("n");
      await page.keyboard.press("i");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
