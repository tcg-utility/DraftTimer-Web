import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/DraftTimer-Web/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/static-server.mjs',
    url: 'http://127.0.0.1:4173/DraftTimer-Web/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium-320', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13 Mini'] } },
  ],
});
