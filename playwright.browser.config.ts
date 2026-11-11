import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-only test configuration for tests that don't need a dev server.
 * These tests mount React components directly in a fixture HTML page.
 */
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // No baseURL - tests use their own fixture pages
    baseURL: 'about:blank',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer - tests don't need the dev server
  webServer: undefined,
});
