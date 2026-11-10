// Explicit, review-only browser diagnostic. Run from the repository root; it is not CI's config.
// A normal Playwright Chromium install is used unless AUDIT_CHROMIUM_PATH is supplied.
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.AUDIT_CHROMIUM_PATH;
export default defineConfig({
  testDir: '.',
  testMatch: 'af004-browser-journey.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'off' },
  projects: [{
    name: 'chromium-audit',
    use: {
      ...devices['Desktop Chrome'],
      ...(executablePath ? { launchOptions: { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } } : {}),
    },
  }],
  webServer: { command: 'npm run dev', cwd: process.cwd(), url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 120000 },
});
